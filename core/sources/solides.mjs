// Solides Vagas: API pública same-origin com busca por título. Ordenada por data decrescente.
// take acima de 14 devolve 500, então a página é fixa em 14. A URL pública usa /vaga/<id> (redirectLink vem quebrado).
import { SourceError } from './index.mjs';
import { checkedBase, ENDPOINTS } from './endpoints.mjs';
import { antesDaJanela, diaDe, semHtml } from './common.mjs';
import { getJson, realSleep } from './http.mjs';

const POR_PAGINA = 14;
const MODALIDADES = { presencial: 'presencial', hibrido: 'hibrido', remoto: 'remoto' };

function regimeDe(lista) {
  const texto = String(Array.isArray(lista) ? lista.join(' ') : '').toLowerCase();
  if (/\bclt\b/.test(texto)) return 'CLT';
  if (/pessoa jur[ií]dica|\bpj\b/.test(texto)) return 'PJ';
  return null;
}

export function normalizeSolides(item) {
  if (!item || typeof item !== 'object' || item.id === undefined) return null;
  if (item.currentState !== 'em_andamento' || item.isDisabled === true) return null;
  const empresa = typeof item.companyName === 'string' ? item.companyName.trim() : '';
  const cargo = typeof item.title === 'string' ? item.title.trim() : '';
  if (!empresa || !cargo) return null;
  const salario = item.salary ?? {};
  const local = [item.city?.name, item.state?.code].filter(Boolean).join(', ');
  return { portal: 'solides', requisicao_id: String(item.id), empresa, cargo, local: local || null,
    modalidade: item.homeOffice === true && !item.jobType ? 'remoto' : (MODALIDADES[item.jobType] ?? null), regime: regimeDe(item.recruitmentContractType),
    salario_min: salario.initialRange > 0 ? salario.initialRange : null, salario_max: salario.finalRange > 0 ? salario.finalRange : null,
    url: `${ENDPOINTS.solides}/vaga/${item.id}`, publicado_em: diaDe(item.createdAt), descricao: semHtml(item.description) };
}

export function createSolides(config = {}, deps = {}) {
  const base = checkedBase(config.base_url, ENDPOINTS.solides, 'solides');
  const sleep = deps.sleep ?? realSleep;
  const doFetch = deps.fetch ?? globalThis.fetch;
  return {
    id: 'solides',
    async collect(ctx) {
      const termos = config.termos?.length ? config.termos : (ctx.plano?.termos ?? []);
      if (!termos.length) { const vazio = []; vazio.avisos = ['solides: nenhum termo de busca configurado']; return vazio; }
      const maxPaginas = config.max_paginas_por_termo ?? 3;
      const porId = new Map();
      const avisos = [];
      let sucessos = 0;
      let ultimoErro = null;
      for (const termo of termos) {
        let ok = false;
        for (let page = 1; page <= maxPaginas; page++) {
          const query = new URLSearchParams({ page: String(page), take: String(POR_PAGINA), title: termo });
          let json;
          try { json = await getJson(`${base}/api/vacancies?${query}`, { fetch: doFetch, sleep, retries: config.tentativas ?? 1, signal: ctx.signal }); }
          catch (error) {
            if (error.codigo === 'estrutura_mudou') throw error;
            ultimoErro = error;
            avisos.push(`${termo}: ${error.message}`);
            break;
          }
          if (!json || typeof json !== 'object' || !Array.isArray(json.data) || typeof json.count !== 'number') throw new SourceError('estrutura_mudou', 'resposta sem data[] ou count');
          ok = true;
          for (const item of json.data) {
            const vaga = normalizeSolides(item);
            if (vaga && !porId.has(vaga.requisicao_id)) porId.set(vaga.requisicao_id, vaga);
          }
          const ultima = diaDe(json.data.at(-1)?.createdAt);
          if (!json.data.length || page >= (json.totalPages ?? 1) || antesDaJanela(ultima, ctx.janela)) break;
          await sleep(config.espera_ms ?? 2000);
        }
        if (ok) sucessos += 1;
        await sleep(config.espera_ms ?? 2000);
      }
      if (!sucessos && ultimoErro) throw ultimoErro;
      const out = [...porId.values()].filter(vaga => !antesDaJanela(vaga.publicado_em, ctx.janela));
      out.avisos = avisos;
      return out;
    },
  };
}
