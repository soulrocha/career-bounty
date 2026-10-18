import assert from 'node:assert/strict';
import test from 'node:test';
import { projectProcessos } from '../../core/store/projections/processos.mjs';

const NOW = '2026-10-18T12:00:00.000Z'; // hoje = '2026-10-18' em America/Sao_Paulo

test('projectProcessos projeta vagas em jogo com candidatura, e-mail, contatos e etapas', () => {
  const eventos = [
    {
      id: 'e1',
      ts: '2026-10-10T10:00:00Z',
      tipo: 'vaga.importada',
      entidade: 'vaga',
      entidade_id: 'vaga-1',
      dados: { legado: { id: 'vaga-1', empresa: 'Tech Corp', cargo: 'Dev Senior', candidatura_usuario: { aplicada: true, data: '2026-10-10' } } },
    },
    {
      id: 'e2',
      ts: '2026-10-12T14:00:00Z',
      tipo: 'email.recebido',
      entidade: 'vaga',
      entidade_id: 'vaga-1',
      dados: { vaga_id: 'vaga-1', etapa: 'teste', data_email: '2026-10-12' },
    },
    {
      id: 'e3',
      ts: '2026-10-14T16:00:00Z',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'c1',
      dados: { vaga_id: 'vaga-1', canal: 'email', direcao: 'recebido', data: '2026-10-14', resumo: 'Envio de teste online' },
    },
    {
      id: 'e4',
      ts: '2026-10-15T18:00:00Z',
      tipo: 'processo.etapa',
      entidade: 'processo',
      entidade_id: 'vaga-1',
      dados: { vaga_id: 'vaga-1', etapa: 'entrevista_rh', data: '2026-10-15', detalhe: 'Entrevista marcada com RH' },
    },
  ];

  const resultado = projectProcessos(eventos, { now: NOW });
  assert.equal(resultado.processos.length, 1);
  const p = resultado.processos[0];
  assert.equal(p.vaga_id, 'vaga-1');
  assert.equal(p.empresa, 'Tech Corp');
  assert.equal(p.cargo, 'Dev Senior');
  assert.equal(p.etapa_atual, 'entrevista_rh');
  assert.equal(p.eventos.length, 4);
});

test('projectProcessos classifica corretamente as situações', () => {
  const eventos = [
    // Processo 1: aguardando_voce (recrutador mandou pergunta/próxima etapa pendente)
    {
      id: 'ev-1',
      ts: '2026-10-16T10:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-voce',
      dados: { aplicada: true, data: '2026-10-16' },
    },
    {
      id: 'ev-2',
      ts: '2026-10-17T11:00:00Z',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'c-voce',
      dados: { vaga_id: 'vaga-voce', canal: 'whatsapp', direcao: 'recebido', data: '2026-10-17', resumo: 'Recrutador pediu disponibilidade', pergunta: 'Pode falar amanhã?' },
    },

    // Processo 2: aguardando_retorno (candidato enviou mensagem ou etapa)
    {
      id: 'ev-3',
      ts: '2026-10-16T10:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-retorno',
      dados: { aplicada: true, data: '2026-10-16' },
    },
    {
      id: 'ev-4',
      ts: '2026-10-17T15:00:00Z',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'c-retorno',
      dados: { vaga_id: 'vaga-retorno', canal: 'email', direcao: 'enviado', data: '2026-10-17', resumo: 'Enviei o teste técnico resolvido' },
    },

    // Processo 3: encerrado
    {
      id: 'ev-5',
      ts: '2026-10-10T10:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-fim',
      dados: { aplicada: true, data: '2026-10-10' },
    },
    {
      id: 'ev-6',
      ts: '2026-10-15T10:00:00Z',
      tipo: 'processo.encerrado',
      entidade: 'processo',
      entidade_id: 'vaga-fim',
      dados: { vaga_id: 'vaga-fim', desfecho: 'reprovado', data: '2026-10-15', nota: 'Feedback recebido' },
    },
  ];

  const resultado = projectProcessos(eventos, { now: NOW });
  const mapa = new Map(resultado.processos.map(p => [p.vaga_id, p]));

  assert.equal(mapa.get('vaga-voce').situacao, 'aguardando_voce');
  assert.equal(mapa.get('vaga-retorno').situacao, 'aguardando_retorno');
  assert.equal(mapa.get('vaga-fim').situacao, 'encerrado');
  assert.equal(mapa.get('vaga-fim').desfecho, 'reprovado');
});

test('projectProcessos calcula alertas de inatividade: normal (< 5d), atencao (>= 5d), lembrar (>= 7d)', () => {
  // hoje = '2026-10-18'
  const eventos = [
    // Recente (interação em 2026-10-16 -> 2 dias): alerta normal
    {
      id: 'a1',
      ts: '2026-10-16T10:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-recente',
      dados: { aplicada: true, data: '2026-10-16' },
    },
    // Atenção (interação em 2026-10-13 -> 5 dias): alerta atencao
    {
      id: 'a2',
      ts: '2026-10-13T10:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-atencao',
      dados: { aplicada: true, data: '2026-10-13' },
    },
    // Lembrar (interação em 2026-10-10 -> 8 dias): alerta lembrar
    {
      id: 'a3',
      ts: '2026-10-10T10:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-lembrar',
      dados: { aplicada: true, data: '2026-10-10' },
    },
    // Encerrado há 15 dias: alerta deve ser normal (não gera alerta)
    {
      id: 'a4',
      ts: '2026-10-01T10:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-encerrada',
      dados: { aplicada: true, data: '2026-10-01' },
    },
    {
      id: 'a5',
      ts: '2026-10-03T10:00:00Z',
      tipo: 'processo.encerrado',
      entidade: 'processo',
      entidade_id: 'vaga-encerrada',
      dados: { vaga_id: 'vaga-encerrada', desfecho: 'cancelado', data: '2026-10-03' },
    },
  ];

  const resultado = projectProcessos(eventos, { now: NOW });
  const mapa = new Map(resultado.processos.map(p => [p.vaga_id, p]));

  assert.equal(mapa.get('vaga-recente').alerta, 'normal');
  assert.equal(mapa.get('vaga-recente').dias_inatividade, 2);

  assert.equal(mapa.get('vaga-atencao').alerta, 'atencao');
  assert.equal(mapa.get('vaga-atencao').dias_inatividade, 5);

  assert.equal(mapa.get('vaga-lembrar').alerta, 'lembrar');
  assert.equal(mapa.get('vaga-lembrar').dias_inatividade, 8);

  assert.equal(mapa.get('vaga-encerrada').alerta, 'normal');
});

test('projectProcessos agrega eventos cronologicamente e calcula totais', () => {
  const eventos = [
    {
      id: 't1',
      ts: '2026-10-10T09:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v1',
      dados: { aplicada: true, data: '2026-10-10' },
    },
    {
      id: 't2',
      ts: '2026-10-12T09:00:00Z',
      tipo: 'processo.etapa',
      entidade: 'processo',
      entidade_id: 'v1',
      dados: { vaga_id: 'v1', etapa: 'teste', data: '2026-10-12' },
    },
    {
      id: 't3',
      ts: '2026-10-17T09:00:00Z',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v2',
      dados: { aplicada: true, data: '2026-10-17' },
    },
  ];

  const resultado = projectProcessos(eventos, { now: NOW });
  assert.equal(resultado.totais.total, 2);
  assert.equal(resultado.totais.ativos, 2);
  assert.equal(resultado.totais.encerrados, 0);
  assert.equal(resultado.pendentes.length, 1); // v1 tem 6 dias de inatividade (>= 5 dias)
  assert.equal(resultado.pendentes[0].vaga_id, 'v1');
});
