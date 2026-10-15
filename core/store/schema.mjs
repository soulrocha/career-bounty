// Esquema do evento: {id, ts, host, seq, ator, tipo, entidade, entidade_id, dados, evidencia}.
const REQUIRED_TEXT = ['id', 'ator', 'tipo', 'entidade', 'entidade_id'];
const HOST = /^[A-Za-z0-9_-]+$/;
export const TIMEZONE = 'America/Sao_Paulo';

export const isHost = value => typeof value === 'string' && HOST.test(value);

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Evento inválido: deve ser um objeto.');
  for (const field of REQUIRED_TEXT) {
    if (typeof event[field] !== 'string' || !event[field].trim()) throw new Error(`Evento inválido: campo obrigatório ausente (${field}).`);
  }
  if (!event.dados || typeof event.dados !== 'object' || Array.isArray(event.dados)) throw new Error('Evento inválido: campo obrigatório ausente (dados).');
  if (typeof event.ts !== 'string' || !Number.isFinite(Date.parse(event.ts))) throw new Error('Evento inválido: campo obrigatório ausente (ts).');
  if (!isHost(event.host)) throw new Error('Evento inválido: host ausente ou com caracteres não permitidos.');
  if (event.evidencia !== undefined && typeof event.evidencia !== 'object') throw new Error('Evento inválido: evidencia deve ser lista ou objeto.');
  return event;
}

// Dia civil de São Paulo (AAAA-MM-DD) de um instante.
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export function localDay(ts) {
  return dayFormat.format(new Date(ts));
}

// ISO 8601 com o deslocamento de São Paulo, como o legado gravava (`registrado_em`).
const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset' });
export function localIso(ts) {
  const date = new Date(ts);
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map(part => [part.type, part.value]));
  const offset = (parts.timeZoneName.replace('GMT', '') || '+00:00').replace(/^([+-])(\d)$/, '$10$2:00');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(date.getUTCMilliseconds()).padStart(3, '0')}${offset}`;
}
