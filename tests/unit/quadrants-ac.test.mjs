import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from '../helpers/cli.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { extrairItensCv } from '../../core/kb/cvItems.mjs';
import { classificarItens } from '../../core/kb/quadrants.mjs';

const fonte = createMarkdownFolder(path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes'));
const afirmacoes = await fonte.claims();
const ids = new Set(afirmacoes.map(c => c.id));
const itensDe = texto => extrairItensCv({ modelo: 'm', formato: 'md', texto }, ids);

test('bullet com afirmação verificada/entregue e números iguais cai em (a)', () => {
  const itens = itensDe('- Reduziu o tempo em 34%, de 12 para 8 dias. <!-- claim:AF-101 -->\n- Implantou painel usado por 14 pessoas. <!-- claim:AF-102 -->\n- Atuou na operação. <!-- claim:AF-102 -->');
  const { a, c } = classificarItens({ afirmacoes, itens });
  assert.equal(a.length, 3);
  assert.equal(c.length, 0);
  assert.deepEqual(a[0].claim_ids, ['AF-101']);
  assert.equal(a[0].afirmacoes[0].nivel_prova, 'verificado');
});

test('número do bullet diferente da afirmação vai para (c) com motivo', () => {
  const { a, c } = classificarItens({ afirmacoes, itens: itensDe('- Implantou painel usado por 41 pessoas. <!-- claim:AF-102 -->') });
  assert.equal(a.length, 0);
  assert.equal(c[0].codigo, 'numero_divergente');
  assert.match(c[0].motivo, /41.*AF-102.*14/);
});

test('bullet sem marca vai para (c)', () => {
  const { c } = classificarItens({ afirmacoes, itens: itensDe('- Atuou na melhoria contínua.') });
  assert.deepEqual([c[0].codigo, c[0].linha], ['sem_marca', 1]);
  assert.match(c[0].motivo, /sem marca/);
});

test('número órfão vai para (c): afirmação ligada sem número, ou número que só existe em outra afirmação', () => {
  const semNumero = classificarItens({ afirmacoes, itens: itensDe('- Conduziu alinhamentos que cortaram 3 dias. <!-- claim:AF-107 -->') });
  assert.equal(semNumero.c[0].codigo, 'afirmacao_sem_prova');
  // AF-105 é verificada e não tem o número 60; o 60 existe na AF-104, que não está ligada.
  const emOutra = classificarItens({ afirmacoes, itens: itensDe('- Treinou pessoas e cortou 60% do retrabalho. <!-- claim:AF-105 -->') });
  assert.equal(emOutra.c[0].codigo, 'numero_orfao');
  assert.match(emOutra.c[0].motivo, /60%.*AF-104.*não ligada/);
  const sozinho = classificarItens({ afirmacoes, itens: itensDe('- Treinou pessoas e cortou 77% do retrabalho. <!-- claim:AF-105 -->') });
  assert.equal(sozinho.c[0].codigo, 'numero_divergente');
});

test('afirmação relato ou proposto usada como fato no CV vai para (c)', () => {
  const lote = [...afirmacoes, { id: 'AF-PROP', texto: 'Propôs algo.', nivel_prova: 'proposto', numeros: [], uso: [] }];
  const { a, c } = classificarItens({ afirmacoes: lote, itens: extrairItensCv({ modelo: 'm', formato: 'md', texto: '- Liderou a migração de 5 sistemas. <!-- claim:AF-103 -->\n- Propôs. <!-- claim:AF-PROP -->' }, new Set(lote.map(x => x.id))) });
  assert.equal(a.length, 0);
  assert.deepEqual(c.map(x => x.codigo), ['afirmacao_sem_prova', 'afirmacao_sem_prova']);
  assert.match(c[0].motivo, /AF-103.*relato/);
});

test('afirmação mista (uma com prova, outra relato) também não vale como fato', () => {
  const { c } = classificarItens({ afirmacoes, itens: itensDe('- Reduziu em 34% e liderou 5 sistemas. <!-- claim:AF-101 --> <!-- claim:AF-103 -->') });
  assert.equal(c[0].codigo, 'afirmacao_sem_prova');
});

test('CV vazio: quadrantes vazios, sem erro', () => {
  assert.deepEqual(classificarItens({ afirmacoes, itens: [] }), { a: [], c: [] });
  assert.deepEqual(classificarItens({ afirmacoes: [], itens: [] }), { a: [], c: [] });
});

test('o modelo completo da persona: 1 em (a) e 4 em (c), na ordem do CV', () => {
  const cv = extrairItensCv({ modelo: 'm', formato: 'md', texto: [
    '- Reduziu o tempo de fechamento de pedidos em 34%, de 12 para 8 dias. <!-- claim:AF-101 -->',
    '- Implantou um painel de indicadores usado por 41 pessoas. <!-- claim:AF-102 -->',
    '- Liderou a migração de 5 sistemas legados. <!-- claim:AF-103 -->',
    '- Atuou na melhoria contínua.',
    '- Gerou ganho de 80% em produtividade. <!-- claim:AF-101 -->'].join('\n') }, ids);
  const { a, c } = classificarItens({ afirmacoes, itens: cv });
  assert.equal(a.length, 1);
  assert.deepEqual(c.map(x => x.codigo), ['numero_divergente', 'afirmacao_sem_prova', 'sem_marca', 'numero_divergente']);
});
