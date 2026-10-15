import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContext } from './scan.mjs';
import { loadConfig } from '../config.mjs';
import { resolveDataRoot } from '../store/dataRoot.mjs';

async function readOptional(filename) {
  try { return await readFile(filename, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function loadPrivacyContext({ env = process.env } = {}) {
  const dataRoot = resolveDataRoot({ env });
  const identityFile = env.IDENTITY_FILE || path.join(dataRoot, 'identity.yml');
  const identityText = await readOptional(identityFile);
  let identity = null;
  if (identityText !== null) {
    try { identity = JSON.parse(identityText); } catch { throw new Error('identity.yml deve conter JSON válido (subconjunto de YAML).'); }
  }
  const denylistText = await readOptional(path.join(dataRoot, 'privacy', 'denylist.txt'));
  const denylist = denylistText ? denylistText.split(/\r?\n/).filter(Boolean) : [];
  return { ...buildContext({ identity, denylist }), warnings: identity === null ? ['aviso: identity.yml ausente; rodando só as regras genéricas.'] : [] };
}

export async function buildDenylist() {
  const config = await loadConfig();
  const pipeline = JSON.parse(await readFile(config.careerRoot + path.sep + 'pipeline-vagas.json', 'utf8'));
  const names = [...new Set((pipeline.vagas ?? []).map(v => v?.empresa).filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))].sort();
  const dir = path.join(config.dataRoot, 'privacy');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'denylist.txt'), names.join('\n') + '\n');
  return { entries: names.length };
}
