// Tentativas de candidatura (F6.8 e F7.4): a reserva é gravada antes de agir, por requisição, e impede duplicidade.
// Eventos fora da projeção legada: candidatura.tentativa (reserva) e candidatura.estado (desfecho da tentativa).
import { createHash } from 'node:crypto';
import { requisicaoKey } from '../store/rules.mjs';
import { chavesCanonicas } from '../dedup/keys.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { withLock } from '../store/lock.mjs';
import path from 'node:path';

export const ESTADOS_FINAIS = ['enviada', 'enviada_sem_comprovante'];
export const ESTADOS = ['em_andamento', 'enviada', 'enviada_sem_comprovante', 'bloqueada:humano', 'falhou', 'incerta', 'cancelada'];
export const TRAVADA_MINUTOS = 30;

// A requisição identifica a vaga real: duas aparições da mesma requisição são uma tentativa só.
export const chaveTentativa = vaga => requisicaoKey(vaga) ?? [...chavesCanonicas(vaga)].sort()[0] ?? `vaga:${vaga.id}`;

// Map(chave -> { chave, vaga_id, rota, estado, desde, tentativa_id, comprovante? }) com o último estado de cada requisição.
export function projetarTentativas(eventos) {
  const porChave = new Map();
  for (const e of eventos) {
    if (e.tipo === 'candidatura.tentativa') porChave.set(e.dados.chave, { chave: e.dados.chave, vaga_id: e.entidade_id, rota: e.dados.rota, cv: e.dados.cv ?? null, estado: 'em_andamento', desde: e.ts, tentativa_id: e.id });
    else if (e.tipo === 'candidatura.estado') {
      const atual = porChave.get(e.dados.chave);
      if (atual && atual.tentativa_id === e.dados.tentativa_id) porChave.set(e.dados.chave, { ...atual, estado: e.dados.estado, desde: e.ts, ...(e.dados.comprovante ? { comprovante: e.dados.comprovante } : {}), ...(e.dados.motivo ? { motivo: e.dados.motivo } : {}) });
    }
  }
  return porChave;
}

// Por que uma nova tentativa não pode começar (ou null quando pode).
export function bloqueioDeTentativa(tentativa, agora) {
  if (!tentativa) return null;
  if (ESTADOS_FINAIS.includes(tentativa.estado)) return { codigo: 'ja_enviada', motivo: 'candidatura já enviada nesta requisição' };
  if (tentativa.estado === 'incerta') return { codigo: 'incerta', motivo: 'tentativa anterior com desfecho incerto: confira antes de tentar de novo' };
  if (tentativa.estado === 'em_andamento') {
    const minutos = (Date.parse(agora) - Date.parse(tentativa.desde)) / 60000;
    return minutos > TRAVADA_MINUTOS
      ? { codigo: 'travada', motivo: `tentativa em andamento há ${Math.round(minutos)} minutos: confira manualmente e marque o desfecho` }
      : { codigo: 'em_andamento', motivo: 'tentativa em andamento nesta requisição' };
  }
  return null;
}

// Reserva a requisição antes de qualquer ação, sob lock: duas abas ou dois processos não reservam a mesma vaga.
export async function reservarTentativa(dataRoot, { vaga, rota, cv = null, ts = new Date().toISOString() }) {
  const chave = chaveTentativa(vaga);
  return withLock(path.join(dataRoot, 'state', 'tentativas.lock'), { busyMessage: 'Outra tentativa está sendo reservada; tente de novo.' }, async () => {
    const atual = projetarTentativas((await readEvents(dataRoot)).eventos).get(chave);
    const bloqueio = bloqueioDeTentativa(atual, ts);
    if (bloqueio) { const e = new Error(bloqueio.motivo); e.code = bloqueio.codigo; throw e; }
    const id = `tentativa:${createHash('sha256').update(`${chave}|${ts}`).digest('hex').slice(0, 16)}`;
    await appendEvents(dataRoot, [{ id, ts, ator: 'aplicar', tipo: 'candidatura.tentativa', entidade: 'vaga', entidade_id: vaga.id, dados: { chave, rota, cv } }], { now: ts });
    return { tentativa_id: id, chave, cv };
  });
}

export async function registrarDesfecho(dataRoot, { tentativa_id, chave, vagaId, estado, comprovante = null, motivo = null, ts = new Date().toISOString() }) {
  if (!ESTADOS.includes(estado) || estado === 'em_andamento') throw new Error(`Desfecho inválido: ${estado}`);
  const atual = projetarTentativas((await readEvents(dataRoot)).eventos).get(chave);
  if (!atual || atual.tentativa_id !== tentativa_id) throw new Error('Tentativa não encontrada ou substituída.');
  await appendEvents(dataRoot, [{ id: `${tentativa_id}:${estado}:${ts}`, ts, ator: 'aplicar', tipo: 'candidatura.estado', entidade: 'vaga', entidade_id: vagaId,
    dados: { chave, tentativa_id, estado, ...(comprovante ? { comprovante } : {}), ...(motivo ? { motivo } : {}) } }], { now: ts });
}
