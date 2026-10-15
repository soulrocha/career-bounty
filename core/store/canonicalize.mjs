import { createHash } from 'node:crypto';

// Forma canônica: chaves ordenadas em todos os níveis. Ordem de listas é significativa.
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const semanticHash = value => sha256(JSON.stringify(canonicalize(value)));
