import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeCorpus, rotulosDe } from '../fixtures/mail/make-corpus.mjs';
import { validarDigest, validarFull } from '../../core/mail/contract.mjs';
import { scanText, buildContext } from '../../core/privacy/scan.mjs';

const HOJE = new Date('2026-10-14T20:00:00-03:00');
const hash = valor => createHash('sha256').update(JSON.stringify(valor)).digest('hex');
const corpus = makeCorpus();

test('gera pelo menos 150 itens, reproduzíveis por semente, com hash fixo', () => {
  assert.ok(corpus.itens.length >= 150, `só ${corpus.itens.length} itens`);
  assert.equal(hash(makeCorpus()), hash(corpus));
  assert.notEqual(hash(makeCorpus({ seed: 7 })), hash(corpus));
  assert.equal(hash(rotulosDe(corpus)), '936ee539d03a9994ae3ab886f419f3851da234693dde1e169cebe420d182ff6f');
  assert.equal(hash(corpus.itens), 'c42713e95ee07a17e362dd165c45d0c7c3e2d3cb53573a7305e4934fad2217ae');
});

test('os digests e os corpos passam pelo contrato S10', () => {
  let total = 0;
  for (const bruto of corpus.digests) {
    const { digest, rejeitados, avisos } = validarDigest(bruto, { now: HOJE });
    assert.deepEqual(rejeitados, []);
    assert.deepEqual(avisos, []);
    total += digest.itens.length;
  }
  assert.equal(total, corpus.itens.length);
  const ids = Object.keys(corpus.fulls);
  assert.equal(ids.length, corpus.itens.length);
  assert.equal(validarFull({ itens: ids.map(id => ({ message_id: id, corpo: corpus.fulls[id] })) }, { pedidos: ids }).avisos.length, 0);
});

test('cobre todas as classes e todas as armadilhas pedidas', () => {
  const classes = new Set(Object.values(corpus.labels).map(l => l.classe));
  for (const c of ['confirmacao', 'etapa_liberada', 'acao_necessaria', 'entrevista_agendada', 'negativa', 'oferta', 'alerta', 'ruido']) assert.ok(classes.has(c), c);
  const armadilhas = new Set(Object.values(corpus.labels).map(l => l.armadilha).filter(Boolean));
  for (const a of ['recibo_generico', 'cargo_igual_sem_id', 'entrevista_falsa', 'injecao', 'ingles', 'assunto_vazio']) assert.ok(armadilhas.has(a), a);
  assert.ok(Object.values(corpus.labels).some(l => l.idioma === 'en'));
  assert.ok(corpus.itens.some(i => i.assunto === ''));
  assert.ok(Object.values(corpus.labels).some(l => l.ambiguo && l.precisa_llm));
});

test('cada item tem rótulo esperado em arquivo separado e o arquivo confere com o gerador', async () => {
  const arquivo = JSON.parse(await readFile(new URL('../fixtures/mail/labels.json', import.meta.url), 'utf8'));
  assert.deepEqual(arquivo, JSON.parse(JSON.stringify(rotulosDe(corpus))));
  for (const item of corpus.itens) assert.ok(arquivo.itens[item.message_id]?.classe, item.message_id);
});

test('só empresas e domínios fictícios: o scan de privacidade não acha nada', async () => {
  const empresas = (await readFile(new URL('../fixtures/empresas-ficticias.txt', import.meta.url), 'utf8')).split(/\r?\n/).filter(Boolean);
  const texto = JSON.stringify({ itens: corpus.itens, fulls: corpus.fulls, vagas: corpus.vagas });
  assert.deepEqual(scanText(texto, buildContext(), 'corpus'), []);
  for (const v of corpus.vagas) assert.ok(empresas.includes(v.empresa), v.empresa);
  for (const i of corpus.itens) {
    const d = i.remetente_dominio;
    assert.ok(/\.test$/.test(d) || /(gupy\.com\.br|inhire\.app|solides\.com|lever\.co|greenhouse-mail\.io|ashbyhq\.com|breezy-mail\.com|mailquickin\.com|csod\.com|linkedin\.com)$/.test(d), d);
  }
});
