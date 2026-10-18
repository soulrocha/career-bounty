import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { HOJE } from '../helpers/apply.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { eventoPerguntaPendente, idPergunta, projetarPerguntas, responderPergunta } from '../../core/apply/perguntas.mjs';
import { lerRespostas } from '../../core/apply/answers.mjs';
import { casarCampos } from '../../core/apply/matcher.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { startPanel } from '../../panel/server.mjs';

const TS = '2026-10-17T12:00:00.000Z';
const vagaA = { id: 'vaga-a', empresa: 'Empresa 01', cargo: 'Gerente de Produto', descricao_completa: 'JD longa que não pode ir para a pergunta' };
const vagaB = { id: 'vaga-b', empresa: 'Empresa 02', cargo: 'Product Owner' };
const salario = { ref: 'c4', label: 'Qual a sua pretensão salarial?', tipo: 'text', obrigatorio: true, categoria: 'sensivel' };
const modelo = { ref: 'c2', label: 'Modelo de contratação preferido', tipo: 'select', opcoes: ['CLT', 'PJ'], obrigatorio: true, categoria: 'factual' };

async function comPendentes(t, campos = [salario]) {
  const dataRoot = await tempDir(t);
  const eventos = [vagaA, vagaB].flatMap(vaga => campos.map(campo => eventoPerguntaPendente({ vaga, campo, portal: vaga === vagaA ? 'Gupy' : 'Lever', ts: TS })));
  await appendEvents(dataRoot, eventos, { now: TS });
  return dataRoot;
}
const pendentes = async dataRoot => projetarPerguntas((await readEvents(dataRoot)).eventos);

test('campo desconhecido vira pergunta.pendente com contexto mínimo, sem a JD, e a mesma pergunta junta as vagas', async t => {
  const e = eventoPerguntaPendente({ vaga: vagaA, campo: salario, portal: 'Gupy', ts: TS });
  assert.equal(e.tipo, 'pergunta.pendente');
  assert.equal(e.entidade_id, idPergunta('QUAL a sua pretensao salarial'));
  assert.doesNotMatch(JSON.stringify(e), /JD longa/);
  assert.deepEqual(Object.keys(e.dados).sort(), ['cargo', 'categoria', 'empresa', 'label', 'obrigatorio', 'portal', 'tipo', 'vaga_id']);
  const { pendentes: lista, porVaga } = await pendentes(await comPendentes(t));
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0].vagas.map(v => v.vaga_id), ['vaga-a', 'vaga-b']);
  assert.deepEqual([...porVaga.keys()], ['vaga-a', 'vaga-b']);
});

test('resposta global grava no answer bank, libera as vagas e a mesma pergunta é preenchida sozinha na vez seguinte', async t => {
  const dataRoot = await comPendentes(t);
  const r = await responderPergunta({ dataRoot, perguntaId: idPergunta(salario.label), resposta: 'R$ 10.000 (CLT)', escopo: { tipo: 'global' }, ts: TS });
  assert.deepEqual(r.liberadas, ['vaga-a', 'vaga-b']);
  const { pendentes: lista, porVaga } = await pendentes(dataRoot);
  assert.deepEqual(lista, []);
  assert.equal(porVaga.size, 0);
  const banco = await lerRespostas(dataRoot);
  assert.equal(banco.length, 1);
  assert.equal(banco[0].sensivel, true);
  assert.equal(banco[0].validade, '2027-04-15');
  const extracao = { campos: [{ ref: 'c9', label: 'Qual a sua pretensão salarial?', tipo: 'text', obrigatorio: true }] };
  const outra = casarCampos({ extracao, respostas: banco, empresa: 'Empresa 03', hoje: HOJE });
  assert.equal(outra.preenchimentos[0].valor, 'R$ 10.000 (CLT)');
  assert.equal(outra.desconhecidos.length, 0);
});

test('resposta com escopo de empresa não vaza para outra empresa: a outra vaga continua esperando', async t => {
  const dataRoot = await comPendentes(t, [modelo]);
  const pid = idPergunta(modelo.label);
  await responderPergunta({ dataRoot, perguntaId: pid, resposta: 'PJ', escopo: { tipo: 'empresa', valor: 'Empresa 01' }, ts: TS });
  const { pendentes: lista } = await pendentes(dataRoot);
  assert.deepEqual(lista[0].vagas.map(v => v.vaga_id), ['vaga-b']);
  const banco = await lerRespostas(dataRoot);
  const campos = { campos: [{ ref: 'c2', label: modelo.label, tipo: 'select', opcoes: ['CLT', 'PJ'], obrigatorio: true }] };
  assert.equal(casarCampos({ extracao: campos, respostas: banco, empresa: 'Empresa 01', hoje: HOJE }).preenchimentos[0].valor, 'PJ');
  assert.equal(casarCampos({ extracao: campos, respostas: banco, empresa: 'Empresa 02', hoje: HOJE }).preenchimentos.length, 0);
});

test('resposta fora das opções, vazia ou com escopo de empresa alheia é recusada', async t => {
  const dataRoot = await comPendentes(t, [modelo]);
  const pid = idPergunta(modelo.label);
  await assert.rejects(responderPergunta({ dataRoot, perguntaId: pid, resposta: 'Estágio', escopo: { tipo: 'global' } }), /opções/);
  await assert.rejects(responderPergunta({ dataRoot, perguntaId: pid, resposta: 'PJ', escopo: { tipo: 'empresa', valor: 'Empresa 09' } }), /escopo empresa/);
  await assert.rejects(responderPergunta({ dataRoot, perguntaId: 'pq-inexistente', resposta: 'PJ', escopo: { tipo: 'global' } }), /não encontrada/);
});

test('GET e POST /api/perguntas exigem token; a pergunta respondida some da aba; funciona também no modo sombra', async t => {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const pipeline = makeLegado({ vagas: 1 });
  const arquivo = path.join(origem, 'pipeline-vagas.json');
  await writeFile(arquivo, JSON.stringify(pipeline));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  const estado = path.join(dataRoot, 'state/migration.json');
  assert.equal(JSON.parse(await readFile(estado, 'utf8')).mode, 'shadow');
  await appendEvents(dataRoot, [eventoPerguntaPendente({ vaga: vagaA, campo: salario, portal: 'Gupy', ts: TS })], { now: TS });
  const panel = await startPanel({ dataRoot, port: 0, now: () => TS, hostId: 'pc-a' });
  t.after(panel.close);
  const pagina = await (await fetch(panel.url)).text();
  assert.match(pagina, /role="tab"[^>]*>Perguntas</);
  const token = JSON.parse(pagina.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  assert.equal((await fetch(`${panel.url}/api/perguntas`)).status, 403);
  const lista = await (await fetch(`${panel.url}/api/perguntas`, { headers: { 'X-Painel-Token': token } })).json();
  assert.equal(lista.perguntas.length, 1);
  const post = (corpo, headers = {}) => fetch(`${panel.url}/api/perguntas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: panel.url, 'X-Painel-Token': token, ...headers }, body: JSON.stringify(corpo) });
  assert.equal((await post({ id: lista.perguntas[0].id, resposta: 'x', escopo: { tipo: 'global' } }, { 'X-Painel-Token': 'errado' })).status, 403);
  assert.equal((await post({ id: lista.perguntas[0].id, resposta: 'x', escopo: { tipo: 'global' }, extra: 1 })).status, 400);
  const ok = await post({ id: lista.perguntas[0].id, resposta: 'R$ 10.000', escopo: { tipo: 'global' } });
  assert.equal(ok.status, 200, await ok.clone().text());
  const depois = await (await fetch(`${panel.url}/api/perguntas`, { headers: { 'X-Painel-Token': token } })).json();
  assert.deepEqual(depois.perguntas, []);
  // A projeção legada não muda: a sombra continua igual ao legado.
  assert.equal(run(['verify', '--json'], { dataRoot }).status, 0);
});
