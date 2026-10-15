// Cursor da leitura de e-mail, em duas fases: lerCursor (antes) e confirmarCursor (só depois de o digest ser
// validado e processado). Guarda também os message_id vistos, para a sobreposição de 1 dia não duplicar efeito.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { isoDate } from '../store/rules.mjs';
import { localDay } from '../store/schema.mjs';

const arquivo = dataRoot => path.join(dataRoot, 'state', 'mail-cursor.json');
const MEMORIA_DIAS = 30;
const DIA = 86400000;

export async function lerCursor(dataRoot, { now = new Date() } = {}) {
  const vazio = (aviso) => ({ ate: null, vistos: new Set(), avisos: aviso ? [aviso] : [] });
  let bruto;
  try { bruto = JSON.parse(await readFile(arquivo(dataRoot), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return vazio();
    return vazio('cursor de e-mail corrompido: voltando à janela padrão');
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto) || !isoDate(bruto.ate)) return vazio('cursor de e-mail inválido: voltando à janela padrão');
  if (bruto.ate > localDay(now)) return vazio('cursor de e-mail no futuro: voltando à janela padrão');
  const vistos = bruto.vistos && typeof bruto.vistos === 'object' && !Array.isArray(bruto.vistos) ? Object.keys(bruto.vistos) : [];
  return { ate: bruto.ate, vistos: new Set(vistos), avisos: [] };
}

// Segunda fase: chamada só depois de os efeitos serem gravados. `itens` são os do digest validado.
// `ate` limita o avanço (consulta que bateu o limite de resultados): por padrão o cursor vai até hoje.
export async function confirmarCursor(dataRoot, { itens, now = new Date(), ate }) {
  const atual = await lerArquivoBruto(dataRoot);
  const limite = localDay(new Date(now.getTime() - MEMORIA_DIAS * DIA));
  const vistos = Object.fromEntries(Object.entries(atual).filter(([, dia]) => typeof dia === 'string' && dia >= limite));
  for (const item of itens) vistos[item.message_id] = item.data;
  const hoje = localDay(now);
  const destino = ate && ate < hoje ? ate : hoje;
  await atomicJson(arquivo(dataRoot), { ate: destino, atualizado_em: now.toISOString(), vistos });
  return { ate: destino, vistos: Object.keys(vistos).length };
}

async function lerArquivoBruto(dataRoot) {
  try { const bruto = JSON.parse(await readFile(arquivo(dataRoot), 'utf8')); return bruto?.vistos && typeof bruto.vistos === 'object' && !Array.isArray(bruto.vistos) ? bruto.vistos : {}; }
  catch { return {}; }
}

export function filtrarNovos(itens, vistos) {
  const novos = itens.filter(item => !vistos.has(item.message_id));
  return { novos, repetidos: itens.length - novos.length };
}

export const avisoDeLimite = ({ itens, limite }) => (itens >= limite ? `a consulta chegou ao limite de ${limite} resultados por rodada; pode haver mais e-mails (aumente mail.limite_resultados ou rode de novo)` : null);
