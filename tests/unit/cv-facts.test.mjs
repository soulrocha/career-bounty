import assert from 'node:assert/strict';
import test from 'node:test';
import { verificarTexto } from '../../core/cv/facts.mjs';

const af = (id, texto, extra = {}) => ({ id, texto, nivel_prova: 'verificado', numeros: [], uso: ['CV'], ...extra });
const base = [
  af('AF-1', 'O tempo caiu 34%, de 12 para 8 dias.', { numeros: ['34%', '12', '8'] }),
  af('AF-2', 'Atendeu 1.000 clientes e economizou R$ 12 mil.'),
  af('AF-3', 'Alcançou 1,5 mi de acessos.'),
  af('AF-4', 'Ganho de 33% em produtividade.'),
  af('AF-5', 'Redução de 34,2% nos custos.'),
  af('AF-6', 'Relatou 9 entregas.', { nivel_prova: 'relato' }),
];
const verificar = (texto, ligadas, opcoes) => verificarTexto({ texto, ligadas, afirmacoes: base, ...opcoes });

test('número presente em afirmação ligada é aceito', () => {
  const r = verificar('Reduziu o tempo em 34%, de 12 para 8 dias.', ['AF-1']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.problemas, []);
});

test('número que só existe em outra afirmação (não ligada) falha e aponta a afirmação', () => {
  const r = verificar('Ganhou 33% de produtividade.', ['AF-1']);
  assert.equal(r.ok, false);
  assert.equal(r.problemas[0].codigo, 'numero_em_outra_afirmacao');
  assert.match(r.problemas[0].motivo, /33%.*AF-4/);
});

test('arredondamento falha por padrão e passa só com a opção explícita', () => {
  const r = verificar('Cortou 34% dos custos.', ['AF-5']);
  assert.equal(r.ok, false);
  assert.equal(r.problemas[0].codigo, 'arredondamento');
  assert.match(r.problemas[0].motivo, /34,2%/);
  assert.equal(verificar('Cortou 34% dos custos.', ['AF-5'], { permitirArredondamento: true }).ok, true);
});

test('número inflado (afirmação 33%, texto 53%) falha como divergente, não como arredondamento', () => {
  const r = verificar('Ganhou 53% de produtividade.', ['AF-4']);
  assert.equal(r.ok, false);
  assert.equal(r.problemas[0].codigo, 'numero_divergente');
  assert.equal(verificar('Ganhou 53% de produtividade.', ['AF-4'], { permitirArredondamento: true }).ok, false);
});

test('formatos 1.000, 1,5 mi e R$ 12 mil casam com as mesmas grandezas escritas de outro jeito', () => {
  assert.equal(verificar('Atendeu 1000 clientes.', ['AF-2']).ok, true);
  assert.equal(verificar('Economizou R$ 12.000.', ['AF-2']).ok, true);
  assert.equal(verificar('Chegou a 1,5 milhão de acessos.', ['AF-3']).ok, true);
  assert.equal(verificar('Chegou a 1.500.000 de acessos.', ['AF-3']).ok, true);
  assert.equal(verificar('Chegou a 15 mi de acessos.', ['AF-3']).ok, false);
});

test('datas e anos não são tratados como métricas', () => {
  assert.equal(verificar('Entre mar/2021 e 2023, em 01/03/2022, reduziu o tempo em 34%.', ['AF-1']).ok, true);
});

test('número em afirmação relato não é prova', () => {
  const r = verificar('Fez 9 entregas.', ['AF-6']);
  assert.equal(r.ok, false);
  assert.ok(r.problemas.some(p => p.codigo === 'afirmacao_sem_prova'));
});

test('afirmação ligada inexistente é erro; texto sem número com afirmação de prova passa', () => {
  assert.throws(() => verificar('Texto.', ['AF-404']), /AF-404/);
  assert.equal(verificar('Liderou a frente de integrações.', ['AF-1']).ok, true);
});

test('texto sem nenhuma afirmação ligada e com número falha por número órfão', () => {
  const r = verificar('Aumentou as vendas em 80%.', []);
  assert.equal(r.ok, false);
  assert.equal(r.problemas[0].codigo, 'numero_orfao');
});
