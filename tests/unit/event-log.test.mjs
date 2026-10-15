import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { appendEvent, appendEvents, readEvents } from '../../core/store/events.mjs';

const base = (id, extra = {}) => ({ id, ator: 'teste', tipo: 'nota.registrada', entidade: 'nota', entidade_id: 'n1', dados: { texto: id }, evidencia: [], ...extra });

test('appendEvent cria events/AAAA/MM/DD.<host>.jsonl com uma linha JSON', async t => {
  const dataRoot = await tempDir(t);
  await appendEvent(dataRoot, base('e1'), { host: 'pc-a', now: '2026-10-14T15:00:00.000Z' });
  const file = path.join(dataRoot, 'events/2026/10/14.pc-a.jsonl');
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.id, 'e1');
  assert.equal(event.host, 'pc-a');
  assert.equal(event.ts, '2026-10-14T15:00:00.000Z');
  assert.equal(event.seq, 1);
});

test('o mesmo id gravado duas vezes não duplica', async t => {
  const dataRoot = await tempDir(t);
  const opts = { host: 'pc-a', now: '2026-10-14T15:00:00.000Z' };
  assert.equal((await appendEvent(dataRoot, base('e1'), opts)).appended, true);
  assert.equal((await appendEvent(dataRoot, base('e1'), opts)).appended, false);
  assert.equal((await readEvents(dataRoot)).eventos.length, 1);
});

test('readEvents devolve em ordem (ts, host, seq), não na ordem de gravação', async t => {
  const dataRoot = await tempDir(t);
  await appendEvent(dataRoot, base('tarde'), { host: 'pc-a', now: '2026-10-14T18:00:00Z' });
  await appendEvent(dataRoot, base('cedo'), { host: 'pc-a', now: '2026-10-14T12:00:00.000Z' });
  await appendEvents(dataRoot, [base('b1'), base('b2')], { host: 'pc-a', now: '2026-10-14T13:00:00.000Z' });
  const { eventos, avisos } = await readEvents(dataRoot);
  assert.deepEqual(eventos.map(e => e.id), ['cedo', 'b1', 'b2', 'tarde']);
  assert.deepEqual(avisos, []);
});

test('linha truncada no meio do arquivo vira aviso e o resto é lido', async t => {
  const dataRoot = await tempDir(t);
  await appendEvent(dataRoot, base('e1'), { host: 'pc-a', now: '2026-10-14T12:00:00.000Z' });
  const file = path.join(dataRoot, 'events/2026/10/14.pc-a.jsonl');
  const original = await readFile(file, 'utf8');
  await writeFile(file, `${original}{"id":"quebrada","ts":\n${original.replace('"e1"', '"e2"').replace('"seq":1', '"seq":2')}`);
  const { eventos, avisos } = await readEvents(dataRoot);
  assert.deepEqual(eventos.map(e => e.id), ['e1', 'e2']);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /14\.pc-a\.jsonl:2/);
});

test('cauda sem quebra de linha (gravação interrompida) é avisada e a próxima gravação não a cola', async t => {
  const dataRoot = await tempDir(t);
  await appendEvent(dataRoot, base('e1'), { host: 'pc-a', now: '2026-10-14T12:00:00.000Z' });
  const file = path.join(dataRoot, 'events/2026/10/14.pc-a.jsonl');
  await writeFile(file, `${await readFile(file, 'utf8')}{"id":"parcial"`);
  assert.equal((await readEvents(dataRoot)).avisos.length, 1);
  await appendEvent(dataRoot, base('e2'), { host: 'pc-a', now: '2026-10-14T13:00:00.000Z' });
  const { eventos, avisos } = await readEvents(dataRoot);
  assert.deepEqual(eventos.map(e => e.id), ['e1', 'e2']);
  assert.equal(avisos.length, 1);
});

test('dois hosts no mesmo dia gravam dois arquivos e a leitura intercala de forma estável', async t => {
  const dataRoot = await tempDir(t);
  const now = '2026-10-14T12:00:00.000Z';
  await appendEvent(dataRoot, base('b1'), { host: 'pc-b', now });
  await appendEvent(dataRoot, base('a1'), { host: 'pc-a', now });
  await appendEvent(dataRoot, base('a2'), { host: 'pc-a', now });
  assert.deepEqual((await readdir(path.join(dataRoot, 'events/2026/10'))).sort(), ['14.pc-a.jsonl', '14.pc-b.jsonl']);
  const first = (await readEvents(dataRoot)).eventos.map(e => e.id);
  assert.deepEqual(first, ['a1', 'a2', 'b1']);
  assert.deepEqual((await readEvents(dataRoot)).eventos.map(e => e.id), first);
});

test('a virada de dia respeita America/Sao_Paulo', async t => {
  const dataRoot = await tempDir(t);
  await appendEvent(dataRoot, base('antes'), { host: 'pc-a', now: '2026-10-15T02:59:00.000Z' });
  await appendEvent(dataRoot, base('depois'), { host: 'pc-a', now: '2026-10-15T03:00:00.000Z' });
  assert.deepEqual((await readdir(path.join(dataRoot, 'events/2026/10'))).sort(), ['14.pc-a.jsonl', '15.pc-a.jsonl']);
});

test('evento sem campo obrigatório ou com host inválido é recusado sem gravar', async t => {
  const dataRoot = await tempDir(t);
  for (const campo of ['id', 'ator', 'tipo', 'entidade', 'entidade_id', 'dados']) {
    const evento = base('x');
    delete evento[campo];
    await assert.rejects(appendEvent(dataRoot, evento, { host: 'pc-a' }), new RegExp(campo), campo);
  }
  await assert.rejects(appendEvent(dataRoot, base('x'), { host: '../fora' }), /host/i);
  await assert.rejects(readdir(path.join(dataRoot, 'events')), { code: 'ENOENT' });
});

test('o mesmo id vindo de dois hosts conta uma vez na leitura', async t => {
  const dataRoot = await tempDir(t);
  await appendEvent(dataRoot, base('dup'), { host: 'pc-a', now: '2026-10-14T12:00:00.000Z' });
  await appendEvent(dataRoot, base('dup'), { host: 'pc-b', now: '2026-10-14T12:00:01.000Z' });
  assert.equal((await readEvents(dataRoot)).eventos.length, 1);
});
