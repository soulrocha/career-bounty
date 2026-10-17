// F6.14: candidatura assistida na Gupy (etapa, aceite de risco, trava diária e hook).
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { pagina, portal, semNavegador } from '../helpers/navegador.mjs';
import { SCRIPT_ETAPA_GUPY, classificarEtapa, exigirAceiteGupy } from '../../core/apply/gupyFlow.mjs';
import { aprovarPorMensagem, consumirAprovacao, proporLote } from '../../core/apply/approval.mjs';
import { decidirNavegador } from '../../core/apply/hook.mjs';
import { loadSettings } from '../../core/config.mjs';

const GUPY = 'https://empresa-04.gupy.io';
const sinais = async (t, nome) => ({ ...(await (await pagina(t, portal(nome))).avaliar(SCRIPT_ETAPA_GUPY)), origem: GUPY });

test('só a etapa de perguntas da vaga recebe ação; teste, personalidade e vídeo param', { skip: semNavegador }, async t => {
  assert.equal(classificarEtapa(await sinais(t, 'gupy')).etapa, 'perguntas');
  const teste = classificarEtapa(await sinais(t, 'gupy-teste'));
  assert.equal(teste.etapa, 'pos_inscricao');
  assert.match(teste.motivo, /não é iniciada/);
  // Palavras na descrição da vaga ("vídeo", "teste técnico") não mudam a etapa: só títulos e botões contam.
  assert.equal(classificarEtapa(await sinais(t, 'gupy-descricao')).etapa, 'perguntas');
});

test('etapa desconhecida, fora da Gupy, sucesso ou sinais ilegíveis não recebem ação', () => {
  const base = { origem: GUPY, titulos: ['Perguntas da vaga'], botoes: ['Finalizar candidatura'], campos: 2 };
  assert.equal(classificarEtapa({ ...base, origem: 'https://gupy.io.evil.test' }).etapa, 'desconhecida');
  assert.equal(classificarEtapa({ ...base, titulos: ['Dados complementares'] }).etapa, 'desconhecida');
  assert.equal(classificarEtapa({ ...base, campos: 0 }).etapa, 'desconhecida');
  assert.equal(classificarEtapa({ ...base, titulos: ['Candidatura enviada!'], campos: 0 }).etapa, 'sucesso');
  assert.equal(classificarEtapa({ ...base, botoes: ['Gravar vídeo de apresentação'] }).etapa, 'pos_inscricao');
  assert.equal(classificarEtapa({ ...base, titulos: ['Agendamento da entrevista'] }).etapa, 'pos_inscricao');
  for (const ruim of [null, {}, { ...base, campos: '2' }, { ...base, titulos: 'x' }]) assert.equal(classificarEtapa(ruim).etapa, 'desconhecida');
});

test('a rota Gupy fica desligada até a pessoa aceitar o risco no config; a trava diária é validada', async t => {
  const dataRoot = await tempDir(t);
  const padrao = await loadSettings({ dataRoot });
  assert.deepEqual(padrao.gupy, { aceite_termos: false, max_por_dia: 5 });
  assert.throws(() => exigirAceiteGupy(padrao), /aceite_termos/);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ gupy: { aceite_termos: true, max_por_dia: 3 } }));
  const ligado = await loadSettings({ dataRoot });
  assert.doesNotThrow(() => exigirAceiteGupy(ligado));
  assert.equal(ligado.gupy.max_por_dia, 3);
  for (const ruim of [{ max_por_dia: 0 }, { max_por_dia: 50 }, { max_por_dia: '5' }, { aceite_termos: 'sim' }, { outro: 1 }]) {
    await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ gupy: ruim }));
    await assert.rejects(loadSettings({ dataRoot }), /gupy/, JSON.stringify(ruim));
  }
});

const aprovarGupy = async (dataRoot, n, ts) => {
  const vagas = Array.from({ length: n }, (_, i) => ({ vaga_id: `vaga-g${i}`, chave: `req:G${i}`, empresa: `Empresa 0${(i % 9) + 1}`, cargo: `Cargo ${i}`, rota: 'gupy' }));
  const lote = await proporLote(dataRoot, { vagas, ts });
  assert.equal((await aprovarPorMensagem(dataRoot, { mensagem: lote.frase, ts })).length, n);
  return vagas.map(v => v.vaga_id);
};

test('limite diário da Gupy: a 6ª no mesmo dia de São Paulo é negada; vira o dia, libera', async t => {
  const dataRoot = await tempDir(t);
  // 02:00 UTC de 18/10 é 23:00 de 17/10 em São Paulo; 03:01 UTC já é 18/10.
  const ids = await aprovarGupy(dataRoot, 7, '2026-10-18T02:00:00.000Z');
  for (const id of ids.slice(0, 5)) assert.equal((await consumirAprovacao(dataRoot, { vagaId: id, ts: '2026-10-18T02:10:00.000Z', limiteGupy: 5, aceiteGupy: true })).ok, true, id);
  const sexta = await consumirAprovacao(dataRoot, { vagaId: ids[5], ts: '2026-10-18T02:59:00.000Z', limiteGupy: 5, aceiteGupy: true });
  assert.deepEqual(sexta, { ok: false, motivo: 'limite diário da Gupy atingido (5 por dia, gupy.max_por_dia)' });
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: ids[5], ts: '2026-10-18T03:01:00.000Z', limiteGupy: 5, aceiteGupy: true })).ok, true);
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: ids[5], ts: '2026-10-18T03:02:00.000Z', limiteGupy: 5, aceiteGupy: true })).ok, false, 'uso único');
});

test('concorrência no limite: com 3 restantes, só 3 de 7 consumos simultâneos passam; outra rota não conta', async t => {
  const dataRoot = await tempDir(t);
  const ts = '2026-10-17T15:00:00.000Z';
  const ids = await aprovarGupy(dataRoot, 7, ts);
  const r = await Promise.all(ids.map(id => consumirAprovacao(dataRoot, { vagaId: id, ts, limiteGupy: 3, aceiteGupy: true })));
  assert.equal(r.filter(x => x.ok).length, 3);
  const outra = await proporLote(dataRoot, { vagas: [{ vaga_id: 'vaga-gh', chave: 'req:GH', empresa: 'Empresa 01', cargo: 'X', rota: 'driver' }], ts });
  await aprovarPorMensagem(dataRoot, { mensagem: outra.frase, ts });
  assert.equal((await consumirAprovacao(dataRoot, { vagaId: 'vaga-gh', ts, limiteGupy: 3, aceiteGupy: true })).ok, true);
});

test('na aba de candidatura o script de etapa é observado (chamada individual, nunca em lote) e o resto segue negado', () => {
  const sessao = { abas: [{ tab_id: '5', vaga_id: 'vaga-g0', rota: 'gupy', expira_em: '2026-10-17T23:00:00.000Z' }], scripts: [] };
  const ctx = { sessao, aprovacoes: { aprovacoes: [] }, agora: '2026-10-17T12:00:00.000Z' };
  const decidir = text => decidirNavegador({ tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: 5, text } }, ctx);
  assert.deepEqual(decidir(SCRIPT_ETAPA_GUPY), { decisao: 'permitir', observarEtapa: { tabId: '5' }, motivo: 'leitura da etapa da Gupy' });
  assert.equal(decidir("document.querySelector('button').click()")?.decisao, 'negar');
  const lote = decidirNavegador({ tool_name: 'mcp__claude-in-chrome__browser_batch', tool_input: { actions: [{ name: 'javascript_tool', input: { tabId: 5, text: SCRIPT_ETAPA_GUPY } }] } }, ctx);
  assert.match(lote.motivo, /chamada individual/);
});

// Hooks reais, como o Claude Code os chama.
const hook = (script, entrada, dataRoot, agora = '2026-10-17T12:00:00.000Z') => {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'hooks', script)], { input: JSON.stringify(entrada), encoding: 'utf8', env: { ...process.env, DATA_ROOT: dataRoot, CAREER_BOUNTY_NOW: agora } });
  return r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null;
};
const observarEtapaPeloHook = (dataRoot, sinais, toolUseId) => {
  const chamada = { tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_use_id: toolUseId, tool_input: { tabId: 5, text: SCRIPT_ETAPA_GUPY } };
  assert.equal(hook('pre-tool-use.mjs', chamada, dataRoot)?.hookSpecificOutput?.permissionDecision, 'allow');
  hook('post-tool-use.mjs', { ...chamada, tool_response: sinais }, dataRoot);
};

async function vagaGupy(t) {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const documento = makeLegado({ vagas: 1 });
  const v0 = documento.vagas[0];
  const vaga = { id: v0.id, empresa: v0.empresa, cargo: v0.cargo, url: `${GUPY}/jobs/1`, application_url: `${GUPY}/jobs/1`, status: 'avaliada-sem-envio', aderencia: 'alta', url_status: 'aberta', curriculo_necessario: false };
  documento.vagas = [vaga];
  const arquivo = path.join(origem, 'pipeline.json');
  await writeFile(arquivo, JSON.stringify(documento));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  return { dataRoot, origem, vaga };
}

test('CLI: preparar na Gupy exige o aceite e a etapa observada pelo hook; pós-inscrição para sem criar pergunta', async t => {
  const { dataRoot, origem, vaga } = await vagaGupy(t);
  const plano = run(['apply', 'plan', '--json'], { dataRoot });
  assert.deepEqual(plano.json.fila.map(f => [f.vaga_id, f.rota]), [[vaga.id, 'gupy']]);
  // Sem aceite: o lote é recusado.
  const semAceite = run(['apply', 'lote', '--vagas', vaga.id], { dataRoot });
  assert.notEqual(semAceite.status, 0);
  assert.match(semAceite.stderr, /aceite_termos/);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ gupy: { aceite_termos: true } }));
  assert.equal(run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '5', '--json'], { dataRoot }).status, 0);
  const extracao = path.join(origem, 'extracao.json');
  await writeFile(extracao, JSON.stringify({ campos: [{ ref: 'c1', label: 'Qual a sua pretensão salarial?', tipo: 'text', obrigatorio: true }], bloqueios: {}, botoes_envio: [] }));
  const semEtapa = run(['apply', 'preparar', '--vaga', vaga.id, '--extracao', extracao], { dataRoot });
  assert.notEqual(semEtapa.status, 0);
  assert.match(semEtapa.stderr, /etapa-gupy/);
  // Etapa declarada por arquivo não existe mais: --etapa é opção desconhecida.
  assert.notEqual(run(['apply', 'preparar', '--vaga', vaga.id, '--extracao', extracao, '--etapa', extracao], { dataRoot }).status, 0);
  observarEtapaPeloHook(dataRoot, { origem: GUPY, titulos: ['Teste de perfil comportamental'], botoes: ['Iniciar teste'], campos: 0 }, 'tool-etapa-1');
  const pos = run(['apply', 'preparar', '--vaga', vaga.id, '--extracao', extracao, '--json'], { dataRoot });
  assert.equal(pos.status, 0, pos.stderr);
  assert.deepEqual([pos.json.bloqueada, pos.json.etapa], [true, 'pos_inscricao']);
  const { readEvents } = await import('../../core/store/events.mjs');
  assert.equal((await readEvents(dataRoot)).eventos.filter(e => e.tipo === 'pergunta.pendente').length, 0);
  // Resposta de outra chamada (tool_use_id diferente) não é observada.
  hook('post-tool-use.mjs', { tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_use_id: 'tool-forjada', tool_input: { tabId: 5, text: SCRIPT_ETAPA_GUPY }, tool_response: { origem: GUPY, titulos: ['Perguntas da vaga'], botoes: [], campos: 1 } }, dataRoot);
  assert.equal(run(['apply', 'preparar', '--vaga', vaga.id, '--extracao', extracao, '--json'], { dataRoot }).json.etapa, 'pos_inscricao');
  observarEtapaPeloHook(dataRoot, { content: [{ type: 'text', text: JSON.stringify({ origem: GUPY, titulos: ['Perguntas da vaga'], botoes: ['Finalizar candidatura'], campos: 1 }) }] }, 'tool-etapa-2');
  const ok = run(['apply', 'preparar', '--vaga', vaga.id, '--extracao', extracao, '--json'], { dataRoot });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.perguntas_criadas, 1);
});

test('envio na Gupy: só com aceite vigente, etapa de perguntas observada e script da rota certa', async t => {
  const { dataRoot, vaga } = await vagaGupy(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ gupy: { aceite_termos: true } }));
  assert.equal(run(['apply', 'iniciar', '--vaga', vaga.id, '--aba', '5', '--json'], { dataRoot }).status, 0);
  const lote = run(['apply', 'lote', '--vagas', vaga.id, '--json'], { dataRoot });
  assert.equal(lote.status, 0, lote.stderr);
  hook('user-prompt-submit.mjs', { prompt: lote.json.frase }, dataRoot);
  const script = run(['apply', 'envio', '--vaga', vaga.id, '--json'], { dataRoot }).json.script;
  assert.match(script, /rota Gupy fora de página da Gupy/);
  const envio = { tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_use_id: 'tool-envio', tool_input: { tabId: 5, text: script } };
  // Sem etapa observada: negado, sem consumir a aprovação.
  assert.match(hook('pre-tool-use.mjs', envio, dataRoot).hookSpecificOutput.permissionDecisionReason, /etapa observada/);
  observarEtapaPeloHook(dataRoot, { origem: GUPY, titulos: ['Perguntas da vaga'], botoes: ['Finalizar candidatura'], campos: 1 }, 'tool-etapa-3');
  // Aceite revogado depois da aprovação: negado na hora.
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ gupy: { aceite_termos: false } }));
  assert.match(hook('pre-tool-use.mjs', envio, dataRoot).hookSpecificOutput.permissionDecisionReason, /aceite_termos/);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ gupy: { aceite_termos: true } }));
  assert.equal(hook('pre-tool-use.mjs', envio, dataRoot).hookSpecificOutput.permissionDecision, 'allow');
  // O script de envio genérico (rota de outro portal) não serve nesta aba.
  const generico = { ...envio, tool_input: { tabId: 5, text: (await import('../../core/apply/sessao.mjs')).scriptDeEnvio(vaga.id) } };
  assert.equal(hook('pre-tool-use.mjs', generico, dataRoot).hookSpecificOutput.permissionDecision, 'deny');
});

test('aprovação antiga sem rota não é consumida; etapas de prova, fit cultural e avaliação param', async t => {
  const dataRoot = await tempDir(t);
  const { atomicJson } = await import('../../core/store/atomicWrite.mjs');
  await atomicJson(path.join(dataRoot, 'state', 'aprovacoes.json'), { versao: 1, lote: null, aprovacoes: [{ id: 'x', vaga_id: 'vaga-velha', emitida_em: '2026-10-17T11:00:00.000Z', expira_em: '2026-10-17T13:00:00.000Z', usada_em: null }] });
  assert.deepEqual(await consumirAprovacao(dataRoot, { vagaId: 'vaga-velha', ts: '2026-10-17T12:00:00.000Z', aceiteGupy: true }), { ok: false, motivo: 'aprovação antiga sem rota: monte o lote de novo' });
  const base = { origem: GUPY, botoes: [], campos: 3 };
  for (const titulos of [['Fit Cultural', 'Responda às perguntas abaixo'], ['Prova de inglês'], ['Avaliação de conhecimentos específicos'], ['Questionário de perfil']]) {
    assert.equal(classificarEtapa({ ...base, titulos }).etapa, 'pos_inscricao', titulos.join(' / '));
  }
  assert.equal(classificarEtapa({ ...base, titulos: ['Responda'] }).etapa, 'desconhecida');
});

test('na página, o script de envio confere o domínio: rota Gupy fora da Gupy e outra rota na Gupy recusam', { skip: semNavegador }, async t => {
  const { scriptDeEnvio } = await import('../../core/apply/sessao.mjs');
  const p = await pagina(t, portal('gupy'));
  assert.deepEqual(await p.avaliar(scriptDeEnvio('vaga-g0', 'gupy')), { erro: 'rota Gupy fora de página da Gupy' });
  const naGupy = s => p.avaliar(`(()=>{const location={hostname:'empresa.gupy.io'};return ${s}})()`);
  assert.deepEqual(await naGupy(scriptDeEnvio('vaga-g0')), { erro: 'página da Gupy: use a rota Gupy (aceite, etapa e cota)' });
});

test('a skill gupy-candidatar descreve etapa, lote nominal, trava e parada nas etapas seguintes', async () => {
  const skill = await readFile(path.join(repoRoot, 'skills/gupy-candidatar/SKILL.md'), 'utf8');
  for (const regra of [/tabs_context/, /aba nova/, /etapa-gupy/, /enviar estas/, /max_por_dia/, /aceite_termos/, /teste|vídeo/, /Sobre você/, /bloqueada:humano/]) assert.match(skill, regra);
});
