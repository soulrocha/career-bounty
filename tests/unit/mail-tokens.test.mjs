import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { createRunner, parseEnvelope } from '../../core/llm/runner.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { lerFaseA, lerFaseB } from '../../core/mail/reader.mjs';
import { percentil, planejarLimiteFaseB, resumirRodadas } from '../../core/mail/tokens.mjs';

const consulta = { query: 'from:(gupy.com.br) after:2026/10/07', limite: 50, cursor_usado: null };
const digest = { cursor_usado: null, consultado_em: '2026-10-14T18:00:00.000Z', precisa_abrir: [], itens: [{ message_id: 'm1', data: '2026-10-13', remetente_nome: 'X', remetente_dominio: 'gupy.com.br', assunto: 'Assunto secreto', trecho: 'Trecho secreto' }] };
const AGORA = new Date('2026-10-14T15:00:00-03:00');

async function usoDoEnvelope() {
  return parseEnvelope(await readFile(new URL('../replay/mail/spike-envelope.json', import.meta.url), 'utf8')).uso;
}

test('o livro separa busca, abertura e classificador com tokens de entrada, saída e cache lidos do usage gravado', async t => {
  const dataRoot = await tempDir(t);
  const uso = await usoDoEnvelope();
  assert.ok(uso.tokens_cache_leitura > 0);
  const runner = createRunner({ modo: 'fake', dataRoot, fake: ({ entrada }) => (entrada.fase === 'A' ? { ...digest, _uso: uso } : { itens: entrada.ids.map(id => ({ message_id: id, corpo: 'x' })), _uso: { tokens_in: 500, tokens_out: 100, tokens_cache_leitura: 40000, custo_usd: 0.002 } }) });
  await lerFaseA({ runner, consulta, now: AGORA, rodada: 'r1' });
  await lerFaseB({ runner, ids: ['m1'], limite: 5, rodada: 'r1' });
  const { rodadas } = resumirRodadas((await readEvents(dataRoot)).eventos);
  assert.equal(rodadas.length, 1);
  const [r] = rodadas;
  assert.equal(r.busca.tokens_in, uso.tokens_in);
  assert.equal(r.busca.tokens_cache_leitura, uso.tokens_cache_leitura);
  assert.equal(r.abertura.tokens_cache_leitura, 40000);
  assert.equal(r.classificador.chamadas, 0);
  assert.equal(r.total_tokens, uso.tokens_in + uso.tokens_out + uso.tokens_cache_leitura + uso.tokens_cache_criacao + 500 + 100 + 40000);
  assert.equal(r.custo_usd, 0.009);
});

test('rodada sem e-mail novo: a fase B não roda e o custo é só o da busca', async t => {
  const dataRoot = await tempDir(t);
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => ({ ...digest, _uso: { tokens_in: 100, tokens_out: 50, custo_usd: 0.001 } }) });
  await lerFaseA({ runner, consulta, now: AGORA, rodada: 'r2' });
  await lerFaseB({ runner, ids: [], limite: 5, rodada: 'r2' });
  const [r] = resumirRodadas((await readEvents(dataRoot)).eventos).rodadas;
  assert.equal(r.abertura.chamadas, 0);
  assert.equal(r.total_tokens, r.busca.tokens_in + r.busca.tokens_out);
});

test('média e P95 por rodada; chamadas de outros agentes não entram', () => {
  const ev = (rodada, fase, tin, ts) => ({ tipo: 'llm.uso', ts, dados: { rodada, fase, agente: 'x', tokens_in: tin, tokens_out: 0 } });
  const eventos = [ev('a', 'busca', 100, '2026-10-01T00:00:00Z'), ev('b', 'busca', 300, '2026-10-02T00:00:00Z'), ev('c', 'busca', 1000, '2026-10-03T00:00:00Z'), { tipo: 'llm.uso', ts: '2026-10-03T00:00:00Z', dados: { agente: 'triador', tokens_in: 9e9, tokens_out: 0 } }];
  const { resumo, rodadas } = resumirRodadas(eventos);
  assert.deepEqual(rodadas.map(r => r.total_tokens), [100, 300, 1000]);
  assert.equal(resumo.media_tokens, 467);
  assert.equal(resumo.p95_tokens, 1000);
  assert.equal(percentil([], 95), null);
  assert.equal(percentil([5], 95), 5);
});

test('acima do orçamento, a rodada seguinte reduz o limite da fase B e registra aviso', () => {
  assert.deepEqual(planejarLimiteFaseB({ limite: 5, orcamento: 1000, ultimaRodada: { total_tokens: 900 } }), { limite: 5, avisos: [] });
  const r = planejarLimiteFaseB({ limite: 5, orcamento: 1000, ultimaRodada: { total_tokens: 2000 } });
  assert.equal(r.limite, 2);
  assert.match(r.avisos[0], /orçamento/);
  assert.equal(planejarLimiteFaseB({ limite: 1, orcamento: 10, ultimaRodada: { total_tokens: 99 } }).limite, 1);
  assert.equal(planejarLimiteFaseB({ limite: 5, orcamento: null, ultimaRodada: { total_tokens: 99 } }).limite, 5);
});

test('report tokens --by mail-round --json nunca inclui assunto, remetente nem trecho', async t => {
  const dataRoot = await tempDir(t);
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => ({ ...digest, _uso: { tokens_in: 100, tokens_out: 50 } }) });
  await lerFaseA({ runner, consulta, now: AGORA, rodada: 'r1' });
  const r = run(['report', 'tokens', '--by', 'mail-round', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.resumo.rodadas, 1);
  assert.ok(!/secreto|gupy|X"/.test(r.stdout), r.stdout);
  assert.equal(run(['report', 'tokens', '--json'], { dataRoot }).status, 2);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ mail: { orcamento_tokens: 1234 } }));
  assert.equal(run(['report', 'tokens', '--by', 'mail-round', '--json'], { dataRoot }).json.orcamento_tokens, 1234);
});
