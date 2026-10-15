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
