// Inventário do esquema legado: só nomes de campo e tipos, nunca valores.
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_CHILDREN = 40;

const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

function children(value) {
  const objects = Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : value && typeof value === 'object' ? [value] : [];
  const out = {};
  for (const object of objects) {
    const keys = Object.keys(object);
    if (keys.length > MAX_CHILDREN || !keys.every(key => IDENTIFIER.test(key))) return null;
    for (const [key, item] of Object.entries(object)) (out[key] ??= new Set()).add(typeOf(item));
  }
  return Object.keys(out).length ? Object.fromEntries(Object.keys(out).sort().map(key => [key, [...out[key]].sort()])) : null;
}

function collect(records) {
  const fields = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const entry = (fields[key] ??= { tipos: new Set(), filhos: {} });
      entry.tipos.add(typeOf(value));
      const nested = children(value);
      if (nested) for (const [name, types] of Object.entries(nested)) entry.filhos[name] = [...new Set([...(entry.filhos[name] ?? []), ...types])].sort();
    }
  }
  return Object.fromEntries(Object.keys(fields).sort().map(key => {
    const { tipos, filhos } = fields[key];
    return [key, Object.keys(filhos).length ? { tipos: [...tipos].sort(), filhos } : { tipos: [...tipos].sort() }];
  }));
}

export function buildInventory(pipeline) {
  const raiz = Object.fromEntries(Object.keys(pipeline).filter(key => key !== 'vagas' && key !== 'eventos_email_sem_requisicao').sort().map(key => [key, [typeOf(pipeline[key])]]));
  return { versao: 1, raiz, vaga: collect(pipeline.vagas ?? []), email: collect(pipeline.eventos_email_sem_requisicao ?? []) };
}
