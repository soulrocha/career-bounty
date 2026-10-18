import assert from 'node:assert/strict';
import test from 'node:test';
import { projectEvents } from '../../core/store/project.mjs';

function eventoVaga({
  id = 'vaga-01',
  empresa = 'Empresa Alfa',
  cargo = 'Desenvolvedora Sênior',
  url = 'https://example.com/vagas/1',
  data = '2026-10-18'
} = {}) {
  return {
    id: `radar:${id}`,
    ts: `${data}T10:00:00.000Z`,
    host: 'host-1',
    seq: 1,
    ator: 'radar',
    tipo: 'vaga.descoberta',
    entidade: 'vaga',
    entidade_id: id,
    dados: {
      vaga: {
        id,
        empresa,
        cargo,
        url,
        fonte: 'exemplo'
      }
    }
  };
}

function eventoAvaliacao({
  id = 'avaliacao:empresaalfa:2026-10-18',
  empresa = 'Empresa Alfa',
  empresa_chave = 'empresaalfa',
  nota = 4.4,
  quantidade = 85,
  plataforma = 'Glassdoor',
  data = '2026-10-18',
  validade_dias = 90
} = {}) {
  return {
    id,
    ts: `${data}T11:00:00.000Z`,
    host: 'host-1',
    seq: 2,
    ator: 'cli',
    tipo: 'empresa.avaliada',
    entidade: 'empresa',
    entidade_id: empresa_chave,
    dados: {
      empresa,
      empresa_chave,
      nota,
      quantidade,
      plataforma,
      data,
      fontes: [{ url: `https://example.com/${empresa_chave}`, plataforma }],
      resumo: 'Cultura colaborativa e foco em entrega.',
      validade_dias
    }
  };
}

const NOW = new Date('2026-10-18T12:00:00.000Z');

test('vaga recebe empresa_avaliacao quando houver avaliação válida vigente', () => {
  const events = [
    eventoVaga({ id: 'vaga-01', empresa: 'Empresa Alfa' }),
    eventoAvaliacao({ empresa: 'Empresa Alfa', nota: 4.4, quantidade: 85 })
  ];

  const doc = projectEvents(events, { now: NOW });
  const vaga = doc.vagas.find(v => v.id === 'vaga-01');

  assert.ok(vaga);
  assert.ok(vaga.empresa_avaliacao);
  assert.equal(vaga.empresa_avaliacao.nota, 4.4);
  assert.equal(vaga.empresa_avaliacao.quantidade, 85);
  assert.equal(vaga.empresa_avaliacao.plataforma, 'Glassdoor');
  assert.equal(vaga.empresa_avaliacao.data, '2026-10-18');
  assert.equal(vaga.empresa_avaliacao.resumo, 'Cultura colaborativa e foco em entrega.');
  assert.deepEqual(vaga.empresa_avaliacao.fontes, [{ url: 'https://example.com/empresaalfa', plataforma: 'Glassdoor' }]);
});

test('vaga cuja empresa tem avaliação expirada (> 90 dias) NÃO recebe empresa_avaliacao', () => {
  const events = [
    eventoVaga({ id: 'vaga-02', empresa: 'Empresa Alfa' }),
    eventoAvaliacao({
      empresa: 'Empresa Alfa',
      data: '2026-05-01', // mais de 90 dias antes de 2026-10-18
      validade_dias: 90
    })
  ];

  const doc = projectEvents(events, { now: NOW });
  const vaga = doc.vagas.find(v => v.id === 'vaga-02');

  assert.ok(vaga);
  // Regra mandatória: omitido ou nulo, sob nenhuma hipótese nota 0 ou traço
  assert.ok(!vaga.empresa_avaliacao);
});

test('vaga legada que continha avaliação antiga tem campo removido se a avaliação estiver expirada', () => {
  const eventoLegado = {
    id: 'legado:1',
    ts: '2026-10-18T00:00:00.000Z',
    host: 'host-1',
    seq: 1,
    ator: 'migracao',
    tipo: 'legado.importado',
    entidade: 'pipeline',
    entidade_id: 'legado',
    dados: {
      sourceHash: 'sha256-xxx',
      legado: {
        schema_version: 1,
        atualizado: '2026-10-18',
        vagas: [
          {
            id: 'legada-01',
            empresa: 'Empresa Beta',
            cargo: 'Tech Lead',
            empresa_avaliacao: { nota: 3.0, data: '2025-01-01' }
          }
        ]
      }
    }
  };

  const eventoAvaliacaoExpirada = eventoAvaliacao({
    empresa: 'Empresa Beta',
    empresa_chave: 'empresabeta',
    data: '2026-01-01',
    nota: 3.0,
    validade_dias: 90
  });

  const doc = projectEvents([eventoLegado, eventoAvaliacaoExpirada], { now: NOW });
  const vaga = doc.vagas.find(v => v.id === 'legada-01');

  assert.ok(vaga);
  assert.ok(!vaga.empresa_avaliacao);
});

test('vaga recebe avaliação mais recente quando houver histórico de múltiplas avaliações', () => {
  const events = [
    eventoVaga({ id: 'vaga-03', empresa: 'Empresa Alfa' }),
    eventoAvaliacao({
      id: 'av-antiga',
      empresa: 'Empresa Alfa',
      nota: 3.5,
      data: '2026-09-01'
    }),
    eventoAvaliacao({
      id: 'av-nova',
      empresa: 'Empresa Alfa',
      nota: 4.7,
      data: '2026-10-15'
    })
  ];

  const doc = projectEvents(events, { now: NOW });
  const vaga = doc.vagas.find(v => v.id === 'vaga-03');

  assert.ok(vaga);
  assert.equal(vaga.empresa_avaliacao.nota, 4.7);
  assert.equal(vaga.empresa_avaliacao.data, '2026-10-15');
});
