// Testes de corte seguro da migração (F1.15 / A3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cutoverMigration } from '../../core/migration/cutover.mjs';
import { migrateLegacy } from '../../core/migration/legacy.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cb-corte-'));
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

test('migrate --corte: recusa corte se faltar confirmação e exige diff zero', async t => {
  const f = await fixture(t);

  // 1. Sem migração prévia: falha
  await assert.rejects(
    () => cutoverMigration({ careerRoot: f.careerRoot, dataRoot: f.dataRoot }),
    /execute a migração em sombra primeiro/
  );

  // 2. Executar migração inicial em sombra
  await migrateLegacy(f);

  // 3. Sem flag de confirmação: recusa
  await assert.rejects(
    () => cutoverMigration({ careerRoot: f.careerRoot, dataRoot: f.dataRoot, confirmo: false }),
    /--confirmar-corte/
  );

  // 4. Com divergência na projeção: recusa mesmo com confirmação
  const projPath = path.join(f.dataRoot, 'projections', 'pipeline-vagas.json');
  await writeFile(projPath, JSON.stringify({ ...f.pipeline, versao: 999 }));
  await assert.rejects(
    () => cutoverMigration({ careerRoot: f.careerRoot, dataRoot: f.dataRoot, confirmo: true }),
    /diferenças entre a projeção sombra e o legado/
  );

  // 5. Restaurando paridade estrita e confirmando: corte é realizado
  await writeFile(projPath, JSON.stringify(f.pipeline));
  const ts = '2026-10-18T10:00:00.000Z';
  const resultado = await cutoverMigration({ careerRoot: f.careerRoot, dataRoot: f.dataRoot, confirmo: true, now: ts });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.mode, 'ativo');

  const stateFile = path.join(f.dataRoot, 'state', 'migration.json');
  const estadoFinal = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(estadoFinal.mode, 'ativo');
  assert.equal(estadoFinal.cortadoEm, ts);

  // 6. Chamada subsequente é idempotente
  const reCorte = await cutoverMigration({ careerRoot: f.careerRoot, dataRoot: f.dataRoot, confirmo: true });
  assert.equal(reCorte.ok, true);
  assert.equal(reCorte.mode, 'ativo');
});

test('migrate --corte recusa quando o legado mudou depois da importação em sombra', async t => {
  const f = await fixture(t);
  await migrateLegacy(f);
  const arquivo = path.join(f.careerRoot, 'pipeline-vagas.json');
  const novo = { ...f.pipeline, vagas: [...f.pipeline.vagas, { id: 'vaga-nova', status: 'curada', extra: null }] };
  await writeFile(arquivo, JSON.stringify(novo));
  await assert.rejects(() => cutoverMigration({ careerRoot: f.careerRoot, dataRoot: f.dataRoot, confirmo: true }), /legado mudou depois da última importação/);
  assert.equal(JSON.parse(await readFile(path.join(f.dataRoot, 'state', 'migration.json'), 'utf8')).mode, 'shadow', 'o estado não mudou');
  await assert.rejects(() => cutoverMigration({ dataRoot: f.dataRoot, confirmo: true }), /pasta do legado/);
});

test('migrate --corte só parte do modo sombra', async t => {
  const f = await fixture(t);
  await migrateLegacy(f);
  const estado = path.join(f.dataRoot, 'state', 'migration.json');
  await writeFile(estado, JSON.stringify({ ...JSON.parse(await readFile(estado, 'utf8')), mode: 'qualquer' }));
  await assert.rejects(() => cutoverMigration({ careerRoot: f.careerRoot, dataRoot: f.dataRoot, confirmo: true }), /Modo de migração inesperado/);
});
