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
