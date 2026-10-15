import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { cli, repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';

const fixture = path.join(repoRoot, 'tests/fixtures/legado-1-vaga.json');

async function token(url) {
  const page = await (await fetch(url)).text();
  return JSON.parse(page.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
}

test('tracer: legado de 1 vaga vira evento, projeção e resposta do painel', async t => {
  const dataRoot = await tempDir(t);
  const migrated = run(['migrate', '--from', fixture, '--json'], { dataRoot });
  assert.equal(migrated.status, 0, migrated.stdout);
  const projected = run(['project', '--json'], { dataRoot });
  assert.equal(projected.status, 0, projected.stdout);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const response = await fetch(`${panel.url}/api/candidaturas`, { headers: { 'X-Painel-Token': await token(panel.url) } });
  assert.equal(response.status, 200);
  const { vagas } = await response.json();
  assert.equal(vagas.length, 1);
  assert.equal(vagas[0].id, 'empresa-alfa-0000000001');
  assert.equal(vagas[0].aplicada, false);
});

test('tracer: segundo migrate do mesmo arquivo não duplica a vaga', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['migrate', '--from', fixture, '--json'], { dataRoot }).status, 0);
  const again = run(['migrate', '--from', fixture, '--json'], { dataRoot });
  assert.equal(again.status, 0, again.stdout);
  assert.equal(again.json.eventsAdded, 0);
  const projected = run(['project', '--json'], { dataRoot });
  assert.equal(projected.json.vagas, 1);
});

test('tracer: /api/candidaturas sem token responde 403', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['migrate', '--from', fixture, '--json'], { dataRoot }).status, 0);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  assert.equal((await fetch(`${panel.url}/api/candidaturas`)).status, 403);
});

test('tracer: `panel --port 0` sobe pela CLI e responde com o token', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['migrate', '--from', fixture, '--json'], { dataRoot }).status, 0);
  const child = spawn(process.execPath, [cli, 'panel', '--port', '0', '--json'], { env: { ...process.env, DATA_ROOT: dataRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const url = await new Promise((done, fail) => {
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; const line = out.split('\n')[0]; if (out.includes('\n')) { try { done(JSON.parse(line).url); } catch (error) { fail(error); } } });
    child.once('exit', code => fail(new Error(`painel saiu com ${code}: ${out}`)));
  });
  const response = await fetch(`${url}/api/candidaturas`, { headers: { 'X-Painel-Token': await token(url) } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).vagas[0].id, 'empresa-alfa-0000000001');
});
