// Quem migrou de um pipeline antigo fica com snapshotRoot no estado mesmo depois do corte. Em modo ativo o painel tem de
// montar a interface atual a partir do log; a página estática do snapshot só vale no modo sombra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cutoverMigration } from '../../core/migration/cutover.mjs';
import { migrateLegacy } from '../../core/migration/legacy.mjs';
import { startPanel } from '../../panel/server.mjs';

const PAGINA_ANTIGA = '<html><body>Painel antigo da Empresa Alfa</body></html>';

async function migrado(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cb-migrado-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const careerRoot = path.join(root, 'legacy', 'carreira');
  const curriculaRoot = path.join(root, 'legacy', 'curriculos');
  const dataRoot = path.join(root, 'data');
  await mkdir(path.join(careerRoot, 'busca-vagas'), { recursive: true });
  await mkdir(curriculaRoot, { recursive: true });
  const pipeline = { versao: 1, vagas: [{ id: 'vaga-1', empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia', status: 'curada' }] };
  await writeFile(path.join(careerRoot, 'pipeline-vagas.json'), JSON.stringify(pipeline));
  await writeFile(path.join(careerRoot, 'busca-vagas', 'painel-vagas.html'), PAGINA_ANTIGA);
  await writeFile(path.join(careerRoot, 'busca-vagas', 'curriculos-manifest.json'), JSON.stringify([]));
  await migrateLegacy({ dataRoot, careerRoot, curriculaRoot, hostId: 'host-teste' });
  return { dataRoot, careerRoot };
}

async function paginaInicial(t, dataRoot) {
  const panel = await startPanel({ dataRoot, port: 0, now: () => '2026-10-18T12:00:00.000Z', hostId: 'host-teste' });
  t.after(panel.close);
  return { mode: panel.mode, html: await (await fetch(`${panel.url}/`)).text() };
}

test('modo sombra continua servindo a página do snapshot', async t => {
  const { dataRoot } = await migrado(t);
  const { mode, html } = await paginaInicial(t, dataRoot);
  assert.equal(mode, 'shadow');
  assert.match(html, /Painel antigo da Empresa Alfa/);
});

test('depois do corte, o painel monta a interface atual e não a página antiga do snapshot', async t => {
  const { dataRoot, careerRoot } = await migrado(t);
  await cutoverMigration({ careerRoot, dataRoot, confirmo: true });
  const { mode, html } = await paginaInicial(t, dataRoot);
  assert.equal(mode, 'ativo');
  assert.doesNotMatch(html, /Painel antigo da Empresa Alfa/);
  assert.match(html, /data-mundo="misto"/);
  assert.match(html, /Gerente de Engenharia/);
  // A navegação antiga (injetada para a página do snapshot) não pode aparecer por cima da placa nova.
  assert.doesNotMatch(html, /Quadrantes/);
  assert.doesNotMatch(html, />\s*Fila\s*</);
});
