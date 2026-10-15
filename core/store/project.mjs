// Projeção: reconstrói o documento do pipeline a partir do log de eventos.
// Função pura: mesmos eventos, mesmo documento.
import { semanticHash } from './canonicalize.mjs';
import { applyDescarte, applyMarcacao, aplicadaDe, descartadaDe, requisicaoKey } from './rules.mjs';
import { chavesCanonicas } from '../dedup/keys.mjs';
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
  return { raiz: {}, chaves: ['schema_version', 'atualizado', 'vagas', EMAILS], vagas: new Map(), emails: new Map(), ordemVagas: null, ordemEmails: null, descartes: new Map(), importadas: new Set() };
}

function fromDocument(document) {
  const state = emptyState();
  state.chaves = Object.keys(document);
  for (const [key, value] of Object.entries(document)) {
    if (key !== 'vagas' && key !== EMAILS) state.raiz[key] = clone(value);
  }
  for (const vaga of document.vagas ?? []) { state.vagas.set(vaga.id, clone(vaga)); state.importadas.add(vaga.id); }
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
      if (collection === 'vagas') state.importadas.add(event.entidade_id);
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
      fontes: [...new Set(aparicoesDe(event, dia).map(a => a.fonte))], aparicoes: aparicoesDe(event, dia), destino_pendente: event.dados.destino_pendente === true, possivel_duplicata: event.dados.possivel_duplicata ?? [], status: 'avaliada-sem-envio', url_status: 'aberta', aderencia: event.dados.pre?.descartada ? 'incompativel' : event.dados.pre?.nivel === 'baixa' ? 'baixa' : 'pendente' };
    if (event.dados.pre) { vaga.pre_nivel = event.dados.pre.nivel; vaga.pre_score = event.dados.pre.pre_score; vaga.motivos = event.dados.pre.motivos; vaga.condicoes = event.dados.pre.condicoes; }
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

// Resultado do radar sobre uma vaga já descoberta: triagem do Haiku e avaliação validada do Sonnet.
const LEGADO = { atendido: 'atendido', parcial: 'parcial', lacuna: 'nao-atendido' };
function triada(vaga, dados) {
  const next = { ...vaga, triagem: { decisao: dados.decisao, motivo: dados.motivo, descricao_hash: dados.descricao_hash, versaoPrompt: dados.versaoPrompt } };
  if (dados.decisao === 'descartar' && next.aderencia === 'pendente') next.aderencia = 'baixa';
  return next;
}
function avaliada(vaga, dados) {
  const a = dados.avaliacao;
  const incompativel = vaga.condicoes?.situacao === 'incompativel';
  return { ...vaga, aderencia: incompativel ? 'incompativel' : a.aderencia, motivos: [a.resumo, ...(vaga.motivos ?? [])].filter(Boolean),
    requisitos: a.requisitos.map(r => ({ requisito: r.requisito, tipo: r.tipo, avaliacao: LEGADO[r.avaliacao], afirmacoes: r.afirmacoes, ...(r.nao_verificado ? { nao_verificado: true } : {}) })),
    lacunas: a.requisitos.filter(r => r.tipo === 'obrigatorio' && r.avaliacao === 'lacuna').map(r => r.requisito), pendencias: [...new Set([...(vaga.pendencias ?? []), ...a.pendencias])],
    avaliacao_radar: { descricao_hash: dados.descricao_hash, snapshot_afirmacoes: a.snapshot_afirmacoes, versaoPrompt: a.versaoPrompt, modelo: a.modelo, aderencia_sugerida_llm: a.aderencia_sugerida_llm, ajustes: a.ajustes } };
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
  'vaga.triada': onVaga(triada),
  'vaga.destino_resolvido': onVaga((vaga, dados) => ({ ...vaga, application_url: dados.application_url, destino_pendente: false, portal_candidatura: portalCandidatura({ ...vaga, application_url: dados.application_url }) })),
  'vaga.destino_bloqueado': onVaga((vaga, dados) => ({ ...vaga, destino_bloqueado_em: dados.dia, destino_bloqueio_motivo: dados.motivo })),
  'vaga.avaliada': onVaga(avaliada),
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

// Descarte e candidatura valem para a requisição: a mesma vaga republicada com outro id ou endereço continua descartada ou aplicada.
// A origem pode ser um descarte feito aqui (chave `req:`) ou a marca importada do legado, casada pelas chaves canônicas de portal.
// Vaga importada do legado nunca herda de outra importada: o documento do legado fica como veio (a sombra segue sem diferença).
function origens(state) {
  const descartes = new Map(state.descartes);
  const aplicadas = new Map();
  for (const vaga of state.vagas.values()) {
    const descartada = descartadaDe(vaga);
    const aplicada = aplicadaDe(vaga);
    if (!descartada && !aplicada) continue;
    for (const chave of chavesCanonicas(vaga)) {
      if (descartada && !descartes.has(`can:${chave}`)) descartes.set(`can:${chave}`, { entidade_id: vaga.id, registrado_em: vaga.descarte_usuario.registrado_em });
      if (aplicada && !aplicadas.has(`can:${chave}`)) aplicadas.set(`can:${chave}`, { entidade_id: vaga.id, data: vaga.candidatura_usuario?.data ?? vaga.candidatura_portal?.data ?? vaga.candidatura_email?.data ?? null });
    }
  }
  return { descartes, aplicadas };
}

function inherit(state, indice, vaga) {
  const legado = state.importadas.has(vaga.id);
  const key = requisicaoKey(vaga);
  const chaves = legado ? [] : chavesCanonicas(vaga).map(chave => `can:${chave}`);
  const origem = [key, ...chaves].map(item => (item ? indice.descartes.get(item) : null)).find(item => item && item.entidade_id !== vaga.id);
  let next = clone(vaga);
  // Importada: só herda de descarte feito aqui (comportamento anterior); as demais também herdam do que veio do legado.
  const descarte = legado ? (key ? state.descartes.get(key) : null) : origem;
  if (descarte && descarte.entidade_id !== vaga.id && !vaga.descarte_usuario) {
    next = { ...next, descarte_usuario: { descartada: true, registrado_em: descarte.registrado_em, origem: 'requisicao-descartada', herdado_de: descarte.entidade_id } };
  }
  if (!legado && !aplicadaDe(vaga)) {
    const aplicada = chaves.map(item => indice.aplicadas.get(item)).find(item => item && item.entidade_id !== vaga.id);
    if (aplicada) next = { ...next, candidatura_herdada: { aplicada: true, data: aplicada.data, origem: 'requisicao-aplicada', herdado_de: aplicada.entidade_id } };
  }
  return next;
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
  const indice = state.chaves.includes('vagas') ? origens(state) : null;
  for (const key of state.chaves) {
    if (key === 'vagas') document.vagas = ordered(state.vagas, state.ordemVagas).map(vaga => inherit(state, indice, vaga));
    else if (key === EMAILS) document[EMAILS] = ordered(state.emails, state.ordemEmails).map(clone);
    else if (Object.hasOwn(state.raiz, key)) document[key] = clone(state.raiz[key]);
  }
  return document;
}
