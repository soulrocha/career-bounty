// Achado 2: em modo sombra a coleta real não grava, para o `migrate --shadow` seguir com diferencas 0.
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { dailyRun } from '../../core/schedule/dailyRun.mjs';

const fakeVaga = { fonte: 'fake', portal: 'fake', requisicao_id: '1001', empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia', local: 'Brasil', modalidade: 'remoto', regime: 'CLT',
  url: 'https://vagas.exemplo.test/vaga/1001', publicado_em: '2026-10-14', descricao: 'Lidera times de plataforma.' };
const AGORA = '2026-10-15T21:00:00Z';

async function ambiente(t) {
  const root = await tempDir(t);
  const careerRoot = path.join(root, 'legacy/carreira');
  const curriculaRoot = path.join(root, 'legacy/curriculos');
  const dataRoot = path.join(root, 'data');
  await mkdir(path.join(careerRoot, 'busca-vagas'), { recursive: true });
  await mkdir(curriculaRoot, { recursive: true });
  await mkdir(dataRoot);
  const legado = path.join(careerRoot, 'pipeline-vagas.json');
  await writeFile(legado, JSON.stringify(makeLegado({ vagas: 4, emails: 1, seed: 9 })));
  await writeFile(path.join(careerRoot, 'busca-vagas/painel-vagas.html'), '<html></html>');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ legado_path: legado, legacy_assets: path.join(careerRoot, 'busca-vagas'), legacy_materials: curriculaRoot, fontes: { fake: { vagas: [fakeVaga] } } }));
  return { dataRoot, cli: (...args) => run([...args, '--json'], { dataRoot }) };
}

test('em sombra, collect real recusa gravar com mensagem clara e o migrate --shadow segue com diferencas 0', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').json.diferencas, 0);
  const antes = (await readEvents(a.dataRoot)).eventos.length;
  const coleta = a.cli('collect', '--source', 'fake', '--teste', '--now', AGORA);
  assert.notEqual(coleta.status, 0);
  assert.match(coleta.stdout + coleta.stderr, /sombra/i);
  assert.equal((await readEvents(a.dataRoot)).eventos.length, antes, 'nenhum evento gravado');
  const depois = a.cli('migrate', '--shadow');
  assert.equal(depois.status, 0);
  assert.equal(depois.json.diferencas, 0);
});

test('em sombra, collect --dry-run continua funcionando (não grava)', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const coleta = a.cli('collect', '--dry-run', '--source', 'fake', '--teste', '--now', AGORA);
  assert.equal(coleta.status, 0, coleta.stdout + coleta.stderr);
  assert.equal(coleta.json.eventos_gravados, 0);
});

test('em sombra, o daily-run não roda estágio algum, não marca o dia e não grava rodada', async t => {
  const a = await ambiente(t);
  assert.equal(a.cli('migrate', '--shadow').status, 0);
  const antes = (await readEvents(a.dataRoot)).eventos.length;
  let chamado = false;
  const r = await dailyRun({ dataRoot: a.dataRoot, host: 'pc-casa', now: new Date('2026-10-14T21:00:00Z'), estagio1: async () => { chamado = true; return {}; }, estagio2: async () => ({}) });
  assert.deepEqual([r.executou, r.motivo, chamado], [false, 'modo_sombra', false]);
  assert.equal((await readEvents(a.dataRoot)).eventos.length, antes);
  await assert.rejects(stat(path.join(a.dataRoot, 'state', 'daily-run.json')), { code: 'ENOENT' });
  const cli = a.cli('daily-run', '--teste', '--now', '2026-10-14T21:00:00Z', '--host', 'pc-casa');
  assert.match(cli.stdout, /sombra/i);
  assert.equal(a.cli('migrate', '--shadow').json.diferencas, 0);
});

test('--now exige --teste em collect e daily-run: relógio simulado não é aceito por engano', async t => {
  const a = await ambiente(t);
  for (const args of [['collect', '--dry-run', '--source', 'fake', '--now', AGORA], ['daily-run', '--dry-run', '--now', AGORA]]) {
    const r = a.cli(...args);
    assert.equal(r.status, 2, args[0]);
    assert.match(r.stdout + r.stderr, /--teste/);
  }
  assert.equal(a.cli('collect', '--dry-run', '--source', 'fake', '--teste', '--now', AGORA).status, 0);
  await readFile(path.join(a.dataRoot, 'config.yml'));
});
