// Filtros duros, sem LLM: o que a configuração pessoal já elimina antes de qualquer triagem.
import { fold } from '../dedup/keys.mjs';
import { constraints } from './constraints.mjs';

const BRASIL = /\b(brasil|brazil)\b/;
const EXTERIOR = /\b(united states|usa|estados unidos|canada|portugal|spain|espanha|united kingdom|reino unido|germany|alemanha|france|franca|india|mexico|argentina|chile|colombia|uruguay|uruguai|netherlands|holanda|ireland|irlanda|australia|poland|polonia|italy|italia|singapore|japan|japao)\b/;

export const foraDoBrasil = local => {
  const texto = fold(local);
  return texto !== '' && !BRASIL.test(texto) && EXTERIOR.test(texto);
};

// Devolve { descartada, motivos, condicoes }. Salário desconhecido nunca elimina.
export function hardFilter(vaga, criterios = {}) {
  const motivos = [];
  if (foraDoBrasil(vaga.local)) motivos.push('Local fora do Brasil');
  // Sem região configurada, presença física não elimina: o piso de região vira o próprio local da vaga.
  const regiao = criterios.regiao_presencial?.length ? criterios.regiao_presencial.map(fold) : [fold(vaga.local)];
  const condicoes = constraints(vaga, { regiao_presencial: regiao, clt: { onsite_min: null, remote_hybrid_min: null, ...criterios.clt }, pj: { min: null, ...criterios.pj } });
  if (condicoes.situacao === 'incompativel') motivos.push(...condicoes.motivos.filter(motivo => /fora de|abaixo do piso|não elegível/i.test(motivo)));
  return { descartada: motivos.length > 0, motivos, condicoes };
}
