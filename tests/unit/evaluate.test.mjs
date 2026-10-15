import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { createRunner } from '../../core/llm/runner.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { avaliar } from '../../core/score/evaluate.mjs';
import { calcularAderencia, validarAvaliacao, refinarAvaliacao } from '../../core/score/validate.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';

const persona = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'examples', 'persona-ficticia');
const afirmacoes = await createMarkdownFolder(persona).claims();
const ids = new Set(afirmacoes.map(a => a.id));
const niveis = new Map(afirmacoes.map(a => [a.id, a.nivel_prova]));

const req = (extra = {}) => ({ requisito: 'Liderança de times', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: ['AF-001'], observacao: 'ok', ...extra });
const saida = (requisitos, extra = {}) => ({ vaga_id: 'v1', requisitos, aderencia_sugerida: 'alta', resumo: 'Bom encaixe.', pendencias: [], ...extra });
const vaga = { id: 'v1', vaga: makeVaga({ empresa: 'Empresa Alfa', cargo: 'Gerente', url: 'https://x.exemplo.test/1', descricao: 'Texto da vaga.' }) };

test('saída válida é aceita', () => {
  assert.doesNotThrow(() => validarAvaliacao(saida([req()]), { ids, vagaId: 'v1' }));
});

test('ID de afirmação inexistente rejeita o JSON', () => {
  assert.throws(() => validarAvaliacao(saida([req({ afirmacoes: ['AF-999'] })]), { ids, vagaId: 'v1' }), /AF-999/);
});

test('vaga_id diferente, campo extra e enums inválidos rejeitam', () => {
  assert.throws(() => validarAvaliacao(saida([req()], { vaga_id: 'v2' }), { ids, vagaId: 'v1' }), /vaga_id/);
  assert.throws(() => validarAvaliacao(saida([req({ avaliacao: 'otimo' })]), { ids, vagaId: 'v1' }), /avaliacao/);
  assert.throws(() => validarAvaliacao(saida([req({ extra: 1 })]), { ids, vagaId: 'v1' }), /campo/);
  assert.throws(() => validarAvaliacao({ ...saida([req()]), instrucao: 'x' }, { ids, vagaId: 'v1' }), /campo/);
});

test('atendido sem afirmação de prova é rebaixado para parcial', () => {
  const sem = refinarAvaliacao(saida([req({ afirmacoes: [] })]), niveis);
  assert.equal(sem.requisitos[0].avaliacao, 'parcial');
  const soRelato = refinarAvaliacao(saida([req({ afirmacoes: ['AF-002'] })]), niveis);
  assert.equal(soRelato.requisitos[0].avaliacao, 'parcial');
  const comProva = refinarAvaliacao(saida([req({ afirmacoes: ['AF-001'] })]), niveis);
  assert.equal(comProva.requisitos[0].avaliacao, 'atendido');
});

test('fluência, certificação e anos de gestão nunca são inferidos: atendido sem prova vira lacuna', () => {
  for (const texto of ['Inglês fluente', 'Certificação PMP', '8 anos de experiência em gestão']) {
    const r = refinarAvaliacao(saida([req({ requisito: texto, afirmacoes: [] })]), niveis);
    assert.equal(r.requisitos[0].avaliacao, 'lacuna', texto);
  }
  const comProva = refinarAvaliacao(saida([req({ requisito: 'Certificação em gestão de produtos', afirmacoes: ['AF-003'] })]), niveis);
  assert.equal(comProva.requisitos[0].avaliacao, 'atendido');
});

test('afirmação do tipo relato aparece marcada como não verificada', () => {
  const r = refinarAvaliacao(saida([req({ avaliacao: 'parcial', afirmacoes: ['AF-002'] })]), niveis);
  assert.equal(r.requisitos[0].nao_verificado, true);
  assert.equal(refinarAvaliacao(saida([req({ afirmacoes: ['AF-001'] })]), niveis).requisitos[0].nao_verificado, undefined);
});

test('aderência é calculada dos requisitos e rebaixa com obrigatório em lacuna', () => {
  assert.equal(calcularAderencia([req(), req({ requisito: 'b' })]), 'alta');
  assert.equal(calcularAderencia([req(), req({ requisito: 'b', avaliacao: 'lacuna', afirmacoes: [] })]), 'media');
  assert.equal(calcularAderencia([req({ avaliacao: 'lacuna', afirmacoes: [] }), req({ requisito: 'b', avaliacao: 'lacuna', afirmacoes: [] })]), 'baixa');
  assert.equal(calcularAderencia([req({ tipo: 'desejavel', avaliacao: 'lacuna', afirmacoes: [] }), req()]), 'alta', 'desejável em lacuna não derruba');
  const final = refinarAvaliacao(saida([req(), req({ requisito: 'b', avaliacao: 'lacuna', afirmacoes: [] })], { aderencia_sugerida: 'alta' }), niveis);
  assert.equal(final.aderencia, 'media');
  assert.equal(final.aderencia_sugerida_llm, 'alta');
});

test('avaliar: saída válida vira avaliação da vaga e JSON truncado tem uma nova tentativa', async t => {
  const dataRoot = await tempDir(t);
  let chamadas = 0;
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => { chamadas += 1; return chamadas === 1 ? '{"vaga_id": "v1", "requisitos": [' : saida([req()]); } });
  const { avaliacao } = await avaliar({ runner, vaga, afirmacoes });
  assert.equal(chamadas, 2);
  assert.equal(avaliacao.aderencia, 'alta');
  assert.equal(avaliacao.vaga_id, 'v1');
  assert.ok(avaliacao.snapshot_afirmacoes.length === 12);
});

test('a entrada do avaliador leva só afirmações com id, texto e nível, nunca o arquivo', async t => {
  const dataRoot = await tempDir(t);
  let visto;
  const runner = createRunner({ modo: 'fake', dataRoot, fake: ({ entrada }) => { visto = entrada; return saida([req()]); } });
  await avaliar({ runner, vaga, afirmacoes });
  assert.deepEqual(Object.keys(visto.afirmacoes[0]).sort(), ['id', 'nivel_prova', 'texto']);
});

test('o agente avaliador usa Sonnet e não tem ferramentas', async () => {
  const agente = await loadAgent('avaliador');
  assert.equal(agente.modelo, 'sonnet');
  assert.deepEqual(agente.tools, ['none']);
});
