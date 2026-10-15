// Cliente HTTP das fontes: sem cookie, sem credencial, com repetição limitada e pausa entre chamadas.
import { SourceError } from './index.mjs';

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PROIBIDOS = /^(cookie|authorization|proxy-authorization|x-api-key)$/i;

export const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Cabeçalhos que identificam a pessoa nunca saem daqui.
export function safeHeaders(headers = {}) {
  for (const name of Object.keys(headers)) if (PROIBIDOS.test(name)) throw new Error(`Cabeçalho proibido em coleta pública: ${name}`);
  return { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers };
}

// Repete 429 e 5xx com espera crescente e limitada; depois vira SourceError.
// Redirect é manual: cada salto confere o host contra a allowlist (`hosts`, por padrão só o host do pedido), respeita `maxSaltos`
// e gasta uma unidade do orçamento da fonte (`gastar`) antes de ser seguido. Rebaixar de https para http é recusado.
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function getText(url, { fetch: doFetch = globalThis.fetch, hosts, maxSaltos = 3, gastar, headers, retries = 2, backoffMs = 500, maxBackoffMs = 4000, timeoutMs = 20000, signal, sleep = realSleep, retryOn = status => status === 429 || status >= 500 } = {}) {
  const h = safeHeaders(headers);
  let espera = backoffMs;
  let atual = new URL(url);
  const permitidos = new Set((hosts ?? [atual.host]).map(host => host.toLowerCase()));
  let saltos = 0;
  for (let tentativa = 0; ; tentativa++) {
    let response;
    try {
      response = await doFetch(atual.href, { headers: h, redirect: 'manual', signal: signal ?? AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (signal?.aborted) throw new SourceError('timeout', 'requisição cancelada por tempo esgotado');
      throw new SourceError('rede', `falha de rede: ${error.cause?.code ?? error.message}`);
    }
    if (REDIRECTS.has(response.status) && response.headers.get('location')) {
      let destino;
      try { destino = new URL(response.headers.get('location'), atual); } catch { throw new SourceError('redirect_bloqueado', 'redirect com endereço inválido'); }
      if (!permitidos.has(destino.host.toLowerCase())) throw new SourceError('redirect_bloqueado', `redirect para host fora da allowlist (${destino.hostname})`);
      if (atual.protocol === 'https:' && destino.protocol !== 'https:') throw new SourceError('redirect_bloqueado', 'redirect rebaixa HTTPS para HTTP');
      if (saltos >= maxSaltos) throw new SourceError('redirect_bloqueado', `mais de ${maxSaltos} saltos de redirect`);
      if (gastar && !(await gastar())) throw new SourceError('limite', 'orçamento da fonte esgotado no redirect');
      saltos += 1;
      atual = destino;
      tentativa -= 1;
      continue;
    }
    if (retryOn(response.status)) {
      if (tentativa >= retries) throw new SourceError(response.status === 429 ? 'limite' : 'http', `HTTP ${response.status}`);
      await sleep(espera);
      espera = Math.min(espera * 2, maxBackoffMs);
      continue;
    }
    return { status: response.status, text: await response.text(), headers: response.headers };
  }
}

export async function getJson(url, options) {
  const { status, text } = await getText(url, options);
  if (status >= 400) throw new SourceError('http', `HTTP ${status}`);
  try { return JSON.parse(text); } catch { throw new SourceError('estrutura_mudou', 'resposta não é JSON'); }
}
