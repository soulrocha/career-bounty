// Gupy: busca pública por palavra-chave em todas as empresas da plataforma.
// Implementação própria do contrato público, modelada no provider de mesmo nome do career-ops (MIT, ver NOTICE).
//  - pagination.total não é confiável: o fim do feed é a página curta.
//  - limite do servidor: 100 por página; ordem por publishedDate decrescente (permite parar pela janela).
//  - vaga sigilosa e URL fora de *.gupy.io são descartadas.
import { SourceError } from './index.mjs';
import { checkedBase, ENDPOINTS } from './endpoints.mjs';
import { antesDaJanela, diaDe, semHtml } from './common.mjs';
import { getJson, realSleep } from './http.mjs';

const MARGEM_DIAS = 2;
const SIGILOSA = /^(?:empresa\s+)?confid\w*$/i;
const MODALIDADES = { remote: 'remoto', hybrid: 'hibrido', 'on-site': 'presencial' };

const urlSegura = valor => {
  try {
    const url = new URL(String(valor).trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'gupy.io' || host.endsWith('.gupy.io')) ? `${url.origin}${url.pathname}` : null;
  } catch { return null; }
};

function linhas(json, termo, pagina) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.data)) {
    throw new SourceError('estrutura_mudou', `resposta inesperada para "${termo}" na página ${pagina}: faltou data[]`);
  }
  return json.data;
}

export function normalizeGupy(item) {
  if (!item || typeof item !== 'object' || item.isConfidentialCareerPage === true) return null;
  const cargo = typeof item.name === 'string' ? item.name.trim() : '';
  const empresa = typeof item.careerPageName === 'string' ? item.careerPageName.trim() : '';
  const url = urlSegura(item.jobUrl);
  if (!cargo || !empresa || SIGILOSA.test(empresa) || !url) return null;
  const id = /\/jobs\/(\d+)/.exec(url)?.[1] ?? (item.id === undefined ? null : String(item.id));
  const local = ['city', 'state'].map(campo => (typeof item[campo] === 'string' ? item[campo].trim() : '')).filter(Boolean).join(', ');
  return { portal: 'gupy', requisicao_id: id, empresa, cargo, local: local || null,
    modalidade: MODALIDADES[item.workplaceType] ?? (item.isRemoteWork === true ? 'remoto' : null),
    regime: item.type === 'vacancy_type_effective' ? 'CLT' : null, url, publicado_em: diaDe(item.publishedDate), descricao: semHtml(item.description) };
}

export function createGupy(config = {}, deps = {}) {
  const base = checkedBase(config.base_url, ENDPOINTS.gupy, 'gupy');
  const sleep = deps.sleep ?? realSleep;
  const doFetch = deps.fetch ?? globalThis.fetch;
  return {
    id: 'gupy',
    async collect(ctx) {
      const termos = config.termos?.length ? config.termos : (ctx.plano?.termos ?? []);
      const avisos = [];
      if (!termos.length) { const vazio = []; vazio.avisos = ['gupy: nenhum termo de busca configurado']; return vazio; }
      const pagina = Math.min(config.pagina ?? 100, 100);
      let orcamento = config.max_paginas ?? 5 * termos.length;
      const piso = Date.parse(`${ctx.janela.inicio}T00:00:00Z`) - MARGEM_DIAS * 86400000;
      const porUrl = new Map();
      let sucessos = 0;
      let ultimoErro = null;
      for (const termo of termos) {
        let offset = 0;
        let varreduraOk = false;
        while (orcamento > 0) {
          orcamento -= 1;
          let json;
          try {
            const query = new URLSearchParams({ jobName: termo, limit: String(pagina), offset: String(offset) });
            json = await getJson(`${base}?${query}`, { fetch: doFetch, sleep, retries: config.tentativas ?? 2, signal: ctx.signal });
          } catch (error) {
            if (error.codigo === 'estrutura_mudou') throw error;
            ultimoErro = error;
            avisos.push(`${termo}: ${error.message}`);
            break;
          }
          varreduraOk = true;
          const rows = linhas(json, termo, offset / pagina);
          const mapeadas = rows.map(normalizeGupy).filter(Boolean);
          for (const vaga of mapeadas) if (!porUrl.has(vaga.url)) porUrl.set(vaga.url, vaga);
          const datas = rows.map(row => Date.parse(row?.publishedDate)).filter(Number.isFinite);
          const passouDaJanela = datas.length > 0 && Math.min(...datas) < piso;
          if (rows.length < pagina || passouDaJanela) break;
          offset += pagina;
          await sleep(config.espera_ms ?? 200);
        }
        if (varreduraOk) sucessos += 1;
        await sleep(config.espera_ms ?? 200);
      }
      if (!sucessos && ultimoErro) throw ultimoErro;
      const out = [...porUrl.values()].filter(vaga => !antesDaJanela(vaga.publicado_em, ctx.janela));
      out.avisos = avisos;
      return out;
    },
  };
}
