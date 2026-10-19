import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDigest } from '../../core/score/digest.mjs';

test('buildDigest inclui a seção ## Acompanhamento de processos quando houver itens em atenção ou lembrar', () => {
  const rodada = {
    ts: '2026-10-18T18:00:00Z',
    fontes: [{ id: 'gupy', estado: 'ok' }],
    novas_ids: [],
    avaliadas_ids: [],
  };

  const processos = [
    {
      vaga_id: 'v1',
      empresa: 'Acme Corp',
      cargo: 'Engenheiro de Software',
      etapa_atual: 'entrevista_rh',
      situacao: 'aguardando_retorno',
      alerta: 'atencao',
      dias_inatividade: 5,
    },
    {
      vaga_id: 'v2',
      empresa: 'Beta SA',
      cargo: 'Tech Lead',
      etapa_atual: 'teste',
      situacao: 'aguardando_voce',
      alerta: 'lembrar',
      dias_inatividade: 8,
    },
    {
      vaga_id: 'v3',
      empresa: 'Gamma Inc',
      cargo: 'DevOps',
      etapa_atual: 'aplicada',
      situacao: 'aguardando_retorno',
      alerta: 'normal',
      dias_inatividade: 2,
    },
  ];

  const digest = buildDigest({
    rodada,
    projecao: [],
    historico: [],
    processos,
  });

  assert.match(digest.texto, /## Acompanhamento de processos/);
  assert.match(digest.texto, /Acme Corp/);
  assert.match(digest.texto, /Beta SA/);
  assert.doesNotMatch(digest.texto, /Gamma Inc/); // Alerta normal não entra
  assert.equal(digest.vazio, false);
});

test('buildDigest não inclui ## Acompanhamento de processos se todos os alertas forem normal', () => {
  const rodada = {
    ts: '2026-10-18T18:00:00Z',
    fontes: [{ id: 'gupy', estado: 'ok' }],
    novas_ids: [],
    avaliadas_ids: [],
  };

  const processos = [
    {
      vaga_id: 'v1',
      empresa: 'Acme Corp',
      cargo: 'Dev',
      alerta: 'normal',
      dias_inatividade: 2,
    },
  ];

  const digest = buildDigest({
    rodada,
    projecao: [],
    historico: [],
    processos,
  });

  assert.doesNotMatch(digest.texto, /## Acompanhamento de processos/);
});

// O digest real (comando, não só a função) precisa trazer o que pede acompanhamento.
import { run, tempDir } from '../helpers/cli.mjs';
import { appendEvents } from '../../core/store/events.mjs';

test('o comando digest inclui os processos que pedem acompanhamento', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  const dia = n => new Date(Date.now() - n * 86400000).toISOString();
  await appendEvents(dataRoot, [
    { id: 'rodada-1', ts: dia(0), ator: 'radar', tipo: 'radar.rodada', entidade: 'radar', entidade_id: 'rodada-1', dados: { ts: dia(0), fontes: [], novas_ids: [], avaliadas_ids: [] } },
    { id: 'cand-antiga', ts: dia(20), ator: 'teste', tipo: 'candidatura.marcada', entidade: 'vaga', entidade_id: 'vaga-esquecida', dados: { aplicada: true, data: dia(20).slice(0, 10) } },
  ], { now: dia(0) });
  const r = run(['digest', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.json.texto, /## Acompanhamento de processos/);
  assert.match(r.json.texto, /vaga-esquecida/);
});