import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { createRunner, LlmSaidaInvalida } from '../../core/llm/runner.mjs';
import { classificarAmbiguos } from '../../core/mail/classify.mjs';
import { lerFaseA } from '../../core/mail/reader.mjs';
import { montarArgsLeitor } from '../../core/mail/reader.mjs';
import { processarItens } from '../../core/mail/process.mjs';
import { sanitizarEmail } from '../../core/mail/sanitize.mjs';
import { decidirFerramenta } from '../../core/mail/hook.mjs';
import { GMAIL_ESCRITA, GMAIL_LEITURA } from '../../core/mail/tools.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { MARCA_ABRE, MARCA_FECHA } from '../../core/privacy/untrusted.mjs';

const dir = path.join(repoRoot, 'tests', 'fixtures', 'injecao-email');
const emails = await Promise.all((await readdir(dir)).sort().map(async nome => JSON.parse(await readFile(path.join(dir, nome), 'utf8'))));
const AGORA = new Date('2026-10-14T15:00:00-03:00');
const vagas = [{ id: 'v1', empresa: 'Empresa Alfa', cargo: 'Analista', requisicao_id: 'job:48213', candidatura_email: { aplicada: true, etapa: 'inscrita' } }];
const hoje = e => ({ message_id: e.message_id, data: '2026-10-13', remetente_nome: e.remetente_nome, remetente_dominio: e.remetente_dominio, assunto: e.assunto, trecho: e.trecho });

function hook(entrada, argumentos = ['--leitor'], env = {}) {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'hooks', 'pre-tool-use.mjs'), ...argumentos], { input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada), encoding: 'utf8', env: { ...process.env, CAREER_BOUNTY_MAIL_READER: '', ...env } });
  return { status: r.status, saida: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

test('existem 8 e-mails maliciosos sintéticos', () => assert.equal(emails.length, 8));

test('o hook PreToolUse nega toda ferramenta de escrita do Gmail e deixa a leitura passar', () => {
  for (const ferramenta of GMAIL_ESCRITA) {
    const { status, saida } = hook({ tool_name: ferramenta, tool_input: { to: 'x@exemplo.test' } });
    assert.equal(status, 0);
    assert.equal(saida.hookSpecificOutput.permissionDecision, 'deny', ferramenta);
    assert.match(saida.hookSpecificOutput.permissionDecisionReason, /somente leitura/);
  }
  for (const ferramenta of GMAIL_LEITURA) assert.equal(hook({ tool_name: ferramenta, tool_input: {} }).saida, null, ferramenta);
  assert.equal(hook({ tool_name: 'Read', tool_input: {} }).saida, null);
  assert.equal(hook({ tool_name: 'mcp__claude_ai_Gmail__ferramenta_nova', tool_input: {} }).saida.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hook({ tool_name: 'mcp__outro-servidor__reply', tool_input: {} }).saida.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hook('lixo que não é json').saida.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(decidirFerramenta({}, { leitor: true }).hookSpecificOutput.permissionDecision, 'deny');
});

test('fora do leitor o hook do plugin não decide nada: delete_event e a escrita do Gmail seguem o fluxo normal da sessão', () => {
  for (const ferramenta of ['mcp__x__delete_event', 'mcp__claude_ai_Gmail__send_message', 'mcp__ai-memory__memory_write_page']) {
    assert.equal(hook({ tool_name: ferramenta, tool_input: {} }, []).saida, null, ferramenta);
    assert.equal(decidirFerramenta({ tool_name: ferramenta }), null, ferramenta);
  }
  assert.equal(hook('lixo', []).saida, null);
  assert.equal(hook({ tool_name: 'mcp__x__delete_event' }, [], { CAREER_BOUNTY_MAIL_READER: '1' }).saida.hookSpecificOutput.permissionDecision, 'deny', 'a variável dedicada também ativa o modo leitor');
});

test('defesa em profundidade: frontmatter sem escrita, comando com --disallowedTools e hook registrado no plugin', async () => {
  const agente = await loadAgent('leitor-email');
  assert.ok(agente.tools.every(t => !GMAIL_ESCRITA.includes(t)));
  const args = montarArgsLeitor({ fase: 'A', modelo: 'haiku', sistema: agente.sistema });
  const negadas = args[args.indexOf('--disallowedTools') + 1].split(',');
  for (const escrita of GMAIL_ESCRITA) assert.ok(negadas.includes(escrita));
  const hooks = JSON.parse(await readFile(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
  assert.match(JSON.stringify(hooks.hooks.PreToolUse), /pre-tool-use\.mjs/);
});

test('replay obediente devolve campo extra (acao: forward) e o schema rejeita', async t => {
  const dataRoot = await tempDir(t);
  const obediente = { cursor_usado: null, consultado_em: '2026-10-14T18:00:00Z', precisa_abrir: [], itens: [{ ...hoje(emails[0]), acao: 'forward', destino: 'coleta@exemplo.test' }] };
  const runner = createRunner({ modo: 'fake', dataRoot, fake: () => obediente });
  await assert.rejects(lerFaseA({ runner, consulta: { query: 'q', limite: 5 }, now: AGORA }), error => error instanceof LlmSaidaInvalida && /campo fora do contrato/.test(error.message));
});

test('trecho que tenta fechar o delimitador de dado é sanitizado', () => {
  const sujo = emails.find(e => e.ataque === 'fechar_delimitador');
  const { texto } = sanitizarEmail(sujo.corpo);
  assert.ok(!texto.includes(MARCA_FECHA) && !texto.includes(MARCA_ABRE) && !/dado_nao_confiavel/.test(texto));
});

test('as oito injeções passam pelo pipeline sem efeito indevido e sem texto executável nos eventos', async t => {
  const dataRoot = await tempDir(t);
  const corpos = new Map(emails.map(e => [e.message_id, e.corpo]));
  let aoLlm = 0;
  // Modelo "dominado": classifica tudo como entrevista agendada com confiança alta.
  const runner = createRunner({ modo: 'fake', dataRoot, fake: ({ entrada }) => { aoLlm += entrada.emails.length; return { resultados: entrada.emails.map(x => ({ message_id: x.message_id, classe: 'entrevista_agendada', confianca: 'alta', evidencia: 'obedeci' })) }; } });
  const r = await processarItens({
    itens: emails.map(hoje), vagas, now: AGORA, config: {},
    abrir: async ids => ({ itens: ids.map(id => ({ message_id: id, corpo: corpos.get(id) })), adiados: [] }),
    classificarLlm: async lote => (await classificarAmbiguos({ runner, itens: lote })).resultados,
  });
  const json = JSON.stringify(r.eventos);
  assert.ok(!r.eventos.some(e => e.tipo === 'calendario.proposto'), 'nenhuma proposta de Calendar');
  assert.ok(!r.eventos.some(e => e.tipo === 'email.recebido' && ['entrevista', 'oferta'].includes(e.dados.etapa)), 'nenhuma etapa de entrevista ou oferta por injeção');
  assert.equal(r.resumo.avancaram, 0);
  assert.ok(aoLlm <= 1, 'só o e-mail sem ordem ao modelo (exfiltração por URL) chega ao LLM; os que dão ordem nem são enviados');
  for (const proibido of ['coleta@', 'coleta.exemplo', 'confirma.exemplo', 'token=', 'ignore', 'Ignore', 'SISTEMA', 'dado_nao_confiavel', 'Apague', 'Encaminhe', 'http']) assert.ok(!json.includes(proibido), proibido);
  const falso = r.classificados.find(c => c.message_id === 'inj-5');
  assert.equal(falso.confianca, 'baixa');
  assert.ok(r.eventos.some(e => e.tipo === 'email.revisar' && e.dados.message_id === 'inj-5'));
});

test('URL de exfiltração no texto é removida e o corpo não vai para o evento', () => {
  const exfil = emails.find(e => e.ataque === 'exfiltracao_url');
  const { texto, urls } = sanitizarEmail(exfil.corpo);
  assert.deepEqual(urls, []);
  assert.ok(!texto.includes('coleta.exemplo') && !texto.includes('token='));
});
