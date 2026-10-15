import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Regras de dado pessoal. Nenhum valor é guardado nem impresso: só regra, arquivo e linha.

const CPF = /(?<![\d.\-])\d{3}[.\s]?\d{3}[.\s]?\d{3}\s*-?\s*\d{2}(?![\d\-])/g;
const MOBILE = /(?<!\d)(?:\+?55[\s-]?)?\(?[1-9][1-9]\)?[\s-]?9[\s-]?\d{4}[\s-]?\d{4}(?!\d)/;
// Fixo exige parênteses ou separador depois do DDD, para não pegar qualquer número de 10 dígitos.
const LANDLINE = /(?<!\d)(?:\+?55[\s-]?)?(?:\([1-9][1-9]\)\s?|[1-9][1-9][\s-])[2-5]\d{3}[\s-]?\d{4}(?!\d)/;
const USER_PATHS = [
  /[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"'`<>|*?]+)/gi,
  /(?<![\w.])\/home\/+([^\\/\s"'`<>|*?]+)/g,
  /(?<![\w.])\/Users\/+([^\\/\s"'`<>|*?]+)/g,
];
const VAULT_PATHS = [/[A-Za-z]:[\\/]+Vault(?![\w-])/i, /[\\/]Vault[\\/]/];
const PLACEHOLDER_USER = /^(<|%|\$|\{|~|\.\.\.|usuario$|seu-usuario$|user$|username$|public$|default$|all users$)/i;
const EXEMPT_DOMAIN = /(\.test|\.example)\b/i;

// E-mail tolerante a espaços em volta do arroba e a pontos separados por espaço.
const DOT = '(?:\\s+\\.\\s*|\\.)';
const EMAIL = new RegExp(`[A-Za-z0-9_%+-]+(?:${DOT}[A-Za-z0-9_%+-]+)*\\s*@\\s*[A-Za-z0-9-]+(?:${DOT}[A-Za-z0-9-]+)+`, 'g');
const EXEMPT_EMAIL_DOMAIN = [/(^|\.)(test|invalid|example)$/, /^example\.(com|org|net)$/, /^localhost$/, /(^|\.)noreply\.github\.com$/];
const EXEMPT_EMAIL_ADDRESS = new Set(['noreply@github.com', 'noreply@anthropic.com']);
const FILE_LIKE_TLD = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'mjs', 'json', 'md', 'ts', 'txt']);

// Identificadores públicos do próprio repositório, liberados só nos README.
const README_ALLOWED = [/soulrocha\/career-bounty/gi];
const isReadme = file => /^README(\.[A-Za-z]+)?\.md$/i.test(path.basename(file ?? ''));

// Binários sem texto de interesse: imagens e fontes não são escaneados.
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf']);

export function validCpf(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  for (const size of [9, 10]) {
    const sum = digits.slice(0, size).split('').reduce((acc, d, i) => acc + Number(d) * (size + 1 - i), 0);
    if (((sum * 10) % 11) % 10 !== Number(digits[size])) return false;
  }
  return true;
}

export function flattenStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => flattenStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => flattenStrings(item, out));
  return out;
}

// Valores de identidade: ignora chaves de instrução (iniciadas por _) do modelo criado pelo setup.
export function identityStrings(identity) {
  const data = identity && typeof identity === 'object' && !Array.isArray(identity)
    ? Object.fromEntries(Object.entries(identity).filter(([key]) => !key.startsWith('_')))
    : identity;
  return flattenStrings(data ?? []).map(v => v.trim()).filter(Boolean);
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');

export function buildContext({ identity = null, denylist = [] } = {}) {
  const identityValues = identityStrings(identity).filter(v => v.length >= 4 && !EXEMPT_DOMAIN.test(v));
  const denyPatterns = denylist
    .map(v => v.trim())
    .filter(v => v.length >= 3)
    .map(v => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(v)}(?![\\p{L}\\p{N}])`, 'iu'));
  return {
    // Comparação sem espaços, caixa nem acentos: pega "Nome   Sobrenome" e e-mail com espaços.
    identitySquashed: [...new Set(identityValues.map(squash).filter(v => v.length >= 4))],
    denyPatterns,
    hasIdentity: identity !== null,
  };
}

// "(at)", "[at]" e "(dot)" viram "@" e ".".
const deobfuscate = line => line
  .replace(/\s*[(\[{<]\s*(?:at|arroba)\s*[)\]}>]\s*/gi, '@')
  .replace(/\s*[(\[{<]\s*(?:dot|ponto)\s*[)\]}>]\s*/gi, '.');

function hasRealEmail(view) {
  for (const match of view.matchAll(EMAIL)) {
    const address = match[0].replace(/\s+/g, '').toLowerCase();
    const domain = address.slice(address.indexOf('@') + 1);
    const tld = domain.split('.').pop();
    if (!/^[a-z]{2,}$/.test(tld) || FILE_LIKE_TLD.has(tld)) continue;
    if (EXEMPT_EMAIL_ADDRESS.has(address) || EXEMPT_EMAIL_DOMAIN.some(p => p.test(domain))) continue;
    return true;
  }
  return false;
}

const BASE64_TOKEN = /[A-Za-z0-9+/_-]{16,}={0,2}/g;
const MAX_DEPTH = 3;

// Decodifica base64 só quando o resultado é texto UTF-8 plausível.
function decodeBase64(raw) {
  let token = raw.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (token.length % 4 === 1) token = token.slice(0, -1);
  if (token.length < 12) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(token, 'base64'));
    const controls = [...text].filter(c => c.charCodeAt(0) < 32 && !'\t\n\r'.includes(c)).length;
    return controls / text.length <= 0.02 ? text : null;
  } catch { return null; }
}

function lineRules(line, context, { file = '', depth = 0 } = {}) {
  const rules = new Set();
  if (isReadme(file)) for (const allowed of README_ALLOWED) line = line.replace(allowed, '');
  const view = deobfuscate(line);
  for (const match of line.matchAll(CPF)) if (validCpf(match[0])) rules.add('cpf');
  if (MOBILE.test(line) || LANDLINE.test(line)) rules.add('telefone');
  for (const pattern of USER_PATHS) {
    for (const match of line.matchAll(pattern)) if (!PLACEHOLDER_USER.test(match[1])) rules.add('caminho-usuario');
  }
  if (VAULT_PATHS.some(p => p.test(line))) rules.add('caminho-vault');
  if (hasRealEmail(view)) rules.add('email');
  const squashed = squash(view);
  if (context.identitySquashed.some(v => squashed.includes(v))) rules.add('identidade');
  if (context.denyPatterns.some(p => p.test(line))) rules.add('empresa-denylist');
  if (depth < MAX_DEPTH) {
    for (const token of line.matchAll(BASE64_TOKEN)) {
      const decoded = decodeBase64(token[0]);
      if (decoded) for (const part of decoded.split(/\r?\n/)) for (const rule of lineRules(part, context, { file, depth: depth + 1 })) rules.add(rule);
    }
  }
  return [...rules];
}

export function scanText(text, context, file = '') {
  const findings = [];
  const seen = new Set();
  const add = (line, rule) => {
    if (!seen.has(`${line}:${rule}`)) { seen.add(`${line}:${rule}`); findings.push({ file, line, rule }); }
  };
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of lineRules(line, context, { file })) add(index + 1, rule);
  });
  // Blocos base64 quebrados em várias linhas (MIME): junta e decodifica.
  const block = /^\s*[A-Za-z0-9+/]{8,}={0,2}\s*$/;
  for (let i = 0; i < lines.length; i++) {
    if (!block.test(lines[i])) continue;
    let end = i;
    while (end + 1 < lines.length && block.test(lines[end + 1])) end++;
    if (end > i) {
      const decoded = decodeBase64(lines.slice(i, end + 1).map(l => l.trim()).join(''));
      if (decoded) for (const part of decoded.split(/\r?\n/)) for (const rule of lineRules(part, context, { file, depth: 1 })) add(i + 1, rule);
    }
    i = end;
  }
  return findings;
}

function decodeBuffer(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  const sample = buffer.subarray(0, 8000);
  if (!sample.includes(0)) return buffer.toString('utf8');
  const pairs = Math.floor(sample.length / 2);
  let even = 0;
  let odd = 0;
  for (let i = 0; i + 1 < sample.length; i += 2) { if (sample[i] === 0) even++; if (sample[i + 1] === 0) odd++; }
  if (odd >= pairs * 0.3 && even <= pairs * 0.05) return buffer.toString('utf16le');
  if (even >= pairs * 0.3 && odd <= pairs * 0.05) return Buffer.from(buffer.subarray(0, buffer.length - (buffer.length % 2))).swap16().toString('utf16le');
  // Binário: escaneia o texto extraível (sequências legíveis), como o comando strings.
  return (buffer.toString('utf8').match(/[\x20-\x7e\p{L}]{4,}/gu) ?? []).join('\n');
}

// Escaneia o conteúdo e também o NOME do arquivo. Achados no nome nunca imprimem o nome.
export function scanContent(buffer, context, file, ordinal = 0) {
  const ext = path.extname(file).toLowerCase();
  const nameRules = lineRules(file.replaceAll('\\', '/'), context);
  const label = nameRules.length ? `nome-de-arquivo-${ordinal}${ext}` : file;
  const findings = nameRules.map(rule => ({ file: label, line: 0, rule }));
  if (BINARY_EXTENSIONS.has(ext)) return findings;
  for (const finding of scanText(decodeBuffer(buffer), context, file)) findings.push({ ...finding, file: label });
  return findings;
}

function git(args, cwd, options = {}) {
  const result = spawnSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`git ${args[0]} falhou: ${String(result.stderr || '').trim()}`);
  return result.stdout;
}

export function scanStaged(context, cwd = process.cwd()) {
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], cwd).toString('utf8').split('\0').filter(Boolean);
  return names.flatMap((name, index) => scanContent(git(['show', `:${name}`], cwd), context, name, index + 1));
}

export async function scanTracked(context, cwd = process.cwd()) {
  const names = git(['ls-files', '-z'], cwd).toString('utf8').split('\0').filter(Boolean);
  const findings = [];
  for (const [index, name] of names.entries()) {
    let content;
    try { content = await readFile(path.join(cwd, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    findings.push(...scanContent(content, context, name, index + 1));
  }
  return findings;
}

export async function scanMessageFile(context, filename) {
  return scanText(await readFile(filename, 'utf8'), context, 'mensagem de commit');
}

export function formatFindings(findings) {
  return findings.map(f => (f.line ? `bloqueado: ${f.file}:${f.line} (${f.rule})` : `bloqueado: ${f.file} (${f.rule})`)).join('\n');
}
