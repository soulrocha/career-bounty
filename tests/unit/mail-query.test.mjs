import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { defaultSettings, loadSettings, validateSettings } from '../../core/config.mjs';
import { buildQuery } from '../../core/mail/query.mjs';
import { avisoDeLimite, confirmarCursor, filtrarNovos, lerCursor } from '../../core/mail/cursor.mjs';

const AGORA = new Date('2026-10-14T15:00:00-03:00');
const mail = (extra = {}) => ({ ...defaultSettings().mail, portais_extras: ['vagas.portal-ficticio.test'], termos: ['processo seletivo', 'sua candidatura'], ...extra });
const semCursor = { ate: null, vistos: new Set(), avisos: [] };

test('a consulta usa só remetentes de portais, termos do config e o after do cursor com 1 dia de sobreposição', () => {
  const q = buildQuery({ mail: mail(), cursor: { ...semCursor, ate: '2026-10-12' }, now: AGORA });
  assert.equal(q.after, '2026/10/11');
  assert.match(q.query, /after:2026\/10\/11$/);
  assert.match(q.query, /from:\(.*gupy\.com\.br.*inhire\.app.*vagas\.portal-ficticio\.test.*\)/);
  assert.match(q.query, /subject:\("processo seletivo" OR "sua candidatura"\)/);
  assert.equal(buildQuery({ mail: mail({ so_portais: true }), cursor: semCursor, now: AGORA }).query.includes('subject:'), false);
});

test('sem cursor a janela é de 7 dias (configurável) contados no dia de São Paulo', () => {
  assert.equal(buildQuery({ mail: mail(), cursor: semCursor, now: AGORA }).after, '2026/10/07');
  assert.equal(buildQuery({ mail: mail({ janela_dias: 14 }), cursor: semCursor, now: AGORA }).after, '2026/09/30');
});

test('cursor futuro ou corrompido volta aos 7 dias com aviso', async t => {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'mail-ruim.json'), '{');
  for (const conteudo of ['{ nao-json', JSON.stringify({ ate: '2026-12-31', vistos: {} }), JSON.stringify({ ate: 'ontem' }), JSON.stringify([])]) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(dataRoot, 'state'), { recursive: true });
    await writeFile(path.join(dataRoot, 'state', 'mail-cursor.json'), conteudo);
    const cursor = await lerCursor(dataRoot, { now: AGORA });
    assert.equal(cursor.ate, null);
    assert.match(cursor.avisos[0], /cursor/i);
    assert.equal(buildQuery({ mail: mail(), cursor, now: AGORA }).after, '2026/10/07');
  }
});

test('o cursor só avança ao confirmar (duas fases) e falha antes disso o mantém', async t => {
  const dataRoot = await tempDir(t);
  assert.equal((await lerCursor(dataRoot, { now: AGORA })).ate, null);
  const itens = [{ message_id: 'a1', data: '2026-10-13' }, { message_id: 'a2', data: '2026-10-14' }];
  // fase 1: processamento falha, nada é confirmado
  assert.equal((await lerCursor(dataRoot, { now: AGORA })).ate, null);
  await confirmarCursor(dataRoot, { itens, now: AGORA });
  const depois = await lerCursor(dataRoot, { now: AGORA });
  assert.equal(depois.ate, '2026-10-14');
  assert.deepEqual([...depois.vistos].sort(), ['a1', 'a2']);
});

test('a sobreposição de 1 dia é deduplicada por message_id e ids antigos saem da memória', async t => {
  const dataRoot = await tempDir(t);
  await confirmarCursor(dataRoot, { itens: [{ message_id: 'velho', data: '2026-08-01' }, { message_id: 'a1', data: '2026-10-13' }], now: new Date('2026-10-13T12:00:00-03:00') });
  const cursor = await lerCursor(dataRoot, { now: AGORA });
  const { novos, repetidos } = filtrarNovos([{ message_id: 'a1' }, { message_id: 'a3' }], cursor.vistos);
  assert.deepEqual(novos.map(i => i.message_id), ['a3']);
  assert.equal(repetidos, 1);
  await confirmarCursor(dataRoot, { itens: [{ message_id: 'a3', data: '2026-10-14' }], now: AGORA });
  const ids = [...(await lerCursor(dataRoot, { now: AGORA })).vistos];
  assert.ok(ids.includes('a1') && ids.includes('a3'));
  assert.ok(!ids.includes('velho'), 'id com mais de 30 dias é esquecido');
});

test('a consulta nunca contém dado da identidade nem endereço de e-mail', () => {
  const sujo = mail({ nome: 'Ana Exemplo', email: 'ana@exemplo.test', perfil: { nome: 'Ana Exemplo' } });
  const { query } = buildQuery({ mail: sujo, cursor: semCursor, now: AGORA });
  for (const proibido of ['Ana', 'Exemplo Ana', 'ana@', 'perfil']) assert.ok(!query.includes(proibido), proibido);
  assert.ok(!query.includes('@'));
});

test('o limite de resultados por rodada avisa quando estoura', () => {
  assert.equal(avisoDeLimite({ itens: 49, limite: 50 }), null);
  assert.match(avisoDeLimite({ itens: 50, limite: 50 }), /limite de 50.*pode haver mais/i);
});

test('config.mail: padrões seguros, validação e rejeição de domínio com caminho', async t => {
  const padrao = defaultSettings().mail;
  assert.equal(padrao.ativo, false);
  assert.equal(padrao.janela_dias, 7);
  assert.ok(padrao.limite_fase_b >= 1 && padrao.limite_resultados >= 1);
  assert.throws(() => validateSettings({ mail: { portais_extras: ['https://x.test/vaga'] } }), /mail\.portais_extras/);
  assert.throws(() => validateSettings({ mail: { janela_dias: 0 } }), /mail\.janela_dias/);
  assert.throws(() => validateSettings({ mail: { limite_fase_b: -1 } }), /mail\.limite_fase_b/);
  assert.throws(() => validateSettings({ mail: { termos: 'x' } }), /mail\.termos/);
  assert.throws(() => validateSettings({ mail: { orcamento_tokens: 'muito' } }), /mail\.orcamento_tokens/);
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ mail: { ativo: true, dominios_confiaveis: ['rh.empresa-alfa.test'] } }));
  const s = await loadSettings({ dataRoot });
  assert.equal(s.mail.ativo, true);
  assert.deepEqual(s.mail.dominios_confiaveis, ['rh.empresa-alfa.test']);
});

test('CLI mail query --json monta a consulta sem chamar o Gmail', async t => {
  const dataRoot = await tempDir(t);
  const r = run(['mail', 'query', '--now', '2026-10-14T15:00:00-03:00', '--teste', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.after, '2026/10/07');
  assert.match(r.json.query, /from:\(/);
  assert.equal(r.json.limite, 50);
  assert.equal(run(['mail', 'query', '--now', 'lixo', '--teste', '--json'], { dataRoot }).status, 2);
  assert.equal(run(['mail', 'query', '--now', '2026-10-14T15:00:00-03:00', '--json'], { dataRoot }).status, 2, '--now sem --teste');
  assert.equal(run(['mail', 'inexistente', '--json'], { dataRoot }).status, 2);
});
