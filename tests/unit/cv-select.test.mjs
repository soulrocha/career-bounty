import assert from 'node:assert/strict';
import test from 'node:test';
import { baseCv, perfilCvBruto, requisito, vagaAlta, vagaGupy, vagaMedia } from '../helpers/cv.mjs';
import { decidirCv, montarPayload, selecionarCv } from '../../core/cv/select.mjs';

async function ambiente() {
  const base = await baseCv();
  const perfil = await perfilCvBruto();
  const selecionar = (vaga, opcoes = {}) => selecionarCv({ vaga, perfil, afirmacoes: base.claims, config: {}, ...opcoes });
  return { base, perfil, selecionar };
}

const ordem = payload => payload.experiencias.map(exp => [exp.id, exp.itens.map(item => item.afirmacao)]);

test('com os alvos da vaga, os bullets sobem pelos requisitos atendidos (obrigatório antes de desejável, atendido antes de parcial)', async () => {
  const { selecionar } = await ambiente();
  const vaga = vagaAlta({
    requisitos: [
      requisito('Painéis', 'desejavel', 'atendido', ['AF-203']),
      requisito('Indicadores', 'obrigatorio', 'atendido', ['AF-202']),
      requisito('Fornecedores', 'desejavel', 'parcial', ['AF-210']),
      requisito('Backlog', 'obrigatorio', 'parcial', ['AF-211']),
      requisito('Python avançado', 'obrigatorio', 'nao-atendido', ['AF-213']),
    ],
  });
  const payload = selecionar(vaga);
  assert.equal(payload.tipo, 'adaptado');
  assert.deepEqual(ordem(payload), [
    ['exp-gama', ['AF-211', 'AF-210', 'AF-209', 'AF-213']],
    ['exp-beta', ['AF-204', 'AF-214']],
    ['exp-alfa', ['AF-202', 'AF-203', 'AF-201']],
    ['destaques', ['AF-212']],
  ]);
  assert.deepEqual(payload.requisitos_atendidos, [
    { requisito: 'Painéis', tipo: 'desejavel', avaliacao: 'atendido', afirmacoes: ['AF-203'] },
    { requisito: 'Indicadores', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: ['AF-202'] },
    { requisito: 'Fornecedores', tipo: 'desejavel', avaliacao: 'parcial', afirmacoes: ['AF-210'] },
    { requisito: 'Backlog', tipo: 'obrigatorio', avaliacao: 'parcial', afirmacoes: ['AF-211'] },
  ]);
});

test('só entram afirmações liberadas para CV (relato, proposto, sem uso de CV e não publicável ficam de fora)', async () => {
  const { selecionar } = await ambiente();
  const ids = selecionar(vagaAlta()).experiencias.flatMap(exp => exp.itens.map(item => item.afirmacao));
  for (const fora of ['AF-205', 'AF-206', 'AF-207', 'AF-208']) assert.ok(!ids.includes(fora), fora);
  assert.equal(new Set(ids).size, ids.length);
});

test('o texto de cada bullet é o da afirmação, sem a marca claim', async () => {
  const { base, selecionar } = await ambiente();
  const porId = new Map(base.claims.map(af => [af.id, af]));
  for (const exp of selecionar(vagaAlta()).experiencias) {
    for (const item of exp.itens) {
      assert.equal(item.texto, porId.get(item.afirmacao).texto);
      assert.doesNotMatch(item.texto, /claim:/);
    }
  }
});

test('vaga sem alvo usa a base, na ordem da base, sem texto genérico como prova de aderência', async () => {
  const { perfil, selecionar } = await ambiente();
  const semAlvo = selecionar(vagaAlta({ requisitos: [] }));
  // Requisito "atendido" sem afirmação ligada não é prova: a vaga continua sem alvo.
  const semProva = selecionar(vagaAlta({ requisitos: [requisito('Liderança', 'obrigatorio', 'atendido', [])] }));
  for (const payload of [semAlvo, semProva]) {
    assert.equal(payload.tipo, 'base');
    assert.deepEqual(payload.requisitos_atendidos, []);
    assert.equal(payload.resumo, perfil.resumo_base);
    assert.equal(payload.titulo, perfil.cabecalho.titulo);
    assert.deepEqual(ordem(payload), [
      ['exp-gama', ['AF-209', 'AF-210', 'AF-211', 'AF-213']],
      ['exp-beta', ['AF-204', 'AF-214']],
      ['exp-alfa', ['AF-201', 'AF-202', 'AF-203']],
      ['destaques', ['AF-212']],
    ]);
    assert.doesNotMatch(JSON.stringify(payload), /Empresa 01|aderente|aderência|requisitos da vaga/i);
  }
});

test('a ordem da base pode vir do perfil (afirmacoes por experiência) e o que não está nela vem depois, por ID', async () => {
  const { base, perfil } = await ambiente();
  perfil.experiencias[0].afirmacoes = ['AF-213', 'AF-209'];
  const payload = selecionarCv({ vaga: vagaAlta({ requisitos: [] }), perfil, afirmacoes: base.claims, config: {} });
  assert.deepEqual(ordem(payload)[0], ['exp-gama', ['AF-213', 'AF-209', 'AF-210', 'AF-211']]);
});

test('preserva o cabeçalho, a foto, os 4 cards e as seções fixas do perfil', async () => {
  const { perfil, selecionar } = await ambiente();
  for (const vaga of [vagaAlta(), vagaMedia(), vagaAlta({ requisitos: [] })]) {
    const payload = selecionar(vaga);
    assert.deepEqual(payload.cabecalho, perfil.cabecalho);
    assert.equal(payload.foto, perfil.foto);
    assert.equal(payload.cards.length, 4);
    assert.deepEqual(payload.cards, perfil.cards);
    assert.deepEqual(payload.formacao, perfil.formacao);
    assert.deepEqual(payload.cursos, perfil.cursos);
    assert.deepEqual(payload.competencias, perfil.competencias);
    assert.equal(payload.idiomas, perfil.idiomas);
    assert.deepEqual(payload.experiencias.filter(exp => exp.id !== 'destaques').map(exp => [exp.empresa, exp.cargo, exp.periodo]),
      perfil.experiencias.map(exp => [exp.empresa, exp.cargo, exp.periodo]));
  }
});

test('só vagas alta ou boa, abertas, compatíveis e não descartadas recebem adaptação; as demais recebem o CV-base identificado', async () => {
  const { selecionar } = await ambiente();
  const casos = [
    [vagaAlta(), 'adaptado', 'adaptada'],
    [vagaAlta({ aderencia: 'boa' }), 'adaptado', 'adaptada'],
    [vagaMedia(), 'base', 'aderencia'],
    [vagaAlta({ url_status: 'fechada' }), 'base', 'fechada'],
    [vagaAlta({ condicoes: { situacao: 'incompativel', motivos: [] } }), 'base', 'incompativel'],
    [vagaAlta({ descarte_usuario: { descartada: true } }), 'base', 'descartada'],
  ];
  for (const [vaga, tipo, motivo] of casos) {
    assert.deepEqual(decidirCv(vaga, {}), { gerar: true, adaptar: tipo === 'adaptado', motivo }, `${vaga.id} ${motivo}`);
    const payload = selecionar(vaga);
    assert.equal(payload.tipo, tipo, motivo);
    assert.equal(payload.identificacao, tipo === 'base' ? 'CV-base' : 'CV para Gerente de Produto · Empresa 01');
    if (tipo === 'base') assert.deepEqual(payload.requisitos_atendidos, []);
  }
});

test('portal sem CV (Gupy por padrão, ou o que estiver em cv_skip_portals) não gera CV', async () => {
  const { selecionar } = await ambiente();
  assert.deepEqual(decidirCv(vagaGupy(), {}), { gerar: false, adaptar: false, motivo: 'portal_sem_cv' });
  assert.equal(selecionar(vagaGupy()), null);
  assert.equal(selecionar(vagaGupy(), { config: { cv_skip_portals: [] } }).tipo, 'adaptado');
});

test('mesma entrada, mesmo payload; a entrada não é alterada', async () => {
  const { base, perfil } = await ambiente();
  const vaga = vagaAlta();
  const antes = JSON.stringify({ vaga, perfil, claims: base.claims });
  const um = selecionarCv({ vaga, perfil, afirmacoes: base.claims, config: {} });
  const dois = selecionarCv({ vaga, perfil, afirmacoes: base.claims, config: {} });
  assert.equal(JSON.stringify(um), JSON.stringify(dois));
  assert.equal(JSON.stringify({ vaga, perfil, claims: base.claims }), antes);
});

test('montarPayload aplica a seleção do redator: ordem, variante cadastrada, resumo e palavras-chave', async () => {
  const { base, perfil } = await ambiente();
  const selecao = {
    resumo: 'Analista de produto com foco em indicadores.',
    palavras_chave: ['indicadores'],
    experiencias: [{ id: 'exp-alfa', itens: [{ afirmacao: 'AF-201', variante: 'Cortou o tempo de fechamento de pedidos em 34%, de 12 para 8 dias.' }, { afirmacao: 'AF-202', variante: null }] }],
  };
  const payload = montarPayload({ perfil, afirmacoes: base.claims, selecao, vaga: vagaAlta(), tipo: 'adaptado' });
  assert.equal(payload.resumo, selecao.resumo);
  assert.deepEqual(payload.palavras_chave, ['indicadores']);
  assert.deepEqual(payload.experiencias.map(exp => exp.id), ['exp-alfa']);
  assert.deepEqual(payload.experiencias[0].itens, [
    { afirmacao: 'AF-201', texto: 'Cortou o tempo de fechamento de pedidos em 34%, de 12 para 8 dias.' },
    { afirmacao: 'AF-202', texto: 'Implantou um painel de indicadores usado por 41 pessoas na operação.' },
  ]);
  assert.deepEqual(payload.cards, perfil.cards);
});

test('cv_skip_portals vem da config (padrão Gupy) e valor inválido é recusado', async t => {
  const { loadSettings } = await import('../../core/config.mjs');
  const { tempDir } = await import('../helpers/cli.mjs');
  const { writeFile } = await import('node:fs/promises');
  const path = (await import('node:path')).default;
  const dataRoot = await tempDir(t);
  assert.deepEqual((await loadSettings({ dataRoot })).cv_skip_portals, ['gupy']);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ cv_skip_portals: [] }));
  const settings = await loadSettings({ dataRoot });
  assert.equal(decidirCv(vagaGupy(), settings).gerar, true);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ cv_skip_portals: 'gupy' }));
  await assert.rejects(loadSettings({ dataRoot }), /cv_skip_portals/);
});
