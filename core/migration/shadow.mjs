import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { migrateLegacy } from './legacy.mjs';

// O legado (Python) trava <legado>.lock com lock de arquivo do sistema. No Windows a leitura do primeiro byte
// falha enquanto ele está travado; em POSIX o lock é consultivo e a sonda não enxerga, então o ganho é o
// hash estável do arquivo lido (migrateLegacy recusa origem alterada durante a leitura).
export async function legacyBusy(legadoPath) {
  const lock = legadoPath.replace(/\.json$/i, '.lock');
  let handle;
  try { handle = await open(lock, 'r'); }
  catch (error) { if (error.code === 'ENOENT') return false; return ['EBUSY', 'EACCES', 'EPERM', 'EAGAIN'].includes(error.code); }
  try { await handle.read(Buffer.alloc(1), 0, 1, 0); return false; }
  catch (error) { return ['EBUSY', 'EACCES', 'EPERM', 'EAGAIN'].includes(error.code); }
  finally { await handle.close(); }
}

const REPORT = 'state/shadow-report.json';
const KEEP = 30;

// Rodada de sombra: importa o legado e grava o relatório do dia. Falha também vira relatório.
export async function runShadow(options) {
  const { dataRoot } = options;
  const now = options.now ?? new Date().toISOString();
  const entry = { ts: now, gravacao_painel: 'desligada' };
  let result;
  try {
    const before = await migrateLegacy({ ...options, dryRun: true, diff: true });
    result = await migrateLegacy({ ...options, now });
    Object.assign(entry, { ok: true, diferencas_antes: before.diferencas, mudancas_importadas: before.itens?.length ?? 0, eventos_adicionados: result.eventsAdded, diferencas: result.diferencas, equal: result.equal, source_hash: result.sourceHash });
  } catch (error) {
    Object.assign(entry, { ok: false, erro: error.message });
    await writeReport(dataRoot, entry);
    throw error;
  }
  await writeReport(dataRoot, entry);
  return { ...result, gravacao_painel: 'desligada', relatorio: REPORT, mudancas_importadas: entry.mudancas_importadas };
}

async function writeReport(dataRoot, entry) {
  const file = path.join(dataRoot, REPORT);
  let history = [];
  try { history = JSON.parse(await readFile(file, 'utf8')).historico ?? []; } catch (error) { if (error.code !== 'ENOENT') history = []; }
  history = [...history, entry].slice(-KEEP);
  await atomicJson(file, { versao: 1, atual: entry, historico: history });
}
