import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeCorpus } from '../fixtures/mail/make-corpus.mjs';
import { avaliarLimiares, calcularConcordancia, itensDoCorpus, replayItens } from '../../core/mail/replay.mjs';

const corpus = makeCorpus();
const AGORA = new Date('2026-10-14T20:00:00-03:00');

test('replay de 30 dias no corpus sintético atinge ≥ 95% geral e ≥ 90% por regra', async () => {
  const r = await replayItens({ itens: itensDoCorpus(corpus), vagas: corpus.vagas, now: AGORA, dias: 30 });
  console.log(`concordância ${(r.geral.concordancia * 100).toFixed(1)}% (${r.geral.acertos}/${r.geral.total}); eventos ${r.eventos}; origem ${JSON.stringify(r.por_origem)}`);
  assert.deepEqual(r.falhas, []);
  assert.ok(r.geral.concordancia >= 0.95);
  assert.ok(r.por_regra.every(l => l.precisao >= 0.9));
  assert.ok(r.por_origem.llm >= 1, 'o classificador simulado resolve ao menos um ambíguo');
});

test('o cálculo das métricas e dos limiares é testado com resultados fabricados', () => {
  assert.deepEqual(calcularConcordancia([{ esperado: 'a', obtido: 'a' }, { esperado: 'a', obtido: 'b' }, { esperado: 'c', obtido: 'c' }, { esperado: 'd', obtido: 'd' }]), { total: 4, acertos: 3, concordancia: 0.75 });
  assert.equal(calcularConcordancia([]).concordancia, null);
  const bom = avaliarLimiares({ geral: { concordancia: 0.96 }, por_regra: [{ regra: 'r1', precisao: 0.9 }] });
  assert.equal(bom.ok, true);
  const ruim = avaliarLimiares({ geral: { concordancia: 0.94 }, por_regra: [{ regra: 'r1', precisao: 0.89 }, { regra: 'r2', precisao: 1 }] });
  assert.equal(ruim.ok, false);
  assert.equal(ruim.falhas.length, 2);
  assert.equal(avaliarLimiares({ geral: { concordancia: null }, por_regra: [] }).ok, false);
});

test('cada evento do replay tem message_id e nenhum tem URL (varredura)', async () => {
  const itens = itensDoCorpus(corpus);
  const r = await replayItens({ itens, vagas: corpus.vagas, now: AGORA, dias: 30 });
  assert.ok(r.eventos > 50);
  assert.ok(!r.falhas.some(f => /sem message_id|com URL/.test(f)));
});

test('--days restringe a janela e rótulos errados derrubam o replay', async () => {
  const itens = itensDoCorpus(corpus);
  const curto = await replayItens({ itens, vagas: corpus.vagas, now: AGORA, dias: 3 });
  assert.ok(curto.geral.total < itens.length);
  const errados = itens.map(i => ({ ...i, classe_esperada: 'oferta', ambiguo: false }));
  const r = await replayItens({ itens: errados, vagas: corpus.vagas, now: AGORA, dias: 30 });
  assert.equal(r.ok, false);
});

test('CLI mail replay: corpus sintético passa; arquivo de rótulos com divergência sai com código 1', async t => {
  const dataRoot = await tempDir(t);
  const ok = run(['mail', 'replay', '--days', '30', '--corpus', 'sintetico', '--now', '2026-10-14T20:00:00-03:00', '--teste', '--json'], { dataRoot });
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.equal(ok.json.ok, true);
  const arquivo = path.join(dataRoot, 'golden-mail.json');
  const itens = itensDoCorpus(corpus).slice(0, 40).map(i => ({ ...i, classe_esperada: 'oferta' }));
  await writeFile(arquivo, JSON.stringify({ itens, vagas: corpus.vagas }));
  const ruim = run(['mail', 'replay', '--days', '30', '--labels', arquivo, '--now', '2026-10-14T20:00:00-03:00', '--teste', '--json'], { dataRoot });
  assert.equal(ruim.status, 1);
  assert.equal(ruim.json.ok, false);
  assert.equal(run(['mail', 'replay', '--json'], { dataRoot }).status, 2, 'sem --corpus nem --labels');
});
