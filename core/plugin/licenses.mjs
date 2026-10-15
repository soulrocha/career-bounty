import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED = /^(MIT|ISC|BSD|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0)$/;

// Expressão SPDX simples: "A OR B" basta uma permitida; "A AND B" (ou termo único) exige todas.
export function checkLicenseExpression(expression) {
  if (typeof expression !== 'string' || !expression.trim()) return false;
  const text = expression.replace(/[()]/g, ' ').trim();
  if (/\bWITH\b|commons/i.test(text)) return false;
  const terms = text.split(/\s+(?:OR|AND)\s+/i).map(t => t.trim()).filter(Boolean);
  return /\sOR\s/i.test(text) ? terms.some(t => ALLOWED.test(t)) : terms.every(t => ALLOWED.test(t));
}

async function readPackage(fromDir, name) {
  let dir = fromDir;
  while (true) {
    try { return JSON.parse(await readFile(path.join(dir, 'node_modules', name, 'package.json'), 'utf8')); } catch { /* sobe */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function auditLicenses(root) {
  const ls = spawnSync('npm', ['ls', '--all', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  const tree = JSON.parse(ls.stdout || '{}');
  const violations = [];
  const seen = new Set();
  async function walk(dependencies = {}, parentDir) {
    for (const [name, info] of Object.entries(dependencies)) {
      const pkg = await readPackage(parentDir, name);
      const license = pkg?.license ?? pkg?.licenses?.map?.(l => l.type).join(' OR ');
      const key = `${name}@${info.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!checkLicenseExpression(license)) violations.push(`${key}: licença ${license ?? 'desconhecida'}`);
      }
      await walk(info.dependencies, path.join(parentDir, 'node_modules', name));
    }
  }
  await walk(tree.dependencies, root);
  return { violations, packages: seen.size };
}

async function listFiles(dir, prefix = '') {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...await listFiles(path.join(dir, entry.name), `${relative}/`));
    else out.push(relative);
  }
  return out;
}

// Cada arquivo em vendor/ precisa de uma linha no NOTICE com origem (URL) e licença MIT.
export async function checkVendorNotice(root) {
  const files = await listFiles(path.join(root, 'vendor'), 'vendor/');
  let notice = '';
  try { notice = await readFile(path.join(root, 'NOTICE'), 'utf8'); } catch { /* sem NOTICE */ }
  return files
    .filter(file => !notice.split('\n').some(line => line.includes(file) && /origem:\s*https?:\/\//.test(line) && /licença:\s*MIT/.test(line)))
    .map(file => `${file}: sem entrada no NOTICE com origem e licença MIT.`);
}
