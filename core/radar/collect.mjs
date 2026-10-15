// Estágio 1 do radar, sem LLM: coleta, identifica o que é novo e grava `vaga.descoberta`.
import { createHash } from 'node:crypto';
import { consolidar, classificar } from '../dedup/consolidar.mjs';
import { runSources } from '../sources/index.mjs';
import { triagemPre } from '../score/prescore.mjs';
import { buildSources } from '../sources/registry.mjs';
import { buildPlan } from '../sources/plan.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';
import { readMigrationState } from '../migration/legacy.mjs';

// Em modo sombra o legado continua dono dos dados e o `migrate --shadow` exige diferenças 0: a coleta real não grava.
export const MENSAGEM_SOMBRA = 'Modo sombra ativo: a coleta real não grava enquanto o legado for o escritor oficial (use --dry-run para só ver). Fazer o corte para o modo ativo libera a gravação.';
export async function emSombra(dataRoot) {
  return (await readMigrationState(dataRoot))?.mode === 'shadow';
}

export function descobertaEvent(vaga, id, ts, aparicoes = [], extra = {}) {
  const urls = createHash('sha256').update(JSON.stringify((aparicoes.length ? aparicoes : [{ fonte: vaga.fonte, url: vaga.url }]).map(item => `${item.fonte}|${item.url}`).sort())).digest('hex').slice(0, 8);
  return { id: `descoberta:${id}:${vaga.descricao_hash.slice(0, 12)}:${urls}`, ts, ator: 'radar', tipo: 'vaga.descoberta', entidade: 'vaga', entidade_id: id, dados: { vaga, aparicoes, ...extra } };
}

export async function collect({ settings, only, dryRun = false, now = new Date(), sources, host }) {
  if (!dryRun && await emSombra(settings.dataRoot)) throw new Error(MENSAGEM_SOMBRA);
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
  const descobertas = classificar(consolidar(coleta.vagas), projetado.vagas).map(item => ({ ...item, pre: triagemPre(item.vaga, settings.radar.criterios) }));
  const novas = descobertas.filter(item => item.situacao === 'nova');
  const delta = novas.filter(item => item.pre.delta);
  const pendentes = descobertas.filter(item => item.situacao === 'pendente_conferencia');
  const ts = now.toISOString();
  let gravados = 0;
  if (!dryRun) {
    const result = await appendEvents(settings.dataRoot, descobertas.map(item => descobertaEvent(item.vaga, item.id, ts, item.aparicoes, { destino_pendente: item.destino_pendente, possivel_duplicata: item.possivel_duplicata, pre: item.pre })), { ...(host ? { host } : {}), now: ts });
    gravados = result.events.length;
  }
  return { dry_run: dryRun, janela: window, fontes: coleta.fontes, coletadas: coleta.vagas.length, novas: novas.length, pendentes_conferencia: pendentes.length, delta: delta.length, eventos_gravados: gravados, novas_ids: novas.map(item => item.id) };
}
