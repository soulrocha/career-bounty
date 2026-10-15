// Estágio 2 do radar: triagem (Haiku) e avaliação (Sonnet) só sobre o delta. Cada resultado vira evento na hora,
// então uma rodada interrompida retoma de onde parou, sem duplicar.
import { loadAgent } from '../llm/agents.mjs';
import { LlmSaidaInvalida } from '../llm/runner.mjs';
import { avaliar, snapshotAfirmacoes } from '../score/evaluate.mjs';
import { calcularDelta } from '../score/delta.mjs';
import { triar } from '../score/triage.mjs';
import { appendEvents, readEvents } from '../store/events.mjs';
import { projectEvents } from '../store/project.mjs';

const evento = (tipo, id, chave, ts, dados) => ({ id: `${tipo}:${id}:${chave}`, ts, ator: 'radar', tipo, entidade: 'vaga', entidade_id: id, dados });

export async function runStage2({ dataRoot, runner, afirmacoes, brief, now = new Date(), host, limiteAvaliacoes = 30 }) {
  const [triador, avaliador] = [await loadAgent('triador'), await loadAgent('avaliador')];
  const versoes = { versaoTriador: triador.versaoPrompt, versaoAvaliador: avaliador.versaoPrompt, snapshot: snapshotAfirmacoes(afirmacoes) };
  const ts = now.toISOString();
  const opcoes = { ...(host ? { host } : {}), now: ts };
  const projetar = async () => {
    const { eventos, avisos } = await readEvents(dataRoot);
    if (avisos.length) throw new Error(`Log de eventos truncado ou corrompido (${avisos.length} aviso(s)); revisão necessária.`);
    return projectEvents(eventos).vagas;
  };
  const resultado = { triadas: 0, avaliadas: 0, avaliadas_ids: [], falhas: [], doCache: 0 };

  const primeiro = calcularDelta(await projetar(), versoes);
  if (primeiro.triar.length) {
    const lote = primeiro.triar.map(vaga => ({ id: vaga.id, vaga: { cargo: vaga.cargo, empresa: vaga.empresa, local: vaga.local, modalidade: vaga.modalidade, regime: vaga.regime, descricao: vaga.descricao_completa ?? '', descricao_hash: vaga.descricao_hash } }));
    const { decisoes, doCache } = await triar({ runner, dataRoot, vagas: lote, brief });
    resultado.doCache = doCache;
    await appendEvents(dataRoot, [...decisoes].map(([id, d]) => {
      const vaga = primeiro.triar.find(item => item.id === id);
      return evento('vaga.triada', id, `${vaga.descricao_hash.slice(0, 12)}:${triador.versaoPrompt}`, ts, { decisao: d.decisao, motivo: d.motivo, descricao_hash: vaga.descricao_hash, versaoPrompt: triador.versaoPrompt });
    }), opcoes);
    resultado.triadas = decisoes.size;
  }

  const { avaliar: aAvaliar } = calcularDelta(await projetar(), versoes);
  for (const vaga of aAvaliar.slice(0, limiteAvaliacoes)) {
    try {
      const { avaliacao } = await avaliar({ runner, afirmacoes, vaga: { id: vaga.id, vaga: { cargo: vaga.cargo, empresa: vaga.empresa, local: vaga.local, modalidade: vaga.modalidade, regime: vaga.regime, descricao: vaga.descricao_completa ?? '' } } });
      await appendEvents(dataRoot, [evento('vaga.avaliada', vaga.id, `${vaga.descricao_hash.slice(0, 12)}:${avaliacao.snapshot_afirmacoes}:${avaliacao.versaoPrompt}`, ts, { descricao_hash: vaga.descricao_hash, avaliacao })], opcoes);
      resultado.avaliadas += 1;
      resultado.avaliadas_ids.push(vaga.id);
    } catch (error) {
      if (!(error instanceof LlmSaidaInvalida)) throw error;
      resultado.falhas.push({ id: vaga.id, erro: error.message });
    }
  }
  return resultado;
}
