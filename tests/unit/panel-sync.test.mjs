import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { localDay } from '../../core/store/schema.mjs';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { startPanel } from '../../panel/server.mjs';

const esperar = ms => new Promise(done => setTimeout(done, ms));

async function dados(t) {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const pipeline = makeLegado({ vagas: 2 });
  for (const vaga of pipeline.vagas) { delete vaga.candidatura_usuario; delete vaga.historico_marcacoes; delete vaga.descarte_usuario; delete vaga.historico_descartes; delete vaga.candidatura_email; delete vaga.requisicao_id; delete vaga.id_requisicao; vaga.status = 'avaliada-sem-envio'; }
  const arquivo = path.join(origem, 'pipeline-vagas.json');
  await writeFile(arquivo, JSON.stringify(pipeline));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  const estado = path.join(dataRoot, 'state/migration.json');
  await writeFile(estado, JSON.stringify({ ...JSON.parse(await readFile(estado, 'utf8')), mode: 'ativo' }));
  return { dataRoot, pipeline };
}

function falso({ resultado = { ok: true, baixados: 0, apagados_local: 0, conflitos: [] }, antes } = {}) {
  const chamadas = [];
  return { chamadas, sincronizador: async () => { chamadas.push(Date.now()); await antes?.(); return resultado; } };
}

test('sem sincronização configurada o painel abre como antes e o status diz não configurado', async t => {
  const { dataRoot } = await dados(t);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const status = await (await fetch(`${panel.url}/api/status`)).json();
  assert.deepEqual(status.sync, { configurado: false });
});

test('PC novo sem projeção: o painel espera a primeira rodada antes de abrir', async t => {
  const { dataRoot } = await dados(t);
  const projecao = path.join(dataRoot, 'projections/pipeline-vagas.json');
  const guardada = await readFile(projecao);
  await rm(projecao);
  const sync = falso({ antes: () => writeFile(projecao, guardada) });
  const panel = await startPanel({ dataRoot, port: 0, sincronizador: sync.sincronizador, intervaloSyncMs: 60000 });
  t.after(panel.close);
  assert.equal(sync.chamadas.length, 1);
  assert.equal((await fetch(panel.url)).status, 200);
});

test('gravação no painel dispara uma rodada logo depois, e o status mostra dados novos do outro PC', async t => {
  const { dataRoot, pipeline } = await dados(t);
  const sync = falso({ resultado: { ok: true, ultima: '2026-10-30T22:00:00.000Z', baixados: 2, apagados_local: 0, conflitos: [] } });
  const panel = await startPanel({ dataRoot, port: 0, now: () => new Date().toISOString(), hostId: 'pc-a', sincronizador: sync.sincronizador, intervaloSyncMs: 60000, esperaSyncMs: 20 });
  t.after(panel.close);
  await esperar(50);
  const iniciais = sync.chamadas.length;
  assert.equal(iniciais, 1);
  const page = await (await fetch(panel.url)).text();
  const token = JSON.parse(page.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  const resposta = await fetch(`${panel.url}/api/candidaturas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: panel.url, 'X-Painel-Token': token },
    body: JSON.stringify({ id: pipeline.vagas[0].id, aplicada: true, data: localDay(Date.now()) }) });
  assert.equal(resposta.status, 200);
  await esperar(150);
  assert.equal(sync.chamadas.length, iniciais + 1);
  const status = (await (await fetch(`${panel.url}/api/status`)).json()).sync;
  assert.equal(status.configurado, true);
  assert.equal(status.ok, true);
  assert.equal(status.dados_novos, 4);
});

test('falha da sincronização não derruba o painel e aparece no status', async t => {
  const { dataRoot } = await dados(t);
  const panel = await startPanel({ dataRoot, port: 0, sincronizador: async () => { throw new Error('ssh: sem rota'); }, intervaloSyncMs: 60000 });
  t.after(panel.close);
  await esperar(30);
  assert.equal((await fetch(panel.url)).status, 200);
  const status = (await (await fetch(`${panel.url}/api/status`)).json()).sync;
  assert.equal(status.ok, false);
  assert.match(status.erro, /sem rota/);
});
