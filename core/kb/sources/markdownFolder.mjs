import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { montarAfirmacao, parseBlocks, parseFrontmatter, validateClaim } from '../schema.mjs';

const DOTDOT = /\.\./;
const safeField = (arquivo, campo, valor) => {
  if (typeof valor === 'string' && DOTDOT.test(valor)) throw new Error(`${arquivo}: ${campo} não pode conter "..".`);
};

async function filesOf(root, folder, extensoes) {
  let names;
  try { names = await readdir(path.join(root, folder)); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  return names.filter(n => extensoes.includes(path.extname(n))).sort().map(name => ({ arquivo: `${folder}/${name}`, name }));
}

async function markdownFiles(root, folder) {
  const out = [];
  for (const { arquivo } of await filesOf(root, folder, ['.md'])) out.push({ arquivo, ...parseFrontmatter(await readFile(path.join(root, arquivo), 'utf8')) });
  return out;
}

// Afirmações confirmadas na entrevista: um arquivo só, com vários blocos de frontmatter.
async function localClaims(root) {
  let text;
  try { text = await readFile(path.join(root, 'claims.local.md'), 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  try { return parseBlocks(text).map(bloco => ({ arquivo: 'claims.local.md', ...bloco })); }
  catch (error) { throw new Error(`claims.local.md: ${error.message}.`); }
}

// KnowledgeSource (seam S5) sobre uma pasta de Markdown.
export function createMarkdownFolder(root) {
  async function claims() {
    const seen = new Map();
    const out = [];
    for (const file of [...await markdownFiles(root, 'claims'), ...await localClaims(root)]) {
      validateClaim(file, file.arquivo);
      const { id } = file.data;
      safeField(file.arquivo, 'id', id);
      if (seen.has(id)) throw new Error(`${file.arquivo}: id ${id} duplicado (já usado em ${seen.get(id)}).`);
      seen.set(id, file.arquivo);
      out.push(montarAfirmacao(file, file.arquivo));
    }
    return out;
  }

  async function evidence() {
    const known = new Set((await claims()).map(c => c.id));
    const out = [];
    const seen = new Map();
    for (const file of await markdownFiles(root, 'evidence')) {
      if (!file.data.id) throw new Error(`${file.arquivo}: frontmatter sem id.`);
      safeField(file.arquivo, 'id', file.data.id);
      safeField(file.arquivo, 'fonte', file.data.fonte);
      if (seen.has(file.data.id)) throw new Error(`${file.arquivo}: id ${file.data.id} duplicado (já usado em ${seen.get(file.data.id)}).`);
      seen.set(file.data.id, file.arquivo);
      const afirmacoes = file.data.afirmacoes ?? [];
      if (!Array.isArray(afirmacoes)) throw new Error(`${file.arquivo}: afirmacoes deve ser uma lista, como [AF-001, AF-002].`);
      for (const ref of afirmacoes) {
        if (!known.has(ref)) throw new Error(`${file.arquivo}: referencia a afirmação inexistente ${ref}.`);
      }
      out.push({ id: file.data.id, afirmacoes, fonte: file.data.fonte ?? null, linha_base: file.data.linha_base ?? null, texto: file.body, arquivo: file.arquivo });
    }
    return out;
  }

  // Histórias do banco de histórias; cada uma aponta as afirmações que a sustentam.
  async function stories() {
    const out = [];
    for (const file of await markdownFiles(root, 'story-bank')) {
      if (!file.data.id) throw new Error(`${file.arquivo}: frontmatter sem id.`);
      safeField(file.arquivo, 'id', file.data.id);
      const afirmacoes = file.data.afirmacoes ?? [];
      if (!Array.isArray(afirmacoes)) throw new Error(`${file.arquivo}: afirmacoes deve ser uma lista, como [AF-001, AF-002].`);
      out.push({ id: file.data.id, afirmacoes, titulo: /^#\s+(.+)$/m.exec(file.body)?.[1].trim() ?? null, texto: file.body, arquivo: file.arquivo });
    }
    return out;
  }

  // Modelos de CV em texto: cv/<modelo>.md|txt|html. O texto bruto segue para a extração de itens.
  async function cvTemplates() {
    const out = [];
    for (const { arquivo, name } of await filesOf(root, 'cv', ['.md', '.txt', '.html'])) {
      out.push({ modelo: path.basename(name, path.extname(name)), formato: path.extname(name).slice(1), texto: await readFile(path.join(root, arquivo), 'utf8'), arquivo });
    }
    return out;
  }

  // Preferências: só os campos de alvo do perfil e o texto; o nome e os contatos ficam na identidade.
  async function preferences() {
    const files = await markdownFiles(root, 'profile');
    const alvo = files.map(f => f.data.cargo_alvo).find(Boolean) ?? null;
    const alvos = files.flatMap(f => (Array.isArray(f.data.cargos_alvo) ? f.data.cargos_alvo : []));
    return { cargo_alvo: alvo, cargos_alvo: [...new Set(alvos)], texto: files.map(f => f.body).filter(Boolean).join('\n\n') };
  }

  // Devolve só o caminho do arquivo de identidade; o conteúdo nunca passa por aqui.
  async function identity() {
    const filename = path.join(root, 'identity.yml');
    try { await access(filename); return filename; } catch { return null; }
  }

  return { claims, evidence, stories, cvTemplates, preferences, identity };
}
