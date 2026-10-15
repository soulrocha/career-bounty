// LinkedIn guest: descoberta pela busca pública, SEM cookie e SEM login. Desligada por padrão.
// Risco assumido pela pessoa (aceite_termos): o robots.txt e os Termos de Uso do LinkedIn proíbem coleta automatizada.
// Regras: teto de 10 requisições por dia, parada no primeiro 429 ou desafio (nunca resolver nem contornar),
// resultado sempre como aparição (a página guest não expõe a URL externa de candidatura).
import { SourceError } from './index.mjs';
import { checkedBase, ENDPOINTS } from './endpoints.mjs';
import { createBudget } from './budget.mjs';
import { antesDaJanela, diaDe } from './common.mjs';
import { getText, realSleep } from './http.mjs';

const TETO_DIARIO = 10;
const SEARCH_PATH = '/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DESAFIO = /http-equiv=["']?refresh|captcha|authwall|challenge/i;

const decode = text => String(text ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const textOf = (html, pattern) => { const m = pattern.exec(html); return m ? decode(m[1].replace(/<[^>]+>/g, ' ')) : ''; };

// Cards da busca guest -> aparições. Remove o querystring de rastreio da URL.
export function parseSearch(html) {
  const out = [];
  for (const card of String(html).split(/<li[\s>]/i).slice(1)) {
    const id = /data-entity-urn="urn:li:jobPosting:(\d+)"/.exec(card)?.[1];
    const cargo = textOf(card, /<h3[^>]*base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i);
    const empresa = textOf(card, /<h4[^>]*base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i);
    const href = /<a[^>]*base-card__full-link[^>]*href="([^"]+)"/i.exec(card)?.[1];
    if (!id || !cargo || !empresa || !href) continue;
    let url;
    try { const parsed = new URL(decode(href)); url = `${parsed.origin}${parsed.pathname}`; } catch { continue; }
    out.push({ portal: 'linkedin', requisicao_id: id, empresa, cargo, local: textOf(card, /<span[^>]*job-search-card__location[^>]*>([\s\S]*?)<\/span>/i) || null,
      url, publicado_em: diaDe(/<time[^>]*datetime="([^"]+)"/i.exec(card)?.[1]), descricao: '', aparicao: true });
  }
  return out;
}

export function createLinkedinGuest(config = {}, deps = {}) {
  const base = checkedBase(config.base_url, ENDPOINTS.linkedin, 'linkedin_guest');
  const sleep = deps.sleep ?? realSleep;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const random = deps.random ?? Math.random;
  return {
    id: 'linkedin_guest',
    async collect(ctx) {
      if (config.ativo !== true || config.aceite_termos !== true) throw new SourceError('desligada', 'LinkedIn guest desligado (exige ativo e aceite_termos no config pessoal)');
      if (!ctx.dataRoot) throw new SourceError('erro', 'DATA_ROOT ausente no contexto da coleta');
      const limite = Math.min(Number.isInteger(config.orcamento_diario) && config.orcamento_diario > 0 ? config.orcamento_diario : TETO_DIARIO, TETO_DIARIO);
      const budget = createBudget({ dataRoot: ctx.dataRoot, nome: 'linkedin', limite, now: ctx.now });
      if ((await budget.state()).bloqueado) throw new SourceError('bloqueio', 'LinkedIn bloqueou a coleta hoje; volta amanhã');
      const termos = config.termos?.length ? config.termos : (ctx.plano?.termos ?? []);
      const [min, max] = Array.isArray(config.espera_s) && config.espera_s.length === 2 ? config.espera_s : [5, 10];
      const porId = new Map();
      const avisos = [];
      let primeira = true;
      busca: for (const termo of termos) {
        if (!(await budget.consume())) { avisos.push('orçamento diário esgotado; requisições restantes ficam para amanhã'); break busca; }
        if (!primeira) await sleep(Math.round((min + random() * (max - min)) * 1000));
        primeira = false;
        const query = new URLSearchParams({ keywords: termo, location: config.local ?? 'Brazil', f_TPR: config.f_TPR ?? 'r86400', start: '0' });
        const resposta = await getText(`${base}${SEARCH_PATH}?${query}`, { fetch: doFetch, sleep, retries: 0, retryOn: () => false, headers: { Accept: 'text/html' }, signal: ctx.signal, gastar: () => budget.consume() });
        if (resposta.status === 429 || resposta.status === 999 || resposta.status === 403 || DESAFIO.test(resposta.text)) {
          await budget.blockForDay();
          throw new SourceError('bloqueio', `LinkedIn respondeu com bloqueio ou desafio (HTTP ${resposta.status}); parado até amanhã`);
        }
        if (resposta.status !== 200) throw new SourceError('http', `HTTP ${resposta.status}`);
        for (const aparicao of parseSearch(resposta.text)) if (!porId.has(aparicao.requisicao_id)) porId.set(aparicao.requisicao_id, aparicao);
      }
      const out = [...porId.values()].filter(vaga => !antesDaJanela(vaga.publicado_em, ctx.janela));
      out.avisos = avisos;
      return out;
    },
  };
}
