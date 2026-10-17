// Fila de reabertura da fase B: e-mails que precisavam ser abertos mas ficaram de fora pelo limite da rodada.
// Ficam fora do cursor (já foram vistos), então esta fila é a única forma de eles voltarem. Reabrem antes dos novos.
// Guarda só os campos do digest já sanitizados (nunca o corpo). Itens com mais de 30 dias saem da fila.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { localDay } from '../store/schema.mjs';
import { sanitizarCampo } from './sanitize.mjs';

const arquivo = dataRoot => path.join(dataRoot, 'state', 'mail-reabertura.json');
const MEMORIA_DIAS = 30;
const DIA = 86400000;
const CAMPOS = ['message_id', 'data', 'remetente_nome', 'remetente_dominio', 'assunto', 'trecho'];

export async function lerFilaReabertura(dataRoot, { now = new Date() } = {}) {
  let bruto;
  try { bruto = JSON.parse(await readFile(arquivo(dataRoot), 'utf8')); } catch { return []; }
  const limite = localDay(new Date(now.getTime() - MEMORIA_DIAS * DIA));
  const itens = Array.isArray(bruto?.itens) ? bruto.itens : [];
  return itens.filter(item => item && typeof item.message_id === 'string' && typeof item.data === 'string' && item.data >= limite)
    .map(item => Object.fromEntries(CAMPOS.map(campo => [campo, item[campo] ?? ''])));
}

export async function gravarFilaReabertura(dataRoot, itens, { now = new Date(), extras = [] } = {}) {
  const limpos = itens.map(item => ({ ...Object.fromEntries(CAMPOS.map(campo => [campo, item[campo] ?? ''])),
    assunto: sanitizarCampo(item.assunto, 300, { extras }), trecho: sanitizarCampo(item.trecho, 300, { extras }) }));
  await atomicJson(arquivo(dataRoot), { atualizado_em: now.toISOString(), itens: limpos });
  return limpos.length;
}
