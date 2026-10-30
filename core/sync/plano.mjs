// Plano de três vias entre a cópia local, o servidor e a base (o hash de cada arquivo na última sincronização).
// Puro, sem I/O. Cada lado só escreve o que mudou desde a base; o log de eventos é um arquivo por host, então ali
// nunca há conflito. Quando os dois lados mudaram o mesmo arquivo, o servidor vence e a versão local vira cópia
// de conflito (quem chama a preserva). Apagar só se propaga quando o outro lado continua igual à base.

const porCaminho = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function planejar({ local, remoto, base }) {
  const plano = { enviar: [], baixar: [], apagarLocal: [], apagarRemoto: [], conflitos: [], iguais: [] };
  const caminhos = new Set([...local.keys(), ...remoto.keys(), ...base.keys()]);
  for (const path of caminhos) {
    const l = local.get(path) ?? null;
    const r = remoto.get(path) ?? null;
    const b = base.get(path) ?? null;
    if (l === r) {
      if (l !== null) plano.iguais.push({ path, sha256: l });
    } else if (l === null) {
      if (r === b) plano.apagarRemoto.push({ path, esperado: r });
      else plano.baixar.push({ path, sha256: r, localEsperado: null });
    } else if (r === null) {
      if (l === b) plano.apagarLocal.push({ path, esperado: l });
      else plano.enviar.push({ path, sha256: l, esperado: null });
    } else if (r === b) plano.enviar.push({ path, sha256: l, esperado: r });
    else if (l === b) plano.baixar.push({ path, sha256: r, localEsperado: l });
    else plano.conflitos.push({ path, sha256: r, localEsperado: l });
  }
  for (const lista of Object.values(plano)) lista.sort(porCaminho);
  return plano;
}
