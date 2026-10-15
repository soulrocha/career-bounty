// Consulta do Gmail montada pelo script: o LLM nunca inventa a busca. Só remetentes de portais e termos do config.
// Nada da identidade da pessoa entra na consulta.
import { dominiosDosPortais } from './portais.mjs';
import { localDay } from '../store/schema.mjs';

const DIA = 86400000;
const gmailDia = dia => dia.replaceAll('-', '/');
const menosDias = (dia, n) => localDay(new Date(Date.parse(`${dia}T12:00:00Z`) - n * DIA));

// cursor: resultado de lerCursor ({ ate, vistos, avisos }). Sobreposição de 1 dia: o cursor fica 1 dia para trás.
export function buildQuery({ mail, cursor = { ate: null }, now = new Date() }) {
  const hoje = localDay(now);
  const avisos = [...(cursor.avisos ?? [])];
  const base = cursor.ate ? menosDias(cursor.ate, 1) : menosDias(hoje, mail.janela_dias ?? 7);
  const remetentes = dominiosDosPortais(mail.portais_extras ?? []);
  const partes = [`from:(${remetentes.join(' OR ')})`];
  if (!mail.so_portais && mail.termos?.length) partes.push(`subject:(${mail.termos.map(termo => `"${termo}"`).join(' OR ')})`);
  const filtro = partes.length > 1 ? `(${partes.join(' OR ')})` : partes[0];
  return { query: `${filtro} after:${gmailDia(base)}`, after: gmailDia(base), cursor_usado: cursor.ate ?? null, limite: mail.limite_resultados ?? 50, janela_dias: mail.janela_dias ?? 7, avisos };
}
