import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { noLinks } from '../core/migration/paths.mjs';

export const PUBLIC_TEMPLATE = fileURLToPath(new URL('./template.html', import.meta.url));

// Template privado em DATA_ROOT/templates (foto, nome e textos reais) tem preferência; sem ele, o público.
export async function resolveTemplate({ dataRoot } = {}) {
  if (dataRoot) {
    const privado = path.join(dataRoot, 'templates', 'painel-template.html');
    await noLinks(privado);
    try {
      return { origem: 'privado', arquivo: privado, html: await readFile(privado, 'utf8') };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { origem: 'publico', arquivo: PUBLIC_TEMPLATE, html: await readFile(PUBLIC_TEMPLATE, 'utf8') };
}
