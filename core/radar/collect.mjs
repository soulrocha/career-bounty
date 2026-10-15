// Estágio 1 do radar, sem LLM: coleta, identifica o que é novo e grava `vaga.descoberta`.
import { idFor } from '../dedup/keys.mjs';
import { runSources } from '../sources/index.mjs';
import { buildSources } from '../sources/registry.mjs';
import { buildPlan } from '../sources/plan.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';

export function descobertaEvent(vaga, id, ts) {
  return { id: `descoberta:${id}:${vaga.descricao_hash.slice(0, 12)}`, ts, ator: 'radar', tipo: 'vaga.descoberta', entidade: 'vaga', entidade_id: id, dados: { vaga } };
}

export async function collect({ settings, only, dryRun = false, now = new Date(), sources, host }) {
  const lista = sources ?? buildSources(settings, { only });
  const plano = buildPlan(settings.radar, now);
  const window = plano.janela;
  const coleta = await runSources(lista, { janela: window, plano, config: settings.fontes, now }, { timeoutMs: settings.radar.timeout_fonte_ms });
  const { eventos, avisos } = await readEvents(settings.dataRoot);
  if (avisos.length) throw new Error(`Log de eventos truncado ou corrompido (${avisos.length} aviso(s)); revisão necessária.`);
  const conhecidas = new Set(projectEvents(eventos).vagas.map(vaga => vaga.id));
  const vistas = new Set();
  const descobertas = [];
  for (const vaga of coleta.vagas) {
    const id = idFor(vaga);
    if (vistas.has(id)) continue;
    vistas.add(id);
    descobertas.push({ id, vaga });
  }
  const novas = descobertas.filter(item => !conhecidas.has(item.id));
  const ts = now.toISOString();
  let gravados = 0;
  if (!dryRun) {
    const result = await appendEvents(settings.dataRoot, descobertas.map(item => descobertaEvent(item.vaga, item.id, ts)), { ...(host ? { host } : {}), now: ts });
    gravados = result.events.length;
  }
  return { dry_run: dryRun, janela: window, fontes: coleta.fontes, coletadas: coleta.vagas.length, novas: novas.length, delta: novas.length, eventos_gravados: gravados };
}
