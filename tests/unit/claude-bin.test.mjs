import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { resolveClaudeBin } from '../../core/llm/claudeBin.mjs';

test('CLAUDE_BIN tem prioridade e precisa existir', async t => {
  const dir = await tempDir(t);
  const exe = path.join(dir, 'meu-claude');
  await writeFile(exe, '');
  assert.equal(await resolveClaudeBin({ env: { CLAUDE_BIN: exe, PATH: '' } }), exe);
  await assert.rejects(resolveClaudeBin({ env: { CLAUDE_BIN: path.join(dir, 'nada'), PATH: '' } }), /CLAUDE_BIN/);
});

test('procura no PATH e, no Windows, nas pastas do app desktop', async t => {
  const dir = await tempDir(t);
  await writeFile(path.join(dir, 'claude'), '');
  assert.equal(await resolveClaudeBin({ env: { PATH: dir }, platform: 'linux' }), path.join(dir, 'claude'));
  const appdata = path.join(dir, 'roaming');
  const pasta = path.join(appdata, 'Claude', 'claude-code', '2.1.0', 'abc');
  await mkdir(pasta, { recursive: true });
  await writeFile(path.join(pasta, 'claude.exe'), '');
  assert.equal(await resolveClaudeBin({ env: { PATH: '', APPDATA: appdata }, platform: 'win32' }), path.join(pasta, 'claude.exe'));
});

test('sem executável, a mensagem diz o que fazer', async () => {
  await assert.rejects(resolveClaudeBin({ env: { PATH: '' }, platform: 'linux' }), /CLAUDE_BIN/);
});
