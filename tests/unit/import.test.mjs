import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir, run } from '../helpers/cli.mjs';
import { makeLegado, schemaFields } from '../fixtures/make-legado.mjs';
import { importPipeline } from '../../core/migration/import.mjs';
import { buildInventory } from '../../core/migration/inventory.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';

const opts = (dataRoot, pipeline, extra = {}) => ({ dataRoot, pipeline, ts: '2026-10-14T15:00:00.000Z', host: 'pc-a', ...extra });
const tipos = async dataRoot => (await readEvents(dataRoot)).eventos.map(e => e.tipo);

test('vaga com todos os nomes de campo do inventário importa sem erro', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 3, completo: true });
  assert.ok(schemaFields().length >= 100);
  assert.deepEqual(Object.keys(pipeline.vagas[0]).sort(), [...schemaFields()].sort());
  const result = await importPipeline(opts(dataRoot, pipeline));
  assert.equal(result.vagasNovas, 3);
  const { eventos, avisos } = await readEvents(dataRoot);
  assert.deepEqual(avisos, []);
  assert.equal(eventos.filter(e => e.tipo === 'vaga.importada').length, 3);
});

test('vaga.importada guarda o objeto original inteiro e os campos canônicos extraídos', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 2, completo: true });
  pipeline.vagas[0].requisicao_id = 987654;
  await importPipeline(opts(dataRoot, pipeline));
  const evento = (await readEvents(dataRoot)).eventos.find(e => e.tipo === 'vaga.importada' && e.entidade_id === pipeline.vagas[0].id);
  assert.deepEqual(evento.dados.legado, pipeline.vagas[0]);
  assert.deepEqual(evento.dados.canonicos, { id: pipeline.vagas[0].id, empresa: pipeline.vagas[0].empresa, cargo: pipeline.vagas[0].cargo, requisicao_id: 987654, portal: 'Pendente', aderencia: pipeline.vagas[0].aderencia });
});

test('reimportar o mesmo arquivo gera zero eventos novos', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 4, emails: 2, seed: 3 });
  assert.ok((await importPipeline(opts(dataRoot, pipeline))).eventsAdded > 0);
  const before = (await readEvents(dataRoot)).eventos.length;
  const again = await importPipeline(opts(dataRoot, structuredClone(pipeline), { ts: '2026-10-15T15:00:00.000Z' }));
  assert.equal(again.eventsAdded, 0);
  assert.equal((await readEvents(dataRoot)).eventos.length, before);
});

test('vaga alterada no legado gera vaga.atualizada só com os campos que mudaram', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 3, completo: true });
  await importPipeline(opts(dataRoot, pipeline));
  const changed = structuredClone(pipeline);
  changed.vagas[1].status = 'status-novo-no-legado';
  changed.vagas[1].observacao_nova = 'campo novo';
  delete changed.vagas[1].prazo;
  const result = await importPipeline(opts(dataRoot, changed, { ts: '2026-10-15T15:00:00.000Z' }));
  assert.equal(result.vagasAtualizadas, 1);
  const updates = (await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'vaga.atualizada');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].dados.campos, { status: 'status-novo-no-legado', observacao_nova: 'campo novo' });
  assert.deepEqual(updates[0].dados.removidos, ['prazo']);
  assert.equal(updates[0].entidade_id, pipeline.vagas[1].id);
});

test('alterar de volta ao valor antigo (A, B, A) continua gerando evento', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 1 });
  const original = pipeline.vagas[0].status;
  await importPipeline(opts(dataRoot, pipeline));
  for (const [i, status] of ['outro-status', original].entries()) {
    const next = structuredClone(pipeline);
    next.vagas[0].status = status;
    assert.equal((await importPipeline(opts(dataRoot, next, { ts: `2026-10-1${5 + i}T15:00:00.000Z` }))).vagasAtualizadas, 1);
  }
  const { eventos } = await readEvents(dataRoot);
  assert.equal(projectEvents(eventos).vagas[0].status, original);
});

test('vaga que some do legado não gera exclusão e continua na projeção', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 3 });
  await importPipeline(opts(dataRoot, pipeline));
  const smaller = { ...pipeline, vagas: pipeline.vagas.slice(0, 2) };
  const result = await importPipeline(opts(dataRoot, smaller, { ts: '2026-10-15T15:00:00.000Z' }));
  assert.deepEqual(result.ausentes, [pipeline.vagas[2].id]);
  assert.ok(!(await tipos(dataRoot)).some(tipo => /exclu|remov|delet/.test(tipo)));
  assert.equal(projectEvents((await readEvents(dataRoot)).eventos).vagas.length, 3);
  await assert.rejects(importPipeline(opts(dataRoot, smaller, { onAusentes: 'erro' })), /ausentes|redução/);
});

test('eventos_email_sem_requisicao é importado como entidade própria', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 1, emails: 3 });
  const result = await importPipeline(opts(dataRoot, pipeline));
  assert.equal(result.emailsNovos, 3);
  const { eventos } = await readEvents(dataRoot);
  const emails = eventos.filter(e => e.tipo === 'email_evento.importado');
  assert.equal(emails.length, 3);
  assert.ok(emails.every(e => e.entidade === 'email_sem_requisicao'));
  assert.deepEqual(emails.map(e => e.entidade_id).sort(), ['email-1', 'email-2', 'email-3']);
});

test('datas legadas (consultado_em, prazo) são preservadas como string, sem reformatar', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 1, completo: true });
  Object.assign(pipeline.vagas[0], { consultado_em: '2026-10-1', prazo: '14/10/2026 às 18h', publicada_em: '2026-10-13T08:00:00-03:00' });
  await importPipeline(opts(dataRoot, pipeline));
  const vaga = projectEvents((await readEvents(dataRoot)).eventos).vagas[0];
  assert.equal(vaga.consultado_em, '2026-10-1');
  assert.equal(vaga.prazo, '14/10/2026 às 18h');
  assert.equal(vaga.publicada_em, '2026-10-13T08:00:00-03:00');
});

test('a ordem do legado é reproduzida mesmo quando uma vaga entra no meio', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: 3 });
  await importPipeline(opts(dataRoot, { ...pipeline, vagas: [pipeline.vagas[0], pipeline.vagas[2]] }));
  await importPipeline(opts(dataRoot, pipeline, { ts: '2026-10-15T15:00:00.000Z' }));
  assert.deepEqual(projectEvents((await readEvents(dataRoot)).eventos).vagas.map(v => v.id), pipeline.vagas.map(v => v.id));
});

test('o inventário grava nomes e tipos, nunca valores', () => {
  const pipeline = makeLegado({ vagas: 2, completo: true });
  pipeline.vagas[0].cargo = 'VALOR-SENSIVEL-UNICO';
  const text = JSON.stringify(buildInventory(pipeline));
  assert.ok(!text.includes('VALOR-SENSIVEL-UNICO'));
  assert.ok(!text.includes('Empresa Alfa'));
  assert.ok(buildInventory(pipeline).vaga.cargo.tipos.includes('string'));
});

test('CLI: migrate --inventory imprime o inventário do legado configurado', async t => {
  const dataRoot = await tempDir(t);
  const legacy = await tempDir(t);
  await mkdir(path.join(legacy, 'carreira/busca-vagas'), { recursive: true });
  await mkdir(path.join(legacy, 'curriculos'), { recursive: true });
  await writeFile(path.join(legacy, 'carreira/pipeline-vagas.json'), JSON.stringify(makeLegado({ vagas: 2 })));
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ legado_path: path.join(legacy, 'carreira/pipeline-vagas.json'), legacy_assets: path.join(legacy, 'carreira/busca-vagas'), legacy_materials: path.join(legacy, 'curriculos') }));
  const result = run(['migrate', '--inventory', '--json'], { dataRoot });
  assert.equal(result.status, 0, result.stdout);
  assert.ok(result.json.vaga.id.tipos.includes('string'));
  assert.ok(!result.stdout.includes('Empresa Alfa'));
});
