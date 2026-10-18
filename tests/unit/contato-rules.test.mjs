import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANAIS_CONTATO,
  DIRECOES_CONTATO,
  validarContatoRegistrado,
  validarContatoVinculado,
  validarContatoRemovido,
} from '../../core/store/rules.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00';

test('CANAIS_CONTATO e DIRECOES_CONTATO contêm os valores previstos', () => {
  assert.deepEqual([...CANAIS_CONTATO].sort(), ['email', 'linkedin', 'outro', 'telefone', 'whatsapp']);
  assert.deepEqual([...DIRECOES_CONTATO].sort(), ['enviado', 'recebido']);
});

test('validarContatoRegistrado aceita dados válidos mínimos e completos', () => {
  const minimo = {
    canal: 'linkedin',
    direcao: 'recebido',
    resumo: 'Contato de recrutador sobre vaga backend',
    data: '2026-10-18',
  };
  assert.equal(validarContatoRegistrado(minimo, NOW), null);

  const completo = {
    vaga_id: 'vaga-123',
    canal: 'email',
    direcao: 'enviado',
    pessoa: { nome: 'Mariana Silva', papel: 'Tech Recruiter' },
    resumo: 'Envio de dados complementares',
    pergunta: 'Qual sua disponibilidade?',
    proxima_etapa: { texto: 'Entrevista técnica', data: '2026-10-24' },
    data: '2026-10-17',
    endereco: 'mariana.test@exemplo.test',
  };
  assert.equal(validarContatoRegistrado(completo, NOW), null);
});

test('validarContatoRegistrado rejeita dados não-objeto', () => {
  assert.match(validarContatoRegistrado(null, NOW), /inválidos/i);
  assert.match(validarContatoRegistrado('texto', NOW), /inválidos/i);
  assert.match(validarContatoRegistrado([], NOW), /inválidos/i);
});

test('validarContatoRegistrado valida canal', () => {
  const base = {
    direcao: 'recebido',
    resumo: 'Conversa',
    data: '2026-10-18',
  };
  assert.match(validarContatoRegistrado({ ...base, canal: 'telegram' }, NOW), /Canal inválido/i);
  assert.match(validarContatoRegistrado({ ...base, canal: '' }, NOW), /Canal inválido/i);
});

test('validarContatoRegistrado valida direcao', () => {
  const base = {
    canal: 'whatsapp',
    resumo: 'Conversa',
    data: '2026-10-18',
  };
  assert.match(validarContatoRegistrado({ ...base, direcao: 'outro' }, NOW), /Direção inválida/i);
  assert.match(validarContatoRegistrado({ ...base, direcao: null }, NOW), /Direção inválida/i);
});

test('validarContatoRegistrado valida resumo', () => {
  const base = {
    canal: 'email',
    direcao: 'recebido',
    data: '2026-10-18',
  };
  assert.match(validarContatoRegistrado({ ...base, resumo: '' }, NOW), /Resumo obrigatório/i);
  assert.match(validarContatoRegistrado({ ...base, resumo: '   ' }, NOW), /Resumo obrigatório/i);
  assert.match(validarContatoRegistrado({ ...base, resumo: 'a'.repeat(501) }, NOW), /limite de 500/i);
  assert.equal(validarContatoRegistrado({ ...base, resumo: 'a'.repeat(500) }, NOW), null);
});

test('validarContatoRegistrado valida data e bloqueia data futura', () => {
  const base = {
    canal: 'telefone',
    direcao: 'recebido',
    resumo: 'Ligação de triagem',
  };
  assert.match(validarContatoRegistrado({ ...base, data: '18/10/2026' }, NOW), /Data do contato inválida/i);
  assert.match(validarContatoRegistrado({ ...base, data: '2026-02-31' }, NOW), /Data do contato inválida/i);
  assert.match(validarContatoRegistrado({ ...base, data: '2026-10-19' }, NOW), /data futura/i);
  assert.equal(validarContatoRegistrado({ ...base, data: '2026-10-18' }, NOW), null);
  assert.equal(validarContatoRegistrado({ ...base, data: '2026-10-10' }, NOW), null);
});

test('validarContatoRegistrado valida pessoa e proxima_etapa quando informados', () => {
  const base = {
    canal: 'linkedin',
    direcao: 'recebido',
    resumo: 'Conversa',
    data: '2026-10-18',
  };
  assert.match(validarContatoRegistrado({ ...base, pessoa: 'Nome em string' }, NOW), /pessoa deve ser um objeto/i);
  assert.match(validarContatoRegistrado({ ...base, pessoa: [] }, NOW), /pessoa deve ser um objeto/i);

  assert.match(validarContatoRegistrado({ ...base, proxima_etapa: 'Texto' }, NOW), /Próxima etapa deve ser um objeto/i);
  assert.match(validarContatoRegistrado({ ...base, proxima_etapa: { texto: '' } }, NOW), /Texto da próxima etapa é obrigatório/i);
  assert.match(validarContatoRegistrado({ ...base, proxima_etapa: { texto: 'Ok', data: 'data-invalida' } }, NOW), /Data da próxima etapa inválida/i);
  assert.equal(validarContatoRegistrado({ ...base, proxima_etapa: { texto: 'Aguardar retorno' } }, NOW), null);
});

test('validarContatoVinculado valida dados obrigatórios', () => {
  assert.match(validarContatoVinculado(null), /inválidos/i);
  assert.match(validarContatoVinculado([]), /inválidos/i);
  assert.match(validarContatoVinculado({}), /ID do contato obrigatório/i);
  assert.match(validarContatoVinculado({ contato_id: '' }), /ID do contato obrigatório/i);
  assert.match(validarContatoVinculado({ contato_id: 'con-1' }), /ID da vaga obrigatório/i);
  assert.match(validarContatoVinculado({ contato_id: 'con-1', vaga_id: '' }), /ID da vaga obrigatório/i);
  assert.equal(validarContatoVinculado({ contato_id: 'con-1', vaga_id: 'vaga-abc' }), null);
});

test('validarContatoRemovido valida contato_id obrigatório e motivo opcional', () => {
  assert.match(validarContatoRemovido(null), /inválidos/i);
  assert.match(validarContatoRemovido([]), /inválidos/i);
  assert.match(validarContatoRemovido({}), /ID do contato obrigatório/i);
  assert.match(validarContatoRemovido({ contato_id: '' }), /ID do contato obrigatório/i);
  assert.match(validarContatoRemovido({ contato_id: '   ' }), /ID do contato obrigatório/i);
  assert.match(validarContatoRemovido({ contato_id: 'con-1', motivo: '' }), /Motivo da remoção/i);
  assert.match(validarContatoRemovido({ contato_id: 'con-1', motivo: 123 }), /Motivo da remoção/i);
  assert.equal(validarContatoRemovido({ contato_id: 'con-1' }), null);
  assert.equal(validarContatoRemovido({ contato_id: 'con-1', motivo: 'Registro inserido por engano em teste' }), null);
});

