import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Regras genéricas de dado pessoal. Nenhum valor é guardado nem impresso: só regra, arquivo e linha.

const CPF = /(?<![\d.\-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d\-])/g;
const PHONE = /(?<!\d)(?:\+?55[\s-]?)?\(?[1-9][1-9]\)?[\s-]?9\d{4}[\s-]?\d{4}(?!\d)/;
const USER_PATHS = [
  /[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"'`<>|*?]+)[\\/]/g,
  /(?<![\w.])\/home\/+([^\\/\s"'`<>|*?]+)\//g,
  /(?<![\w.])\/Users\/+([^\\/\s"'`<>|*?]+)\//g,
];
const PLACEHOLDER_USER = /^(<|%|\$|\{|~|\.\.\.|usuario$|seu-usuario$|user$|username$|public$|default$|all users$)/i;
const EXEMPT_DOMAIN = /(\.test|\.example)\b/i;

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

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildContext({ identity = null, denylist = [] } = {}) {
  const identityValues = flattenStrings(identity ?? [])
    .map(v => v.trim())
    .filter(v => v.length >= 4 && !EXEMPT_DOMAIN.test(v));
  const denyPatterns = denylist
    .map(v => v.trim())
    .filter(v => v.length >= 3)
    .map(v => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(v)}(?![\\p{L}\\p{N}])`, 'iu'));
  return {
    identityPatterns: identityValues.map(v => new RegExp(escapeRegex(v), 'i')),
    denyPatterns,
    hasIdentity: identity !== null,
  };
}

function lineRules(line, context) {
  const rules = new Set();
  for (const match of line.matchAll(CPF)) if (validCpf(match[0])) rules.add('cpf');
  if (PHONE.test(line)) rules.add('telefone');
  for (const pattern of USER_PATHS) {
    for (const match of line.matchAll(pattern)) if (!PLACEHOLDER_USER.test(match[1])) rules.add('caminho-usuario');
  }
  if (context.identityPatterns.some(p => p.test(line))) rules.add('identidade');
  if (context.denyPatterns.some(p => p.test(line))) rules.add('empresa-denylist');
  return [...rules];
}

export function scanText(text, context, file = '') {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const rule of lineRules(line, context)) findings.push({ file, line: index + 1, rule });
  });
  return findings;
}

const isBinary = buffer => buffer.subarray(0, 8000).includes(0);

function git(args, cwd, options = {}) {
  const result = spawnSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`git ${args[0]} falhou: ${String(result.stderr || '').trim()}`);
  return result.stdout;
}

export function scanStaged(context, cwd = process.cwd()) {
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], cwd).toString('utf8').split('\0').filter(Boolean);
  return names.flatMap(name => {
    const content = git(['show', `:${name}`], cwd);
    return isBinary(content) ? [] : scanText(content.toString('utf8'), context, name);
  });
}

export async function scanTracked(context, cwd = process.cwd()) {
  const names = git(['ls-files', '-z'], cwd).toString('utf8').split('\0').filter(Boolean);
  const findings = [];
  for (const name of names) {
    let content;
    try { content = await readFile(path.join(cwd, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!isBinary(content)) findings.push(...scanText(content.toString('utf8'), context, name));
  }
  return findings;
}

export async function scanMessageFile(context, filename) {
  return scanText(await readFile(filename, 'utf8'), context, 'mensagem de commit');
}

export function formatFindings(findings) {
  return findings.map(f => `bloqueado: ${f.file}:${f.line} (${f.rule})`).join('\n');
}
