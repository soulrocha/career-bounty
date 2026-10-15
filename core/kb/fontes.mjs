// Monta a lista de fontes de conhecimento a partir de DATA_ROOT. Nenhum caminho pessoal vive no repositório:
// a raiz do vault vem de config.yml (vault_root) ou de fontes.yml, e o manifesto das notas vem só de fontes.yml.
// O endereço do ai-memory vem só de config.yml (ai_memory.url) e o token, de secrets/ai-memory.token.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSettings } from '../config.mjs';
import { noLinks, within } from '../migration/paths.mjs';
import { createAiMemory } from './sources/aiMemory.mjs';
import { createMarkdownFolder } from './sources/markdownFolder.mjs';
import { createObsidianVault } from './sources/obsidianVault.mjs';

const CHAVES = ['versao', 'markdown_folder', 'obsidian_vault', 'ai_memory'];

export async function lerManifesto(dataRoot) {
  const arquivo = path.join(dataRoot, 'fontes.yml');
  await noLinks(arquivo);
  let manifesto;
  try { manifesto = JSON.parse(await readFile(arquivo, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) throw new Error('fontes.yml deve conter JSON válido (subconjunto de YAML).');
    throw error;
  }
  if (!manifesto || typeof manifesto !== 'object' || Array.isArray(manifesto)) throw new Error('fontes.yml deve ser um objeto.');
  const extra = Object.keys(manifesto).find(chave => !CHAVES.includes(chave));
  if (extra) throw new Error(`fontes.yml: chave desconhecida "${extra}" (use ${CHAVES.join(', ')}).`);
  return manifesto;
}

// Pasta Markdown da base (padrão DATA_ROOT/kb): onde a entrevista grava claims.local.md depois da aprovação.
export async function raizMarkdown(dataRoot) {
  const pasta = (await lerManifesto(dataRoot)).markdown_folder?.raiz ?? 'kb';
  return path.isAbsolute(pasta) ? pasta : path.join(dataRoot, pasta);
}

export async function carregarFontes({ dataRoot, settings } = {}) {
  const manifesto = await lerManifesto(dataRoot);
  const config = settings ?? await loadSettings({ dataRoot });
  const fontes = [{ nome: 'markdown-folder', fonte: createMarkdownFolder(await raizMarkdown(dataRoot)) }];
  if (manifesto.obsidian_vault) {
    const raiz = manifesto.obsidian_vault.raiz ?? config.vault_root;
    if (!raiz) throw new Error('fontes.yml: obsidian_vault exige a raiz do vault (vault_root em config.yml ou raiz em fontes.yml).');
    if (!path.isAbsolute(raiz)) throw new Error('fontes.yml: a raiz do vault deve ser caminho absoluto.');
    if (within(raiz, dataRoot) || within(dataRoot, raiz)) throw new Error('fontes.yml: a raiz do vault não pode sobrepor o DATA_ROOT.');
    fontes.push({ nome: 'obsidian-vault', fonte: createObsidianVault({ raiz, manifesto: manifesto.obsidian_vault }) });
  }
  return { fontes, avisos: [] };
}

// ai-memory fica fora de lerBase: o que ele devolve é candidato, nunca afirmação.
export async function candidatosAiMemory({ dataRoot, settings, consulta, fetchImpl }) {
  const config = settings ?? await loadSettings({ dataRoot });
  if (!config.ai_memory?.url) return { ativo: false, disponivel: false, candidatos: [], mensagem: 'ai-memory não configurado (ai_memory.url em config.yml).' };
  const manifesto = (await lerManifesto(dataRoot)).ai_memory ?? {};
  const arquivoToken = path.join(dataRoot, 'secrets', 'ai-memory.token');
  await noLinks(arquivoToken);
  let token = null;
  try { token = (await readFile(arquivoToken, 'utf8')).trim() || null; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fonte = createAiMemory({ url: config.ai_memory.url, token, workspace: manifesto.workspace ?? null, project: manifesto.project ?? null, limite: manifesto.limite ?? 10, ...(fetchImpl ? { fetchImpl } : {}) });
  return { ativo: true, ...(await fonte.candidatos({ consulta })) };
}
