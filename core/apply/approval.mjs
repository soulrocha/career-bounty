// Aprovação nominal do envio (F6.9, seam S9). O lote é proposto pela CLI com uma frase exata ("enviar estas N: A, B");
// só o hook UserPromptSubmit, com a mensagem digitada pela pessoa, transforma essa frase em aprovações. O modelo não
// consegue forjar a mensagem do usuário, então não consegue se autoaprovar. Cada aprovação vale para uma vaga, por pouco
// tempo, e é consumida no envio.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fold } from '../dedup/keys.mjs';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';

export const VALIDADE_APROVACAO_MIN = 120;
export const VALIDADE_LOTE_MIN = 60;
const arquivo = dataRoot => path.join(dataRoot, 'state', 'aprovacoes.json');
const trava = dataRoot => path.join(dataRoot, 'state', 'aprovacoes.lock');
const VAZIO = { versao: 1, lote: null, aprovacoes: [] };

export async function lerAprovacoes(dataRoot) {
  try { return { ...VAZIO, ...JSON.parse(await readFile(arquivo(dataRoot), 'utf8')) }; } catch (e) {
    if (e.code === 'ENOENT') return { ...VAZIO };
    throw new Error('Estado de aprovações ilegível.');
  }
}

const rotulo = v => `${v.empresa} (${v.cargo})`;
export const fraseDoLote = vagas => `enviar estas ${vagas.length}: ${vagas.map(rotulo).join(', ')}`;
const normalizar = texto => fold(String(texto ?? '')).replace(/[^a-z0-9:()]+/g, ' ').trim();

// Propõe o lote: guarda as vagas e a frase que a pessoa precisa digitar. Um lote novo substitui o anterior.
export async function proporLote(dataRoot, { vagas, ts = new Date().toISOString() }) {
  if (!vagas.length) throw new Error('Lote vazio.');
  return withLock(trava(dataRoot), {}, async () => {
    const estado = await lerAprovacoes(dataRoot);
    const lote = { frase: fraseDoLote(vagas), vagas: vagas.map(v => ({ vaga_id: v.vaga_id ?? v.id, chave: v.chave, empresa: v.empresa, cargo: v.cargo })), criado_em: ts };
    await atomicJson(arquivo(dataRoot), { ...estado, lote });
    return lote;
  });
}

// Chamado só pelo hook UserPromptSubmit, com o texto que a pessoa digitou. Devolve as vagas aprovadas (ou []).
export async function aprovarPorMensagem(dataRoot, { mensagem, ts = new Date().toISOString() }) {
  return withLock(trava(dataRoot), {}, async () => {
    const estado = await lerAprovacoes(dataRoot);
    const lote = estado.lote;
    if (!lote) return [];
    const vencido = Date.parse(ts) - Date.parse(lote.criado_em) > VALIDADE_LOTE_MIN * 60000;
    if (vencido || !normalizar(mensagem).includes(normalizar(lote.frase))) return [];
    const expira = new Date(Date.parse(ts) + VALIDADE_APROVACAO_MIN * 60000).toISOString();
    const novas = lote.vagas.map(v => ({ id: randomBytes(12).toString('hex'), vaga_id: v.vaga_id, chave: v.chave, emitida_em: ts, expira_em: expira, usada_em: null }));
    await atomicJson(arquivo(dataRoot), { ...estado, lote: null, aprovacoes: [...estado.aprovacoes.filter(a => Date.parse(a.expira_em) > Date.parse(ts) && !a.usada_em), ...novas] });
    return novas.map(a => a.vaga_id);
  });
}

export const aprovacaoValida = (estado, vagaId, ts) => estado.aprovacoes.find(a => a.vaga_id === vagaId && !a.usada_em && Date.parse(a.expira_em) > Date.parse(ts)) ?? null;

// Consome a aprovação da vaga (uso único). Devolve false quando não há aprovação válida.
export async function consumirAprovacao(dataRoot, { vagaId, ts = new Date().toISOString() }) {
  return withLock(trava(dataRoot), {}, async () => {
    const estado = await lerAprovacoes(dataRoot);
    const valida = aprovacaoValida(estado, vagaId, ts);
    if (!valida) return false;
    await atomicJson(arquivo(dataRoot), { ...estado, aprovacoes: estado.aprovacoes.map(a => (a.id === valida.id ? { ...a, usada_em: ts } : a)) });
    return true;
  });
}
