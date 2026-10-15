// Saída de propostas: tudo que seria escrita fora da base (Vault, CV) vira rascunho em DATA_ROOT/outbox/<area>/.
// Nada daqui toca o Vault nem a base; o caminho é sempre relativo ao outbox e sem "..".
import path from 'node:path';
import { atomicWriteFile } from '../store/atomicWrite.mjs';

const AREA = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/;
const NOME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function caminhoOutbox(dataRoot, area, nome) {
  if (!AREA.test(area)) throw new Error(`Área de outbox inválida: ${area}`);
  if (!NOME.test(nome) || nome.includes('..')) throw new Error(`Nome de arquivo de outbox inválido: ${nome}`);
  return path.join(dataRoot, 'outbox', ...area.split('/'), nome);
}

export async function gravarProposta(dataRoot, area, nome, conteudo) {
  const arquivo = caminhoOutbox(dataRoot, area, nome);
  await atomicWriteFile(arquivo, conteudo);
  return arquivo;
}

export const slug = texto => String(texto).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
