// Delta: só o que ainda precisa de LLM vai ao LLM. Função pura sobre a projeção.
const aplicada = vaga => Boolean(vaga.candidatura_usuario?.aplicada || vaga.candidatura_email?.aplicada || vaga.candidatura_portal?.aplicada || vaga.historico || vaga.historico_anterior);
const descartada = vaga => Boolean(vaga.descarte_usuario?.descartada);

// A vaga é elegível ao radar? Descartada, aplicada, incompatível ou de pré-score baixo nunca entram.
export function elegivel(vaga) {
  if (descartada(vaga) || aplicada(vaga)) return false;
  if (vaga.url_status === 'encerrada' || vaga.aderencia === 'incompativel') return false;
  if (vaga.pre_nivel === 'baixa') return false;
  return Boolean(vaga.descricao_hash);
}

export const triagemVale = (vaga, { versaoTriador }) =>
  Boolean(vaga.triagem && vaga.triagem.descricao_hash === vaga.descricao_hash && vaga.triagem.versaoPrompt === versaoTriador);

export const avaliacaoVale = (vaga, { snapshot, versaoAvaliador }) => {
  const a = vaga.avaliacao_radar;
  return Boolean(a && a.descricao_hash === vaga.descricao_hash && a.snapshot_afirmacoes === snapshot && a.versaoPrompt === versaoAvaliador);
};

// Devolve as vagas elegíveis divididas em: precisam de triagem, precisam de avaliação (triadas como "avaliar").
export function calcularDelta(vagas, versoes) {
  const triar = [];
  const avaliar = [];
  for (const vaga of vagas) {
    if (!elegivel(vaga)) continue;
    if (!triagemVale(vaga, versoes)) { triar.push(vaga); continue; }
    if (vaga.triagem.decisao === 'avaliar' && !avaliacaoVale(vaga, versoes)) avaliar.push(vaga);
  }
  return { triar, avaliar };
}
