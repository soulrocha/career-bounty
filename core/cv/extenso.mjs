// Quantidade escrita por extenso ("dobrou", "dez vezes mais", "centenas", "um milhão", "uma década") num texto do modelo.
// O extrator de números só vê dígitos; aqui a expressão só passa se uma afirmação ligada usar a mesma palavra (palavra inteira,
// no texto, nas variantes ou na lista `numeros`) ou, para cardinais, trouxer o mesmo valor em dígitos ("cinco" e "5 sistemas").
import { fold } from '../dedup/keys.mjs';
import { extrairNumeros } from './numeros.mjs';

const CARDINAIS = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  quatorze: 14, catorze: 14, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, quinhentos: 500, mil: 1000,
};
const NOMES = Object.keys(CARDINAIS).join('|');
// Expressões que não são quantidade: mês abreviado com barra ("dez/2018") e nomes próprios conhecidos.
const NAO_QUANTIDADE = /^(?:seis sigma|sete habitos)/;

const PADROES = [
  /\b(?:dobr|tripl|quadrupl|quintupl|decupl|decuplo)\w*/g,
  /\bvezes\s+mais\b/g,
  /\b(?:dezenas|centenas|milhares)\b/g,
  // Escala por extenso sem dígito antes ("um milhão", "meio milhão"); "R$ 2,3 milhões" já é tratado pelo extrator de números.
  /(?<!\d[\d.,]*\s*)\b(?:milhao|milhoes|bilhao|bilhoes|trilhao|trilhoes)\b/g,
  /\bdecadas?\b/g,
  /\bmetade\b/g,
  /\bum\s+(?:terco|quarto)\b/g,
];
const CARDINAL = new RegExp(`\\b(${NOMES})\\b(?!\\s*\\/)(?!\\s*\\d)`, 'g');

const palavraInteira = (texto, palavra) => new RegExp(`(^|[^a-z0-9])${palavra.replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`).test(texto);

// afirmacoes: as afirmações ligadas ao texto. Devolve as expressões sem afirmação que as sustente.
export function quantidadesPorExtenso(texto, afirmacoes = []) {
  const alvo = fold(texto);
  const ligados = fold(afirmacoes.flatMap(af => [af.texto, ...(af.variantes ?? []), ...(af.numeros ?? [])]).join(' \n '));
  const valores = new Set(afirmacoes.flatMap(af => [af.texto, ...(af.variantes ?? []), ...(af.numeros ?? [])].flatMap(extrairNumeros)).map(n => n.valor));
  const achadas = new Set();
  for (const padrao of PADROES) {
    for (const m of alvo.matchAll(padrao)) if (!palavraInteira(ligados, m[0])) achadas.add(m[0].replace(/\s+/g, ' '));
  }
  for (const m of alvo.matchAll(CARDINAL)) {
    if (NAO_QUANTIDADE.test(alvo.slice(m.index))) continue;
    if (m[1] === 'cento' && /\bpor\s+$/.test(alvo.slice(0, m.index))) continue;
    if (!palavraInteira(ligados, m[1]) && !valores.has(CARDINAIS[m[1]])) achadas.add(m[1]);
  }
  return [...achadas];
}
