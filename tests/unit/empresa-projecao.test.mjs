import assert from 'node:assert/strict';
import test from 'node:test';
import { companyKey } from '../../core/dedup/keys.mjs';
import { projectAvaliacoes, obterAvaliacaoVigente } from '../../core/store/projections/avaliacoes.mjs';

function eventoAvaliacao({
  id = 'avaliacao:empresaalfa:2026-10-18',
  ts = '2026-10-18T10:00:00.000Z',
  empresa = 'Empresa Alfa',
  empresa_chave = companyKey(empresa),
  nota = 4.3,
  quantidade = 120,
  plataforma = 'Glassdoor',
  data = '2026-10-18',
  fontes = [{ url: 'https://example.com/alfa', plataforma: 'Glassdoor' }],
  resumo = 'Ótimo ambiente.',
  validade_dias = 90
} = {}) {
  return {
    id,
    ts,
    host: 'test-host',
    seq: 1,
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
      fontes,
      resumo,
      validade_dias
    }
  };
}

const NOW = new Date('2026-10-18T12:00:00.000Z');

test('projectAvaliacoes projeta evento empresa.avaliada simples e calcula vigência', () => {
  const eventos = [eventoAvaliacao()];
  const proj = projectAvaliacoes(eventos, { now: NOW });

  assert.equal(proj.total_empresas, 1);
  assert.equal(proj.total_vigentes, 1);
  assert.equal(proj.avaliacoes_vigentes.length, 1);

  const alfa = proj.por_empresa['empresaalfa'];
  assert.ok(alfa);
  assert.equal(alfa.empresa, 'Empresa Alfa');
  assert.equal(alfa.empresa_chave, 'empresaalfa');
  assert.equal(alfa.nota, 4.3);
  assert.equal(alfa.quantidade, 120);
  assert.equal(alfa.plataforma, 'Glassdoor');
  assert.equal(alfa.data, '2026-10-18');
  assert.equal(alfa.valida, true);
  assert.equal(alfa.expirada, false);
  assert.equal(alfa.dias_decorridos, 0);
  assert.equal(alfa.dias_restantes, 90);
  assert.equal(alfa.historico.length, 1);
});

test('projectAvaliacoes ignora outros tipos de eventos', () => {
  const eventos = [
    { tipo: 'vaga.anotada', id: '1', ts: '2026-10-18T10:00:00Z', host: 'h', entidade: 'vaga', entidade_id: '1', dados: {} },
    eventoAvaliacao()
  ];
  const proj = projectAvaliacoes(eventos, { now: NOW });
  assert.equal(proj.total_empresas, 1);
});

test('projectAvaliacoes agrupa múltiplas avaliações sob a mesma empresa e ordena por data decrescente', () => {
  const eventos = [
    eventoAvaliacao({
      id: 'av-1',
      ts: '2026-06-01T10:00:00Z',
      data: '2026-06-01',
      nota: 3.8,
      quantidade: 50
    }),
    eventoAvaliacao({
      id: 'av-2',
      ts: '2026-10-10T10:00:00Z',
      data: '2026-10-10',
      nota: 4.5,
      quantidade: 130
    }),
    eventoAvaliacao({
      id: 'av-3',
      ts: '2026-08-15T10:00:00Z',
      data: '2026-08-15',
      nota: 4.0,
      quantidade: 80
    })
  ];

  const proj = projectAvaliacoes(eventos, { now: NOW });
  const alfa = proj.por_empresa['empresaalfa'];

  // A mais recente (2026-10-10) é o consolidado
  assert.equal(alfa.data, '2026-10-10');
  assert.equal(alfa.nota, 4.5);
  assert.equal(alfa.quantidade, 130);

  // Histórico ordenado decrescente: 2026-10-10, 2026-08-15, 2026-06-01
  assert.equal(alfa.historico.length, 3);
  assert.equal(alfa.historico[0].data, '2026-10-10');
  assert.equal(alfa.historico[1].data, '2026-08-15');
  assert.equal(alfa.historico[2].data, '2026-06-01');
});

test('projectAvaliacoes desempata avaliações com mesma data pelo ts decrescente', () => {
  const eventos = [
    eventoAvaliacao({
      id: 'av-cedo',
      ts: '2026-10-10T08:00:00Z',
      data: '2026-10-10',
      nota: 4.0
    }),
    eventoAvaliacao({
      id: 'av-tarde',
      ts: '2026-10-10T18:00:00Z',
      data: '2026-10-10',
      nota: 4.6
    })
  ];

  const proj = projectAvaliacoes(eventos, { now: NOW });
  const alfa = proj.por_empresa['empresaalfa'];
  assert.equal(alfa.nota, 4.6);
  assert.equal(alfa.id, 'av-tarde');
});

test('projectAvaliacoes marca avaliações com mais de 90 dias como expiradas', () => {
  // NOW é 2026-10-18. 91 dias antes é 2026-07-19
  const eventos = [
    eventoAvaliacao({
      id: 'av-antiga',
      empresa: 'Empresa Beta',
      empresa_chave: companyKey('Empresa Beta'),
      data: '2026-07-18', // 92 dias atrás
      validade_dias: 90
    })
  ];

  const proj = projectAvaliacoes(eventos, { now: NOW });
  assert.equal(proj.total_empresas, 1);
  assert.equal(proj.total_vigentes, 0);
  assert.equal(proj.avaliacoes_vigentes.length, 0);

  const beta = proj.por_empresa['empresabeta'];
  assert.equal(beta.valida, false);
  assert.equal(beta.expirada, true);
  assert.equal(beta.dias_restantes, 0);
  assert.ok(beta.dias_decorridos > 90);
});

test('projectAvaliacoes respeita validade_dias customizada', () => {
  const eventos = [
    eventoAvaliacao({
      id: 'av-curta',
      data: '2026-10-01', // 17 dias atrás
      validade_dias: 15 // expirou
    })
  ];
  const proj = projectAvaliacoes(eventos, { now: NOW });
  assert.equal(proj.por_empresa['empresaalfa'].valida, false);
});

test('obterAvaliacaoVigente retorna dados da avaliação vigente e null quando expirada ou ausente', () => {
  const eventos = [
    eventoAvaliacao({
      empresa: 'Empresa Alfa',
      empresa_chave: companyKey('Empresa Alfa'),
      data: '2026-10-15',
      nota: 4.8
    }),
    eventoAvaliacao({
      empresa: 'Empresa Beta',
      empresa_chave: companyKey('Empresa Beta'),
      data: '2026-01-01', // expirada
      nota: 3.5
    })
  ];

  const proj = projectAvaliacoes(eventos, { now: NOW });

  const avAlfa = obterAvaliacaoVigente('Empresa Alfa', proj);
  assert.deepEqual(avAlfa, {
    nota: 4.8,
    quantidade: 120,
    plataforma: 'Glassdoor',
    data: '2026-10-15',
    fontes: [{ url: 'https://example.com/alfa', plataforma: 'Glassdoor' }],
    resumo: 'Ótimo ambiente.'
  });

  // Empresa Beta está expirada -> retorna null
  assert.equal(obterAvaliacaoVigente('Empresa Beta', proj), null);

  // Empresa Gama não tem avaliação -> retorna null
  assert.equal(obterAvaliacaoVigente('Empresa Gama', proj), null);

  // Entradas inválidas
  assert.equal(obterAvaliacaoVigente('', proj), null);
  assert.equal(obterAvaliacaoVigente(null, proj), null);
  assert.equal(obterAvaliacaoVigente('Empresa Alfa', null), null);
});

test('obterAvaliacaoVigente resolve aliases de empresas', () => {
  const eventos = [
    eventoAvaliacao({
      empresa: 'Empresa Alfa',
      empresa_chave: companyKey('Empresa Alfa')
    })
  ];
  const proj = projectAvaliacoes(eventos, { now: NOW });

  // Com aliases mapeando "alfa corp" -> "empresaalfa"
  const aliases = { 'alfa corp': 'empresaalfa' };
  const av = obterAvaliacaoVigente('Alfa Corp', proj, { aliases });
  assert.ok(av);
  assert.equal(av.nota, 4.3);
});
