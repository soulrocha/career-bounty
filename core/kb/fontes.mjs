// Monta a lista de fontes de conhecimento a partir de DATA_ROOT. Nenhum caminho pessoal vive no repositório:
// a raiz do vault vem de config.yml (vault_root) ou de fontes.yml, e o manifesto das notas vem só de fontes.yml.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSettings } from '../config.mjs';
import { noLinks, within } from '../migration/paths.mjs';
import { createMarkdownFolder } from './sources/markdownFolder.mjs';
import { createObsidianVault } from './sources/obsidianVault.mjs';

const CHAVES = ['versao', 'markdown_folder', 'obsidian_vault'];

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

export async function carregarFontes({ dataRoot, settings } = {}) {
  const manifesto = await lerManifesto(dataRoot);
  const config = settings ?? await loadSettings({ dataRoot });
  const pasta = manifesto.markdown_folder?.raiz ?? 'kb';
  const raizKb = path.isAbsolute(pasta) ? pasta : path.join(dataRoot, pasta);
  const fontes = [{ nome: 'markdown-folder', fonte: createMarkdownFolder(raizKb) }];
  if (manifesto.obsidian_vault) {
    const raiz = manifesto.obsidian_vault.raiz ?? config.vault_root;
    if (!raiz) throw new Error('fontes.yml: obsidian_vault exige a raiz do vault (vault_root em config.yml ou raiz em fontes.yml).');
    if (!path.isAbsolute(raiz)) throw new Error('fontes.yml: a raiz do vault deve ser caminho absoluto.');
    if (within(raiz, dataRoot) || within(dataRoot, raiz)) throw new Error('fontes.yml: a raiz do vault não pode sobrepor o DATA_ROOT.');
    fontes.push({ nome: 'obsidian-vault', fonte: createObsidianVault({ raiz, manifesto: manifesto.obsidian_vault }) });
  }
  return { fontes, avisos: [] };
}
