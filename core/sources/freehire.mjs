// Freehire: API REST pública de busca de vagas (sem chave). Implementação própria do contrato público
// descrito na skill freehire-search (MIT, ver NOTICE). Até 3 páginas de 20 por consulta.
import { SourceError } from './index.mjs';
import { checkedBase, ENDPOINTS } from './endpoints.mjs';
import { antesDaJanela, diaDe, modalidadeDe, requisicaoDaUrl, semHtml } from './common.mjs';
import { getJson, realSleep } from './http.mjs';

const SEARCH_PATH = ['', 'api', 'v1', 'agent', 'jobs', 'search'].join('/');
const POR_PAGINA = 20;
const MAX_PAGINAS = 3;
const DIA = 86400000;

const MODOS = { remote: 'remoto', hybrid: 'hibrido', onsite: 'presencial' };

export function normalizeFreehire(j) {
  if (!j || typeof j !== 'object') return null;
  const cargo = typeof j.title === 'string' ? j.title.trim() : '';
  const empresa = typeof j.company === 'string' ? j.company.trim() : '';
  if (!cargo || !empresa || typeof j.url !== 'string') return null;
  const { portal, requisicao_id } = requisicaoDaUrl(j.url);
  const e = j.enrichment ?? {};
  return { portal, requisicao_id, empresa, cargo, local: j.location || null, modalidade: MODOS[j.work_mode] ?? modalidadeDe(j.location),
    regime: null, salario_min: typeof e.salary_min === 'number' ? e.salary_min : null, salario_max: typeof e.salary_max === 'number' ? e.salary_max : null,
    url: j.url, publicado_em: diaDe(j.posted_at), descricao: semHtml(j.description) };
}

export function createFreehire(config = {}, deps = {}) {
  const base = checkedBase(config.base_url, ENDPOINTS.freehire, 'freehire');
  const sleep = deps.sleep ?? realSleep;
  const doFetch = deps.fetch ?? globalThis.fetch;
  return {
    id: 'freehire',
    async collect(ctx) {
      const termos = config.termos?.length ? config.termos : (ctx.plano?.termos ?? []);
      if (!termos.length) { const vazio = []; vazio.avisos = ['freehire: nenhum termo de busca configurado']; return vazio; }
      const dias = Math.max(1, Math.round((Date.parse(`${ctx.janela.fim}T00:00:00Z`) - Date.parse(`${ctx.janela.inicio}T00:00:00Z`)) / DIA));
      const porUrl = new Map();
      const avisos = [];
      let sucessos = 0;
      let ultimoErro = null;
      for (const termo of termos) {
        let anterior = null;
        let ok = false;
        for (let pagina = 0; pagina < (config.max_paginas ?? MAX_PAGINAS); pagina++) {
          const query = new URLSearchParams({ q: termo, limit: String(POR_PAGINA), offset: String(pagina * POR_PAGINA), semantic_ratio: '0',
            include_description: 'true', description_format: 'text', posted_within_days: String(dias), countries: config.pais ?? 'BR' });
          let json;
          try { json = await getJson(`${base}${SEARCH_PATH}?${query}`, { fetch: doFetch, sleep, retries: config.tentativas ?? 2, signal: ctx.signal }); }
          catch (error) {
            if (error.codigo === 'estrutura_mudou') throw error;
            ultimoErro = error;
            avisos.push(`${termo}: ${error.message}`);
            break;
          }
          if (!json || typeof json !== 'object' || !Array.isArray(json.data)) throw new SourceError('estrutura_mudou', `resposta inesperada para "${termo}": faltou data[]`);
          ok = true;
          const assinatura = json.data.map(item => item?.public_slug ?? item?.url).join('|');
          if (!json.data.length || assinatura === anterior) break;
          anterior = assinatura;
          for (const item of json.data) {
            const vaga = normalizeFreehire(item);
            if (vaga && !porUrl.has(vaga.url)) porUrl.set(vaga.url, vaga);
          }
          if (json.data.length < POR_PAGINA) break;
          await sleep(config.espera_ms ?? 300);
        }
        if (ok) sucessos += 1;
        await sleep(config.espera_ms ?? 300);
      }
      if (!sucessos && ultimoErro) throw ultimoErro;
      const out = [...porUrl.values()].filter(vaga => !antesDaJanela(vaga.publicado_em, ctx.janela));
      out.avisos = avisos;
      return out;
    },
  };
}
