// Fila do /aplicar (F6.7): só entra o que pode ser enviado. Cada exclusão traz o motivo; a ordem é estável.
// Elegível = aderência pedida, não aplicada (nem em outra aparição da requisição), não descartada, viva, compatível,
// sem pergunta pendente, sem tentativa em andamento ou enviada e com CV aprovado (portal sem CV, como a Gupy, dispensa).
import { aplicadaDe, descartadaDe } from '../store/rules.mjs';
import { podeCandidatar } from '../cv/gates.mjs';
import { decidirCv } from '../cv/select.mjs';
import { bloqueioDeTentativa, chaveTentativa } from './attempts.mjs';

const PESO = { alta: 0, boa: 0, media: 1 };
export const ADERENCIAS_PADRAO = ['alta', 'media'];

// vagas: projeção. perguntasPorVaga: Map de projetarPerguntas. tentativas: Map de projetarTentativas.
// cvs: { vaga_id: cvDoPainel(manifesto) }. config: settings (cv_skip_portals).
export function montarFila({ vagas, perguntasPorVaga = new Map(), tentativas = new Map(), cvs = {}, config = {}, aderencias = ADERENCIAS_PADRAO, agora = new Date().toISOString() }) {
  const pedidas = new Set(aderencias.flatMap(a => (a === 'alta' ? ['alta', 'boa'] : [a])));
  const fila = [];
  const excluidas = [];
  const fora = (vaga, codigo, motivo) => excluidas.push({ vaga_id: vaga.id, empresa: vaga.empresa, cargo: vaga.cargo, codigo, motivo });
  for (const vaga of vagas) {
    if (!pedidas.has(vaga.aderencia)) { fora(vaga, 'aderencia', `aderência ${vaga.aderencia ?? 'pendente'} fora do pedido`); continue; }
    if (aplicadaDe(vaga)) { fora(vaga, 'aplicada', vaga.candidatura_herdada ? 'já aplicada em outra aparição da mesma requisição' : 'já aplicada'); continue; }
    if (descartadaDe(vaga)) { fora(vaga, 'descartada', 'descartada'); continue; }
    if (vaga.url_status !== 'aberta') { fora(vaga, 'encerrada', `vaga ${vaga.url_status ?? 'sem status'}: não está viva`); continue; }
    if (vaga.condicoes?.situacao === 'incompativel') { fora(vaga, 'incompativel', 'condições incompatíveis'); continue; }
    const tentativa = bloqueioDeTentativa(tentativas.get(chaveTentativa(vaga)), agora);
    if (tentativa) { fora(vaga, tentativa.codigo, tentativa.motivo); continue; }
    const pendentes = perguntasPorVaga.get(vaga.id) ?? [];
    if (pendentes.length) { fora(vaga, 'aguarda_resposta', `${pendentes.length} pergunta(s) esperando resposta na aba Perguntas`); continue; }
    const semCv = !decidirCv(vaga, config).gerar;
    if (!semCv) {
      if (!podeCandidatar(vaga)) { fora(vaga, 'cv_bloqueado', 'CV bloqueado no gate'); continue; }
      if (!cvs[vaga.id]?.atual) { fora(vaga, 'sem_cv', 'sem CV aprovado: rode cv gerar'); continue; }
    }
    fila.push({ vaga_id: vaga.id, empresa: vaga.empresa, cargo: vaga.cargo, aderencia: vaga.aderencia, portal: vaga.portal_candidatura ?? null, url: vaga.application_url ?? vaga.url,
      cv: semCv ? null : { hash: cvs[vaga.id].atual.hash, ats: cvs[vaga.id].atual.ats } });
  }
  fila.sort((a, b) => (PESO[a.aderencia] ?? 9) - (PESO[b.aderencia] ?? 9) || String(a.empresa).localeCompare(String(b.empresa), 'pt-BR') || a.vaga_id.localeCompare(b.vaga_id));
  return { fila, excluidas };
}
