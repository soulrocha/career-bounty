import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { makeCorpus } from '../fixtures/mail/make-corpus.mjs';
import { defaultSettings } from '../../core/config.mjs';
import { createRunner } from '../../core/llm/runner.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { lerCursor } from '../../core/mail/cursor.mjs';
import { avisoEmailNaoConferido, INSTRUCAO_CONECTOR, sincronizarEmail } from '../../core/mail/sync.mjs';
import { validatePlugin } from '../../core/plugin/validate.mjs';
import { parseFrontmatter } from '../../core/kb/schema.mjs';
import { ehEscritaGmail } from '../../core/mail/tools.mjs';

const corpus = makeCorpus();
const AGORA = new Date('2026-10-14T20:00:00-03:00');
const semana = corpus.digests.at(-1);
const settings = () => ({ mail: { ...defaultSettings().mail, ativo: true, limite_fase_b: 50 } });
const importarVagas = dataRoot => appendEvents(dataRoot, corpus.vagas.map((v, i) => ({ id: `imp-${v.id}`, ts: `2026-10-01T00:00:${String(i % 60).padStart(2, '0')}Z`, ator: 'teste', tipo: 'vaga.importada', entidade: 'vaga', entidade_id: v.id, dados: { legado: v } })));

function fakeGmail(contador = {}) {
  return ({ agente, entrada }) => {
    contador[agente] = (contador[agente] ?? 0) + 1;
    if (agente === 'leitor-email-busca') return semana;
    if (agente === 'leitor-email-abertura') return { itens: entrada.ids.map(id => ({ message_id: id, corpo: corpus.fulls[id] })) };
    return { resultados: entrada.emails.map(e => ({ message_id: e.message_id, classe: 'pendente', confianca: 'baixa', evidencia: 'vago' })) };
  };
}

test('dry-run lê e processa, mas não grava evento, cursor nem estado no DATA_ROOT', async t => {
  const dataRoot = await tempDir(t);
  const ledgerRoot = await tempDir(t);
  await importarVagas(dataRoot);
  const antes = (await readEvents(dataRoot)).eventos.length;
  const runner = createRunner({ modo: 'fake', dataRoot: ledgerRoot, fake: fakeGmail() });
  const r = await sincronizarEmail({ dataRoot, ledgerRoot, settings: settings(), runner, now: AGORA, dryRun: true });
  assert.equal(r.ok, true, JSON.stringify(r.falha));
  assert.equal(r.itens, semana.itens.length);
  assert.ok(Object.keys(r.eventos_por_tipo).length > 0);
  assert.equal((await readEvents(dataRoot)).eventos.length, antes);
  assert.equal((await lerCursor(dataRoot, { now: AGORA })).ate, null);
  assert.equal(await avisoEmailNaoConferido(dataRoot, { ativo: true, now: AGORA }), 'E-mail não conferido hoje.');
  assert.ok(r.tokens.busca.chamadas === 1);
  assert.ok(!JSON.stringify(r).includes('Confirmação'), 'o relatório não traz assunto de e-mail');
});

test('sync gravando: eventos, cursor e estado; a segunda rodada não repete efeito nem chama a fase B', async t => {
  const dataRoot = await tempDir(t);
  await importarVagas(dataRoot);
  const contador = {};
  const runner = createRunner({ modo: 'fake', dataRoot, fake: fakeGmail(contador) });
  const r1 = await sincronizarEmail({ dataRoot, settings: settings(), runner, now: AGORA });
  assert.equal(r1.ok, true);
  const depois1 = (await readEvents(dataRoot)).eventos.filter(e => e.ator === 'email');
  assert.ok(depois1.length > 0);
  assert.equal((await lerCursor(dataRoot, { now: AGORA })).ate, '2026-10-14');
  assert.equal(await avisoEmailNaoConferido(dataRoot, { ativo: true, now: AGORA }), null);
  assert.equal(await avisoEmailNaoConferido(dataRoot, { ativo: false, now: AGORA }), null);
  const aberturasAntes = contador['leitor-email-abertura'] ?? 0;
  const r2 = await sincronizarEmail({ dataRoot, settings: settings(), runner, now: new Date(AGORA.getTime() + 3600000) });
  assert.equal(r2.novos, 0);
  assert.equal(r2.abertos, 0);
  assert.equal(contador['leitor-email-abertura'] ?? 0, aberturasAntes, 'sem e-mail novo, a fase B não roda');
  assert.equal((await readEvents(dataRoot)).eventos.filter(e => e.ator === 'email').length, depois1.length);
});

test('falha na busca: e-mail não conferido, cursor mantido, e o conector ausente traz a instrução de ativação', async t => {
  const dataRoot = await tempDir(t);
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => { throw new Error('tool not found: mcp__claude_ai_Gmail__search_threads (conector não conectado)'); } });
  const r = await sincronizarEmail({ dataRoot, settings: settings(), runner, now: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.falha.codigo, 'conector_indisponivel');
  assert.equal(r.falha.instrucao, INSTRUCAO_CONECTOR);
  assert.match(INSTRUCAO_CONECTOR, /Conectores/);
  assert.equal((await lerCursor(dataRoot, { now: AGORA })).ate, null);
  assert.equal(await avisoEmailNaoConferido(dataRoot, { ativo: true, now: AGORA }), 'E-mail não conferido hoje.');
  const estado = JSON.parse(await readFile(path.join(dataRoot, 'state', 'mail-sync.json'), 'utf8'));
  assert.equal(estado.ok, false);
});

test('digest mostra "e-mail não conferido hoje" quando o e-mail está ligado e a rotina não leu', async t => {
  const dataRoot = await tempDir(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ mail: { ativo: true } }));
  const r = run(['digest', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.email_nao_conferido, true);
  const desligado = await tempDir(t);
  assert.equal(run(['digest', '--json'], { dataRoot: desligado }).json.email_nao_conferido, undefined);
});

test('CLI mail sync: sem conector nem execução live na CI, falha com código 1 e sem gravar nada', async t => {
  const dataRoot = await tempDir(t);
  const r = run(['mail', 'sync', '--dry-run', '--json'], { dataRoot, env: { CI: 'true' } });
  assert.equal(r.status, 1);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.falha.etapa, 'busca');
  assert.equal(run(['mail', 'sync', '--salvar-em', path.join(repoRoot, 'x'), '--dry-run', '--json'], { dataRoot, env: { CI: 'true' } }).status, 2, 'resultado real nunca dentro do repositório');
  assert.equal(run(['mail', 'sync', '--salvar-em', path.join(dataRoot, 'saida'), '--json'], { dataRoot, env: { CI: 'true' } }).status, 2, '--salvar-em exige --dry-run');
});

test('/email e a skill rodam só o CLI do plugin, não listam escrita do Gmail e o plugin valida', async () => {
  const comando = parseFrontmatter(await readFile(path.join(repoRoot, 'commands', 'email.md'), 'utf8'));
  const skill = parseFrontmatter(await readFile(path.join(repoRoot, 'skills', 'email', 'SKILL.md'), 'utf8'));
  for (const { data } of [comando, skill]) {
    const tools = String(data['allowed-tools']).split(/,(?![^(]*\))/).map(x => x.trim());
    assert.ok(tools.every(x => x.startsWith('Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs"')));
    assert.ok(!tools.some(ehEscritaGmail));
  }
  assert.match(comando.body, /mail sync/);
  assert.match(comando.body, /Configurações, Conectores/);
  assert.match(comando.body, /Não tente outra via/);
  const r = await validatePlugin(repoRoot);
  assert.deepEqual(r.errors, []);
});

test('e-mail falso de entrevista não gera proposta de calendário no sync', async t => {
  const dataRoot = await tempDir(t);
  await importarVagas(dataRoot);
  const runner = createRunner({ modo: 'fake', dataRoot, fake: fakeGmail() });
  const r = await sincronizarEmail({ dataRoot, settings: settings(), runner, now: AGORA });
  const eventos = (await readEvents(dataRoot)).eventos;
  const falsos = corpus.itens.filter(i => corpus.labels[i.message_id].armadilha === 'entrevista_falsa').map(i => i.message_id);
  assert.ok(falsos.length > 0);
  assert.ok(r.ok);
  assert.ok(!eventos.some(e => e.tipo === 'calendario.proposto' && falsos.includes(e.dados.message_id)));
  assert.ok(!eventos.some(e => e.tipo === 'email.recebido' && falsos.includes(e.dados.message_id)));
});
