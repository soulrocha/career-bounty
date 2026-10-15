import assert from 'node:assert/strict';
import test from 'node:test';
import { descobertaEvent } from '../../core/radar/collect.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';

const vaga = makeVaga({ fonte: 'a', portal: 'gupy', requisicao_id: '99', empresa: 'Empresa Alfa', cargo: 'Gerente', url: 'https://x.exemplo.test/99', descricao: 'texto' });
const ts = '2026-10-14T15:00:00.000Z';
const base = [descobertaEvent(vaga, 'empresa-alfa-1', ts, [{ fonte: 'a', url: vaga.url }], { pre: { nivel: 'candidata', pre_score: 0.7, motivos: [], descartada: false } })];

test('triagem e avaliação entram na vaga projetada sem tocar o que a pessoa marcou', () => {
  const eventos = [...base,
    { id: 't1', ts, host: 'h', ator: 'radar', tipo: 'vaga.triada', entidade: 'vaga', entidade_id: 'empresa-alfa-1', dados: { decisao: 'avaliar', motivo: 'ok' } },
    { id: 'a1', ts, host: 'h', ator: 'radar', tipo: 'vaga.avaliada', entidade: 'vaga', entidade_id: 'empresa-alfa-1', dados: { descricao_hash: vaga.descricao_hash, avaliacao: {
      aderencia: 'media', resumo: 'Encaixe razoável.', aderencia_sugerida_llm: 'alta', ajustes: [], pendencias: ['confirmar salário'], snapshot_afirmacoes: 'abc', versaoPrompt: 'p', modelo: 'sonnet',
      requisitos: [{ requisito: 'Inglês fluente', tipo: 'obrigatorio', avaliacao: 'lacuna', afirmacoes: [] }, { requisito: 'Liderança', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: ['AF-001'] }] } } }]
    .map((e, i) => ({ seq: i, host: 'h', ...e }));
  const [projetada] = projectEvents(eventos.map(e => ({ host: 'h', ...e }))).vagas;
  assert.equal(projetada.aderencia, 'media');
  assert.equal(projetada.triagem.decisao, 'avaliar');
  assert.deepEqual(projetada.lacunas, ['Inglês fluente']);
  assert.equal(projetada.requisitos[0].avaliacao, 'nao-atendido', 'o painel entende o vocabulário legado');
  assert.deepEqual(projetada.pendencias, ['confirmar salário']);
  assert.equal(projetada.avaliacao_radar.modelo, 'sonnet');
});
