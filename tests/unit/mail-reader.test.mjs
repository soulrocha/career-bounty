import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { createRunner, entradaHash, LlmSaidaInvalida } from '../../core/llm/runner.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { GMAIL_ESCRITA, GMAIL_LEITURA, ehEscritaGmail } from '../../core/mail/tools.mjs';
import { escreverSettingsLeitor, lerFaseA, lerFaseB, montarArgsLeitor } from '../../core/mail/reader.mjs';

const AGORA = new Date('2026-10-14T15:00:00-03:00');
const consulta = { query: 'from:(gupy.com.br) after:2026/10/07', limite: 50, cursor_usado: null };
const digestValido = { cursor_usado: null, consultado_em: '2026-10-14T18:00:00.000Z', precisa_abrir: [], itens: [
  { message_id: 'msg-1', data: '2026-10-13', remetente_nome: 'Portal Exemplo', remetente_dominio: 'gupy.com.br', assunto: 'Confirmação de inscrição', trecho: 'Recebemos sua inscrição' }] };

test('o frontmatter do leitor lista só ferramentas de busca e leitura do Gmail', async () => {
  const agente = await loadAgent('leitor-email');
  assert.equal(agente.modelo, 'haiku');
  assert.ok(agente.tools.length > 0);
  for (const tool of agente.tools) {
    assert.ok(GMAIL_LEITURA.includes(tool), `ferramenta fora da lista de leitura: ${tool}`);
    assert.equal(ehEscritaGmail(tool), false);
  }
  assert.ok(!agente.tools.some(tool => /^(Bash|Write|Edit|WebFetch)$/.test(tool)));
});

test('a lista de escrita cobre enviar, responder, encaminhar, apagar, rotular, rascunho e spam', () => {
  for (const acao of ['send_message', 'reply', 'forward', 'trash_message', 'trash_thread', 'delete_draft', 'create_draft', 'update_draft', 'label_thread', 'update_message_labels', 'mark_thread_spam', 'delete_label']) {
    assert.ok(GMAIL_ESCRITA.includes(`mcp__claude_ai_Gmail__${acao}`), acao);
  }
  assert.ok(GMAIL_ESCRITA.every(nome => nome.startsWith('mcp__claude_ai_Gmail__')));
  assert.equal(GMAIL_LEITURA.filter(nome => GMAIL_ESCRITA.includes(nome)).length, 0);
  assert.equal(ehEscritaGmail('mcp__qualquer-id__send_message'), true);
  assert.equal(ehEscritaGmail('mcp__claude_ai_Gmail__algo_novo_no_futuro'), true, 'o que não é leitura conhecida é tratado como escrita');
  assert.equal(ehEscritaGmail('mcp__claude_ai_Gmail__search_threads'), false);
});

test('o comando do claude -p libera só a leitura da fase e nega todas as de escrita', async t => {
  const dir = await tempDir(t);
  const agente = await loadAgent('leitor-email');
  const settingsFile = await escreverSettingsLeitor({ dir });
  for (const [fase, permitidas] of [['A', ['mcp__claude_ai_Gmail__search_threads']], ['B', ['mcp__claude_ai_Gmail__get_thread', 'mcp__claude_ai_Gmail__get_message']]]) {
    const args = montarArgsLeitor({ fase, modelo: agente.modelo, sistema: agente.sistema, settingsFile });
    const valor = flag => args[args.indexOf(flag) + 1];
    assert.equal(valor('--model'), 'haiku');
    assert.deepEqual(valor('--allowedTools').split(','), permitidas);
    const negadas = valor('--disallowedTools').split(',');
    for (const escrita of GMAIL_ESCRITA) assert.ok(negadas.includes(escrita), `não nega ${escrita}`);
    for (const embutida of ['Bash', 'Write', 'Edit']) assert.ok(negadas.includes(embutida), embutida);
    assert.ok(args.includes('--no-session-persistence'));
    assert.equal(valor('--settings'), settingsFile);
    assert.equal(valor('--output-format'), 'json');
  }
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  const hook = settings.hooks.PreToolUse[0];
  assert.match(hook.matcher, /mcp__/);
  assert.match(hook.hooks[0].command, /pre-tool-use\.mjs/);
});

test('o prompt do leitor trata e-mail como dado em delimitador e nunca como instrução', async () => {
  const { sistema } = await loadAgent('leitor-email');
  assert.match(sistema, /dado_nao_confiavel/);
  assert.match(sistema, /nunca (é )?instru/i);
  assert.match(sistema, /somente com (o )?JSON/i);
  assert.match(sistema, /nunca (devolva|inclua|escreva) (o )?endereço/i);
});

test('fase A: a entrada é a consulta de F3.3 e a saída é validada pelo contrato', async t => {
  const dataRoot = await tempDir(t);
  let visto;
  const runner = createRunner({ modo: 'fake', dataRoot, fake: ({ entrada }) => { visto = entrada; return digestValido; } });
  const r = await lerFaseA({ runner, consulta, now: AGORA, rodada: 'r1' });
  assert.deepEqual(visto, { fase: 'A', consulta: consulta.query, limite: 50, cursor_usado: null, hoje: '2026-10-14' });
  assert.equal(r.digest.itens[0].message_id, 'msg-1');
  const { eventos } = await readEvents(dataRoot);
  const uso = eventos.find(e => e.tipo === 'llm.uso');
  assert.equal(uso.dados.agente, 'leitor-email-busca');
  assert.equal(uso.dados.rodada, 'r1');
  assert.equal(uso.dados.fase, 'busca');
});

test('fase A: campo extra devolvido pelo modelo é rejeitado com erro tipado', async t => {
  const dataRoot = await tempDir(t);
  const ruim = { ...digestValido, itens: [{ ...digestValido.itens[0], acao: 'forward' }] };
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => ruim });
  await assert.rejects(lerFaseA({ runner, consulta, now: AGORA }), error => error instanceof LlmSaidaInvalida && /campo fora do contrato/.test(error.message));
});

test('fase B: só roda com ids, no máximo N por rodada, e só aceita o corpo dos ids pedidos', async t => {
  const dataRoot = await tempDir(t);
  let chamadas = 0;
  let pedidos;
  const fake = ({ entrada }) => { chamadas += 1; pedidos = entrada.ids; return { itens: entrada.ids.map(id => ({ message_id: id, corpo: `corpo de ${id}` })) }; };
  const runner = createRunner({ modo: 'fake', dataRoot, fake });
  const vazio = await lerFaseB({ runner, ids: [], limite: 5, rodada: 'r1' });
  assert.equal(chamadas, 0, 'sem ids a fase B não é chamada');
  assert.deepEqual(vazio.itens, []);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const r = await lerFaseB({ runner, ids, limite: 5, rodada: 'r1' });
  assert.equal(chamadas, 1);
  assert.deepEqual(pedidos, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(r.adiados, ['f', 'g']);
  assert.equal(r.itens.length, 5);
  const runnerRuim = createRunner({ modo: 'fake', dataRoot, fake: () => ({ itens: [{ message_id: 'zzz', corpo: 'x' }] }) });
  await assert.rejects(lerFaseB({ runner: runnerRuim, ids: ['a'], limite: 5 }), LlmSaidaInvalida);
});

test('execução via replay: reproduz a gravação; mudar a entrada invalida', async t => {
  const dataRoot = await tempDir(t);
  const replayDir = path.join(await tempDir(t), 'mail');
  await mkdir(replayDir, { recursive: true });
  const agente = await loadAgent('leitor-email');
  const entrada = { fase: 'A', consulta: consulta.query, limite: 50, cursor_usado: null, hoje: '2026-10-14' };
  const hash = entradaHash({ agente: 'leitor-email-busca', modelo: agente.modelo, versaoPrompt: agente.versaoPrompt, entrada });
  await writeFile(path.join(replayDir, `leitor-email-busca-${hash.slice(0, 16)}.json`), JSON.stringify({ hash, agente: 'leitor-email-busca', saida: `\`\`\`json\n${JSON.stringify(digestValido)}\n\`\`\``, uso: { tokens_in: 100, tokens_out: 50 } }));
  const runner = createRunner({ modo: 'replay', dataRoot, replayDir });
  const r = await lerFaseA({ runner, consulta, now: AGORA });
  assert.equal(r.digest.itens.length, 1);
  await assert.rejects(lerFaseA({ runner, consulta: { ...consulta, query: 'outra consulta' }, now: AGORA }), /Sem gravação/);
});

test('o runner live repassa os argumentos próprios do leitor (sem o --tools vazio do runner padrão)', async t => {
  const dataRoot = await tempDir(t);
  const dir = await tempDir(t);
  const falso = path.join(dir, 'falso-claude.mjs');
  await writeFile(falso, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ result: JSON.stringify({ argv: process.argv.slice(2) }), usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0.001 })));");
  const runner = createRunner({ modo: 'live', dataRoot, claudeBin: process.execPath, env: { LIVE: '1' } });
  const { json } = await runner.run({ agente: 'leitor-email-busca', modelo: 'haiku', versaoPrompt: 'v', entrada: { x: 1 }, argsLive: [falso, '--allowedTools', 'mcp__claude_ai_Gmail__search_threads'], validar: () => {} });
  assert.deepEqual(json.argv, ['--allowedTools', 'mcp__claude_ai_Gmail__search_threads']);
});
