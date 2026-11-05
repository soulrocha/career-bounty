import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { startPanel } from '../../panel/server.mjs';

async function ambiente(t, { modo = 'ativo', gerarCv, navegadorDisponivel = () => true } = {}) {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const pipeline = makeLegado({ vagas: 2 });
  const arquivo = path.join(origem, 'pipeline-vagas.json');
  await writeFile(arquivo, JSON.stringify(pipeline));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  const estado = path.join(dataRoot, 'state/migration.json');
  await writeFile(estado, JSON.stringify({ ...JSON.parse(await readFile(estado, 'utf8')), mode: modo }));
  const panel = await startPanel({ dataRoot, port: 0, now: () => new Date().toISOString(), hostId: 'pc-a', gerarCv, navegadorDisponivel });
  t.after(panel.close);
  const api = JSON.parse((await (await fetch(panel.url)).text()).match(/window\.PAINEL_API=(\{[^;]+\});/)[1]);
  const token = api.token;
  const post = (corpo, headers = {}) => fetch(`${panel.url}/api/cv/gerar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: panel.url, 'X-Painel-Token': token, ...headers }, body: JSON.stringify(corpo) });
  return { pipeline, post, api };
}

test('Gerar PDF sem navegador no painel: 501 e gerarCv não é chamado', async t => {
  const pedidos = [];
  const a = await ambiente(t, { gerarCv: async ({ vagaId }) => { pedidos.push(vagaId); return { gerado: true, tipo: 'base', gate: { status: 'ok' } }; }, navegadorDisponivel: () => false });
  const resposta = await a.post({ id: a.pipeline.vagas[0].id });
  assert.equal(resposta.status, 501);
  assert.match((await resposta.json()).erro, /navegador/);
  assert.deepEqual(pedidos, []);
});

test('Gerar PDF em modo sombra: 409 e gerarCv não é chamado', async t => {
  const pedidos = [];
  const a = await ambiente(t, { modo: 'shadow', gerarCv: async ({ vagaId }) => { pedidos.push(vagaId); return { gerado: true, tipo: 'base', gate: { status: 'ok' } }; } });
  assert.equal((await a.post({ id: a.pipeline.vagas[0].id })).status, 409);
  assert.deepEqual(pedidos, []);
});

test('Gerar PDF com outro em andamento: 409 e só uma geração', async t => {
  const pedidos = [];
  let liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const a = await ambiente(t, { gerarCv: async ({ vagaId }) => { pedidos.push(vagaId); await espera; return { gerado: true, tipo: 'base', gate: { status: 'ok' } }; } });
  const id = a.pipeline.vagas[0].id;
  const primeiro = a.post({ id });
  while (!pedidos.length) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await a.post({ id })).status, 409);
  liberar();
  assert.equal((await primeiro).status, 200);
  assert.deepEqual(pedidos, [id]);
  assert.equal((await a.post({ id })).status, 200);
});

test('Gerar PDF com falha: 500 sem o detalhe do erro, e a trava é solta', async t => {
  let falhar = true;
  const a = await ambiente(t, { gerarCv: async () => { if (falhar) throw new Error('Perfil de CV ausente: crie pasta-privada/cv/perfil.json'); return { gerado: true, tipo: 'base', gate: { status: 'ok' } }; } });
  const id = a.pipeline.vagas[0].id;
  const resposta = await a.post({ id });
  assert.equal(resposta.status, 500);
  assert.doesNotMatch(await resposta.text(), /pasta-privada|perfil\.json/);
  falhar = false;
  assert.equal((await a.post({ id })).status, 200);
});

test('página anuncia cvGerar conforme o navegador', async t => {
  assert.equal((await ambiente(t, { navegadorDisponivel: () => true })).api.cvGerar, true);
  assert.equal((await ambiente(t, { navegadorDisponivel: () => false })).api.cvGerar, false);
});

test('Gerar PDF sob demanda: gera o CV da vaga pedida e devolve o gate', async t => {
  const pedidos = [];
  const a = await ambiente(t, { gerarCv: async ({ vagaId }) => { pedidos.push(vagaId); return { gerado: true, tipo: 'base', gate: { status: 'ok', motivos: [] } }; } });
  const id = a.pipeline.vagas[0].id;
  const resposta = await a.post({ id });
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { gerado: true, tipo: 'base', gate: 'ok' });
  assert.deepEqual(pedidos, [id]);
});

test('Gerar PDF: vaga inexistente 404, campo extra 400, sem token 403, portal sem CV explica', async t => {
  const a = await ambiente(t, { gerarCv: async () => ({ gerado: false, motivo: 'portal_sem_cv' }) });
  assert.equal((await a.post({ id: 'nao-existe' })).status, 404);
  assert.equal((await a.post({ id: a.pipeline.vagas[0].id, x: 1 })).status, 400);
  assert.equal((await a.post({ id: a.pipeline.vagas[0].id }, { 'X-Painel-Token': 'errado' })).status, 403);
  const r = await a.post({ id: a.pipeline.vagas[0].id });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { gerado: false, motivo: 'portal_sem_cv' });
});
