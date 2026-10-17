import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from '../helpers/cli.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { extrairItensCv, removerMarcas, textoVisivel } from '../../core/kb/cvItems.mjs';
import { extrairNumeros, mesmoNumero } from '../../core/cv/numeros.mjs';

const IDS = new Set(['AF-101', 'AF-102', 'AF-103']);
const modelo = texto => ({ modelo: 'teste', formato: 'md', texto });

test('bullet com marca vira ItemCV com claim_ids, seção e texto sem a marca', () => {
  const [item] = extrairItensCv(modelo('## EXPERIENCIA\n- Reduziu o prazo em 34%, de 12 para 8 dias. <!-- claim:AF-101 -->\n'), IDS);
  assert.deepEqual(item.claim_ids, ['AF-101']);
  assert.equal(item.sem_marca, false);
  assert.equal(item.modelo, 'teste');
  assert.equal(item.secao, 'EXPERIENCIA');
  assert.equal(item.texto, 'Reduziu o prazo em 34%, de 12 para 8 dias.');
  assert.deepEqual(item.numeros.map(n => n.bruto), ['34%', '12', '8']);
  assert.equal(item.linha, 2);
});

test('bullet com duas marcas liga às duas, em qualquer formato de lista', () => {
  const [a, b, c] = extrairItensCv(modelo('- Um. <!-- claim:AF-101 --> <!-- claim:AF-102 -->\n- Dois. <!-- claim:AF-101, AF-103 -->\n- Três. <!-- claim:AF-101 AF-102 -->'), IDS);
  assert.deepEqual(a.claim_ids, ['AF-101', 'AF-102']);
  assert.deepEqual(b.claim_ids, ['AF-101', 'AF-103']);
  assert.deepEqual(c.claim_ids, ['AF-101', 'AF-102']);
});

test('bullet sem marca fica sem_marca; parágrafo comum não é item', () => {
  const itens = extrairItensCv(modelo('Texto corrido sem lista.\n• Atuou em projetos.\n* Outro item\n– Item com travessão'), IDS);
  assert.equal(itens.length, 3);
  assert.ok(itens.every(i => i.sem_marca === true && i.claim_ids.length === 0));
});

test('marca para ID inexistente é erro que nomeia o modelo e a linha', () => {
  assert.throws(() => extrairItensCv(modelo('- Ok. <!-- claim:AF-101 -->\n- Ruim. <!-- claim:AF-999 -->'), IDS), /teste.*linha 2.*AF-999/);
  assert.throws(() => extrairItensCv(modelo('- Vazia. <!-- claim: -->'), IDS), /teste.*linha 1.*marca vazia/);
});

test('modelo HTML: itens de lista e seções, marca como comentário', () => {
  const html = '<h2>Experiência</h2><ul><li>Reduziu em <b>34%</b>. <!-- claim:AF-101 --></li><li>Sem marca aqui.</li></ul>';
  const itens = extrairItensCv({ modelo: 'h', formato: 'html', texto: html }, IDS);
  assert.deepEqual(itens.map(i => [i.texto, i.claim_ids, i.secao]), [['Reduziu em 34%.', ['AF-101'], 'Experiência'], ['Sem marca aqui.', [], 'Experiência']]);
});

test('seção em caixa alta do texto simples', () => {
  const [item] = extrairItensCv({ modelo: 't', formato: 'txt', texto: 'EXPERIÊNCIA PROFISSIONAL\nEmpresa Alfa\n• Fez algo.' }, IDS);
  assert.equal(item.secao, 'EXPERIÊNCIA PROFISSIONAL');
});

test('formatos de número pt-BR: percentual, moeda, escalas, milhar e contagem', () => {
  const casos = [
    ['34%', [['34%', 'percentual', 34]]],
    ['34,2% de ganho', [['34,2%', 'percentual', 34.2]]],
    ['R$ 2,3 mi em contratos', [['R$ 2,3 mi', 'moeda', 2300000]]],
    ['R$ 12 mil por mês', [['R$ 12 mil', 'moeda', 12000]]],
    ['1,5 mi de usuários', [['1,5 mi', 'numero', 1500000]]],
    ['14 pessoas', [['14', 'numero', 14]]],
    ['3.708 itens e 1.000 casos', [['3.708', 'numero', 3708], ['1.000', 'numero', 1000]]],
    ['de 22,1 segundos para 907 milissegundos', [['22,1', 'numero', 22.1], ['907', 'numero', 907]]],
    ['1.234,56 reais', [['1.234,56', 'numero', 1234.56]]],
  ];
  for (const [texto, esperado] of casos) assert.deepEqual(extrairNumeros(texto).map(n => [n.bruto, n.tipo, n.valor]), esperado, texto);
});

test('datas, anos, IDs e versões não são tratados como métricas', () => {
  for (const texto of ['em 2025', 'de mar/2025 a jun/2026', 'desde 01/03/2025', '2021 - 2023', '2025-03..2026-06', 'AF-001 e D1 e S5 e L17', 'integrado ao S/4HANA', 'usa C# e .NET', 'PR #123', 'versão v2']) {
    assert.deepEqual(extrairNumeros(texto).map(n => n.bruto), [], texto);
  }
  assert.deepEqual(extrairNumeros('ano de 2025 teve 40 entregas').map(n => n.bruto), ['40']);
});

test('mesmoNumero compara valor e percentual, sem aceitar arredondamento', () => {
  const [a] = extrairNumeros('34%');
  assert.equal(mesmoNumero(a, extrairNumeros('34,0%')[0]), true);
  assert.equal(mesmoNumero(a, extrairNumeros('34,2%')[0]), false);
  assert.equal(mesmoNumero(a, extrairNumeros('34')[0]), false);
  assert.equal(mesmoNumero(extrairNumeros('R$ 2,3 mi')[0], extrairNumeros('2,3 mi')[0]), true);
  assert.equal(mesmoNumero(extrairNumeros('8')[0], extrairNumeros('8,0')[0]), true);
});

test('a marca é invisível no render: removerMarcas e textoVisivel não deixam rastro', () => {
  const html = '<li>Fez algo. <!-- claim:AF-101 --></li>';
  assert.ok(!removerMarcas('- Fez. <!-- claim:AF-101 -->').includes('claim'));
  assert.ok(!textoVisivel(html).includes('claim'));
  assert.equal(textoVisivel(html), 'Fez algo.');
});

test('o modelo de CV da persona de quadrantes gera 5 itens, 4 marcados', async () => {
  const fonte = createMarkdownFolder(path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes'));
  const ids = new Set((await fonte.claims()).map(c => c.id));
  const [cv] = await fonte.cvTemplates();
  const itens = extrairItensCv(cv, ids);
  assert.equal(itens.length, 5);
  assert.deepEqual(itens.filter(i => i.sem_marca).map(i => i.linha), [9]);
});
