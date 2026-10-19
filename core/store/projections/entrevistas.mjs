// Projeção pura e determinística de entrevistas preparadas (F9.6).
export function projectEntrevistas(eventos = [], { now = new Date() } = {}) {
  const historico = [];
  const por_vaga = {};

  for (const ev of eventos) {
    if (ev?.tipo !== 'entrevista.preparada' || !ev.dados) continue;
    const reg = {
      vaga_id: ev.dados.vaga_id,
      arquivo: typeof ev.dados.arquivo === 'string' ? ev.dados.arquivo.replaceAll('\\', '/') : ev.dados.arquivo,
      data: ev.dados.data,
      pontos_fortes_count: ev.dados.pontos_fortes_count,
      lacunas_count: ev.dados.lacunas_count,
      ts: ev.ts,
    };
    historico.push(reg);
    por_vaga[reg.vaga_id] = reg;
  }

  return {
    por_vaga,
    historico,
    total_preparadas: Object.keys(por_vaga).length,
  };
}
