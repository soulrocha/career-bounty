import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizarEtapaEmail, aplicarEmailRecebido } from '../../core/mail/reducer.mjs';

test('normalizarEtapaEmail mapeia etapas legadas para o vocabulário padronizado', () => {
  assert.equal(normalizarEtapaEmail('inscrita'), 'aplicada');
  assert.equal(normalizarEtapaEmail('etapa'), 'teste');
  assert.equal(normalizarEtapaEmail('entrevista'), 'entrevista_rh');
  assert.equal(normalizarEtapaEmail('oferta'), 'proposta');
  assert.equal(normalizarEtapaEmail('negativa'), 'encerrado');
  assert.equal(normalizarEtapaEmail('encerrada'), 'encerrado');
});

test('normalizarEtapaEmail preserva etapas já no vocabulário padronizado ou desconhecidas', () => {
  assert.equal(normalizarEtapaEmail('aplicada'), 'aplicada');
  assert.equal(normalizarEtapaEmail('teste'), 'teste');
  assert.equal(normalizarEtapaEmail('entrevista_rh'), 'entrevista_rh');
  assert.equal(normalizarEtapaEmail('entrevista_tecnica'), 'entrevista_tecnica');
  assert.equal(normalizarEtapaEmail('entrevista_gestor'), 'entrevista_gestor');
  assert.equal(normalizarEtapaEmail('proposta'), 'proposta');
  assert.equal(normalizarEtapaEmail('aprovado'), 'aprovado');
  assert.equal(normalizarEtapaEmail(null), null);
  assert.equal(normalizarEtapaEmail(undefined), null);
});

test('aplicarEmailRecebido avança etapa usando o vocabulário padronizado', () => {
  const vagaInicial = { id: 'vaga-1', cargo: 'Dev' };
  const v1 = aplicarEmailRecebido(vagaInicial, {
    message_id: 'm1',
    etapa: 'aplicada',
    data_email: '2026-10-10',
  });
  assert.equal(v1.candidatura_email.aplicada, true);
  assert.equal(v1.candidatura_email.etapa, 'aplicada');
  assert.deepEqual(v1.candidatura_email.mensagens, ['m1']);
  assert.equal(v1.candidatura_email.ultimo_email_em, '2026-10-10');

  const v2 = aplicarEmailRecebido(v1, {
    message_id: 'm2',
    etapa: 'teste',
    data_email: '2026-10-12',
  });
  assert.equal(v2.candidatura_email.etapa, 'teste');
  assert.deepEqual(v2.candidatura_email.mensagens, ['m1', 'm2']);
  assert.equal(v2.candidatura_email.ultimo_email_em, '2026-10-12');

  const v3 = aplicarEmailRecebido(v2, {
    message_id: 'm3',
    etapa: 'entrevista_rh',
    data_email: '2026-10-14',
  });
  assert.equal(v3.candidatura_email.etapa, 'entrevista_rh');
});

test('aplicarEmailRecebido respeita monotonicidade e nunca retrocede', () => {
  const vagaEmEntrevista = {
    id: 'vaga-2',
    candidatura_email: {
      aplicada: true,
      etapa: 'entrevista_rh',
      mensagens: ['m1'],
      ultimo_email_em: '2026-10-14',
    },
  };

  // E-mail atrasado informando etapa anterior (teste ou inscrita)
  const vAtrasado = aplicarEmailRecebido(vagaEmEntrevista, {
    message_id: 'm-old',
    etapa: 'teste',
    data_email: '2026-10-11',
  });
  assert.equal(vAtrasado.candidatura_email.etapa, 'entrevista_rh');
  assert.deepEqual(vAtrasado.candidatura_email.mensagens, ['m1', 'm-old']);
  assert.equal(vAtrasado.candidatura_email.ultimo_email_em, '2026-10-14');

  const vAtrasadoLegado = aplicarEmailRecebido(vagaEmEntrevista, {
    message_id: 'm-old-2',
    etapa: 'inscrita',
    data_email: '2026-10-09',
  });
  assert.equal(vAtrasadoLegado.candidatura_email.etapa, 'entrevista_rh');
});

test('aplicarEmailRecebido encerra se etapa for negativa ou encerrada', () => {
  const vagaAtiva = {
    id: 'vaga-3',
    candidatura_email: {
      aplicada: true,
      etapa: 'entrevista_rh',
      mensagens: ['m1'],
      ultimo_email_em: '2026-10-14',
    },
  };

  const vEncerrada = aplicarEmailRecebido(vagaAtiva, {
    message_id: 'm-neg',
    etapa: 'negativa',
    data_email: '2026-10-16',
  });
  assert.equal(vEncerrada.candidatura_email.encerrada, true);
  assert.equal(vEncerrada.candidatura_email.encerrada_em, '2026-10-16');
  assert.equal(vEncerrada.candidatura_email.ultimo_email_em, '2026-10-16');

  // E-mail posterior não reabre nem altera etapa
  const vPosterior = aplicarEmailRecebido(vEncerrada, {
    message_id: 'm-pos',
    etapa: 'teste',
    data_email: '2026-10-17',
  });
  assert.equal(vPosterior.candidatura_email.encerrada, true);
  assert.deepEqual(vPosterior.candidatura_email.mensagens, ['m1', 'm-neg', 'm-pos']);
});
