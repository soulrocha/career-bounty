// Harness de concordância do radar: o pipeline (triagem + avaliação) contra o rótulo da pessoa em um golden set.
import { readEvents } from '../store/events.mjs';
import { avaliar } from '../score/evaluate.mjs';
import { triar } from '../score/triage.mjs';
import { makeVaga } from '../sources/vaga.mjs';

export const ROTULOS = ['alta', 'media', 'baixa'];
export const MINIMO_PADRAO = 0.85;

// Previsão do pipeline em vocabulário de aderência: descartar vira baixa, talvez vira media.
export const previsao = (decisao, aderencia) => (decisao === 'descartar' ? 'baixa' : decisao === 'talvez' ? 'media' : aderencia ?? 'media');

// previsoes: [{ id, rotulo, obtido, motivo }]. "pendente" (ou rótulo inválido) fica fora da conta.
export function concordancia(previsoes) {
  const rotuladas = previsoes.filter(item => ROTULOS.includes(item.rotulo));
  const acertos = rotuladas.filter(item => item.rotulo === item.obtido);
  return {
    total: previsoes.length, rotuladas: rotuladas.length, sem_rotulo: previsoes.length - rotuladas.length, acertos: acertos.length,
    concordancia: rotuladas.length ? Math.round((acertos.length / rotuladas.length) * 10000) / 10000 : null,
    discordancias: rotuladas.filter(item => item.rotulo !== item.obtido).map(item => ({ id: item.id, esperado: item.rotulo, obtido: item.obtido, motivo: item.motivo ?? '' })),
  };
}

export async function resumirUso(dataRoot) {
  const { eventos } = await readEvents(dataRoot);
  const uso = {};
  for (const evento of eventos.filter(item => item.tipo === 'llm.uso')) {
    const atual = uso[evento.dados.agente] ?? { chamadas: 0, tokens_in: 0, tokens_out: 0, tokens_cache_leitura: 0, tokens_cache_criacao: 0, custo_usd: 0 };
    atual.chamadas += 1;
    atual.tokens_in += evento.dados.tokens_in ?? 0;
    atual.tokens_out += evento.dados.tokens_out ?? 0;
    atual.tokens_cache_leitura += evento.dados.tokens_cache_leitura ?? 0;
    atual.tokens_cache_criacao += evento.dados.tokens_cache_criacao ?? 0;
    atual.custo_usd = Math.round((atual.custo_usd + (evento.dados.custo_usd ?? 0)) * 1e6) / 1e6;
    uso[evento.dados.agente] = atual;
  }
  return uso;
}

// golden: { vagas: [{ id, cargo, empresa, descricao, rotulo_saulo }] }.
export async function avaliarGolden({ golden, runner, dataRoot, afirmacoes, brief }) {
  const itens = golden.vagas.map(item => ({ id: item.id, vaga: makeVaga({ empresa: item.empresa, cargo: item.cargo, local: item.local, modalidade: item.modalidade, regime: item.regime, url: 'https://golden.exemplo.test/vaga', descricao: item.descricao }) }));
  const { decisoes } = await triar({ runner, dataRoot, vagas: itens, brief });
  const previsoes = [];
  for (const item of itens) {
    const decisao = decisoes.get(item.id);
    let aderencia = null;
    if (decisao.decisao === 'avaliar') aderencia = (await avaliar({ runner, vaga: item, afirmacoes })).avaliacao.aderencia;
    const rotulo = golden.vagas.find(v => v.id === item.id).rotulo_saulo;
    previsoes.push({ id: item.id, rotulo, obtido: previsao(decisao.decisao, aderencia), motivo: decisao.motivo });
  }
  return { ...concordancia(previsoes), uso: await resumirUso(dataRoot) };
}
