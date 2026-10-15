// Estágio 1 do radar, sem LLM: coleta, identifica o que é novo e grava `vaga.descoberta`.
import { consolidar, classificar } from '../dedup/consolidar.mjs';
import { runSources } from '../sources/index.mjs';
import { buildSources } from '../sources/registry.mjs';
import { buildPlan } from '../sources/plan.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';

export function descobertaEvent(vaga, id, ts, aparicoes = [], extra = {}) {
  return { id: `descoberta:${id}:${vaga.descricao_hash.slice(0, 12)}`, ts, ator: 'radar', tipo: 'vaga.descoberta', entidade: 'vaga', entidade_id: id, dados: { vaga, aparicoes, ...extra } };
}

export async function collect({ settings, only, dryRun = false, now = new Date(), sources, host }) {
  const lista = sources ?? buildSources(settings, { only });
  const plano = buildPlan(settings.radar, now);
  const window = plano.janela;
  const { eventos, avisos } = await readEvents(settings.dataRoot);
  if (avisos.length) throw new Error(`Log de eventos truncado ou corrompido (${avisos.length} aviso(s)); revisão necessária.`);
  const projetado = projectEvents(eventos);
  const conhecidas = new Map();
  for (const vaga of projetado.vagas) {
    const portal = vaga.portal_origem;
    if (portal && vaga.requisicao_id) conhecidas.set(portal, (conhecidas.get(portal) ?? new Set()).add(String(vaga.requisicao_id).replace(`${portal}:`, '')));
  }
  const coleta = await runSources(lista, { janela: window, plano, config: settings.fontes, now, dataRoot: settings.dataRoot, conhecidas }, { timeoutMs: settings.radar.timeout_fonte_ms });
  const descobertas = classificar(consolidar(coleta.vagas), projetado.vagas);
  const novas = descobertas.filter(item => item.situacao === 'nova');
  const ts = now.toISOString();
  let gravados = 0;
  if (!dryRun) {
    const result = await appendEvents(settings.dataRoot, descobertas.map(item => descobertaEvent(item.vaga, item.id, ts, item.aparicoes, { destino_pendente: item.destino_pendente, possivel_duplicata: item.possivel_duplicata })), { ...(host ? { host } : {}), now: ts });
    gravados = result.events.length;
  }
  return { dry_run: dryRun, janela: window, fontes: coleta.fontes, coletadas: coleta.vagas.length, novas: novas.length, delta: novas.length, eventos_gravados: gravados };
}
