// Cache que depende do snapshot da base: vale só enquanto o hash do snapshot for o mesmo.
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';

const PREFIXO = 'kb-dep-';
const arquivo = (dataRoot, nome) => {
  if (!/^[a-z][a-z0-9-]*$/.test(nome)) throw new Error(`Nome de cache inválido: ${nome}`);
  return path.join(dataRoot, 'cache', `${PREFIXO}${nome}.json`);
};

export async function gravarDependente(dataRoot, nome, hash, valor) {
  await atomicJson(arquivo(dataRoot, nome), { hash, valor });
}

// null quando não existe ou foi gravado para outro snapshot.
export async function lerDependente(dataRoot, nome, hash) {
  try {
    const dado = JSON.parse(await readFile(arquivo(dataRoot, nome), 'utf8'));
    return dado.hash === hash ? dado.valor : null;
  } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

// Apaga todos os caches dependentes e devolve os nomes (avaliações, CV, sugestões de marcas...).
export async function invalidarDependentes(dataRoot) {
  let nomes;
  try { nomes = await readdir(path.join(dataRoot, 'cache')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const apagados = [];
  for (const nome of nomes.filter(n => n.startsWith(PREFIXO) && n.endsWith('.json'))) {
    await unlink(path.join(dataRoot, 'cache', nome));
    apagados.push(nome.slice(PREFIXO.length, -'.json'.length));
  }
  return apagados.sort();
}
