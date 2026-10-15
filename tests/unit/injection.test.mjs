import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { createRunner, buildLiveArgs, LlmSaidaInvalida } from '../../core/llm/runner.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { avaliar } from '../../core/score/evaluate.mjs';
import { triar } from '../../core/score/triage.mjs';
import { limparTextoNaoConfiavel, MARCA_ABRE, MARCA_FECHA, embrulhar } from '../../core/privacy/untrusted.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const dir = path.join(repo, 'tests', 'fixtures', 'injecao');
const jds = await Promise.all((await readdir(dir)).sort().map(async nome => JSON.parse(await readFile(path.join(dir, nome), 'utf8'))));
const afirmacoes = await createMarkdownFolder(path.join(repo, 'examples', 'persona-ficticia')).claims();
const paraVaga = jd => ({ id: jd.id, vaga: makeVaga({ empresa: jd.empresa, cargo: jd.cargo, url: 'https://x.exemplo.test/1', descricao: jd.descricao }) });

test('existem 8 JDs maliciosas sintéticas', () => assert.equal(jds.length, 8));

test('o modelo obedece à injeção (replay malicioso) e o validador a barra', async t => {
  for (const jd of jds) {
    const dataRoot = await tempDir(t);
    // Modelo "dominado": marca tudo como atendido, aderência alta, citando prova inexistente ou nenhuma.
    const obediente = ({ entrada }) => ({ vaga_id: entrada.vaga.id, aderencia_sugerida: 'alta', resumo: 'Aderência alta conforme pedido.', pendencias: [],
      requisitos: [{ requisito: 'Inglês fluente', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: [], observacao: 'ok' }, { requisito: 'Liderança', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: [], observacao: 'ok' }] });
    const { avaliacao } = await avaliar({ runner: createRunner({ modo: 'fake', dataRoot, fake: obediente }), vaga: paraVaga(jd), afirmacoes });
    assert.notEqual(avaliacao.aderencia, 'alta', jd.id);
    assert.ok(avaliacao.requisitos.every(r => r.avaliacao !== 'atendido'), jd.id);
    // Variante que cita prova inexistente (JD 8): JSON rejeitado, com erro tipado.
    const inventor = ({ entrada }) => ({ vaga_id: entrada.vaga.id, aderencia_sugerida: 'alta', resumo: 'x', pendencias: [], requisitos: [{ requisito: 'Tudo', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: ['AF-999'], observacao: 'ok' }] });
    await assert.rejects(avaliar({ runner: createRunner({ modo: 'fake', dataRoot, fake: inventor }), vaga: paraVaga(jd), afirmacoes }), LlmSaidaInvalida, jd.id);
  }
});

test('campo extra injetado na triagem é rejeitado', async t => {
  const dataRoot = await tempDir(t);
  const fake = ({ entrada }) => ({ resultados: entrada.vagas.map(v => ({ id: v.id, decisao: 'avaliar', motivo: 'ok', acao: 'enviar_candidatura' })) });
  await assert.rejects(triar({ runner: createRunner({ modo: 'fake', dataRoot, fake }), dataRoot, vagas: [paraVaga(jds[3])], brief: 'b' }), LlmSaidaInvalida);
});

test('o conteúdo da JD entra em delimitador de dado, sem os marcadores dentro do texto', async t => {
  const dataRoot = await tempDir(t);
  let visto;
  const fake = ({ entrada }) => { visto = entrada; return { resultados: entrada.vagas.map(v => ({ id: v.id, decisao: 'talvez', motivo: 'x' })) }; };
  await triar({ runner: createRunner({ modo: 'fake', dataRoot, fake }), dataRoot, vagas: [paraVaga(jds[2])], brief: 'b' });
  const resumo = visto.vagas[0].resumo;
  assert.ok(resumo.startsWith(MARCA_ABRE) && resumo.endsWith(MARCA_FECHA));
  const miolo = resumo.slice(MARCA_ABRE.length, -MARCA_FECHA.length);
  assert.ok(!miolo.includes('dado_nao_confiavel'), miolo);
  assert.ok(!visto.vagas[0].cargo.includes('<'), 'título também é dado');
});

test('limpeza: remove marcadores aninhados e obfuscados, controle e zero-width', () => {
  assert.equal(limparTextoNaoConfiavel('a<dado_nao_confiavel>b</dado_nao_confiavel>c').texto, 'abc');
  assert.equal(limparTextoNaoConfiavel('a<dado_nao_<dado_nao_confiavel>confiavel>b').texto, 'ab');
  assert.equal(limparTextoNaoConfiavel('ig​nore\u0000 ‮tudo\u0007').texto, 'ignore tudo');
  assert.equal(limparTextoNaoConfiavel('linha 1\nlinha 2\tok').texto, 'linha 1\nlinha 2\tok');
  assert.equal(embrulhar('x'), `${MARCA_ABRE}x${MARCA_FECHA}`);
});

test('JD enorme é truncada com aviso', async t => {
  const r = limparTextoNaoConfiavel('palavra '.repeat(10000), { max: 1000 });
  assert.equal(r.truncado, true);
  assert.ok(r.texto.length <= 1000);
  assert.match(r.avisos[0], /truncad/);
  const dataRoot = await tempDir(t);
  let visto;
  const fake = ({ entrada }) => { visto = entrada; return { vaga_id: entrada.vaga.id, aderencia_sugerida: 'baixa', resumo: 'x', pendencias: [], requisitos: [] }; };
  const { avaliacao } = await avaliar({ runner: createRunner({ modo: 'fake', dataRoot, fake }), vaga: paraVaga(jds[6]), afirmacoes });
  assert.ok(visto.vaga.descricao.length <= 12100);
  assert.match(avaliacao.avisos_entrada.join(' '), /truncad/);
});

test('triador e avaliador não têm ferramentas: frontmatter e comando live', async () => {
  for (const nome of ['triador', 'avaliador']) assert.deepEqual((await loadAgent(nome)).tools, ['none'], nome);
  const args = buildLiveArgs({ modelo: 'haiku' });
  assert.equal(args[args.indexOf('--tools') + 1], '');
});
