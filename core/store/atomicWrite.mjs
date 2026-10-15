import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks } from '../migration/paths.mjs';

// Escrita atômica: temporário no mesmo diretório, fsync e rename. Em falha, o destino anterior fica intacto
// e o temporário é removido. `beforeRename` existe para simular queda no teste.
export async function atomicWriteFile(filename, data, { beforeRename } = {}) {
  await noLinks(filename);
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally { await handle.close(); }
    await beforeRename?.(temporary);
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export const atomicJson = (filename, data, options) => atomicWriteFile(filename, `${JSON.stringify(data, null, 2)}\n`, options);
