// Answer bank (F6.3): respostas reutilizáveis de formulário, em DATA_ROOT/kb/answers.yml (JSON, como os demais .yml).
// Cada resposta tem variantes de rótulo, escopo (global, portal ou empresa), sensibilidade, proveniência e validade.
// Resposta sensível (salário, PcD, documento, endereço) nunca vai ao LLM nem aparece em log.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fold } from '../dedup/keys.mjs';
import { atomicJson } from '../store/atomicWrite.mjs';
import { withLock } from '../store/lock.mjs';

const ESCOPOS = ['global', 'portal', 'empresa'];
const ORDEM = { empresa: 0, portal: 1, global: 2 };
const ORIGENS = ['usuario', 'afirmacao', 'importada'];
export const arquivoRespostas = dataRoot => path.join(dataRoot, 'kb', 'answers.yml');

// Rótulo comparável: sem acento, caixa, asterisco, pontuação nem espaço repetido.
export const normalizarRotulo = texto => fold(String(texto ?? '')).replace(/\*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const erro = (i, msg) => new Error(`answers.yml, resposta ${i + 1}: ${msg}`);

export function validarResposta(r, i = 0) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw erro(i, 'deve ser objeto');
  if (typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9:._-]{0,80}$/.test(r.id)) throw erro(i, 'id inválido');
  if (!Array.isArray(r.variantes_label) || !r.variantes_label.length || r.variantes_label.some(v => typeof v !== 'string' || !normalizarRotulo(v))) throw erro(i, 'variantes_label deve ser lista de textos');
  if (r.resposta === undefined || r.resposta === null || r.resposta === '') throw erro(i, 'resposta vazia');
  if (!['string', 'number', 'boolean'].includes(typeof r.resposta) && !(Array.isArray(r.resposta) && r.resposta.every(x => typeof x === 'string'))) throw erro(i, 'resposta deve ser texto, número, sim/não ou lista de textos');
  const e = r.escopo ?? {};
  if (!ESCOPOS.includes(e.tipo)) throw erro(i, `escopo.tipo deve ser ${ESCOPOS.join(', ')}`);
  if (e.tipo !== 'global' && (typeof e.valor !== 'string' || !normalizarRotulo(e.valor))) throw erro(i, `escopo ${e.tipo} exige valor`);
  if (typeof r.sensivel !== 'boolean') throw erro(i, 'sensivel deve ser true ou false');
  if (!ORIGENS.includes(r.proveniencia?.origem) || typeof r.proveniencia?.registrado_em !== 'string') throw erro(i, 'proveniencia exige origem e registrado_em');
  if (r.validade !== null && r.validade !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(r.validade)) throw erro(i, 'validade deve ser AAAA-MM-DD ou null');
  return r;
}

export async function lerRespostas(dataRoot) {
  let bruto;
  try { bruto = JSON.parse(await readFile(arquivoRespostas(dataRoot), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`answers.yml ilegível: ${e.message}`);
  }
  if (!Array.isArray(bruto?.respostas)) throw new Error('answers.yml: falta a lista "respostas".');
  return bruto.respostas.map(validarResposta);
}

const mesmoConteudo = (a, b) => JSON.stringify({ ...a, proveniencia: undefined }) === JSON.stringify({ ...b, proveniencia: undefined });

// Grava ou atualiza pelo id. Gravar o mesmo conteúdo de novo não muda o arquivo (idempotente).
export async function gravarResposta(dataRoot, resposta) {
  validarResposta(resposta);
  return withLock(path.join(dataRoot, 'state', 'answers.lock'), { busyMessage: 'Answer bank em uso; tente novamente.' }, async () => {
    const atuais = await lerRespostas(dataRoot);
    const existente = atuais.find(r => r.id === resposta.id);
    if (existente && mesmoConteudo(existente, resposta)) return { gravada: false, resposta: existente };
    const lista = [...atuais.filter(r => r.id !== resposta.id), resposta].sort((a, b) => a.id.localeCompare(b.id));
    await atomicJson(arquivoRespostas(dataRoot), { versao: 1, respostas: lista });
    return { gravada: true, resposta };
  });
}

const vale = (r, hoje) => !r.validade || r.validade >= hoje;
const noEscopo = (r, { portal, empresa }) => r.escopo.tipo === 'global'
  || (r.escopo.tipo === 'portal' && portal && normalizarRotulo(r.escopo.valor) === normalizarRotulo(portal))
  || (r.escopo.tipo === 'empresa' && empresa && normalizarRotulo(r.escopo.valor) === normalizarRotulo(empresa));

// A resposta para um rótulo no contexto (portal, empresa, dia). Vence o escopo mais específico; vencida não conta;
// duas respostas válidas no mesmo escopo para o mesmo rótulo são conflito (erro, nunca chute). null quando não há.
export function buscarResposta(respostas, { label, portal = null, empresa = null, hoje }) {
  const alvo = normalizarRotulo(label);
  if (!alvo) return null;
  const candidatas = respostas.filter(r => vale(r, hoje) && noEscopo(r, { portal, empresa }) && r.variantes_label.some(v => normalizarRotulo(v) === alvo));
  if (!candidatas.length) return null;
  const melhor = Math.min(...candidatas.map(r => ORDEM[r.escopo.tipo]));
  const doEscopo = candidatas.filter(r => ORDEM[r.escopo.tipo] === melhor);
  if (doEscopo.length > 1) throw new Error(`Conflito no answer bank: ${doEscopo.map(r => r.id).join(' e ')} respondem "${label}" no mesmo escopo.`);
  return doEscopo[0];
}

// O que pode ir ao LLM: só respostas não sensíveis, sem proveniência.
export const respostasParaLlm = respostas => respostas.filter(r => !r.sensivel).map(r => ({ id: r.id, variantes_label: r.variantes_label, resposta: r.resposta }));
// Linha de log: nunca o valor de resposta sensível.
export const descreverParaLog = r => `${r.id} (${r.escopo.tipo}${r.escopo.valor ? `: ${r.escopo.valor}` : ''}) = ${r.sensivel ? '[sensível]' : JSON.stringify(r.resposta).slice(0, 80)}`;
