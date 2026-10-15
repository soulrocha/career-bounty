import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { buildLiveArgs, createRunner, entradaHash, LlmSaidaInvalida, parseEnvelope, stripFence } from '../../core/llm/runner.mjs';
import { redact } from '../../core/privacy/redact.mjs';
import { readEvents } from '../../core/store/events.mjs';

const base = { agente: 'triador', modelo: 'haiku', versaoPrompt: 'v1', entrada: { vagas: [{ id: 'a', titulo: 'Gerente' }] } };
const aceitaLista = json => { if (!Array.isArray(json.itens)) throw new Error('faltou itens'); };

test('modo fake devolve o que a função do teste devolve', async t => {
  const dataRoot = await tempDir(t);
  const runner = createRunner({ modo: 'fake', dataRoot, fake: ({ entrada }) => ({ itens: entrada.vagas.map(v => v.id) }) });
  const { json } = await runner.run({ ...base, validar: aceitaLista });
  assert.deepEqual(json, { itens: ['a'] });
});

test('modo replay acha a gravação pelo hash da entrada; sem gravação, pede npm run record', async t => {
  const dataRoot = await tempDir(t);
  const replayDir = await tempDir(t);
  const hash = entradaHash(base);
  await writeFile(path.join(replayDir, `triador-${hash.slice(0, 16)}.json`), JSON.stringify({ hash, agente: 'triador', modelo: 'haiku', versaoPrompt: 'v1', saida: '```json\n{"itens":["a"]}\n```', uso: { tokens_in: 10, tokens_out: 5 } }));
  const runner = createRunner({ modo: 'replay', dataRoot, replayDir });
  const { json, uso } = await runner.run({ ...base, validar: aceitaLista });
  assert.deepEqual(json, { itens: ['a'] });
  assert.equal(uso.tokens_out, 5);
  await assert.rejects(runner.run({ ...base, entrada: { vagas: [] }, validar: aceitaLista }), /npm run record/);
});

test('mudar a versão do prompt invalida o hash', () => {
  assert.notEqual(entradaHash(base), entradaHash({ ...base, versaoPrompt: 'v2' }));
  assert.notEqual(entradaHash(base), entradaHash({ ...base, modelo: 'sonnet' }));
  assert.equal(entradaHash(base), entradaHash({ ...base, entrada: { vagas: [{ titulo: 'Gerente', id: 'a' }] } }), 'ordem de chaves não muda o hash');
});

test('toda chamada acrescenta um evento llm.uso com modelo, agente, tokens e hash', async t => {
  const dataRoot = await tempDir(t);
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => ({ itens: [], _uso: { tokens_in: 120, tokens_out: 30 } }) });
  await runner.run({ ...base, validar: aceitaLista });
  await runner.run({ ...base, validar: aceitaLista });
  const { eventos } = await readEvents(dataRoot);
  const usos = eventos.filter(e => e.tipo === 'llm.uso');
  assert.equal(usos.length, 2);
  assert.deepEqual({ ...usos[0].dados, hash: undefined }, { modelo: 'haiku', agente: 'triador', tokens_in: 120, tokens_out: 30, modo: 'fake', hash: undefined, versaoPrompt: 'v1', tentativa: 1 });
  assert.equal(usos[0].dados.hash, entradaHash(base));
});

test('o modo live recusa rodar dentro da CI', async t => {
  const dataRoot = await tempDir(t);
  const runner = createRunner({ modo: 'live', dataRoot, env: { CI: 'true' } });
  await assert.rejects(runner.run({ ...base, validar: aceitaLista }), /CI/);
  const semFlag = createRunner({ modo: 'live', dataRoot, env: {} });
  await assert.rejects(semFlag.run({ ...base, validar: aceitaLista }), /LIVE=1/);
});

test('saída inválida: no máximo uma nova tentativa e erro tipado', async t => {
  const dataRoot = await tempDir(t);
  let chamadas = 0;
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => { chamadas += 1; return '{"itens": [1, 2'; } });
  await assert.rejects(runner.run({ ...base, validar: aceitaLista }), error => error instanceof LlmSaidaInvalida && /JSON/.test(error.message));
  assert.equal(chamadas, 2);
  chamadas = 0;
  const depois = createRunner({ modo: 'fake', dataRoot, fake: ({ tentativa }) => { chamadas += 1; return tentativa === 1 ? { semItens: true } : { itens: ['ok'] }; } });
  const { json } = await depois.run({ ...base, validar: aceitaLista });
  assert.deepEqual(json.itens, ['ok']);
  assert.equal(chamadas, 2);
});

test('a entrada passa por redact: nenhum valor da identidade chega ao prompt', async t => {
  const dataRoot = await tempDir(t);
  let visto;
  const runner = createRunner({ modo: 'fake', dataRoot, identity: ['Fulana Exemplo', 'fulana@exemplo.test'], fake: ({ entrada }) => { visto = JSON.stringify(entrada); return { itens: [] }; } });
  await runner.run({ ...base, entrada: { texto: 'Contato: Fulana Exemplo <fulana@exemplo.test>, fulana exemplo.' }, validar: aceitaLista });
  assert.ok(!/fulana/i.test(visto), visto);
  assert.match(visto, /REDIGIDO/);
});

test('redact cobre e-mail e telefone mesmo sem identidade configurada', () => {
  const { valor } = redact({ a: 'fale com alguem@exemplo.test ou ' + ['(11)', '9' + '1234-5678'].join(' ') }, []);
  assert.ok(!/alguem|91234/.test(JSON.stringify(valor)));
});

test('stripFence e parseEnvelope tratam a saída do claude -p', () => {
  assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFence('{"a":1}'), '{"a":1}');
  const env = parseEnvelope(JSON.stringify({ type: 'result', is_error: false, result: '{"a":1}', usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }, total_cost_usd: 0.004 }));
  assert.equal(env.texto, '{"a":1}');
  assert.deepEqual(env.uso, { tokens_in: 5, tokens_out: 7, tokens_cache_leitura: 100, tokens_cache_criacao: 20, custo_usd: 0.004 });
  assert.throws(() => parseEnvelope(JSON.stringify({ type: 'result', is_error: true, result: 'falhou' })), /falhou/);
});

test('o comando live não libera ferramenta alguma e não persiste sessão', () => {
  const args = buildLiveArgs({ modelo: 'haiku', sistema: 'instrução' });
  const i = args.indexOf('--tools');
  assert.ok(i >= 0 && args[i + 1] === '', '--tools "" desliga todas as ferramentas');
  for (const flag of ['--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config']) assert.ok(args.includes(flag), flag);
  assert.ok(args.includes('-p') && args.includes('--model') && args.includes('haiku'));
  assert.ok(!args.some(a => /Bash|Write|Edit|WebFetch/.test(a)));
  void mkdir;
});

test('redact preserva ids numéricos longos de vagas', () => {
  const { valor } = redact({ id: '4400000001', req: '7000002', fone: 'ligue ' + ['(11)', '9' + '1234-5678'].join(' ') }, []);
  assert.equal(valor.id, '4400000001');
  assert.equal(valor.req, '7000002');
  assert.match(valor.fone, /REDIGIDO/);
});

test('o modo live só roda com o opt-in dedicado (LIVE=1 genérico não basta) e nunca na CI, mesmo com o opt-in', async t => {
  const dataRoot = await tempDir(t);
  const genericoApenas = createRunner({ modo: 'live', dataRoot, env: { LIVE: '1' } });
  await assert.rejects(genericoApenas.run({ ...base, validar: aceitaLista }), /CAREER_BOUNTY_LIVE=1/);
  const naCi = createRunner({ modo: 'live', dataRoot, env: { CAREER_BOUNTY_LIVE: '1', CI: 'true' } });
  await assert.rejects(naCi.run({ ...base, validar: aceitaLista }), /CI/);
  const vazio = createRunner({ modo: 'live', dataRoot, env: { CAREER_BOUNTY_LIVE: '0' } });
  await assert.rejects(vazio.run({ ...base, validar: aceitaLista }), /CAREER_BOUNTY_LIVE=1/);
});
