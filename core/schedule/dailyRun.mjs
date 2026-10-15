// Rotina diária: decide, marca o dia, roda o estágio 1 (sem LLM) e o estágio 2 (LLM) em sequência e registra a rodada.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { localDay } from '../store/schema.mjs';
import { registrarRodada } from '../score/digest.mjs';
import { shouldRun } from './shouldRun.mjs';
import { emSombra } from '../radar/collect.mjs';

const stateFile = dataRoot => path.join(dataRoot, 'state', 'daily-run.json');

export async function readState(dataRoot) {
  try { return JSON.parse(await readFile(stateFile(dataRoot), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

export async function dailyRun({ dataRoot, config = {}, host, now = new Date(), estagio1, estagio2, dryRun = false }) {
  // Em sombra a coleta não grava; a rotina nem marca o dia nem registra rodada, para não gerar falha falsa.
  if (await emSombra(dataRoot)) return dryRun ? { dry_run: true, executaria: false, motivo: 'modo_sombra', retomada: false } : { executou: false, motivo: 'modo_sombra' };
  const ultima = await readState(dataRoot);
  const decisao = shouldRun({ now, ultima, config, host });
  if (dryRun) return { dry_run: true, executaria: decisao.run, motivo: decisao.motivo, retomada: decisao.retomada === true };
  if (!decisao.run) return { executou: false, motivo: decisao.motivo };
  const dia = localDay(now);
  const marcador = { dia, estado: 'iniciada', iniciada_em: now.toISOString(), retomadas: decisao.retomada ? (ultima.retomadas ?? 0) + 1 : 0 };
  await atomicJson(stateFile(dataRoot), marcador);

  let r1;
  try { r1 = await estagio1(); }
  catch (error) {
    const falha = { estagio: 1, erro: String(error.message ?? error).slice(0, 300) };
    await registrarRodada(dataRoot, { fontes: [], novas_ids: [], avaliadas_ids: [], falha }, now);
    return { executou: true, falha };
  }
  let r2;
  try { r2 = await estagio2(r1); }
  catch (error) {
    const falha = { estagio: 2, erro: String(error.message ?? error).slice(0, 300) };
    await registrarRodada(dataRoot, { fontes: r1.fontes ?? [], novas_ids: r1.novas_ids ?? [], avaliadas_ids: [], falha }, now);
    return { executou: true, falha };
  }
  const rodada = { fontes: r1.fontes ?? [], novas_ids: r1.novas_ids ?? [], avaliadas_ids: r2.avaliadas_ids ?? [], falhas_avaliacao: r2.falhas ?? [], perguntas_pendentes: r2.perguntas_pendentes ?? 0 };
  await registrarRodada(dataRoot, rodada, now);
  await atomicJson(stateFile(dataRoot), { ...marcador, estado: 'concluida', concluida_em: now.toISOString() });
  return { executou: true, rodada };
}
