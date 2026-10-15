// Diff semântico entre dois documentos de pipeline: ignora ordem de chaves e o campo `atualizado`.
// O relatório traz só caminhos (entidade, id, campos), nunca valores: pode ir para log e para o chat.
import { semanticHash } from '../store/canonicalize.mjs';
import { EMAILS, emailKeys } from '../store/project.mjs';

const same = (a, b) => semanticHash(a ?? null) === semanticHash(b ?? null);

function fieldDiff(a, b) {
  const campos = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key) || !same(a[key], b[key])) campos.push(key);
  }
  return campos.sort();
}

function collection(entidade, listA, listB, keysOf, itens) {
  const keysA = keysOf(listA);
  const keysB = keysOf(listB);
  const mapA = new Map(keysA.map((key, index) => [key, listA[index]]));
  const mapB = new Map(keysB.map((key, index) => [key, listB[index]]));
  for (const [key, item] of mapA) {
    if (!mapB.has(key)) itens.push({ entidade, id: key, tipo: 'somente_em_a' });
    else {
      const campos = fieldDiff(item, mapB.get(key));
      if (campos.length) itens.push({ entidade, id: key, tipo: 'alterado', campos });
    }
  }
  for (const key of mapB.keys()) if (!mapA.has(key)) itens.push({ entidade, id: key, tipo: 'somente_em_b' });
  const common = keysA.filter(key => mapB.has(key));
  if (JSON.stringify(common) !== JSON.stringify(keysB.filter(key => mapA.has(key)))) itens.push({ entidade, id: null, tipo: 'ordem' });
}

// `a` é o documento de referência (legado) e `b` o reconstruído (projeção).
export function semanticDiff(a, b, { ignorar = ['atualizado'] } = {}) {
  const itens = [];
  const rootOf = document => Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'vagas' && key !== EMAILS && !ignorar.includes(key)));
  const campos = fieldDiff(rootOf(a), rootOf(b));
  if (campos.length) itens.push({ entidade: 'raiz', id: null, tipo: 'alterado', campos });
  collection('vaga', a.vagas ?? [], b.vagas ?? [], list => list.map(item => item.id), itens);
  collection('email_sem_requisicao', a[EMAILS] ?? [], b[EMAILS] ?? [], emailKeys, itens);
  return { diferencas: itens.length, itens };
}
