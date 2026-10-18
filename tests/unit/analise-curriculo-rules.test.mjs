import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validarAfirmacaoIncluida,
  validarItemMarcado,
  validarLacunaEntrevista,
  STATUS_ITEM_ANALISE,
} from '../../core/store/rules.mjs';

test('validarAfirmacaoIncluida aceita dados válidos com ou sem experiência', () => {
  const now = '2026-10-18T15:00:00.000Z';
  const validoComExp = {
    afirmacao_id: 'AF-034',
    experiencia_id: 'exp-empresa-alfa',
    data: '2026-10-18',
  };
  assert.equal(validarAfirmacaoIncluida(validoComExp, now), null);

  const validoSemExp = {
    afirmacao_id: 'AF-034',
    experiencia_id: null,
    data: '2026-10-17',
  };
  assert.equal(validarAfirmacaoIncluida(validoSemExp, now), null);

  const validoExpUndefined = {
    afirmacao_id: 'AF-034',
    data: '2026-10-18',
  };
  assert.equal(validarAfirmacaoIncluida(validoExpUndefined, now), null);
});

test('validarAfirmacaoIncluida rejeita objeto nulo, array ou campos inválidos', () => {
  const now = '2026-10-18T15:00:00.000Z';
  assert.match(validarAfirmacaoIncluida(null, now), /inválidos/i);
  assert.match(validarAfirmacaoIncluida([], now), /inválidos/i);
  assert.match(validarAfirmacaoIncluida('string', now), /inválidos/i);

  assert.match(validarAfirmacaoIncluida({ data: '2026-10-18' }, now), /ID da afirmação/i);
  assert.match(validarAfirmacaoIncluida({ afirmacao_id: '', data: '2026-10-18' }, now), /ID da afirmação/i);
  assert.match(validarAfirmacaoIncluida({ afirmacao_id: '   ', data: '2026-10-18' }, now), /ID da afirmação/i);

  assert.match(validarAfirmacaoIncluida({ afirmacao_id: 'AF-001', experiencia_id: 123, data: '2026-10-18' }, now), /ID da experiência/i);
  assert.match(validarAfirmacaoIncluida({ afirmacao_id: 'AF-001', experiencia_id: '   ', data: '2026-10-18' }, now), /ID da experiência/i);

  assert.match(validarAfirmacaoIncluida({ afirmacao_id: 'AF-001', data: '18/10/2026' }, now), /Data de inclusão inválida/i);
  assert.match(validarAfirmacaoIncluida({ afirmacao_id: 'AF-001', data: '2026-02-30' }, now), /Data de inclusão inválida/i);
});

test('validarAfirmacaoIncluida rejeita data futura no fuso de São Paulo', () => {
  // 2026-10-18T23:00:00Z em SP (UTC-3) é 2026-10-18T20:00:00-03:00 -> hoje é 2026-10-18
  const now = '2026-10-18T23:00:00.000Z';
  assert.equal(validarAfirmacaoIncluida({ afirmacao_id: 'AF-001', data: '2026-10-18' }, now), null);
  assert.match(
    validarAfirmacaoIncluida({ afirmacao_id: 'AF-001', data: '2026-10-19' }, now),
    /data futura/i
  );
});

test('validarItemMarcado aceita status revisar, ignorado e ativo com ou sem motivo', () => {
  const now = '2026-10-18T15:00:00.000Z';
  assert.ok(STATUS_ITEM_ANALISE.has('revisar'));
  assert.ok(STATUS_ITEM_ANALISE.has('ignorado'));
  assert.ok(STATUS_ITEM_ANALISE.has('ativo'));

  assert.equal(validarItemMarcado({ item_id: 'item-1', como: 'revisar', motivo: 'Checar documento', data: '2026-10-18' }, now), null);
  assert.equal(validarItemMarcado({ item_id: 'item-2', como: 'ignorado', data: '2026-10-18' }, now), null);
  assert.equal(validarItemMarcado({ item_id: 'item-3', como: 'ativo', data: '2026-10-17' }, now), null);
});

test('validarItemMarcado rejeita status inválidos, item_id ausente e limites excedidos', () => {
  const now = '2026-10-18T15:00:00.000Z';
  assert.match(validarItemMarcado(null, now), /inválidos/i);
  assert.match(validarItemMarcado({ como: 'revisar', data: '2026-10-18' }, now), /ID do item/i);
  assert.match(validarItemMarcado({ item_id: '   ', como: 'revisar', data: '2026-10-18' }, now), /ID do item/i);
  assert.match(validarItemMarcado({ item_id: 'item-1', como: 'invalido', data: '2026-10-18' }, now), /Status da marcação inválido/i);
  assert.match(validarItemMarcado({ item_id: 'item-1', como: 'revisar', motivo: 1234, data: '2026-10-18' }, now), /Motivo deve ser um texto/i);
  assert.match(validarItemMarcado({ item_id: 'item-1', como: 'revisar', motivo: 'a'.repeat(501), data: '2026-10-18' }, now), /limite de 500 caracteres/i);
  assert.match(validarItemMarcado({ item_id: 'item-1', como: 'revisar', data: 'invalida' }, now), /Data da marcação inválida/i);
  assert.match(validarItemMarcado({ item_id: 'item-1', como: 'revisar', data: '2026-10-19' }, now), /data futura/i);
});

test('validarLacunaEntrevista aceita item_id e pergunta válidos com ou sem rascunho', () => {
  const now = '2026-10-18T15:00:00.000Z';
  const validoComRascunho = {
    item_id: 'lacuna:sem_fonte:AF-001',
    pergunta: 'Onde está o documento de comprovação?',
    arquivo_rascunho: 'outbox/lacunas/lacuna-sem-fonte-af-001-2026-10-18.md',
    data: '2026-10-18',
  };
  assert.equal(validarLacunaEntrevista(validoComRascunho, now), null);

  const validoSemRascunho = {
    item_id: 'lacuna:sem_fonte:AF-001',
    pergunta: 'Onde está o documento de comprovação?',
    data: '2026-10-18',
  };
  assert.equal(validarLacunaEntrevista(validoSemRascunho, now), null);
});

test('validarLacunaEntrevista rejeita campos inválidos e data futura', () => {
  const now = '2026-10-18T15:00:00.000Z';
  assert.match(validarLacunaEntrevista(null, now), /inválidos/i);
  assert.match(validarLacunaEntrevista({ pergunta: 'Qual?', data: '2026-10-18' }, now), /ID do item/i);
  assert.match(validarLacunaEntrevista({ item_id: '   ', pergunta: 'Qual?', data: '2026-10-18' }, now), /ID do item/i);
  assert.match(validarLacunaEntrevista({ item_id: 'lacuna-1', data: '2026-10-18' }, now), /Pergunta de entrevista é obrigatória/i);
  assert.match(validarLacunaEntrevista({ item_id: 'lacuna-1', pergunta: '   ', data: '2026-10-18' }, now), /Pergunta de entrevista é obrigatória/i);
  assert.match(validarLacunaEntrevista({ item_id: 'lacuna-1', pergunta: 'Qual?', arquivo_rascunho: 123, data: '2026-10-18' }, now), /Caminho do arquivo/i);
  assert.match(validarLacunaEntrevista({ item_id: 'lacuna-1', pergunta: 'Qual?', arquivo_rascunho: '   ', data: '2026-10-18' }, now), /Caminho do arquivo/i);
  assert.match(validarLacunaEntrevista({ item_id: 'lacuna-1', pergunta: 'Qual?', data: 'data-invalida' }, now), /Data de entrevista inválida/i);
  assert.match(validarLacunaEntrevista({ item_id: 'lacuna-1', pergunta: 'Qual?', data: '2026-10-19' }, now), /data futura/i);
});
