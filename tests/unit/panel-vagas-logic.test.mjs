import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ORDEM_ADERENCIA,
  filtrarVagas,
  agruparPorRamais,
  proximoId,
  deveIgnorarAtalho,
  formatarSalario,
  formatarNotaEmpresa,
} from '../../panel/vagasLogic.mjs';

const VAGAS_MOCK = [
  {
    id: 'v-1',
    empresa: 'TechCorp',
    cargo: 'Engenheiro de Software Sênior',
    aderencia: 'alta',
    modalidade: 'Remoto',
    regime: 'CLT',
    portal_candidatura: 'Gupy',
    salario: 18000,
    descricao: 'Desenvolvimento backend em Node.js e microsserviços',
    motivos: ['Stack 100% alinhada'],
    lacunas: [],
  },
  {
    id: 'v-2',
    empresa: 'InovaTech',
    cargo: 'Tech Lead Frontend',
    aderencia: 'boa',
    modalidade: 'Híbrido',
    regime: 'PJ',
    portal_candidatura: 'Greenhouse',
    salario: 22000,
    descricao: 'Liderança técnica em interfaces modernas',
    motivos: ['Liderança de times'],
    lacunas: ['Experiência específica com GraphQL'],
  },
  {
    id: 'v-3',
    empresa: 'Presencial S.A.',
    cargo: 'Arquiteto de Software',
    aderencia: 'condicional',
    modalidade: 'Presencial',
    regime: 'CLT',
    portal_candidatura: 'Sólides',
    salario: null,
    descricao: 'Arquitetura de sistemas legados',
    motivos: [],
    lacunas: ['Modelo 100% presencial'],
  },
  {
    id: 'v-4',
    empresa: 'Outra Empresa',
    cargo: 'Desenvolvedor Júnior',
    aderencia: 'incompativel',
    modalidade: 'Remoto',
    regime: 'Pendente',
    portal_candidatura: 'Lever',
    salario: 5000,
    descricao: 'Suporte e manutenção',
    motivos: [],
    lacunas: ['Senioridade incompatível'],
  },
];

test('ORDEM_ADERENCIA possui as 5 raridades na ordem correta', () => {
  assert.deepEqual(ORDEM_ADERENCIA, ['alta', 'boa', 'condicional', 'baixa', 'incompativel']);
});

test('filtrarVagas filtra por aderência, modalidade, regime, busca e descarte', () => {
  const marcas = new Map();
  marcas.set('v-4', { descartada: true });

  // Sem filtro de texto, sem descartadas por padrão
  const todasAtivas = filtrarVagas(VAGAS_MOCK, { desc: 'nao' }, marcas);
  assert.equal(todasAtivas.length, 3);
  assert.ok(!todasAtivas.some(v => v.id === 'v-4'));

  // Filtro por modalidade remoto
  const remotas = filtrarVagas(VAGAS_MOCK, { modo: 'remoto', desc: 'nao' }, marcas);
  assert.equal(remotas.length, 1);
  assert.equal(remotas[0].id, 'v-1');

  // Filtro por regime PJ
  const pj = filtrarVagas(VAGAS_MOCK, { regime: 'PJ', desc: 'nao' }, marcas);
  assert.equal(pj.length, 1);
  assert.equal(pj[0].id, 'v-2');

  // Filtro por busca textual
  const busca = filtrarVagas(VAGAS_MOCK, { busca: 'graphql', desc: 'nao' }, marcas);
  assert.equal(busca.length, 1);
  assert.equal(busca[0].id, 'v-2');

  // Com descartadas
  const comDesc = filtrarVagas(VAGAS_MOCK, { desc: 'todas' }, marcas);
  assert.equal(comDesc.length, 4);
});

test('agruparPorRamais organiza vagas por ordem de raridade', () => {
  const grupos = agruparPorRamais(VAGAS_MOCK);
  assert.equal(grupos.alta.length, 1);
  assert.equal(grupos.boa.length, 1);
  assert.equal(grupos.condicional.length, 1);
  assert.equal(grupos.baixa.length, 0);
  assert.equal(grupos.incompativel.length, 1);
});

test('proximoId navega para frente e para trás na lista (J/K)', () => {
  const ids = ['v-1', 'v-2', 'v-3'];
  assert.equal(proximoId(ids, 'v-1', 1), 'v-2');
  assert.equal(proximoId(ids, 'v-2', 1), 'v-3');
  assert.equal(proximoId(ids, 'v-3', 1), 'v-3'); // para no fim
  assert.equal(proximoId(ids, 'v-3', -1), 'v-2');
  assert.equal(proximoId(ids, 'v-1', -1), 'v-1'); // para no início
  assert.equal(proximoId(ids, 'v-inexistente', 1), 'v-1');
});

test('deveIgnorarAtalho protege campos de texto e modificadores', () => {
  assert.equal(deveIgnorarAtalho({ targetTag: 'INPUT' }), true);
  assert.equal(deveIgnorarAtalho({ targetTag: 'input' }), true);
  assert.equal(deveIgnorarAtalho({ targetTag: 'TEXTAREA' }), true);
  assert.equal(deveIgnorarAtalho({ targetTag: 'textarea' }), true);
  assert.equal(deveIgnorarAtalho({ targetTag: 'SELECT' }), true);
  assert.equal(deveIgnorarAtalho({ targetTag: 'select' }), true);
  assert.equal(deveIgnorarAtalho({ isContentEditable: true }), true);
  assert.equal(deveIgnorarAtalho({ ctrlKey: true }), true);
  assert.equal(deveIgnorarAtalho({ altKey: true }), true);
  assert.equal(deveIgnorarAtalho({ metaKey: true }), true);
  assert.equal(deveIgnorarAtalho({ targetTag: 'BUTTON' }), false);
  assert.equal(deveIgnorarAtalho({ targetTag: 'DIV' }), false);
  assert.equal(deveIgnorarAtalho({ targetTag: null }), false);
  assert.equal(deveIgnorarAtalho({ targetTag: undefined }), false);
  assert.equal(deveIgnorarAtalho({}), false);
  assert.equal(deveIgnorarAtalho(), false);
});

test('formatarSalario trata valores numéricos, textos e não-divulgados', () => {
  assert.equal(formatarSalario(18000), 'R$ 18.000');
  assert.equal(formatarSalario('R$ 15.000 a R$ 20.000'), 'R$ 15.000 a R$ 20.000');
  assert.equal(formatarSalario(null), 'Não divulgado');
  assert.equal(formatarSalario(undefined), 'Não divulgado');
});

test('formatarNotaEmpresa suprime notas vazias e formata notas válidas', () => {
  assert.equal(formatarNotaEmpresa(null), null);
  assert.equal(formatarNotaEmpresa(undefined), null);
  assert.equal(formatarNotaEmpresa({ nota: 0 }), null);
  const fmt = formatarNotaEmpresa({ nota: 4.4, plataforma: 'Glassdoor', quantidade: 1250 });
  assert.equal(fmt.notaFormatada, '4,4');
  assert.equal(fmt.plataforma, 'Glassdoor');
  assert.equal(fmt.quantidadeFormatada, '1.250');
});
