import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTexto,
  calcularRecadoCoruja,
  alternarEstadoAnimacao,
  filtrarRespostasFormulario,
  formatarCoberturaFontes,
} from '../../panel/menuCorujaLogic.mjs';

test('menuCorujaLogic: normalizarTexto remove acentos e converte para minúsculas', () => {
  assert.equal(normalizarTexto('Pretensão Salarial'), 'pretensao salarial');
  assert.equal(normalizarTexto('  AÇÕES  '), 'acoes');
  assert.equal(normalizarTexto(null), '');
  assert.equal(normalizarTexto(undefined), '');
});

test('menuCorujaLogic: calcularRecadoCoruja na aba vagas', () => {
  // Lista vazia
  const vazia = calcularRecadoCoruja({ aba: 'vagas', vagas: [] });
  assert.equal(vazia.texto, 'Nenhuma vaga ativa na rodada atual.');
  assert.equal(vazia.temNovidade, false);
  assert.equal(vazia.contagem, 0);
  assert.equal(vazia.aba, 'vagas');

  // Apenas vagas descartadas ou aplicadas
  const descartadas = calcularRecadoCoruja({
    aba: 'vagas',
    vagas: [
      { id: 'v1', descarte_usuario: { descartada: true }, aderencia: 'alta' },
      { id: 'v2', candidatura_usuario: { aplicada: true }, aderencia: 'alta' },
      { id: 'v3', url_status: 'encerrada', aderencia: 'alta' },
    ],
  });
  assert.equal(descartadas.texto, 'Nenhuma vaga ativa na rodada atual.');
  assert.equal(descartadas.temNovidade, false);

  // Vagas ativas sem alta aderência
  const semAltas = calcularRecadoCoruja({
    aba: 'vagas',
    vagas: [
      { id: 'v1', aderencia: 'media' },
      { id: 'v2', aderencia: 'baixa' },
    ],
  });
  assert.equal(semAltas.texto, '2 vagas na rodada. Nenhuma de alta aderência pendente.');
  assert.equal(semAltas.temNovidade, false);
  assert.equal(semAltas.contagem, 0);

  // 1 vaga ativa sem alta aderência (singular)
  const umaSemAlta = calcularRecadoCoruja({
    aba: 'vagas',
    vagas: [{ id: 'v1', aderencia: 'media' }],
  });
  assert.equal(umaSemAlta.texto, '1 vaga na rodada. Nenhuma de alta aderência pendente.');

  // Vagas com alta aderência pendentes
  const comAltas = calcularRecadoCoruja({
    aba: 'vagas',
    vagas: [
      { id: 'v1', aderencia: 'alta' },
      { id: 'v2', aderencia: 'alta' },
      { id: 'v3', aderencia: 'media' },
    ],
  });
  assert.equal(comAltas.texto, '3 vagas novas na rodada, 2 de alta aderência.');
  assert.equal(comAltas.temNovidade, true);
  assert.equal(comAltas.contagem, 2);

  // 1 vaga nova com 1 de alta (singular)
  const umaAlta = calcularRecadoCoruja({
    aba: 'vagas',
    vagas: [{ id: 'v1', aderencia: 'alta' }],
  });
  assert.equal(umaAlta.texto, '1 vaga nova na rodada, 1 de alta aderência.');
  assert.equal(umaAlta.temNovidade, true);
  assert.equal(umaAlta.contagem, 1);
});

test('menuCorujaLogic: calcularRecadoCoruja na aba processos', () => {
  // Sem processos
  const vazia = calcularRecadoCoruja({ aba: 'processos', processos: [] });
  assert.equal(vazia.texto, 'Nenhum processo seletivo em andamento.');
  assert.equal(vazia.temNovidade, false);
  assert.equal(vazia.contagem, 0);

  // Todos recentes (e um encerrado)
  const recentes = calcularRecadoCoruja({
    aba: 'processos',
    processos: [
      { id: 'p1', situacao: 'inscrito', dias_inatividade: 2 },
      { id: 'p2', situacao: 'entrevista', dias_sem_contato: 3 },
      { id: 'p3', situacao: 'encerrado', dias_inatividade: 15 },
    ],
  });
  assert.equal(recentes.texto, 'Todos os processos estão com contato recente.');
  assert.equal(recentes.temNovidade, false);
  assert.equal(recentes.contagem, 0);

  // Com inatividade >= 5 dias ou alerta de atenção/lembrar
  const comParados = calcularRecadoCoruja({
    aba: 'processos',
    processos: [
      { id: 'p1', situacao: 'inscrito', dias_inatividade: 7 },
      { id: 'p2', situacao: 'entrevista', alerta: 'lembrar' },
      { id: 'p3', situacao: 'inscrito', dias_inatividade: 1 },
    ],
  });
  assert.equal(comParados.texto, '2 processos sem retorno há mais de 5 dias.');
  assert.equal(comParados.temNovidade, true);
  assert.equal(comParados.contagem, 2);

  // 1 processo parado (singular)
  const umParado = calcularRecadoCoruja({
    aba: 'processos',
    processos: [
      { id: 'p1', situacao: 'inscrito', dias_inatividade: 5 },
    ],
  });
  assert.equal(umParado.texto, '1 processo sem retorno há mais de 5 dias.');
  assert.equal(umParado.temNovidade, true);
  assert.equal(umParado.contagem, 1);
});

test('menuCorujaLogic: calcularRecadoCoruja na aba curriculo', () => {
  // 100% comprovado
  const comprovado = calcularRecadoCoruja({
    aba: 'curriculo',
    analiseCurriculo: {
      contadores: { lacuna: 0, sem_prova: 0 },
    },
  });
  assert.equal(comprovado.texto, 'Currículo 100% comprovado pela base de dados.');
  assert.equal(comprovado.temNovidade, false);
  assert.equal(comprovado.contagem, 0);

  // Com lacunas e itens sem prova
  const comPendencias = calcularRecadoCoruja({
    aba: 'curriculo',
    analiseCurriculo: {
      contadores: { lacuna: 3, sem_prova: 2 },
    },
  });
  assert.equal(comPendencias.texto, '3 lacunas e 2 itens sem prova identificados.');
  assert.equal(comPendencias.temNovidade, true);
  assert.equal(comPendencias.contagem, 5);

  // Singular de lacuna e sem prova
  const singular = calcularRecadoCoruja({
    aba: 'curriculo',
    analiseCurriculo: {
      grupos: { lacunas: [{ id: 'l1' }], sem_prova: [{ id: 'p1' }] },
    },
  });
  assert.equal(singular.texto, '1 lacuna e 1 item sem prova identificados.');
  assert.equal(singular.temNovidade, true);
  assert.equal(singular.contagem, 2);
});

test('menuCorujaLogic: calcularRecadoCoruja na aba historico', () => {
  // Histórico vazio
  const vazio = calcularRecadoCoruja({ aba: 'historico', historico: [] });
  assert.equal(vazio.texto, 'Nenhuma candidatura registrada no histórico.');
  assert.equal(vazio.temNovidade, false);
  assert.equal(vazio.contagem, 0);

  // 1 candidatura
  const uma = calcularRecadoCoruja({ aba: 'historico', historico: [{ id: 'h1' }] });
  assert.equal(uma.texto, '1 candidatura registrada no histórico.');
  assert.equal(uma.temNovidade, false);
  assert.equal(uma.contagem, 1);

  // Várias candidaturas
  const varias = calcularRecadoCoruja({ aba: 'historico', historico: [{ id: 'h1' }, { id: 'h2' }] });
  assert.equal(varias.texto, '2 candidaturas registradas no histórico.');
  assert.equal(varias.temNovidade, false);
  assert.equal(varias.contagem, 2);
});

test('menuCorujaLogic: calcularRecadoCoruja aba desconhecida retorna fallback', () => {
  const fallback = calcularRecadoCoruja({ aba: 'outra_aba' });
  assert.equal(fallback.texto, 'Radar ativo e pronto para novas consultas.');
  assert.equal(fallback.temNovidade, false);
  assert.equal(fallback.contagem, 0);
  assert.equal(fallback.aba, 'outra_aba');
});

test('menuCorujaLogic: alternarEstadoAnimacao alterna entre ativo e pausado', () => {
  // Ativo para pausado
  const paraPausado = alternarEstadoAnimacao({ pausadoAtual: false });
  assert.equal(paraPausado.pausado, true);
  assert.equal(paraPausado.valorStorage, '1');
  assert.equal(paraPausado.rotuloBotao, 'Retomar a animação do fundo');
  assert.equal(paraPausado.rotuloDescricao, 'Ativa o céu animado em pixel art');
  assert.equal(paraPausado.fundoAtivo, false);

  // Pausado para ativo
  const paraAtivo = alternarEstadoAnimacao({ pausadoAtual: true });
  assert.equal(paraAtivo.pausado, false);
  assert.equal(paraAtivo.valorStorage, '0');
  assert.equal(paraAtivo.rotuloBotao, 'Parar a animação do fundo');
  assert.equal(paraAtivo.rotuloDescricao, 'Pausa o céu em pixel art se preferir tela estática');
  assert.equal(paraAtivo.fundoAtivo, true);

  // Respeita prefersReducedMotion mesmo quando usuário pede ativo
  const comReducedMotion = alternarEstadoAnimacao({ pausadoAtual: true, prefersReducedMotion: true });
  assert.equal(comReducedMotion.pausado, false);
  assert.equal(comReducedMotion.fundoAtivo, false);
});

test('menuCorujaLogic: filtrarRespostasFormulario filtra por termo, escopo e sensibilidade com ordenação', () => {
  const respostas = [
    {
      id: 'salario-pretendido',
      variantes_label: ['Pretensão Salarial', 'Salário desejado'],
      resposta: 'R$ 18.000 PJ',
      escopo: { tipo: 'global' },
      sensivel: true,
    },
    {
      id: 'disponibilidade',
      variantes_label: ['Disponibilidade para início'],
      resposta: 'Imediata',
      escopo: { tipo: 'portal', valor: 'gupy' },
      sensivel: false,
    },
    {
      id: 'apresentacao-empresa-x',
      variantes_label: ['Apresente-se em 2 minutos'],
      resposta: 'Sou especialista frontend...',
      escopo: { tipo: 'empresa', valor: 'empresa-x' },
      sensivel: false,
    },
  ];

  // Sem filtros: retorna todos ordenados por variante_label[0] alfabeticamente
  const todos = filtrarRespostasFormulario(respostas);
  assert.equal(todos.length, 3);
  assert.equal(todos[0].id, 'apresentacao-empresa-x');
  assert.equal(todos[1].id, 'disponibilidade');
  assert.equal(todos[2].id, 'salario-pretendido');

  // Filtro por termo (insensível a acento e maiúsculas)
  const buscaPretensao = filtrarRespostasFormulario(respostas, { termo: 'pretensao' });
  assert.equal(buscaPretensao.length, 1);
  assert.equal(buscaPretensao[0].id, 'salario-pretendido');

  // Filtro por termo na resposta
  const buscaResposta = filtrarRespostasFormulario(respostas, { termo: 'especialista' });
  assert.equal(buscaResposta.length, 1);
  assert.equal(buscaResposta[0].id, 'apresentacao-empresa-x');

  // Filtro por escopo
  const apenasPortal = filtrarRespostasFormulario(respostas, { escopo: 'portal' });
  assert.equal(apenasPortal.length, 1);
  assert.equal(apenasPortal[0].id, 'disponibilidade');

  // Filtro por sensibilidade
  const apenasSensiveis = filtrarRespostasFormulario(respostas, { apenasSensiveis: true });
  assert.equal(apenasSensiveis.length, 1);
  assert.equal(apenasSensiveis[0].id, 'salario-pretendido');

  // Filtro composto
  const composto = filtrarRespostasFormulario(respostas, { termo: 'gupy', escopo: 'portal' });
  assert.equal(composto.length, 1);
  assert.equal(composto[0].id, 'disponibilidade');

  // Filtro sem correspondência
  const nada = filtrarRespostasFormulario(respostas, { termo: 'inexistente' });
  assert.equal(nada.length, 0);
});

test('menuCorujaLogic: formatarCoberturaFontes sintetiza portais e fontes configuradas', () => {
  const vagas = [
    { portal_candidatura: 'gupy', consultado_em: '2026-10-18T10:00:00Z' },
    { portal_candidatura: 'gupy', consultado_em: '2026-10-18T12:00:00Z' },
    { portal_candidatura: 'greenhouse', consultado_em: '2026-10-18T09:00:00Z' },
    { url: 'https://boards.greenhouse.io/vaga123', consultado_em: '2026-10-18T11:00:00Z' },
  ];

  const coverage = [
    { fonte: 'gupy', consulta: 'Frontend', resultados: 2, status: 'ok' },
    { fonte: 'greenhouse', consulta: 'Staff', resultados: 2, status: 'ok' },
  ];

  const cobertura = formatarCoberturaFontes({
    vagas,
    coverage,
    atualizado: '2026-10-18T12:30:00Z',
    fila: 4,
  });

  assert.equal(cobertura.resumo.atualizado, '2026-10-18T12:30:00Z');
  assert.equal(cobertura.resumo.totalVagas, 4);
  assert.equal(cobertura.resumo.filaLeitura, 4);

  assert.equal(cobertura.portais.length, 2);
  // greenhouse tem 2, gupy tem 2
  assert.ok(cobertura.portais.some(p => p.portal === 'gupy' && p.total === 2));
  assert.ok(cobertura.portais.some(p => p.portal === 'greenhouse' && p.total === 2));

  assert.equal(cobertura.fontesConfiguradas.length, 2);
  assert.equal(cobertura.fontesConfiguradas[0].fonte, 'gupy');
  assert.equal(cobertura.fontesConfiguradas[0].consulta, 'Frontend');
});
