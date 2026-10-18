import assert from 'node:assert/strict';
import test from 'node:test';
import { projectContatos } from '../../core/store/projections/contatos.mjs';

const NOW = new Date('2026-10-18T15:00:00.000-03:00');

test('projectContatos projeta eventos contato.registrado e contato.vinculado', () => {
  const eventos = [
    {
      id: 'e-1',
      ts: '2026-10-15T10:00:00.000-03:00',
      host: 'host-1',
      seq: 1,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-001',
      dados: {
        id: 'con-001',
        vaga_id: null,
        canal: 'linkedin',
        direcao: 'recebido',
        pessoa: { nome: 'Camila Silva', papel: 'Tech Recruiter' },
        resumo: 'Primeiro contato no LinkedIn',
        pergunta: 'Disponibilidade para bate-papo?',
        data: '2026-10-15',
        endereco: 'linkedin.com/in/camila-test',
      },
    },
    {
      id: 'e-2',
      ts: '2026-10-16T14:00:00.000-03:00',
      host: 'host-1',
      seq: 2,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-002',
      dados: {
        id: 'con-002',
        vaga_id: 'vaga-xyz',
        canal: 'email',
        direcao: 'recebido',
        pessoa: { nome: 'Rodrigo Santos', papel: 'Headhunter' },
        resumo: 'Oportunidade reservada',
        data: '2026-10-16',
      },
    },
    {
      id: 'e-3',
      ts: '2026-10-17T11:00:00.000-03:00',
      host: 'host-1',
      seq: 3,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-003',
      dados: {
        id: 'con-003',
        vaga_id: 'vaga-abc',
        canal: 'whatsapp',
        direcao: 'enviado',
        pessoa: { nome: 'Camila Silva', papel: 'Tech Recruiter' },
        resumo: 'Confirmação de interesse enviada',
        proxima_etapa: { texto: 'Entrevista com gestor', data: '2026-10-24' },
        data: '2026-10-17',
        endereco: `(11) 9${'8765'}-${'4321'}`,
      },
    },
    {
      id: 'e-4',
      ts: '2026-10-18T09:00:00.000-03:00',
      host: 'host-1',
      seq: 4,
      ator: 'usuario',
      tipo: 'contato.vinculado',
      entidade: 'contato',
      entidade_id: 'con-001',
      dados: {
        contato_id: 'con-001',
        vaga_id: 'vaga-abc',
      },
    },
  ];

  const projecao = projectContatos(eventos, { now: NOW });

  assert.equal(projecao.total, 3);
  assert.equal(projecao.contatos.length, 3);

  // Ordenação cronológica por data asc
  assert.deepEqual(projecao.contatos.map(c => c.id), ['con-001', 'con-002', 'con-003']);

  // Efeito do contato.vinculado em con-001
  const con001 = projecao.contatos.find(c => c.id === 'con-001');
  assert.equal(con001.vaga_id, 'vaga-abc');
  assert.equal(con001.dias_desde_ultimo_contato, 3); // 2026-10-15 até 2026-10-18
  assert.equal(con001.quem_falou_por_ultimo, 'recrutador');

  const con003 = projecao.contatos.find(c => c.id === 'con-003');
  assert.equal(con003.dias_desde_ultimo_contato, 1); // 2026-10-17 até 2026-10-18
  assert.equal(con003.quem_falou_por_ultimo, 'candidato');

  // Agrupamento por vaga
  assert.ok(projecao.por_vaga['vaga-abc']);
  const grupoAbc = projecao.por_vaga['vaga-abc'];
  assert.equal(grupoAbc.total, 2);
  assert.equal(grupoAbc.ultimo_contato, '2026-10-17');
  assert.equal(grupoAbc.dias_desde_ultimo_contato, 1);
  assert.equal(grupoAbc.quem_falou_por_ultimo, 'candidato');
  assert.deepEqual(grupoAbc.contatos.map(c => c.id), ['con-001', 'con-003']);

  assert.ok(projecao.por_vaga['vaga-xyz']);
  const grupoXyz = projecao.por_vaga['vaga-xyz'];
  assert.equal(grupoXyz.total, 1);
  assert.equal(grupoXyz.ultimo_contato, '2026-10-16');
  assert.equal(grupoXyz.dias_desde_ultimo_contato, 2);
  assert.equal(grupoXyz.quem_falou_por_ultimo, 'recrutador');

  // Agrupamento por pessoa
  assert.ok(projecao.por_pessoa['camila-silva']);
  const pessoaCamila = projecao.por_pessoa['camila-silva'];
  assert.equal(pessoaCamila.nome, 'Camila Silva');
  assert.equal(pessoaCamila.total, 2);
  assert.equal(pessoaCamila.ultimo_contato, '2026-10-17');
  assert.equal(pessoaCamila.dias_desde_ultimo_contato, 1);
  assert.equal(pessoaCamila.quem_falou_por_ultimo, 'candidato');
  assert.deepEqual(pessoaCamila.contatos_ids, ['con-001', 'con-003']);

  assert.ok(projecao.por_pessoa['rodrigo-santos']);
  const pessoaRodrigo = projecao.por_pessoa['rodrigo-santos'];
  assert.equal(pessoaRodrigo.nome, 'Rodrigo Santos');
  assert.equal(pessoaRodrigo.total, 1);
  assert.equal(pessoaRodrigo.ultimo_contato, '2026-10-16');
  assert.equal(pessoaRodrigo.dias_desde_ultimo_contato, 2);
  assert.equal(pessoaRodrigo.quem_falou_por_ultimo, 'recrutador');
});

test('projectContatos lida com lista vazia de eventos', () => {
  const projecao = projectContatos([], { now: NOW });
  assert.equal(projecao.total, 0);
  assert.deepEqual(projecao.contatos, []);
  assert.deepEqual(projecao.por_vaga, {});
  assert.deepEqual(projecao.por_pessoa, {});
});

test('projectContatos suporta contato sem nome de pessoa', () => {
  const eventos = [
    {
      id: 'e-1',
      ts: '2026-10-18T10:00:00.000-03:00',
      host: 'host-1',
      seq: 1,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-sem-nome',
      dados: {
        id: 'con-sem-nome',
        vaga_id: null,
        canal: 'outro',
        direcao: 'recebido',
        resumo: 'Mensagem em formulário de contato',
        data: '2026-10-18',
      },
    },
  ];
  const projecao = projectContatos(eventos, { now: NOW });
  assert.equal(projecao.total, 1);
  assert.ok(projecao.por_pessoa['con-sem-nome']);
  assert.equal(projecao.por_pessoa['con-sem-nome'].nome, 'Sem nome');
});
