import assert from 'node:assert/strict';
import test from 'node:test';
import { concordancia, previsao, MINIMO_PADRAO } from '../../core/eval/radar.mjs';

const item = (id, rotulo, obtido) => ({ id, rotulo, obtido, motivo: `motivo ${id}` });

test('concordância total e por vaga, conferida à mão', () => {
  const dez = [...Array.from({ length: 9 }, (_, i) => item(`v${i}`, 'alta', 'alta')), item('v9', 'alta', 'baixa')];
  const r = concordancia(dez);
  assert.deepEqual([r.rotuladas, r.acertos, r.concordancia], [10, 9, 0.9]);
  assert.deepEqual(r.discordancias, [{ id: 'v9', esperado: 'alta', obtido: 'baixa', motivo: 'motivo v9' }]);
  const tres = concordancia([item('a', 'alta', 'alta'), item('b', 'media', 'baixa'), item('c', 'baixa', 'baixa')]);
  assert.equal(tres.concordancia, 0.6667);
});

test('vagas pendentes ficam fora da conta; sem nenhum rótulo a concordância é nula', () => {
  const r = concordancia([item('a', 'alta', 'alta'), item('b', 'pendente', 'baixa')]);
  assert.deepEqual([r.rotuladas, r.sem_rotulo, r.concordancia], [1, 1, 1]);
  assert.equal(concordancia([item('x', 'pendente', 'alta')]).concordancia, null);
});

test('o piso padrão é 85% e 16 de 20 reprova, 17 de 20 passa', () => {
  assert.equal(MINIMO_PADRAO, 0.85);
  const com = acertos => concordancia(Array.from({ length: 20 }, (_, i) => item(`v${i}`, 'alta', i < acertos ? 'alta' : 'baixa'))).concordancia;
  assert.ok(com(16) < MINIMO_PADRAO);
  assert.ok(com(17) >= MINIMO_PADRAO);
});

test('previsão: descartar vira baixa, talvez vira media, avaliar usa a aderência validada', () => {
  assert.equal(previsao('descartar', null), 'baixa');
  assert.equal(previsao('talvez', null), 'media');
  assert.equal(previsao('avaliar', 'alta'), 'alta');
});
