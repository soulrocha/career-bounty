import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, posix } from 'node:path';
import { noLinks } from '../core/migration/paths.mjs';

// Lê um arquivo privado sem seguir links e sem sair da raiz.
export async function privateFile(root, path) {
  await noLinks(root).catch(() => { throw new Error('Diretório inválido.'); });
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('Arquivo indisponível.');
  let current = root;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Link indisponível.');
  }
  if (!(await lstat(target)).isFile()) throw new Error('Arquivo indisponível.');
  return readFile(target);
}

export const REPORTS = ['relatorio-vagas.md', 'busca-browseruse-2026-10-05.md', 'busca-linkedin-ampla-2026-10-05.md'];
const BASE_NAMES = ['curriculo.html', 'curriculo-visual.pdf', 'curriculo-ats.pdf'];

export function validateBaseFiles(list) {
  if (!Array.isArray(list) || list.some(path => typeof path !== 'string'
    || !/\.pdf$/i.test(path) || /[\\%\x00:?#]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('Allowlist de PDFs base inválida.');
  }
  return list;
}

export function namedMaterialsOf(manifest) {
  return new Set(manifest.flatMap(item => ['html', 'pdf_visual', 'pdf_ats']
    .filter(field => typeof item[field] === 'string')
    .map(field => posix.normalize(`/carreira/busca-vagas/${item[field].replaceAll('\\', '/')}`))));
}

// Política de materiais: só nome-base permitido, arquivo registrado no manifesto, PDF base da allowlist
// ou relatório conhecido. Qualquer outra coisa é privada.
export function createMaterials({ snapshot, namedMaterials = new Set(), baseFiles = [] }) {
  const base = new Set(baseFiles.map(path => `/curriculos/${path}`));
  const reports = new Set(REPORTS);
  return {
    allows(path) {
      if (!snapshot) return false;
      const name = path.split('/').at(-1);
      return (path.startsWith('/curriculos/vagas/') && (BASE_NAMES.includes(name) || namedMaterials.has(path)))
        || base.has(path)
        || (path.startsWith('/carreira/busca-vagas/') && reports.has(path.slice('/carreira/busca-vagas/'.length)));
    },
    async read(path) {
      if (!this.allows(path)) return null;
      const name = path.split('/').at(-1);
      try {
        const bytes = await privateFile(snapshot, path.slice(1));
        return { bytes, type: name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' };
      } catch { return null; }
    },
  };
}
