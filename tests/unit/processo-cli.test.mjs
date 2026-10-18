import assert from 'node:assert/strict';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { readEvents } from '../../core/store/events.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00';

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  return dataRoot;
}

test('processo etapa grava evento processo.etapa no log', async t => {
  const dataRoot = await ambiente(t);

  const res = run([
    'processo', 'etapa',
    '--vaga', 'vaga-cli-1',
    '--etapa', 'teste',
    '--data', '2026-10-18',
    '--detalhe', 'Teste técnico recebido via plataforma',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json?.ok, true);
  assert.equal(res.json?.etapa, 'teste');
  assert.equal(res.json?.vaga_id, 'vaga-cli-1');

  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'processo.etapa');
  assert.ok(ev);
  assert.equal(ev.entidade_id, 'vaga-cli-1');
  assert.equal(ev.dados.etapa, 'teste');
  assert.equal(ev.dados.detalhe, 'Teste técnico recebido via plataforma');
  assert.equal(ev.dados.data, '2026-10-18');
});

test('processo etapa valida parâmetros obrigatórios', async t => {
  const dataRoot = await ambiente(t);

  const semVaga = run([
    'processo', 'etapa',
    '--etapa', 'teste',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });
  assert.notEqual(semVaga.status, 0);

  const etapaInvalida = run([
    'processo', 'etapa',
    '--vaga', 'v1',
    '--etapa', 'etapa_inexistente',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });
  assert.notEqual(etapaInvalida.status, 0);

  const dataFutura = run([
    'processo', 'etapa',
    '--vaga', 'v1',
    '--etapa', 'teste',
    '--data', '2026-10-25',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });
  assert.notEqual(dataFutura.status, 0);
});

test('processo encerrar com desfecho que descarta grava processo.encerrado e vaga.descartada', async t => {
  const dataRoot = await ambiente(t);

  const res = run([
    'processo', 'encerrar',
    '--vaga', 'vaga-cli-reprovada',
    '--desfecho', 'reprovado',
    '--data', '2026-10-18',
    '--nota', 'Não atingiu pontuação no teste',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json?.ok, true);
  assert.equal(res.json?.descartada, true);

  const { eventos } = await readEvents(dataRoot);
  const evEncerrado = eventos.find(e => e.tipo === 'processo.encerrado');
  assert.ok(evEncerrado);
  assert.equal(evEncerrado.dados.desfecho, 'reprovado');
  assert.equal(evEncerrado.dados.nota, 'Não atingiu pontuação no teste');

  const evDescarte = eventos.find(e => e.tipo === 'vaga.descartada');
  assert.ok(evDescarte);
  assert.equal(evDescarte.entidade_id, 'vaga-cli-reprovada');
});

test('processo encerrar com desfecho aprovado NÃO descarta a vaga', async t => {
  const dataRoot = await ambiente(t);

  const res = run([
    'processo', 'encerrar',
    '--vaga', 'vaga-cli-aprovada',
    '--desfecho', 'aprovado',
    '--data', '2026-10-18',
    '--nota', 'Contratação aceita!',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json?.ok, true);
  assert.equal(res.json?.descartada, false);

  const { eventos } = await readEvents(dataRoot);
  const evEncerrado = eventos.find(e => e.tipo === 'processo.encerrado');
  assert.ok(evEncerrado);
  assert.equal(evEncerrado.dados.desfecho, 'aprovado');

  const evDescarte = eventos.find(e => e.tipo === 'vaga.descartada');
  assert.equal(evDescarte, undefined, 'Aprovado não deve gerar evento de descarte');
});
