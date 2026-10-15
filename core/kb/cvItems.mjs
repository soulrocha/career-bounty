// Itens de CV: bullets do modelo com a marca invisível <!-- claim:ID --> que liga cada um às afirmações.
import { extrairNumeros } from '../cv/numeros.mjs';

const MARCA = /<!--\s*claim:([^>]*?)\s*-->/gi;
const COMENTARIO = /<!--[\s\S]*?-->/g;
const BULLET = /^\s*(?:[-*•–·]|•)\s+(.*)$/;
const TITULO_MD = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const CAIXA_ALTA = /^[A-ZÀ-ÝÇ][A-ZÀ-ÝÇ0-9 /&,.'()-]{3,}$/;
const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export const removerMarcas = texto => String(texto).replace(MARCA, '').replace(/[ \t]+$/gm, '');
export const textoVisivel = html => String(html).replace(COMENTARIO, '').replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, e => ENTIDADES[e.toLowerCase()] ?? e).replace(/\s+/g, ' ').trim();

// HTML vira linhas lógicas: item de lista começa com "- " e título vira "## ". Os comentários continuam, porque trazem as marcas.
function htmlParaLinhas(html) {
  return html
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => `\n## ${t}\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>|<\/?(?:ul|ol|div|section|p|br)[^>]*>/gi, '\n');
}

function marcasDe(linha, nome, numero) {
  const ids = [];
  for (const m of linha.matchAll(MARCA)) {
    const lista = m[1].split(/[\s,;]+/).filter(Boolean);
    if (!lista.length) throw new Error(`Modelo ${nome}, linha ${numero}: marca vazia (use <!-- claim:ID -->).`);
    ids.push(...lista);
  }
  if (/<!--\s*claim:\s*-->/i.test(linha) && !ids.length) throw new Error(`Modelo ${nome}, linha ${numero}: marca vazia (use <!-- claim:ID -->).`);
  return [...new Set(ids)];
}

// modelo: { modelo, formato, texto }. ids: Set com os IDs de afirmação conhecidos.
export function extrairItensCv({ modelo, formato = 'md', texto }, ids) {
  const base = String(texto).replace(/\r\n/g, '\n');
  const linhas = (formato === 'html' ? htmlParaLinhas(base) : base).split('\n');
  const itens = [];
  let secao = null;
  linhas.forEach((cru, indice) => {
    const numero = indice + 1;
    const titulo = TITULO_MD.exec(cru);
    if (titulo) { secao = textoVisivel(removerMarcas(titulo[1])); return; }
    const bullet = BULLET.exec(cru);
    if (!bullet) {
      const solta = textoVisivel(removerMarcas(cru));
      if (CAIXA_ALTA.test(solta) && !/[a-zà-ý]/.test(solta)) secao = solta;
      return;
    }
    const claim_ids = marcasDe(bullet[1], modelo, numero);
    for (const id of claim_ids) if (!ids.has(id)) throw new Error(`Modelo ${modelo}, linha ${numero}: marca claim:${id} aponta para afirmação inexistente.`);
    const limpo = textoVisivel(removerMarcas(bullet[1]));
    if (!limpo) return;
    itens.push({ modelo, secao, texto: limpo, claim_ids, numeros: extrairNumeros(limpo), sem_marca: claim_ids.length === 0, linha: numero });
  });
  return itens;
}
