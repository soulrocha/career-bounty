import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { collect } from '../../core/radar/collect.mjs';
import { runStage2 } from '../../core/radar/stage2.mjs';
import { createRunner } from '../../core/llm/runner.mjs';
import { createFake } from '../../core/sources/fake.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { loadSettings } from '../../core/config.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { calcularDelta, elegivel } from '../../core/score/delta.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const afirmacoesBase = await createMarkdownFolder(path.join(repo, 'examples', 'persona-ficticia')).claims();
const v = (n, extra = {}) => ({ fonte: 'fake', portal: 'gupy', requisicao_id: String(8000000 + n), empresa: 'Empresa Alfa', cargo: `Gerente de Engenharia ${n}`, local: 'Brasil', modalidade: 'remoto', regime: 'CLT',
  url: `https://empresa-alfa.gupy.io/jobs/${8000000 + n}`, publicado_em: '2026-10-14', descricao: `Lideranca de plataforma ${n}.`, ...extra });

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ radar: { criterios: { titulos_alvo: ['gerente'], palavras_chave: ['plataforma'] } } }));
  const settings = await loadSettings({ dataRoot });
  const chamadas = { triador: 0, avaliador: 0 };
  const fake = ({ agente, entrada }) => {
    chamadas[agente] += 1;
    if (agente === 'triador') return { resultados: entrada.vagas.map(x => ({ id: x.id, decisao: 'avaliar', motivo: 'ok' })) };
    return { vaga_id: entrada.vaga.id, aderencia_sugerida: 'media', resumo: 'ok', pendencias: [], requisitos: [{ requisito: 'Liderança', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: ['AF-001'], observacao: 'ok' }] };
  };
  const runner = createRunner({ modo: 'fake', dataRoot, fake: args => fake(args) });
  const descobrir = (vagas, dia = '2026-10-14') => collect({ settings, sources: [createFake(vagas)], now: new Date(`${dia}T21:00:00Z`) });
  const estagio2 = (extra = {}) => runStage2({ dataRoot, runner, afirmacoes: afirmacoesBase, brief: 'perfil', now: new Date('2026-10-15T21:00:00Z'), ...extra });
  const projecao = async () => projectEvents((await readEvents(dataRoot)).eventos).vagas;
  return { dataRoot, settings, chamadas, runner, descobrir, estagio2, projecao };
}

test('segunda rodada sem mudança: zero chamadas ao runner', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1), v(2)]);
  const primeira = await a.estagio2();
  assert.deepEqual([primeira.triadas, primeira.avaliadas], [2, 2]);
  const antes = { ...a.chamadas };
  await a.descobrir([v(1), v(2)], '2026-10-15');
  const segunda = await a.estagio2();
  assert.deepEqual(a.chamadas, antes);
  assert.deepEqual([segunda.triadas, segunda.avaliadas], [0, 0]);
});

test('JD alterada (hash novo) reavalia só aquela vaga', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1), v(2)]);
  await a.estagio2();
  const antes = a.chamadas.avaliador;
  await a.descobrir([v(1, { descricao: 'Texto novo da vaga, com requisitos diferentes.' }), v(2)], '2026-10-15');
  const r = await a.estagio2();
  assert.equal(r.avaliadas, 1);
  assert.equal(a.chamadas.avaliador, antes + 1);
});

test('republicação (nova URL, mesma requisição, JD igual) não reavalia e atualiza a aparição', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1)]);
  await a.estagio2();
  const antes = { ...a.chamadas };
  await a.descobrir([v(1, { fonte: 'outra', url: 'https://empresa-alfa-novo.gupy.io/jobs/8000001?utm=x' })], '2026-10-15');
  await a.estagio2();
  assert.deepEqual(a.chamadas, antes);
  const projecao = await a.projecao();
  assert.equal(projecao.length, 1);
  assert.ok(projecao[0].aparicoes.length >= 2);
});

test('mesma requisição com outro endereço de outra fonte também não vira vaga nova', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1)]);
  const r = await a.descobrir([v(1, { fonte: 'inhire-like', url: 'https://boards.exemplo.test/empresa-alfa/vaga-qualquer' })], '2026-10-15');
  assert.equal(r.novas, 0);
  assert.equal((await a.projecao()).length, 1);
});

test('vaga descartada republicada continua descartada e fora do delta', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1)]);
  const [vaga] = await a.projecao();
  await appendEvents(a.dataRoot, [{ id: 'descarte:x', ts: '2026-10-14T22:00:00.000Z', ator: 'usuario', tipo: 'vaga.descartada', entidade: 'vaga', entidade_id: vaga.id, dados: { descartada: true, registrado_em: '2026-10-14T22:00:00.000Z', requisicao: `req:${vaga.requisicao_id}` } }], { now: '2026-10-14T22:00:00.000Z' });
  await a.descobrir([v(1, { url: 'https://empresa-alfa-novo.gupy.io/jobs/8000001' })], '2026-10-15');
  const r = await a.estagio2();
  assert.deepEqual([r.triadas, r.avaliadas], [0, 0]);
  assert.equal(a.chamadas.triador, 0);
});

test('vaga aplicada republicada não vira recomendação', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1)]);
  const [vaga] = await a.projecao();
  await appendEvents(a.dataRoot, [{ id: 'marca:x', ts: '2026-10-14T22:00:00.000Z', ator: 'usuario', tipo: 'candidatura.marcada', entidade: 'vaga', entidade_id: vaga.id, dados: { aplicada: true, data: '2026-10-14', registrado_em: '2026-10-14T22:00:00.000Z' } }], { now: '2026-10-14T22:00:00.000Z' });
  await a.descobrir([v(1, { descricao: 'Texto novo.' })], '2026-10-15');
  const r = await a.estagio2();
  assert.deepEqual([r.triadas, r.avaliadas], [0, 0]);
});

test('mudar o snapshot de afirmações invalida a avaliação (e a versão do prompt também)', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1)]);
  await a.estagio2();
  const antes = a.chamadas.avaliador;
  const alteradas = afirmacoesBase.map(c => (c.id === 'AF-001' ? { ...c, texto: `${c.texto} Atualizado.` } : c));
  const r = await a.estagio2({ afirmacoes: alteradas });
  assert.equal(r.avaliadas, 1);
  assert.equal(a.chamadas.avaliador, antes + 1);
  const puro = calcularDelta(await a.projecao(), { versaoTriador: 'v-novo', versaoAvaliador: 'x', snapshot: 'y' });
  assert.equal(puro.triar.length, 1, 'versão nova do prompt do triador invalida a triagem');
});

test('rodada interrompida no meio retoma sem duplicar', async t => {
  const a = await ambiente(t);
  await a.descobrir([v(1), v(2), v(3)]);
  let n = 0;
  const quebradico = createRunner({ modo: 'fake', dataRoot: a.dataRoot, fake: ({ agente, entrada }) => {
    if (agente === 'triador') return { resultados: entrada.vagas.map(x => ({ id: x.id, decisao: 'avaliar', motivo: 'ok' })) };
    n += 1;
    if (n === 2) throw new Error('queda de rede simulada');
    return { vaga_id: entrada.vaga.id, aderencia_sugerida: 'media', resumo: 'ok', pendencias: [], requisitos: [] };
  } });
  await assert.rejects(runStage2({ dataRoot: a.dataRoot, runner: quebradico, afirmacoes: afirmacoesBase, brief: 'p', now: new Date('2026-10-15T21:00:00Z') }), /queda de rede/);
  const meio = (await a.projecao()).filter(x => x.avaliacao_radar).length;
  assert.equal(meio, 1);
  const retomada = await a.estagio2();
  assert.equal(retomada.avaliadas, 2);
  const eventos = (await readEvents(a.dataRoot)).eventos.filter(e => e.tipo === 'vaga.avaliada');
  assert.equal(eventos.length, 3);
  assert.equal(new Set(eventos.map(e => e.entidade_id)).size, 3);
});

test('collect --dry-run mostra o delta', async t => {
  const a = await ambiente(t);
  const r = await collect({ settings: a.settings, sources: [createFake([v(1), v(2, { cargo: 'Estagiário de Vendas', descricao: 'sem relação' })])], dryRun: true, now: new Date('2026-10-14T21:00:00Z') });
  assert.equal(r.novas, 2);
  assert.equal(r.delta, 1, 'a vaga de pré-score baixo não entra no delta');
  assert.equal(elegivel({ descricao_hash: 'x', pre_nivel: 'baixa' }), false);
});
