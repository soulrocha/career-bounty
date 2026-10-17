// Perguntas pendentes (F6.6): campo que só a pessoa responde vira evento pergunta.pendente, com contexto mínimo (sem a JD).
// Responder uma vez grava no answer bank, no escopo escolhido, e gera pergunta.respondida; a vaga volta à fila e a mesma
// pergunta em outra vaga do mesmo escopo é preenchida sozinha pelo matcher. Eventos fora da projeção legada (sombra intacta).
import { createHash } from 'node:crypto';
import { gravarResposta, normalizarRotulo } from './answers.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';

const DIA_MS = 24 * 60 * 60 * 1000;
export const VALIDADE_SENSIVEL_DIAS = 180;

export const idPergunta = label => `pq-${createHash('sha256').update(normalizarRotulo(label)).digest('hex').slice(0, 12)}`;

// campo: item classificado como pergunta (F6.5). vaga: { id, empresa, cargo }.
export function eventoPerguntaPendente({ vaga, campo, portal = null, ts }) {
  const pid = idPergunta(campo.label);
  return {
    id: `pergunta-pendente:${pid}:${vaga.id}`, ts, ator: 'aplicar', tipo: 'pergunta.pendente', entidade: 'pergunta', entidade_id: pid,
    dados: { vaga_id: vaga.id, empresa: vaga.empresa ?? null, cargo: vaga.cargo ?? null, portal, label: campo.label, tipo: campo.tipo,
      ...(campo.opcoes ? { opcoes: campo.opcoes } : {}), categoria: campo.categoria ?? 'factual', obrigatorio: campo.obrigatorio !== false },
  };
}

const cobre = (escopo, vaga) => escopo.tipo === 'global'
  || (escopo.tipo === 'portal' && normalizarRotulo(escopo.valor) === normalizarRotulo(vaga.portal))
  || (escopo.tipo === 'empresa' && normalizarRotulo(escopo.valor) === normalizarRotulo(vaga.empresa));

// { pendentes: [{ id, label, tipo, opcoes, categoria, vagas: [...] }], porVaga: Map(vaga_id -> [pid]) }.
export function projetarPerguntas(eventos) {
  const perguntas = new Map();
  for (const e of eventos) {
    if (e.tipo === 'pergunta.pendente') {
      const p = perguntas.get(e.entidade_id) ?? { id: e.entidade_id, label: e.dados.label, tipo: e.dados.tipo, opcoes: e.dados.opcoes ?? null, categoria: e.dados.categoria, vagas: new Map() };
      p.vagas.set(e.dados.vaga_id, { vaga_id: e.dados.vaga_id, empresa: e.dados.empresa, cargo: e.dados.cargo, portal: e.dados.portal });
      perguntas.set(e.entidade_id, p);
    } else if (e.tipo === 'pergunta.respondida') {
      const p = perguntas.get(e.entidade_id);
      if (p) for (const [id, vaga] of p.vagas) if (cobre(e.dados.escopo, vaga)) p.vagas.delete(id);
    }
  }
  const pendentes = [...perguntas.values()].filter(p => p.vagas.size).map(p => ({ ...p, vagas: [...p.vagas.values()] }));
  const porVaga = new Map();
  for (const p of pendentes) for (const v of p.vagas) porVaga.set(v.vaga_id, [...(porVaga.get(v.vaga_id) ?? []), p.id]);
  return { pendentes, porVaga };
}

function validarValor(pergunta, resposta) {
  const opcoes = pergunta.opcoes ?? [];
  if (pergunta.tipo === 'checkbox_grupo') {
    if (!Array.isArray(resposta) || !resposta.length || resposta.some(r => !opcoes.includes(r))) throw new Error('Escolha uma ou mais opções da lista.');
  } else if (['select', 'radio'].includes(pergunta.tipo)) {
    if (!opcoes.includes(resposta)) throw new Error('Escolha uma das opções da lista.');
  } else if (pergunta.tipo === 'checkbox') {
    if (typeof resposta !== 'boolean') throw new Error('Responda sim ou não.');
  } else if (typeof resposta !== 'string' || !resposta.trim() || resposta.length > 2000) throw new Error('Resposta de texto vazia ou longa demais.');
}

function validarEscopo(escopo, pergunta) {
  if (!escopo || !['global', 'portal', 'empresa'].includes(escopo.tipo)) throw new Error('Escopo inválido.');
  if (escopo.tipo === 'global') return { tipo: 'global' };
  const valores = pergunta.vagas.map(v => (escopo.tipo === 'portal' ? v.portal : v.empresa)).filter(Boolean);
  if (!valores.includes(escopo.valor)) throw new Error(`O escopo ${escopo.tipo} deve ser de uma das vagas que esperam esta resposta.`);
  return { tipo: escopo.tipo, valor: escopo.valor };
}

// Grava a resposta no answer bank e registra a pergunta como respondida no escopo. Sensível vence em 180 dias.
export async function responderPergunta({ dataRoot, perguntaId, resposta, escopo, ts = new Date().toISOString() }) {
  const pergunta = projetarPerguntas((await readEvents(dataRoot)).eventos).pendentes.find(p => p.id === perguntaId);
  if (!pergunta) { const e = new Error('Pergunta não encontrada ou já respondida.'); e.code = 'nao_encontrado'; throw e; }
  validarValor(pergunta, resposta);
  const alvo = validarEscopo(escopo, pergunta);
  const sensivel = pergunta.categoria === 'sensivel';
  const sufixo = alvo.tipo === 'global' ? 'global' : `${alvo.tipo}-${normalizarRotulo(alvo.valor).replace(/ /g, '-').slice(0, 30)}`;
  const registro = {
    id: `${perguntaId}-${sufixo}`, variantes_label: [pergunta.label], resposta, escopo: alvo, sensivel,
    proveniencia: { origem: 'usuario', registrado_em: ts },
    validade: sensivel ? new Date(Date.parse(ts) + VALIDADE_SENSIVEL_DIAS * DIA_MS).toISOString().slice(0, 10) : null,
  };
  await gravarResposta(dataRoot, registro);
  await appendEvents(dataRoot, [{ id: `pergunta-respondida:${perguntaId}:${sufixo}:${ts}`, ts, ator: 'usuario', tipo: 'pergunta.respondida', entidade: 'pergunta', entidade_id: perguntaId, dados: { resposta_id: registro.id, escopo: alvo } }], { now: ts });
  return { resposta_id: registro.id, escopo: alvo, liberadas: pergunta.vagas.filter(v => cobre(alvo, v)).map(v => v.vaga_id) };
}
