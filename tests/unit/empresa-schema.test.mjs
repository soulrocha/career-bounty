import assert from 'node:assert/strict';
import test from 'node:test';
import { PLATAFORMAS_AVALIACAO, validarEmpresaAvaliada } from '../../core/store/rules.mjs';

function payloadValido(override = {}) {
  return {
    empresa: 'Empresa Alfa',
    empresa_chave: 'empresa-alfa',
    nota: 4.2,
    quantidade: 150,
    plataforma: 'Glassdoor',
    data: '2026-10-18',
    fontes: [
      { url: 'https://example.com/avaliacoes/empresa-alfa', plataforma: 'Glassdoor' }
    ],
    resumo: 'Ambiente de trabalho positivo com bons benefícios.',
    validade_dias: 90,
    ...override
  };
}

const NOW = '2026-10-18T15:00:00.000Z';

test('validarEmpresaAvaliada aceita payload completo e válido', () => {
  assert.equal(validarEmpresaAvaliada(payloadValido(), NOW), null);
});

test('validarEmpresaAvaliada aceita resumo e validade_dias omitidos ou nulos', () => {
  const dadosSemOpcionais = payloadValido({ resumo: undefined, validade_dias: undefined });
  assert.equal(validarEmpresaAvaliada(dadosSemOpcionais, NOW), null);

  const dadosComNulos = payloadValido({ resumo: null, validade_dias: null });
  assert.equal(validarEmpresaAvaliada(dadosComNulos, NOW), null);
});

test('validarEmpresaAvaliada aceita todas as plataformas permitidas em PLATAFORMAS_AVALIACAO', () => {
  assert.deepEqual([...PLATAFORMAS_AVALIACAO].sort(), ['Catho', 'Glassdoor', 'Indeed', 'Outro'].sort());
  for (const plataforma of PLATAFORMAS_AVALIACAO) {
    assert.equal(validarEmpresaAvaliada(payloadValido({ plataforma }), NOW), null);
  }
});

test('validarEmpresaAvaliada rejeita payloads não-objeto ou nulos', () => {
  assert.match(validarEmpresaAvaliada(null, NOW), /inválidos/i);
  assert.match(validarEmpresaAvaliada(undefined, NOW), /inválidos/i);
  assert.match(validarEmpresaAvaliada('texto', NOW), /inválidos/i);
  assert.match(validarEmpresaAvaliada([], NOW), /inválidos/i);
});

test('validarEmpresaAvaliada valida nome e chave da empresa', () => {
  assert.match(validarEmpresaAvaliada(payloadValido({ empresa: '' }), NOW), /Nome da empresa/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ empresa: '   ' }), NOW), /Nome da empresa/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ empresa: 123 }), NOW), /Nome da empresa/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ empresa_chave: '' }), NOW), /Chave normalizada/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ empresa_chave: null }), NOW), /Chave normalizada/i);
});

test('validarEmpresaAvaliada valida nota no intervalo [1.0, 5.0]', () => {
  assert.equal(validarEmpresaAvaliada(payloadValido({ nota: 1.0 }), NOW), null);
  assert.equal(validarEmpresaAvaliada(payloadValido({ nota: 5.0 }), NOW), null);
  assert.match(validarEmpresaAvaliada(payloadValido({ nota: 0.9 }), NOW), /Nota deve ser um número entre 1.0 e 5.0/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ nota: 5.1 }), NOW), /Nota deve ser um número entre 1.0 e 5.0/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ nota: NaN }), NOW), /Nota deve ser um número entre 1.0 e 5.0/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ nota: Infinity }), NOW), /Nota deve ser um número entre 1.0 e 5.0/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ nota: '4.5' }), NOW), /Nota deve ser um número entre 1.0 e 5.0/i);
});

test('validarEmpresaAvaliada valida quantidade de avaliações como inteiro >= 0', () => {
  assert.equal(validarEmpresaAvaliada(payloadValido({ quantidade: 0 }), NOW), null);
  assert.equal(validarEmpresaAvaliada(payloadValido({ quantidade: 100 }), NOW), null);
  assert.match(validarEmpresaAvaliada(payloadValido({ quantidade: -1 }), NOW), /Quantidade de avaliações deve ser um número inteiro maior ou igual a zero/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ quantidade: 3.5 }), NOW), /Quantidade de avaliações deve ser um número inteiro maior ou igual a zero/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ quantidade: '10' }), NOW), /Quantidade de avaliações deve ser um número inteiro maior ou igual a zero/i);
});

test('validarEmpresaAvaliada valida plataforma conhecida', () => {
  assert.match(validarEmpresaAvaliada(payloadValido({ plataforma: 'Desconhecida' }), NOW), /Plataforma inválida/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ plataforma: 'glassdoor' }), NOW), /Plataforma inválida/i);
});

test('validarEmpresaAvaliada valida data e impede datas futuras no fuso de São Paulo', () => {
  assert.match(validarEmpresaAvaliada(payloadValido({ data: '2026-13-01' }), NOW), /Data da avaliação inválida/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ data: '2026-02-30' }), NOW), /Data da avaliação inválida/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ data: '18/10/2026' }), NOW), /Data da avaliação inválida/i);

  // NOW é 2026-10-18T15:00:00Z -> em SP (-3) é 2026-10-18 12:00.
  // Data 2026-10-19 é futura:
  assert.match(validarEmpresaAvaliada(payloadValido({ data: '2026-10-19' }), NOW), /A avaliação não pode ter data futura/i);
  // Data 2026-10-18 é permitida:
  assert.equal(validarEmpresaAvaliada(payloadValido({ data: '2026-10-18' }), NOW), null);
  // Data passada é permitida:
  assert.equal(validarEmpresaAvaliada(payloadValido({ data: '2026-05-01' }), NOW), null);
});

test('validarEmpresaAvaliada exige array não-vazio de fontes com URLs http/https válidas', () => {
  assert.match(validarEmpresaAvaliada(payloadValido({ fontes: [] }), NOW), /Fontes com URL são obrigatórias/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ fontes: null }), NOW), /Fontes com URL são obrigatórias/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ fontes: ['https://example.com'] }), NOW), /Item de fonte inválido/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ fontes: [{}] }), NOW), /URL da fonte inválida ou ausente/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ fontes: [{ url: 'ftp://example.com' }] }), NOW), /URL da fonte inválida ou ausente/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ fontes: [{ url: 'https://example.com', plataforma: 'Invalida' }] }), NOW), /Plataforma da fonte inválida/i);
});

test('validarEmpresaAvaliada valida resumo (máximo 500 caracteres)', () => {
  assert.match(validarEmpresaAvaliada(payloadValido({ resumo: 12345 }), NOW), /Resumo deve ser um texto/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ resumo: 'a'.repeat(501) }), NOW), /Resumo excede o limite de 500 caracteres/i);
  assert.equal(validarEmpresaAvaliada(payloadValido({ resumo: 'a'.repeat(500) }), NOW), null);
});

test('validarEmpresaAvaliada valida validade_dias (inteiro >= 1)', () => {
  assert.match(validarEmpresaAvaliada(payloadValido({ validade_dias: 0 }), NOW), /Validade em dias deve ser um inteiro positivo/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ validade_dias: -5 }), NOW), /Validade em dias deve ser um inteiro positivo/i);
  assert.match(validarEmpresaAvaliada(payloadValido({ validade_dias: 30.5 }), NOW), /Validade em dias deve ser um inteiro positivo/i);
  assert.equal(validarEmpresaAvaliada(payloadValido({ validade_dias: 1 }), NOW), null);
  assert.equal(validarEmpresaAvaliada(payloadValido({ validade_dias: 90 }), NOW), null);
});
