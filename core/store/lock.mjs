import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const sleep = ms => new Promise(done => setTimeout(done, ms));

// Lock criado há menos que isso com conteúdo ilegível ainda pode estar sendo escrito por quem o criou.
const GRACE_MS = 2000;
// Nenhuma operação do pipeline dura isso; passou disto, o dono é considerado perdido (PID reaproveitado, máquina reiniciada).
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;
// Consultar o sistema pelo início do processo é lento (PowerShell no Windows): só vale para lock já com alguma idade.
const VERIFY_AFTER_MS = 60 * 1000;

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

// Quando o processo começou (ms desde a época) ou null se a plataforma não permite consultar. Assíncrono: não trava o laço de eventos.
export async function processStartMs(pid) {
  if (pid === process.pid) return Date.now() - process.uptime() * 1000;
  try {
    const options = { encoding: 'utf8', timeout: 5000, windowsHide: true };
    const { stdout } = process.platform === 'win32'
      ? await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)}).StartTime.ToUniversalTime().ToString('o')`], options)
      : await exec('ps', ['-o', 'lstart=', '-p', String(Number(pid))], { ...options, env: { ...process.env, LC_ALL: 'C' } });
    const ms = Date.parse(stdout.trim());
    return Number.isFinite(ms) ? ms : null;
  } catch { return null; }
}

async function holder(lockPath) {
  let content;
  let mtimeMs = Date.now();
  try {
    content = await readFile(lockPath, 'utf8');
    mtimeMs = (await stat(lockPath)).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { content: null, pid: null, desdeMs: null, mtimeMs, readable: false };
  }
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { /* conteúdo ilegível */ }
  const pid = Number.isInteger(parsed?.pid) && parsed.pid > 0 ? parsed.pid : null;
  const desde = typeof parsed?.desde === 'string' ? Date.parse(parsed.desde) : NaN;
  return { content, pid, desdeMs: Number.isFinite(desde) ? desde : null, mtimeMs, readable: true };
}

// O lock está abandonado? Dono morto, conteúdo ilegível além do prazo de graça, lock velho demais
// ou processo vivo que começou depois do lock (PID reaproveitado por outro programa).
function makeStale({ maxAgeMs, startTimeOf }) {
  const verdicts = new Map();
  return async current => {
    if (!current?.readable) return false;
    const age = Date.now() - (current.desdeMs ?? current.mtimeMs);
    if (current.pid === null) return Date.now() - current.mtimeMs > GRACE_MS;
    if (!alive(current.pid)) return true;
    if (age > maxAgeMs) return true;
    if (current.desdeMs === null || age < VERIFY_AFTER_MS) return false;
    // a consulta ao sistema é lenta: uma vez por lock observado
    if (!verdicts.has(current.content)) {
      const started = await startTimeOf(current.pid);
      verdicts.set(current.content, started !== null && started > current.desdeMs + 1000);
    }
    return verdicts.get(current.content);
  };
}

// Remove o lock abandonado. Quem recupera trabalha sob uma guarda própria e relê o lock antes de
// apagar: um lock liberado e retomado por outro processo nesse intervalo não é tocado.
async function reclaim(lockPath, seen, isStale) {
  const guard = `${lockPath}.recuperando`;
  let handle;
  try { handle = await open(guard, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    const info = await stat(guard).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 5000) await unlink(guard).catch(() => {});
    return;
  }
  try {
    const current = await holder(lockPath);
    if (current?.content === seen && await isStale(current)) await unlink(lockPath).catch(() => {});
  } finally {
    await handle.close();
    await unlink(guard).catch(() => {});
  }
}

// Lock de arquivo com prazo. Lock abandonado (ver makeStale) é recuperado.
export async function withLock(lockPath, { timeoutMs = 10000, busyMessage = 'Pipeline ocupado; tente novamente.', pollMs = 25, maxAgeMs = DEFAULT_MAX_AGE_MS, startTimeOf = processStartMs } = {}, action) {
  if (typeof action !== 'function') throw new TypeError('withLock exige uma função.');
  await mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  const isStale = makeStale({ maxAgeMs, startTimeOf });
  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, desde: new Date().toISOString() })); } finally { await handle.close(); }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
      const current = await holder(lockPath);
      if (current && await isStale(current)) { await reclaim(lockPath, current.content, isStale); await sleep(1); continue; }
      if (Date.now() >= deadline) throw new Error(busyMessage);
      await sleep(pollMs);
    }
  }
  try { return await action(); }
  finally {
    const current = await holder(lockPath);
    let owner = null;
    try { owner = JSON.parse(current?.content ?? '').token; } catch { /* não é nosso */ }
    if (owner === token) await unlink(lockPath).catch(() => {});
  }
}
