import { mkdtemp, rm } from 'node:fs/promises';
import { execFile, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const cli = path.join(repoRoot, 'bin', 'career-bounty.mjs');

export async function tempDir(t, prefix = 'career-bounty-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export function run(args, { dataRoot, env = {}, cwd, input } = {}) {
  const base = { CAREER_BOUNTY_REPO_ROOT: tmpdir(), ...process.env, ...env };
  delete base.DATA_ROOT;
  delete base.IDENTITY_FILE;
  if (dataRoot) base.DATA_ROOT = dataRoot;
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: base, cwd, input });
  let json;
  try { json = JSON.parse(result.stdout); } catch { json = undefined; }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

// Versão assíncrona de run(): permite falar com um servidor HTTP falso que roda neste mesmo processo.
export function runAsync(args, { dataRoot, env = {}, cwd } = {}) {
  const base = { CAREER_BOUNTY_REPO_ROOT: tmpdir(), ...process.env, ...env };
  delete base.DATA_ROOT;
  delete base.IDENTITY_FILE;
  if (dataRoot) base.DATA_ROOT = dataRoot;
  return new Promise(resolve => {
    execFile(process.execPath, [cli, ...args], { encoding: 'utf8', env: base, cwd }, (error, stdout, stderr) => {
      let json;
      try { json = JSON.parse(stdout); } catch { json = undefined; }
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr, json });
    });
  });
}
