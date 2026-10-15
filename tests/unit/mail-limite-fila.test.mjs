import assert from 'node:assert/strict';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { makeCorpus } from '../fixtures/mail/make-corpus.mjs';
import { defaultSettings } from '../../core/config.mjs';
import { createRunner } from '../../core/llm/runner.mjs';
import { classificar } from '../../core/mail/rules.mjs';
import { lerCursor } from '../../core/mail/cursor.mjs';
import { lerFilaReabertura, MAX_PAGINAS, sincronizarEmail } from '../../core/mail/sync.mjs';

const AGORA = new Date('2026-10-14T20:00:00-03:00');
const DIA = 86400000;
const configurar = extra => ({ mail: { ...defaultSettings().mail, ativo: true, limite_resultados: 50, limite_fase_b: 50, ...extra } });
const dia = n => new Date(Date.parse('2026-10-14T12:00:00Z') - n * DIA).toISOString().slice(0, 10);

// Gmail de mentira: devolve os itens mais novos primeiro, só com data >= after, cortados no limite da consulta.
function gmailComLimite(universo) {
  const consultas = [];
  const fake = ({ agente, entrada }) => {
    if (agente !== 'leitor-email-busca') return { resultados: [] };
    const after = /after:(\d{4})\/(\d{2})\/(\d{2})/.exec(entrada.consulta).slice(1).join('-');
    const antes = /before:(\d{4})\/(\d{2})\/(\d{2})/.exec(entrada.consulta)?.slice(1).join('-') ?? '9999-12-31';
    consultas.push(after);
    const itens = universo.filter(i => i.data >= after && i.data < antes).sort((a, b) => b.data.localeCompare(a.data) || a.message_id.localeCompare(b.message_id)).slice(0, entrada.limite);
    return { cursor_usado: entrada.cursor_usado, consultado_em: AGORA.toISOString(), itens, precisa_abrir: [] };
  };
  return { fake, consultas };
}

const itemSimples = (n, data) => ({ message_id: `lim-${String(n).padStart(3, '0')}`, data, remetente_nome: 'Aviso', remetente_dominio: 'news.exemplo.test', assunto: `Novidades ${n}`, trecho: 'Resumo da semana.' });

test('consulta que bate o limite (50/50) é paginada por data: nenhum e-mail fica de fora e o cursor vai a hoje só no fim', async t => {
  const dataRoot = await tempDir(t);
  const universo = Array.from({ length: 120 }, (_, i) => itemSimples(i + 1, dia(Math.floor(i / 20))));
  const { fake, consultas } = gmailComLimite(universo);
  const runner = createRunner({ modo: 'fake', dataRoot, fake });
  const r = await sincronizarEmail({ dataRoot, settings: configurar(), runner, now: AGORA });
  assert.equal(r.ok, true, JSON.stringify(r.falha));
  assert.equal(r.itens, 120, 'as páginas somam todo o universo, sem repetir');
  assert.equal(r.novos, 120);
  assert.equal(consultas.length, 3, 'três páginas de até 50');
  assert.ok(r.avisos.some(a => /paginada/.test(a)));
  const cursor = await lerCursor(dataRoot, { now: AGORA });
  assert.equal(cursor.vistos.size, 120, 'todos os 120 foram vistos');
  assert.equal(cursor.ate, '2026-10-14');
});

test('exatamente 50 de 50: confere com uma consulta maior e termina sem avisar de falta de progresso', async t => {
  const dataRoot = await tempDir(t);
  const universo = Array.from({ length: 50 }, (_, i) => itemSimples(i + 1, dia(i % 4)));
  const { fake } = gmailComLimite(universo);
  const runner = createRunner({ modo: 'fake', dataRoot, fake });
  const r = await sincronizarEmail({ dataRoot, settings: configurar(), runner, now: AGORA });
  assert.equal(r.itens, 50);
  assert.ok(!r.avisos.some(a => /sem progresso/.test(a)), r.avisos.join(' | '));
  assert.equal((await lerCursor(dataRoot, { now: AGORA })).ate, '2026-10-14');
});

test('consulta abaixo do limite (49/50) avança o cursor até hoje com uma única consulta', async t => {
  const dataRoot = await tempDir(t);
  const universo = Array.from({ length: 49 }, (_, i) => itemSimples(i + 1, dia(i % 3)));
  const { fake, consultas } = gmailComLimite(universo);
  const runner = createRunner({ modo: 'fake', dataRoot, fake });
  const r = await sincronizarEmail({ dataRoot, settings: configurar(), runner, now: AGORA });
  assert.equal(r.itens, 49);
  assert.equal(consultas.length, 1);
  assert.equal((await lerCursor(dataRoot, { now: AGORA })).ate, '2026-10-14');
});

test('mais e-mails que o limite num só dia: o cursor não avança além do que foi lido e há aviso', async t => {
  const dataRoot = await tempDir(t);
  const universo = Array.from({ length: 150 }, (_, i) => itemSimples(i + 1, dia(0)));
  const runner = createRunner({ modo: 'fake', dataRoot, fake: gmailComLimite(universo).fake });
  const r = await sincronizarEmail({ dataRoot, settings: configurar(), runner, now: AGORA });
  assert.equal(r.ok, true);
  assert.ok(r.avisos.some(a => /sem progresso na data/.test(a)), r.avisos.join(' | '));
  const ate = (await lerCursor(dataRoot, { now: AGORA })).ate;
  assert.ok(ate < '2026-10-14', `cursor em ${ate}: não pode pular os e-mails que não couberam`);
});

test('passou do teto de páginas: o cursor não avança e avisa', async t => {
  const dataRoot = await tempDir(t);
  const universo = Array.from({ length: 600 }, (_, i) => itemSimples(i + 1, dia(Math.floor(i / 10))));
  const { fake, consultas } = gmailComLimite(universo);
  const runner = createRunner({ modo: 'fake', dataRoot, fake });
  const r = await sincronizarEmail({ dataRoot, settings: configurar({ janela_dias: 60 }), runner, now: AGORA });
  assert.equal(consultas.length, MAX_PAGINAS);
  assert.ok(r.avisos.some(a => /passou de 10 páginas/.test(a)), r.avisos.join(' | '));
  assert.ok((await lerCursor(dataRoot, { now: AGORA })).ate < '2026-10-14');
});

// ---- fila de reabertura da fase B ----
const corpus = makeCorpus();
const abriveis = corpus.itens.filter(item => classificar(item, {}).precisa_abrir).slice(0, 7).map(item => ({ ...item, data: dia(1) }));

function gmailDaFila(rodadas, abertas) {
  let busca = 0;
  return ({ agente, entrada }) => {
    if (agente === 'leitor-email-busca') {
      const itens = rodadas[Math.min(busca, rodadas.length - 1)];
      busca += 1;
      return { cursor_usado: entrada.cursor_usado, consultado_em: AGORA.toISOString(), itens: busca > rodadas.length ? [] : itens, precisa_abrir: [] };
    }
    if (agente === 'leitor-email-abertura') {
      abertas.push(entrada.ids);
      return { itens: entrada.ids.map(id => ({ message_id: id, corpo: corpus.fulls[id] ?? 'Corpo de exemplo.' })) };
    }
    return { resultados: entrada.emails.map(e => ({ message_id: e.message_id, classe: 'pendente', confianca: 'baixa', evidencia: 'vago' })) };
  };
}

test('itens adiados pela fase B entram numa fila e são reabertos nas rodadas seguintes, antes dos novos', async t => {
  assert.equal(abriveis.length, 7, 'o corpus tem e-mails suficientes que precisam de abertura');
  const dataRoot = await tempDir(t);
  const primeiros = abriveis.slice(0, 5);
  const novosDepois = abriveis.slice(5);
  const abertas = [];
  const fake = gmailDaFila([primeiros, novosDepois], abertas);
  const runner = createRunner({ modo: 'fake', dataRoot, fake });
  const config = configurar({ limite_fase_b: 2 });

  const r1 = await sincronizarEmail({ dataRoot, settings: config, runner, now: AGORA });
  assert.equal(r1.abertos, 2);
  assert.equal(r1.adiados, 3);
  assert.equal((await lerFilaReabertura(dataRoot, { now: AGORA })).length, 3, 'os 3 adiados ficam na fila');
  const adiadosR1 = (await lerFilaReabertura(dataRoot, { now: AGORA })).map(i => i.message_id);

  const r2 = await sincronizarEmail({ dataRoot, settings: config, runner, now: new Date(AGORA.getTime() + 3600000) });
  assert.equal(r2.reabertos, 3, 'a rodada 2 recebe a fila inteira');
  const idsR2 = abertas[1];
  assert.equal(idsR2.length, 2);
  assert.ok(idsR2.every(id => adiadosR1.includes(id)), 'a fila vem antes dos novos');
  assert.equal(new Set(idsR2).size, 2);

  const r3 = await sincronizarEmail({ dataRoot, settings: config, runner, now: new Date(AGORA.getTime() + 7200000) });
  assert.equal(r3.ok, true);
  const todas = abertas.flat();
  assert.equal(new Set(todas).size, todas.length, 'nenhum e-mail é aberto duas vezes');
  for (let i = 3; i < 8 && (await lerFilaReabertura(dataRoot, { now: AGORA })).length; i += 1) {
    await sincronizarEmail({ dataRoot, settings: config, runner, now: new Date(AGORA.getTime() + (i + 1) * 3600000) });
  }
  assert.equal((await lerFilaReabertura(dataRoot, { now: AGORA })).length, 0, 'a fila esvazia');
  assert.equal(new Set(abertas.flat()).size, abriveis.length, 'todos os 7 foram abertos uma vez');
});

test('dry-run lê a fila mas não a grava nem a esvazia', async t => {
  const dataRoot = await tempDir(t);
  const ledgerRoot = await tempDir(t);
  const abertas = [];
  const runner = createRunner({ modo: 'fake', dataRoot, fake: gmailDaFila([abriveis.slice(0, 4), []], abertas) });
  const config = configurar({ limite_fase_b: 2 });
  await sincronizarEmail({ dataRoot, settings: config, runner, now: AGORA });
  const antes = await lerFilaReabertura(dataRoot, { now: AGORA });
  assert.equal(antes.length, 2);
  const seco = createRunner({ modo: 'fake', dataRoot: ledgerRoot, fake: gmailDaFila([[]], abertas) });
  const r = await sincronizarEmail({ dataRoot, ledgerRoot, settings: config, runner: seco, now: new Date(AGORA.getTime() + 3600000), dryRun: true });
  assert.equal(r.reabertos, 2);
  assert.deepEqual((await lerFilaReabertura(dataRoot, { now: AGORA })).map(i => i.message_id), antes.map(i => i.message_id));
});

test('item velho demais sai da fila com aviso', async t => {
  const dataRoot = await tempDir(t);
  const abertas = [];
  const runner = createRunner({ modo: 'fake', dataRoot, fake: gmailDaFila([abriveis.slice(0, 3), []], abertas) });
  await sincronizarEmail({ dataRoot, settings: configurar({ limite_fase_b: 1 }), runner, now: AGORA });
  assert.equal((await lerFilaReabertura(dataRoot, { now: AGORA })).length, 2);
  const muitoDepois = new Date(AGORA.getTime() + 45 * DIA);
  assert.equal((await lerFilaReabertura(dataRoot, { now: muitoDepois })).length, 0);
});

test('a consulta paginada acrescenta before (dia seguinte ao mais antigo, pois o Gmail exclui o dia) e mantém after', async () => {
  const { buildQuery } = await import('../../core/mail/query.mjs');
  const q = buildQuery({ mail: defaultSettings().mail, cursor: { ate: null }, now: AGORA, ateData: '2026-10-12' });
  assert.match(q.query, / after:2026\/10\/07 before:2026\/10\/13$/);
  assert.doesNotMatch(buildQuery({ mail: defaultSettings().mail, now: AGORA }).query, /before:/);
});
