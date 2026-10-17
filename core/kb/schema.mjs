export const NIVEIS_PROVA = ['verificado', 'entregue', 'proposto', 'relato'];
export const NIVEIS_COM_PROVA = ['verificado', 'entregue'];

const aspas = raw => (raw.length >= 2 && /^(["'])[\s\S]*\1$/.test(raw) ? raw.slice(1, -1) : raw);

// Divide `a, "b, c", d` respeitando aspas: números pt-BR como "36,18" não quebram.
function dividirLista(inner) {
  const itens = [];
  let atual = '';
  let aspa = null;
  for (const ch of inner) {
    if (aspa) { if (ch === aspa) aspa = null; atual += ch; continue; }
    if (ch === '"' || ch === "'") { aspa = ch; atual += ch; continue; }
    if (ch === ',') { itens.push(atual); atual = ''; continue; }
    atual += ch;
  }
  itens.push(atual);
  return itens.map(item => aspas(item.trim())).filter(Boolean);
}

// Frontmatter mínimo: `chave: valor`, `chave: [a, b]` e lista em bloco (`chave:` seguido de `- item`). Sem dependência de YAML.
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text.trim() };
  const data = {};
  const linhas = match[1].split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(linhas[i]);
    if (!pair) continue;
    const raw = pair[2].trim();
    if (raw === '' && /^\s+-\s+/.test(linhas[i + 1] ?? '')) {
      const itens = [];
      while (i + 1 < linhas.length && /^\s+-\s+/.test(linhas[i + 1])) itens.push(aspas(linhas[++i].replace(/^\s+-\s+/, '').trim()));
      data[pair[1]] = itens.filter(Boolean);
      continue;
    }
    data[pair[1]] = raw.startsWith('[') && raw.endsWith(']') ? dividirLista(raw.slice(1, -1)) : aspas(raw);
  }
  return { data, body: match[2].trim() };
}

// Vários blocos `---` frontmatter `---` corpo, um depois do outro (arquivo claims.local.md).
export function parseBlocks(text) {
  const linhas = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocos = [];
  let i = 0;
  while (i < linhas.length) {
    if (linhas[i].trim() !== '---') { i++; continue; }
    let j = i + 1;
    const cabecalho = [];
    while (j < linhas.length && linhas[j].trim() !== '---') cabecalho.push(linhas[j++]);
    if (j >= linhas.length) throw new Error('bloco de frontmatter sem fechamento');
    j++;
    const corpo = [];
    while (j < linhas.length && linhas[j].trim() !== '---') corpo.push(linhas[j++]);
    blocos.push(parseFrontmatter(`---\n${cabecalho.join('\n')}\n---\n${corpo.join('\n')}`));
    i = j;
  }
  return blocos;
}

export function validateClaim({ data }, arquivo) {
  if (!data.id) throw new Error(`${arquivo}: frontmatter sem id.`);
  if (!NIVEIS_PROVA.includes(data.nivel_prova)) {
    throw new Error(`${arquivo}: nivel_prova ausente ou inválido (use ${NIVEIS_PROVA.join(', ')}).`);
  }
}

export const comoLista = valor => (Array.isArray(valor) ? valor : valor ? [valor] : []);

// Afirmação no contrato do KnowledgeSource (S5). Campos opcionais ausentes viram padrão neutro.
export function montarAfirmacao({ data, body }, arquivo) {
  return {
    id: data.id,
    texto: body,
    nivel_prova: data.nivel_prova,
    arquivo,
    empresa: data.empresa ?? null,
    periodo: data.periodo ?? null,
    uso: comoLista(data.uso),
    origem: data.origem ?? null,
    publicavel: data.publicavel ?? null,
    numeros: comoLista(data.numeros).map(String),
  };
}
