import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ETAPAS_PROCESSO,
  DESFECHOS_PROCESSO,
  SITUACOES_PROCESSO,
  DESFECHOS_QUE_DESCARTAM,
  validarEtapaProcesso,
  validarEncerramentoProcesso,
} from '../../core/store/rules.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00';

test('constantes de vocabulário contêm os valores previstos', () => {
  assert.deepEqual(
    [...ETAPAS_PROCESSO].sort(),
    ['aplicada', 'aprovado', 'entrevista_gestor', 'entrevista_rh', 'entrevista_tecnica', 'proposta', 'teste', 'triagem']
  );
  assert.deepEqual(
    [...DESFECHOS_PROCESSO].sort(),
    ['aprovado', 'cancelado', 'desistencia', 'proposta_recusada', 'reprovado']
  );
  assert.deepEqual(
    [...SITUACOES_PROCESSO].sort(),
    ['ativo', 'aguardando_retorno', 'aguardando_voce', 'encerrado'].sort()
  );
  assert.deepEqual(
    [...DESFECHOS_QUE_DESCARTAM].sort(),
    ['cancelado', 'desistencia', 'proposta_recusada', 'reprovado']
  );
});

test('validarEtapaProcesso aceita dados válidos mínimos e completos', () => {
  const minimo = {
    vaga_id: 'vaga-101',
    etapa: 'entrevista_rh',
    data: '2026-10-18',
  };
  assert.equal(validarEtapaProcesso(minimo, NOW), null);

  const completo = {
    vaga_id: 'vaga-101',
    etapa: 'teste',
    data: '2026-10-17',
    detalhe: 'Teste técnico enviado pela plataforma',
  };
  assert.equal(validarEtapaProcesso(completo, NOW), null);
});

test('validarEtapaProcesso rejeita dados não-objeto', () => {
  assert.match(validarEtapaProcesso(null, NOW), /inválidos/i);
  assert.match(validarEtapaProcesso('texto', NOW), /inválidos/i);
  assert.match(validarEtapaProcesso([], NOW), /inválidos/i);
});

test('validarEtapaProcesso valida vaga_id', () => {
  const base = { etapa: 'teste', data: '2026-10-18' };
  assert.match(validarEtapaProcesso({ ...base, vaga_id: '' }, NOW), /ID da vaga obrigatório/i);
  assert.match(validarEtapaProcesso({ ...base, vaga_id: '   ' }, NOW), /ID da vaga obrigatório/i);
  assert.match(validarEtapaProcesso(base, NOW), /ID da vaga obrigatório/i);
});

test('validarEtapaProcesso valida etapa no vocabulário', () => {
  const base = { vaga_id: 'vaga-1', data: '2026-10-18' };
  assert.match(validarEtapaProcesso({ ...base, etapa: 'etapa_inventada' }, NOW), /Etapa inválida/i);
  assert.match(validarEtapaProcesso({ ...base, etapa: '' }, NOW), /Etapa inválida/i);
  assert.match(validarEtapaProcesso(base, NOW), /Etapa inválida/i);
});

test('validarEtapaProcesso valida data e bloqueia data futura', () => {
  const base = { vaga_id: 'vaga-1', etapa: 'teste' };
  assert.match(validarEtapaProcesso({ ...base, data: '18/10/2026' }, NOW), /Data da etapa inválida/i);
  assert.match(validarEtapaProcesso({ ...base, data: '2026-02-31' }, NOW), /Data da etapa inválida/i);
  assert.match(validarEtapaProcesso({ ...base, data: '2026-10-19' }, NOW), /data futura/i);
  assert.equal(validarEtapaProcesso({ ...base, data: '2026-10-18' }, NOW), null);
  assert.equal(validarEtapaProcesso({ ...base, data: '2026-10-10' }, NOW), null);
});

test('validarEtapaProcesso valida detalhe com limite de 500 caracteres', () => {
  const base = { vaga_id: 'vaga-1', etapa: 'proposta', data: '2026-10-18' };
  assert.match(validarEtapaProcesso({ ...base, detalhe: 123 }, NOW), /Detalhe deve ser um texto/i);
  assert.match(validarEtapaProcesso({ ...base, detalhe: 'a'.repeat(501) }, NOW), /limite de 500/i);
  assert.equal(validarEtapaProcesso({ ...base, detalhe: 'a'.repeat(500) }, NOW), null);
  assert.equal(validarEtapaProcesso({ ...base, detalhe: '' }, NOW), null);
});

test('validarEncerramentoProcesso aceita dados válidos com todos os desfechos previstos', () => {
  for (const desfecho of DESFECHOS_PROCESSO) {
    const dados = {
      vaga_id: 'vaga-202',
      desfecho,
      data: '2026-10-18',
      nota: `Encerramento com desfecho ${desfecho}`,
    };
    assert.equal(validarEncerramentoProcesso(dados, NOW), null);
  }
});

test('validarEncerramentoProcesso rejeita dados não-objeto', () => {
  assert.match(validarEncerramentoProcesso(null, NOW), /inválidos/i);
  assert.match(validarEncerramentoProcesso('encerrar', NOW), /inválidos/i);
  assert.match(validarEncerramentoProcesso([], NOW), /inválidos/i);
});

test('validarEncerramentoProcesso valida vaga_id', () => {
  const base = { desfecho: 'reprovado', data: '2026-10-18' };
  assert.match(validarEncerramentoProcesso({ ...base, vaga_id: '' }, NOW), /ID da vaga obrigatório/i);
  assert.match(validarEncerramentoProcesso(base, NOW), /ID da vaga obrigatório/i);
});

test('validarEncerramentoProcesso valida desfecho no vocabulário', () => {
  const base = { vaga_id: 'vaga-1', data: '2026-10-18' };
  assert.match(validarEncerramentoProcesso({ ...base, desfecho: 'ignorado' }, NOW), /Desfecho inválido/i);
  assert.match(validarEncerramentoProcesso({ ...base, desfecho: '' }, NOW), /Desfecho inválido/i);
  assert.match(validarEncerramentoProcesso(base, NOW), /Desfecho inválido/i);
});

test('validarEncerramentoProcesso valida data e bloqueia data futura', () => {
  const base = { vaga_id: 'vaga-1', desfecho: 'reprovado' };
  assert.match(validarEncerramentoProcesso({ ...base, data: '2026-10-19' }, NOW), /data futura/i);
  assert.match(validarEncerramentoProcesso({ ...base, data: '2026-13-01' }, NOW), /Data de encerramento inválida/i);
  assert.equal(validarEncerramentoProcesso({ ...base, data: '2026-10-18' }, NOW), null);
});

test('validarEncerramentoProcesso valida nota com limite de 500 caracteres', () => {
  const base = { vaga_id: 'vaga-1', desfecho: 'cancelado', data: '2026-10-18' };
  assert.match(validarEncerramentoProcesso({ ...base, nota: 42 }, NOW), /Nota deve ser um texto/i);
  assert.match(validarEncerramentoProcesso({ ...base, nota: 'x'.repeat(501) }, NOW), /limite de 500/i);
  assert.equal(validarEncerramentoProcesso({ ...base, nota: 'x'.repeat(500) }, NOW), null);
  assert.equal(validarEncerramentoProcesso({ ...base, nota: '' }, NOW), null);
});
