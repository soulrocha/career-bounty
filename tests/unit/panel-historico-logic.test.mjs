import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TIPOS_EVENTO,
  ROTULOS_TIPO,
  ROTULOS_ORIGEM,
  ROTULOS_SITUACAO,
  CORES_TIPO,
  formatarDataPtBr,
  obterClasseCorEvento,
  obterIconeSvg,
  filtrarHistorico,
  extrairPortaisHistorico,
  calcularTotaisHistorico,
} from '../../panel/historicoLogic.mjs';

test('formatarDataPtBr: formata datas AAAA-MM-DD e ISO para DD/MM/AAAA com tratamento seguro', () => {
  assert.equal(formatarDataPtBr('2026-10-18'), '18/10/2026');
  assert.equal(formatarDataPtBr('2026-10-18T14:30:00.000Z'), '18/10/2026');
  assert.equal(formatarDataPtBr('2026-01-05T00:00:00Z'), '05/01/2026');
  assert.equal(formatarDataPtBr(null), '');
  assert.equal(formatarDataPtBr(undefined), '');
  assert.equal(formatarDataPtBr(''), '');
  assert.equal(formatarDataPtBr(123), '');
  assert.equal(formatarDataPtBr('hoje'), 'hoje');
});

test('obterClasseCorEvento: mapeia corretamente para cada tipo de evento e desfecho', () => {
  assert.equal(obterClasseCorEvento('descoberta'), 'descoberta');
  assert.equal(obterClasseCorEvento('candidatura'), 'candidatura');
  assert.equal(obterClasseCorEvento('etapa'), 'etapa');
  assert.equal(obterClasseCorEvento('contato'), 'contato');
  assert.equal(obterClasseCorEvento('descarte'), 'descarte');
  assert.equal(obterClasseCorEvento('desfecho', 'aprovado'), 'desfecho-aprovado');
  assert.equal(obterClasseCorEvento('desfecho', 'reprovado'), 'desfecho-encerrado');
  assert.equal(obterClasseCorEvento('desfecho', 'desistencia'), 'desfecho-encerrado');
  assert.equal(obterClasseCorEvento('desfecho', null), 'desfecho-encerrado');
});

test('constantes de metadados: cobrem todos os tipos, origens e situações', () => {
  assert.deepEqual(TIPOS_EVENTO, ['descoberta', 'candidatura', 'etapa', 'contato', 'desfecho', 'descarte']);
  for (const tipo of TIPOS_EVENTO) {
    assert.ok(ROTULOS_TIPO[tipo], `falta rótulo para tipo ${tipo}`);
  }
  for (const origem of ['radar', 'painel', 'email', 'cli', 'recrutador', 'candidato']) {
    assert.ok(ROTULOS_ORIGEM[origem], `falta rótulo para origem ${origem}`);
  }
  for (const sit of ['ativo', 'aguardando_retorno', 'aguardando_voce', 'encerrado']) {
    assert.ok(ROTULOS_SITUACAO[sit], `falta rótulo para situação ${sit}`);
  }
  assert.ok(CORES_TIPO.descoberta);
  assert.ok(CORES_TIPO.candidatura);
  assert.ok(CORES_TIPO.etapa);
  assert.ok(CORES_TIPO.contato);
});

test('obterIconeSvg: retorna SVG inline válido e sem nenhuma tag <img>', () => {
  for (const tipo of TIPOS_EVENTO) {
    const svg = obterIconeSvg(tipo);
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<\/svg>$/);
    assert.ok(!/<img\b/i.test(svg), `tipo ${tipo} gerou tag img`);
  }
  const svgAprovado = obterIconeSvg('desfecho', { desfecho: 'aprovado' });
  assert.match(svgAprovado, /^<svg\b/);
  assert.ok(!/<img\b/i.test(svgAprovado));

  const svgDesconhecido = obterIconeSvg('tipo_inexistente');
  assert.match(svgDesconhecido, /^<svg\b/);
  assert.ok(!/<img\b/i.test(svgDesconhecido));
});

test('filtrarHistorico: filtra por periodo, situacao, portal e busca textual', () => {
  const dados = [
    {
      vaga_id: 'v1',
      empresa: 'CorpTech Solutions',
      cargo: 'Arquiteto de Software',
      portal: 'gupy',
      situacao_processo: 'aguardando_retorno',
      desfecho: null,
      ultimo_movimento: '2026-10-18',
      linha_do_tempo: [
        { tipo: 'descoberta', titulo: 'Descoberta', detalhe: 'https://corptech.test', origem: 'radar' },
        { tipo: 'contato', titulo: 'Contato inicial', resumo: 'Envio de teste técnico', origem: 'recrutador' },
      ],
    },
    {
      vaga_id: 'v2',
      empresa: 'Inova Brasil',
      cargo: 'Engenheiro de Dados',
      portal: 'lever',
      situacao_processo: 'ativo',
      desfecho: null,
      ultimo_movimento: '2026-10-12',
      linha_do_tempo: [
        { tipo: 'descoberta', titulo: 'Descoberta', detalhe: null, origem: 'radar' },
      ],
    },
    {
      vaga_id: 'v3',
      empresa: 'Beta Labs',
      cargo: 'Tech Lead',
      portal: 'gupy',
      situacao_processo: 'encerrado',
      desfecho: 'reprovado',
      ultimo_movimento: '2026-10-05',
      linha_do_tempo: [
        { tipo: 'descoberta', titulo: 'Descoberta', detalhe: null, origem: 'radar' },
        { tipo: 'desfecho', titulo: 'Processo encerrado', motivo: 'Vaga cancelada', origem: 'painel' },
      ],
    },
  ];

  // Sem filtros: retorna todos ordenados por ultimo_movimento decrescente
  const todos = filtrarHistorico(dados);
  assert.equal(todos.length, 3);
  assert.deepEqual(todos.map(v => v.vaga_id), ['v1', 'v2', 'v3']);

  // Filtro por inicio
  const aposDia10 = filtrarHistorico(dados, { inicio: '2026-10-10' });
  assert.deepEqual(aposDia10.map(v => v.vaga_id), ['v1', 'v2']);

  // Filtro por fim
  const ateDia12 = filtrarHistorico(dados, { fim: '2026-10-12' });
  assert.deepEqual(ateDia12.map(v => v.vaga_id), ['v2', 'v3']);

  // Filtro por período exato
  const intervalo = filtrarHistorico(dados, { inicio: '2026-10-06', fim: '2026-10-15' });
  assert.deepEqual(intervalo.map(v => v.vaga_id), ['v2']);

  // Filtro por situacao
  const aguardando = filtrarHistorico(dados, { situacao: 'aguardando_retorno' });
  assert.deepEqual(aguardando.map(v => v.vaga_id), ['v1']);

  // Filtro por portal
  const gupy = filtrarHistorico(dados, { portal: 'Gupy' });
  assert.deepEqual(gupy.map(v => v.vaga_id), ['v1', 'v3']);

  // Busca textual por empresa
  const buscaEmpresa = filtrarHistorico(dados, { busca: 'corptech' });
  assert.deepEqual(buscaEmpresa.map(v => v.vaga_id), ['v1']);

  // Busca textual com acentuação e case insensitive em cargo
  const buscaCargo = filtrarHistorico(dados, { busca: 'engenheiro' });
  assert.deepEqual(buscaCargo.map(v => v.vaga_id), ['v2']);

  // Busca textual em detalhes da linha do tempo
  const buscaTimeline = filtrarHistorico(dados, { busca: 'teste tecnico' });
  assert.deepEqual(buscaTimeline.map(v => v.vaga_id), ['v1']);

  const buscaMotivo = filtrarHistorico(dados, { busca: 'cancelada' });
  assert.deepEqual(buscaMotivo.map(v => v.vaga_id), ['v3']);

  // Busca sem match
  const buscaVazia = filtrarHistorico(dados, { busca: 'inexistente' });
  assert.equal(buscaVazia.length, 0);
});

test('extrairPortaisHistorico: extrai lista única, normalizada e ordenada de portais', () => {
  const dados = [
    { portal: 'Gupy' },
    { portal: 'lever' },
    { portal: 'GUPY' },
    { portal: '  ashby  ' },
    { portal: null },
    { portal: '' },
    { portal: undefined },
  ];
  assert.deepEqual(extrairPortaisHistorico(dados), ['ashby', 'gupy', 'lever']);
  assert.deepEqual(extrairPortaisHistorico([]), []);
  assert.deepEqual(extrairPortaisHistorico(null), []);
});

test('calcularTotaisHistorico: calcula contagens corretas por situação', () => {
  const dados = [
    { situacao_processo: 'ativo' },
    { situacao_processo: 'ativo' },
    { situacao_processo: 'aguardando_retorno' },
    { situacao_processo: 'aguardando_voce' },
    { situacao_processo: 'encerrado' },
    { situacao_processo: 'encerrado' },
  ];
  assert.deepEqual(calcularTotaisHistorico(dados), {
    total: 6,
    ativos: 2,
    aguardando_retorno: 1,
    aguardando_voce: 1,
    encerrados: 2,
  });
  assert.deepEqual(calcularTotaisHistorico([]), {
    total: 0,
    ativos: 0,
    aguardando_retorno: 0,
    aguardando_voce: 0,
    encerrados: 0,
  });
});
