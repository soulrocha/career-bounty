import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { localDay } from '../../core/store/schema.mjs';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { startPanel } from '../../panel/server.mjs';
import { readEvents } from '../../core/store/events.mjs';

async function ambiente(t, { modo = 'ativo' } = {}) {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const pipeline = makeLegado({ vagas: 3 });
  for (const vaga of pipeline.vagas) { delete vaga.candidatura_usuario; delete vaga.historico_marcacoes; delete vaga.descarte_usuario; delete vaga.historico_descartes; delete vaga.candidatura_email; delete vaga.requisicao_id; delete vaga.id_requisicao; vaga.status = 'avaliada-sem-envio'; }
  const arquivo = path.join(origem, 'pipeline-vagas.json');
  await writeFile(arquivo, JSON.stringify(pipeline));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  const estado = path.join(dataRoot, 'state/migration.json');
  await writeFile(estado, JSON.stringify({ ...JSON.parse(await readFile(estado, 'utf8')), mode: modo }));
  const panel = await startPanel({ dataRoot, port: 0, now: () => new Date().toISOString(), hostId: 'pc-a' });
  t.after(panel.close);
  const page = await (await fetch(panel.url)).text();
  const token = JSON.parse(page.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  // Dia civil de São Paulo, o mesmo que o servidor usa para recusar data futura (UTC adianta o dia após 21h).
  const hoje = localDay(Date.now());
  const post = (rota, corpo, headers = {}) => fetch(`${panel.url}/api/${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: panel.url, 'X-Painel-Token': token, ...headers }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
  const lista = async () => (await (await fetch(`${panel.url}/api/candidaturas`, { headers: { 'X-Painel-Token': token } })).json()).vagas;
  const total = async () => (await readEvents(dataRoot)).eventos.length;
  return { dataRoot, panel, pipeline, post, lista, total, token, hoje };
}

test('POST sem Origin válido ou sem token responde 403 e não grava', async t => {
  const a = await ambiente(t);
  const antes = await a.total();
  const corpo = { id: a.pipeline.vagas[0].id, aplicada: true, data: a.hoje };
  assert.equal((await a.post('candidaturas', corpo, { Origin: 'https://exemplo.test' })).status, 403);
  assert.equal((await a.post('candidaturas', corpo, { 'X-Painel-Token': 'errado' })).status, 403);
  assert.equal(await a.total(), antes);
});

test('POST válido grava evento, devolve o marcador e a próxima leitura reflete', async t => {
  const a = await ambiente(t);
  const id = a.pipeline.vagas[0].id;
  const antes = await a.total();
  const resposta = await a.post('candidaturas', { id, aplicada: true, data: a.hoje });
  assert.equal(resposta.status, 200);
  const marcador = await resposta.json();
  assert.equal(marcador.aplicada, true);
  assert.equal(marcador.origem, 'usuario-no-painel');
  assert.equal(await a.total(), antes + 1);
  const vaga = (await a.lista()).find(v => v.id === id);
  assert.equal(vaga.aplicada, true);
  assert.equal(vaga.data, a.hoje);
  const projecao = JSON.parse(await readFile(path.join(a.dataRoot, 'projections/pipeline-vagas.json'), 'utf8'));
  assert.equal(projecao.vagas[0].candidatura_usuario.aplicada, true);
});

test('duas abas gravando ao mesmo tempo: nenhuma marcação se perde', async t => {
  const a = await ambiente(t);
  const respostas = await Promise.all(a.pipeline.vagas.map(v => a.post('candidaturas', { id: v.id, aplicada: true, data: a.hoje })));
  assert.deepEqual(respostas.map(r => r.status), [200, 200, 200]);
  assert.ok((await a.lista()).every(v => v.aplicada));
});

test('payload malformado, tipos errados e campos extras: 400 sem gravar', async t => {
  const a = await ambiente(t);
  const id = a.pipeline.vagas[0].id;
  const antes = await a.total();
  for (const corpo of ['{nao-json', '[]', 'null', { id, aplicada: 'sim' }, { id, aplicada: true }, { id, aplicada: true, data: '2999-01-01' }, { id, aplicada: true, data: a.hoje, extra: 1 }]) {
    assert.equal((await a.post('candidaturas', corpo)).status, 400, JSON.stringify(corpo));
  }
  assert.equal((await a.post('candidaturas', { id: 'nao-existe', aplicada: true, data: a.hoje })).status, 404);
  assert.equal((await a.post('candidaturas', '{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(await a.total(), antes);
});

test('POST de descarte equivalente: grava, reflete e restaura', async t => {
  const a = await ambiente(t);
  const id = a.pipeline.vagas[1].id;
  assert.equal((await (await a.post('descarte', { id, descartada: true })).json()).descartada, true);
  assert.equal((await a.lista()).find(v => v.id === id).descartada, true);
  assert.equal((await (await a.post('descarte', { id, descartada: false })).json()).descartada, false);
  assert.equal((await a.post('descarte', { id, descartada: 'x' })).status, 400);
});

test('em modo sombra os POST autenticados respondem 409 e não gravam', async t => {
  const a = await ambiente(t, { modo: 'shadow' });
  const antes = await a.total();
  const resposta = await a.post('candidaturas', { id: a.pipeline.vagas[0].id, aplicada: true, data: a.hoje });
  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).gravacao_painel, 'desligada');
  assert.equal(await a.total(), antes);
});

test('a raiz entrega o painel renderizado da projeção, com token e perfil, e reflete a marcação ao recarregar', async t => {
  const a = await ambiente(t);
  const dadosDe = async () => {
    const page = await (await fetch(a.panel.url)).text();
    assert.match(page, /window\.PAINEL_API=\{"token":"[a-f0-9]{64}"\}/);
    return JSON.parse(page.match(/const DATA=([\s\S]*?);\nconst esc=/)[1]);
  };
  const antes = await dadosDe();
  assert.equal(antes.vagas.length, 3);
  assert.equal(antes.vagas[0].candidatura_usuario, undefined);
  assert.equal((await a.post('candidaturas', { id: a.pipeline.vagas[0].id, aplicada: true, data: a.hoje })).status, 200);
  const depois = await dadosDe();
  assert.equal(depois.vagas[0].candidatura_usuario.aplicada, true);
});
