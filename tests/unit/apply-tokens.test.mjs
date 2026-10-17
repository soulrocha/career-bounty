import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run } from '../helpers/cli.mjs';
import { contexto } from '../helpers/apply-contexto.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { resumirCandidaturas } from '../../core/apply/tokens.mjs';
import { prepararPreenchimento, registrarPreparacao, registrarResumoPreparacao } from '../../core/apply/session.mjs';
import { createRunner } from '../../core/llm/runner.mjs';
import { rascunharRespostas } from '../../core/apply/rascunho.mjs';

test('relatório por candidatura soma runner e navegador com cache e distingue o limite de 15000', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot });
  assert.equal(inicio.status, 0, inicio.stdout);
  const tentativa = inicio.json.tentativa_id;
  const extracao = path.join(dataRoot, 'extracao.json');
  await writeFile(extracao, JSON.stringify({ campos: [{ ref: 'c1', tipo: 'file', label: 'Resume', obrigatorio: true }] }));
  assert.equal(run(['apply', 'preparar', '--vaga', vaga.id, '--extracao', extracao, '--json'], { dataRoot }).status, 0);
  await appendEvents(dataRoot, [{ id: 'uso-runner', ts: '2026-10-17T14:00:00Z', ator: 'llm', tipo: 'llm.uso', entidade: 'llm', entidade_id: 'classificador-campos',
    dados: { vaga_id: vaga.id, tentativa_id: tentativa, origem: 'runner', modo: 'live', tokens_in: 50, tokens_out: 50, tokens_cache_leitura: 100, tokens_cache_criacao: 100 } }]);
  const uso = path.join(dataRoot, 'uso.json');
  await writeFile(uso, JSON.stringify({ medicao_id: 'sessao-1', tokens_in: 14700, tokens_out: 0 }));
  const args = ['apply', 'tokens', '--vaga', vaga.id, '--tentativa', tentativa, '--uso', uso, '--json'];
  assert.equal(run(args, { dataRoot }).status, 0);
  assert.equal(run(args, { dataRoot }).status, 0, 'mesma medição é idempotente');
  const relatorio = run(['report', 'tokens', '--by', 'application', '--json'], { dataRoot });
  assert.equal(relatorio.status, 0, relatorio.stdout);
  const [item] = relatorio.json.candidaturas;
  assert.equal(item.total_tokens, 15000);
  assert.equal(item.runner.total_tokens, 300);
  assert.equal(item.navegador.total_tokens, 14700);
  assert.equal(item.medicao, 'completa');
  assert.equal(item.resultado, 'aprovada');
  await writeFile(uso, JSON.stringify({ medicao_id: 'sessao-2', tokens_in: 1, tokens_out: 0 }));
  assert.equal(run(args, { dataRoot }).status, 0);
  assert.equal(run(['report', 'tokens', '--by', 'application', '--json'], { dataRoot }).status, 1);
});

const reserva = (id = 't1', vaga = 'v1') => ({ tipo: 'candidatura.tentativa', id, entidade_id: vaga });
const preparo = (conhecidos = true, tentativa = 't1') => ({ tipo: 'candidatura.preparada', dados: { tentativa_id: tentativa, vaga_id: 'v1', todos_conhecidos: conhecidos } });
const usoEvento = (extra = {}) => ({ tipo: 'llm.uso', dados: { tentativa_id: 't1', vaga_id: 'v1', origem: 'navegador', modo: 'live', tokens_in: 100, tokens_out: 0, ...extra } });

test('ausência de prova, etapa desconhecida, fake/replay e uso órfão nunca certificam a meta', () => {
  for (const eventos of [[reserva()], [reserva(), preparo()], [reserva(), usoEvento()],
    [reserva(), preparo(), usoEvento({ modo: 'replay' })], [reserva(), preparo(), usoEvento(), usoEvento({ origem: 'runner', modo: 'fake' })]]) {
    const [c] = resumirCandidaturas(eventos).candidaturas;
    assert.equal(c.resultado, 'nao_verificada');
    assert.equal(c.medicao, 'incompleta');
  }
  const desconhecida = resumirCandidaturas([reserva(), preparo(false), preparo(true), usoEvento({ tokens_in: 20000 })]);
  assert.equal(desconhecida.candidaturas[0].todos_conhecidos, false);
  assert.equal(desconhecida.candidaturas[0].acima_limite, false);
  assert.equal(desconhecida.candidaturas[0].resultado, 'nao_verificada');
  const r = resumirCandidaturas([reserva(), reserva('t2'), preparo(), usoEvento(), usoEvento({ tentativa_id: 't2', tokens_in: 20 }), usoEvento({ vaga_id: 'outra' }), usoEvento({ tentativa_id: 'orfao' }), { tipo: 'llm.uso', dados: { rodada: 'mail', tokens_in: 999999 } }]);
  assert.deepEqual(r.candidaturas.map(c => c.total_tokens), [100, 20]);
  assert.equal(r.eventos_sem_vinculo, 2);
  assert.equal(resumirCandidaturas([]).resumo.candidaturas, 0);
  assert.throws(() => resumirCandidaturas([reserva(), usoEvento({ tokens_in: Number.MAX_SAFE_INTEGER }), usoEvento()]), /inteiro seguro/);
  for (const invalido of [{ tokens_in: undefined }, { tokens_out: undefined }, { modo: { email: 'segredo@invalid.test' } }, { modo: 'desconhecido' }, { origem: 'outra' }]) {
    assert.throws(() => resumirCandidaturas([reserva(), preparo(), usoEvento(invalido)]), /inválid/);
  }
  assert.equal(resumirCandidaturas([reserva(), preparo(), usoEvento(), usoEvento({ tentativa_id: null, origem: 'runner' })]).candidaturas[0].resultado, 'nao_verificada');
  assert.deepEqual(resumirCandidaturas([reserva(), usoEvento({ modo: 'fake', origem: 'runner' })]).candidaturas[0].runner.modos, ['fake']);
});

test('captura aceita pós-desfecho, recusa dados extras, conflito, número inválido e tentativa de outra vaga sem alterar sombra', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const antes = await readFile(path.join(dataRoot, 'state/migration.json'), 'utf8');
  const projecao = await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8');
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  assert.equal(run(['apply', 'desfecho', '--vaga', vaga.id, '--aba', '7', '--estado', 'bloqueada:humano', '--json'], { dataRoot }).status, 0);
  const arquivo = path.join(dataRoot, 'uso.json');
  const args = ['apply', 'tokens', '--vaga', vaga.id, '--tentativa', inicio.tentativa_id, '--uso', arquivo, '--json'];
  const base = { medicao_id: 's1', tokens_in: 10, tokens_out: 5 };
  await writeFile(arquivo, JSON.stringify(base));
  assert.equal(run(args, { dataRoot }).status, 0);
  for (const invalido of [{ ...base, tokens_in: 11 }, { ...base, assunto: 'segredo' }, { ...base, tokens_in: -1 }, { ...base, tokens_in: 0.5 }, { ...base, tokens_out: '5' }, { ...base, tokens_in: null }, { ...base, tokens_in: Number.MAX_SAFE_INTEGER }, { ...base, medicao_id: 'email@exemplo.test' }]) {
    await writeFile(arquivo, JSON.stringify(invalido));
    assert.equal(run(args, { dataRoot }).status, 2, JSON.stringify(invalido));
  }
  await writeFile(arquivo, JSON.stringify(base));
  assert.equal(run(args.map(a => a === vaga.id ? 'outra' : a), { dataRoot }).status, 2);
  assert.equal((await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'llm.uso').length, 1);
  assert.equal(await readFile(path.join(dataRoot, 'state/migration.json'), 'utf8'), antes);
  assert.equal(await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8'), projecao);
});

test('preparo conhecido não chama runner e resumo desconhecido/ignorado não vira conhecido depois', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  const runner = { run() { assert.fail('matcher conhecido chamou LLM'); } };
  const conhecido = await prepararPreenchimento({ extracao: { campos: [{ ref: 'c1', tipo: 'file', label: 'Resume', obrigatorio: true }] }, respostas: [], vaga, runner });
  assert.equal(conhecido.chamadas_llm, 0);
  assert.equal(conhecido.resumo.todos_conhecidos, true);
  const vazio = await prepararPreenchimento({ extracao: { campos: [] }, respostas: [], vaga, runner });
  assert.equal(vazio.resumo.todos_conhecidos, false);
  const desconhecido = await prepararPreenchimento({ extracao: { campos: [{ ref: 'c2', tipo: 'text', label: 'Outra', obrigatorio: false }] }, respostas: [], vaga, runner });
  assert.equal(desconhecido.resumo.ignorados, 1);
  await registrarPreparacao(dataRoot, { vaga, preparo: desconhecido, tentativa_id: inicio.tentativa_id, ts: '2026-10-17T15:00:00Z' });
  await registrarPreparacao(dataRoot, { vaga, preparo: conhecido, tentativa_id: inicio.tentativa_id, ts: '2026-10-17T15:01:00Z' });
  const eventos = (await readEvents(dataRoot)).eventos;
  assert.equal(resumirCandidaturas(eventos).candidaturas[0].todos_conhecidos, false);
  assert.doesNotMatch(JSON.stringify(eventos.filter(e => e.tipo === 'candidatura.preparada')), /Outra|Resume/);
  const bloqueado = await prepararPreenchimento({ extracao: { campos: [], bloqueios: { captcha: true } }, respostas: [], vaga });
  await registrarPreparacao(dataRoot, { vaga, preparo: bloqueado, tentativa_id: inicio.tentativa_id });
  assert.equal((await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'candidatura.preparada').at(-1).dados.todos_conhecidos, false);
});

test('relatório recusa log corrompido e contagem inválida, enquanto falta de navegador não é aceite', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  const args = ['report', 'tokens', '--by', 'application', '--json'];
  const parcial = run(args, { dataRoot });
  assert.equal(parcial.status, 0);
  assert.equal(parcial.json.candidaturas[0].resultado, 'nao_verificada');
  await appendEvents(dataRoot, [{ id: 'malformado', ts: '2026-10-17T15:00:00Z', ator: 'llm', tipo: 'llm.uso', entidade: 'llm', entidade_id: 'runner', dados: { vaga_id: vaga.id, tentativa_id: inicio.tentativa_id, origem: 'runner', modo: 'live', tokens_in: -1 } }]);
  assert.equal(run(args, { dataRoot }).status, 2);
  await writeFile(path.join(dataRoot, 'events/corrompido.jsonl'), '{incompleto');
  assert.equal(run(args, { dataRoot }).status, 2);
});

test('classificador e redator propagam vínculo e retries reais do runner sem trocar ordinal tentativa', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  const meta = { vaga_id: vaga.id, tentativa_id: inicio.tentativa_id, origem: 'runner' };
  const runner = createRunner({ modo: 'fake', dataRoot, fake: ({ agente, tentativa }) => tentativa === 1 ? 'inválido' : agente === 'classificador-campos'
    ? { itens: [{ ref: 'c1', categoria: 'aberta' }], _uso: { tokens_in: 3, tokens_out: 2 } }
    : { rascunhos: [{ ref: 'c1', texto: 'Organizo entregas.', afirmacoes: ['AF-001'] }], _uso: { tokens_in: 5, tokens_out: 2 } } });
  await prepararPreenchimento({ extracao: { campos: [{ ref: 'c1', tipo: 'text', label: 'Potencial', obrigatorio: true }] }, respostas: [], vaga, runner, meta });
  await rascunharRespostas({ runner, campos: [{ ref: 'c1', label: 'Conte sua experiência' }], vaga, afirmacoes: [{ id: 'AF-001', texto: 'Organizo entregas.', nivel_prova: 'verificado', uso: ['CV'] }], meta });
  const usos = (await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'llm.uso');
  assert.equal(usos.length, 4);
  assert.deepEqual(usos.map(e => e.dados.tentativa), [1, 2, 1, 2]);
  for (const e of usos) for (const [k, v] of Object.entries(meta)) assert.equal(e.dados[k], v);
  assert.equal(resumirCandidaturas((await readEvents(dataRoot)).eventos).candidaturas[0].runner.total_tokens, 12);
});

test('falha de transporte antes do uso preserva desconhecidos mesmo após retomada conhecida', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  const aoPreparar = resumo => registrarResumoPreparacao(dataRoot, { vaga, tentativa_id: inicio.tentativa_id, resumo });
  await assert.rejects(prepararPreenchimento({ extracao: { campos: [{ ref: 'c1', tipo: 'text', label: 'Potencial', obrigatorio: true }] },
    respostas: [], vaga, aoPreparar, runner: { run() { throw new Error('TRANSPORTE'); } } }), /TRANSPORTE/);
  const eventos = (await readEvents(dataRoot)).eventos;
  assert.equal(eventos.filter(e => e.tipo === 'llm.uso').length, 0);
  assert.equal(eventos.find(e => e.tipo === 'candidatura.preparada').dados.desconhecidos, 1);
  await prepararPreenchimento({ extracao: { campos: [{ ref: 'c1', tipo: 'file', label: 'Resume', obrigatorio: true }] }, respostas: [], vaga, aoPreparar });
  await appendEvents(dataRoot, [{ ...usoEvento({ vaga_id: vaga.id, tentativa_id: inicio.tentativa_id }), id: 'navegador', ts: '2026-10-17T16:00:00Z', ator: 'operador', entidade: 'llm', entidade_id: 'navegador' }]);
  const [r] = resumirCandidaturas((await readEvents(dataRoot)).eventos).candidaturas;
  assert.equal(r.todos_conhecidos, false);
  assert.equal(r.resultado, 'nao_verificada');
});

test('persistência do resumo precede redator e falha de persistência impede classifier', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  const aoPreparar = resumo => registrarResumoPreparacao(dataRoot, { vaga, tentativa_id: inicio.tentativa_id, resumo });
  const preparacao = await prepararPreenchimento({ extracao: { campos: [{ ref: 'c1', tipo: 'textarea', label: 'Conte sua experiência', obrigatorio: true }] }, respostas: [], vaga, aoPreparar });
  await assert.rejects(rascunharRespostas({ runner: { run() { throw new Error('TRANSPORTE'); } }, campos: preparacao.rascunhos, vaga, afirmacoes: [] }), /TRANSPORTE/);
  assert.equal((await readEvents(dataRoot)).eventos.find(e => e.tipo === 'candidatura.preparada').dados.todos_conhecidos, false);
  await assert.rejects(prepararPreenchimento({ extracao: { campos: [{ ref: 'c1', tipo: 'text', label: 'Potencial', obrigatorio: true }] }, respostas: [], vaga,
    aoPreparar() { throw new Error('PERSISTENCIA'); }, runner: { run() { assert.fail('runner não deveria executar'); } } }), /PERSISTENCIA/);
  const legado = resumirCandidaturas([reserva(), preparo(), usoEvento({ origem: 'runner', agente: 'classificador-campos' }), usoEvento()]);
  assert.equal(legado.candidaturas[0].todos_conhecidos, false);
  assert.equal(legado.candidaturas[0].resultado, 'nao_verificada');
});

test('CLI preserva etapa desconhecida quando replay falha antes do uso e retoma a mesma tentativa', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  const arquivo = path.join(dataRoot, 'extracao.json');
  await writeFile(arquivo, JSON.stringify({ campos: [{ ref: 'c1', tipo: 'text', label: 'Potencial', obrigatorio: true }] }));
  const preparar = ['apply', 'preparar', '--vaga', vaga.id, '--extracao', arquivo, '--json'];
  assert.equal(run([...preparar, '--replay', path.join(dataRoot, 'replay-inexistente')], { dataRoot }).status, 2);
  const eventos = (await readEvents(dataRoot)).eventos;
  assert.equal(eventos.filter(e => e.tipo === 'llm.uso').length, 0);
  assert.equal(eventos.find(e => e.tipo === 'candidatura.preparada').dados.todos_conhecidos, false);
  await writeFile(arquivo, JSON.stringify({ campos: [{ ref: 'c1', tipo: 'file', label: 'Resume', obrigatorio: true }] }));
  assert.equal(run(preparar, { dataRoot }).status, 0);
  await writeFile(arquivo, JSON.stringify({ medicao_id: 'sessao-cli', tokens_in: 10, tokens_out: 5 }));
  assert.equal(run(['apply', 'tokens', '--vaga', vaga.id, '--tentativa', inicio.tentativa_id, '--uso', arquivo, '--json'], { dataRoot }).status, 0);
  const relatorio = run(['report', 'tokens', '--by', 'application', '--json'], { dataRoot });
  assert.equal(relatorio.status, 0);
  assert.equal(relatorio.json.candidaturas[0].todos_conhecidos, false);
  assert.equal(relatorio.json.candidaturas[0].resultado, 'nao_verificada');
});

test('duas etapas no mesmo instante preservam resumo desconhecido e repetição idêntica é idempotente', async t => {
  const { dataRoot, vaga } = await contexto(t);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot }).json;
  const comum = { vaga, tentativa_id: inicio.tentativa_id, ts: '2026-10-17T17:00:00Z' };
  const conhecido = { campos: 1, desconhecidos: 0, ignorados: 0, todos_conhecidos: true };
  const desconhecido = { campos: 1, desconhecidos: 1, ignorados: 0, todos_conhecidos: false };
  assert.equal((await registrarResumoPreparacao(dataRoot, { ...comum, resumo: conhecido })).appended, true);
  assert.equal((await registrarResumoPreparacao(dataRoot, { ...comum, resumo: desconhecido })).appended, true);
  assert.equal((await registrarResumoPreparacao(dataRoot, { ...comum, resumo: { ...conhecido } })).appended, false);
  const eventos = (await readEvents(dataRoot)).eventos;
  assert.equal(eventos.filter(e => e.tipo === 'candidatura.preparada').length, 2);
  assert.equal(resumirCandidaturas(eventos).candidaturas[0].todos_conhecidos, false);
});

