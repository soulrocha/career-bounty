import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { shouldRun } from '../../core/schedule/shouldRun.mjs';
import { dailyRun, readState } from '../../core/schedule/dailyRun.mjs';
import { buildTaskXml } from '../../core/schedule/taskXml.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { buildDigest } from '../../core/score/digest.mjs';
import { validateSettings } from '../../core/config.mjs';

// Horários em São Paulo (UTC-3): 21:00Z = 18:00.
const quando = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`);
const config = { feriados: ['2026-10-12'], host_agendador: 'pc-casa' };
const decide = (now, ultima = null, extra = {}) => shouldRun({ now, ultima, config: { ...config, ...extra.config }, host: extra.host ?? 'pc-casa' });

test('dia útil, 18:00 ou depois, sem execução no dia: roda', () => {
  assert.equal(decide(quando('2026-10-14', '18:00')).run, true);
  assert.equal(decide(quando('2026-10-14', '23:00')).run, true, 'máquina ligada às 23h ainda roda');
});

test('antes das 18:00 não roda e não consome o dia', () => {
  const cedo = decide(quando('2026-10-14', '17:00'));
  assert.equal(cedo.run, false);
  assert.equal(cedo.motivo, 'antes_do_horario');
  assert.equal(decide(quando('2026-10-14', '18:00'), null).run, true, 'sem marcador gravado, às 18:00 roda');
});

test('segunda execução no mesmo dia não roda quando já concluída', () => {
  const ultima = { dia: '2026-10-14', estado: 'concluida' };
  assert.deepEqual([decide(quando('2026-10-14', '19:30'), ultima).run, decide(quando('2026-10-14', '19:30'), ultima).motivo], [false, 'ja_rodou_hoje']);
});

test('sábado, domingo e feriado listado não rodam', () => {
  assert.equal(decide(quando('2026-10-17', '20:00')).motivo, 'fim_de_semana');
  assert.equal(decide(quando('2026-10-18', '20:00')).motivo, 'fim_de_semana');
  assert.equal(decide(quando('2026-10-12', '20:00')).motivo, 'feriado');
});

test('00:30 do dia seguinte é outro dia, antes das 18h: não roda e o dia perdido não é recuperado', () => {
  const r = decide(quando('2026-10-15', '00:30'), { dia: '2026-10-13', estado: 'concluida' });
  assert.equal(r.run, false);
  assert.equal(r.motivo, 'antes_do_horario');
});

test('execução iniciada e nunca concluída permite uma retomada no mesmo dia; concluída bloqueia', () => {
  const caiu = { dia: '2026-10-14', estado: 'iniciada', retomadas: 0 };
  const r = decide(quando('2026-10-14', '21:00'), caiu);
  assert.deepEqual([r.run, r.retomada], [true, true]);
  assert.equal(decide(quando('2026-10-14', '22:00'), { ...caiu, retomadas: 1 }).run, false);
  assert.equal(decide(quando('2026-10-14', '22:00'), { dia: '2026-10-14', estado: 'concluida' }).run, false);
});

test('host diferente de host_agendador sai sem fazer nada', () => {
  const r = decide(quando('2026-10-14', '20:00'), null, { host: 'outro-pc' });
  assert.deepEqual([r.run, r.motivo], [false, 'outro_host']);
  assert.equal(shouldRun({ now: quando('2026-10-14', '20:00'), ultima: null, config: { feriados: [] }, host: 'qualquer' }).run, true, 'sem host_agendador configurado, qualquer host roda');
});

test('dailyRun: estágios em sequência, marcador concluída e evento de rodada', async t => {
  const dataRoot = await tempDir(t);
  const chamadas = [];
  const r = await dailyRun({ dataRoot, config, host: 'pc-casa', now: quando('2026-10-14', '18:05'),
    estagio1: async () => { chamadas.push(1); return { fontes: [{ id: 'gupy', estado: 'ok', vagas: 2 }], novas_ids: ['a'] }; },
    estagio2: async () => { chamadas.push(2); return { avaliadas_ids: ['a'], falhas: [] }; } });
  assert.deepEqual(chamadas, [1, 2]);
  assert.equal(r.executou, true);
  assert.equal((await readState(dataRoot)).estado, 'concluida');
  const rodada = (await readEvents(dataRoot)).eventos.find(e => e.tipo === 'radar.rodada');
  assert.deepEqual(rodada.dados.novas_ids, ['a']);
  const segunda = await dailyRun({ dataRoot, config, host: 'pc-casa', now: quando('2026-10-14', '19:00'), estagio1: async () => assert.fail('não deveria rodar'), estagio2: async () => assert.fail('não deveria rodar') });
  assert.equal(segunda.executou, false);
  assert.equal(segunda.motivo, 'ja_rodou_hoje');
});

test('estágio 1 falha: o estágio 2 não roda e o digest diz por quê', async t => {
  const dataRoot = await tempDir(t);
  let rodou2 = false;
  const r = await dailyRun({ dataRoot, config, host: 'pc-casa', now: quando('2026-10-14', '18:05'),
    estagio1: async () => { throw new Error('sem rede'); }, estagio2: async () => { rodou2 = true; return {}; } });
  assert.equal(rodou2, false);
  assert.equal(r.falha.estagio, 1);
  const rodada = (await readEvents(dataRoot)).eventos.find(e => e.tipo === 'radar.rodada').dados;
  assert.match(buildDigest({ rodada, projecao: [], historico: [] }).texto, /interrompida no estágio 1.*sem rede/s);
  assert.equal((await readState(dataRoot)).estado, 'iniciada', 'permite uma retomada');
});

test('--dry-run decide e informa sem escrever nada', async t => {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ radar: { agenda: { feriados: [], host_agendador: 'pc-casa' } } }));
  const r = run(['daily-run', '--dry-run', '--json', '--now', quando('2026-10-14', '18:30').toISOString(), '--host', 'pc-casa'], { dataRoot });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual([r.json.executaria, r.json.dry_run], [true, true]);
  assert.equal((await readState(dataRoot)), null);
  const outro = run(['daily-run', '--dry-run', '--json', '--now', quando('2026-10-14', '18:30').toISOString(), '--host', 'outro'], { dataRoot });
  assert.equal(outro.status, 0);
  assert.equal(outro.json.executaria, false);
});

test('a configuração valida a agenda', () => {
  const ok = validateSettings({ radar: { agenda: { feriados: ['2026-12-25'], host_agendador: 'pc-casa', hora_inicio: 18 } } });
  assert.equal(ok.radar.agenda.host_agendador, 'pc-casa');
  assert.throws(() => validateSettings({ radar: { agenda: { feriados: ['25/12'] } } }), /feriados/);
  assert.throws(() => validateSettings({ radar: { agenda: { hora_inicio: 30 } } }), /hora_inicio/);
});

// ---- XML da tarefa agendada ----

function bemFormado(xml) {
  const pilha = [];
  for (const [, fecha, nome, auto] of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z][\w:]*)[^>]*?(\/?)>/g)) {
    if (auto) continue;
    if (fecha) { if (pilha.pop() !== nome) return false; } else pilha.push(nome);
  }
  return pilha.length === 0;
}

test('schedule install --dry-run: XML com logon + semanal às 18h, início perdido, rede, atraso de 2 min e sem credencial', () => {
  const xml = buildTaskXml({ node: 'C:\\Programas\\node\\node.exe', script: 'C:\\Codigo\\bin\\career-bounty.mjs', nome: 'CareerBounty radar diario' });
  assert.ok(bemFormado(xml), 'XML bem formado');
  assert.match(xml, /<LogonTrigger>[\s\S]*<Delay>PT2M<\/Delay>[\s\S]*<\/LogonTrigger>/);
  assert.match(xml, /<CalendarTrigger>[\s\S]*T18:00:00[\s\S]*<ScheduleByWeek>[\s\S]*<Monday \/>[\s\S]*<Friday \/>[\s\S]*<\/ScheduleByWeek>/);
  assert.ok(!/<Saturday|<Sunday/.test(xml));
  assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(xml, /<RunOnlyIfNetworkAvailable>true<\/RunOnlyIfNetworkAvailable>/);
  assert.match(xml, /<Command>C:\\Programas\\node\\node\.exe<\/Command>/);
  assert.match(xml, /<Arguments>"C:\\Codigo\\bin\\career-bounty\.mjs" daily-run<\/Arguments>/);
  assert.ok(!/Password|<UserId>|secret|api[-_ ]?key/i.test(xml));
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
});

test('o XML escapa caracteres especiais dos caminhos', () => {
  const xml = buildTaskXml({ node: 'C:\\A & B\\node.exe', script: 'C:\\x<y>\\cli.mjs', nome: 'n' });
  assert.ok(bemFormado(xml));
  assert.match(xml, /A &amp; B/);
});

test('schedule install --dry-run pela CLI imprime o XML e não instala', async t => {
  const dataRoot = await tempDir(t);
  const r = run(['schedule', 'install', '--dry-run', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.json.xml, /LogonTrigger/);
  assert.equal(r.json.instalado, false);
  const semFlag = run(['schedule', 'install', '--json'], { dataRoot });
  assert.equal(semFlag.status, 2, 'instalação real exige --confirmo-instalar');
  void readFile;
});
