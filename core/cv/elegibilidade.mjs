// Quais afirmações podem virar fato num CV. Regra única, usada pelo redator, pela seleção, pelo perfil de portal e pelos gates.
//   - nível de prova verificado ou entregue (relato e proposto são pista, nunca fato);
//   - publicavel diferente de "nao";
//   - uso inclui CV.
import { NIVEIS_COM_PROVA } from '../kb/schema.mjs';

const COM_PROVA = new Set(NIVEIS_COM_PROVA);

export const usaCv = afirmacao => (afirmacao.uso ?? []).some(uso => String(uso).trim().toUpperCase() === 'CV');

// null quando a afirmação pode entrar; senão { codigo, motivo }.
export function motivoInelegivel(afirmacao) {
  if (afirmacao.publicavel === 'nao') return { codigo: 'nao_publicavel', motivo: `${afirmacao.id} está marcada como não publicável` };
  if (!COM_PROVA.has(afirmacao.nivel_prova)) return { codigo: 'afirmacao_sem_prova', motivo: `${afirmacao.id} (${afirmacao.nivel_prova}) não sustenta fato no CV; só verificado ou entregue` };
  if (!usaCv(afirmacao)) return { codigo: 'uso_fora_do_cv', motivo: `${afirmacao.id} não tem uso CV` };
  return null;
}

export const elegiveis = afirmacoes => afirmacoes.filter(afirmacao => motivoInelegivel(afirmacao) === null);
