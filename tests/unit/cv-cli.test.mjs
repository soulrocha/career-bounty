import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run } from '../helpers/cli.mjs';
import { dataRootComBase, fixturesCv, vagaAlta, vagaGupy } from '../helpers/cv.mjs';
import { encontrarNavegador } from '../../core/cv/navegador.mjs';
import { podeCandidatar } from '../../core/cv/gates.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';

const semNavegador = encontrarNavegador() ? false : 'nenhum Chrome, Chromium ou Edge instalado (CAREER_BOUNTY_BROWSER)';

async function ambiente(t) {
  const dataRoot = await dataRootComBase(t);
  await mkdir(path.join(dataRoot, 'cv'), { recursive: true });
  await copyFile(path.join(fixturesCv, 'perfil.json'), path.join(dataRoot, 'cv', 'perfil.json'));
  await copyFile(path.join(fixturesCv, 'foto.svg'), path.join(dataRoot, 'cv', 'foto.svg'));
  const ts = '2026-10-17T12:00:00.000Z';
  await appendEvents(dataRoot, [vagaAlta(), vagaGupy()].map(vaga => ({ id: `imp:${vaga.id}`, ts, ator: 'teste', tipo: 'vaga.importada', entidade: 'vaga', entidade_id: vaga.id, dados: { legado: vaga } })), { now: ts });
  return dataRoot;
}
const projetada = async (dataRoot, id) => (projectEvents((await readEvents(dataRoot)).eventos).vagas ?? []).find(v => v.id === id);

test('cv gerar grava os dois PDFs, o manifesto e o evento do gate; cv gate reavalia contra a base atual', { skip: semNavegador }, async t => {
  const dataRoot = await ambiente(t);
  const r = run(['cv', 'gerar', '--vaga', 'vaga-cv-01', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.json.gate.status, 'ok');
  assert.equal(r.json.tipo, 'adaptado');
  const pasta = path.join(dataRoot, 'artifacts', 'cv', 'vaga-cv-01', r.json.versao);
  assert.equal((await readFile(path.join(pasta, 'cv-ats.pdf'))).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal((await readFile(path.join(pasta, 'cv-visual.pdf'))).subarray(0, 5).toString('latin1'), '%PDF-');
  const manifesto = JSON.parse(await readFile(path.join(dataRoot, 'artifacts', 'cv', 'vaga-cv-01', 'manifesto.json'), 'utf8'));
  assert.deepEqual(manifesto.versoes.map(v => [v.hash, v.gate.status]), [[r.json.versao, 'ok']]);
  const vaga = await projetada(dataRoot, 'vaga-cv-01');
  assert.equal(vaga.cv_gate.status, 'ok');
  assert.equal(vaga.cv_gate.versao, r.json.versao);
  assert.equal(podeCandidatar(vaga), true);

  // Mesmo CV de novo: mesma versão, sem segunda entrada no manifesto nem segundo evento igual.
  assert.equal(run(['cv', 'gerar', '--vaga', 'vaga-cv-01', '--json'], { dataRoot }).json.versao, r.json.versao);
  assert.equal((await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'cv.gate').length, 1);

  // A afirmação do painel de indicadores é rebaixada para relato: o CV já gerado passa a ser bloqueado.
  const af = path.join(dataRoot, 'kb', 'claims', 'AF-202.md');
  await writeFile(af, (await readFile(af, 'utf8')).replace('nivel_prova: entregue', 'nivel_prova: relato'));
  const g = run(['cv', 'gate', '--vaga', 'vaga-cv-01', '--json'], { dataRoot });
  assert.equal(g.status, 1, g.stderr);
  assert.equal(g.json.gate.status, 'bloqueado');
  assert.ok(g.json.gate.motivos.some(m => m.codigo === 'afirmacao_sem_prova'), JSON.stringify(g.json.gate.motivos));
  const depois = await projetada(dataRoot, 'vaga-cv-01');
  assert.equal(depois.cv_gate.status, 'bloqueado');
  assert.equal(podeCandidatar(depois), false);
});

test('cv gerar em vaga de portal sem CV não gera arquivo', async t => {
  const dataRoot = await ambiente(t);
  const r = run(['cv', 'gerar', '--vaga', 'vaga-cv-03', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.json, { gerado: false, motivo: 'portal_sem_cv' });
});

test('cv sem perfil de CV, sem vaga ou sem subcomando falha com mensagem', async t => {
  const dataRoot = await dataRootComBase(t);
  const semVaga = run(['cv', 'gerar', '--vaga', 'nao-existe'], { dataRoot });
  assert.notEqual(semVaga.status, 0);
  assert.match(semVaga.stderr, /Vaga não encontrada/);
  const ts = '2026-10-17T12:00:00.000Z';
  await appendEvents(dataRoot, [{ id: 'imp', ts, ator: 'teste', tipo: 'vaga.importada', entidade: 'vaga', entidade_id: 'vaga-cv-01', dados: { legado: vagaAlta() } }], { now: ts });
  const semPerfil = run(['cv', 'gerar', '--vaga', 'vaga-cv-01'], { dataRoot });
  assert.notEqual(semPerfil.status, 0);
  assert.match(semPerfil.stderr, /Perfil de CV ausente/);
  assert.match(run(['cv'], { dataRoot }).stderr, /Uso: cv gerar/);
});
