// Texto de vaga é dado, nunca instrução: limpeza e delimitação antes de qualquer entrada do LLM.
export const MARCA_ABRE = '<dado_nao_confiavel>';
export const MARCA_FECHA = '</dado_nao_confiavel>';

const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIVEL = /[​-‏‪-‮⁠-⁩﻿­]/g;
const MARCADOR = /<\s*\/?\s*dado_nao_confiavel\s*>/gi;

// Remove controle, zero-width, bidi e os próprios marcadores (inclusive aninhados). Trunca com aviso.
export function limparTextoNaoConfiavel(entrada, { max = 12000 } = {}) {
  let texto = String(entrada ?? '').normalize('NFKC').replace(CONTROLE, '').replace(INVISIVEL, '');
  for (let anterior = null; anterior !== texto;) { anterior = texto; texto = texto.replace(MARCADOR, ''); }
  const avisos = [];
  let truncado = false;
  if (texto.length > max) { texto = texto.slice(0, max); truncado = true; avisos.push(`texto truncado em ${max} caracteres`); }
  return { texto, truncado, avisos };
}

export const embrulhar = texto => `${MARCA_ABRE}${texto}${MARCA_FECHA}`;

// Campos curtos (cargo, empresa, local): sem delimitadores nem sinais de marcação.
export const limparCampoCurto = (valor, max = 200) => limparTextoNaoConfiavel(valor, { max }).texto.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
