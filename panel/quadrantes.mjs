// Aba Quadrantes do painel: resposta da API (somente leitura) e o trecho HTML injetado na página servida.
// A injeção acontece no servidor, então vale para o template público, para o privado e para a página do modo sombra.
import path from 'node:path';
import { loadSettings } from '../core/config.mjs';
import { analisarBase } from '../core/kb/analise.mjs';
import { loadIdentityValues, redact } from '../core/privacy/redact.mjs';

const LIMITE_ITENS = 100;
const ZERO = { a: 0, b: 0, c: 0, d: 0 };

// Devolve { status, corpo }. Nunca lança: erro vira estado "erro" com o motivo curto (sem caminho do DATA_ROOT).
export async function respostaQuadrantes({ dataRoot }) {
  try {
    const settings = await loadSettings({ dataRoot });
    const identidade = await loadIdentityValues({ env: { IDENTITY_FILE: path.join(dataRoot, 'identity.yml') } });
    const { quadrantes, base } = await analisarBase({ dataRoot, settings });
    if (base.claims.length === 0 && base.cvTemplates.length === 0) {
      return { status: 200, corpo: { estado: 'sem_dados', contagem: ZERO, a: [], b: [], c: [], d: [], avisos: [], mensagem: 'A base ainda está vazia. Rode kb sync depois de preencher kb/claims.' } };
    }
    const corte = lista => lista.slice(0, LIMITE_ITENS);
    const corpo = { estado: 'ok', contagem: quadrantes.contagem, a: corte(quadrantes.a), b: corte(quadrantes.b), c: corte(quadrantes.c), d: corte(quadrantes.d), avisos: quadrantes.avisos,
      truncado: Object.values(quadrantes.contagem).some(n => n > LIMITE_ITENS), mensagem: null };
    return { status: 200, corpo: redact(corpo, identidade).valor };
  } catch (error) {
    const detalhe = String(error.message ?? error).replaceAll(dataRoot, '<DATA_ROOT>').slice(0, 200);
    return { status: 500, corpo: { estado: 'erro', erro: 'Não foi possível calcular os quadrantes.', detalhe } };
  }
}

const ESTILO = `<style>
[hidden]{display:none!important}
.abas{display:flex;gap:4px;padding:0 max(28px,calc((100vw - 1120px)/2));background:var(--panel-bg,#fff);border-bottom:1px solid var(--line,#dce3e9)}
.abas button{border:0;border-bottom:3px solid transparent;border-radius:0;background:none;padding:12px 16px;font-size:14px;font-weight:600;color:var(--muted,#5d6c7e);cursor:pointer}
.abas button[aria-selected=true]{color:var(--ink,#14253b);border-bottom-color:var(--cyan,#00b7e5)}
#quadrantes-painel{max-width:1176px;margin:auto;padding:28px;color:var(--ink,#14253b)}
#quadrantes-painel .q-resumo{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 18px}
#quadrantes-painel .q-resumo div{background:#fff;border:1px solid var(--line,#dce3e9);border-radius:5px;padding:12px 18px;min-width:150px}
#quadrantes-painel .q-resumo strong{display:block;font-size:28px;line-height:1.2}
#quadrantes-painel details{background:#fff;border:1px solid var(--line,#dce3e9);border-radius:5px;margin:0 0 10px;padding:10px 18px}
#quadrantes-painel summary{font-size:14px;font-weight:600}
#quadrantes-painel ul{margin:10px 0 4px;padding-left:18px}
#quadrantes-painel li{margin:0 0 8px;font-size:13px}
#quadrantes-painel .q-estado{background:#fff;border:1px solid var(--line,#dce3e9);border-radius:5px;padding:24px;text-align:center;font-size:14px}
#quadrantes-painel .q-meta{color:var(--muted,#5d6c7e);font-size:12px}
.abas button:focus-visible,#quadrantes-painel button:focus-visible,#quadrantes-painel summary:focus-visible{outline:2px solid #00a4d7;outline-offset:3px}
</style>`;

const PAINEL = '<section id="quadrantes-painel" role="tabpanel" aria-labelledby="aba-quadrantes" data-aba-painel="quadrantes" hidden><div id="quadrantes-conteudo" aria-live="polite"></div></section>';

const SCRIPT = `<script id="quadrantes-painel-script">(function(){
var conteudo=document.getElementById('quadrantes-conteudo'),carregado=false;
var TITULOS=[['a','(a) Dado e CV conferem'],['b','(b) Dado fora do CV'],['c','(c) CV sem dado'],['d','(d) Lacunas, da mais pesada para a mais leve']];
function el(tag,texto,cls){var n=document.createElement(tag);if(texto!==undefined)n.textContent=texto;if(cls)n.className=cls;return n}
function estado(texto,botao){conteudo.textContent='';var d=el('div',texto,'q-estado');if(botao){var b=el('button','Tentar de novo');b.type='button';b.addEventListener('click',carregar);d.appendChild(document.createElement('br'));d.appendChild(b)}conteudo.appendChild(d)}
function linha(q,i){
 if(q==='a')return i.texto+' ('+i.claim_ids.join(', ')+')';
 if(q==='b')return i.tipo==='afirmacao'?i.id+' ('+i.nivel_prova+'): '+i.texto:'Arco '+i.id+(i.titulo?' ('+i.titulo+')':'')+': sem afirmação ligada';
 if(q==='c')return i.texto+' — '+i.motivo;
 return '['+i.peso+'] '+i.descricao+' Pergunta: '+i.pergunta_sugerida}
function render(d){
 conteudo.textContent='';
 var r=el('div',undefined,'q-resumo');
 TITULOS.forEach(function(t){var c=el('div');c.appendChild(el('strong',String(d.contagem[t[0]])));c.appendChild(el('span',t[1]));r.appendChild(c)});
 conteudo.appendChild(r);
 TITULOS.forEach(function(t){var det=el('details');if(t[0]==='d'||t[0]==='c')det.open=true;det.appendChild(el('summary',t[1]+': '+d.contagem[t[0]]));
  var ul=el('ul');d[t[0]].forEach(function(i){ul.appendChild(el('li',linha(t[0],i)))});
  if(!d[t[0]].length)ul.appendChild(el('li','Nenhum item.'));det.appendChild(ul);conteudo.appendChild(det)});
 if(d.truncado)conteudo.appendChild(el('p','Lista limitada aos primeiros itens de cada quadrante.','q-meta'));
 (d.avisos||[]).forEach(function(a){conteudo.appendChild(el('p','Aviso: '+a,'q-meta'))})}
function carregar(){
 estado('Carregando quadrantes...');
 fetch('/api/quadrantes',{headers:{'X-Painel-Token':(window.PAINEL_API||{}).token||''},cache:'no-store'}).then(function(r){
  if(r.status===403){estado('Sem permissão para ver os quadrantes. Recarregue o painel.');return null}
  return r.json().then(function(d){
   if(!r.ok||d.estado==='erro'){estado('Não foi possível carregar os quadrantes. '+(d.detalhe||''),true);return}
   if(d.estado==='sem_dados'){carregado=true;estado('Nada para mostrar ainda. '+(d.mensagem||''));return}
   carregado=true;render(d)})
 }).catch(function(){estado('Não foi possível carregar os quadrantes. Verifique se o painel local está rodando.',true)})}
window.CB_ABAS=window.CB_ABAS||{};window.CB_ABAS.quadrantes=function(){if(!carregado)carregar()};
})();</script>`;

// Aba para a barra genérica (panel/abas.mjs): o estilo comum das abas vem junto com o desta.
export const ABA_QUADRANTES = { id: 'quadrantes', titulo: 'Quadrantes', estilo: ESTILO, html: `${PAINEL}${SCRIPT}` };
