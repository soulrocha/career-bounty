import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { repoRoot, run } from '../helpers/cli.mjs';
import { contexto, cv, TS, H } from '../helpers/apply-contexto.mjs';
import { bancoPersona } from '../helpers/apply.mjs';
import { pagina, portal, semNavegador } from '../helpers/navegador.mjs';
import { iniciarCandidatura, prepararPreenchimento, registrarPreparacao } from '../../core/apply/session.mjs';
import { lerSessao, marcarAba, desmarcarAba, scriptDeEnvio } from '../../core/apply/sessao.mjs';
import { lerAprovacoes } from '../../core/apply/approval.mjs';
import { lerRespostas } from '../../core/apply/answers.mjs';
import { idPergunta, responderPergunta } from '../../core/apply/perguntas.mjs';
import { decidirNavegador } from '../../core/apply/hook.mjs';
import { validarRascunhos } from '../../core/apply/rascunho.mjs';

const executar = (dataRoot, args) => {
  const r = run(['apply', ...args, '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.json;
};

test('skill exige leitura limitada, lote nominal e retomada na mesma aba', async () => {
  const skill = await readFile(path.join(repoRoot, 'skills/aplicar/SKILL.md'), 'utf8');
  for (const regra of [/tabs_context_mcp/, /aba nova/, /proibido.*captura de tela/, /read_page.*ref_id/, /filter: "interactive"/, /browser_batch/, /pessoa precisa digitar/, /retome `apply preparar` na mesma aba/, /Não rode `apply iniciar`/]) assert.match(skill, regra);
});

test('CLI/CDP preenche fixture sem enviar e não expõe valores sensíveis', { skip: semNavegador }, async t => {
  const { dataRoot, vaga } = await contexto(t);
  await cv(dataRoot, vaga);
  await mkdir(path.join(dataRoot, 'kb'), { recursive: true });
  await writeFile(path.join(dataRoot, 'kb/answers.yml'), JSON.stringify({ respostas: bancoPersona() }));
  const inicio = executar(dataRoot, ['iniciar', '--vaga', vaga.id, '--aba', '7']);
  const p = await pagina(t, portal('greenhouse'));
  await p.avaliar('window.envios=0;document.forms[0].addEventListener("submit",e=>{e.preventDefault();window.envios++})');
  const arquivo = path.join(dataRoot, 'extracao.json');
  await writeFile(arquivo, JSON.stringify(await p.avaliar(inicio.extrator)));
  const preparo = executar(dataRoot, ['preparar', '--vaga', vaga.id, '--extracao', arquivo]);
  assert.doesNotMatch(JSON.stringify(preparo), /10\.000|90000-0000|Decline to self-identify/);
  await p.avaliar(preparo.script);
  assert.equal(await p.avaliar('document.querySelector("#first_name").value'), 'Ana');
  assert.equal(await p.avaliar('document.querySelector("#salary").value'), '');
  assert.equal(await p.avaliar('window.envios'), 0);
  assert.equal(preparo.cv_ats, inicio.cv_ats);
});

for (const bloqueio of ['captcha', 'login', 'mfa']) test(`CLI ${bloqueio} preserva aba protegida ao registrar desfecho`, async t => {
  const { dataRoot, vaga } = await contexto(t);
  executar(dataRoot, ['iniciar', '--vaga', vaga.id, '--aba', '7']);
  const arquivo = path.join(dataRoot, 'extracao.json');
  await writeFile(arquivo, JSON.stringify({ campos: [], bloqueios: { [bloqueio]: true } }));
  assert.equal(executar(dataRoot, ['preparar', '--vaga', vaga.id, '--extracao', arquivo]).bloqueada, true);
  executar(dataRoot, ['desfecho', '--vaga', vaga.id, '--aba', '7', '--estado', 'bloqueada:humano', '--motivo', bloqueio]);
  assert.equal((await lerSessao(dataRoot)).abas[0].vaga_id, vaga.id);
});

test('rascunho só preenche após salvar resposta e retomada mantém PDF reservado', async t => {
  const { dataRoot, vaga } = await contexto(t);
  await cv(dataRoot, vaga);
  executar(dataRoot, ['iniciar', '--vaga', vaga.id, '--aba', '7']);
  const extracao = { campos: [{ ref: 'c1', tipo: 'textarea', label: 'Conte sua experiência', obrigatorio: true }] };
  const preparo = await prepararPreenchimento({ extracao, respostas: [], vaga, hoje: '2026-10-17' });
  await registrarPreparacao(dataRoot, { vaga, preparo, rascunhosSugeridos: { c1: 'Organizo entregas com o time.' } });
  assert.doesNotMatch(preparo.script, /Organizo/);
  assert.deepEqual(await lerRespostas(dataRoot), []);
  await responderPergunta({ dataRoot, perguntaId: idPergunta('Conte sua experiência'), resposta: 'Organizo entregas com o time.', escopo: { tipo: 'global' } });
  await cv(dataRoot, vaga, 'b'.repeat(64), '2026-10-18T12:00:00.000Z');
  const arquivo = path.join(dataRoot, 'extracao.json');
  extracao.campos.push({ ref: 'c2', tipo: 'file', label: 'Resume/CV', obrigatorio: true });
  await writeFile(arquivo, JSON.stringify(extracao));
  const retomada = executar(dataRoot, ['preparar', '--vaga', vaga.id, '--extracao', arquivo]);
  assert.match(retomada.script, /Organizo entregas/);
  assert.ok(retomada.cv_ats.includes(H));
  assert.notEqual(run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '8', '--json'], { dataRoot }).status, 0);
});

test('aba reservada aceita apenas upload do CV escolhido, não outra versão da vaga', async t => {
  const { dataRoot, vaga } = await contexto(t);
  await cv(dataRoot, vaga);
  const tentativa = await iniciarCandidatura(dataRoot, { vaga, tabId: 7, ts: TS });
  const ctx = { sessao: await lerSessao(dataRoot), aprovacoes: { aprovacoes: [] }, agora: TS };
  const decidir = arquivo => decidirNavegador({ tool_name: 'mcp__claude-in-chrome__file_upload', tool_input: { tabId: 7, paths: [arquivo] } }, ctx);
  const arquivo = path.join(dataRoot, tentativa.cv.ats);
  assert.equal(decidir(arquivo), null);
  assert.equal(decidir(arquivo.replace(H, 'b'.repeat(64)))?.decisao, 'negar');
});

test('validador de rascunho rejeita campos, afirmações e quantidades sem suporte', () => {
  const af = { id: 'AF-001', texto: 'Organizo entregas com o time.', nivel_prova: 'verificado' };
  const ctx = { refs: new Set(['c1']), porId: new Map([[af.id, af]]), afirmacoes: [af] };
  const base = { ref: 'c1', texto: af.texto, afirmacoes: [af.id] };
  assert.doesNotThrow(() => validarRascunhos({ rascunhos: [base] }, ctx));
  for (const invalido of [{ ...base, extra: true }, { ...base, ref: 'c9' }, { ...base, afirmacoes: ['AF-999'] }, { ...base, texto: 'Gerenciei 999 pessoas.' }, { ...base, texto: 'Gerenciei noventa pessoas.' }]) assert.throws(() => validarRascunhos({ rascunhos: [invalido] }, ctx));
});

test('jornada plan, reserva, perguntas, retomada, lote e frase nominal libera somente o envio aprovado', async t => {
  const { dataRoot, vaga } = await contexto(t);
  await cv(dataRoot, vaga);
  assert.equal(executar(dataRoot, ['plan']).fila.length, 1);
  executar(dataRoot, ['iniciar', '--vaga', vaga.id, '--aba', '7']);
  const arquivo = path.join(dataRoot, 'extracao.json');
  await writeFile(arquivo, JSON.stringify({ campos: [{ ref: 'c1', tipo: 'textarea', label: 'Conte sua experiência', obrigatorio: true }] }));
  executar(dataRoot, ['preparar', '--vaga', vaga.id, '--extracao', arquivo]);
  assert.notEqual(run(['apply', 'lote', '--vagas', vaga.id, '--json'], { dataRoot }).status, 0, 'pergunta pendente impede lote');
  await responderPergunta({ dataRoot, perguntaId: idPergunta('Conte sua experiência'), resposta: 'Organizo entregas com o time.', escopo: { tipo: 'global' } });
  executar(dataRoot, ['preparar', '--vaga', vaga.id, '--extracao', arquivo]);
  await desmarcarAba(dataRoot, { tabId: 7 });
  assert.notEqual(run(['apply', 'lote', '--vagas', vaga.id, '--json'], { dataRoot }).status, 0, 'reserva sem aba protegida não entra');
  await marcarAba(dataRoot, { tabId: 7, vagaId: vaga.id, ts: '2020-01-01T00:00:00.000Z' });
  assert.notEqual(run(['apply', 'lote', '--vagas', vaga.id, '--json'], { dataRoot }).status, 0, 'aba expirada não entra');
  await marcarAba(dataRoot, { tabId: 7, vagaId: vaga.id });
  assert.notEqual(run(['apply', 'lote', '--vagas', `${vaga.id},${vaga.id}`, '--json'], { dataRoot }).status, 0, 'vaga duplicada no lote é recusada');
  const lote = executar(dataRoot, ['lote', '--vagas', vaga.id]);
  const entrada = { tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: 7, text: scriptDeEnvio(vaga.id) } };
  const ctx = { sessao: await lerSessao(dataRoot), aprovacoes: await lerAprovacoes(dataRoot), agora: new Date().toISOString() };
  assert.equal(decidirNavegador(entrada, ctx).decisao, 'negar');
  const hook = spawnSync(process.execPath, [path.join(repoRoot, 'hooks/user-prompt-submit.mjs')], { input: JSON.stringify({ prompt: lote.frase }), encoding: 'utf8', env: { ...process.env, DATA_ROOT: dataRoot } });
  assert.equal(hook.status, 0, hook.stderr);
  ctx.aprovacoes = await lerAprovacoes(dataRoot);
  assert.equal(decidirNavegador(entrada, ctx).consumir, vaga.id);
  assert.equal(executar(dataRoot, ['plan']).fila.length, 0, 'reserva continua fora da fila de novas tentativas');
  assert.notEqual(run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '8', '--json'], { dataRoot }).status, 0);
});
