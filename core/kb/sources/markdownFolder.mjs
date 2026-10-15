import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, validateClaim } from '../schema.mjs';

async function markdownFiles(root, folder) {
  let names;
  try { names = await readdir(path.join(root, folder)); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const out = [];
  for (const name of names.filter(n => n.endsWith('.md')).sort()) {
    const arquivo = `${folder}/${name}`;
    out.push({ arquivo, ...parseFrontmatter(await readFile(path.join(root, arquivo), 'utf8')) });
  }
  return out;
}

// KnowledgeSource (seam S5) sobre uma pasta de Markdown.
export function createMarkdownFolder(root) {
  async function claims() {
    const seen = new Map();
    const out = [];
    for (const file of await markdownFiles(root, 'claims')) {
      validateClaim(file, file.arquivo);
      const { id, nivel_prova } = file.data;
      if (seen.has(id)) throw new Error(`${file.arquivo}: id ${id} duplicado (já usado em ${seen.get(id)}).`);
      seen.set(id, file.arquivo);
      out.push({ id, texto: file.body, nivel_prova, arquivo: file.arquivo, empresa: file.data.empresa ?? null });
    }
    return out;
  }

  async function evidence() {
    const known = new Set((await claims()).map(c => c.id));
    const out = [];
    for (const file of await markdownFiles(root, 'evidence')) {
      if (!file.data.id) throw new Error(`${file.arquivo}: frontmatter sem id.`);
      const afirmacoes = file.data.afirmacoes ?? [];
      for (const ref of afirmacoes) {
        if (!known.has(ref)) throw new Error(`${file.arquivo}: referencia a afirmação inexistente ${ref}.`);
      }
      out.push({ id: file.data.id, afirmacoes, fonte: file.data.fonte ?? null, texto: file.body, arquivo: file.arquivo });
    }
    return out;
  }

  // Devolve só o caminho do arquivo de identidade; o conteúdo nunca passa por aqui.
  async function identity() {
    const filename = path.join(root, 'identity.yml');
    try { await access(filename); return filename; } catch { return null; }
  }

  return { claims, evidence, identity };
}
