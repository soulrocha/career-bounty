// Classificador Haiku só para o que as regras não resolveram mesmo com a mensagem inteira.
// Contrato JSON estrito; conteúdo em delimitador de dado; cache por message_id + versão do prompt.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../store/atomicWrite.mjs';
import { loadAgent } from '../llm/agents.mjs';
import { embrulhar, limparCampoCurto, limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';
import { fold } from '../dedup/keys.mjs';
import { CLASSES } from './rules.mjs';

export const LOTE_CLASSIFICADOR = 10;
export const CLASSES_LLM = [...CLASSES, 'pendente'];
export const CONFIANCAS = ['alta', 'media', 'baixa'];

// Frases que tentam dar ordens ao modelo. Qualquer uma força "pendente de conferência" e o texto nem é enviado.
const INJECAO = [/ignore (all |as |todas as |previous |anteriores|the previous)/, /desconsidere (as |todas as )?instruc/, /(marque|classifique|trate|considere) (este|esse|esta|essa|todas?|todos?)[^.]{0,60}\bcomo\b/,
  /^\s*(sistema|system|assistant|assistente)\s*:/m, /encaminhe (todos?|tudo)/, /forward (all|everything)/, /apague (este|esse|todos?)/, /delete this (e-?mail|message)/, /voce (agora )?e um (assistente|ia|bot)/, /responda confirmando/, /disregard (all |the )?(previous|prior)/];
export const detectarInjecao = texto => { const f = fold(texto); return INJECAO.some(re => re.test(f)); };

export function validarClassificacao(json, ids) {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.resultados)) throw new Error('faltou resultados[]');
  for (const chave of Object.keys(json)) if (chave !== 'resultados') throw new Error(`campo fora do contrato: ${chave}`);
  for (const item of json.resultados) {
    if (!item || typeof item !== 'object') throw new Error('item inválido');
    const extra = Object.keys(item).find(chave => !['message_id', 'classe', 'confianca', 'evidencia'].includes(chave));
    if (extra) throw new Error(`campo fora do contrato: ${extra}`);
    if (!ids.has(item.message_id)) throw new Error(`message_id fora do lote: ${String(item.message_id).slice(0, 40)}`);
    if (!CLASSES_LLM.includes(item.classe)) throw new Error(`classe inválida: ${String(item.classe).slice(0, 30)}`);
    if (!CONFIANCAS.includes(item.confianca)) throw new Error('confianca inválida');
    if (typeof item.evidencia !== 'string' || item.evidencia.length > 300) throw new Error('evidencia ausente ou longa demais');
  }
}

// itens: [{ message_id, regra }] com `regra` = resultado de classificar(..., { corpo }). Só entra quem ainda é ambíguo.
export const selecionarParaLlm = itens => itens.filter(item => item.corpo !== undefined && item.regra?.precisa_llm === true);

async function lerCache(arquivo) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
}

const linhaDe = item => ({ message_id: item.message_id, remetente_dominio: limparCampoCurto(item.remetente_dominio, 100), assunto: limparCampoCurto(item.assunto, 200), corpo: embrulhar(limparTextoNaoConfiavel(item.corpo, { max: 1500 }).texto) });

// itens: [{ message_id, remetente_dominio, assunto, corpo }]. Devolve { resultados: Map, chamadas, doCache }.
export async function classificarAmbiguos({ runner, cacheDir, itens, rodada }) {
  const agente = await loadAgent('classificador-email');
  const arquivo = cacheDir ? path.join(cacheDir, 'email-classe.json') : null;
  const cache = arquivo ? await lerCache(arquivo) : {};
  const chave = id => createHash('sha256').update(`${id}|${agente.versaoPrompt}|${agente.modelo}`).digest('hex');
  const resultados = new Map();
  const pendentesLlm = [];
  let doCache = 0;
  for (const item of itens) {
    if (detectarInjecao(`${item.assunto}\n${item.corpo}`)) { resultados.set(item.message_id, { classe: 'pendente', confianca: 'baixa', origem: 'pendente', motivo: 'instrução suspeita dentro do e-mail' }); continue; }
    const guardado = cache[chave(item.message_id)];
    if (guardado) { resultados.set(item.message_id, guardado); doCache += 1; } else pendentesLlm.push(item);
  }
  let chamadas = 0;
  for (let i = 0; i < pendentesLlm.length; i += LOTE_CLASSIFICADOR) {
    const lote = pendentesLlm.slice(i, i + LOTE_CLASSIFICADOR);
    const ids = new Set(lote.map(item => item.message_id));
    chamadas += 1;
    const { json } = await runner.run({ agente: 'classificador-email', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema,
      entrada: { emails: lote.map(linhaDe) }, meta: { ...(rodada ? { rodada } : {}), fase: 'classificador' }, validar: saida => validarClassificacao(saida, ids) });
    for (const r of json.resultados) {
      if (resultados.has(r.message_id)) continue;
      const baixa = r.confianca === 'baixa' || r.classe === 'pendente';
      const final = baixa ? { classe: 'pendente', confianca: 'baixa', origem: 'pendente', motivo: 'confiança baixa do classificador' } : { classe: r.classe, confianca: r.confianca, origem: 'llm', motivo: 'classificador' };
      resultados.set(r.message_id, final);
      cache[chave(r.message_id)] = final;
    }
    for (const item of lote) if (!resultados.has(item.message_id)) resultados.set(item.message_id, { classe: 'pendente', confianca: 'baixa', origem: 'pendente', motivo: 'sem resposta do classificador' });
  }
  if (arquivo && chamadas) await atomicJson(arquivo, cache);
  return { resultados, chamadas, doCache };
}

// Combina regra e LLM: a confiança nunca passa da confiança do domínio do remetente.
export function combinar(regra, llm) {
  const ordem = { baixa: 0, media: 1, alta: 2 };
  if (regra.classe) return { classe: regra.classe, confianca: regra.confianca, origem: 'regra', motivo: regra.motivo };
  if (!llm) return { classe: 'pendente', confianca: 'baixa', origem: 'pendente', motivo: regra.motivo };
  const confianca = ordem[llm.confianca] <= ordem[regra.confianca] ? llm.confianca : regra.confianca;
  return { classe: llm.classe, confianca: llm.classe === 'pendente' ? 'baixa' : confianca, origem: llm.origem, motivo: llm.motivo };
}
