// Acha o executável do Claude Code sem passar por shell: CLAUDE_BIN, PATH e as pastas do app desktop no Windows.
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

const existe = file => access(file).then(() => true, () => false);

async function subpastas(dir) {
  try { return (await readdir(dir, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => path.join(dir, item.name)); } catch { return []; }
}

export async function resolveClaudeBin({ env = process.env, platform = process.platform } = {}) {
  if (env.CLAUDE_BIN) {
    if (await existe(env.CLAUDE_BIN)) return env.CLAUDE_BIN;
    throw new Error('CLAUDE_BIN aponta para um arquivo que não existe.');
  }
  const nomes = platform === 'win32' ? ['claude.exe'] : ['claude'];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const nome of nomes) if (await existe(path.join(dir, nome))) return path.join(dir, nome);
  }
  if (platform === 'win32') {
    const raizes = [];
    if (env.APPDATA) raizes.push(path.join(env.APPDATA, 'Claude', 'claude-code'));
    if (env.LOCALAPPDATA) {
      for (const pacote of (await subpastas(path.join(env.LOCALAPPDATA, 'Packages'))).filter(dir => path.basename(dir).startsWith('Claude_'))) {
        raizes.push(path.join(pacote, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
      }
    }
    const achados = [];
    for (const raiz of raizes) for (const versao of await subpastas(raiz)) for (const hash of await subpastas(versao)) {
      const exe = path.join(hash, 'claude.exe');
      if (await existe(exe)) achados.push(exe);
    }
    if (achados.length) return achados.sort().at(-1);
  }
  throw new Error('Executável do claude não encontrado: defina CLAUDE_BIN ou ponha claude no PATH.');
}
