import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { privateDestination } from '../migration/paths.mjs';

export const SKELETON_DIRS = ['kb', 'events', 'state', 'projections', 'artifacts', 'cache', 'secrets', 'outbox', 'templates'];

export function resolveDataRoot({ env = process.env, home = homedir() } = {}) {
  const chosen = env.DATA_ROOT || path.join(home, '.career-bounty');
  return path.resolve(chosen);
}

// Cria as pastas esperadas e um config.yml vazio. Idempotente: nunca sobrescreve.
export async function ensureSkeleton(dataRoot) {
  await privateDestination(dataRoot);
  const created = [];
  for (const name of SKELETON_DIRS) {
    const dir = path.join(dataRoot, name);
    const first = await mkdir(dir, { recursive: true });
    if (first) created.push(name);
  }
  try {
    await writeFile(path.join(dataRoot, 'config.yml'), '{}\n', { flag: 'wx' });
    created.push('config.yml');
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return created;
}
