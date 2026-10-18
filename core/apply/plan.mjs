import { activeRules } from '../config.mjs';
import { readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { cvsDoPainel } from '../cv/artifacts.mjs';
import { projetarPerguntas } from './perguntas.mjs';
import { projetarTentativas } from './attempts.mjs';
import { montarFila } from './queue.mjs';
import { rotaDe } from './route.mjs';
import { lerSessao } from './sessao.mjs';

// Ação padrão: sem regra ativa nunca há envio automático (a política completa está em policy/, F7).
export function planApply(settings) {
  return { acao: settings.envio.padrao, regras_ativas: activeRules(settings).length };
}

// Plano do /aplicar (F6.7): a fila elegível, com a rota de cada vaga, e as exclusões com o motivo.
export async function planejarAplicacao({ dataRoot, settings, aderencias, paraLote = false, agora = new Date().toISOString() }) {
  const { eventos } = await readEvents(dataRoot);
  const projecao = projectEvents(eventos);
  const vagasEmRevisao = new Set(paraLote ? (await lerSessao(dataRoot)).abas.filter(a => Date.parse(a.expira_em) > Date.parse(agora)).map(a => a.vaga_id) : []);
  const { fila, excluidas } = montarFila({
    vagas: projecao.vagas ?? [], perguntasPorVaga: projetarPerguntas(eventos).porVaga, tentativas: projetarTentativas(eventos),
    cvs: await cvsDoPainel(projecao, dataRoot), config: settings, ...(aderencias ? { aderencias } : {}), agora, vagasEmRevisao,
  });
  const porId = new Map((projecao.vagas ?? []).map(v => [v.id, v]));
  return { ...planApply(settings), fila: fila.map(item => ({ ...item, ...rotaDe(porId.get(item.vaga_id)) })), excluidas };
}
