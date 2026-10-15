// Brief do perfil para a triagem: texto de kb/profile/*.md, limitado ao orçamento de ~2 mil tokens.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BRIEF_MAX_CHARS } from '../score/triage.mjs';

export async function loadBrief(kbRoot) {
  const dir = path.join(kbRoot, 'profile');
  let nomes;
  try { nomes = (await readdir(dir)).filter(nome => nome.endsWith('.md')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  const partes = [];
  for (const nome of nomes) partes.push((await readFile(path.join(dir, nome), 'utf8')).replace(/^---[\s\S]*?---\s*/, '').trim());
  return partes.join('\n\n').slice(0, BRIEF_MAX_CHARS);
}
