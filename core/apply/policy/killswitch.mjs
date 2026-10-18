// Kill switch do envio (F7.10, seam S7/S9). Quando o arquivo DATA_ROOT/envio.pausado existe,
// o hook e os drivers negam qualquer tentativa de envio imediatamente.
import { access, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appendEvents, readEvents } from '../../store/events.mjs';
import { localDay } from '../../store/schema.mjs';

export function arquivoKillSwitch(dataRoot) {
  return path.join(dataRoot, 'envio.pausado');
}

export async function isEnvioPausado(dataRoot) {
  try {
    await access(arquivoKillSwitch(dataRoot));
    return true;
  } catch {
    return false;
  }
}

export async function pausarEnvio(dataRoot, { motivo = 'pausa manual', ts = new Date().toISOString() } = {}) {
  const arquivo = arquivoKillSwitch(dataRoot);
  await writeFile(arquivo, `${JSON.stringify({ pausado_em: ts, motivo }, null, 2)}\n`, 'utf8');
  const id = `pausa-${Date.now()}`;
  await appendEvents(dataRoot, [{
    id,
    ts,
    ator: 'humano',
    tipo: 'envio.pausado',
    entidade: 'sistema',
    entidade_id: 'envio',
    dados: { motivo }
  }], { now: ts });
  return { ok: true, pausado_em: ts, motivo };
}

export async function retomarEnvio(dataRoot, { ts = new Date().toISOString() } = {}) {
  const arquivo = arquivoKillSwitch(dataRoot);
  try {
    await unlink(arquivo);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const id = `retomada-${Date.now()}`;
  await appendEvents(dataRoot, [{
    id,
    ts,
    ator: 'humano',
    tipo: 'envio.retomado',
    entidade: 'sistema',
    entidade_id: 'envio',
    dados: {}
  }], { now: ts });
  return { ok: true, retomado_em: ts };
}

export async function auditarDecisoes(dataRoot, { dia = localDay(new Date().toISOString()) } = {}) {
  const { eventos } = await readEvents(dataRoot);
  const doDia = eventos.filter(e => e.tipo.startsWith('envio.') && (e.dados?.dia === dia || localDay(e.ts) === dia));
  return doDia.map(e => ({
    id: e.id,
    ts: e.ts,
    tipo: e.tipo,
    vaga_id: e.entidade === 'vaga' ? e.entidade_id : null,
    dados: e.dados
  }));
}
