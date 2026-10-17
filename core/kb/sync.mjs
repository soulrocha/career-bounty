// kb sync: lê as fontes, monta o snapshot da base e grava só dentro do DATA_ROOT.
// A identidade nunca entra no snapshot: vai para identity.yml local e os valores são redigidos de qualquer texto.
import { createHash } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { redact } from '../privacy/redact.mjs';
import { identityStrings } from '../privacy/scan.mjs';
import { lerBase } from './base.mjs';
import { invalidarDependentes } from './cache.mjs';

export const SNAPSHOT = 'state/kb-snapshot.json';

const ordenar = value => {
  if (Array.isArray(value)) return value.map(ordenar);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordenar(value[key])]));
  return value;
};

export const hashConteudo = conteudo => createHash('sha256').update(JSON.stringify(ordenar(conteudo))).digest('hex').slice(0, 16);

async function lerJson(arquivo) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); } catch { return null; }
}

const identidadeVazia = dado => !dado || identityStrings(dado).length === 0;

export async function lerSnapshot(dataRoot) {
  return lerJson(path.join(dataRoot, SNAPSHOT));
}

export async function syncKb({ dataRoot, fontes }) {
  const anterior = await lerSnapshot(dataRoot);
  const base = await lerBase(fontes).catch(error => { throw new Error(`kb sync: fonte ilegível (${error.message}). Snapshot anterior preservado.`); });

  // Identidade: copia para o arquivo local se ele ainda estiver vazio; os valores servem só para redigir.
  const local = path.join(dataRoot, 'identity.yml');
  const daFonte = base.identityPath ? await lerJson(base.identityPath) : null;
  let identidadeCopiada = false;
  if (base.identityPath && daFonte && identidadeVazia(await lerJson(local)) && path.resolve(base.identityPath) !== path.resolve(local)) {
    await copyFile(base.identityPath, local);
    identidadeCopiada = true;
  }
  const valores = [...new Set([...identityStrings(daFonte ?? []), ...identityStrings((await lerJson(local)) ?? [])])];

  const bruto = { versao: 1, afirmacoes: base.claims, evidencias: base.evidence, historias: base.historias, arcos: base.arcos, modelos_cv: base.cvTemplates, preferencias: base.preferencias };
  const conteudo = redact(bruto, valores).valor;
  const hash = hashConteudo(conteudo);
  const mudou = anterior?.hash !== hash;
  await atomicJson(path.join(dataRoot, SNAPSHOT), { hash, ...conteudo, avisos: base.avisos });
  const invalidou = mudou && anterior ? await invalidarDependentes(dataRoot) : [];
  return {
    hash, anterior: anterior?.hash ?? null, mudou, invalidou, identidade_copiada: identidadeCopiada, avisos: base.avisos,
    contagem: { afirmacoes: base.claims.length, evidencias: base.evidence.length, historias: base.historias.length, arcos: base.arcos.length, modelos_cv: base.cvTemplates.length },
  };
}
