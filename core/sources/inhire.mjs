// Inhire: API pública por empresa (tenant), sem autenticação. O tenant é o subdomínio da página de carreira.
// Fluxo: valida o tenant, lê a lista, busca o detalhe só das vagas ainda desconhecidas e filtra pela janela.
import { SourceError } from './index.mjs';
import { checkedBase, ENDPOINTS } from './endpoints.mjs';
import { antesDaJanela, diaDe, semHtml } from './common.mjs';
import { getJson, realSleep } from './http.mjs';

const MODALIDADES = { remote: 'remoto', hybrid: 'hibrido', 'on-site': 'presencial', onsite: 'presencial' };
const REGIMES = { clt: 'CLT', pj: 'PJ' };
const TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function createInhire(config = {}, deps = {}) {
  const base = checkedBase(config.base_url, ENDPOINTS.inhire, 'inhire');
  const sleep = deps.sleep ?? realSleep;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const espera = () => sleep(config.espera_ms ?? 2000);

  async function coletarTenant(tenant, ctx, conhecidas) {
    const opcoes = { fetch: doFetch, sleep, retries: config.tentativas ?? 1, signal: ctx.signal };
    let resolvido;
    try { resolvido = await getJson(`${base}/tenants/public/config/resolve/${encodeURIComponent(tenant)}`, opcoes); }
    catch (error) { throw new SourceError('tenant_invalido', `tenant ${tenant} não encontrado (${error.message})`); }
    if (resolvido?.tenant?.id !== tenant) throw new SourceError('tenant_invalido', `tenant ${tenant} não confere com a resposta`);
    await espera();
    const pagina = await getJson(`${base}/job-posts/public/pages`, { ...opcoes, headers: { 'X-Tenant': tenant } });
    if (!pagina || !Array.isArray(pagina.jobsPage)) throw new SourceError('estrutura_mudou', 'lista de vagas sem jobsPage');
    const out = [];
    for (const item of pagina.jobsPage) {
      if (!item || typeof item.jobId !== 'string' || typeof item.displayName !== 'string') throw new SourceError('estrutura_mudou', 'item de vaga sem jobId ou displayName');
      if (item.status !== 'published' || conhecidas.has(item.jobId)) continue;
      await espera();
      const detalhe = await getJson(`${base}/job-posts/public/pages/${encodeURIComponent(item.jobId)}`, { ...opcoes, headers: { 'X-Tenant': tenant } });
      const publicado = diaDe(detalhe?.publishedAt ?? detalhe?.createdAt);
      if (antesDaJanela(publicado, ctx.janela)) continue;
      out.push({ portal: 'inhire', requisicao_id: item.jobId, empresa: pagina.tenantName ?? resolvido.tenant.name, cargo: detalhe?.displayName ?? item.displayName,
        local: detalhe?.location ?? item.location ?? null, modalidade: MODALIDADES[String(detalhe?.workplaceType ?? item.workplaceType).toLowerCase()] ?? null,
        regime: REGIMES[String(detalhe?.contractType?.[0] ?? '').toLowerCase()] ?? null, url: `https://${tenant}.inhire.app/vagas/${item.jobId}`,
        publicado_em: publicado, descricao: semHtml(detalhe?.description) });
    }
    return out;
  }

  return {
    id: 'inhire',
    async collect(ctx) {
      const tenants = (config.tenants ?? []).filter(item => typeof item === 'string' && TENANT.test(item));
      const conhecidas = ctx.conhecidas?.get('inhire') ?? new Set();
      const avisos = [];
      const vagas = [];
      let sucessos = 0;
      let ultimoErro = null;
      if (!tenants.length) { const vazio = []; vazio.avisos = ['inhire: nenhum tenant configurado']; return vazio; }
      for (const tenant of tenants) {
        try { vagas.push(...await coletarTenant(tenant, ctx, conhecidas)); sucessos += 1; }
        catch (error) {
          if (error.codigo === 'estrutura_mudou') throw error;
          ultimoErro = error;
          avisos.push(`${tenant}: ${error.message}`);
        }
        await espera();
      }
      if (!sucessos && ultimoErro) throw ultimoErro;
      vagas.avisos = avisos;
      return vagas;
    },
  };
}
