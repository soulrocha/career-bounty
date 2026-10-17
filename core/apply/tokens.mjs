// Medição por tentativa: só contadores, nunca conteúdo do formulário ou da sessão.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { appendEvents, readEvents } from '../store/events.mjs';
import { withLock } from '../store/lock.mjs';

const CONTADORES = ['tokens_in', 'tokens_out', 'tokens_cache_leitura', 'tokens_cache_criacao'];
const vazio = () => ({ chamadas: 0, modos: [], ...Object.fromEntries(CONTADORES.map(k => [k, 0])), total_tokens: 0 });
const soma = (a, b) => {
  const resultado = a + b;
  if (!Number.isSafeInteger(resultado)) throw new Error('Soma de tokens excede inteiro seguro.');
  return resultado;
};
function contadores(uso) {
  return Object.fromEntries(CONTADORES.map(k => {
    const n = Object.hasOwn(uso, k) ? uso[k] : 0;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Contador de tokens inválido: ${k}`);
    return [k, n];
  }));
}

export async function registrarTokensNavegador(dataRoot, { vagaId, tentativaId, uso, ts = new Date().toISOString() }) {
  if (!uso || typeof uso !== 'object' || Array.isArray(uso) || Object.keys(uso).some(k => !['medicao_id', ...CONTADORES].includes(k))
      || typeof uso.medicao_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(uso.medicao_id)
      || !Object.hasOwn(uso, 'tokens_in') || !Object.hasOwn(uso, 'tokens_out')) throw new Error('Medição inválida: informe medicao_id opaco e contadores de tokens.');
  const numeros = contadores(uso);
  CONTADORES.reduce((s, k) => soma(s, numeros[k]), 0);
  return withLock(path.join(dataRoot, 'state', 'tokens-candidatura.lock'), {}, async () => {
    const { eventos } = await readEvents(dataRoot);
    if (!eventos.some(e => e.tipo === 'candidatura.tentativa' && e.id === tentativaId && e.entidade_id === vagaId)) throw new Error('Tentativa sem vínculo com esta vaga.');
    const id = `llm.uso:navegador:${createHash('sha256').update(JSON.stringify([tentativaId, uso.medicao_id])).digest('hex')}`;
    const dados = { vaga_id: vagaId, tentativa_id: tentativaId, origem: 'navegador', modo: 'live', proveniencia: 'operador', medicao_id: uso.medicao_id, ...numeros };
    const anterior = eventos.find(e => e.id === id);
    if (anterior && JSON.stringify(anterior.dados) !== JSON.stringify(dados)) throw new Error('Medição já registrada com contadores diferentes.');
    const resultado = await appendEvents(dataRoot, [{ id, ts, ator: 'operador', tipo: 'llm.uso', entidade: 'llm', entidade_id: 'navegador', dados }], { now: ts });
    return { medicao_id: uso.medicao_id, registrada: resultado.appended };
  });
}

export function resumirCandidaturas(eventos) {
  const candidaturas = eventos.filter(e => e.tipo === 'candidatura.tentativa').map(e => ({
    vaga_id: e.entidade_id, tentativa_id: e.id, runner: vazio(), navegador: vazio(), todos_conhecidos: null, medicao: 'incompleta', total_tokens: 0,
  }));
  const porId = new Map(candidaturas.map(c => [c.tentativa_id, c]));
  const preparos = new Map();
  const simuladas = new Set();
  const desconhecidas = new Set();
  let eventos_sem_vinculo = 0;
  for (const e of eventos) {
    if (!['candidatura.preparada', 'llm.uso'].includes(e.tipo)) continue;
    const d = e.dados ?? {};
    const c = porId.get(d.tentativa_id);
    if (!c || c.vaga_id !== d.vaga_id) {
      if (e.tipo === 'llm.uso' && (d.tentativa_id || d.vaga_id || ['runner', 'navegador'].includes(d.origem))) eventos_sem_vinculo++;
      for (const afetada of candidaturas.filter(item => item.tentativa_id === d.tentativa_id || item.vaga_id === d.vaga_id)) simuladas.add(afetada.tentativa_id);
      continue;
    }
    if (e.tipo === 'candidatura.preparada') {
      const lista = preparos.get(c.tentativa_id) ?? [];
      lista.push(d);
      preparos.set(c.tentativa_id, lista);
      continue;
    }
    if (!['runner', 'navegador'].includes(d.origem) || !['live', 'fake', 'replay'].includes(d.modo)
      || !Object.hasOwn(d, 'tokens_in') || !Object.hasOwn(d, 'tokens_out')) throw new Error('Evento de uso de candidatura inválido.');
    if (['classificador-campos', 'redator-respostas'].includes(d.agente)) desconhecidas.add(c.tentativa_id);
    const numeros = contadores(d);
    const alvo = c[d.origem];
    alvo.chamadas++;
    if (!alvo.modos.includes(d.modo ?? 'nao_informado')) alvo.modos.push(d.modo ?? 'nao_informado');
    for (const k of CONTADORES) alvo[k] = soma(alvo[k], numeros[k]);
    alvo.total_tokens = CONTADORES.reduce((s, k) => soma(s, alvo[k]), 0);
    if (d.modo !== 'live') simuladas.add(c.tentativa_id);
  }
  for (const c of candidaturas) {
    const etapas = preparos.get(c.tentativa_id) ?? [];
    c.todos_conhecidos = desconhecidas.has(c.tentativa_id) ? false : etapas.length ? etapas.every(p => p.todos_conhecidos === true) : null;
    c.total_tokens = soma(c.runner.total_tokens, c.navegador.total_tokens);
    if (etapas.length && c.navegador.chamadas && !simuladas.has(c.tentativa_id)) c.medicao = 'completa';
    c.acima_limite = c.todos_conhecidos === true && c.total_tokens > 15000;
    c.resultado = c.acima_limite ? 'acima_do_limite' : c.medicao === 'completa' && c.todos_conhecidos === true ? 'aprovada' : 'nao_verificada';
  }
  return { limite_tokens: 15000, candidaturas, eventos_sem_vinculo, resumo: { candidaturas: candidaturas.length, verificadas: candidaturas.filter(c => c.resultado === 'aprovada').length, acima_limite: candidaturas.filter(c => c.acima_limite).length } };
}
