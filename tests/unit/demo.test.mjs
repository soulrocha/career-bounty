// `demo` monta uma pasta descartável com a persona fictícia e vagas de exemplo, em modo ativo, sem tocar no DATA_ROOT real.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';

test('demo cria a pasta de demonstração pronta: vagas no painel, base da persona e modo ativo', async t => {
  const dataRoot = await tempDir(t);
  const pasta = path.join(await tempDir(t), 'demo');
  const r = run(['demo', '--pasta', pasta, '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.pasta, pasta);
  assert.equal(r.json.vagas, 6);
  assert.equal(r.json.afirmacoes, 3);
  assert.equal(JSON.parse(await readFile(path.join(pasta, 'state/migration.json'), 'utf8')).mode, 'ativo');
  const painel = await startPanel({ dataRoot: pasta, port: 0, now: () => '2026-10-18T12:00:00.000Z', hostId: 'pc-demo' });
  t.after(painel.close);
  const html = await (await fetch(painel.url)).text();
  for (const cargo of ['Gerente de Produto', 'Líder de Engenharia']) assert.ok(html.includes(cargo), cargo);
  await assert.rejects(readFile(path.join(dataRoot, 'state/migration.json'), 'utf8'), { code: 'ENOENT' }, 'o DATA_ROOT real não é tocado');
});

test('demo recusa pasta que já existe com conteúdo e a pasta do DATA_ROOT em uso', async t => {
  const dataRoot = await tempDir(t);
  const outra = await tempDir(t);
  await writeFile(path.join(outra, 'algo.txt'), 'conteúdo do usuário');
  assert.notEqual(run(['demo', '--pasta', outra, '--json'], { dataRoot }).status, 0);
  const igual = run(['demo', '--pasta', dataRoot, '--json'], { dataRoot });
  assert.notEqual(igual.status, 0);
  assert.match(igual.json?.erro ?? igual.stdout + igual.stderr, /DATA_ROOT|vazia|existe/i);
});
