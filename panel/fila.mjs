// Aba Fila (F6.11): o estado de candidatura de cada vaga em jogo, a partir da fila elegível e das tentativas.
import { loadSettings } from '../core/config.mjs';
import { planejarAplicacao } from '../core/apply/plan.mjs';
import { projetarTentativas, chaveTentativa } from '../core/apply/attempts.mjs';
import { projetarPerguntas } from '../core/apply/perguntas.mjs';
import { readEvents } from '../core/store/events.mjs';
import { projectEvents } from '../core/store/project.mjs';

export const ESTADOS_FILA = ['pronta', 'aguarda_resposta', 'bloqueada:humano', 'pronta_para_enviar', 'enviada', 'enviada_sem_comprovante', 'incerta'];
const ORDEM = Object.fromEntries(ESTADOS_FILA.map((e, i) => [e, i]));

export async function listarFila({ dataRoot }) {
  const settings = await loadSettings({ dataRoot });
  const { eventos } = await readEvents(dataRoot);
  const { fila, excluidas } = await planejarAplicacao({ dataRoot, settings });
  const vagas = new Map((projectEvents(eventos).vagas ?? []).map(v => [v.id, v]));
  const tentativas = projetarTentativas(eventos);
  const { porVaga } = projetarPerguntas(eventos);
  const itens = new Map();
  for (const f of fila) itens.set(f.vaga_id, { vaga_id: f.vaga_id, empresa: f.empresa, cargo: f.cargo, rota: f.rota, estado: 'pronta', motivo: null });
  for (const e of excluidas.filter(x => x.codigo === 'aguarda_resposta')) itens.set(e.vaga_id, { vaga_id: e.vaga_id, empresa: e.empresa, cargo: e.cargo, estado: 'aguarda_resposta', motivo: e.motivo });
  for (const t of tentativas.values()) {
    const vaga = vagas.get(t.vaga_id);
    if (!vaga || chaveTentativa(vaga) !== t.chave) continue;
    const estado = t.estado === 'em_andamento' ? ((porVaga.get(vaga.id) ?? []).length ? 'aguarda_resposta' : 'pronta_para_enviar') : t.estado;
    if (!ESTADOS_FILA.includes(estado)) continue;
    itens.set(vaga.id, { vaga_id: vaga.id, empresa: vaga.empresa, cargo: vaga.cargo, rota: t.rota, estado, motivo: t.motivo ?? null, desde: t.desde,
      ...(t.comprovante ? { comprovante: { texto: t.comprovante.texto, url: t.comprovante.url, data: t.comprovante.data } } : {}) });
  }
  return { fila: [...itens.values()].sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado] || String(a.empresa).localeCompare(String(b.empresa), 'pt-BR')) };
}

const ESTILO = `<style>
#fila-painel{max-width:1176px;margin:auto;padding:28px;color:var(--ink,#14253b)}
#fila-painel table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line,#dce3e9);border-radius:5px;font-size:13px}
#fila-painel th,#fila-painel td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line,#dce3e9);vertical-align:top}
#fila-painel .f-estado{font-weight:600;white-space:nowrap}
#fila-painel .f-vazio{background:#fff;border:1px solid var(--line,#dce3e9);border-radius:5px;padding:24px;text-align:center;font-size:14px}
</style>`;

const PAINEL = '<section id="fila-painel" role="tabpanel" aria-labelledby="aba-fila" data-aba-painel="fila" hidden><div id="fila-conteudo" aria-live="polite"></div></section>';

const SCRIPT = `<script id="fila-painel-script">(function(){
var conteudo=document.getElementById('fila-conteudo');
var ROTULO={pronta:'Pronta',aguarda_resposta:'Aguarda sua resposta','bloqueada:humano':'Bloqueada (precisa de você)',pronta_para_enviar:'Pronta para enviar',enviada:'Enviada',enviada_sem_comprovante:'Enviada sem comprovante (confira)',incerta:'Incerta (confira)'};
function el(tag,texto,cls){var n=document.createElement(tag);if(texto!==undefined)n.textContent=texto;if(cls)n.className=cls;return n}
function vazio(t){conteudo.textContent='';conteudo.appendChild(el('div',t,'f-vazio'))}
function carregar(){vazio('Carregando fila...');
 fetch('/api/fila',{headers:{'X-Painel-Token':(window.PAINEL_API||{}).token||''},cache:'no-store'}).then(function(r){return r.json().then(function(d){
  if(!r.ok){vazio(d.erro||'Não foi possível carregar a fila.');return}
  if(!d.fila.length){vazio('Nenhuma vaga na fila. Rode o radar e gere os CVs das vagas alta e média.');return}
  conteudo.textContent='';var t=el('table'),h=el('tr');['Estado','Empresa','Cargo','Detalhe'].forEach(function(x){h.appendChild(el('th',x))});t.appendChild(h);
  d.fila.forEach(function(i){var tr=el('tr');tr.appendChild(el('td',ROTULO[i.estado]||i.estado,'f-estado'));tr.appendChild(el('td',i.empresa||''));tr.appendChild(el('td',i.cargo||''));
   tr.appendChild(el('td',i.comprovante&&i.comprovante.texto?i.comprovante.texto:(i.motivo||(i.rota?'rota: '+i.rota:''))));t.appendChild(tr)});conteudo.appendChild(t)})}).catch(function(){vazio('Painel local fora do ar.')})}
window.CB_ABAS=window.CB_ABAS||{};window.CB_ABAS.fila=carregar;
})();</script>`;

export const ABA_FILA = { id: 'fila', titulo: 'Fila', estilo: ESTILO, html: `${PAINEL}${SCRIPT}` };
