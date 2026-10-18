// Instalação nova (sem legado para migrar): `setup` deixa o painel, a projeção e a coleta prontos para o uso.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { iniciarInstalacaoNova } from '../../core/migration/legacy.mjs';
import { startPanel } from '../../panel/server.mjs';
import { readEvents } from '../../core/store/events.mjs';

const ler = async (dataRoot, rel) => JSON.parse(await readFile(path.join(dataRoot, rel), 'utf8'));

test('setup em pasta nova cria o estado ativo e a projeção vazia, e o painel abre com gravação liberada', async t => {
  const dataRoot = await tempDir(t);
  const r = run(['setup', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  const estado = await ler(dataRoot, 'state/migration.json');
  assert.equal(estado.mode, 'ativo');
  assert.equal(estado.snapshotRoot, null);
  assert.deepEqual((await ler(dataRoot, 'projections/pipeline-vagas.json')).vagas, []);
  const painel = await startPanel({ dataRoot, port: 0, now: () => '2026-10-18T12:00:00.000Z', hostId: 'pc-a' });
  t.after(painel.close);
  assert.equal(painel.mode, 'ativo');
  assert.equal((await fetch(painel.url)).status, 200);
  const doctor = run(['doctor', '--json'], { dataRoot });
  const migracao = JSON.parse(doctor.stdout).checks.find(c => c.id === 'migracao');
  assert.equal(migracao.status, 'ok');
});

test('setup é idempotente: rodar de novo não mexe no estado nem no log', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  const estado = await readFile(path.join(dataRoot, 'state/migration.json'), 'utf8');
  const eventos = (await readEvents(dataRoot)).eventos.length;
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  assert.equal(await readFile(path.join(dataRoot, 'state/migration.json'), 'utf8'), estado);
  assert.equal((await readEvents(dataRoot)).eventos.length, eventos);
});

test('setup --com-legado não inicia estado: quem vai migrar o legado segue o caminho do migrate', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--com-legado', '--json'], { dataRoot }).status, 0);
  await assert.rejects(readFile(path.join(dataRoot, 'state/migration.json'), 'utf8'), { code: 'ENOENT' });
});

test('uma pasta que já migrou (modo sombra) não é tocada pelo setup', async t => {
  const dataRoot = await tempDir(t);
  const resultado = await iniciarInstalacaoNova({ dataRoot, now: '2026-10-18T12:00:00.000Z' });
  assert.equal(resultado.iniciada, true);
  assert.equal((await iniciarInstalacaoNova({ dataRoot })).iniciada, false);
});
