// Comparativo da semana em paralelo: o radar antigo (pipeline legado) contra o radar novo (vagas descobertas por ele).
import { roleKey } from '../dedup/keys.mjs';

const resumo = (vaga, chave) => ({ chave, empresa: vaga.empresa, cargo: vaga.cargo, aderencia: vaga.aderencia ?? null });
const desdeData = (vaga, desde) => String(vaga.consultado_em ?? '').slice(0, 10) >= desde;

// antigo: vagas do pipeline legado. novo: vagas projetadas (só as que o radar novo descobriu entram na conta).
export function compararRadar({ antigo, novo, desde, aliases = {} }) {
  const chaveDe = vaga => roleKey(vaga, { aliases });
  const velhas = new Map(antigo.filter(vaga => desdeData(vaga, desde)).map(vaga => [chaveDe(vaga), vaga]));
  const novas = new Map(novo.filter(vaga => vaga.portal_origem && desdeData(vaga, desde)).map(vaga => [chaveDe(vaga), vaga]));
  const ambos = [];
  const soAntigo = [];
  const soNovo = [];
  for (const [chave, vaga] of velhas) (novas.has(chave) ? ambos : soAntigo).push(resumo(vaga, chave));
  for (const [chave, vaga] of novas) if (!velhas.has(chave)) soNovo.push(resumo(vaga, chave));
  return {
    desde, contagem: { antigo: velhas.size, novo: novas.size, ambos: ambos.length, so_antigo: soAntigo.length, so_novo: soNovo.length },
    ambos, so_antigo: soAntigo, so_novo: soNovo,
    // O novo precisa explicar toda vaga alta ou boa que só o antigo achou.
    altas_boas_so_antigo: soAntigo.filter(vaga => ['alta', 'boa'].includes(vaga.aderencia)),
  };
}
