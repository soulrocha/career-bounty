import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, tempDir } from './cli.mjs';

// Variáveis que mudam o comportamento da privacidade nunca vazam do ambiente do desenvolvedor para os testes.
export const ISOLATED_ENV = ['IDENTITY_FILE', 'DATA_ROOT'];

export function cleanEnv(extra = {}) {
  const base = { ...process.env };
  for (const name of ISOLATED_ENV) delete base[name];
  return { ...base, ...extra };
}

export function git(cwd, args, { env = {}, input } = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), input });
}

// Repositório temporário com os hooks do projeto ligados.
export async function tempRepo(t, { dataRoot } = {}) {
  const dir = await tempDir(t, 'cb-repo-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'teste@exemplo.test']);
  git(dir, ['config', 'user.name', 'Teste']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'core.hooksPath', path.join(repoRoot, '.githooks').replaceAll('\\', '/')]);
  return {
    dir,
    env: dataRoot ? { DATA_ROOT: dataRoot } : { DATA_ROOT: path.join(dir, '..', 'sem-dados-cb') },
    async write(name, content) {
      const file = path.join(dir, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
      git(dir, ['add', name]);
    },
    commit(message = 'teste') {
      return git(dir, ['commit', '-q', '-m', message], { env: this.env });
    },
  };
}
