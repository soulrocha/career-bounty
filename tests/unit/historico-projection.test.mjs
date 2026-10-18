import assert from 'node:assert/strict';
import test from 'node:test';
import { projectHistorico } from '../../core/store/projections/historico.mjs';

const NOW = '2026-10-18T12:00:00.000Z';

test('projectHistorico: log vazio retorna lista vazia e totais zerados', () => {
  const res = projectHistorico([], { now: NOW });
  assert.deepEqual(res.historico, []);
  assert.equal(res.total, 0);
  assert.deepEqual(res.totais, {
    total: 0,
    ativos: 0,
    aguardando_retorno: 0,
    aguardando_voce: 0,
    encerrados: 0,
  });
});

test('projectHistorico: vaga.descoberta gera item descoberta com origem radar e situacao_processo: ativo', () => {
  const eventos = [
    {
      id: 'ev-desc-1',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'vaga-101',
      dados: {
        vaga: {
          empresa: 'Acme Corp',
          cargo: 'Dev Full Stack',
          portal: 'gupy',
          url: 'https://acme.gupy.io/vagas/101',
        },
      },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  assert.equal(res.historico.length, 1);
  const v = res.historico[0];
  assert.equal(v.vaga_id, 'vaga-101');
  assert.equal(v.empresa, 'Acme Corp');
  assert.equal(v.cargo, 'Dev Full Stack');
  assert.equal(v.portal, 'gupy');
  assert.equal(v.situacao_processo, 'ativo');
  assert.equal(v.ultimo_movimento, '2026-10-10');
  assert.equal(v.linha_do_tempo.length, 1);

  const item = v.linha_do_tempo[0];
  assert.equal(item.tipo, 'descoberta');
  assert.equal(item.origem, 'radar');
  assert.equal(item.data, '2026-10-10');
  assert.equal(item.ts, '2026-10-10T10:00:00.000Z');
  assert.equal(res.totais.ativos, 1);
  assert.equal(res.totais.total, 1);
});

test('projectHistorico: candidatura.marcada adiciona item candidatura com origem painel (ou cli) e situacao aguardando_retorno', () => {
  const eventos = [
    {
      id: 'e1',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-cand',
      dados: {
        vaga: { empresa: 'Beta Inc', cargo: 'Tech Lead', portal: 'greenhouse' },
      },
    },
    {
      id: 'e2',
      ts: '2026-10-12T14:30:00.000Z',
      tipo: 'candidatura.marcada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'v-cand',
      dados: { aplicada: true, data: '2026-10-12' },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  assert.equal(res.historico.length, 1);
  const v = res.historico[0];
  assert.equal(v.situacao_processo, 'aguardando_retorno');
  assert.equal(v.ultimo_movimento, '2026-10-12');
  assert.equal(v.linha_do_tempo.length, 2);

  const itemCand = v.linha_do_tempo[1];
  assert.equal(itemCand.tipo, 'candidatura');
  assert.equal(itemCand.origem, 'painel');
  assert.equal(itemCand.data, '2026-10-12');
  assert.equal(res.totais.aguardando_retorno, 1);
});

test('projectHistorico: contato.registrado com pergunta/proxima etapa adiciona item contato e situacao aguardando_voce', () => {
  const eventos = [
    {
      id: 'e1',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-contato',
      dados: { vaga: { empresa: 'Gama Ltda', cargo: 'Engenheiro de Dados', portal: 'gupy' } },
    },
    {
      id: 'e2',
      ts: '2026-10-11T10:00:00.000Z',
      tipo: 'candidatura.marcada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'v-contato',
      dados: { aplicada: true, data: '2026-10-11' },
    },
    {
      id: 'e3',
      ts: '2026-10-14T15:00:00.000Z',
      tipo: 'contato.registrado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-1',
      dados: {
        id: 'c-1',
        vaga_id: 'v-contato',
        canal: 'email',
        direcao: 'recebido',
        data: '2026-10-14',
        resumo: 'Recrutador solicitou disponibilidade para entrevista',
        pergunta: 'Você teria disponibilidade nesta quinta-feira?',
        pessoa: { nome: 'Recrutador Silva', papel: 'Talent Acquisition' },
      },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  const v = res.historico[0];
  assert.equal(v.situacao_processo, 'aguardando_voce');
  assert.equal(v.ultimo_movimento, '2026-10-14');
  assert.equal(v.linha_do_tempo.length, 3);

  const itemContato = v.linha_do_tempo[2];
  assert.equal(itemContato.tipo, 'contato');
  assert.equal(itemContato.canal, 'email');
  assert.equal(itemContato.resumo, 'Recrutador solicitou disponibilidade para entrevista');
  assert.equal(itemContato.pergunta, 'Você teria disponibilidade nesta quinta-feira?');
  assert.equal(res.totais.aguardando_voce, 1);
});

test('projectHistorico: contato.vinculado associa contato avulso à vaga e inclui na linha do tempo', () => {
  const eventos = [
    {
      id: 'e-desc',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-vinc',
      dados: { vaga: { empresa: 'Delta SA', cargo: 'Backend Dev', portal: 'linkedin' } },
    },
    {
      id: 'e-contato-avulso',
      ts: '2026-10-12T09:00:00.000Z',
      tipo: 'contato.registrado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-avulso',
      dados: {
        id: 'c-avulso',
        vaga_id: null,
        canal: 'linkedin',
        direcao: 'recebido',
        data: '2026-10-12',
        resumo: 'Headhunter mandou mensagem no LinkedIn',
        pergunta: 'Tem interesse em conversar sobre vaga sênior?',
      },
    },
    {
      id: 'e-vinc',
      ts: '2026-10-13T10:00:00.000Z',
      tipo: 'contato.vinculado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-avulso',
      dados: { contato_id: 'c-avulso', vaga_id: 'v-vinc' },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  const v = res.historico[0];
  assert.equal(v.vaga_id, 'v-vinc');
  assert.equal(v.linha_do_tempo.length, 2);
  const itemContato = v.linha_do_tempo[1];
  assert.equal(itemContato.tipo, 'contato');
  assert.equal(itemContato.id, 'c-avulso');
  assert.equal(itemContato.resumo, 'Headhunter mandou mensagem no LinkedIn');
  assert.equal(v.situacao_processo, 'aguardando_voce');
});

test('projectHistorico: contato.removido remove o contato da linha do tempo', () => {
  const eventos = [
    {
      id: 'e-desc',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-rem',
      dados: { vaga: { empresa: 'Epsilon Co', cargo: 'SRE', portal: 'gupy' } },
    },
    {
      id: 'e-contato',
      ts: '2026-10-11T10:00:00.000Z',
      tipo: 'contato.registrado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-remover',
      dados: {
        id: 'c-remover',
        vaga_id: 'v-rem',
        canal: 'whatsapp',
        direcao: 'recebido',
        data: '2026-10-11',
        resumo: 'Contato enviado por engano',
      },
    },
    {
      id: 'e-removido',
      ts: '2026-10-12T11:00:00.000Z',
      tipo: 'contato.removido',
      ator: 'cli',
      entidade: 'contato',
      entidade_id: 'c-remover',
      dados: { contato_id: 'c-remover', motivo: 'Engano no registro' },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  const v = res.historico[0];
  assert.equal(v.linha_do_tempo.length, 1);
  assert.equal(v.linha_do_tempo[0].tipo, 'descoberta');
});

test('projectHistorico: processo.etapa adiciona item etapa', () => {
  const eventos = [
    {
      id: 'e-desc',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-etapa',
      dados: { vaga: { empresa: 'Zeta Inc', cargo: 'Arquiteto', portal: 'gupy' } },
    },
    {
      id: 'e-cand',
      ts: '2026-10-11T10:00:00.000Z',
      tipo: 'candidatura.marcada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'v-etapa',
      dados: { aplicada: true, data: '2026-10-11' },
    },
    {
      id: 'e-etapa',
      ts: '2026-10-13T14:00:00.000Z',
      tipo: 'processo.etapa',
      ator: 'cli',
      entidade: 'processo',
      entidade_id: 'v-etapa',
      dados: { vaga_id: 'v-etapa', etapa: 'entrevista_tecnica', data: '2026-10-13', detalhe: 'Entrevista técnica com gestor' },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  const v = res.historico[0];
  assert.equal(v.linha_do_tempo.length, 3);
  const itemEtapa = v.linha_do_tempo[2];
  assert.equal(itemEtapa.tipo, 'etapa');
  assert.equal(itemEtapa.etapa, 'entrevista_tecnica');
  assert.equal(itemEtapa.detalhe, 'Entrevista técnica com gestor');
});

test('projectHistorico: processo.encerrado e negativa por e-mail geram item desfecho e situacao encerrado', () => {
  // Caso A: processo.encerrado
  const eventosA = [
    {
      id: 'ea1',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-fim-1',
      dados: { vaga: { empresa: 'Alpha', cargo: 'Dev', portal: 'gupy' } },
    },
    {
      id: 'ea2',
      ts: '2026-10-14T10:00:00.000Z',
      tipo: 'processo.encerrado',
      ator: 'cli',
      entidade: 'processo',
      entidade_id: 'v-fim-1',
      dados: { vaga_id: 'v-fim-1', desfecho: 'reprovado', data: '2026-10-14', nota: 'Feedback recebido' },
    },
  ];

  const resA = projectHistorico(eventosA, { now: NOW });
  const vA = resA.historico[0];
  assert.equal(vA.situacao_processo, 'encerrado');
  const itemDesfechoA = vA.linha_do_tempo[1];
  assert.equal(itemDesfechoA.tipo, 'desfecho');
  assert.equal(itemDesfechoA.desfecho, 'reprovado');
  assert.equal(itemDesfechoA.nota, 'Feedback recebido');

  // Caso B: negativa por e-mail
  const eventosB = [
    {
      id: 'eb1',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-fim-2',
      dados: { vaga: { empresa: 'Beta', cargo: 'Dev', portal: 'greenhouse' } },
    },
    {
      id: 'eb2',
      ts: '2026-10-15T10:00:00.000Z',
      tipo: 'email.recebido',
      ator: 'mail',
      entidade: 'vaga',
      entidade_id: 'v-fim-2',
      dados: { vaga_id: 'v-fim-2', etapa: 'negativa', assunto: 'Agradecemos sua participação', data_email: '2026-10-15' },
    },
  ];

  const resB = projectHistorico(eventosB, { now: NOW });
  const vB = resB.historico[0];
  assert.equal(vB.situacao_processo, 'encerrado');
  const itemDesfechoB = vB.linha_do_tempo[1];
  assert.equal(itemDesfechoB.tipo, 'desfecho');
  assert.equal(itemDesfechoB.origem, 'email');
  assert.equal(itemDesfechoB.desfecho, 'reprovado');
  assert.equal(resB.totais.encerrados, 1);
});

test('projectHistorico: vaga.descartada gera item descarte e situacao encerrado', () => {
  const eventos = [
    {
      id: 'e1',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-desc-descarte',
      dados: { vaga: { empresa: 'Theta Co', cargo: 'Dev Senior', portal: 'gupy' } },
    },
    {
      id: 'e2',
      ts: '2026-10-12T16:00:00.000Z',
      tipo: 'vaga.descartada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'v-desc-descarte',
      dados: { vaga_id: 'v-desc-descarte', data: '2026-10-12', motivo: 'Não aderente ao perfil' },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  const v = res.historico[0];
  assert.equal(v.situacao_processo, 'encerrado');
  assert.equal(v.linha_do_tempo.length, 2);
  const itemDescarte = v.linha_do_tempo[1];
  assert.equal(itemDescarte.tipo, 'descarte');
  assert.equal(itemDescarte.origem, 'painel');
  assert.equal(res.totais.encerrados, 1);
});

test('projectHistorico: filtros puros por periodo (inicio e fim), situacao e portal', () => {
  const eventos = [
    // Vaga 1: Gupy, ativa, ultimo movimento 2026-10-05
    {
      id: 'e1',
      ts: '2026-10-05T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v1',
      dados: { vaga: { empresa: 'E1', cargo: 'C1', portal: 'gupy' } },
    },
    // Vaga 2: Greenhouse, aguardando_retorno, ultimo movimento 2026-10-12
    {
      id: 'e2',
      ts: '2026-10-08T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v2',
      dados: { vaga: { empresa: 'E2', cargo: 'C2', portal: 'greenhouse' } },
    },
    {
      id: 'e3',
      ts: '2026-10-12T10:00:00.000Z',
      tipo: 'candidatura.marcada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'v2',
      dados: { aplicada: true, data: '2026-10-12' },
    },
    // Vaga 3: Gupy, encerrado, ultimo movimento 2026-10-16
    {
      id: 'e4',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v3',
      dados: { vaga: { empresa: 'E3', cargo: 'C3', portal: 'gupy' } },
    },
    {
      id: 'e5',
      ts: '2026-10-16T10:00:00.000Z',
      tipo: 'vaga.descartada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'v3',
      dados: { vaga_id: 'v3', data: '2026-10-16' },
    },
  ];

  // Filtro por portal
  const resPortal = projectHistorico(eventos, { portal: 'greenhouse', now: NOW });
  assert.equal(resPortal.historico.length, 1);
  assert.equal(resPortal.historico[0].vaga_id, 'v2');

  // Filtro por situacao
  const resSituacao = projectHistorico(eventos, { situacao: 'encerrado', now: NOW });
  assert.equal(resSituacao.historico.length, 1);
  assert.equal(resSituacao.historico[0].vaga_id, 'v3');

  // Filtro por periodo inicio e fim
  const resPeriodo = projectHistorico(eventos, { inicio: '2026-10-06', fim: '2026-10-14', now: NOW });
  assert.equal(resPeriodo.historico.length, 1);
  assert.equal(resPeriodo.historico[0].vaga_id, 'v2');

  // Filtro combinado: portal gupy + periodo inicio 2026-10-10
  const resComb = projectHistorico(eventos, { portal: 'gupy', inicio: '2026-10-10', now: NOW });
  assert.equal(resComb.historico.length, 1);
  assert.equal(resComb.historico[0].vaga_id, 'v3');
});

test('projectHistorico: ordenacao correta por data do ultimo movimento DESC', () => {
  const eventos = [
    {
      id: 'e1',
      ts: '2026-10-01T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-antiga',
      dados: { vaga: { empresa: 'E1', cargo: 'C1', portal: 'gupy' } },
    },
    {
      id: 'e2',
      ts: '2026-10-15T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-recente',
      dados: { vaga: { empresa: 'E2', cargo: 'C2', portal: 'gupy' } },
    },
    {
      id: 'e3',
      ts: '2026-10-10T10:00:00.000Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-meio',
      dados: { vaga: { empresa: 'E3', cargo: 'C3', portal: 'gupy' } },
    },
  ];

  const res = projectHistorico(eventos, { now: NOW });
  assert.equal(res.historico.length, 3);
  assert.equal(res.historico[0].vaga_id, 'v-recente');
  assert.equal(res.historico[1].vaga_id, 'v-meio');
  assert.equal(res.historico[2].vaga_id, 'v-antiga');
});
