// Extração e comparação de números em texto pt-BR. Usada pelos itens de CV, pelos quadrantes e pelo verificador de fatos.
// Números por extenso ("dez dias") não são extraídos; datas, anos, IDs (AF-001, D1, S/4HANA) e versões ficam de fora.
const MESES = '(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?';
const DATAS = [
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\b\d{1,2}\/\d{4}\b/g,
  /\b\d{4}-\d{2}(?:-\d{2})?\b/g,
  new RegExp(`\b${MESES}\s*[/\-]?\s*(?:de\s+)?\d{4}\b`, 'gi'),
  /\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/g,
];
const NUMERO = /(R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(\s*%)?(\s*(?:milhões|milhão|mil|mi)(?![\p{L}\p{N}]))?/gu;
const UNIDADES_COLADAS = new Set(['ms', 's', 'min', 'h', 'x', 'k', 'kb', 'mb', 'gb', 'tb', 'm', 'km', 'kg', 'g', 'a', 'o', 'º', 'ª']);
const ESCALAS = { mil: 1e3, mi: 1e6, milhao: 1e6, milhoes: 1e6 };

const letraOuDigito = ch => ch !== undefined && /[\p{L}\p{N}_#@]/u.test(ch);

function valorDe(inteiro, escala) {
  const limpo = inteiro.includes(',') ? inteiro.replaceAll('.', '').replace(',', '.') : (/^\d{1,3}(?:\.\d{3})+$/.test(inteiro) ? inteiro.replaceAll('.', '') : inteiro);
  const base = Number(limpo);
  const fator = escala ? ESCALAS[escala.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')] ?? 1 : 1;
  return Math.round(base * fator * 1e6) / 1e6;
}

export function extrairNumeros(texto) {
  let limpo = String(texto ?? '');
  for (const padrao of DATAS) limpo = limpo.replace(padrao, m => ' '.repeat(m.length));
  const out = [];
  for (const m of limpo.matchAll(NUMERO)) {
    const [, rs, digitos, pct, escala] = m;
    const inicio = m.index + (rs ? rs.length : 0);
    const antes = limpo[m.index - 1];
    const antes2 = limpo[m.index - 2];
    const depois = limpo[m.index + m[0].length];
    if (!rs && (letraOuDigito(antes) || (antes === '-' && letraOuDigito(antes2)) || (antes === '/' && letraOuDigito(antes2)))) continue;
    if (!pct && !escala && depois !== undefined && /\p{L}/u.test(depois)) {
      const colada = /^\p{L}+/u.exec(limpo.slice(m.index + m[0].length))[0].toLowerCase();
      if (!UNIDADES_COLADAS.has(colada)) continue;
    }
    const semSeparador = /^\d{4}$/.test(digitos);
    if (semSeparador && !rs && !pct && !escala && Number(digitos) >= 1900 && Number(digitos) <= 2100) continue;
    if (/^v\s?$/i.test(limpo.slice(Math.max(0, m.index - 2), m.index))) continue;
    const bruto = m[0].trim();
    out.push({ bruto, valor: valorDe(digitos, escala), tipo: pct ? 'percentual' : rs ? 'moeda' : 'numero', indice: inicio });
  }
  return out;
}

// Chave de comparação: valor e se é percentual. Moeda e contagem se equivalem (R$ 2,3 mi == 2,3 mi).
export const chaveNumero = n => `${n.tipo === 'percentual' ? '%' : '#'}${n.valor}`;
export const mesmoNumero = (a, b) => chaveNumero(a) === chaveNumero(b);

// Números que uma afirmação sustenta: os do texto e os da lista `numeros` do frontmatter.
export function numerosDaAfirmacao(afirmacao) {
  return [...extrairNumeros(afirmacao.texto), ...(afirmacao.numeros ?? []).flatMap(extrairNumeros)];
}
