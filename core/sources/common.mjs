// Mapeamentos compartilhados pelas fontes.
import { roleKey } from '../dedup/keys.mjs';
import { portalCandidatura } from '../apply/portal.mjs';

const PORTAL_DO_PROVEDOR = { 'greenhouse.io': 'greenhouse', 'lever.co': 'lever', 'ashbyhq.com': 'ashby', 'inhire.app': 'inhire', 'quickin.io': 'quickin', 'infojobs.com.br': 'infojobs', 'jobs.deel.com': 'deel' };

// Requisição extraída da própria URL com a mesma regra do legado (gupy:123, greenhouse.io:uuid...).
// Devolve { portal, requisicao_id } ou nulos quando a URL não traz identificador.
export function requisicaoDaUrl(url) {
  const key = roleKey({ url });
  const match = /^([a-z.]+):(.+)$/.exec(key);
  if (!match || match[1] === 'url') return { portal: null, requisicao_id: null };
  return { portal: PORTAL_DO_PROVEDOR[match[1]] ?? match[1], requisicao_id: match[2] };
}

export const portalDaUrl = url => portalCandidatura({ url });

export function modalidadeDe(texto) {
  const t = String(texto ?? '').toLowerCase().normalize('NFKD').replace(/\p{Mn}/gu, '');
  if (/remot|home ?office|teletrabalho|telecommute/.test(t)) return 'remoto';
  if (/hibrid|hybrid/.test(t)) return 'hibrido';
  if (/presencial|on-?site/.test(t)) return 'presencial';
  return null;
}

// Data AAAA-MM-DD a partir de ISO, epoch em ms ou texto; null quando inválida.
export function diaDe(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const date = new Date(typeof valor === 'number' ? valor : String(valor));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// Verdadeiro quando a data (AAAA-MM-DD) cai antes do início da janela; sem data nunca fica "fora".
export const antesDaJanela = (dia, janela) => Boolean(dia) && dia < janela.inicio;

export function semHtml(html) {
  return String(html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
