import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envDasOpcoes } from '../../core/cli/llm.mjs';

test('--live liga CAREER_BOUNTY_LIVE, a variável que o runner exige', () => {
  assert.equal(envDasOpcoes({ '--live': true }, {}).CAREER_BOUNTY_LIVE, '1');
});

test('sem --live o ambiente não ganha opt-in de chamada cobrada', () => {
  assert.equal(envDasOpcoes({ '--replay': 'x' }, {}).CAREER_BOUNTY_LIVE, undefined);
});
