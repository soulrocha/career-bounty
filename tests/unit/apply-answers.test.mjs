import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { HOJE, resposta } from '../helpers/apply.mjs';
import { arquivoRespostas, buscarResposta, descreverParaLog, gravarResposta, lerRespostas, normalizarRotulo, respostasParaLlm, validarResposta } from '../../core/apply/answers.mjs';



test('grava resposta com variantes, escopo, sensibilidade, proveniência e validade, e lê de volta', async t => {
  const dataRoot = await tempDir(t);
  assert.deepEqual(await lerRespostas(dataRoot), []);
  assert.equal((await gravarResposta(dataRoot, resposta())).gravada, true);
  assert.deepEqual(await lerRespostas(dataRoot), [resposta()]);
  for (const ruim of [{ id: 'X Y' }, { variantes_label: [] }, { resposta: '' }, { escopo: { tipo: 'empresa' } }, { escopo: { tipo: 'mundo' } }, { sensivel: 'sim' }, { proveniencia: { origem: 'llm' } }, { validade: '17/04/2027' }]) {
    assert.throws(() => validarResposta(resposta(ruim)), /answers\.yml/, JSON.stringify(ruim));
  }
});

test('resposta vencida não é devolvida', () => {
  const r = [resposta({ validade: '2026-10-16' })];
  assert.equal(buscarResposta(r, { label: 'Pretensão salarial', hoje: HOJE }), null);
  assert.ok(buscarResposta([resposta({ validade: null })], { label: 'Pretensão salarial', hoje: HOJE }));
  assert.ok(buscarResposta([resposta({ validade: HOJE })], { label: 'Pretensão salarial', hoje: HOJE }));
});

test('o escopo mais específico vence o geral (empresa > portal > global)', () => {
  const respostas = [
    resposta({ id: 'sal-global' }),
    resposta({ id: 'sal-gupy', resposta: 'R$ 11.000', escopo: { tipo: 'portal', valor: 'Gupy' } }),
    resposta({ id: 'sal-empresa', resposta: 'R$ 12.000', escopo: { tipo: 'empresa', valor: 'Empresa 01' } }),
  ];
  const busca = ctx => buscarResposta(respostas, { label: 'Salário desejado', hoje: HOJE, ...ctx })?.id;
  assert.equal(busca({}), 'sal-global');
  assert.equal(busca({ portal: 'gupy' }), 'sal-gupy');
  assert.equal(busca({ portal: 'Gupy', empresa: 'Empresa 01' }), 'sal-empresa');
  assert.equal(busca({ portal: 'Lever', empresa: 'Empresa 02' }), 'sal-global');
});

test('duas respostas válidas no mesmo escopo para o mesmo rótulo são conflito', () => {
  const respostas = [resposta({ id: 'a' }), resposta({ id: 'b', resposta: 'R$ 9.000' })];
  assert.throws(() => buscarResposta(respostas, { label: 'Pretensão salarial', hoje: HOJE }), /Conflito no answer bank: a e b/);
});

test('resposta sensível nunca vai ao LLM nem ao log', () => {
  const respostas = [resposta(), resposta({ id: 'linkedin', variantes_label: ['LinkedIn Profile'], resposta: 'https://linkedin.example/ana', sensivel: false })];
  assert.deepEqual(respostasParaLlm(respostas).map(r => r.id), ['linkedin']);
  assert.doesNotMatch(JSON.stringify(respostasParaLlm(respostas)), /10\.000/);
  assert.equal(descreverParaLog(respostas[0]), 'pretensao-salarial (global) = [sensível]');
  assert.match(descreverParaLog(respostas[1]), /linkedin\.example/);
});

test('escrita idempotente: gravar o mesmo conteúdo não regrava o arquivo; conteúdo novo atualiza pelo id', async t => {
  const dataRoot = await tempDir(t);
  await gravarResposta(dataRoot, resposta());
  const antes = (await stat(arquivoRespostas(dataRoot))).mtimeMs;
  const segunda = await gravarResposta(dataRoot, resposta({ proveniencia: { origem: 'usuario', registrado_em: '2026-10-18T00:00:00.000Z' } }));
  assert.equal(segunda.gravada, false);
  assert.equal((await stat(arquivoRespostas(dataRoot))).mtimeMs, antes);
  await gravarResposta(dataRoot, resposta({ resposta: 'R$ 11.000 (CLT)' }));
  const lidas = await lerRespostas(dataRoot);
  assert.equal(lidas.length, 1);
  assert.equal(lidas[0].resposta, 'R$ 11.000 (CLT)');
  assert.match(await readFile(arquivoRespostas(dataRoot), 'utf8'), /"versao": 1/);
});

test('rótulo normalizado: acento, caixa, asterisco e pontuação não importam', () => {
  assert.equal(normalizarRotulo('  Pretensão  Salarial? * '), 'pretensao salarial');
  assert.ok(buscarResposta([resposta()], { label: 'PRETENSAO SALARIAL *', hoje: HOJE }));
});
