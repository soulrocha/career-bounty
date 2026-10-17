// Artefatos de CV versionados: DATA_ROOT/artifacts/cv/<vaga>/<hash>/ com payload, HTML, PDFs e gate, e um manifesto por vaga.
// Cada versão é identificada pelo hash do payload e nunca substitui outra. A versão anexada a uma candidatura enviada
// fica imutável (recusa de gravação e arquivos somente leitura); as demais podem ser regravadas com o mesmo hash.
import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, atomicWriteFile } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';

export const ARQUIVOS_CV = ['cv-visual.html', 'cv-visual.pdf', 'cv-ats.html', 'cv-ats.pdf'];
const ID_VAGA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const HASH = /^[0-9a-f]{64}$/;

function pastaDaVaga(dataRoot, vagaId) {
  if (!ID_VAGA.test(String(vagaId)) || String(vagaId).includes('..')) throw new Error(`id de vaga inválido para pasta de artefato: ${String(vagaId).slice(0, 60)}`);
  return path.join(dataRoot, 'artifacts', 'cv', vagaId);
}
const caminhoManifesto = (dataRoot, vagaId) => path.join(pastaDaVaga(dataRoot, vagaId), 'manifesto.json');
const relativo = (vagaId, hash, arquivo) => `artifacts/cv/${vagaId}/${hash}/${arquivo}`;

export async function lerManifesto(dataRoot, vagaId) {
  try { return JSON.parse(await readFile(caminhoManifesto(dataRoot, vagaId), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const existe = alvo => stat(alvo).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const travar = (dataRoot, vagaId, acao) => withLock(path.join(pastaDaVaga(dataRoot, vagaId), '.lock'), { busyMessage: 'Artefatos de CV desta vaga em uso; tente novamente.' }, acao);

// pacote: { vagaId, versao (sha256 do payload), tipo, payload, arquivos: { nome: conteúdo }, gate, ts }.
export async function gravarCv(dataRoot, { vagaId, versao, tipo, payload, arquivos, gate, ts }) {
  if (!HASH.test(String(versao))) throw new Error('versão do CV inválida: use o sha256 do payload');
  const raiz = pastaDaVaga(dataRoot, vagaId);
  await mkdir(raiz, { recursive: true });
  return travar(dataRoot, vagaId, async () => {
    const manifesto = (await lerManifesto(dataRoot, vagaId)) ?? { vaga_id: vagaId, versoes: [], enviado: null };
    if (manifesto.enviado?.hash === versao) throw new Error(`O CV ${versao.slice(0, 12)} foi enviado numa candidatura e é imutável.`);
    const pasta = path.join(raiz, versao);
    // Monta numa pasta temporária e troca de uma vez: quem lê nunca vê uma versão pela metade.
    const temporaria = `${pasta}.tmp-${process.pid}`;
    await rm(temporaria, { recursive: true, force: true });
    await mkdir(temporaria, { recursive: true });
    for (const nome of ARQUIVOS_CV) {
      if (arquivos[nome] === undefined) throw new Error(`arquivo de CV ausente: ${nome}`);
      await atomicWriteFile(path.join(temporaria, nome), arquivos[nome]);
    }
    await atomicJson(path.join(temporaria, 'payload.json'), payload);
    await atomicJson(path.join(temporaria, 'gate.json'), gate);
    // Regravação da mesma versão: a antiga sai para o lado, a nova entra e só então a antiga é apagada.
    const antiga = `${pasta}.old-${process.pid}`;
    const havia = await existe(pasta);
    if (havia) await rename(pasta, antiga);
    try { await rename(temporaria, pasta); } catch (error) { if (havia) await rename(antiga, pasta); throw error; }
    if (havia) await rm(antiga, { recursive: true, force: true });
    const entrada = { hash: versao, gerado_em: ts, tipo, gate: { status: gate.status, motivos: gate.motivos.map(m => m.motivo) } };
    manifesto.versoes = [...manifesto.versoes.filter(v => v.hash !== versao), entrada].sort((a, b) => a.gerado_em.localeCompare(b.gerado_em) || a.hash.localeCompare(b.hash));
    await atomicJson(caminhoManifesto(dataRoot, vagaId), manifesto);
    return { pasta, manifesto };
  });
}

// Liga a versão à candidatura enviada: daqui em diante ela não muda (manifesto recusa e arquivos ficam somente leitura).
export async function marcarEnviado(dataRoot, { vagaId, versao, ts }) {
  if (!(await lerManifesto(dataRoot, vagaId))) throw new Error(`A versão ${String(versao).slice(0, 12)} do CV não existe para ${vagaId}.`);
  return travar(dataRoot, vagaId, async () => {
    const manifesto = await lerManifesto(dataRoot, vagaId);
    if (!manifesto?.versoes.some(v => v.hash === versao)) throw new Error(`A versão ${String(versao).slice(0, 12)} do CV não existe para ${vagaId}.`);
    if (manifesto.enviado && manifesto.enviado.hash !== versao) throw new Error(`Já existe CV enviado para ${vagaId} (${manifesto.enviado.hash.slice(0, 12)}).`);
    const pasta = path.join(pastaDaVaga(dataRoot, vagaId), versao);
    for (const nome of [...ARQUIVOS_CV, 'payload.json', 'gate.json']) await chmod(path.join(pasta, nome), 0o444);
    manifesto.enviado = { hash: versao, registrado_em: ts };
    await atomicJson(caminhoManifesto(dataRoot, vagaId), manifesto);
    return manifesto;
  });
}

// Candidatura marcada no painel: congela o CV aprovado mais novo como enviado. Sem CV aprovado, ou já com enviado, nada muda.
// Devolve o hash congelado ou null.
export async function congelarCvEnviado(dataRoot, { vagaId, ts }) {
  let manifesto;
  try { manifesto = await lerManifesto(dataRoot, vagaId); } catch { return null; }
  const atual = cvDoPainel(manifesto)?.atual;
  if (!atual || manifesto.enviado) return manifesto?.enviado?.hash ?? null;
  await marcarEnviado(dataRoot, { vagaId, versao: atual.hash, ts });
  return atual.hash;
}

// Resultado de uma reavaliação vai para o manifesto (os arquivos da versão não mudam).
export async function atualizarGateNoManifesto(dataRoot, { vagaId, versao, gate }) {
  return travar(dataRoot, vagaId, async () => {
    const manifesto = await lerManifesto(dataRoot, vagaId);
    const entrada = manifesto?.versoes.find(v => v.hash === versao);
    if (!entrada) throw new Error(`A versão ${String(versao).slice(0, 12)} do CV não existe para ${vagaId}.`);
    entrada.gate = { status: gate.status, motivos: gate.motivos.map(m => m.motivo) };
    await atomicJson(caminhoManifesto(dataRoot, vagaId), manifesto);
    return manifesto;
  });
}

const links = (vagaId, versao) => ({ hash: versao.hash, gerado_em: versao.gerado_em, tipo: versao.tipo, ats: relativo(vagaId, versao.hash, 'cv-ats.pdf'), visual: relativo(vagaId, versao.hash, 'cv-visual.pdf') });

// O que o painel mostra: o CV aprovado mais novo, o enviado (se houver) e o motivo quando a versão mais nova está bloqueada.
export function cvDoPainel(manifesto) {
  if (!manifesto) return null;
  const aprovadas = manifesto.versoes.filter(v => v.gate.status === 'ok');
  const maisNova = manifesto.versoes.at(-1);
  const enviada = manifesto.enviado ? manifesto.versoes.find(v => v.hash === manifesto.enviado.hash) : null;
  return {
    atual: aprovadas.length ? links(manifesto.vaga_id, aprovadas.at(-1)) : null,
    enviado: enviada ? { ...links(manifesto.vaga_id, enviada), registrado_em: manifesto.enviado.registrado_em } : null,
    bloqueio: maisNova && maisNova.gate.status !== 'ok' ? { hash: maisNova.hash, motivos: maisNova.gate.motivos } : null,
  };
}

// Caminhos relativos ao DATA_ROOT que o servidor do painel pode entregar: só PDFs listados nos manifestos.
export function arquivosServiveis(manifesto) {
  if (!manifesto) return [];
  return manifesto.versoes.flatMap(v => ['cv-ats.pdf', 'cv-visual.pdf'].map(nome => relativo(manifesto.vaga_id, v.hash, nome)));
}
