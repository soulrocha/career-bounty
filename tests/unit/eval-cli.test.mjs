import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';

const golden = ['--golden', 'tests/golden/radar/golden-sintetico.json'];

test('eval radar em replay: 4 de 5 (80%) reprova no piso padrão e lista a discordância sem URL', async t => {
  const dataRoot = await tempDir(t);
  const r = run(['eval', 'radar', ...golden, '--json'], { dataRoot });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.json.concordancia, 0.8);
  assert.deepEqual(r.json.discordancias.map(d => [d.id, d.esperado, d.obtido]), [['golden-s5', 'alta', 'media']]);
  assert.ok(!/https?:/.test(JSON.stringify(r.json)), 'sem URL no relatório');
  assert.equal(r.json.uso.triador.chamadas, 1);
  assert.equal(r.json.uso.avaliador.chamadas, 2);
  assert.ok(r.json.uso.avaliador.tokens_out > 0);
});

test('eval radar com piso de 80% passa', async t => {
  const dataRoot = await tempDir(t);
  const r = run(['eval', 'radar', ...golden, '--min', '0.8', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.ok, true);
});

test('golden real com rótulos pendentes não roda e explica', async t => {
  const dataRoot = await tempDir(t);
  await mkdir(path.join(dataRoot, 'golden'), { recursive: true });
  await writeFile(path.join(dataRoot, 'golden', 'golden-20.json'), JSON.stringify({ versao: 1, kb: 'privada', vagas: [{ id: 'g1', empresa: 'Empresa Alfa', cargo: 'X', descricao: 'y', rotulo_saulo: 'pendente' }] }));
  const r = run(['eval', 'radar', '--json'], { dataRoot });
  assert.equal(r.status, 3);
  assert.equal(r.json.motivo, 'golden sem rótulos');
});

test('o modo live exige a flag e nunca roda na CI', async t => {
  const dataRoot = await tempDir(t);
  const r = run(['eval', 'radar', ...golden, '--live', '--json'], { dataRoot, env: { CI: 'true' } });
  assert.equal(r.status, 2);
  assert.match(r.json.error, /CI/);
});
