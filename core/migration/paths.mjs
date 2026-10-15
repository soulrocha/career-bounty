import { lstat } from 'node:fs/promises';
import path from 'node:path';

export function within(filename, root) {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function noLinks(filename) {
  let current = path.resolve(filename);
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Link simbólico ou junction não permitido no caminho.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export async function privateDestination(destination, sources = []) {
  await noLinks(destination);
  for (const source of sources.filter(Boolean)) {
    if (within(destination, source) || within(source, destination)) throw new Error('DATA_ROOT/destino não pode sobrepor a origem.');
  }
  let directory = path.resolve(destination);
  while (true) {
    try {
      await lstat(path.join(directory, '.git'));
      throw new Error('DATA_ROOT/destino deve ficar fora de repositórios.');
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
