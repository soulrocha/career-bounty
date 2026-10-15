// Reconsolidação de descobertas novas sobre o pipeline, sem perder marcações, comprovantes ou histórico.
// Porte de refresh.py `_merged` (parte do pipeline) por caracterização; a golden confere contra o Python.
import { curriculoNecessario, portalCandidatura } from '../apply/portal.mjs';
import { constraints } from '../score/constraints.mjs';
import { idFor, pyOr, pyText, roleKey } from './keys.mjs';

// Campos que a descoberta nunca sobrescreve: pertencem à pessoa, ao comprovante ou ao histórico.
export const CAMPOS_PROTEGIDOS = ['candidatura_simplificada', 'portal_site_confirmado', 'comprovante_envio', 'comprovante', 'cadastro_corrigido', 'pretensao_faixa', 'alerta_pretensao', 'devolutiva_email', 'curriculo', 'candidatura_usuario', 'historico_marcacoes', 'descarte_usuario', 'historico_descartes', 'candidatura_email', 'historico_email', 'candidatura_portal', 'execucao_candidatura'];

const ESTADOS_LINK = ['link-invalido', 'link-indisponivel', 'portal-indisponivel'];
const truthy = value => pyText(value) !== '' || value === true;
const dedupe = list => [...new Set(list)];
const text = (value, fallback = '') => (value === undefined ? fallback : value);
const obj = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

// `pesquisas`: arquivos de pesquisa na ordem de nome; `mtime` é a data (AAAA-MM-DD) do arquivo, usada quando
// a vaga não traz `consultado_em`. `historico` é o backup inicial (quando ausente, o próprio pipeline).
export function mergePipeline({ pipeline, historico, pesquisas = [], ajustes = [], config, hoje, aliases = {} }) {
  const keyOf = job => roleKey(job, { aliases });
  const history = historico ?? pipeline.vagas;
  const historicalKeys = new Set(history.map(keyOf));
  const original = new Map();
  for (const job of structuredClone(pipeline.vagas)) original.set(keyOf(job), job);
  const research = new Map();
  const coverage = [];
  for (const file of pesquisas) {
    coverage.push(...(file.cobertura ?? []));
    for (const source of structuredClone(file.vagas ?? [])) {
      let job = source;
      if (!Object.hasOwn(job, 'consultado_em')) job.consultado_em = file.mtime;
      const key = keyOf(job);
      if (research.has(key)) {
        const prior = research.get(key);
        if (String(text(prior.consultado_em)) > String(text(job.consultado_em))) job = { ...job, ...prior };
        job.fontes = dedupe([...(prior.fontes ?? []), ...(job.fontes ?? [])]);
        job.republicacoes = [...(prior.republicacoes ?? []), { empresa: prior.empresa ?? null, url: prior.url ?? null, cargo: prior.cargo ?? null }];
        if (String(text(prior.descricao_completa)).length > String(text(job.descricao_completa)).length) job.descricao_completa = prior.descricao_completa;
      }
      research.set(key, job);
    }
  }
  for (const change of ajustes) {
    const job = research.get(keyOf(change));
    if (!job) continue;
    for (const field of ['aderencia', 'descricao_completa', 'requisitos']) if (Object.hasOwn(change, field)) job[field] = change[field];
    for (const field of ['lacunas', 'pendencias']) job[field] = dedupe([...(job[field] ?? []), ...(change[field] ?? [])]);
    job.revisao_independente = 'revisao-independente.md';
  }
  for (const [key, job] of research) {
    const old = original.get(key) ?? {};
    job.id = pyOr(old.id, job.id) || idFor(job, { aliases });
    const execution = obj(old.execucao_candidatura);
    if (String(text(execution.data)) >= String(job.consultado_em === undefined ? '' : job.consultado_em).slice(0, 10)) {
      if (execution.estado === 'encerrada') job.url_status = 'encerrada';
      else if (ESTADOS_LINK.includes(execution.estado)) job.url_status = 'inacessivel';
    }
    const state = text(execution.estado);
    if ((String(state).startsWith('pendente-') || ESTADOS_LINK.includes(state)) && truthy(execution.motivo)) {
      job.pendencias = dedupe([`Candidatura: ${execution.motivo}`, ...(job.pendencias ?? [])]);
    }
    job.condicoes = constraints(job, config);
    if (job.condicoes.situacao === 'incompativel') job.aderencia = 'incompativel';
    if (job.url_status !== 'aberta' && job.aderencia === 'alta') job.aderencia = 'condicional';
    if ((job.requisitos ?? []).some(r => r.tipo === 'obrigatorio' && r.avaliacao === 'nao-atendido') && job.aderencia === 'alta') job.aderencia = 'condicional';
    job.historico_anterior = historicalKeys.has(key) || truthy(obj(old.candidatura_email).aplicada) || truthy(obj(old.candidatura_portal).aplicada);
    job.historico = job.historico_anterior || truthy(obj(old.candidatura_usuario).aplicada);
    job.status = pyOr(old.status) || (job.url_status === 'encerrada' ? 'anuncio-encerrado' : 'avaliada-sem-envio');
    if (String(state).startsWith('pendente-') && !job.historico) job.status = `candidatura-${state}`;
    else if (ESTADOS_LINK.includes(state) && !job.historico) job.status = `candidatura-${state}`;
    for (const field of CAMPOS_PROTEGIDOS) if (Object.hasOwn(old, field)) job[field] = old[field];
    // Só um destino observado em consulta estritamente posterior substitui o anterior.
    if (truthy(old.application_url) && (!truthy(job.application_url) || String(text(job.consultado_em)) <= String(text(old.consultado_em)))) job.application_url = old.application_url;
    original.set(key, { ...old, ...job });
  }
  for (const job of original.values()) {
    job.portal_candidatura = portalCandidatura(job, config);
    job.curriculo_necessario = curriculoNecessario(job, config);
    const key = keyOf(job);
    if (research.has(key)) research.set(key, job);
  }
  const vagas = [...original.values()];
  const merged = { ...pipeline, vagas, atualizado: hoje };
  const aplicada = campo => truthy(obj(campo).aplicada);
  const resumo = [...original.entries()].filter(([key, job]) => historicalKeys.has(key) || aplicada(job.candidatura_email) || aplicada(job.candidatura_usuario) || aplicada(job.candidatura_portal)).map(([, job]) => job);
  return { pipeline: merged, pesquisadas: [...research.values()], historico: resumo, cobertura: coverage };
}
