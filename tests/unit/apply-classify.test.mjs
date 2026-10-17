import assert from 'node:assert/strict';
import test from 'node:test';
import { runnerFake } from '../helpers/cv.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { LlmSaidaInvalida } from '../../core/llm/runner.mjs';
import { classificarDesconhecidos } from '../../core/apply/classify.mjs';

const campo = (ref, label, tipo = 'text') => ({ ref, label, tipo, obrigatorio: true });
const decisoes = r => Object.fromEntries(r.campos.map(c => [c.ref, c.decisao]));

test('campo factual, sensível ou eliminatório vira pergunta, nunca rascunho', async () => {
  const r = await classificarDesconhecidos({ desconhecidos: [
    campo('c1', 'Você é uma pessoa com deficiência (PcD)?', 'select'), campo('c2', 'Raça/cor'), campo('c3', 'Do you require visa sponsorship?'),
    campo('c4', 'Qual a sua pretensão salarial?'), campo('c5', 'Quantos anos de experiência você tem com gestão?', 'textarea'),
    campo('c6', 'Data de início disponível', 'date'), campo('c7', 'Você tem disponibilidade para viagens?', 'radio'),
  ] });
  assert.deepEqual(Object.values(decisoes(r)), Array(7).fill('pergunta'));
  assert.equal(r.campos.find(c => c.ref === 'c5').categoria, 'sensivel');
  assert.equal(r.campos.some(c => c.rascunho_llm), false);
});

test('texto aberto vira rascunho marcado rascunho_llm', async () => {
  const r = await classificarDesconhecidos({ desconhecidos: [campo('c1', 'Conte sobre um projeto em que você liderou uma migração.', 'textarea'), campo('c2', 'Why do you want to join us?')] });
  assert.deepEqual(r.campos.map(c => [c.decisao, c.rascunho_llm]), [['rascunho', true], ['rascunho', true]]);
});

test('conflito de interesse e declaração legal viram pergunta, mesmo em texto aberto', async () => {
  const r = await classificarDesconhecidos({ desconhecidos: [
    campo('c1', 'Você possui parentes trabalhando na empresa? Descreva.', 'textarea'),
    campo('c2', 'Declaro que as informações são verdadeiras', 'checkbox'),
    campo('c3', 'Explique qualquer conflito de interesse', 'textarea'),
  ] });
  assert.deepEqual(Object.values(decisoes(r)), ['pergunta', 'pergunta', 'pergunta']);
});

test('rótulo ambíguo sem runner vira pergunta, não chute', async () => {
  const r = await classificarDesconhecidos({ desconhecidos: [campo('c1', 'Código'), campo('c2', '')] });
  assert.deepEqual(r.campos.map(c => [c.decisao, c.categoria]), [['pergunta', 'ambigua'], ['pergunta', 'ambigua']]);
  assert.equal(r.chamadas_llm, 0);
});

test('Haiku só para o que as regras não resolvem, em lote, com contrato estrito', async () => {
  const agente = await loadAgent('classificador-campos');
  assert.equal(agente.modelo, 'haiku');
  assert.deepEqual(agente.tools, ['none']);
  const desconhecidos = [campo('c1', 'Pretensão salarial'), ...Array.from({ length: 25 }, (_, i) => campo(`c${i + 2}`, `Indicação ${i}`))];
  const { runner, chamadas } = runnerFake(entrada => ({ itens: entrada.campos.map(c => ({ ref: c.ref, categoria: c.ref === 'c2' ? 'aberta' : 'factual' })) }));
  const r = await classificarDesconhecidos({ desconhecidos, runner });
  assert.equal(r.chamadas_llm, 2);
  assert.equal(chamadas.length, 2);
  assert.ok(chamadas.every(c => !c.entrada.campos.some(x => x.ref === 'c1')), 'o campo resolvido por regra não vai ao modelo');
  assert.deepEqual(chamadas.map(c => c.entrada.campos.length), [20, 5]);
  assert.equal(r.campos.find(c => c.ref === 'c2').decisao, 'rascunho');
  assert.equal(r.campos.find(c => c.ref === 'c3').decisao, 'pergunta');
  assert.deepEqual(r.campos.map(c => c.ref), desconhecidos.map(c => c.ref));
  const { runner: ruim } = runnerFake(() => ({ itens: [{ ref: 'c2', categoria: 'aberta', resposta: 'x' }] }));
  await assert.rejects(classificarDesconhecidos({ desconhecidos: [campo('c2', 'Indicação')], runner: ruim }), LlmSaidaInvalida);
});

test('a saída nunca contém dado da identidade', async () => {
  const identidade = ['Ana Exemplo', 'ana@exemplo.test'];
  const { runner, chamadas } = runnerFake(entrada => ({ itens: entrada.campos.map(c => ({ ref: c.ref, categoria: 'ambigua' })) }));
  const r = await classificarDesconhecidos({ desconhecidos: [campo('c1', 'Confirme o e-mail ana@exemplo.test'), campo('c2', 'Ana Exemplo, conte sua história', 'textarea')], runner, identity: identidade });
  const texto = JSON.stringify(r) + JSON.stringify(chamadas.map(c => c.entrada));
  assert.doesNotMatch(texto, /Ana Exemplo|ana@exemplo\.test/);
});
