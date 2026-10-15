import assert from 'node:assert/strict';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { createBudget } from '../../core/sources/budget.mjs';

test('relógio simulado (--now) nunca toca a chave de orçamento do dia real', async t => {
  const dataRoot = await tempDir(t);
  const real = createBudget({ dataRoot, nome: 'linkedin', limite: 5 });
  assert.equal(await real.consume(), true);
  await real.blockForDay();
  const simulado = createBudget({ dataRoot, nome: 'linkedin', limite: 5, now: new Date('2031-03-04T12:00:00Z') });
  assert.equal((await simulado.state()).bloqueado, false, 'o bloqueio real não vaza para a simulação');
  assert.equal(await simulado.consume(), true);
  const depois = await createBudget({ dataRoot, nome: 'linkedin', limite: 5 }).state();
  assert.deepEqual([depois.usado, depois.bloqueado], [1, true], 'a simulação não apagou nem alterou o estado real');
});
