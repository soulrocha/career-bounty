// Regras de domínio sobre a vaga legada: marcador público, "já me candidatei" e descarte.
// Portadas de painel_server.py por comportamento. Funções puras: o relógio vem no evento.
import { localDay } from './schema.mjs';

export const CONFIRMED = new Set(['candidatura-enviada-confirmada', 'candidatura-finalizada-confirmada',
  'candidatura-anterior-identificada-triagem-pendente', 'candidatura-anterior-mesmo-cargo-confirmada-id-a-verificar']);
export const MANUAL_STATUS = 'candidatura-enviada-informada-pelo-usuario';

// Marcador público de uma vaga: o que o painel mostra e o que POST devolve.
export function publicMarker(job) {
  const mark = job.candidatura_usuario ?? {};
  const email = job.candidatura_email ?? {};
  const portal = job.candidatura_portal ?? {};
  const previous = CONFIRMED.has(job.status) || Boolean(email.aplicada) || Boolean(portal.aplicada);
  return { id: job.id, aplicada: Boolean(mark.aplicada) || previous,
    data: (mark.aplicada ? mark.data : portal.data || email.data) ?? null,
    historico_confirmado: previous, status: job.status ?? null, evidencia_email: email.observacao ?? null,
    etapa_email: email.etapa ?? null, origem: mark.aplicada ? 'usuario-no-painel' : previous ? 'historico' : null,
    historico_anterior: Object.hasOwn(job, 'historico_anterior') ? job.historico_anterior : (Boolean(job.historico) && !mark.aplicada),
    descartada: Boolean(job.descarte_usuario?.descartada) };
}

// Valida uma data ISO real (AAAA-MM-DD), inclusive ano bissexto.
export function isoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}

const hasConfirmedRecord = job => CONFIRMED.has(job.status) || Boolean(job.candidatura_email?.aplicada);

// Precondições de "Já me candidatei". Devolvem o motivo da recusa ou null.
export function checkMarcacao(job, { aplicada, data }, nowTs) {
  if (typeof aplicada !== 'boolean') return 'Marcação inválida.';
  if (aplicada) {
    if (!isoDate(data)) return 'Data inválida; use AAAA-MM-DD.';
    if (data > localDay(nowTs)) return 'A candidatura não pode ter data futura.';
  } else if (hasConfirmedRecord(job)) return 'O registro anterior confirmado foi preservado.';
  return null;
}

export function applyMarcacao(job, { aplicada, data, registrado_em }) {
  const next = { ...job };
  const previous = next.candidatura_usuario ?? {};
  const oldStatus = Object.hasOwn(previous, 'status_anterior') ? previous.status_anterior : (next.status ?? null);
  const marker = { aplicada, data: aplicada ? data : null, registrado_em, origem: 'usuario-no-painel', status_anterior: oldStatus };
  next.historico_marcacoes = [...(next.historico_marcacoes ?? []), { antes: previous, depois: marker }];
  next.candidatura_usuario = marker;
  if (aplicada && !CONFIRMED.has(next.status)) next.status = MANUAL_STATUS;
  else if (!aplicada && next.status === MANUAL_STATUS) next.status = oldStatus;
  return next;
}

export function applyDescarte(job, { descartada, registrado_em }) {
  const next = { ...job };
  const previous = next.descarte_usuario ?? {};
  const marker = { descartada, registrado_em, origem: 'usuario-no-painel' };
  next.historico_descartes = [...(next.historico_descartes ?? []), { antes: previous, depois: marker }];
  next.descarte_usuario = marker;
  return next;
}

// Chave da requisição da vaga: identifica a mesma vaga republicada com outro endereço.
export function requisicaoKey(vaga) {
  const value = vaga.requisicao_id ?? vaga.id_requisicao;
  return value === undefined || value === null || value === '' ? null : `req:${value}`;
}

const temComprovante = job => {
  const valor = job.comprovante_envio;
  if (valor === undefined || valor === null) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  if (typeof valor === 'object') return Object.keys(valor).length > 0;
  return Boolean(valor);
};

// A vaga já tem candidatura registrada? Junta o que a pessoa marcou, o histórico importado do legado (e-mail, portal,
// status confirmado, comprovante) e a marca herdada de outra publicação da mesma requisição.
export const aplicadaDe = job => Boolean(job.candidatura_usuario?.aplicada) || CONFIRMED.has(job.status) || Boolean(job.candidatura_email?.aplicada)
  || Boolean(job.candidatura_portal?.aplicada) || Boolean(job.candidatura_herdada?.aplicada) || Boolean(job.historico) || temComprovante(job);

export const descartadaDe = job => Boolean(job.descarte_usuario?.descartada);
