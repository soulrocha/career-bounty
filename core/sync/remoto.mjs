// Lado do servidor da sincronização (`career-bounty sync-remote <op> --raiz <pasta>`), chamado pelo ssh.
// manifest: hash de cada arquivo. get: devolve os arquivos pedidos em quadros. put: grava cada quadro só se o
// hash recebido confere e o arquivo atual ainda tem o hash esperado (compare-and-swap). del: move para a lixeira
// só se o hash ainda é o esperado. put e del correm sob um lock, então dois PCs não se atropelam.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';
import { noLinks, privateDestination } from '../migration/paths.mjs';
import { absoluto, carimboDe, hashAtual, manifesto, paraLixeira, PASTA_SYNC, sha256, snapshotDe } from './arquivos.mjs';
import { escreverFim, escreverQuadro, lerQuadros } from './quadros.mjs';
import { sincronizavel } from './regras.mjs';

const aceito = rel => sincronizavel(rel, { snapshotRoot: '*' });

async function prepararRaiz(raiz) {
  process.umask(0o077); // a base central guarda dado pessoal: tudo que o servidor cria fica só para o dono
  if (typeof raiz !== 'string' || !path.isAbsolute(raiz)) throw new Error('sync-remote exige --raiz com caminho absoluto.');
  await privateDestination(raiz);
  await mkdir(path.join(raiz, PASTA_SYNC), { recursive: true, mode: 0o700 });
  return path.resolve(raiz);
}

const comLock = (raiz, acao) => withLock(path.join(raiz, PASTA_SYNC, 'servidor.lock'), { timeoutMs: 60000, busyMessage: 'Servidor de sincronização ocupado.' }, acao);

export async function remotoManifest({ raiz }) {
  raiz = await prepararRaiz(raiz);
  const arquivos = await manifesto(raiz, { snapshotRoot: '*' });
  return { snapshotRoot: await snapshotDe(raiz), arquivos: Object.fromEntries(arquivos) };
}

export async function remotoGet({ raiz, entrada, saida }) {
  raiz = await prepararRaiz(raiz);
  const { paths } = JSON.parse(entrada);
  if (!Array.isArray(paths)) throw new Error('get exige { paths: [...] }.');
  for (const rel of paths) {
    if (!aceito(rel)) { await escreverQuadro(saida, { path: rel, erro: 'recusado' }, Buffer.alloc(0)); continue; }
    let bytes;
    try { await noLinks(absoluto(raiz, rel)); } catch { await escreverQuadro(saida, { path: rel, erro: 'recusado' }, Buffer.alloc(0)); continue; }
    try { bytes = await readFile(absoluto(raiz, rel)); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error; await escreverQuadro(saida, { path: rel, erro: 'ausente' }, Buffer.alloc(0)); continue; }
    await escreverQuadro(saida, { path: rel, sha256: sha256(bytes) }, bytes);
  }
  await escreverFim(saida);
}

export async function remotoPut({ raiz, entrada }) {
  raiz = await prepararRaiz(raiz);
  const resultados = [];
  await comLock(raiz, async () => {
    for await (const quadro of lerQuadros(entrada)) {
      const { path: rel, esperado = null } = quadro;
      if (!aceito(rel)) { resultados.push({ path: rel, ok: false, motivo: 'recusado' }); continue; }
      if (sha256(quadro.bytes) !== quadro.sha256) { resultados.push({ path: rel, ok: false, motivo: 'hash_divergente' }); continue; }
      const atual = await hashAtual(absoluto(raiz, rel));
      if (atual === quadro.sha256) { resultados.push({ path: rel, ok: true }); continue; }
      if (atual !== esperado) { resultados.push({ path: rel, ok: false, motivo: 'mudou_no_servidor' }); continue; }
      await atomicWriteFile(absoluto(raiz, rel), quadro.bytes);
      resultados.push({ path: rel, ok: true });
    }
  });
  return { resultados };
}

export async function remotoDel({ raiz, entrada, agora = new Date() }) {
  raiz = await prepararRaiz(raiz);
  const { itens } = JSON.parse(entrada);
  if (!Array.isArray(itens)) throw new Error('del exige { itens: [...] }.');
  const carimbo = carimboDe(agora);
  const resultados = [];
  await comLock(raiz, async () => {
    for (const { path: rel, esperado } of itens) {
      if (!aceito(rel)) { resultados.push({ path: rel, ok: false, motivo: 'recusado' }); continue; }
      const atual = await hashAtual(absoluto(raiz, rel));
      if (atual === null) { resultados.push({ path: rel, ok: true }); continue; }
      if (atual !== esperado) { resultados.push({ path: rel, ok: false, motivo: 'mudou_no_servidor' }); continue; }
      await paraLixeira(raiz, rel, carimbo);
      resultados.push({ path: rel, ok: true });
    }
  });
  return { resultados };
}
