import { chmod as fsChmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { privateDestination } from '../migration/paths.mjs';

export const SKELETON_DIRS = ['kb', 'events', 'state', 'projections', 'artifacts', 'cache', 'secrets', 'outbox', 'templates'];

// Modelo vazio: o setup nunca grava dado pessoal. A chave _instrucao é ignorada pelo scan.
const IDENTITY_TEMPLATE = JSON.stringify({
  _instrucao: 'Preencha com os seus dados reais (JSON). Este arquivo é a camada pessoal do pre-commit: bloqueia commits que contenham esses valores. Nunca versione este arquivo.',
  nome: '',
  email: '',
  telefone: '',
  documento: '',
}, null, 2) + String.fromCharCode(10);

export function resolveDataRoot({ env = process.env, home = homedir() } = {}) {
  const chosen = env.DATA_ROOT || path.join(home, '.career-bounty');
  return path.resolve(chosen);
}

// Cria as pastas esperadas e um config.yml vazio. Idempotente: nunca sobrescreve.
export async function ensureSkeleton(dataRoot, { chmod = fsChmod } = {}) {
  await privateDestination(dataRoot);
  const created = [];
  for (const name of SKELETON_DIRS) {
    const dir = path.join(dataRoot, name);
    const first = await mkdir(dir, { recursive: true, ...(name === 'secrets' ? { mode: 0o700 } : {}) });
    if (first) created.push(name);
    if (name === 'secrets') await chmod(dir, 0o700);
  }
  try {
    await writeFile(path.join(dataRoot, 'config.yml'), '{}\n', { flag: 'wx' });
    created.push('config.yml');
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  try {
    await writeFile(path.join(dataRoot, 'identity.yml'), IDENTITY_TEMPLATE, { flag: 'wx' });
    created.push('identity.yml');
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return created;
}
