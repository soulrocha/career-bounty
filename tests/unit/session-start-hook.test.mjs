import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { registrarRodada } from '../../core/score/digest.mjs';
import { appendEvents } from '../../core/store/events.mjs';
import { descobertaEvent } from '../../core/radar/collect.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';
import { validatePlugin } from '../../core/plugin/validate.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const hook = path.join(repo, 'hooks', 'session-start.mjs');
const quando = (dia, hora) => `${dia}T${hora}:00-03:00`;

function rodarHook(dataRoot, agora, extraEnv = {}) {
  const env = { ...process.env, DATA_ROOT: dataRoot, CAREER_BOUNTY_NOW: agora, ...extraEnv };
  delete env.IDENTITY_FILE;
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8', env });
  return { status: r.status, stderr: r.stderr, json: JSON.parse(r.stdout) };
}

async function ambiente(t, { talvez = 2, perguntas = 3, altas = 1 } = {}) {
  const dataRoot = await tempDir(t);
  const ts = '2026-10-14T21:00:00.000Z';
  const vagas = [];
  for (let i = 1; i <= talvez + altas; i++) {
    const v = makeVaga({ fonte: 'x', portal: 'gupy', requisicao_id: String(300 + i), empresa: 'Empresa Alfa', cargo: `Cargo ${i}`, url: `https://empresa-alfa.gupy.io/jobs/${300 + i}`, descricao: 'texto' });
    vagas.push(descobertaEvent(v, `v${i}`, ts, [{ fonte: 'x', url: v.url }]));
  }
  await appendEvents(dataRoot, vagas, { now: ts });
  const triadas = Array.from({ length: talvez }, (_, i) => ({ id: `t${i}`, ts, ator: 'radar', tipo: 'vaga.triada', entidade: 'vaga', entidade_id: `v${i + 1}`, dados: { decisao: 'talvez', motivo: 'x', descricao_hash: 'h', versaoPrompt: 'p' } }));
  await appendEvents(dataRoot, triadas, { now: ts });
  await registrarRodada(dataRoot, { fontes: [{ id: 'gupy', estado: 'ok' }], novas_ids: vagas.map(e => e.entidade_id), avaliadas_ids: [], perguntas_pendentes: perguntas }, new Date(ts));
  void altas;
  return dataRoot;
}

test('com perguntas abertas, talvez e prazos o hook devolve um resumo curto com contagens', async t => {
  const dataRoot = await ambiente(t);
  const r = rodarHook(dataRoot, quando('2026-10-15', '09:00'));
  assert.equal(r.status, 0, r.stderr);
  const texto = r.json.hookSpecificOutput.additionalContext;
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(texto.length <= 1200, `${texto.length} caracteres (~${Math.ceil(texto.length / 4)} tokens)`);
  assert.match(texto, /3 perguntas pendentes/);
  assert.match(texto, /2 vagas em "talvez"/);
});

test('nada pendente devolve {}', async t => {
  const dataRoot = await tempDir(t);
  const r = rodarHook(dataRoot, quando('2026-10-15', '09:00'));
  assert.deepEqual(r.json, {});
});

test('o resumo não traz URL nem dado da identidade', async t => {
  const dataRoot = await ambiente(t);
  const r = rodarHook(dataRoot, quando('2026-10-15', '09:00'));
  const texto = JSON.stringify(r.json);
  assert.ok(!/https?:|@|\\Users|\/home\//.test(texto), texto);
});

test('estado ilegível devolve {} e avisa no stderr, sem falhar a sessão', async t => {
  const dataRoot = await tempDir(t);
  await mkdir(path.join(dataRoot, 'events', '2026', '10'), { recursive: true });
  await writeFile(path.join(dataRoot, 'config.yml'), '{ isto nao e json');
  const r = rodarHook(dataRoot, quando('2026-10-15', '09:00'));
  assert.equal(r.status, 0);
  assert.deepEqual(r.json, {});
  assert.match(r.stderr, /career-bounty/);
});

test('inclui "rotina de hoje" a partir do marcador da F2.18', async t => {
  const dataRoot = await ambiente(t);
  await mkdir(path.join(dataRoot, 'state'), { recursive: true });
  await writeFile(path.join(dataRoot, 'state', 'daily-run.json'), JSON.stringify({ dia: '2026-10-15', estado: 'concluida' }));
  assert.match(rodarHook(dataRoot, quando('2026-10-15', '22:00')).json.hookSpecificOutput.additionalContext, /rotina de hoje: rodou/i);
  await writeFile(path.join(dataRoot, 'state', 'daily-run.json'), JSON.stringify({ dia: '2026-10-14', estado: 'concluida' }));
  assert.match(rodarHook(dataRoot, quando('2026-10-15', '22:00')).json.hookSpecificOutput.additionalContext, /rotina de hoje: não rodou/i);
});

test('dia útil depois das 18h sem rotina é pendência por si só; fim de semana não', async t => {
  const dataRoot = await tempDir(t);
  assert.match(rodarHook(dataRoot, quando('2026-10-15', '22:00')).json.hookSpecificOutput.additionalContext, /não rodou/);
  assert.deepEqual(rodarHook(dataRoot, quando('2026-10-17', '22:00')).json, {});
});

test('o hook está registrado em hooks.json e o plugin continua válido', async () => {
  const hooks = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
  assert.match(JSON.stringify(hooks.hooks.SessionStart), /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-start\.mjs/);
  assert.equal((await validatePlugin(repo)).ok, true);
});
