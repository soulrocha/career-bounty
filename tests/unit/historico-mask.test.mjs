import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mascararItemHistorico,
  mascararVagaHistorico,
  mascararHistorico,
} from '../../core/privacy/mask.mjs';

test('mascararItemHistorico mascara emails e telefones em titulo, resumo, detalhe, assunto, nota, pergunta e endereco', () => {
  const telBR = `(11) 9${'8765'}-${'4321'}`;
  const telInt = `+1 415 555 0132`;
  const email = 'recruiter.talent@empresa.test';

  const item = {
    id: 'it-1',
    tipo: 'contato',
    origem: 'recrutador',
    titulo: `Alinhamento com ${email}`,
    resumo: `Contato via WhatsApp ${telBR}`,
    detalhe: `Detalhes com contato exterior ${telInt} e email ${email}`,
    assunto: `Retorno sobre entrevista - ${email}`,
    nota: `Ligar no ${telBR} após as 14h`,
    pergunta: `Confirma seu numero ${telBR}?`,
    endereco: telBR,
    pessoa: {
      nome: `Maria Recrutadora ${email}`,
      papel: `Tech Talent ${telBR}`,
    },
    proxima_etapa: {
      texto: `Entrevista técnica agendada via ${email}`,
      data: '2026-10-25',
    },
    motivo: `Descarte solicitado via ${email}`,
  };

  const mascarado = mascararItemHistorico(item);

  // Verificação de mascaramento em cada campo
  assert.equal(mascarado.titulo, 'Alinhamento com r***@empresa.test');
  assert.equal(mascarado.resumo, 'Contato via WhatsApp (11) 9****-**21');
  assert.equal(mascarado.detalhe, 'Detalhes com contato exterior +1 ****-**32 e email r***@empresa.test');
  assert.equal(mascarado.assunto, 'Retorno sobre entrevista - r***@empresa.test');
  assert.equal(mascarado.nota, 'Ligar no (11) 9****-**21 após as 14h');
  assert.equal(mascarado.pergunta, 'Confirma seu numero (11) 9****-**21?');
  assert.equal(mascarado.endereco, '(11) 9****-**21');
  assert.equal(mascarado.pessoa.nome, 'Maria Recrutadora r***@empresa.test');
  assert.equal(mascarado.pessoa.papel, 'Tech Talent (11) 9****-**21');
  assert.equal(mascarado.proxima_etapa.texto, 'Entrevista técnica agendada via r***@empresa.test');
  assert.equal(mascarado.motivo, 'Descarte solicitado via r***@empresa.test');

  // Não vaza nenhum dado cru
  assert.ok(!JSON.stringify(mascarado).includes('recruiter.talent@'));
  assert.ok(!JSON.stringify(mascarado).includes(`9${'8765'}-${'4321'}`));
  assert.ok(!JSON.stringify(mascarado).includes('555 0132'));
});

test('mascararItemHistorico trata com seguranca itens nulos e campos opcionais', () => {
  assert.equal(mascararItemHistorico(null), null);
  assert.equal(mascararItemHistorico(undefined), undefined);

  const itemSimples = {
    id: 'it-simples',
    tipo: 'descoberta',
    origem: 'radar',
    data: '2026-10-18',
  };
  const m = mascararItemHistorico(itemSimples);
  assert.equal(m.id, 'it-simples');
  assert.equal(m.tipo, 'descoberta');
});

test('mascararVagaHistorico mascara empresa, cargo e todos os itens da linha do tempo', () => {
  const telBR = `(21) 9${'9988'}-${'7766'}`;
  const email = 'vagas@startup.test';

  const vaga = {
    vaga_id: 'v-10',
    empresa: `Startup Alpha - falar com ${email}`,
    cargo: `Dev Sênior - dúvidas no ${telBR}`,
    portal: 'gupy',
    situacao_processo: 'ativo',
    ultimo_movimento: '2026-10-18',
    linha_do_tempo: [
      {
        tipo: 'descoberta',
        titulo: `Vaga no portal enviada por ${email}`,
        detalhe: `Contato ${telBR}`,
      },
    ],
    itens: [
      {
        tipo: 'descoberta',
        titulo: `Vaga no portal enviada por ${email}`,
        detalhe: `Contato ${telBR}`,
      },
    ],
  };

  const m = mascararVagaHistorico(vaga);
  assert.equal(m.empresa, 'Startup Alpha - falar com v***@startup.test');
  assert.equal(m.cargo, 'Dev Sênior - dúvidas no (21) 9****-**66');
  assert.equal(m.linha_do_tempo[0].titulo, 'Vaga no portal enviada por v***@startup.test');
  assert.equal(m.linha_do_tempo[0].detalhe, 'Contato (21) 9****-**66');
  assert.equal(m.itens[0].titulo, 'Vaga no portal enviada por v***@startup.test');

  assert.equal(mascararVagaHistorico(null), null);
});

test('mascararHistorico funciona para array e para envelope com totais', () => {
  const email = 'contato@empresa.test';
  const telBR = `(31) 9${'8877'}-${'6655'}`;

  const listaVagas = [
    {
      vaga_id: 'v-1',
      empresa: 'Empresa 1',
      cargo: 'Engenheiro',
      linha_do_tempo: [
        { tipo: 'contato', resumo: `Ligar para ${telBR} ou ${email}` },
      ],
    },
  ];

  // Caso 1: array
  const resultadoArray = mascararHistorico(listaVagas);
  assert.ok(Array.isArray(resultadoArray));
  assert.equal(resultadoArray[0].linha_do_tempo[0].resumo, 'Ligar para (31) 9****-**55 ou c***@empresa.test');

  // Caso 2: objeto { historico, totais, total }
  const envelope = {
    historico: listaVagas,
    totais: { total: 1, ativos: 1, aguardando_retorno: 0, aguardando_voce: 0, encerrados: 0 },
    total: 1,
  };
  const resultadoEnvelope = mascararHistorico(envelope);
  assert.equal(resultadoEnvelope.total, 1);
  assert.equal(resultadoEnvelope.totais.ativos, 1);
  assert.equal(resultadoEnvelope.historico[0].linha_do_tempo[0].resumo, 'Ligar para (31) 9****-**55 ou c***@empresa.test');
});
