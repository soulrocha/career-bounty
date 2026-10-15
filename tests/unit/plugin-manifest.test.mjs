import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { validatePlugin } from '../../core/plugin/validate.mjs';

async function copyPlugin(t) {
  const dir = await tempDir(t, 'cb-plugin-');
  for (const item of ['.claude-plugin', 'commands', 'agents', 'hooks', 'CLAUDE.md']) {
    await cp(path.join(repoRoot, item), path.join(dir, item), { recursive: true });
  }
  return dir;
}
const errorsOf = async dir => (await validatePlugin(dir)).errors;

test('o repositório é um plugin válido: manifestos, comandos, agentes, hooks e CLAUDE.md', async () => {
  const result = await validatePlugin(repoRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.commands >= 3, 'esqueleto de comandos');
  assert.ok(result.agents >= 3, 'esqueleto de agentes');
});

test('plugin validate na CLI devolve ok', () => {
  const result = run(['plugin', 'validate', '--json'], { cwd: repoRoot });
  assert.equal(result.status, 0);
  assert.equal(result.json.ok, true);
});

test('manifesto sem campo exigido ou marketplace com caminho inexistente é acusado', async t => {
  const dir = await copyPlugin(t);
  const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
  const original = JSON.parse(await readFile(manifest, 'utf8'));
  await writeFile(manifest, JSON.stringify({ ...original, name: undefined }));
  assert.match((await errorsOf(dir)).join('\n'), /plugin\.json.*name/);
  await writeFile(manifest, JSON.stringify(original));
  const market = path.join(dir, '.claude-plugin', 'marketplace.json');
  const m = JSON.parse(await readFile(market, 'utf8'));
  m.plugins[0].source = './nao-existe';
  await writeFile(market, JSON.stringify(m));
  assert.match((await errorsOf(dir)).join('\n'), /marketplace\.json.*nao-existe/);
});

test('comando sem description ou que chama subcomando inexistente é acusado', async t => {
  const dir = await copyPlugin(t);
  await writeFile(path.join(dir, 'commands', 'ruim.md'), '---\n---\nRode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" doctor`.\n');
  assert.match((await errorsOf(dir)).join('\n'), /commands\/ruim\.md.*description/);
  await writeFile(path.join(dir, 'commands', 'ruim.md'), '---\ndescription: x\n---\nRode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" voar`.\n');
  assert.match((await errorsOf(dir)).join('\n'), /commands\/ruim\.md.*voar/);
  await writeFile(path.join(dir, 'commands', 'ruim.md'), '---\ndescription: x\n---\nSem chamada nenhuma.\n');
  assert.match((await errorsOf(dir)).join('\n'), /commands\/ruim\.md.*subcomando/);
});

test('agente sem model, sem lista de ferramentas ou leitor com ferramenta de escrita é acusado', async t => {
  const dir = await copyPlugin(t);
  const file = path.join(dir, 'agents', 'triador.md');
  await writeFile(file, '---\nname: triador\ndescription: x\ntools: Read\n---\ncorpo\n');
  assert.match((await errorsOf(dir)).join('\n'), /agents\/triador\.md.*model/);
  await writeFile(file, '---\nname: triador\ndescription: x\nmodel: haiku\n---\ncorpo\n');
  assert.match((await errorsOf(dir)).join('\n'), /agents\/triador\.md.*tools/);
  await writeFile(file, '---\nname: triador\ndescription: x\nmodel: haiku\ntools: Read, Write\n---\ncorpo\n');
  assert.match((await errorsOf(dir)).join('\n'), /agents\/triador\.md.*escrita/);
});

test('CLAUDE.md com 60 linhas ou mais, ou com dado pessoal, é acusado', async t => {
  const dir = await copyPlugin(t);
  await writeFile(path.join(dir, 'CLAUDE.md'), 'linha\n'.repeat(60));
  assert.match((await errorsOf(dir)).join('\n'), /CLAUDE\.md.*60/);
  await writeFile(path.join(dir, 'CLAUDE.md'), `caminho ${['', 'home', 'maria', 'x'].join('/')}/\n`);
  assert.match((await errorsOf(dir)).join('\n'), /CLAUDE\.md.*dado pessoal/);
});

test('hooks.json inválido ou apontando para script inexistente é acusado', async t => {
  const dir = await copyPlugin(t);
  const file = path.join(dir, 'hooks', 'hooks.json');
  await writeFile(file, '{ nao e json');
  assert.match((await errorsOf(dir)).join('\n'), /hooks\.json.*JSON/);
  await writeFile(file, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/sumiu.mjs"' }] }] } }));
  assert.match((await errorsOf(dir)).join('\n'), /hooks\.json.*sumiu\.mjs/);
});

test('.mcp.json só pode listar o MCP público da Gupy e sem credencial', async t => {
  const dir = await copyPlugin(t);
  const file = path.join(dir, '.mcp.json');
  await writeFile(file, JSON.stringify({ mcpServers: { 'gupy-candidates': { type: 'http', url: 'https://mcp.exemplo.test/gupy' } } }));
  assert.deepEqual(await errorsOf(dir), []);
  await writeFile(file, JSON.stringify({ mcpServers: { outro: { type: 'http', url: 'https://x.exemplo.test' } } }));
  assert.match((await errorsOf(dir)).join('\n'), /\.mcp\.json.*outro/);
  await writeFile(file, JSON.stringify({ mcpServers: { 'gupy-candidates': { type: 'http', url: 'https://x.exemplo.test', headers: { Authorization: 'Bearer x' } } } }));
  assert.match((await errorsOf(dir)).join('\n'), /\.mcp\.json.*credencial/);
  await rm(file);
});

test('todo comando restringe allowed-tools ao CLI do plugin', async t => {
  const dir = await copyPlugin(t);
  const cmd = path.join(dir, 'commands', 'doctor.md');
  const original = await readFile(cmd, 'utf8');
  assert.deepEqual(await errorsOf(dir), []);
  for (const tools of ['Bash(node:*)', 'Bash', 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*), Write']) {
    await writeFile(cmd, original.replace(/allowed-tools:.*/, `allowed-tools: ${tools}`));
    assert.match((await errorsOf(dir)).join('\n'), /commands\/doctor\.md.*allowed-tools/, tools);
  }
  await writeFile(cmd, original.replace(/allowed-tools:.*\n/, ''));
  assert.match((await errorsOf(dir)).join('\n'), /commands\/doctor\.md.*allowed-tools/);
});
