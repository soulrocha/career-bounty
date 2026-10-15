export const NIVEIS_PROVA = ['verificado', 'entregue', 'proposto', 'relato'];

// Frontmatter mínimo: `chave: valor` e `chave: [a, b]`. Sem dependência de YAML.
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text.trim() };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const raw = pair[2].trim();
    data[pair[1]] = raw.startsWith('[') && raw.endsWith(']')
      ? raw.slice(1, -1).split(',').map(item => item.trim()).filter(Boolean)
      : raw;
  }
  return { data, body: match[2].trim() };
}

export function validateClaim({ data }, arquivo) {
  if (!data.id) throw new Error(`${arquivo}: frontmatter sem id.`);
  if (!NIVEIS_PROVA.includes(data.nivel_prova)) {
    throw new Error(`${arquivo}: nivel_prova ausente ou inválido (use ${NIVEIS_PROVA.join(', ')}).`);
  }
}
