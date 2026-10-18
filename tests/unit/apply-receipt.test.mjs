import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { run } from '../helpers/cli.mjs';
import { contexto, cv, TS, H, bytes } from '../helpers/apply-contexto.mjs';
import { lerManifesto } from '../../core/cv/artifacts.mjs';
import { iniciarCandidatura, encerrarCandidatura } from '../../core/apply/session.mjs';
import { registrarComprovante, SCRIPT_COMPROVANTE } from '../../core/apply/receipt.mjs';
import { decidirNavegador } from '../../core/apply/hook.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { pagina, semNavegador } from '../helpers/navegador.mjs';
import { lerSessao } from '../../core/apply/sessao.mjs';

const hash = createHash('sha256').update(bytes).digest('hex');

test('desfecho com aba de outra tentativa recusa antes de congelar PDF, gravar evento ou remover proteção', async t => {
  const { dataRoot, vaga } = await contexto(t, true);
  const outra = { ...vaga, id: 'vaga-outra', requisicao_id: 'REQ-outra', url: 'https://portal.test/outra' };
  await cv(dataRoot, vaga);
  const tentativa = await iniciarCandidatura(dataRoot, { vaga, tabId: 7 });
  await iniciarCandidatura(dataRoot, { vaga: outra, tabId: 8 });
  const antes = await readEvents(dataRoot), sessao = await lerSessao(dataRoot);
  for (const estado of ['cancelada', 'enviada']) {
    await assert.rejects(encerrarCandidatura(dataRoot, { tentativa, vaga, tabId: 8, estado, bruto: { texto: 'Candidatura enviada' } }), /aba|vínculo/i);
    const r = run(['apply', 'desfecho', '--vaga', vaga.id, '--aba', '8', '--estado', estado, '--json'], { dataRoot });
    assert.notEqual(r.status, 0);
  }
  await assert.rejects(encerrarCandidatura(dataRoot, { tentativa: { ...tentativa, tentativa_id: 'antiga' }, vaga, tabId: 7, estado: 'enviada' }), /aba|vínculo|tentativa/i);
  assert.deepEqual(await readEvents(dataRoot), antes);
  assert.deepEqual(await lerSessao(dataRoot), sessao);
  assert.equal((await lerManifesto(dataRoot, vaga.id)).enviado, null);
});

test('extrator de comprovante devolve só confirmação, nunca contexto de identidade nem pathname privado', () => {
  const bruto = vm.runInNewContext(SCRIPT_COMPROVANTE, { document: { body: { innerText: 'Ana Exemplo ana@exemplo.test Candidatura enviada CPF 000.000.000-00' } }, location: { origin: 'https://portal.test', pathname: '/ana@exemplo.test/token-secreto' } });
  assert.equal(bruto.texto, 'Candidatura enviada');
  assert.equal(bruto.url, 'https://portal.test');
});

test('hook permite somente o script exato do comprovante sem consumir aprovação', () => {
  const ctx = { agora: TS, sessao: { abas: [{ tab_id: '7', vaga_id: 'vaga-01', expira_em: '2026-10-17T15:00:00Z' }], scripts: [] }, aprovacoes: { aprovacoes: [] } };
  const decidir = text => decidirNavegador({ tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: 7, text } }, ctx);
  assert.equal(decidir(SCRIPT_COMPROVANTE), null);
  assert.equal(decidir(`${SCRIPT_COMPROVANTE};document.forms[0].submit()`).decisao, 'negar');
});

for (const ativo of [false, true]) test(`comprovante congela versão escolhida, com hash e sem identidade (ativo=${ativo})`, async t => {
  const { dataRoot, vaga } = await contexto(t, ativo);
  await cv(dataRoot, vaga);
  await iniciarCandidatura(dataRoot, { vaga, tabId: 7, ts: TS });
  await cv(dataRoot, vaga, 'b'.repeat(64), '2026-10-17T12:01:00.000Z');
  const r = await registrarComprovante(dataRoot, { vaga, bruto: { texto: 'Ana Exemplo Candidatura enviada ana@exemplo.test', url: 'https://portal.test/ana@exemplo.test?token=abc' }, ts: TS });
  assert.equal(r.estado, 'enviada');
  assert.equal(r.comprovante.texto, 'Candidatura enviada');
  assert.equal(r.comprovante.url, 'https://portal.test');
  assert.equal(r.comprovante.cv_hash, H);
  assert.equal(r.comprovante.pdf_sha256, hash);
  assert.equal((await lerManifesto(dataRoot, vaga.id)).enviado.hash, H);
  await assert.rejects(cv(dataRoot, vaga), /imutável/);
  const marcada = projectEvents((await readEvents(dataRoot)).eventos).vagas[0].candidatura_usuario?.aplicada;
  assert.equal(Boolean(marcada), ativo);
  if (!ativo) assert.equal(run(['verify', '--json'], { dataRoot }).status, 0);
});

test('sem confirmação fica enviada_sem_comprovante e congela PDF escolhido', async t => {
  const { dataRoot, vaga } = await contexto(t);
  await cv(dataRoot, vaga);
  await iniciarCandidatura(dataRoot, { vaga, tabId: 7, ts: TS });
  const r = await registrarComprovante(dataRoot, { vaga, bruto: { texto: 'Erro no formulário' }, ts: TS });
  assert.equal(r.estado, 'enviada_sem_comprovante');
  assert.equal(r.comprovante.texto, null);
  assert.equal(r.comprovante.pdf_sha256, hash);
  assert.equal((await lerManifesto(dataRoot, vaga.id)).enviado.hash, H);
});

for (const erro of ['ausente', 'alterado', 'freeze']) test(`erro ${erro} não vira sucesso nem libera nova tentativa`, async t => {
  const { dataRoot, vaga } = await contexto(t);
  await cv(dataRoot, vaga);
  await iniciarCandidatura(dataRoot, { vaga, tabId: 7, ts: TS });
  const pasta = path.join(dataRoot, 'artifacts/cv', vaga.id, H);
  if (erro === 'alterado') await writeFile(path.join(pasta, 'cv-ats.pdf'), 'PDF alterado');
  else await rm(path.join(pasta, erro === 'ausente' ? 'cv-ats.pdf' : 'cv-visual.pdf'));
  await assert.rejects(registrarComprovante(dataRoot, { vaga, bruto: { texto: 'Candidatura enviada' }, ts: TS }));
  await assert.rejects(iniciarCandidatura(dataRoot, { vaga, tabId: 8, ts: TS }));
});

test('CLI/CDP captura confirmação, grava desfecho e libera a aba só após persistir', { skip: semNavegador }, async t => {
  const { dataRoot, vaga } = await contexto(t);
  await cv(dataRoot, vaga);
  const inicio = run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '7', '--json'], { dataRoot });
  assert.equal(inicio.status, 0, inicio.stdout);
  const p = await pagina(t, 'data:text/html,<h1>Application submitted</h1><p>ana@exemplo.test</p>');
  const script = run(['apply', 'comprovante', '--json'], { dataRoot });
  assert.equal(script.status, 0, script.stdout);
  const arquivo = path.join(dataRoot, 'comprovante.json');
  await writeFile(arquivo, JSON.stringify(await p.avaliar(script.json.script)));
  const desfecho = run(['apply', 'desfecho', '--vaga', vaga.id, '--aba', '7', '--estado', 'enviada', '--comprovante', arquivo, '--json'], { dataRoot });
  assert.equal(desfecho.status, 0, desfecho.stdout);
  assert.equal(desfecho.json.estado, 'enviada');
  assert.equal(desfecho.json.comprovante.pdf_sha256, hash);
  assert.doesNotMatch(JSON.stringify(desfecho.json), /ana@/);
  assert.deepEqual((await lerSessao(dataRoot)).abas, []);
  assert.notEqual(run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '8', '--json'], { dataRoot }).status, 0);
});

test('falha ao persistir marcação ativa é explícita e conserva reserva e proteção da aba', async t => {
  const { dataRoot, vaga } = await contexto(t, true);
  await cv(dataRoot, vaga);
  await iniciarCandidatura(dataRoot, { vaga, tabId: 7, ts: TS });
  const projecao = path.join(dataRoot, 'projections/pipeline-vagas.json');
  await rm(projecao);
  await mkdir(projecao);
  await assert.rejects(registrarComprovante(dataRoot, { vaga, bruto: { texto: 'Candidatura enviada' }, ts: TS }));
  assert.equal((await lerSessao(dataRoot)).abas[0].vaga_id, vaga.id);
  await assert.rejects(iniciarCandidatura(dataRoot, { vaga, tabId: 8, ts: TS }), /andamento/);
});
