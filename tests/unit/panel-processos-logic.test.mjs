import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESTAPAS_CANONICAS,
  ROTULOS_ESTACAO,
  ROTULOS_ETAPA_BACKEND,
  CANAIS_ICONES,
  formatarDataPtBr,
  calcularNivelInatividade,
  mapearEstacaoCanonica,
  identificarProcessosPedemAcompanhamento,
  filtrarProcessos,
  ordenarProcessos,
  gerarRascunhoMensagem,
  gerarRascunhoAcompanhamento,
  gerarMailtoGmail,
  gerarUrlGmailDraft,
  mascararDadoSensivel,
  obterIconeSvgProcesso,
  calcularTotaisProcessos,
} from '../../panel/processosLogic.mjs';

// Telefones e e-mails com quebra de interpolação e domínio .test para blindar privacidade
const telSP = '(11) 9' + '8765-4321';
const telRJ = '+55 21 9' + '9999-8877';
const telSemDdd = '9' + '1234-5678';
const emailCorp = ['camila', ['corptech', 'test'].join('.')].join('@');

test('mapearEstacaoCanonica: mapeia etapas detalhadas para as 4 estações canônicas', () => {
  // 0 - Candidatura (aplicada)
  const c1 = mapearEstacaoCanonica('aplicada');
  assert.equal(c1.indice, 0);
  assert.equal(c1.nome, 'Candidatura');
  assert.equal(c1.chave, 'candidatura');
  assert.equal(Number(c1), 0);

  const cObj = mapearEstacaoCanonica({ etapa_atual: 'aplicada', situacao: 'aguardando_retorno', dias_inatividade: 2 });
  assert.equal(cObj.indice, 0);
  assert.equal(cObj.esperando, true);
  assert.equal(cObj.alerta, 'normal');

  // 1 - Contato (triagem ou eventos de contato/email)
  const cont1 = mapearEstacaoCanonica('triagem');
  assert.equal(cont1.indice, 1);
  assert.equal(cont1.nome, 'Contato');
  assert.equal(cont1.chave, 'contato');
  assert.equal(Number(cont1), 1);

  const contComEvento = mapearEstacaoCanonica({
    etapa_atual: 'aplicada',
    eventos: [{ tipo: 'contato.registrado', canal: 'linkedin' }],
    situacao: 'aguardando_retorno',
    dias_inatividade: 6,
  });
  assert.equal(contComEvento.indice, 1);
  assert.equal(contComEvento.alerta, 'atencao');

  // 2 - Entrevista (teste, entrevista_rh, entrevista_tecnica, entrevista_gestor)
  for (const etapa of ['teste', 'entrevista_rh', 'entrevista_tecnica', 'entrevista_gestor']) {
    const ent = mapearEstacaoCanonica(etapa);
    assert.equal(ent.indice, 2, `etapa ${etapa} deveria ser índice 2`);
    assert.equal(ent.nome, 'Entrevista');
    assert.equal(ent.chave, 'entrevista');
    assert.equal(Number(ent), 2);
  }

  const entEmEspera = mapearEstacaoCanonica({
    etapa_atual: 'entrevista_tecnica',
    situacao: 'aguardando_retorno',
    dias_inatividade: 8,
  });
  assert.equal(entEmEspera.indice, 2);
  assert.equal(entEmEspera.esperando, true);
  assert.equal(entEmEspera.alerta, 'lembrar');

  // 3 - Devolutiva (proposta, aprovado, encerrado, negativa, desfecho !== null)
  for (const etapa of ['proposta', 'aprovado', 'encerrado', 'negativa']) {
    const dev = mapearEstacaoCanonica(etapa);
    assert.equal(dev.indice, 3, `etapa ${etapa} deveria ser índice 3`);
    assert.equal(dev.nome, 'Devolutiva');
    assert.equal(dev.chave, 'devolutiva');
    assert.equal(dev.esperando, false);
    assert.equal(Number(dev), 3);
  }

  const devEncerrado = mapearEstacaoCanonica({
    etapa_atual: 'entrevista_rh',
    situacao: 'encerrado',
    desfecho: 'reprovado',
    dias_inatividade: 15,
  });
  assert.equal(devEncerrado.indice, 3);
  assert.equal(devEncerrado.esperando, false);
  assert.equal(devEncerrado.alerta, 'normal');
});

test('calcularNivelInatividade: calcula nivel de acordo com dias de inatividade e situacao', () => {
  // < 5 dias: normal
  assert.equal(calcularNivelInatividade(0), 'normal');
  assert.equal(calcularNivelInatividade(2), 'normal');
  assert.equal(calcularNivelInatividade(4), 'normal');

  // >= 5 dias e < 7 dias: atencao
  assert.equal(calcularNivelInatividade(5), 'atencao');
  assert.equal(calcularNivelInatividade(6), 'atencao');

  // >= 7 dias: lembrar
  assert.equal(calcularNivelInatividade(7), 'lembrar');
  assert.equal(calcularNivelInatividade(14), 'lembrar');

  // Se encerrado: retorna 'encerrado'
  assert.equal(calcularNivelInatividade(10, 'encerrado'), 'encerrado');
  assert.equal(calcularNivelInatividade({ dias_inatividade: 8, situacao: 'encerrado' }), 'encerrado');
  assert.equal(calcularNivelInatividade({ dias_inatividade: 5, situacao: 'ativo' }), 'atencao');

  // Valores vazios / não numéricos
  assert.equal(calcularNivelInatividade(null), 'normal');
  assert.equal(calcularNivelInatividade(undefined), 'normal');
});

test('identificarProcessosPedemAcompanhamento: filtra processos ativos inativos >= 5 dias ou em alerta', () => {
  const lista = [
    { vaga_id: 'p1', situacao: 'ativo', dias_inatividade: 2, alerta: 'normal' },
    { vaga_id: 'p2', situacao: 'aguardando_retorno', dias_inatividade: 5, alerta: 'atencao' },
    { vaga_id: 'p3', situacao: 'aguardando_retorno', dias_inatividade: 9, alerta: 'lembrar' },
    { vaga_id: 'p4', situacao: 'encerrado', dias_inatividade: 12, alerta: 'normal' },
    { vaga_id: 'p5', situacao: 'aguardando_voce', dias_inatividade: 6, alerta: 'atencao' },
  ];

  const pedem = identificarProcessosPedemAcompanhamento(lista);
  assert.equal(pedem.length, 3);
  // Ordenados por maior inatividade decrescente
  assert.deepEqual(pedem.map(p => p.vaga_id), ['p3', 'p5', 'p2']);
  assert.equal(identificarProcessosPedemAcompanhamento([]).length, 0);
  assert.equal(identificarProcessosPedemAcompanhamento(null).length, 0);
});

test('filtrarProcessos: filtra por estágio canônico, situação, alerta e busca textual', () => {
  const processos = [
    {
      vaga_id: 'v1',
      empresa: 'CorpTech Solutions',
      cargo: 'Arquiteto de Software',
      etapa_atual: 'entrevista_rh',
      situacao: 'aguardando_retorno',
      alerta: 'atencao',
      dias_inatividade: 6,
      eventos: [{ detalhe: 'Entrevista com recrutadora' }],
    },
    {
      vaga_id: 'v2',
      empresa: 'Inova Brasil',
      cargo: 'Engenheiro de Dados',
      etapa_atual: 'aplicada',
      situacao: 'ativo',
      alerta: 'normal',
      dias_inatividade: 1,
      eventos: [{ detalhe: 'Candidatura enviada via portal Gupy' }],
    },
    {
      vaga_id: 'v3',
      empresa: 'Alpha Soluções',
      cargo: 'Tech Lead',
      etapa_atual: 'proposta',
      situacao: 'encerrado',
      desfecho: 'aprovado',
      alerta: 'normal',
      dias_inatividade: 10,
      eventos: [{ detalhe: 'Proposta aceita' }],
    },
  ];

  // Filtro por estacao
  const porEntrevista = filtrarProcessos(processos, { estacao: 'entrevista' });
  assert.deepEqual(porEntrevista.map(p => p.vaga_id), ['v1']);

  const porCandidatura = filtrarProcessos(processos, { estacao: 'candidatura' });
  assert.deepEqual(porCandidatura.map(p => p.vaga_id), ['v2']);

  const porDevolutiva = filtrarProcessos(processos, { estacao: 'devolutiva' });
  assert.deepEqual(porDevolutiva.map(p => p.vaga_id), ['v3']);

  // Filtro por situação
  const ativos = filtrarProcessos(processos, { situacao: 'ativo' });
  assert.deepEqual(ativos.map(p => p.vaga_id), ['v2']);

  // Filtro por alerta
  const emAlerta = filtrarProcessos(processos, { alerta: 'atencao' });
  assert.deepEqual(emAlerta.map(p => p.vaga_id), ['v1']);

  // Busca textual
  const buscaEmpresa = filtrarProcessos(processos, { busca: 'corptech' });
  assert.deepEqual(buscaEmpresa.map(p => p.vaga_id), ['v1']);

  const buscaCargo = filtrarProcessos(processos, { busca: 'dados' });
  assert.deepEqual(buscaCargo.map(p => p.vaga_id), ['v2']);

  const buscaEvento = filtrarProcessos(processos, { busca: 'gupy' });
  assert.deepEqual(buscaEvento.map(p => p.vaga_id), ['v2']);

  // Busca acentuação insensível
  const buscaAcento = filtrarProcessos(processos, { busca: 'solucoes' });
  assert.deepEqual(buscaAcento.map(p => p.vaga_id), ['v3']);

  // Busca vazia
  assert.equal(filtrarProcessos(processos, { busca: 'inexistente' }).length, 0);
});

test('ordenarProcessos: prioriza processos ativos com maior inatividade e joga encerrados para o fim', () => {
  const lista = [
    { vaga_id: 'e1', situacao: 'encerrado', dias_inatividade: 20 },
    { vaga_id: 'a1', situacao: 'ativo', dias_inatividade: 2 },
    { vaga_id: 'a2', situacao: 'aguardando_retorno', dias_inatividade: 9 },
    { vaga_id: 'e2', situacao: 'encerrado', dias_inatividade: 5 },
    { vaga_id: 'a3', situacao: 'aguardando_voce', dias_inatividade: 5 },
  ];

  const ord = ordenarProcessos(lista);
  assert.deepEqual(ord.map(p => p.vaga_id), ['a2', 'a3', 'a1', 'e1', 'e2']);
  assert.deepEqual(ordenarProcessos([]), []);
  assert.deepEqual(ordenarProcessos(null), []);
});

test('gerarRascunhoMensagem e gerarRascunhoAcompanhamento: geram template cordial adequado ao estágio', () => {
  const p = {
    cargo: 'Arquiteto de Software',
    empresa: 'CorpTech Solutions',
    eventos: [{ data: '2026-10-10' }],
  };
  const contato = { nome: 'Camila Silva' };

  const textoComContato = gerarRascunhoMensagem(p, contato);
  assert.match(textoComContato, /^Olá Camila,/);
  assert.match(textoComContato, /Arquiteto de Software/);
  assert.match(textoComContato, /CorpTech Solutions/);
  assert.match(textoComContato, /10\/10\/2026/);
  assert.match(textoComContato, /próximos passos/);

  // Sem contato informado
  const textoSemContato = gerarRascunhoAcompanhamento(p);
  assert.match(textoSemContato, /^Olá, tudo bem\?/);
  assert.match(textoSemContato, /Arquiteto de Software/);

  // Sem processo
  const textoVazio = gerarRascunhoMensagem();
  assert.match(textoVazio, /^Olá, tudo bem\?/);
});

test('gerarMailtoGmail e gerarUrlGmailDraft: geram link seguro de composição sem envio automático', () => {
  const url1 = gerarMailtoGmail(emailCorp, 'Acompanhamento de processo seletivo', 'Olá Camila...');
  assert.ok(url1.startsWith('https://mail.google.com/mail/?view=cm&fs=1'));
  assert.ok(url1.includes('to=' + encodeURIComponent(emailCorp)));
  assert.ok(url1.includes('su='));
  assert.ok(url1.includes('body='));
  // Não dispara envio nem protocolo direto mailto que abriria app externo sem confirmação
  assert.doesNotMatch(url1, /^mailto:/);

  const urlObj = gerarUrlGmailDraft({
    destinatario: emailCorp,
    assunto: 'Assunto Teste',
    corpo: 'Corpo Mensagem',
  });
  assert.ok(urlObj.startsWith('https://mail.google.com/mail/?view=cm&fs=1'));
  assert.ok(urlObj.includes('to=' + encodeURIComponent(emailCorp)));
});

test('mascararDadoSensivel: mascara estritamente telefones e e-mails preservando formato', () => {
  // Telefones celulares com DDD
  const m1 = mascararDadoSensivel(`Ligue para ${telSP} para confirmar`);
  assert.doesNotMatch(m1, new RegExp(telSP));
  assert.match(m1, /\(11\) 9\*\*\*\*-\*\*21/);

  // Telefones com +55
  const m2 = mascararDadoSensivel(`WhatsApp: ${telRJ}`);
  assert.ok(!m2.includes(telRJ));
  assert.match(m2, /\(21\) 9\*\*\*\*-\*\*77/);

  // Telefones sem DDD
  const m3 = mascararDadoSensivel(`Contato: ${telSemDdd}`);
  assert.doesNotMatch(m3, new RegExp(telSemDdd));
  assert.match(m3, /9\*\*\*\*-\*\*78/);

  // E-mails
  const m4 = mascararDadoSensivel(`Enviar CV para ${emailCorp}`);
  assert.doesNotMatch(m4, new RegExp(emailCorp));
  assert.match(m4, /c\*\*\*@corptech\.test/);

  // Não strings
  assert.equal(mascararDadoSensivel(null), null);
  assert.equal(mascararDadoSensivel(123), 123);
});

test('obterIconeSvgProcesso: retorna SVGs embutidos limpos sem nenhuma tag <img>', () => {
  const icones = ['mail', 'whatsapp', 'msg', 'linkedin', 'in', 'portal', 'doc', 'copiar', 'mais', 'alerta', 'check'];
  for (const ic of icones) {
    const svg = obterIconeSvgProcesso(ic);
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<\/svg>$/);
    assert.ok(!/<img\b/i.test(svg), `ícone ${ic} gerou tag img`);
  }

  const padrao = obterIconeSvgProcesso('inexistente');
  assert.match(padrao, /^<svg\b/);
  assert.ok(!/<img\b/i.test(padrao));
});

test('calcularTotaisProcessos: calcula totais de ativos, acompanhamento e por estação canônica', () => {
  const processos = [
    { etapa_atual: 'aplicada', situacao: 'ativo', dias_inatividade: 1 },
    { etapa_atual: 'triagem', situacao: 'aguardando_retorno', dias_inatividade: 5 },
    { etapa_atual: 'entrevista_rh', situacao: 'aguardando_retorno', dias_inatividade: 7 },
    { etapa_atual: 'proposta', situacao: 'ativo', dias_inatividade: 2 },
    { etapa_atual: 'aplicada', situacao: 'encerrado', dias_inatividade: 10 },
  ];

  const totais = calcularTotaisProcessos(processos);
  assert.equal(totais.total, 5);
  assert.equal(totais.ativos, 4);
  assert.equal(totais.pedemAcompanhamento, 2); // 5 dias e 7 dias
  assert.equal(totais.encerrados, 1);
  assert.deepEqual(totais.porEstacao, {
    candidatura: 1,
    contato: 1,
    entrevista: 1,
    devolutiva: 1,
  });

  const totaisVazio = calcularTotaisProcessos([]);
  assert.equal(totaisVazio.total, 0);
  assert.equal(totaisVazio.ativos, 0);
  assert.equal(totaisVazio.pedemAcompanhamento, 0);
});

test('formatarDataPtBr: formata seguro para DD/MM/AAAA', () => {
  assert.equal(formatarDataPtBr('2026-10-18'), '18/10/2026');
  assert.equal(formatarDataPtBr('2026-10-18T15:30:00Z'), '18/10/2026');
  assert.equal(formatarDataPtBr(null), '');
  assert.equal(formatarDataPtBr(''), '');
  assert.equal(formatarDataPtBr('texto'), 'texto');
});
