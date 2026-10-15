import { appendFile, mkdir, open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { noLinks } from '../migration/paths.mjs';
import { atomicJson } from './atomicWrite.mjs';
import { withLock } from './lock.mjs';
import { isHost, localDay, validateEvent } from './schema.mjs';

export { atomicJson };

export const defaultHost = () => hostname().replace(/[^A-Za-z0-9_-]/g, '-') || 'host';

const byOrder = (a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.host.localeCompare(b.host) || (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id);

// Lê todo o log. Linha truncada ou evento inválido não derruba a leitura: vira aviso.
export async function readEvents(dataRoot) {
  await noLinks(path.join(dataRoot, 'events'));
  const eventos = [];
  const avisos = [];
  async function visit(directory, relative) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Link não permitido no log.');
      if (entry.isDirectory()) await visit(filename, `${relative}${entry.name}/`);
      else if (entry.name.endsWith('.jsonl')) {
        const lines = (await readFile(filename, 'utf8')).split('\n');
        const last = lines.length - 1;
        lines.forEach((line, index) => {
          if (!line) return;
          const where = `${relative}${entry.name}:${index + 1}`;
          let event;
          try { event = JSON.parse(line); }
          catch { avisos.push(`${where}: linha truncada ou corrompida${index === last ? ' (cauda sem quebra de linha)' : ''}`); return; }
          try { validateEvent(event); } catch (error) { avisos.push(`${where}: ${error.message}`); return; }
          if (event.tipo === 'legado.importado' && (!event.dados.legado || !event.dados.sourceHash)) { avisos.push(`${where}: evento legado.importado incompleto`); return; }
          eventos.push(event);
        });
      }
    }
  }
  await visit(path.join(dataRoot, 'events'), '');
  eventos.sort(byOrder);
  const seen = new Set();
  return { eventos: eventos.filter(event => !seen.has(event.id) && seen.add(event.id)), avisos };
}

// Grava vários eventos de uma vez (uma leitura do log, uma gravação por arquivo).
export async function appendEvents(dataRoot, events, { host = defaultHost(), now = new Date().toISOString(), lockTimeoutMs = 10000 } = {}) {
  if (!isHost(host)) throw new Error('Identificador de host inválido.');
  const stamp = typeof now === 'function' ? now : () => now;
  return withLock(path.join(dataRoot, 'state', 'events.lock'), { timeoutMs: lockTimeoutMs }, () => appendLocked(dataRoot, events, host, stamp));
}

async function appendLocked(dataRoot, events, host, stamp) {
  const { eventos } = await readEvents(dataRoot);
  const ids = new Set(eventos.map(event => event.id));
  let seq = eventos.filter(event => event.host === host).reduce((max, event) => Math.max(max, event.seq ?? 0), 0);
  const written = [];
  const pending = new Map();
  for (const input of events) {
    const event = { ...input, ts: input.ts ?? new Date(stamp()).toISOString(), host: input.host ?? host };
    event.seq = ++seq;
    validateEvent(event);
    if (ids.has(event.id)) { seq -= 1; continue; }
    ids.add(event.id);
    const file = path.join(dataRoot, 'events', ...localDay(event.ts).split('-').slice(0, 2), `${localDay(event.ts).slice(8)}.${event.host}.jsonl`);
    pending.set(file, [...(pending.get(file) ?? []), event]);
    written.push(event);
  }
  for (const [file, group] of pending) {
    await noLinks(file);
    await mkdir(path.dirname(file), { recursive: true });
    let prefix = '';
    try {
      const handle = await open(file, 'r');
      try {
        const { size } = await handle.stat();
        if (size > 0) {
          const tail = Buffer.alloc(1);
          await handle.read(tail, 0, 1, size - 1);
          if (tail[0] !== 0x0a) prefix = '\n';
        }
      } finally { await handle.close(); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await appendFile(file, prefix + group.map(event => `${JSON.stringify(event)}\n`).join(''));
  }
  return { appended: written.length > 0, events: written, skipped: events.length - written.length };
}

export async function appendEvent(dataRoot, event, options) {
  const result = await appendEvents(dataRoot, [event], options);
  return { appended: result.appended, event: result.events[0] ?? null };
}
