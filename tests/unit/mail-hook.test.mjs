import assert from 'node:assert/strict';
import test from 'node:test';
import { decidirFerramenta } from '../../core/mail/hook.mjs';
import { ehEscritaMcp, GMAIL_LEITURA } from '../../core/mail/tools.mjs';

const nega = nome => decidirFerramenta({ tool_name: nome }, { leitor: true })?.hookSpecificOutput?.permissionDecision === 'deny';

test('o hook nega ferramenta desconhecida com verbo de escrita em qualquer servidor', () => {
  for (const nome of ['send', 'forward', 'reply', 'trash', 'delete', 'draft', 'label', 'modify', 'move', 'archive', 'spam', 'envio', 'apagar']) {
    assert.equal(nega(`mcp__outro-servidor__${nome}_coisa`), true, nome);
    assert.equal(nega(`mcp__servidor_qualquer__fazer_${nome.toUpperCase()}`), true, `${nome} em maiúsculas`);
  }
  assert.equal(nega('mcp__x__batchModifyMessages'), true, 'camelCase');
  assert.equal(nega('mcp__plugin_google_gmail__users_messages_trash'), true);
});

test('o hook libera só a allowlist de leitura do Gmail e nega qualquer outra ferramenta de um servidor Gmail', () => {
  for (const nome of GMAIL_LEITURA) assert.equal(nega(nome), false, nome);
  assert.equal(nega('mcp__claude_ai_Gmail__search_threads'), false);
  assert.equal(nega('mcp__claude_ai_Gmail__algo_novo_no_futuro'), true);
  assert.equal(nega('mcp__gmail-alternativo__list_messages'), true, 'servidor Gmail fora da allowlist');
});

test('ferramentas de leitura de outros servidores e ferramentas que não são MCP seguem o fluxo normal', () => {
  assert.equal(nega('mcp__calendar__list_events'), false);
  assert.equal(nega('mcp__docs__read_page'), false);
  assert.equal(nega('Read'), false);
  assert.equal(ehEscritaMcp('mcp__calendar__get_event'), false);
  assert.equal(ehEscritaMcp('mcp__calendar__delete_event'), true);
});
