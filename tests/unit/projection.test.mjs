import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { semanticDiff } from '../../core/migration/diff.mjs';
import { importPipeline } from '../../core/migration/import.mjs';
import { projectLegacy } from '../../core/migration/legacy.mjs';
import { semanticHash } from '../../core/store/canonicalize.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';

const opts = (dataRoot, pipeline, extra = {}) => ({ dataRoot, pipeline, ts: '2026-10-14T15:00:00.000Z', host: 'pc-a', ...extra });
const projected = async dataRoot => projectEvents((await readEvents(dataRoot)).eventos);

test('importar e projetar a fixture sintética devolve objeto igual ao de entrada', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 6, emails: 3, completo: true, seed: 5 });
  await importPipeline(opts(dataRoot, pipeline));
  const result = await projected(dataRoot);
  assert.deepEqual(semanticDiff(pipeline, result), { diferencas: 0, itens: [] });
  assert.deepEqual(result, pipeline);
});

test('o comparador acusa diferença quando um campo muda (e aponta só o caminho)', () => {
  const a = makeLegado({ vagas: 3 });
  const b = structuredClone(a);
  b.vagas[1].status = 'VALOR-SECRETO';
  delete b.vagas[2].cargo;
  b.eventos_email_sem_requisicao[0].resumo = 'outro';
  b.schema_version = 2;
  const diff = semanticDiff(a, b);
  assert.equal(diff.diferencas, 4);
  assert.ok(diff.itens.some(i => i.entidade === 'vaga' && i.id === a.vagas[1].id && i.campos.includes('status')));
  assert.ok(diff.itens.some(i => i.entidade === 'vaga' && i.id === a.vagas[2].id && i.campos.includes('cargo')));
  assert.ok(diff.itens.some(i => i.entidade === 'email_sem_requisicao' && i.campos.includes('resumo')));
  assert.ok(diff.itens.some(i => i.entidade === 'raiz' && i.campos.includes('schema_version')));
  assert.ok(!JSON.stringify(diff).includes('VALOR-SECRETO'));
});

test('o comparador ignora ordem de chaves e `atualizado`, mas acusa vaga a mais, a menos e fora de ordem', () => {
  const a = makeLegado({ vagas: 3 });
  const reordered = { eventos_email_sem_requisicao: a.eventos_email_sem_requisicao, vagas: a.vagas.map(v => Object.fromEntries(Object.entries(v).reverse())), atualizado: '2030-01-01', schema_version: 1 };
  assert.equal(semanticDiff(a, reordered).diferencas, 0);
  assert.equal(semanticDiff(a, { ...a, vagas: a.vagas.slice(0, 2) }).itens[0].tipo, 'somente_em_a');
  assert.equal(semanticDiff({ ...a, vagas: a.vagas.slice(0, 2) }, a).itens[0].tipo, 'somente_em_b');
  assert.deepEqual(semanticDiff(a, { ...a, vagas: [a.vagas[1], a.vagas[0], a.vagas[2]] }).itens, [{ entidade: 'vaga', id: null, tipo: 'ordem' }]);
});

test('a ordem das vagas e dos e-mails é preservada após atualizações', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 5, emails: 3 });
  await importPipeline(opts(dataRoot, pipeline));
  const reordered = structuredClone(pipeline);
  reordered.vagas.reverse();
  reordered.vagas[0].status = 'mudou';
  reordered.eventos_email_sem_requisicao.reverse();
  await importPipeline(opts(dataRoot, reordered, { ts: '2026-10-15T15:00:00.000Z' }));
  assert.equal(semanticDiff(reordered, await projected(dataRoot)).diferencas, 0);
});

test('eventos_email_sem_requisicao é reproduzido, inclusive com ids repetidos ou ausentes', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 1, emails: 3 });
  pipeline.eventos_email_sem_requisicao[1].id = pipeline.eventos_email_sem_requisicao[0].id;
  delete pipeline.eventos_email_sem_requisicao[2].id;
  await importPipeline(opts(dataRoot, pipeline));
  assert.equal(semanticDiff(pipeline, await projected(dataRoot)).diferencas, 0);
  assert.equal((await importPipeline(opts(dataRoot, pipeline, { ts: '2026-10-15T15:00:00.000Z' }))).eventsAdded, 0);
});

test('a projeção é determinística: duas execuções, mesmo hash e mesmos bytes', async t => {
  const dataRoot = await tempDir(t);
  await importPipeline(opts(dataRoot, makeLegado({ vagas: 8, emails: 2, completo: true })));
  const file = path.join(dataRoot, 'projections/pipeline-vagas.json');
  const first = await projectLegacy({ dataRoot });
  const bytes = await readFile(file);
  const second = await projectLegacy({ dataRoot });
  assert.equal(first.sourceHash, second.sourceHash);
  assert.deepEqual(await readFile(file), bytes);
});

test('a projeção usa só os eventos: sem o arquivo legado e sem a projeção anterior', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 4, emails: 2, completo: true });
  await importPipeline(opts(dataRoot, pipeline));
  const changed = structuredClone(pipeline);
  changed.vagas[0].status = 'mudou';
  changed.atualizado = '2026-10-15';
  await importPipeline(opts(dataRoot, changed, { ts: '2026-10-15T15:00:00.000Z' }));
  await rm(path.join(dataRoot, 'projections'), { recursive: true, force: true });
  await projectLegacy({ dataRoot });
  const rebuilt = JSON.parse(await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8'));
  assert.equal(semanticHash(rebuilt), semanticHash(changed));
  assert.equal(rebuilt.atualizado, '2026-10-15');
});

test('CLI: migrate --dry-run --diff --json lista diferenças sem escrever nada em DATA_ROOT', async t => {
  const root = await tempDir(t);
  const legacy = path.join(root, 'legacy');
  const dataRoot = path.join(root, 'data');
  await mkdir(path.join(legacy, 'carreira/busca-vagas'), { recursive: true });
  await mkdir(path.join(legacy, 'curriculos'), { recursive: true });
  await mkdir(dataRoot);
  const pipelineFile = path.join(legacy, 'carreira/pipeline-vagas.json');
  const pipeline = makeLegado({ vagas: 3 });
  await writeFile(pipelineFile, JSON.stringify(pipeline));
  await writeFile(path.join(legacy, 'carreira/busca-vagas/painel-vagas.html'), '<html></html>');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ legado_path: pipelineFile, legacy_assets: path.join(legacy, 'carreira/busca-vagas'), legacy_materials: path.join(legacy, 'curriculos') }));
  assert.equal(run(['migrate', '--json'], { dataRoot }).status, 0);
  const before = await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8');
  const clean = run(['migrate', '--dry-run', '--diff', '--json'], { dataRoot });
  assert.equal(clean.status, 0, clean.stdout);
  assert.equal(clean.json.diferencas, 0);
  assert.deepEqual(clean.json.itens, []);
  const changed = structuredClone(pipeline);
  changed.vagas[0].status = 'VALOR-SECRETO';
  await writeFile(pipelineFile, JSON.stringify(changed));
  const dirty = run(['migrate', '--dry-run', '--diff', '--json'], { dataRoot });
  assert.equal(dirty.status, 1);
  assert.equal(dirty.json.diferencas, 1);
  assert.equal(dirty.json.itens[0].id, pipeline.vagas[0].id);
  assert.deepEqual(dirty.json.itens[0].campos, ['status']);
  assert.ok(!dirty.stdout.includes('VALOR-SECRETO'));
  assert.equal(await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8'), before);
  assert.equal(run(['verify', '--json'], { dataRoot }).json.equal, true);
});
