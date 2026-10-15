import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, tempDir } from './cli.mjs';

export function git(cwd, args, { env = {}, input } = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, input });
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
