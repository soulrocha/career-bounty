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
import { localDay } from '../store/schema.mjs';

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
    const lote = {
      frase: fraseDoLote(vagas),
      vagas: vagas.map(v => ({
        vaga_id: v.vaga_id ?? v.id,
        chave: v.chave,
        empresa: v.empresa,
        cargo: v.cargo,
        rota: v.rota ?? null,
        hash_pdf: v.hash_pdf ?? null,
        hash_respostas: v.hash_respostas ?? null
      })),
      criado_em: ts
    };
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
    // A mensagem inteira tem de ser a frase (pontuação e espaço nas pontas tolerados): "NÃO quero enviar estas 2: ..." ou
    // "enviar estas 2: ... cancele tudo" não aprovam.
    if (vencido || normalizar(mensagem) !== normalizar(lote.frase)) return [];
    const expira = new Date(Date.parse(ts) + VALIDADE_APROVACAO_MIN * 60000).toISOString();
    const novas = lote.vagas.map(v => ({
      id: randomBytes(12).toString('hex'),
      vaga_id: v.vaga_id,
      chave: v.chave,
      rota: v.rota ?? null,
      origem: 'humano',
      hash_pdf: v.hash_pdf ?? null,
      hash_respostas: v.hash_respostas ?? null,
      emitida_em: ts,
      expira_em: expira,
      usada_em: null
    }));
    await atomicJson(arquivo(dataRoot), { ...estado, lote: null, aprovacoes: [...estado.aprovacoes.filter(a => Date.parse(a.expira_em) > Date.parse(ts) && !a.usada_em), ...novas] });
    return novas.map(a => a.vaga_id);
  });
}

// Emite aprovação pela decisão da política do driver (F7.9, F7.2). Só pode ser consumida pelo processo do driver.
export async function emitirAprovacaoPolitica(dataRoot, { vagaId, chave = null, hashPdf = null, hashRespostas = null, ts = new Date().toISOString(), validadeMin = 30 }) {
  return withLock(trava(dataRoot), {}, async () => {
    const estado = await lerAprovacoes(dataRoot);
    const expira = new Date(Date.parse(ts) + validadeMin * 60000).toISOString();
    const nova = {
      id: randomBytes(12).toString('hex'),
      vaga_id: vagaId,
      chave,
      rota: 'driver',
      origem: 'politica',
      hash_pdf: hashPdf ?? null,
      hash_respostas: hashRespostas ?? null,
      emitida_em: ts,
      expira_em: expira,
      usada_em: null
    };
    await atomicJson(arquivo(dataRoot), {
      ...estado,
      aprovacoes: [...estado.aprovacoes.filter(a => Date.parse(a.expira_em) > Date.parse(ts) && !a.usada_em), nova]
    });
    return nova;
  });
}

export const aprovacaoValida = (estado, vagaId, ts, origem = null) => estado.aprovacoes.find(a => a.vaga_id === vagaId && !a.usada_em && Date.parse(a.expira_em) > Date.parse(ts) && (origem === null || a.origem === origem)) ?? null;

// Envios da Gupy consumidos no dia civil de São Paulo (trava de segurança gupy.max_por_dia). Conta o consumo da aprovação,
// não o desfecho: tentativa incerta ou com falha também ocupa a vaga do dia (conservador, nunca devolve automaticamente).
export const consumosGupyNoDia = (estado, ts) => (estado.consumos ?? []).filter(c => c.rota === 'gupy' && c.dia === localDay(ts)).length;

// Consome a aprovação da vaga (uso único), sob o mesmo lock da emissão. Devolve { ok, motivo }.
export async function consumirAprovacao(dataRoot, { vagaId, ts = new Date().toISOString(), limiteGupy = 5, aceiteGupy = false, contexto = 'humano', hashPdf = null, hashRespostas = null }) {
  return withLock(trava(dataRoot), {}, async () => {
    const estado = await lerAprovacoes(dataRoot);
    // Prefere a aprovação da origem certa para o contexto: uma da política pendente não bloqueia a humana (nem o inverso).
    const valida = aprovacaoValida(estado, vagaId, ts, contexto === 'driver' ? 'politica' : 'humano') ?? aprovacaoValida(estado, vagaId, ts);
    if (!valida) return { ok: false, motivo: 'aprovação já usada ou vencida' };
    if (valida.origem === 'politica' && contexto !== 'driver') {
      return { ok: false, motivo: 'aprovação emitida pela política só vale para o processo do driver' };
    }
    if (valida.origem === 'humano' && contexto === 'driver') {
      return { ok: false, motivo: 'aprovação emitida por humano não pode ser consumida pelo driver automático' };
    }
    // Aprovação da política é estrita: hash ausente na chamada nega. A humana segue tolerante (o hook não tem o hash).
    const estrito = valida.origem === 'politica';
    if (valida.hash_pdf && (estrito || hashPdf) && valida.hash_pdf !== hashPdf) {
      return { ok: false, motivo: 'hash do PDF divergente da aprovação' };
    }
    if (valida.hash_respostas && (estrito || hashRespostas) && valida.hash_respostas !== hashRespostas) {
      return { ok: false, motivo: 'hash das respostas divergente da aprovação' };
    }
    // Aprovação sem rota (emitida antes da trava da Gupy) não é contável: refaça o lote.
    if (valida.rota === undefined) return { ok: false, motivo: 'aprovação antiga sem rota: monte o lote de novo' };
    if (valida.rota === 'gupy' && !aceiteGupy) return { ok: false, motivo: 'rota Gupy desligada (gupy.aceite_termos): envio negado' };
    if (valida.rota === 'gupy' && consumosGupyNoDia(estado, ts) >= limiteGupy) return { ok: false, motivo: `limite diário da Gupy atingido (${limiteGupy} por dia, gupy.max_por_dia)` };
    const semana = Date.parse(ts) - 7 * 24 * 3600000;
    const consumos = [...(estado.consumos ?? []).filter(c => Date.parse(c.ts) > semana), { vaga_id: vagaId, rota: valida.rota ?? null, dia: localDay(ts), ts }];
    await atomicJson(arquivo(dataRoot), { ...estado, consumos, aprovacoes: estado.aprovacoes.map(a => (a.id === valida.id ? { ...a, usada_em: ts } : a)) });
    return { ok: true, motivo: null, aprovacao: valida };
  });
}
