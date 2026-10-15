import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../core/config.mjs';
import { migrateLegacy, verifyMigration, projectLegacy, exportRollback } from '../../core/migration/legacy.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'career-bounty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const careerRoot = path.join(root, 'legacy', 'carreira');
  const curriculaRoot = path.join(root, 'legacy', 'curriculos');
  const dataRoot = path.join(root, 'data');
  await mkdir(path.join(careerRoot, 'busca-vagas'), { recursive: true });
  await mkdir(curriculaRoot, { recursive: true });
  const pipeline = { versao: 1, vagas: [{ id: 'vaga-1', status: 'curada', extra: null }], desconhecido: ['b', 'a'] };
  await writeFile(path.join(careerRoot, 'pipeline-vagas.json'), JSON.stringify(pipeline));
  await writeFile(path.join(careerRoot, 'busca-vagas', 'painel-vagas.html'), '<html>Empresa Alfa</html>');
  await writeFile(path.join(curriculaRoot, 'exemplo.html'), '<html>Ana Exemplo</html>');
  return { dataRoot, careerRoot, curriculaRoot, hostId: 'host-teste', pipeline, root };
}

test('dry-run inventaria fontes completas sem alterar origens nem criar DATA_ROOT', async t => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.careerRoot, 'pipeline-vagas.json'), 'utf8');
  const result = await migrateLegacy({ ...f, dryRun: true });
  assert.equal(result.files, 3);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(path.join(f.careerRoot, 'pipeline-vagas.json'), 'utf8'), before);
  assert.deepEqual(await readdir(f.root), ['legacy']);
});

test('importação preserva documento integral, snapshot verificado e reimportação não cria evento', async t => {
  const f = await fixture(t);
  const first = await migrateLegacy(f);
  assert.equal(first.eventsAdded, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataRoot, 'projections/pipeline-vagas.json'), 'utf8')), f.pipeline);
  const state = JSON.parse(await readFile(path.join(f.dataRoot, 'state/migration.json'), 'utf8'));
  assert.equal(state.mode, 'shadow');
  assert.equal(state.sourceHash, first.sourceHash);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataRoot, state.snapshotRoot, 'carreira/pipeline-vagas.json'), 'utf8')), f.pipeline);
  const second = await migrateLegacy(f);
  assert.equal(second.eventsAdded, 0);
  assert.equal(second.sourceHash, first.sourceHash);
});

test('replay independe da origem e rollback exporta documento integral sem sobrescrever', async t => {
  const f = await fixture(t);
  await migrateLegacy(f);
  await rm(path.join(f.dataRoot, 'projections'), { recursive: true });
  await projectLegacy({ dataRoot: f.dataRoot });
  assert.equal((await verifyMigration({ dataRoot: f.dataRoot })).equal, true);
  const destination = path.join(f.root, 'rollback.json');
  await exportRollback({ dataRoot: f.dataRoot, destination });
  assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), f.pipeline);
  await assert.rejects(exportRollback({ dataRoot: f.dataRoot, destination }), /existe|EEXIST/);
});

test('redução de vagas falha em sombra e preserva a projeção anterior', async t => {
  const f = await fixture(t);
  await migrateLegacy(f);
  await writeFile(path.join(f.careerRoot, 'pipeline-vagas.json'), JSON.stringify({ ...f.pipeline, vagas: [] }));
  await assert.rejects(migrateLegacy(f), /redução|ausentes/);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataRoot, 'projections/pipeline-vagas.json'), 'utf8')), f.pipeline);
});

test('destinos dentro da origem e rollback na origem são recusados', async t => {
  const f = await fixture(t);
  await assert.rejects(migrateLegacy({ ...f, dataRoot: path.join(f.careerRoot, 'dados') }), /destino|DATA_ROOT/);
  await migrateLegacy(f);
  await assert.rejects(exportRollback({ dataRoot: f.dataRoot, destination: path.join(f.careerRoot, 'novo.json'), careerRoot: f.careerRoot, curriculaRoot: f.curriculaRoot }), /origem|destino/);
});

test('snapshot adulterado é detectado na reimportação', async t => {
  const f = await fixture(t);
  const first = await migrateLegacy(f);
  await writeFile(path.join(f.dataRoot, first.snapshotRoot, 'curriculos/exemplo.html'), 'adulterado');
  await assert.rejects(migrateLegacy(f), /snapshot|hash/i);
});

test('dry-run diff detecta diferença e não altera a projeção', async t => {
  const f = await fixture(t);
  await migrateLegacy(f);
  assert.equal((await migrateLegacy({ ...f, dryRun: true })).equal, true);
  const changed = { ...f.pipeline, desconhecido: ['a', 'b'] };
  await writeFile(path.join(f.careerRoot, 'pipeline-vagas.json'), JSON.stringify(changed));
  assert.equal((await migrateLegacy({ ...f, dryRun: true })).equal, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataRoot, 'projections/pipeline-vagas.json'), 'utf8')), f.pipeline);
});

test('mudança concorrente do pipeline durante inventário não publica snapshot incoerente', async t => {
  const f = await fixture(t);
  let changed = false;
  await assert.rejects(migrateLegacy({ ...f, afterInventory: async () => {
    changed = true;
    await writeFile(path.join(f.careerRoot, 'pipeline-vagas.json'), JSON.stringify({ ...f.pipeline, extra: true }));
  } }), /Origem alterada/);
  assert.equal(changed, true);
  await assert.rejects(readFile(path.join(f.dataRoot, 'state/migration.json')), { code: 'ENOENT' });
});

test('log truncado é recusado sem reconstruir uma projeção parcial', async t => {
  const f = await fixture(t);
  await migrateLegacy(f);
  await mkdir(path.join(f.dataRoot, 'events/9999/01'), { recursive: true });
  await writeFile(path.join(f.dataRoot, 'events/9999/01/01.bad.jsonl'), '{"tipo":');
  await assert.rejects(projectLegacy({ dataRoot: f.dataRoot }), /truncado/);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataRoot, 'projections/pipeline-vagas.json'), 'utf8')), f.pipeline);
});

test('lock ocupado impede outro importador sem sobrescrever dados', async t => {
  const f = await fixture(t);
  await mkdir(f.dataRoot);
  await writeFile(path.join(f.dataRoot, '.migration.lock'), 'ocupado');
  await assert.rejects(migrateLegacy(f), /bloqueada/);
  assert.equal(await readFile(path.join(f.dataRoot, '.migration.lock'), 'utf8'), 'ocupado');
});

test('evento com payload divergente do hash é rejeitado no replay', async t => {
  const f = await fixture(t);
  await migrateLegacy({ ...f, now: '2026-10-14T20:00:00.000Z' });
  const filename = path.join(f.dataRoot, 'events/2026/10/14.host-teste.jsonl');
  const event = JSON.parse((await readFile(filename, 'utf8')).trim());
  event.dados.legado.desconhecido = [];
  await writeFile(filename, `${JSON.stringify(event)}\n`);
  await assert.rejects(projectLegacy({ dataRoot: f.dataRoot }), /hash|corrompido/);
});

test('CLI realiza dry-run, importação, verify e rollback com configuração privada', async t => {
  const f = await fixture(t);
  await mkdir(f.dataRoot);
  await writeFile(path.join(f.dataRoot, 'config.yml'), JSON.stringify({ legado_path: path.join(f.careerRoot, 'pipeline-vagas.json'), legacy_assets: path.join(f.careerRoot, 'busca-vagas'), legacy_materials: f.curriculaRoot, panel: { port: 8880 } }));
  const cli = fileURLToPath(new URL('../../bin/career-bounty.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', env: { ...process.env, DATA_ROOT: f.dataRoot } });
  const dry = run('migrate', '--dry-run', '--diff');
  assert.equal(dry.status, 0, dry.stdout);
  assert.equal(JSON.parse(dry.stdout).equal, null);
  assert.deepEqual(await readdir(f.dataRoot), ['config.yml']);
  assert.equal(run('migrate').status, 0);
  assert.equal(JSON.parse(run('verify').stdout).equal, true);
  assert.equal(JSON.parse(run('migrate').stdout).eventsAdded, 0);
  assert.equal(run('migrate', '--rollback', '--out', path.join(f.root, 'cli-rollback.json')).status, 0);
  assert.equal(run('migrate', '--out').status, 2);
});

test('configuração recusa sintaxe YAML não suportada e caminhos PDF inseguros', async t => {
  const f = await fixture(t);
  await mkdir(f.dataRoot);
  const filename = path.join(f.dataRoot, 'config.yml');
  await writeFile(filename, 'panel: {}');
  await assert.rejects(loadConfig({ dataRoot: f.dataRoot }), /JSON válido/);
  await writeFile(filename, JSON.stringify({ legado_path: path.join(f.careerRoot, 'pipeline-vagas.json'), legacy_assets: path.join(f.careerRoot, 'busca-vagas'), legacy_materials: f.curriculaRoot, panel: { base_files: ['../privado.pdf'] } }));
  await assert.rejects(loadConfig({ dataRoot: f.dataRoot }), /base_files/);
});

test('materiais novos geram novo snapshot sem duplicar o evento do pipeline', async t => {
  const f = await fixture(t);
  const first = await migrateLegacy(f);
  await writeFile(path.join(f.curriculaRoot, 'exemplo.html'), '<html>Currículo atualizado</html>');
  const second = await migrateLegacy(f);
  assert.equal(second.eventsAdded, 0);
  assert.notEqual(second.snapshotRoot, first.snapshotRoot);
  assert.equal(await readFile(path.join(f.dataRoot, second.snapshotRoot, 'curriculos/exemplo.html'), 'utf8'), '<html>Currículo atualizado</html>');
});

test('pipeline inválido ou IDs ausentes/duplicados são recusados antes de qualquer escrita', async t => {
  const f = await fixture(t);
  for (const invalid of [null, [], { vagas: 'not-an-array' }, { vagas: [{}] }, { vagas: [{ id: '' }] }, { vagas: [{ id: 'duplicado' }, { id: 'duplicado' }] }]) {
    await writeFile(path.join(f.careerRoot, 'pipeline-vagas.json'), JSON.stringify(invalid));
    await assert.rejects(migrateLegacy(f), /Pipeline inválido/);
    await assert.rejects(readdir(f.dataRoot), { code: 'ENOENT' });
  }
});
