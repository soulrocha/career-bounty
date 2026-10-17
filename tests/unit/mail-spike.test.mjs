import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from '../helpers/cli.mjs';
import { parseEnvelope, stripFence } from '../../core/llm/runner.mjs';

const read = relative => readFile(path.join(repoRoot, relative), 'utf8');

test('F3.1: a nota do spike registra decisão go, custo medido e as ferramentas do conector', async () => {
  const nota = (await read('docs/SOURCES.md')).split(/^## /m).find(secao => secao.startsWith('Conector Gmail'));
  assert.ok(nota, 'seção do conector Gmail ausente');
  assert.match(nota, /Decisão: GO/);
  assert.match(nota, /US\$\s?0,007/);
  assert.match(nota, /mcp__claude_ai_Gmail__search_threads/);
  assert.match(nota, /--disallowedTools/);
  assert.match(nota, /autorização/i);
});

test('F3.1: o envelope gravado do spike é lido pelo parser de `claude -p` e a saída vem em cerca json', async () => {
  const bruto = await read('tests/replay/mail/spike-envelope.json');
  const { texto, uso } = parseEnvelope(bruto);
  assert.ok(uso.tokens_cache_leitura > 100000, 'o contexto carregado é quase todo cache');
  assert.equal(uso.custo_usd, 0.007);
  assert.ok(JSON.parse(stripFence(texto)).itens.length > 0);
  assert.equal(JSON.parse(bruto).num_turns, 3);
});
