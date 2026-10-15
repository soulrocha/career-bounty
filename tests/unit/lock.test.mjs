import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { processStartMs, withLock } from '../../core/store/lock.mjs';
import { atomicWriteFile } from '../../core/store/atomicWrite.mjs';
import { readEvents } from '../../core/store/events.mjs';

const child = fileURLToPath(new URL('../helpers/append-child.mjs', import.meta.url));
const sleep = ms => new Promise(done => setTimeout(done, ms));

test('segunda escrita com o lock preso espera e depois grava', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  const order = [];
  let release;
  const held = withLock(lock, { timeoutMs: 2000 }, async () => { order.push('primeiro-entrou'); await new Promise(done => { release = done; }); order.push('primeiro-saiu'); });
  while (!order.length) await sleep(5);
  const second = withLock(lock, { timeoutMs: 2000 }, async () => { order.push('segundo-entrou'); });
  await sleep(150);
  assert.deepEqual(order, ['primeiro-entrou']);
  release();
  await Promise.all([held, second]);
  assert.deepEqual(order, ['primeiro-entrou', 'primeiro-saiu', 'segundo-entrou']);
});

test('lock preso além do prazo falha com a mensagem do pipeline', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  let release;
  const held = withLock(lock, { timeoutMs: 2000 }, () => new Promise(done => { release = done; }));
  while (!release) await sleep(5);
  await assert.rejects(withLock(lock, { timeoutMs: 100 }, async () => {}), /Pipeline ocupado; tente novamente\./);
  release();
  await held;
  await withLock(lock, { timeoutMs: 100 }, async () => {});
});

test('lock órfão de processo morto é recuperado', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  await writeFile(lock, JSON.stringify({ pid: Number(dead.stdout), token: 'antigo' }));
  let entered = false;
  await withLock(lock, { timeoutMs: 500 }, async () => { entered = true; });
  assert.equal(entered, true);
  await assert.rejects(readFile(lock), { code: 'ENOENT' });
});

test('lock de processo vivo não é roubado', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'vivo' }));
  await assert.rejects(withLock(lock, { timeoutMs: 100 }, async () => {}), /ocupado/);
  assert.match(await readFile(lock, 'utf8'), /vivo/);
});

test('falha no meio da escrita mantém o arquivo anterior e remove o temporário', async t => {
  const dir = await tempDir(t);
  const target = path.join(dir, 'projecao.json');
  await atomicWriteFile(target, 'versao-1');
  await assert.rejects(atomicWriteFile(target, 'versao-2', { beforeRename: () => { throw new Error('queda simulada'); } }), /queda simulada/);
  assert.equal(await readFile(target, 'utf8'), 'versao-1');
  assert.deepEqual(await readdir(dir), ['projecao.json']);
});

test('20 appendEvent concorrentes em processos filhos não perdem nenhum', async t => {
  const dataRoot = await tempDir(t);
  const runs = Array.from({ length: 20 }, (_, index) => new Promise((done, fail) => {
    const proc = spawn(process.execPath, [child, dataRoot, `e${index}`, 'pc-a'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', chunk => { err += chunk; });
    proc.once('exit', code => code === 0 ? done() : fail(new Error(`filho ${index}: ${err}`)));
  }));
  await Promise.all(runs);
  const { eventos, avisos } = await readEvents(dataRoot);
  assert.deepEqual(avisos, []);
  assert.equal(eventos.length, 20);
  assert.deepEqual(eventos.map(e => e.seq).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
});

const antigo = async (file, ageMs) => { const when = new Date(Date.now() - ageMs); await utimes(file, when, when); };

test('lock vazio ou com JSON inválido é recuperado depois de um breve prazo, nunca de imediato', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  for (const conteudo of ['', '{quebrado', 'null', '[]', '{"pid":"abc"}', '{"token":"sem-pid"}']) {
    await writeFile(lock, conteudo);
    // recém-criado: quem o criou pode estar prestes a escrever o conteúdo
    await assert.rejects(withLock(lock, { timeoutMs: 100 }, async () => {}), /ocupado/, `recente: ${conteudo}`);
    await antigo(lock, 60_000);
    let entrou = false;
    await withLock(lock, { timeoutMs: 500 }, async () => { entrou = true; });
    assert.equal(entrou, true, `antigo: ${conteudo}`);
    await assert.rejects(readFile(lock), { code: 'ENOENT' });
  }
});

test('PID reaproveitado: lock de processo vivo mas velho demais é recuperado', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  const umaHora = new Date(Date.now() - 3_600_000).toISOString();
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'velho', desde: umaHora }));
  let entrou = false;
  await withLock(lock, { timeoutMs: 500, maxAgeMs: 60_000, startTimeOf: () => null }, async () => { entrou = true; });
  assert.equal(entrou, true);
  const recente = new Date(Date.now() - 1000).toISOString();
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'novo', desde: recente }));
  await assert.rejects(withLock(lock, { timeoutMs: 100, maxAgeMs: 60_000, startTimeOf: () => null }, async () => {}), /ocupado/);
});

test('PID reaproveitado: processo vivo que começou DEPOIS do lock não é o dono', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  const desde = new Date(Date.now() - 120_000);
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'orfao', desde: desde.toISOString() }));
  const iniciouDepois = () => desde.getTime() + 60_000;
  let entrou = false;
  await withLock(lock, { timeoutMs: 500, startTimeOf: iniciouDepois }, async () => { entrou = true; });
  assert.equal(entrou, true);
  // o dono verdadeiro começou antes de gravar o lock: continua válido
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'dono', desde: desde.toISOString() }));
  await assert.rejects(withLock(lock, { timeoutMs: 100, startTimeOf: () => desde.getTime() - 5000 }, async () => {}), /ocupado/);
  assert.match(await readFile(lock, 'utf8'), /dono/);
});

test('o horário de início do processo é legível (verificação real, quando a plataforma permite)', async () => {
  const inicio = await processStartMs(process.pid);
  const filho = spawn(process.execPath, ['-e', 'setTimeout(()=>{},3000)'], { stdio: 'ignore' });
  try {
    const antes = Date.now();
    await sleep(300);
    const inicioFilho = await processStartMs(filho.pid);
    if (inicioFilho !== null) assert.ok(inicioFilho <= Date.now() && inicioFilho >= antes - 5000, 'início do filho plausível');
  } finally { filho.kill(); }
  if (inicio === null) return; // plataforma sem como consultar: cai na idade máxima
  assert.ok(Math.abs(inicio - (Date.now() - process.uptime() * 1000)) < 5000);
});

test('lock recente de processo vivo não dispara a consulta lenta ao sistema (nem trava o laço de eventos)', async t => {
  const dir = await tempDir(t);
  const lock = path.join(dir, 'pipeline.lock');
  let consultas = 0;
  const startTimeOf = () => { consultas += 1; return null; };
  let release;
  const held = withLock(lock, { timeoutMs: 2000 }, () => new Promise(done => { release = done; }));
  while (!release) await sleep(5);
  const second = withLock(lock, { timeoutMs: 2000, startTimeOf }, async () => {});
  await sleep(150);
  release();
  await Promise.all([held, second]);
  assert.equal(consultas, 0);
});
