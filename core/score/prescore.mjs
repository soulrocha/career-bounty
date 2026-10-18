// Pré-score determinístico: título-alvo, palavras-chave e palavras negativas da configuração pessoal.
// Abaixo do corte a vaga vira "baixa" e não vai ao LLM. Requisito crítico (fluência, certificação, anos de gestão)
// só é marcado como não comprovado: o pré-score nunca o dá como atendido.
import { fold } from '../dedup/keys.mjs';
import { hardFilter } from './hard.mjs';
import { modalidadeDe } from './constraints.mjs';

export const CORTE_PADRAO = 0.35;

const CRITICOS = [
  ['fluencia', /\b(ingles|english|espanhol|spanish)\b.{0,30}\bfluen/, /\bfluen\w*.{0,30}\b(ingles|english|espanhol|spanish)\b/],
  ['certificacao', /\bcertifica/, /\bpmp\b|\bcsm\b|\bitil\b/],
  ['anos_gestao', /\d+\s*(\+\s*)?anos.{0,40}\b(gestao|lideranca|gerencia)/],
];

export function preScore(vaga, criterios = {}) {
  const cargo = fold(vaga.cargo);
  const texto = fold(`${vaga.cargo} ${vaga.descricao}`);
  const motivos = [];
  let score = 0;
  if ((criterios.titulos_alvo ?? []).some(titulo => cargo.includes(fold(titulo)))) { score += 0.5; motivos.push('Título alinhado ao cargo-alvo'); }
  const chaves = criterios.palavras_chave ?? [];
  if (chaves.length) {
    const achadas = chaves.filter(palavra => texto.includes(fold(palavra)));
    score += 0.4 * (achadas.length / chaves.length);
    if (achadas.length) motivos.push(`Palavras-chave presentes: ${achadas.length} de ${chaves.length}`);
  }
  for (const negativa of criterios.palavras_negativas ?? []) {
    if (cargo.includes(fold(negativa))) { score -= 0.5; motivos.push(`Palavra negativa no cargo: ${negativa}`); }
    else if (texto.includes(fold(negativa))) { score -= 0.2; motivos.push(`Palavra negativa na descrição: ${negativa}`); }
  }
  // A modalidade preferida da pessoa vale mais que as outras aceitas; sem preferência, remoto e híbrido valem igual.
  const modalidade = modalidadeDe(vaga.modalidade);
  if (criterios.modalidade_preferida && modalidade === criterios.modalidade_preferida) { score += 0.2; motivos.push(`Modalidade preferida: ${modalidade}`); }
  else if (['remoto', 'hibrido'].includes(modalidade)) score += 0.1;
  const criticos = CRITICOS.filter(([, ...padroes]) => padroes.some(padrao => padrao.test(texto))).map(([tipo]) => ({ tipo, status: 'nao_comprovado' }));
  return { pre_score: Math.round(Math.min(1, Math.max(0, score)) * 100) / 100, motivos, criticos };
}

// Filtro duro + pré-score. `delta` diz se a vaga segue para a triagem por LLM.
export function triagemPre(vaga, criterios = {}) {
  const duro = hardFilter(vaga, criterios);
  const pre = preScore(vaga, criterios);
  const corte = criterios.corte_prescore ?? CORTE_PADRAO;
  const nivel = duro.descartada || pre.pre_score < corte ? 'baixa' : 'candidata';
  return { descartada: duro.descartada, nivel, pre_score: pre.pre_score, motivos: [...duro.motivos, ...pre.motivos], criticos: pre.criticos, condicoes: duro.condicoes, delta: nivel === 'candidata' };
}
