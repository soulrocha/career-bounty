import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { extrairItensCv } from '../../core/kb/cvItems.mjs';
import { calcularQuadrantes, classificarForaDoCv } from '../../core/kb/quadrants.mjs';
import { calcularLacunas, ordenarLacunas, parsePeriodo } from '../../core/kb/gaps.mjs';
import { lerBase } from '../../core/kb/base.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const { vagas } = JSON.parse(await readFile(path.join(repoRoot, 'tests', 'fixtures', 'vagas-quadrantes.json'), 'utf8'));

async function carregar() {
  const base = await lerBase([{ nome: 'markdown-folder', fonte: createMarkdownFolder(kbDir) }]);
  const ids = new Set(base.claims.map(c => c.id));
  const itens = base.cvTemplates.flatMap(cv => extrairItensCv(cv, ids));
  return { base, itens };
}

test('afirmação com uso CV, com prova e ausente do CV vai para (b), ordenada por força', async () => {
  const { base, itens } = await carregar();
  const { b } = classificarForaDoCv({ afirmacoes: base.claims, itens, historias: base.historias, arcos: base.arcos, cvCarregado: true });
  assert.deepEqual(b.filter(x => x.tipo === 'afirmacao').map(x => [x.id, x.nivel_prova]), [['AF-104', 'verificado'], ['AF-106', 'entregue']]);
  // AF-105 só tem uso Ent, AF-108 não é publicável, AF-107 é relato, AF-101/102/103 já estão no CV.
  assert.ok(!b.some(x => ['AF-101', 'AF-102', 'AF-103', 'AF-105', 'AF-107', 'AF-108'].includes(x.id)));
});

test('arco ou história sem afirmação ligada vai para (b)', async () => {
  const { base, itens } = await carregar();
  const { b } = classificarForaDoCv({ afirmacoes: base.claims, itens, historias: base.historias, arcos: [{ id: 'arco-solto', titulo: 'Arco solto', afirmacoes: [] }], cvCarregado: true });
  assert.deepEqual(b.filter(x => x.tipo === 'arco').map(x => x.id), ['HI-102', 'arco-solto']);
});

test('sem nenhum modelo de CV, o (b) de afirmações não dispara e avisa', async () => {
  const { base } = await carregar();
  const r = classificarForaDoCv({ afirmacoes: base.claims, itens: [], historias: [], arcos: [], cvCarregado: false });
  assert.deepEqual(r.b, []);
  assert.match(r.avisos[0], /nenhum modelo de CV/);
});

test('resultado sem linha de base vai para (d); com "de X para Y" ou linha_base na evidência, não', async () => {
  const { base } = await carregar();
  const d = calcularLacunas({ afirmacoes: base.claims, evidencias: base.evidence, vagas: [] });
  const semBase = d.filter(x => x.tipo === 'sem_linha_base').map(x => x.alvo);
  assert.deepEqual(semBase, ['AF-106']);
  assert.match(d.find(x => x.id === 'sem_linha_base:AF-106').pergunta_sugerida, /ponto de partida|antes/i);
});

test('afirmação sem evidência (sem fonte) vai para (d)', async () => {
  const { base } = await carregar();
  const d = calcularLacunas({ afirmacoes: base.claims, evidencias: base.evidence, vagas: [] });
  assert.deepEqual(d.filter(x => x.tipo === 'sem_fonte').map(x => x.alvo).sort(), ['AF-106', 'AF-107']);
});

test('buraco na linha do tempo maior que N meses vai para (d)', async () => {
  const { base } = await carregar();
  const d = calcularLacunas({ afirmacoes: base.claims, evidencias: base.evidence, vagas: [] });
  const buracos = d.filter(x => x.tipo === 'buraco_timeline');
  assert.equal(buracos.length, 1);
  assert.equal(buracos[0].id, 'buraco_timeline:2021-07..2022-01');
  assert.match(buracos[0].descricao, /7 meses/);
  assert.equal(calcularLacunas({ afirmacoes: base.claims, evidencias: base.evidence, vagas: [], buracoMeses: 7 }).filter(x => x.tipo === 'buraco_timeline').length, 0);
});

test('parsePeriodo aceita mês, dia, ano e atual', () => {
  assert.deepEqual(parsePeriodo('2025-03..2026-06'), { inicio: 2025 * 12 + 2, fim: 2026 * 12 + 5 });
  assert.deepEqual(parsePeriodo('2026-07-29..2026-08-03'), { inicio: 2026 * 12 + 6, fim: 2026 * 12 + 7 });
  assert.deepEqual(parsePeriodo('2019..2020'), { inicio: 2019 * 12, fim: 2020 * 12 + 11 });
  assert.deepEqual(parsePeriodo('2026-01..atual', { hoje: '2026-10-15' }), { inicio: 2026 * 12, fim: 2026 * 12 + 9 });
  assert.equal(parsePeriodo('quando deu'), null);
  assert.equal(parsePeriodo(null), null);
});

test('requisito frequente em vagas alta/média sem afirmação vira (d), com peso pela frequência', async () => {
  const { base } = await carregar();
  const d = calcularLacunas({ afirmacoes: base.claims, evidencias: base.evidence, vagas });
  const req = d.filter(x => x.tipo === 'requisito_frequente');
  assert.deepEqual(req.map(x => [x.alvo, x.vagas, x.peso]), [['python avançado', 4, 8], ['inglês fluente', 3, 6], ['liderança de squads', 2, 4]]);
  assert.ok(!req.some(x => /kubernetes|sql/i.test(x.alvo)), 'abaixo da frequência mínima ou só em vaga baixa');
  assert.match(req[0].descricao, /4 vagas/);
  assert.match(req[0].pergunta_sugerida, /Python avançado/i);
});

test('requisito de vaga atendido por afirmação não é lacuna', async () => {
  const { base } = await carregar();
  const d = calcularLacunas({ afirmacoes: base.claims, evidencias: base.evidence, vagas });
  assert.ok(!d.some(x => /gestão de pessoas/i.test(x.alvo ?? '')));
});

test('a fila ordena por peso e é estável entre execuções e entradas embaralhadas', async () => {
  const { base } = await carregar();
  const entrada = { afirmacoes: base.claims, evidencias: base.evidence, vagas };
  const a = calcularLacunas(entrada);
  const b = calcularLacunas({ afirmacoes: [...base.claims].reverse(), evidencias: [...base.evidence].reverse(), vagas: [...vagas].reverse() });
  assert.deepEqual(a, b);
  const pesos = a.map(x => x.peso);
  assert.deepEqual(pesos, [...pesos].sort((x, y) => y - x));
  assert.deepEqual(ordenarLacunas(a), a);
  assert.equal(a[0].id, 'requisito_frequente:python avançado');
});

test('calcularQuadrantes junta (a), (b), (c) e (d) com contagem', async () => {
  const { base, itens } = await carregar();
  const q = calcularQuadrantes({ afirmacoes: base.claims, evidencias: base.evidence, historias: base.historias, arcos: base.arcos, itens, cvCarregado: true, vagas });
  assert.deepEqual(q.contagem, { a: 1, b: 3, c: 4, d: q.d.length });
  assert.ok(q.d.length >= 6);
  assert.deepEqual(Object.keys(q).sort(), ['a', 'avisos', 'b', 'c', 'contagem', 'd']);
});

test('base vazia e CV vazio: todos os quadrantes vazios, sem erro', () => {
  const q = calcularQuadrantes({ afirmacoes: [], evidencias: [], historias: [], arcos: [], itens: [], cvCarregado: false, vagas: [] });
  assert.deepEqual(q.contagem, { a: 0, b: 0, c: 0, d: 0 });
});

test('bin kb quadrants --json lê DATA_ROOT/kb, os modelos de CV e as vagas do log', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  const r = run(['kb', 'quadrants', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([r.json.contagem.a, r.json.contagem.b, r.json.contagem.c], [1, 3, 4]);
  assert.ok(r.json.d.some(x => x.tipo === 'buraco_timeline'));
  const texto = run(['kb', 'quadrants'], { dataRoot });
  assert.match(texto.stdout, /\(a\) 1.*\(b\) 3.*\(c\) 4.*\(d\) \d+/s);
  await writeFile(path.join(dataRoot, 'kb', 'cv', 'modelo-base.md'), '- Item. <!-- claim:AF-XXX -->');
  const ruim = run(['kb', 'quadrants', '--json'], { dataRoot });
  assert.equal(ruim.status, 2);
  assert.match(ruim.json.error, /AF-XXX/);
});
