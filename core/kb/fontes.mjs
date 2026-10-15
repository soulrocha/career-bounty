// Monta a lista de fontes de conhecimento a partir de DATA_ROOT. Nenhum caminho pessoal vive no repositório.
import path from 'node:path';
import { createMarkdownFolder } from './sources/markdownFolder.mjs';

export async function carregarFontes({ dataRoot } = {}) {
  const fontes = [{ nome: 'markdown-folder', fonte: createMarkdownFolder(path.join(dataRoot, 'kb')) }];
  return { fontes, avisos: [] };
}
