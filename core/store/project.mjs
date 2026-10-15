// Projeção: reconstrói o documento do pipeline a partir do log de eventos.
// Função pura: mesmos eventos, mesmo documento.
import { semanticHash } from './canonicalize.mjs';
import { applyDescarte, applyMarcacao, requisicaoKey } from './rules.mjs';
import { localDay } from './schema.mjs';
import { portalCandidatura } from '../apply/portal.mjs';

const clone = value => structuredClone(value);
export const EMAILS = 'eventos_email_sem_requisicao';

// Chave estável de cada item de e-mail sem requisição: o id, ou a posição quando faltar ou repetir.
export function emailKeys(items) {
  const count = new Map();
  for (const item of items) if (typeof item?.id === 'string') count.set(item.id, (count.get(item.id) ?? 0) + 1);
  const seen = new Map();
  return items.map((item, index) => {
    if (typeof item?.id !== 'string' || !item.id) return `posicao-${index + 1}`;
    if (count.get(item.id) === 1) return item.id;
    seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
    return `${item.id}#${seen.get(item.id)}`;
  });
}

function emptyState() {
  return { raiz: {}, chaves: ['schema_version', 'atualizado', 'vagas', EMAILS], vagas: new Map(), emails: new Map(), ordemVagas: null, ordemEmails: null, descartes: new Map() };
}

function fromDocument(document) {
  const state = emptyState();
  state.chaves = Object.keys(document);
  for (const [key, value] of Object.entries(document)) {
    if (key !== 'vagas' && key !== EMAILS) state.raiz[key] = clone(value);
  }
  for (const vaga of document.vagas ?? []) state.vagas.set(vaga.id, clone(vaga));
  const items = document[EMAILS] ?? [];
  emailKeys(items).forEach((key, index) => state.emails.set(key, clone(items[index])));
  return state;
}

function check(event, value) {
  if (event.dados.hash !== undefined && semanticHash(value) !== event.dados.hash) {
    throw new Error(`Evento corrompido: hash divergente (${event.id}).`);
  }
}

function patch(target, event) {
  const next = { ...target };
  for (const [key, value] of Object.entries(clone(event.dados.campos ?? {}))) next[key] = value;
  for (const key of event.dados.removidos ?? []) delete next[key];
  return next;
}

// Evento sobre entidade que ainda não chegou ao log (sincronização parcial ou relógio adiantado):
// a projeção tenta de novo no fim e, se persistir, avisa em vez de falhar.
const missing = event => Object.assign(new Error(`Entidade ausente para o evento ${event.id}.`), { code: 'ENTIDADE_AUSENTE' });

function onVaga(apply) {
  return (state, event) => {
    const current = state.vagas.get(event.entidade_id);
    if (!current) throw missing(event);
    state.vagas.set(event.entidade_id, apply(current, event.dados));
    if (event.dados.registrado_em) state.raiz.atualizado = localDay(event.dados.registrado_em);
    return state;
  };
}

function entity(collection) {
  return {
    importada: (state, event) => {
      check(event, event.dados.legado);
      state[collection].set(event.entidade_id, clone(event.dados.legado));
      return state;
    },
    atualizada: (state, event) => {
      const current = state[collection].get(event.entidade_id);
      if (!current) throw missing(event);
      const next = patch(current, event);
      check(event, next);
      state[collection].set(event.entidade_id, next);
      return state;
    },
  };
}

// Vaga descoberta pelo radar entra no formato do pipeline; descobertas repetidas só acrescentam aparições
// e atualizam o texto quando o hash muda. Nada que a pessoa marcou é tocado.
const aparicoesDe = (event, dia) => (event.dados.aparicoes?.length ? event.dados.aparicoes : [{ fonte: event.dados.vaga.fonte, url: event.dados.vaga.url }]).map(item => ({ ...item, em: dia }));

function discovered(state, event) {
  const nova = event.dados.vaga;
  const dia = localDay(event.ts);
  const atual = state.vagas.get(event.entidade_id);
  if (!state.raiz.atualizado) state.raiz.atualizado = dia;
  if (!atual) {
    const vaga = { id: event.entidade_id, empresa: nova.empresa, cargo: nova.cargo, url: nova.url, local: nova.local, modalidade: nova.modalidade,
      regime: nova.regime, salario: null, salario_min: nova.salario_min, salario_max: nova.salario_max, requisicao_id: nova.requisicao_id && nova.portal ? `${nova.portal}:${nova.requisicao_id}` : nova.requisicao_id, portal_origem: nova.portal,
      descricao_completa: nova.descricao, descricao_hash: nova.descricao_hash, publicado_em: nova.publicado_em, consultado_em: dia,
      fontes: [...new Set(aparicoesDe(event, dia).map(a => a.fonte))], aparicoes: aparicoesDe(event, dia), destino_pendente: event.dados.destino_pendente === true, possivel_duplicata: event.dados.possivel_duplicata ?? [], status: 'avaliada-sem-envio', url_status: 'aberta', aderencia: 'pendente' };
    vaga.portal_candidatura = portalCandidatura(vaga);
    state.vagas.set(event.entidade_id, vaga);
    return state;
  }
  const next = { ...atual };
  const aparicoes = [...(next.aparicoes ?? [])];
  for (const item of aparicoesDe(event, dia)) if (!aparicoes.some(a => a.fonte === item.fonte && a.url === item.url)) aparicoes.push(item);
  next.aparicoes = aparicoes;
  next.fontes = [...new Set([...(next.fontes ?? []), ...aparicoes.map(a => a.fonte)])];
  if (nova.descricao_hash && next.descricao_hash !== nova.descricao_hash) {
    next.descricao_completa = nova.descricao;
    next.descricao_hash = nova.descricao_hash;
    next.consultado_em = dia;
  }
  state.vagas.set(event.entidade_id, next);
  return state;
}

const vaga = entity('vagas');
const email = entity('emails');

const reducers = {
  'legado.importado': (state, event) => fromDocument(event.dados.legado),
  'pipeline.raiz': (state, event) => {
    Object.assign(state.raiz, clone(event.dados.campos));
    for (const key of event.dados.removidos ?? []) delete state.raiz[key];
    if (event.dados.chaves) state.chaves = [...event.dados.chaves];
    return state;
  },
  'pipeline.ordem': (state, event) => {
    if (event.dados.vagas) state.ordemVagas = [...event.dados.vagas];
    if (event.dados.emails) state.ordemEmails = [...event.dados.emails];
    return state;
  },
  'vaga.importada': vaga.importada,
  'vaga.atualizada': vaga.atualizada,
  'vaga.descoberta': discovered,
  'email_evento.importado': email.importada,
  'email_evento.atualizado': email.atualizada,
  'candidatura.marcada': onVaga(applyMarcacao),
  'vaga.descartada': (state, event) => {
    onVaga(applyDescarte)(state, event);
    const key = event.dados.requisicao;
    if (key) {
      if (event.dados.descartada) state.descartes.set(key, { entidade_id: event.entidade_id, registrado_em: event.dados.registrado_em });
      else state.descartes.delete(key);
    }
    return state;
  },
};

// Registro de reducers adicionais (comandos do painel entram aqui).
export function registerReducer(tipo, reducer) {
  reducers[tipo] = reducer;
}

// Descarte vale para a requisição: a mesma vaga republicada com outro id continua descartada.
function inherit(state, vaga) {
  const key = state.descartes.size ? requisicaoKey(vaga) : null;
  const origin = key ? state.descartes.get(key) : null;
  if (!origin || vaga.id === origin.entidade_id || vaga.descarte_usuario) return clone(vaga);
  return { ...clone(vaga), descarte_usuario: { descartada: true, registrado_em: origin.registrado_em, origem: 'requisicao-descartada', herdado_de: origin.entidade_id } };
}

function ordered(map, order) {
  if (!order) return [...map.values()];
  const rank = new Map(order.map((key, index) => [key, index]));
  const known = [...map.entries()].filter(([key]) => rank.has(key)).sort((a, b) => rank.get(a[0]) - rank.get(b[0]));
  const rest = [...map.entries()].filter(([key]) => !rank.has(key));
  return [...known, ...rest].map(([, value]) => value);
}

export function projectEvents(events, { avisos = [] } = {}) {
  let state = emptyState();
  const deferred = [];
  const apply = (event, defer) => {
    const reducer = reducers[event.tipo];
    if (!reducer) return;
    try { state = reducer(state, event); }
    catch (error) {
      if (error.code !== 'ENTIDADE_AUSENTE') throw error;
      if (defer) deferred.push(event); else avisos.push(error.message);
    }
  };
  for (const event of events) apply(event, true);
  for (const event of deferred) apply(event, false);
  const document = {};
  for (const key of state.chaves) {
    if (key === 'vagas') document.vagas = ordered(state.vagas, state.ordemVagas).map(vaga => inherit(state, vaga));
    else if (key === EMAILS) document[EMAILS] = ordered(state.emails, state.ordemEmails).map(clone);
    else if (Object.hasOwn(state.raiz, key)) document[key] = clone(state.raiz[key]);
  }
  return document;
}
