import test from 'node:test';
import assert from 'node:assert/strict';
import { validarEntrevistaPreparada } from '../../core/store/rules.mjs';
import { projectEntrevistas } from '../../core/store/projections/entrevistas.mjs';

test('Fase 1: Regras e Validação de Eventos - entrevista.preparada', async (t) => {
  const nowTs = '2026-10-18T16:00:00.000-03:00';

  await t.test('aceita payload válido', () => {
    const dados = {
      vaga_id: 'vaga-tech-01',
      arquivo: 'outbox/entrevistas/entrevista-vaga-tech-01-2026-10-18.md',
      data: '2026-10-18',
      pontos_fortes_count: 3,
      lacunas_count: 1,
    };
    const erro = validarEntrevistaPreparada(dados, nowTs);
    assert.equal(erro, null);
  });

  await t.test('rejeita se dados não for objeto ou for array', () => {
    assert.match(validarEntrevistaPreparada(null, nowTs), /inválidos/i);
    assert.match(validarEntrevistaPreparada(undefined, nowTs), /inválidos/i);
    assert.match(validarEntrevistaPreparada([], nowTs), /inválidos/i);
    assert.match(validarEntrevistaPreparada('string', nowTs), /inválidos/i);
  });

  await t.test('rejeita vaga_id vazio, nulo ou não-string', () => {
    assert.match(validarEntrevistaPreparada({ vaga_id: '', arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /ID da vaga/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: '   ', arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /ID da vaga/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 123, arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /ID da vaga/i);
  });

  await t.test('rejeita arquivo inválido ou com path traversal', () => {
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: '', data: '2026-10-18', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /arquivo.*obrigatório/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: '../hack.md', data: '2026-10-18', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /não pode conter "\.\."/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/../hack.md', data: '2026-10-18', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /não pode conter "\.\."/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/\0hack.md', data: '2026-10-18', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /caracteres nulos/i);
  });

  await t.test('rejeita data inválida ou futura no fuso de SP', () => {
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '18/10/2026', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /AAAA-MM-DD/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '2026-02-30', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /AAAA-MM-DD/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '2026-10-19', pontos_fortes_count: 1, lacunas_count: 0 }, nowTs), /não pode ter data futura/i);
  });

  await t.test('rejeita contadores negativos ou não inteiros', () => {
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: -1, lacunas_count: 0 }, nowTs), /pontos fortes.*>= 0/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: 1.5, lacunas_count: 0 }, nowTs), /pontos fortes.*>= 0/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: '2', lacunas_count: 0 }, nowTs), /pontos fortes.*>= 0/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: 0, lacunas_count: -1 }, nowTs), /lacunas.*>= 0/i);
    assert.match(validarEntrevistaPreparada({ vaga_id: 'vaga-1', arquivo: 'outbox/a.md', data: '2026-10-18', pontos_fortes_count: 0, lacunas_count: 2.3 }, nowTs), /lacunas.*>= 0/i);
  });

  await t.test('projectEntrevistas: projeta histórico e registros por vaga', () => {
    const eventos = [
      {
        id: 'ev-1',
        tipo: 'vaga.avaliada',
        ts: '2026-10-17T10:00:00.000Z',
        dados: { vaga_id: 'vaga-1' },
      },
      {
        id: 'ev-2',
        tipo: 'entrevista.preparada',
        ts: '2026-10-17T12:00:00.000Z',
        dados: {
          vaga_id: 'vaga-1',
          arquivo: 'outbox\\entrevistas\\entrevista-vaga-1-2026-10-17.md',
          data: '2026-10-17',
          pontos_fortes_count: 2,
          lacunas_count: 1,
        },
      },
      {
        id: 'ev-3',
        tipo: 'entrevista.preparada',
        ts: '2026-10-18T14:00:00.000Z',
        dados: {
          vaga_id: 'vaga-2',
          arquivo: 'outbox/entrevistas/entrevista-vaga-2-2026-10-18.md',
          data: '2026-10-18',
          pontos_fortes_count: 4,
          lacunas_count: 0,
        },
      },
      {
        id: 'ev-4',
        tipo: 'entrevista.preparada',
        ts: '2026-10-18T16:00:00.000Z',
        dados: {
          vaga_id: 'vaga-1',
          arquivo: 'outbox/entrevistas/entrevista-vaga-1-2026-10-18.md',
          data: '2026-10-18',
          pontos_fortes_count: 3,
          lacunas_count: 1,
        },
      },
    ];

    const proj = projectEntrevistas(eventos);
    assert.equal(proj.total_preparadas, 2);
    assert.equal(proj.historico.length, 3);
    assert.equal(proj.por_vaga['vaga-1'].arquivo, 'outbox/entrevistas/entrevista-vaga-1-2026-10-18.md');
    assert.equal(proj.por_vaga['vaga-1'].pontos_fortes_count, 3);
    assert.equal(proj.por_vaga['vaga-2'].pontos_fortes_count, 4);
    assert.equal(proj.historico[0].arquivo, 'outbox/entrevistas/entrevista-vaga-1-2026-10-17.md');
  });
});
