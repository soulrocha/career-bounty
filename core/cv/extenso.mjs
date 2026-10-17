// Quantidade escrita por extenso ("dobrou", "dez vezes mais", "centenas", "uma década") num texto escrito pelo modelo.
// O extrator de números só vê dígitos; aqui a expressão só passa se uma afirmação ligada usar a mesma palavra.
import { fold } from '../dedup/keys.mjs';

const CARDINAIS = 'dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quinhentos|mil';
const PADROES = [
  /\b(?:dobr|duplic|tripl|quadrupl|quintupl|decuplic)\w*/g,
  new RegExp(`\\b(?:${CARDINAIS})\\s+vezes\\b`, 'g'),
  /\bvezes\s+mais\b/g,
  /\b(?:dezenas|centenas|milhares|milhoes|bilhoes|trilhoes)\b/g,
  /\bdecadas?\b/g,
  /\bmetade\b/g,
  /\bum\s+terco\b/g,
  new RegExp(`\\b(?:${CARDINAIS})\\b`, 'g'),
];

// Expressões do texto que nenhuma afirmação ligada contém (comparação sem acento e sem caixa).
export function quantidadesPorExtenso(texto, textosLigados = []) {
  const alvo = fold(texto);
  const ligados = textosLigados.map(fold).join(' \n ');
  const achadas = new Set();
  for (const padrao of PADROES) {
    for (const m of alvo.matchAll(padrao)) {
      const palavra = m[0].replace(/\s+/g, ' ');
      if (!new RegExp(`\\b${palavra.split(' ')[0]}`).test(ligados)) achadas.add(palavra);
    }
  }
  return [...achadas];
}
