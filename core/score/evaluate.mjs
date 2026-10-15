// Avaliação da vaga completa (Sonnet) contra as afirmações da pessoa, com validação determinística.
import { createHash } from 'node:crypto';
import { loadAgent } from '../llm/agents.mjs';
import { embrulhar, limparCampoCurto, limparTextoNaoConfiavel } from '../privacy/untrusted.mjs';
import { refinarAvaliacao, validarAvaliacao } from './validate.mjs';

export const DESCRICAO_MAX_CHARS = 12000;

export const snapshotAfirmacoes = afirmacoes =>
  createHash('sha256').update(JSON.stringify(afirmacoes.map(a => [a.id, a.texto, a.nivel_prova]).sort())).digest('hex').slice(0, 12);

// vaga: { id, vaga }. afirmacoes: lista do KnowledgeSource (id, texto, nivel_prova, ...).
export async function avaliar({ runner, vaga, afirmacoes }) {
  const agente = await loadAgent('avaliador');
  const ids = new Set(afirmacoes.map(a => a.id));
  const niveis = new Map(afirmacoes.map(a => [a.id, a.nivel_prova]));
  const descricao = limparTextoNaoConfiavel(vaga.vaga.descricao, { max: DESCRICAO_MAX_CHARS });
  const entrada = {
    afirmacoes: afirmacoes.map(a => ({ id: a.id, texto: a.texto, nivel_prova: a.nivel_prova })),
    vaga: { id: vaga.id, cargo: limparCampoCurto(vaga.vaga.cargo), empresa: limparCampoCurto(vaga.vaga.empresa), local: limparCampoCurto(vaga.vaga.local ?? ''), modalidade: limparCampoCurto(vaga.vaga.modalidade ?? '', 40), regime: limparCampoCurto(vaga.vaga.regime ?? '', 20), descricao: embrulhar(descricao.texto) },
  };
  const { json, uso, hash } = await runner.run({ agente: 'avaliador', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, sistema: agente.sistema, entrada, validar: saida => validarAvaliacao(saida, { ids, vagaId: vaga.id }) });
  const avaliacao = { ...refinarAvaliacao(json, niveis), snapshot_afirmacoes: snapshotAfirmacoes(afirmacoes), versaoPrompt: agente.versaoPrompt, modelo: agente.modelo, avisos_entrada: descricao.avisos };
  return { avaliacao, uso, hash };
}
