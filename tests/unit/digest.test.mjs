import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { buildDigest, contarRodadasSemAltas, registrarRodada } from '../../core/score/digest.mjs';
import { readEvents } from '../../core/store/events.mjs';

const ok = id => ({ id, estado: 'ok', vagas: 3 });
const vaga = (id, aderencia, extra = {}) => ({ id, cargo: `Cargo ${id}`, empresa: 'Empresa Alfa', aderencia, url: `https://empresa-alfa.gupy.io/jobs/${id}?token=segredo&utm=x`, ...extra });
const rodada = (extra = {}) => ({ ts: '2026-10-15T21:00:00.000Z', fontes: [ok('gupy')], novas_ids: [], avaliadas_ids: [], ...extra });

test('rodada sem novidade gera uma linha só', () => {
  const d = buildDigest({ rodada: rodada(), projecao: [], historico: [] });
  assert.equal(d.vazio, true);
  assert.match(d.texto, /Sem novidades/);
  assert.equal(d.texto.trim().split('\n').filter(Boolean).length, 2, 'título e uma linha');
});

test('novas altas e médias, prazos e decisões pendentes aparecem; o resto não', () => {
  const projecao = [vaga('a1', 'alta'), vaga('m1', 'media'), vaga('b1', 'baixa'), vaga('t1', 'pendente', { triagem: { decisao: 'talvez' } }), vaga('t2', 'pendente', { triagem: { decisao: 'talvez' } })];
  const d = buildDigest({ rodada: rodada({ novas_ids: ['a1', 'm1', 'b1', 't1', 't2'], avaliadas_ids: ['a1', 'm1', 'b1'], mudancas_prazo: [{ id: 'a1', prazo: '2026-10-30' }], perguntas_pendentes: 2 }), projecao, historico: [] });
  assert.match(d.texto, /Cargo a1/);
  assert.match(d.texto, /Cargo m1/);
  assert.ok(!d.texto.includes('Cargo b1'), 'baixa não aparece');
  assert.match(d.texto, /2026-10-30/);
  assert.match(d.texto, /2 vagas em "talvez"/);
  assert.match(d.texto, /2 perguntas pendentes/);
  assert.equal(d.vazio, false);
});

test('fontes com erro viram "não conferidas", nunca "sem vagas"', () => {
  const d = buildDigest({ rodada: rodada({ fontes: [ok('gupy'), { id: 'freehire', estado: 'erro', erro: 'HTTP 503' }, { id: 'jobspy', estado: 'indisponivel' }] }), projecao: [], historico: [] });
  assert.match(d.texto, /não conferidas?/i);
  assert.match(d.texto, /freehire/);
  assert.match(d.texto, /jobspy/);
  assert.ok(!/sem vagas/i.test(d.texto));
  assert.match(d.texto, /Sem novidades nas fontes conferidas/);
});

test('o contador de rodadas sem novas altas não avança por falha de fonte', () => {
  const semAltas = (extra = {}) => rodada({ ...extra });
  const historico = [semAltas(), semAltas({ fontes: [{ id: 'gupy', estado: 'erro', erro: 'x' }] }), semAltas()];
  assert.equal(contarRodadasSemAltas(historico, []), 2, 'a rodada com falha é ignorada');
  const comAlta = rodada({ novas_ids: ['a1'], avaliadas_ids: ['a1'] });
  assert.equal(contarRodadasSemAltas([semAltas(), comAlta, semAltas()], [vaga('a1', 'alta')]), 1, 'uma nova alta zera a contagem');
});

test('o Markdown não carrega querystring nem URL local', () => {
  const projecao = [vaga('a1', 'alta'), vaga('a2', 'alta', { url: 'http://127.0.0.1:8880/?t=abc' })];
  const d = buildDigest({ rodada: rodada({ novas_ids: ['a1', 'a2'], avaliadas_ids: ['a1', 'a2'] }), projecao, historico: [] });
  assert.ok(!/token=|utm=|127\.0\.0\.1|localhost/.test(d.texto), d.texto);
  assert.match(d.texto, /empresa-alfa\.gupy\.io\/jobs\/a1/);
});

test('registrarRodada grava o evento e o comando digest o lê', async t => {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), '{}');
  await registrarRodada(dataRoot, rodada(), new Date('2026-10-15T21:00:00Z'));
  assert.equal((await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'radar.rodada').length, 1);
  const r = run(['digest', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.vazio, true);
  assert.match(r.json.texto, /Sem novidades/);
});

test('rodada interrompida por falha de estágio conta como falha: não avança o contador de rodadas sem altas', () => {
  const sem = ts => ({ ts, fontes: [{ id: 'gupy', estado: 'ok', vagas: 1 }], novas_ids: [], avaliadas_ids: [] });
  const interrompida = { ts: '2026-10-14T21:00:00.000Z', fontes: [], novas_ids: [], avaliadas_ids: [], falha: { estagio: 2, erro: 'queda' } };
  assert.equal(contarRodadasSemAltas([sem('2026-10-13T21:00:00.000Z'), interrompida, sem('2026-10-15T21:00:00.000Z')], []), 2);
  assert.equal(contarRodadasSemAltas([interrompida], []), 0);
});
