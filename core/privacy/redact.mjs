// Redação da entrada de qualquer chamada ao LLM: valores da identidade, e-mails e telefones não saem da máquina.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { identityStrings } from './scan.mjs';
import { resolveDataRoot } from '../store/dataRoot.mjs';

const MARCA = '[REDIGIDO]';
const EMAIL = /[A-Za-z0-9_%+.-]+\s*@\s*[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const TELEFONE = /(?<!\d)(?:\+55[\s-]?)?\(?[1-9][1-9]\)?[\s-]\d{4,5}[\s-]?\d{4}(?!\d)/g;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function redactText(text, valores, contagem) {
  let out = text;
  const trocar = (padrao) => { out = out.replace(padrao, () => { contagem.n += 1; return MARCA; }); };
  for (const valor of valores) if (valor.length >= 3) trocar(new RegExp(escape(valor).replace(/\s+/g, '\\s+'), 'gi'));
  trocar(EMAIL);
  trocar(TELEFONE);
  return out;
}

// Percorre objetos e listas; devolve uma cópia redigida e a contagem de trocas.
export function redact(value, identity = []) {
  const valores = [...new Set(identity.map(item => String(item).trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const contagem = { n: 0 };
  const visit = item => {
    if (typeof item === 'string') return redactText(item, valores, contagem);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, visit(inner)]));
    return item;
  };
  return { valor: visit(value), redigidos: contagem.n };
}

// Valores da identidade pessoal (arquivo fora do repositório). Ausente = lista vazia.
export async function loadIdentityValues({ env = process.env } = {}) {
  const file = env.IDENTITY_FILE || path.join(resolveDataRoot({ env }), 'identity.yml');
  try { return identityStrings(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return []; throw new Error('identity.yml deve conter JSON válido (subconjunto de YAML).'); }
}
