// Filtros duros, sem LLM: o que a configuração pessoal já elimina antes de qualquer triagem.
import { fold } from '../dedup/keys.mjs';
import { constraints, modalidadeDe } from './constraints.mjs';

const BRASIL = /\b(brasil|brazil)\b/;
const EXTERIOR = /\b(united states|usa|estados unidos|canada|portugal|spain|espanha|united kingdom|reino unido|germany|alemanha|france|franca|india|mexico|argentina|chile|colombia|uruguay|uruguai|netherlands|holanda|ireland|irlanda|australia|poland|polonia|italy|italia|singapore|japan|japao)\b/;

export const foraDoBrasil = local => {
  const texto = fold(local);
  return texto !== '' && !BRASIL.test(texto) && EXTERIOR.test(texto);
};

// Devolve { descartada, motivos, condicoes }. Salário nunca elimina, divulgado ou não:
// a vaga quase nunca publica valor, então o piso ficou só como referência de negociação no config.yml
// e o portão não o lê. Quem replica o legado é constraints()/merge(), que seguem com o piso intacto.
export function hardFilter(vaga, criterios = {}) {
  const motivos = [];
  if (foraDoBrasil(vaga.local)) motivos.push('Local fora do Brasil');
  // Modalidade que a pessoa não aceita elimina; modalidade não informada na vaga não elimina.
  const modalidade = modalidadeDe(vaga.modalidade);
  if (criterios.modalidades?.length && modalidade && !criterios.modalidades.includes(modalidade)) {
    motivos.push(`Modalidade fora das preferências (aceitas: ${criterios.modalidades.join(', ')})`);
  }
  // Sem região configurada, presença física não elimina: o piso de região vira o próprio local da vaga.
  const regiao = criterios.regiao_presencial?.length ? criterios.regiao_presencial.map(fold) : [fold(vaga.local)];
  // Piso sempre nulo aqui: sem piso, constraints() não compara salário nem marca incompatível por valor.
  const condicoes = constraints(vaga, { regiao_presencial: regiao, clt: { onsite_min: null, remote_hybrid_min: null }, pj: { min: null } });
  if (condicoes.situacao === 'incompativel') motivos.push(...condicoes.motivos.filter(motivo => /fora d[ea]|não elegível/i.test(motivo)));
  return { descartada: motivos.length > 0, motivos, condicoes };
}
