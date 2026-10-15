// Porte fiel de urllib.parse (Python 3.12) usado pelo refresh.py: urlsplit, urlunsplit, parse_qsl,
// urlencode e base64.b64decode. Existe para reproduzir bit a bit as chaves de deduplicação do legado;
// o objeto URL do WHATWG normaliza de outro jeito e daria chaves diferentes.

export class ValueError extends Error {
  constructor(message) { super(message); this.name = 'ValueError'; }
}

const SCHEME_CHARS = /^[A-Za-z0-9+\-.]$/;
const USES_NETLOC = new Set(['', 'ftp', 'http', 'gopher', 'nntp', 'telnet', 'imap', 'wais', 'file', 'mms', 'https', 'shttp', 'snews', 'prospero', 'rtsp', 'rtspu', 'rsync', 'svn', 'svn+ssh', 'sftp', 'nfs', 'git', 'git+ssh', 'ws', 'wss']);

function splitNetloc(url, start) {
  let delim = url.length;
  for (const c of '/?#') {
    const at = url.indexOf(c, start);
    if (at >= 0) delim = Math.min(delim, at);
  }
  return [url.slice(start, delim), url.slice(delim)];
}

function checkNetloc(netloc) {
  if (!netloc || /^[\x00-\x7f]*$/.test(netloc)) return;
  const n = netloc.replaceAll('@', '').replaceAll(':', '').replaceAll('#', '').replaceAll('?', '');
  const normalized = n.normalize('NFKC');
  if (n === normalized) return;
  for (const c of '/?#@:') if (normalized.includes(c)) throw new ValueError('netloc contém caracteres inválidos sob normalização NFKC');
}

export class AttributeError extends Error {
  constructor(message) { super(message); this.name = 'AttributeError'; }
}

export function urlsplit(input) {
  if (typeof input !== 'string') throw new AttributeError('urlsplit exige texto');
  let url = input.replace(/^[\x00-\x20]+/, '');
  url = url.replaceAll('\t', '').replaceAll('\r', '').replaceAll('\n', '');
  let scheme = '';
  let netloc = '';
  let query = '';
  let fragment = '';
  const colon = url.indexOf(':');
  if (colon > 0 && /^[A-Za-z]$/.test(url[0])) {
    if ([...url.slice(0, colon)].every(c => SCHEME_CHARS.test(c))) {
      scheme = url.slice(0, colon).toLowerCase();
      url = url.slice(colon + 1);
    }
  }
  if (url.slice(0, 2) === '//') {
    [netloc, url] = splitNetloc(url, 2);
    if ((netloc.includes('[') && !netloc.includes(']')) || (netloc.includes(']') && !netloc.includes('['))) throw new ValueError('Invalid IPv6 URL');
    if (netloc.includes('[') && netloc.includes(']')) {
      const bracketed = netloc.split('[').slice(1).join('[').split(']')[0];
      if (!(bracketed.startsWith('v') || bracketed.startsWith('V') ? /^[vV][0-9a-fA-F]+\..+$/.test(bracketed) : /^[0-9a-fA-F:.%a-zA-Z0-9]+$/.test(bracketed) && bracketed.includes(':'))) {
        throw new ValueError('Invalid IPv6 URL');
      }
    }
  }
  const hash = url.indexOf('#');
  if (hash >= 0) { fragment = url.slice(hash + 1); url = url.slice(0, hash); }
  const question = url.indexOf('?');
  if (question >= 0) { query = url.slice(question + 1); url = url.slice(0, question); }
  checkNetloc(netloc);
  return { scheme, netloc, path: url, query, fragment };
}

export function urlunsplit({ scheme, netloc, path, query, fragment }) {
  let url = path;
  if (netloc || (scheme && USES_NETLOC.has(scheme) && url.slice(0, 2) !== '//')) {
    if (url && url[0] !== '/') url = `/${url}`;
    url = `//${netloc || ''}${url}`;
  }
  if (scheme) url = `${scheme}:${url}`;
  if (query) url = `${url}?${query}`;
  if (fragment) url = `${url}#${fragment}`;
  return url;
}

// parsed.hostname do Python: sem credenciais e sem porta, em minúsculas (a zona IPv6 após % preservada).
export function hostname(parts) {
  const hostinfo = parts.netloc.slice(parts.netloc.lastIndexOf('@') + 1);
  let host;
  const open = hostinfo.indexOf('[');
  if (open >= 0) host = hostinfo.slice(open + 1).split(']')[0];
  else host = hostinfo.split(':')[0];
  if (!host) return null;
  const percent = host.indexOf('%');
  return percent < 0 ? host.toLowerCase() : host.slice(0, percent).toLowerCase() + host.slice(percent);
}

function unquote(text) {
  if (!text.includes('%')) return text;
  const bytes = [];
  const out = [];
  const flush = () => { if (bytes.length) { out.push(new TextDecoder('utf-8').decode(Uint8Array.from(bytes))); bytes.length = 0; } };
  for (let i = 0; i < text.length;) {
    if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 3; continue; }
    flush();
    const point = text.codePointAt(i);
    const char = String.fromCodePoint(point);
    out.push(char);
    i += char.length;
  }
  flush();
  return out.join('');
}

export function parseQsl(query) {
  const pairs = [];
  for (const piece of query.split('&')) {
    if (!piece) continue;
    const at = piece.indexOf('=');
    if (at < 0) continue;
    const name = piece.slice(0, at);
    const value = piece.slice(at + 1);
    if (!value) continue;
    pairs.push([unquote(name.replaceAll('+', ' ')), unquote(value.replaceAll('+', ' '))]);
  }
  return pairs;
}

function quotePlus(text) {
  let out = '';
  for (const byte of new TextEncoder().encode(String(text))) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.\-~]/.test(char)) out += char;
    else if (byte === 0x20) out += '+';
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

export const urlencode = pairs => pairs.map(([key, value]) => `${quotePlus(key)}=${quotePlus(value)}`).join('&');

// base64.b64decode(texto) do Python (validate=False): ignora o que não é alfabeto, tolera padding sobrando.
export function b64decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out = [];
  let bits = 0;
  let acc = 0;
  let quad = 0;
  let pads = 0;
  for (const c of text) {
    if (c === '=') {
      if (quad >= 2 && quad + (++pads) >= 4) { quad = 0; break; }
      continue;
    }
    const value = alphabet.indexOf(c);
    if (value < 0) continue;
    pads = 0;
    acc = (acc << 6) | value;
    bits += 6;
    quad = (quad + 1) % 4;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); acc &= (1 << bits) - 1; }
  }
  if (quad !== 0) throw new ValueError('Incorrect padding');
  return Uint8Array.from(out);
}
