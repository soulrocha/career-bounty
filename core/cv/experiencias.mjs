// Liga cada afirmação a uma experiência do perfil de CV: mesma empresa e, havendo mais de uma passagem pela empresa,
// a de maior sobreposição com o período da afirmação (AAAA-MM..AAAA-MM). Sem correspondência: null (vai para "destaques").
import { fold } from '../dedup/keys.mjs';

export const DESTAQUES = 'destaques';
const FIM_ABERTO = '9999-12';

function periodoDe(texto) {
  const m = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})?$/.exec(String(texto ?? '').trim());
  return m ? { inicio: m[1], fim: m[2] ?? FIM_ABERTO } : null;
}

const sobreposicao = (a, b) => {
  const inicio = a.inicio > b.inicio ? a.inicio : b.inicio;
  const fim = a.fim < b.fim ? a.fim : b.fim;
  return inicio <= fim ? 1 + (Number(fim.slice(0, 4)) * 12 + Number(fim.slice(5)) - Number(inicio.slice(0, 4)) * 12 - Number(inicio.slice(5))) : 0;
};

export function experienciaDaAfirmacao(afirmacao, experiencias) {
  if (!afirmacao.empresa) return null;
  const candidatas = experiencias.filter(exp => fold(exp.empresa) === fold(afirmacao.empresa));
  if (candidatas.length <= 1) return candidatas[0]?.id ?? null;
  const periodo = periodoDe(afirmacao.periodo);
  if (!periodo) return candidatas[0].id;
  const pontuadas = candidatas.map(exp => ({ id: exp.id, pontos: sobreposicao(periodo, { inicio: exp.inicio ?? '0000-01', fim: exp.fim ?? FIM_ABERTO }) }));
  return pontuadas.reduce((melhor, atual) => (atual.pontos > melhor.pontos ? atual : melhor)).id;
}

// Agrupa as afirmações por experiência (e "destaques" para as sem correspondência), na ordem do perfil.
export function agruparPorExperiencia(afirmacoes, experiencias) {
  const grupos = new Map([...experiencias.map(exp => [exp.id, []]), [DESTAQUES, []]]);
  for (const afirmacao of afirmacoes) grupos.get(experienciaDaAfirmacao(afirmacao, experiencias) ?? DESTAQUES).push(afirmacao);
  return grupos;
}
