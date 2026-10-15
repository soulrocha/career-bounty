// Chaves de deduplicação portadas de refresh.py (role_key, canonicalUrl, company_key, id_for), por caracterização.
import { createHash } from 'node:crypto';
import { b64decode, parseQsl, urlencode, urlsplit, urlunsplit } from './pyurl.mjs';

// `str(x or '')` do Python: valores "falsos" viram texto vazio.
export function pyText(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return '';
  if (Array.isArray(value) && value.length === 0) return '';
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return '';
  if (value === true) return 'True';
  return String(value);
}

// Verdade do Python: 0, '', [], {}, None e False são falsos.
export const pyOr = (...values) => values.find(value => pyText(value) !== '' || value === true) ?? '';

export function fold(value) {
  return pyText(value).toLowerCase().normalize('NFKD').replace(/\p{Mn}/gu, '');
}

const KEEP = new Set(['gh_jid', 'jobId', 'id', 'jk']);

export function canonicalUrl(url) {
  const parts = urlsplit(pyOr(url));
  const query = urlencode(parseQsl(parts.query).filter(([key]) => KEEP.has(key)));
  return urlunsplit({ scheme: parts.scheme.toLowerCase(), netloc: parts.netloc.toLowerCase(), path: parts.path.replace(/\/+$/, ''), query, fragment: '' });
}

// Apelidos de empresa (ex.: grafias da mesma marca) vêm da configuração privada, nunca do código.
export function companyKey(name, aliases = {}) {
  const folded = fold(name);
  return Object.hasOwn(aliases, folded) ? aliases[folded] : folded.replace(/[^a-z0-9]/g, '');
}

const PROVIDERS = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'inhire.app', 'quickin.io', 'infojobs.com.br', 'jobs.deel.com'];

function gupyEncodedId(segment) {
  try {
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64decode(`${segment}===`)));
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.jobId && (typeof raw.jobId === 'string' || Number.isInteger(raw.jobId))) return `gupy:${raw.jobId}`;
  } catch { /* igual ao `except Exception: pass` do legado */ }
  return null;
}

export function roleKey(job, { aliases = {} } = {}) {
  const j = job ?? {};
  const u = canonicalUrl(j.url ?? '');
  if (u.includes('.gupy.io/')) {
    const jobs = u.match(/\/jobs\/(\d+)/);
    if (jobs) return `gupy:${jobs[1]}`;
    const encoded = u.match(/\/job\/([^/?]+)/);
    if (encoded) {
      const key = gupyEncodedId(encoded[1]);
      if (key) return key;
    }
  }
  const ids = u.match(/[0-9a-f]{8}-[0-9a-f-]{27,}|(?<!\d)\d{5,}(?!\d)/g) ?? [];
  const host = urlsplit(u).netloc;
  for (const provider of PROVIDERS) if (host.includes(provider) && ids.length) return `${provider}:${ids.at(-1)}`;
  if (!ids.length && u) return `url:${u}`;
  return `${companyKey(j.empresa ?? '', aliases)}:${ids.length ? ids.at(-1) : fold(j.cargo ?? '')}`;
}

export function idFor(job, options) {
  const j = job ?? {};
  const slug = fold(Object.hasOwn(j, 'empresa') ? j.empresa : 'empresa').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug}-${createHash('sha256').update(roleKey(j, options)).digest('hex').slice(0, 10)}`;
}

// Chave canônica de portal ("portal:requisição"): a mesma forma que a coleta grava, venha a vaga do legado ou de uma fonte.
export const PORTAL_DO_PROVEDOR = { 'greenhouse.io': 'greenhouse', 'lever.co': 'lever', 'ashbyhq.com': 'ashby', 'inhire.app': 'inhire', 'quickin.io': 'quickin', 'infojobs.com.br': 'infojobs', 'jobs.deel.com': 'deel' };

export function normalizarChave(chave) {
  const match = /^([a-z.]+):(.+)$/i.exec(String(chave ?? ''));
  if (!match || match[1].toLowerCase() === 'url') return null;
  const portal = match[1].toLowerCase();
  return `${PORTAL_DO_PROVEDOR[portal] ?? portal}:${match[2]}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f-]{27,}';

// Chave de portal derivada só do endereço (Gupy direto ou codificado, Greenhouse, Lever, Ashby, Inhire, Solides, LinkedIn...). Vazio quando a URL não traz identificador.
export function chaveDaUrl(url) {
  let parts;
  try { parts = urlsplit(pyOr(url)); } catch { return null; }
  const host = (parts.netloc ?? '').toLowerCase();
  const caminho = parts.path ?? '';
  if (host.endsWith('linkedin.com')) {
    const id = /\/jobs\/view\/(?:[^/?#]*[^0-9/?#])?(\d{6,})\/?$/.exec(caminho)?.[1];
    return id ? `linkedin:${id}` : null;
  }
  if (host.endsWith('inhire.app')) {
    const id = new RegExp(`/vagas/(${UUID})`, 'i').exec(caminho)?.[1];
    if (id) return `inhire:${id.toLowerCase()}`;
  }
  if (host.includes('solides')) {
    const id = /\/vaga\/(\d+)/.exec(caminho)?.[1];
    if (id) return `solides:${id}`;
  }
  return normalizarChave(roleKey({ url: pyOr(url) }));
}

const portalDeChave = chave => chave?.split(':')[0] ?? null;

// Todas as chaves de portal pelas quais uma vaga (do legado, da projeção ou da coleta) pode ser reconhecida.
export function chavesCanonicas(vaga) {
  const j = vaga ?? {};
  const chaves = new Set();
  const urls = [j.url, j.application_url, j.url_portal_oficial, ...(Array.isArray(j.aparicoes) ? j.aparicoes.map(item => item?.url) : [])];
  const dasUrls = urls.filter(url => typeof url === 'string' && url).map(chaveDaUrl).filter(Boolean);
  for (const chave of dasUrls) chaves.add(chave);
  const portais = new Set(dasUrls.map(portalDeChave));
  const portalDeclarado = typeof (j.portal_origem ?? j.portal) === 'string' ? String(j.portal_origem ?? j.portal).toLowerCase() : null;
  for (const bruto of [j.requisicao_id, j.id_requisicao]) {
    if (bruto === undefined || bruto === null || bruto === '') continue;
    const texto = String(bruto).trim();
    const linkedin = /linkedin\s+(\d{6,})/i.exec(texto)?.[1];
    if (linkedin) { chaves.add(`linkedin:${linkedin}`); continue; }
    const completa = normalizarChave(texto);
    if (completa && !/\s/.test(texto)) { chaves.add(completa); continue; }
    if (/^(\d+|[0-9a-f-]{36})$/i.test(texto)) {
      const portal = PORTAL_DO_PROVEDOR[portalDeclarado] ?? portalDeclarado ?? (portais.size === 1 ? [...portais][0] : null);
      if (portal) chaves.add(`${portal}:${texto.toLowerCase()}`);
    }
  }
  return [...chaves];
}
