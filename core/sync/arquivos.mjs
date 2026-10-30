// Manifesto (caminho relativo -> sha256) de uma raiz, com cache por tamanho e mtime para não refazer o hash de
// tudo a cada rodada, e a lixeira usada no lugar de apagar.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { sincronizavel } from './regras.mjs';

export const PASTA_SYNC = '.sync';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const absoluto = (raiz, rel) => path.join(raiz, ...rel.split('/'));

export async function lerJson(arquivo, padrao) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return padrao; throw error; }
}

export async function snapshotDe(raiz) {
  const estado = await lerJson(path.join(raiz, 'state', 'migration.json'), null);
  return typeof estado?.snapshotRoot === 'string' && /^backups\/[\w-][\w.-]*$/.test(estado.snapshotRoot) ? estado.snapshotRoot : null;
}

// Hash atual do arquivo, sem cache (para o compare-and-swap). null se não existe.
export async function hashAtual(arquivo) {
  try {
    const info = await lstat(arquivo);
    if (!info.isFile()) return undefined;
    return sha256(await readFile(arquivo));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Percorre a raiz sem seguir links e sem descer em pasta que nenhuma regra aceitaria.
async function percorrer(raiz, rel, incluir, saida) {
  let itens;
  try { itens = await readdir(rel ? absoluto(raiz, rel) : raiz, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const item of itens) {
    const filho = rel ? `${rel}/${item.name}` : item.name;
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) {
      if (item.name.startsWith('.')) continue;
      await percorrer(raiz, filho, incluir, saida);
    } else if (item.isFile() && incluir(filho)) saida.push(filho);
  }
}

// snapshots: lista de snapshots aceitos (o local e o do servidor podem diferir); snapshotRoot: um só, ou "*".
export async function manifesto(raiz, { snapshotRoot = null, snapshots = [snapshotRoot] }) {
  const arquivoCache = path.join(raiz, PASTA_SYNC, 'cache.json');
  const cache = (await lerJson(arquivoCache, {})).arquivos ?? {};
  const novoCache = {};
  const caminhos = [];
  await percorrer(raiz, '', rel => snapshots.some(snapshot => sincronizavel(rel, { snapshotRoot: snapshot })), caminhos);
  // Arquivo que não dá para ler agora (aberto por outro programa, antivírus) vai para `ilegiveis`: quem chama não
  // pode tratá-lo como apagado.
  const resultado = new Map();
  resultado.ilegiveis = new Map();
  for (const rel of caminhos) {
    let info;
    try { info = await lstat(absoluto(raiz, rel)); } catch (error) { if (error.code === 'ENOENT') continue; resultado.ilegiveis.set(rel, error.code ?? 'erro'); continue; }
    const anterior = cache[rel];
    // ctime muda em toda escrita (e em utimes), então pega a troca de conteúdo que preserva tamanho e mtime.
    const mesmo = anterior && anterior.size === info.size && anterior.mtimeMs === info.mtimeMs && anterior.ctimeMs === info.ctimeMs && anterior.ino === info.ino;
    let hash;
    try { hash = mesmo ? anterior.sha256 : await hashAtual(absoluto(raiz, rel)); }
    catch (error) { resultado.ilegiveis.set(rel, error.code ?? 'erro'); continue; }
    if (typeof hash !== 'string') continue;
    novoCache[rel] = { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino, sha256: hash };
    resultado.set(rel, hash);
  }
  await atomicJson(arquivoCache, { versao: 1, arquivos: novoCache });
  return resultado;
}

// "Apagar" move para .sync/lixeira/<carimbo>/<caminho>: nada some de verdade por causa de uma sincronização.
export async function paraLixeira(raiz, rel, carimbo) {
  const destino = absoluto(path.join(raiz, PASTA_SYNC, 'lixeira', carimbo), rel);
  await mkdir(path.dirname(destino), { recursive: true });
  await rename(absoluto(raiz, rel), destino);
}

// Cópias de conflito ainda em disco (o aviso dura até a pessoa resolver e apagar a cópia). Devolve os caminhos originais.
export async function conflitosPendentes(raiz) {
  const copias = [];
  await percorrer(raiz, '', rel => rel.includes('.conflito-') && !['projections', 'cache', 'logs', 'secrets', 'backups'].includes(rel.split('/')[0]), copias);
  return [...new Set(copias.map(rel => rel.replace(/\.conflito-[^/]*$/, '')))].sort();
}

export const carimboDe = data => data.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
