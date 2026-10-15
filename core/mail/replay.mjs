// Replay de 30 dias e métricas de concordância (F3.13): regras + classificador simulado contra rótulos.
// Meta: ≥ 95% de concordância geral e ≥ 90% por regra. O LLM real nunca roda aqui.
import { processarItens } from './process.mjs';
import { relatorioPorRegra } from './rules.mjs';
import { fold } from '../dedup/keys.mjs';

export const LIMIARES = { geral: 0.95, por_regra: 0.9 };

// Estand-in determinístico do Haiku para o replay: reconhece, no corpo aberto, formulações que as regras não cobrem.
export async function classificadorSimulado(lote) {
  const mapa = new Map();
  for (const item of lote) {
    const t = fold(item.corpo);
    if (/continuara com candidatos|nao seguiremos|guardaremos seu curriculo|encerramos (a sua|sua) participacao/.test(t)) mapa.set(item.message_id, { classe: 'negativa', confianca: 'alta', origem: 'llm', motivo: 'simulado' });
    else if (/agendad[oa]|convite para (uma )?conversa/.test(t)) mapa.set(item.message_id, { classe: 'entrevista_agendada', confianca: 'media', origem: 'llm', motivo: 'simulado' });
    else mapa.set(item.message_id, { classe: 'pendente', confianca: 'baixa', origem: 'pendente', motivo: 'simulado: texto vago' });
  }
  return mapa;
}

// previsoes: [{ esperado, obtido }]. Concordância geral = acertos / total.
export function calcularConcordancia(previsoes) {
  const acertos = previsoes.filter(p => p.esperado === p.obtido).length;
  return { total: previsoes.length, acertos, concordancia: previsoes.length ? Math.round((acertos / previsoes.length) * 10000) / 10000 : null };
}

export function avaliarLimiares({ geral, por_regra }, limiares = LIMIARES) {
  const falhas = [];
  if (geral.concordancia === null || geral.concordancia < limiares.geral) falhas.push(`concordância geral ${geral.concordancia ?? 'n/d'} abaixo de ${limiares.geral}`);
  for (const regra of por_regra) if (regra.precisao < limiares.por_regra) falhas.push(`regra ${regra.regra}: precisão ${regra.precisao} abaixo de ${limiares.por_regra}`);
  return { ok: falhas.length === 0, falhas };
}

const URL_NO_TEXTO = /https?:\/\/|www\./i;

// itens: [{ message_id, data, remetente_*, assunto, trecho, corpo?, classe_esperada, ambiguo? }]
export async function replayItens({ itens, vagas = [], config = {}, limiteFaseB = 50, now = new Date(), dias, classificarLlm = classificadorSimulado }) {
  const corte = dias ? new Date(now.getTime() - dias * 86400000).toISOString().slice(0, 10) : null;
  const dentro = itens.filter(i => !corte || i.data >= corte);
  const corpos = new Map(dentro.filter(i => i.corpo !== undefined).map(i => [i.message_id, i.corpo]));
  const digest = dentro.map(({ corpo, classe_esperada, ambiguo, rotulo, ...item }) => item);
  const r = await processarItens({ itens: digest, vagas, config, now, classificarLlm,
    abrir: async ids => { const pedidos = ids.slice(0, limiteFaseB); return { itens: pedidos.filter(id => corpos.has(id)).map(id => ({ message_id: id, corpo: corpos.get(id) })), adiados: ids.slice(limiteFaseB) }; } });
  const esperado = new Map(dentro.map(i => [i.message_id, i.classe_esperada]));
  const previsoes = r.classificados.map(c => ({ message_id: c.message_id, esperado: esperado.get(c.message_id), obtido: c.classe }));
  const geral = calcularConcordancia(previsoes);
  const por_regra = relatorioPorRegra(dentro.map(i => ({ item: i, rotulo: { classe: i.classe_esperada, ambiguo: i.ambiguo === true } }))).regras;
  const eventosSemId = r.eventos.filter(e => !e.dados?.message_id).length;
  const eventosComUrl = r.eventos.filter(e => URL_NO_TEXTO.test(JSON.stringify(e.dados))).length;
  const limiares = avaliarLimiares({ geral, por_regra });
  const falhas = [...limiares.falhas, ...(eventosSemId ? [`${eventosSemId} evento(s) sem message_id`] : []), ...(eventosComUrl ? [`${eventosComUrl} evento(s) com URL`] : [])];
  return { ok: falhas.length === 0, falhas, geral, por_regra, divergencias: previsoes.filter(p => p.esperado !== p.obtido).length, por_origem: r.por_origem, eventos: r.eventos.length, resumo: r.resumo };
}

// Corpus sintético (tests/fixtures/mail) no formato de replayItens.
export function itensDoCorpus(corpus) {
  return corpus.itens.map(item => ({ ...item, corpo: corpus.fulls[item.message_id], classe_esperada: corpus.labels[item.message_id].classe, ambiguo: corpus.labels[item.message_id].ambiguo === true }));
}
