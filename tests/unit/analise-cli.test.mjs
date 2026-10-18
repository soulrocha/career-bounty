import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { readEvents } from '../../core/store/events.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const NOW = '2026-10-18T15:00:00.000-03:00';
const DEFAULT_ENV = { CAREER_BOUNTY_NOW: NOW };

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot, env: DEFAULT_ENV }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  return dataRoot;
}

test('analise listar retorna os 4 grupos e suporta filtros de grupo e status', async t => {
  const dataRoot = await ambiente(t);

  // Lista todos
  const resTodos = run(['analise', 'listar', '--json', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.equal(resTodos.status, 0, resTodos.stderr);
  assert.ok(resTodos.json?.grupos);
  assert.ok(resTodos.json?.contadores);
  assert.ok(resTodos.json.contadores.total > 0);
  assert.ok(Array.isArray(resTodos.json.grupos.confere));
  assert.ok(Array.isArray(resTodos.json.grupos.sem_prova));
  assert.ok(Array.isArray(resTodos.json.grupos.fora_do_cv));
  assert.ok(Array.isArray(resTodos.json.grupos.lacuna));

  // Filtro por grupo
  const resConfere = run(['analise', 'listar', '--grupo', 'confere', '--json', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.equal(resConfere.status, 0, resConfere.stderr);
  assert.equal(resConfere.json.itens.length, resTodos.json.contadores.confere);
  assert.ok(resConfere.json.itens.every(i => i.grupo === 'confere'));

  // Filtro por status
  const resAtivos = run(['analise', 'listar', '--status', 'ativo', '--json', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.equal(resAtivos.status, 0, resAtivos.stderr);
  assert.equal(resAtivos.json.itens.length, resTodos.json.contadores.ativos);
});

test('analise incluir vincula afirmacao a experiencia e grava evento no log', async t => {
  const dataRoot = await ambiente(t);

  // Inclui com experiência especificada
  const res = run([
    'analise', 'incluir',
    '--afirmacao', 'AF-101',
    '--experiencia', 'exp-alfa',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: DEFAULT_ENV });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.afirmacao_id, 'AF-101');
  assert.equal(res.json.experiencia_id, 'exp-alfa');

  // Confere evento gravado no log
  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'analise.afirmacao_incluida');
  assert.ok(ev);
  assert.equal(ev.dados.afirmacao_id, 'AF-101');
  assert.equal(ev.dados.experiencia_id, 'exp-alfa');
  assert.equal(ev.dados.data, '2026-10-18');

  // Suporta ID qualificado e infere experiencia quando omitida
  const resQualificado = run([
    'analise', 'incluir',
    '--afirmacao', 'fora_do_cv:af:AF-102',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: DEFAULT_ENV });

  assert.equal(resQualificado.status, 0, resQualificado.stderr);
  assert.equal(resQualificado.json.ok, true);
  assert.equal(resQualificado.json.afirmacao_id, 'AF-102');

  // Rejeita afirmação inexistente na base
  const resInexistente = run([
    'analise', 'incluir',
    '--afirmacao', 'AF-999',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: DEFAULT_ENV });

  assert.notEqual(resInexistente.status, 0);
  assert.match(resInexistente.json?.error || resInexistente.stderr, /não encontrada/i);
});

test('analise marcar altera status do item com suporte a alias ignorar', async t => {
  const dataRoot = await ambiente(t);

  const resListar = run(['analise', 'listar', '--json', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  const itemAlvo = resListar.json.grupos.sem_prova[0]?.id || resListar.json.grupos.confere[0]?.id;
  assert.ok(itemAlvo, 'Deve haver ao menos um item');

  // Marca como revisar
  const resRevisar = run([
    'analise', 'marcar',
    '--item', itemAlvo,
    '--como', 'revisar',
    '--motivo', 'Conferir evidência',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: DEFAULT_ENV });

  assert.equal(resRevisar.status, 0, resRevisar.stderr);
  assert.equal(resRevisar.json.ok, true);
  assert.equal(resRevisar.json.como, 'revisar');

  // Marca como ignorado via alias --como ignorar
  const resIgnorar = run([
    'analise', 'marcar',
    '--item', itemAlvo,
    '--como', 'ignorar',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: DEFAULT_ENV });

  assert.equal(resIgnorar.status, 0, resIgnorar.stderr);
  assert.equal(resIgnorar.json.ok, true);
  assert.equal(resIgnorar.json.como, 'ignorado');

  // Confere que no listar o item está com status ignorado
  const resListarDepois = run(['analise', 'listar', '--json', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  const todos = [
    ...resListarDepois.json.grupos.confere,
    ...resListarDepois.json.grupos.sem_prova,
    ...resListarDepois.json.grupos.fora_do_cv,
    ...resListarDepois.json.grupos.lacuna,
  ];
  const modificado = todos.find(i => i.id === itemAlvo);
  assert.equal(modificado.status, 'ignorado');
});

test('analise lacuna gera rascunho em outbox/lacunas e grava evento de entrevista', async t => {
  const dataRoot = await ambiente(t);

  const resListar = run(['analise', 'listar', '--json', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  const lacunas = resListar.json.grupos.lacuna;
  assert.ok(lacunas.length > 0, 'Deve haver ao menos uma lacuna na base fixture');
  const lacunaAlvo = lacunas[0];

  // Rejeita sem a flag --entrevista
  const resSemFlag = run([
    'analise', 'lacuna',
    '--item', lacunaAlvo.id,
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resSemFlag.status, 0);
  assert.match(resSemFlag.json?.error || resSemFlag.stderr, /--entrevista/i);

  // Executa com --entrevista
  const resOk = run([
    'analise', 'lacuna',
    '--item', lacunaAlvo.id,
    '--entrevista',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: DEFAULT_ENV });

  assert.equal(resOk.status, 0, resOk.stderr);
  assert.equal(resOk.json.ok, true);
  assert.equal(resOk.json.item_id, lacunaAlvo.id);
  assert.ok(resOk.json.rascunho);
  assert.ok(resOk.json.pergunta);

  // Confere existência e conteúdo do rascunho em outbox/lacunas
  const caminhoAbsoluto = path.join(dataRoot, resOk.json.rascunho);
  const conteudo = await readFile(caminhoAbsoluto, 'utf8');
  assert.match(conteudo, /# Pergunta de Entrevista de Lacuna/);
  assert.match(conteudo, new RegExp(lacunaAlvo.id));
  assert.match(conteudo, /## Pergunta Sugerida/);

  // Confere evento gravado no log
  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'analise.lacuna_entrevista');
  assert.ok(ev);
  assert.equal(ev.dados.item_id, lacunaAlvo.id);
  assert.equal(ev.dados.arquivo_rascunho, resOk.json.rascunho);
});
