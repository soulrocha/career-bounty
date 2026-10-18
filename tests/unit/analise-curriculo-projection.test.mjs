import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAnaliseCurriculo } from '../../core/store/projections/analiseCurriculo.mjs';

const CAMPOS_OBRIGATORIOS = [
  'id',
  'grupo',
  'tipo_origem',
  'texto',
  'afirmacoes',
  'evidencias',
  'nivel_prova',
  'motivo',
  'pergunta',
  'peso',
  'status',
];

function fixtureQuadrantes() {
  return {
    a: [
      {
        modelo: 'cv',
        secao: 'experiencia',
        linha: 10,
        texto: 'Liderou time de 10 engenheiros aumentando throughput em 35%.',
        claim_ids: ['AF-001'],
        afirmacoes: [{ id: 'AF-001', nivel_prova: 'verificado' }],
      },
      {
        modelo: 'cv',
        secao: 'experiencia',
        linha: 15,
        texto: 'Entregou migração para cloud economizando R$ 50 mil.',
        claim_ids: ['AF-002'],
        afirmacoes: [{ id: 'AF-002', nivel_prova: 'entregue' }],
      },
    ],
    b: [
      {
        tipo: 'afirmacao',
        id: 'AF-034',
        nivel_prova: 'verificado',
        texto: 'Publicou artigo técnico sobre arquitetura event-driven.',
        motivo: 'afirmação liberada para CV que nenhum bullet cita',
      },
      {
        tipo: 'arco',
        id: 'AR-001',
        titulo: 'Reestruturação de legado',
        motivo: 'arco ou história sem afirmação ligada',
      },
    ],
    c: [
      {
        modelo: 'cv',
        secao: 'experiencia',
        linha: 20,
        texto: 'Gerenciou orçamento de 2 milhões sem documento.',
        claim_ids: ['AF-099'],
        codigo: 'afirmacao_sem_prova',
        motivo: 'AF-099 (relato) usada como fato; só verificado ou entregue sustenta número e fato no CV',
      },
      {
        modelo: 'cv',
        secao: 'resumo',
        linha: 5,
        texto: 'Especialista em microsserviços e resiliência.',
        claim_ids: [],
        sem_marca: true,
        codigo: 'sem_marca',
        motivo: 'bullet sem marca de afirmação (mapeie a uma afirmação ou remova)',
      },
    ],
    d: [
      {
        id: 'sem_fonte:AF-010',
        tipo: 'sem_fonte',
        origem: 'afirmacao',
        alvo: 'AF-010',
        peso: 5,
        descricao: 'AF-010 não tem evidência ligada',
        pergunta_sugerida: 'Onde está o registro que sustenta AF-010?',
      },
      {
        id: 'buraco_timeline:2020-01..2020-08',
        tipo: 'buraco_timeline',
        origem: 'timeline',
        alvo: '2020-01..2020-08',
        peso: 7,
        descricao: 'Sem afirmações entre 2020-01 e 2020-08 (7 meses)',
        pergunta_sugerida: 'O que você fez entre 2020-01 e 2020-08?',
      },
    ],
    contagem: { a: 2, b: 2, c: 2, d: 2 },
    avisos: ['Aviso teste de quadrantes'],
  };
}

function fixtureEvidencias() {
  return [
    { id: 'EV-001', afirmacoes: ['AF-001'] },
    { id: 'EV-002', afirmacoes: ['AF-001', 'AF-002'] },
    { id: 'EV-034', afirmacoes: ['AF-034'] },
  ];
}

test('projectAnaliseCurriculo produz formato uniforme em todos os 4 grupos', () => {
  const quadrantes = fixtureQuadrantes();
  const evidencias = fixtureEvidencias();
  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias });

  const todosItens = [
    ...projecao.grupos.confere,
    ...projecao.grupos.sem_prova,
    ...projecao.grupos.fora_do_cv,
    ...projecao.grupos.lacuna,
  ];

  assert.equal(todosItens.length, 8);

  for (const item of todosItens) {
    for (const campo of CAMPOS_OBRIGATORIOS) {
      assert.ok(campo in item, `Campo ${campo} ausente no item ${item.id}`);
    }
    assert.ok(['confere', 'sem_prova', 'fora_do_cv', 'lacuna'].includes(item.grupo));
    assert.ok(typeof item.id === 'string' && item.id.length > 0);
    assert.ok(typeof item.texto === 'string' && item.texto.length > 0);
    assert.ok(Array.isArray(item.afirmacoes));
    assert.ok(Array.isArray(item.evidencias));
    assert.ok(['verificado', 'entregue', 'relato', 'proposta', 'nenhum'].includes(item.nivel_prova));
    assert.ok(typeof item.motivo === 'string');
    assert.ok(typeof item.peso === 'number' && Number.isInteger(item.peso));
    assert.ok(['ativo', 'revisar', 'ignorado'].includes(item.status));
  }
});

test('projectAnaliseCurriculo mapeia IDs estáveis determinísticos por padrão', () => {
  const quadrantes = fixtureQuadrantes();
  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: fixtureEvidencias() });

  assert.equal(projecao.grupos.confere[0].id, 'confere:claim:AF-001');
  assert.equal(projecao.grupos.confere[1].id, 'confere:claim:AF-002');
  assert.equal(projecao.grupos.fora_do_cv[0].id, 'fora_do_cv:af:AF-034');
  assert.equal(projecao.grupos.fora_do_cv[1].id, 'fora_do_cv:arco:AR-001');
  assert.equal(projecao.grupos.sem_prova[0].id, 'sem_prova:cv:linha:20');
  assert.equal(projecao.grupos.sem_prova[1].id, 'sem_prova:cv:linha:5');
  assert.equal(projecao.grupos.lacuna[0].id, 'lacuna:sem_fonte:AF-010');
  assert.equal(projecao.grupos.lacuna[1].id, 'lacuna:buraco_timeline:2020-01..2020-08');
});

test('projectAnaliseCurriculo usa linha de modelo para confere quando houver colisão de claim', () => {
  const quadrantes = {
    a: [
      { modelo: 'cv-ats', secao: 'exp', linha: 10, texto: 'Texto 1', claim_ids: ['AF-001'] },
      { modelo: 'cv-ats', secao: 'exp', linha: 12, texto: 'Texto 2', claim_ids: ['AF-001'] },
    ],
    b: [],
    c: [],
    d: [],
    contagem: { a: 2, b: 0, c: 0, d: 0 },
  };
  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: [] });
  assert.equal(projecao.grupos.confere[0].id, 'confere:cv-ats:linha:10');
  assert.equal(projecao.grupos.confere[1].id, 'confere:cv-ats:linha:12');
});

test('projectAnaliseCurriculo mapeia mapa inverso de evidências', () => {
  const quadrantes = fixtureQuadrantes();
  const evidencias = fixtureEvidencias();
  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias });

  const confere1 = projecao.grupos.confere.find(i => i.id === 'confere:claim:AF-001');
  assert.deepEqual(confere1.evidencias.sort(), ['EV-001', 'EV-002']);

  const foraCv1 = projecao.grupos.fora_do_cv.find(i => i.id === 'fora_do_cv:af:AF-034');
  assert.deepEqual(foraCv1.evidencias, ['EV-034']);
});

test('projectAnaliseCurriculo reage a eventos analise.item_marcado', () => {
  const quadrantes = fixtureQuadrantes();
  const eventos = [
    {
      tipo: 'analise.item_marcado',
      ts: '2026-10-18T10:00:00.000Z',
      dados: {
        item_id: 'sem_prova:cv:linha:20',
        como: 'revisar',
        motivo: 'Buscar contrato com gestor',
        data: '2026-10-18',
      },
    },
    {
      tipo: 'analise.item_marcado',
      ts: '2026-10-18T11:00:00.000Z',
      dados: {
        item_id: 'sem_prova:cv:linha:5',
        como: 'ignorado',
        motivo: 'Texto genérico dispensável',
        data: '2026-10-18',
      },
    },
    // Marcação posterior para o mesmo item sobrescreve
    {
      tipo: 'analise.item_marcado',
      ts: '2026-10-18T12:00:00.000Z',
      dados: {
        item_id: 'sem_prova:cv:linha:20',
        como: 'ignorado',
        motivo: 'Decidi remover este bullet',
        data: '2026-10-18',
      },
    },
  ];

  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: [], eventos });
  const item20 = projecao.grupos.sem_prova.find(i => i.id === 'sem_prova:cv:linha:20');
  const item5 = projecao.grupos.sem_prova.find(i => i.id === 'sem_prova:cv:linha:5');

  assert.equal(item20.status, 'ignorado');
  assert.equal(item5.status, 'ignorado');
  assert.equal(projecao.contadores.ignorados, 2);
  assert.equal(projecao.contadores.ativos, 6);
});

test('projectAnaliseCurriculo reage a eventos analise.afirmacao_incluida', () => {
  const quadrantes = fixtureQuadrantes();
  const eventos = [
    {
      tipo: 'analise.afirmacao_incluida',
      ts: '2026-10-18T10:00:00.000Z',
      dados: {
        afirmacao_id: 'AF-034',
        experiencia_id: 'exp-alfa',
        data: '2026-10-18',
      },
    },
  ];

  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: [], eventos });
  const itemAf34 = projecao.grupos.fora_do_cv.find(i => i.id === 'fora_do_cv:af:AF-034');

  assert.deepEqual(itemAf34.inclusao, {
    incluida: true,
    experiencia_id: 'exp-alfa',
    data: '2026-10-18',
  });
});

test('projectAnaliseCurriculo reage a eventos analise.lacuna_entrevista com tolerância a prefixo', () => {
  const quadrantes = fixtureQuadrantes();
  const eventos = [
    {
      tipo: 'analise.lacuna_entrevista',
      ts: '2026-10-18T10:00:00.000Z',
      dados: {
        item_id: 'lacuna:sem_fonte:AF-010',
        pergunta: 'Onde está a comprovação de AF-010?',
        arquivo_rascunho: 'outbox/lacunas/lacuna-sem-fonte-af-010-2026-10-18.md',
        data: '2026-10-18',
      },
    },
  ];

  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: [], eventos });
  const lacuna1 = projecao.grupos.lacuna.find(i => i.id === 'lacuna:sem_fonte:AF-010');

  assert.deepEqual(lacuna1.entrevista, {
    pergunta: 'Onde está a comprovação de AF-010?',
    data: '2026-10-18',
    arquivo_rascunho: 'outbox/lacunas/lacuna-sem-fonte-af-010-2026-10-18.md',
  });
});

test('projectAnaliseCurriculo calcula contadores agregados determinísticos', () => {
  const quadrantes = fixtureQuadrantes();
  const eventos = [
    {
      tipo: 'analise.item_marcado',
      ts: '2026-10-18T10:00:00.000Z',
      dados: { item_id: 'confere:claim:AF-001', como: 'revisar', data: '2026-10-18' },
    },
    {
      tipo: 'analise.item_marcado',
      ts: '2026-10-18T10:05:00.000Z',
      dados: { item_id: 'sem_prova:cv:linha:5', como: 'ignorado', data: '2026-10-18' },
    },
  ];

  const projecao = projectAnaliseCurriculo({ quadrantes, evidencias: [], eventos });

  assert.deepEqual(projecao.contadores, {
    total: 8,
    confere: 2,
    sem_prova: 2,
    fora_do_cv: 2,
    lacuna: 2,
    ativos: 6,
    revisar: 1,
    ignorados: 1,
  });
  assert.deepEqual(projecao.avisos, ['Aviso teste de quadrantes']);
});

test('projectAnaliseCurriculo lida com base vazia de forma segura', () => {
  const projecao = projectAnaliseCurriculo({
    quadrantes: { a: [], b: [], c: [], d: [], contagem: { a: 0, b: 0, c: 0, d: 0 } },
    evidencias: [],
    eventos: [],
  });

  assert.deepEqual(projecao.grupos, { confere: [], sem_prova: [], fora_do_cv: [], lacuna: [] });
  assert.deepEqual(projecao.contadores, {
    total: 0,
    confere: 0,
    sem_prova: 0,
    fora_do_cv: 0,
    lacuna: 0,
    ativos: 0,
    revisar: 0,
    ignorados: 0,
  });
  assert.deepEqual(projecao.avisos, []);
});
