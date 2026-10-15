import { appendEvents, readEvents } from '../store/events.mjs';
import { EMAILS, emailKeys, projectEvents } from '../store/project.mjs';
import { semanticHash } from '../store/canonicalize.mjs';

export function validatePipeline(pipeline) {
  if (!pipeline || typeof pipeline !== 'object' || Array.isArray(pipeline) || !Array.isArray(pipeline.vagas)) {
    throw new Error('Pipeline inválido: objeto raiz deve conter vagas como lista.');
  }
  const ids = new Set();
  for (const vaga of pipeline.vagas) {
    if (!vaga || typeof vaga !== 'object' || typeof vaga.id !== 'string' || !vaga.id.trim() || ids.has(vaga.id)) {
      throw new Error('Pipeline inválido: cada vaga exige ID textual não vazio e único.');
    }
    ids.add(vaga.id);
  }
  if (pipeline[EMAILS] !== undefined && (!Array.isArray(pipeline[EMAILS]) || pipeline[EMAILS].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) {
    throw new Error('Pipeline inválido: eventos_email_sem_requisicao deve ser lista de objetos.');
  }
}

// Campos canônicos extraídos da vaga legada, para consulta sem reler o objeto inteiro.
export function canonicos(vaga) {
  return { id: vaga.id, empresa: vaga.empresa ?? null, cargo: vaga.cargo ?? null, requisicao_id: vaga.requisicao_id ?? vaga.id_requisicao ?? null, portal: vaga.portal_candidatura ?? null, aderencia: vaga.aderencia ?? null };
}

function changes(before, after) {
  const campos = {};
  const removidos = [];
  for (const key of Object.keys(after)) {
    if (!Object.hasOwn(before, key) || semanticHash(before[key]) !== semanticHash(after[key])) campos[key] = after[key];
  }
  for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) removidos.push(key);
  return { campos, removidos };
}

const rootOf = document => Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'vagas' && key !== EMAILS));

// Compara o legado com a projeção atual e grava só o que falta, como eventos.
// Nunca apaga: vaga que sumiu do legado fica na projeção e é reportada em `ausentes`.
export async function importPipeline({ dataRoot, pipeline, ts = new Date().toISOString(), host, onAusentes = 'ignorar', dryRun = false }) {
  validatePipeline(pipeline);
  const { eventos, avisos } = await readEvents(dataRoot);
  if (avisos.length) throw new Error(`Log de eventos truncado ou corrompido (${avisos.length} aviso(s)); revisão necessária.`);
  const current = projectEvents(eventos);
  const version = (types, key) => eventos.filter(event => types.includes(event.tipo) && event.entidade_id === key).length + 1;
  const currentVagas = new Map(current.vagas.map(item => [item.id, item]));
  const incomingIds = new Set(pipeline.vagas.map(item => item.id));
  const ausentes = [...currentVagas.keys()].filter(id => !incomingIds.has(id));
  if (onAusentes === 'erro' && ausentes.length) throw new Error(`IDs ausentes ou redução de vagas (${ausentes.length}); revisão necessária em modo sombra (para aceitar o desaparecimento, use --aceitar-ausentes).`);

  const planned = [];
  const raiz = rootOf(pipeline);
  const raizAtual = rootOf(current);
  if (semanticHash(raiz) !== semanticHash(raizAtual) || JSON.stringify(Object.keys(current)) !== JSON.stringify(Object.keys(pipeline))) {
    const { campos, removidos } = changes(raizAtual, raiz);
    const n = eventos.filter(event => event.tipo === 'pipeline.raiz').length + 1;
    planned.push({ id: `raiz:v${n}`, tipo: 'pipeline.raiz', entidade: 'pipeline', entidade_id: 'legado', dados: { campos, removidos, chaves: Object.keys(pipeline) } });
  }
  const resumo = { vagasNovas: 0, vagasAtualizadas: 0, emailsNovos: 0, emailsAtualizados: 0 };
  for (const vaga of pipeline.vagas) {
    const before = currentVagas.get(vaga.id);
    const hash = semanticHash(vaga);
    const id = `vaga:${vaga.id}:v${version(['vaga.importada', 'vaga.atualizada'], vaga.id)}`;
    if (!before) {
      resumo.vagasNovas += 1;
      planned.push({ id, tipo: 'vaga.importada', entidade: 'vaga', entidade_id: vaga.id, dados: { legado: vaga, canonicos: canonicos(vaga), hash } });
    } else if (semanticHash(before) !== hash) {
      resumo.vagasAtualizadas += 1;
      const { campos, removidos } = changes(before, vaga);
      planned.push({ id, tipo: 'vaga.atualizada', entidade: 'vaga', entidade_id: vaga.id, dados: { campos, removidos, hash } });
    }
  }
  const items = pipeline[EMAILS] ?? [];
  const keys = emailKeys(items);
  const currentItems = current[EMAILS] ?? [];
  const currentEmails = new Map(emailKeys(currentItems).map((key, index) => [key, currentItems[index]]));
  keys.forEach((key, index) => {
    const item = items[index];
    const before = currentEmails.get(key);
    const hash = semanticHash(item);
    const n = eventos.filter(event => ['email_evento.importado', 'email_evento.atualizado'].includes(event.tipo) && event.entidade_id === key).length + 1;
    if (!before) {
      resumo.emailsNovos += 1;
      planned.push({ id: `email:${key}:v${n}`, tipo: 'email_evento.importado', entidade: 'email_sem_requisicao', entidade_id: key, dados: { legado: item, hash } });
    } else if (semanticHash(before) !== hash) {
      resumo.emailsAtualizados += 1;
      const { campos, removidos } = changes(before, item);
      planned.push({ id: `email:${key}:v${n}`, tipo: 'email_evento.atualizado', entidade: 'email_sem_requisicao', entidade_id: key, dados: { campos, removidos, hash } });
    }
  });

  const full = planned.map(event => ({ ator: 'migration', evidencia: [], ...event }));
  // A ordem do legado faz parte do documento: se a projeção resultante ficar fora de ordem, registra.
  const after = projectEvents([...eventos, ...full.map((event, index) => ({ ...event, ts, host: host ?? 'host', seq: index }))]);
  const wantVagas = pipeline.vagas.map(item => item.id);
  const haveVagas = after.vagas.map(item => item.id).filter(id => incomingIds.has(id));
  const haveEmails = emailKeys(after[EMAILS] ?? []).filter(key => keys.includes(key));
  if (JSON.stringify(wantVagas) !== JSON.stringify(haveVagas) || JSON.stringify(keys) !== JSON.stringify(haveEmails)) {
    const n = eventos.filter(event => event.tipo === 'pipeline.ordem').length + 1;
    full.push({ ator: 'migration', evidencia: [], id: `ordem:v${n}`, tipo: 'pipeline.ordem', entidade: 'pipeline', entidade_id: 'legado', dados: { vagas: [...wantVagas, ...ausentes], emails: keys } });
  }
  if (dryRun) return { eventsAdded: 0, planejados: full.length, ausentes, ...resumo };
  const result = await appendEvents(dataRoot, full, { host, now: ts });
  return { eventsAdded: result.events.length, ausentes, ...resumo };
}
