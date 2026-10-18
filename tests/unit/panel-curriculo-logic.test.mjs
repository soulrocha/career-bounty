import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SITUACOES,
  METADADOS_SITUACAO,
  FORCA_PROVA,
  normalizarRespostaAnalise,
  normalizarItem,
  categorizarItens,
  calcularTotaisCurriculo,
  filtrarItens,
  ordenarItens,
  obterClasseCorSituacao,
  formatarNivelProvaBadge,
  formatarPesoBadge,
  montarPayloadIncluir,
  montarPayloadMarcar,
  montarPayloadEntrevista,
  obterIconeSvgCurriculo,
  mascararDadoSensivel,
  higienizarItemCurriculo,
} from '../../panel/curriculoLogic.mjs';

test('constantes exportadas: situações, metadados e escala de força de prova', () => {
  assert.deepEqual(SITUACOES, ['confere', 'sem_prova', 'fora_do_cv', 'lacunas']);

  for (const s of SITUACOES) {
    const meta = METADADOS_SITUACAO[s];
    assert.ok(meta, `falta metadados para situação ${s}`);
    assert.ok(meta.nome);
    assert.ok(meta.descricao);
    assert.ok(meta.acaoPadrao);
    assert.ok(meta.corClasse);
    assert.ok(meta.eixoVertical);
    assert.ok(meta.eixoHorizontal);
  }

  assert.equal(FORCA_PROVA.verificado, 3);
  assert.equal(FORCA_PROVA.entregue, 2);
  assert.equal(FORCA_PROVA.proposto, 1);
  assert.equal(FORCA_PROVA.relato, 0);
});

test('normalizarRespostaAnalise: contrato novo padrão direto com 4 situações', () => {
  const dadosApi = {
    confere: [
      { id: 'c1', texto: 'Liderei migração', afirmacoes: ['AF-001'], evidencias: ['EV-001'], nivel_prova: 'verificado' },
    ],
    sem_prova: [
      { id: 's1', texto: 'Melhorei performance', motivo: 'Sem métrica', pergunta: 'Qual ganho?' },
    ],
    fora_do_cv: [
      { id: 'f1', texto: 'Reduziu 30% custos', afirmacoes: [{ id: 'AF-010', nivel_prova: 'entregue' }] },
    ],
    lacunas: [
      { id: 'l1', texto: 'Kubernetes em produção', peso: 5, motivo: 'Pedido em 4 vagas', pergunta: 'Tem experiência?' },
    ],
    avisos: ['Aviso de teste'],
  };

  const norm = normalizarRespostaAnalise(dadosApi);
  assert.equal(norm.confere.length, 1);
  assert.equal(norm.sem_prova.length, 1);
  assert.equal(norm.fora_do_cv.length, 1);
  assert.equal(norm.lacunas.length, 1);

  assert.deepEqual(norm.contagem, {
    confere: 1,
    sem_prova: 1,
    fora_do_cv: 1,
    lacunas: 1,
  });

  assert.equal(norm.confere[0].id, 'c1');
  assert.equal(norm.confere[0].situacao, 'confere');
  assert.equal(norm.sem_prova[0].id, 's1');
  assert.equal(norm.fora_do_cv[0].afirmacoes[0], 'AF-010');
  assert.equal(norm.fora_do_cv[0].nivel_prova, 'entregue');
  assert.equal(norm.lacunas[0].peso, 5);
  assert.deepEqual(norm.avisos, ['Aviso de teste']);
});

test('normalizarRespostaAnalise: contrato F9.5 com chave grupos (confere, sem_prova, fora_do_cv, lacuna/lacunas)', () => {
  const dadosF95 = {
    grupos: {
      confere: [{ id: 'c1', texto: 'Item confere' }],
      sem_prova: [{ id: 's1', texto: 'Item sem prova' }],
      fora_do_cv: [{ id: 'f1', texto: 'Item fora do cv' }],
      lacuna: [{ id: 'l1', texto: 'Item lacuna singular', peso: 4 }],
    },
    avisos: [],
  };

  const norm = normalizarRespostaAnalise(dadosF95);
  assert.equal(norm.confere.length, 1);
  assert.equal(norm.sem_prova.length, 1);
  assert.equal(norm.fora_do_cv.length, 1);
  assert.equal(norm.lacunas.length, 1);
  assert.equal(norm.lacunas[0].id, 'l1');
  assert.equal(norm.lacunas[0].peso, 4);
});

test('normalizarRespostaAnalise: formato legado /api/quadrantes (a, b, c, d)', () => {
  const dadosLegado = {
    a: [{ texto: 'Texto A', claim_ids: ['AF-101'], nivel_prova: 'verificado' }],
    b: [{ id: 'b1', texto: 'Texto B fora do cv', nivel_prova: 'entregue' }],
    c: [{ id: 'c1', texto: 'Texto C sem dado', motivo: 'Sem linha de base' }],
    d: [{ id: 'd1', descricao: 'Texto D lacuna', peso: 3, pergunta_sugerida: 'Como você atuou?' }],
  };

  const norm = normalizarRespostaAnalise(dadosLegado);
  assert.equal(norm.confere.length, 1);
  assert.equal(norm.confere[0].afirmacoes[0], 'AF-101');
  assert.equal(norm.fora_do_cv.length, 1);
  assert.equal(norm.fora_do_cv[0].id, 'b1');
  assert.equal(norm.sem_prova.length, 1);
  assert.equal(norm.sem_prova[0].motivo, 'Sem linha de base');
  assert.equal(norm.lacunas.length, 1);
  assert.equal(norm.lacunas[0].texto, 'Texto D lacuna');
  assert.equal(norm.lacunas[0].peso, 3);
  assert.equal(norm.lacunas[0].pergunta, 'Como você atuou?');
});

test('normalizarRespostaAnalise: dados nulos, undefined ou tipos inválidos retornam fallback seguro', () => {
  for (const entrada of [null, undefined, '', 123, true, []]) {
    const norm = normalizarRespostaAnalise(entrada);
    assert.deepEqual(norm.confere, []);
    assert.deepEqual(norm.sem_prova, []);
    assert.deepEqual(norm.fora_do_cv, []);
    assert.deepEqual(norm.lacunas, []);
    assert.deepEqual(norm.contagem, { confere: 0, sem_prova: 0, fora_do_cv: 0, lacunas: 0 });
    assert.deepEqual(norm.avisos, []);
  }
});

test('normalizarItem: extrai e higieniza campos essenciais', () => {
  const item = normalizarItem({
    alvo: 'item-x',
    descricao: 'Descrição longa',
    claim_ids: ['AF-1'],
    evidencias: ['EV-1'],
    nivel_prova: 'relato',
    peso: 'invalido',
    pergunta_sugerida: 'Pergunta?',
  }, 'sem_prova');

  assert.equal(item.id, 'item-x');
  assert.equal(item.texto, 'Descrição longa');
  assert.deepEqual(item.afirmacoes, ['AF-1']);
  assert.deepEqual(item.evidencias, ['EV-1']);
  assert.equal(item.nivel_prova, 'relato');
  assert.equal(item.peso, null);
  assert.equal(item.pergunta, 'Pergunta?');
  assert.equal(item.situacao, 'sem_prova');
});

test('calcularTotaisCurriculo e categorizarItens: contagens, ignorados e badge com pendências', () => {
  const analise = {
    confere: [{ id: 'c1' }, { id: 'c2' }],
    sem_prova: [{ id: 's1' }, { id: 's2' }],
    fora_do_cv: [{ id: 'f1' }],
    lacunas: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }],
  };

  const totais = calcularTotaisCurriculo(analise);
  assert.equal(totais.confere, 2);
  assert.equal(totais.sem_prova, 2);
  assert.equal(totais.fora_do_cv, 1);
  assert.equal(totais.lacunas, 3);
  assert.equal(totais.badgeCurriculo, 5); // 2 sem_prova + 3 lacunas
  assert.equal(totais.temAtencao, true);

  // Com itens ignorados
  const ignorados = new Set(['s2', 'l1']);
  const totaisComIgnorados = calcularTotaisCurriculo(analise, ignorados);
  assert.equal(totaisComIgnorados.sem_prova, 1);
  assert.equal(totaisComIgnorados.lacunas, 2);
  assert.equal(totaisComIgnorados.badgeCurriculo, 3);
  assert.equal(totaisComIgnorados.temAtencao, true);

  // Sem pendências
  const analiseLimpa = {
    confere: [{ id: 'c1' }],
    sem_prova: [],
    fora_do_cv: [{ id: 'f1' }],
    lacunas: [],
  };
  const totaisLimpos = calcularTotaisCurriculo(analiseLimpa);
  assert.equal(totaisLimpos.badgeCurriculo, 0);
  assert.equal(totaisLimpos.temAtencao, false);
});

test('filtrarItens: busca textual por texto, id, afirmação, motivo e pergunta', () => {
  const itens = [
    { id: 'c1', texto: 'Gestão de times ágeis', afirmacoes: ['AF-001'], evidencias: [], motivo: null, nivel_prova: 'verificado' },
    { id: 's1', texto: 'Performance PostgreSQL', afirmacoes: [], evidencias: [], motivo: 'Falta métrica percentual', nivel_prova: null },
    { id: 'f1', texto: 'Palestra sobre arquitetura', afirmacoes: ['AF-050'], evidencias: [], motivo: null, nivel_prova: 'entregue' },
    { id: 'l1', texto: 'FinOps AWS', afirmacoes: [], evidencias: [], motivo: 'Exigido em 3 vagas', pergunta: 'Qual orçamento?', nivel_prova: null },
  ];

  // Busca por id
  assert.deepEqual(filtrarItens(itens, { busca: 's1' }).map(i => i.id), ['s1']);
  // Busca por texto
  assert.deepEqual(filtrarItens(itens, { busca: 'postgre' }).map(i => i.id), ['s1']);
  // Busca por afirmação
  assert.deepEqual(filtrarItens(itens, { busca: 'AF-050' }).map(i => i.id), ['f1']);
  // Busca por motivo
  assert.deepEqual(filtrarItens(itens, { busca: 'percentual' }).map(i => i.id), ['s1']);
  // Busca por pergunta
  assert.deepEqual(filtrarItens(itens, { busca: 'orçamento' }).map(i => i.id), ['l1']);
  // Filtro por nível de prova
  assert.deepEqual(filtrarItens(itens, { nivel: 'verificado' }).map(i => i.id), ['c1']);
  // Filtro por status
  const itensComStatus = [
    { id: '1', texto: 'A', status: 'ativo' },
    { id: '2', texto: 'B', status: 'revisar' },
    { id: '3', texto: 'C', status: 'ignorado' },
  ];
  assert.deepEqual(filtrarItens(itensComStatus, { status: 'revisar' }).map(i => i.id), ['2']);
  assert.deepEqual(filtrarItens(itensComStatus, { status: 'ignorado' }).map(i => i.id), ['3']);
});

test('ordenarItens: determinismo para cada situação', () => {
  // Lacunas: maior peso DESC, desempate por id ASC
  const lacunas = [
    { id: 'l3', texto: 'Terraform', peso: 2 },
    { id: 'l1', texto: 'Kubernetes', peso: 5 },
    { id: 'l2', texto: 'FinOps', peso: 5 },
  ];
  const ordLacunas = ordenarItens(lacunas, 'lacunas');
  assert.deepEqual(ordLacunas.map(i => i.id), ['l1', 'l2', 'l3']);

  // Fora do CV: maior nível de prova DESC, desempate por id ASC
  const foraDoCv = [
    { id: 'f3', texto: 'Relato', nivel_prova: 'relato' },
    { id: 'f1', texto: 'Verificado', nivel_prova: 'verificado' },
    { id: 'f2', texto: 'Entregue', nivel_prova: 'entregue' },
    { id: 'f0', texto: 'Outro verificado', nivel_prova: 'verificado' },
  ];
  const ordFora = ordenarItens(foraDoCv, 'fora_do_cv');
  assert.deepEqual(ordFora.map(i => i.id), ['f0', 'f1', 'f2', 'f3']);

  // Sem prova: itens com motivo primeiro, desempate por id ASC
  const semProva = [
    { id: 's3', texto: 'Sem motivo', motivo: null },
    { id: 's2', texto: 'Com motivo B', motivo: 'Falta número' },
    { id: 's1', texto: 'Com motivo A', motivo: 'Sem evidência' },
  ];
  const ordSemProva = ordenarItens(semProva, 'sem_prova');
  assert.deepEqual(ordSemProva.map(i => i.id), ['s1', 's2', 's3']);

  // Confere: id ASC
  const confere = [
    { id: 'c3', texto: 'Item 3' },
    { id: 'c1', texto: 'Item 1' },
    { id: 'c2', texto: 'Item 2' },
  ];
  const ordConfere = ordenarItens(confere, 'confere');
  assert.deepEqual(ordConfere.map(i => i.id), ['c1', 'c2', 'c3']);
});

test('obterClasseCorSituacao: mapeamento semântico de cores', () => {
  assert.equal(obterClasseCorSituacao('confere'), 'ok');
  assert.equal(obterClasseCorSituacao('sem_prova'), 'atencao');
  assert.equal(obterClasseCorSituacao('fora_do_cv'), 'info');
  assert.equal(obterClasseCorSituacao('lacunas'), 'perigo');
  assert.equal(obterClasseCorSituacao('desconhecido'), 'normal');
});

test('formatarNivelProvaBadge e formatarPesoBadge: labels e flags visuais', () => {
  assert.deepEqual(formatarNivelProvaBadge('verificado'), {
    label: 'verificado',
    classe: 'nivel-verificado',
    verificado: true,
  });
  assert.deepEqual(formatarNivelProvaBadge('entregue'), {
    label: 'entregue',
    classe: 'nivel-entregue',
    verificado: false,
  });
  assert.equal(formatarNivelProvaBadge(null), null);
  assert.equal(formatarNivelProvaBadge(''), null);

  assert.deepEqual(formatarPesoBadge(5), { label: 'peso 5', peso: 5 });
  assert.deepEqual(formatarPesoBadge(0), { label: 'peso 0', peso: 0 });
  assert.equal(formatarPesoBadge(null), null);
  assert.equal(formatarPesoBadge('5'), null);
});

test('montarPayloadIncluir: validação e estrutura de payload seguro', () => {
  assert.deepEqual(montarPayloadIncluir('f1'), { item_id: 'f1', afirmacao_id: undefined });
  assert.deepEqual(montarPayloadIncluir('f1', { afirmacao_id: 'AF-001' }), { item_id: 'f1', afirmacao_id: 'AF-001' });

  assert.throws(() => montarPayloadIncluir(null), /itemId é obrigatório/);
  assert.throws(() => montarPayloadIncluir(''), /itemId é obrigatório/);
});

test('montarPayloadMarcar: validação de ações válidas e itemId', () => {
  assert.deepEqual(montarPayloadMarcar('s1', 'revisar'), { item_id: 's1', acao: 'revisar' });
  assert.deepEqual(montarPayloadMarcar('s1', 'ignorar'), { item_id: 's1', acao: 'ignorar' });

  assert.throws(() => montarPayloadMarcar(null, 'revisar'), /itemId é obrigatório/);
  assert.throws(() => montarPayloadMarcar('s1', 'acao_invalida'), /Ação inválida/);
});

test('montarPayloadEntrevista: validação de itemId', () => {
  assert.deepEqual(montarPayloadEntrevista('l1'), { item_id: 'l1' });
  assert.throws(() => montarPayloadEntrevista(null), /itemId é obrigatório/);
  assert.throws(() => montarPayloadEntrevista(''), /itemId é obrigatório/);
});

test('obterIconeSvgCurriculo: SVGs inline válidos e zero tags <img>', () => {
  for (const tipo of ['check', 'atencao', 'plus', 'entrevista', 'busca', 'desconhecido']) {
    const svg = obterIconeSvgCurriculo(tipo);
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<\/svg>$/);
    assert.ok(!/<img\b/i.test(svg), `tipo ${tipo} gerou tag img`);
  }
});

test('mascararDadoSensivel: higieniza e-mails e telefones nacionais e internacionais', () => {
  // E-mails
  assert.equal(
    mascararDadoSensivel('Contato pelo email recrutador@empresa.test ou rh@startup.example'),
    'Contato pelo email r***@empresa.test ou r***@startup.example'
  );

  // Telefones nacionais com DDD em parênteses
  assert.equal(
    mascararDadoSensivel(`Ligue no ${['(11)', '98765-4321'].join(' ')} ou ${['(21)', '91234-5678'].join(' ')} para agendar`),
    'Ligue no (11) 9****-**21 ou (21) 9****-**78 para agendar'
  );

  // Telefones nacionais sem parênteses
  assert.equal(
    mascararDadoSensivel(`WhatsApp: ${['31', '99876-5432'].join(' ')} falar com Maria`),
    'WhatsApp: (31) 9****-**32 falar com Maria'
  );

  // Telefones com código internacional +55
  assert.equal(
    mascararDadoSensivel(`Celular ${['+55', '11', '98765-4321'].join(' ')} confirmado`),
    'Celular (11) 9****-**21 confirmado'
  );

  // Telefones internacionais de outros países
  assert.equal(
    mascararDadoSensivel(`Contato fora do país: ${['+1', '415', '555', '2671'].join(' ')}`),
    'Contato fora do país: +1 ****-**71'
  );

  // Texto sem PII permanece inalterado
  assert.equal(
    mascararDadoSensivel('Liderança de 12 engenheiros em microserviços Kubernetes'),
    'Liderança de 12 engenheiros em microserviços Kubernetes'
  );
});

test('higienizarItemCurriculo: mascara texto, motivo e pergunta sem vazar PII no DOM', () => {
  const itemBruto = {
    id: 's1',
    texto: 'Fale com recrutador@empresa.test sobre a vaga',
    motivo: `Número ${['(11)', '98765-4321'].join(' ')} precisa de confirmação`,
    pergunta: `Você pode ligar para ${['+55', '21', '99999-8888'].join(' ')} amanhã?`,
    afirmacoes: ['AF-001'],
  };

  const itemHigienizado = higienizarItemCurriculo(itemBruto);
  assert.equal(itemHigienizado.texto, 'Fale com r***@empresa.test sobre a vaga');
  assert.equal(itemHigienizado.motivo, 'Número (11) 9****-**21 precisa de confirmação');
  assert.equal(itemHigienizado.pergunta, 'Você pode ligar para (21) 9****-**88 amanhã?');
  assert.deepEqual(itemHigienizado.afirmacoes, ['AF-001']);

  // Garantir que dados originais não vazam
  assert.ok(!itemHigienizado.texto.includes('recrutador@empresa.test'));
  assert.ok(!itemHigienizado.motivo.includes('98765-4321'));
  assert.ok(!itemHigienizado.pergunta.includes('99999-8888'));
});

