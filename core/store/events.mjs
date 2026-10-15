import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks } from '../migration/paths.mjs';

export async function atomicJson(filename, data) {
  await noLinks(filename);
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function readEvents(dataRoot) {
  await noLinks(path.join(dataRoot, 'events'));
  const events = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Link não permitido no log.');
      if (entry.isDirectory()) await visit(filename);
      else if (entry.name.endsWith('.jsonl')) {
        const text = await readFile(filename, 'utf8');
        if (text && !text.endsWith('\n')) throw new Error('Log de eventos truncado.');
        for (const line of text.split('\n').filter(Boolean)) {
          let event;
          try { event = JSON.parse(line); }
          catch { throw new Error('Linha JSON inválida no log de eventos.'); }
          if (event?.tipo !== 'legado.importado' || !event.dados?.legado || !event.dados?.sourceHash || typeof event.ts !== 'string' || !Number.isFinite(Date.parse(event.ts)) || typeof event.id !== 'string') {
            throw new Error('Evento incompatível no log de migração.');
          }
          events.push(event);
        }
      }
    }
  }
  await visit(path.join(dataRoot, 'events'));
  return events.sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
}

export function latestSnapshot(events) {
  return events.at(-1)?.dados.legado;
}
