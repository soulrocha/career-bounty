// Peças comuns aos dois renders de CV: escape, carga do template, foto como data URI e geração do PDF com limite de páginas.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removerMarcas } from '../kb/cvItems.mjs';
import { imprimirPdf } from './navegador.mjs';
import { contarPaginas } from './pdf.mjs';

export const PAGINAS_MAX = 2;
const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));
const MIMES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Todo texto do payload passa por aqui: tira marca claim (nunca visível) e escapa HTML.
export const esc = valor => removerMarcas(String(valor ?? '')).replace(/[&<>"']/g, c => ENTIDADES[c]);

export async function carregarTemplate(nome) {
  return readFile(path.join(TEMPLATES, nome), 'utf8');
}

// O template só tem dois espaços: {{titulo}} e {{conteudo}}. Uma passada só sobre o template, por função: um "{{conteudo}}"
// ou "$&" vindo do texto da vaga nunca é reprocessado.
export const preencher = (template, valores) => template.replace(/\{\{(titulo|conteudo)\}\}/g, (_, nome) => valores[nome]);

export async function fotoComoDataUri(caminho) {
  const mime = MIMES[path.extname(caminho).toLowerCase()];
  if (!mime) throw new Error(`Formato de foto não suportado: ${path.extname(caminho) || '(sem extensão)'} (use svg, png, jpg ou webp).`);
  return `data:${mime};base64,${(await readFile(caminho)).toString('base64')}`;
}

export const tituloDaPagina = payload => `${payload.cabecalho.nome} | ${payload.tipo === 'adaptado' ? payload.identificacao.replace(/^CV para /, '') : 'Currículo'}`;

// Imprime e confere o tamanho: acima do limite falha com mensagem, em vez de entregar CV estourado.
export async function gerarPdf({ html, tipo, navegador, paginasMax = PAGINAS_MAX }) {
  const pdf = await imprimirPdf({ html, ...(navegador ? { navegador } : {}) });
  const paginas = contarPaginas(pdf);
  if (paginas < 1) throw new Error(`O PDF ${tipo} saiu sem páginas.`);
  if (paginas > paginasMax) throw new Error(`O CV ${tipo} ficou com ${paginas} páginas; o limite é ${paginasMax}. Reduza itens por experiência ou o resumo.`);
  return { pdf, paginas };
}
