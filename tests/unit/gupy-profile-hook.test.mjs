import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir, repoRoot } from '../helpers/cli.mjs';
import { decidirPerfil } from '../../core/apply/gupyProfileHook.mjs';
import { SCRIPT_PERFIL, SCRIPT_RECARREGAR_PERFIL, iniciarPerfil, lerPerfil, proporPerfil, aprovarPerfilPorMensagem } from '../../core/apply/gupyProfile.mjs';

const prefix = 'mcp__claude-in-chrome__', sessionId = 'sessao-01';
const estado = { abas: [{ tab_id: '7', session_id: sessionId, itens: [{ script: 'script-exato' }], expira_em: '2999-01-01T00:00:00.000Z' }] };
let call = 0;
const e = (name, input = {}, session_id = sessionId) => ({ tool_name: `${prefix}${name}`, tool_input: input, session_id, tool_use_id: `tool-call-${++call}` });

test('ramo perfil nega escrita livre, leitura integral, coords, upload, teclas e scripts alterados', () => {
  for (const [name, input] of [['computer', { action: 'type', text: 'x' }], ['computer', { action: 'key', text: 'Tab' }], ['computer', { action: 'left_click' }], ['form_input', {}], ['file_upload', {}], ['javascript_tool', { text: 'script-exato;' }], ['read_page', {}], ['get_page_text', {}], ['navigate', { url: 'javascript:alert(1)' }]]) assert.equal(decidirPerfil(e(name, { tabId: 7, ...input }), estado)?.decisao, 'negar');
  assert.equal(decidirPerfil(e('javascript_tool', { text: SCRIPT_PERFIL }), estado).decisao, 'negar');
  assert.equal(decidirPerfil(e('javascript_tool', { tabId: 7, text: SCRIPT_PERFIL }, 'outra-sessao'), estado).decisao, 'negar');
  assert.equal(decidirPerfil(e('javascript_tool', { tabId: 7, text: SCRIPT_PERFIL }), estado).decisao, 'permitir');
  assert.equal(decidirPerfil(e('javascript_tool', { tabId: 7, text: SCRIPT_RECARREGAR_PERFIL }), estado).decisao, 'permitir');
  assert.equal(decidirPerfil(e('form_input', { tabId: 8 }), estado), null);
});

test('batch valida tudo antes de consumir: duas mudanças, tab implícita e escrita posterior negam', () => {
  const change = { name: 'javascript_tool', input: { tabId: 7, text: 'script-exato' } };
  for (const actions of [[change, change], [change, { name: 'form_input', input: { tabId: 7 } }], [{ ...change, input: { text: 'script-exato' } }]]) assert.equal(decidirPerfil(e('browser_batch', { actions }), estado).decisao, 'negar');
  assert.equal(decidirPerfil(e('browser_batch', { actions: [{ name: 'javascript_tool', input: { tabId: 7, text: SCRIPT_RECARREGAR_PERFIL } }, change] }), estado).consumir.script, 'script-exato');
});

test('PreToolUse protege perfil antes do ramo candidatura e falha fechado para estado corrompido', async t => {
  const root = await tempDir(t);
  await iniciarPerfil(root, { tabId: '7', sessionId });
  const hook = input => {
    const r = spawnSync(process.execPath, [path.join(repoRoot, 'hooks/pre-tool-use.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, DATA_ROOT: root } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
  };
  assert.equal(hook(e('form_input', { tabId: 7, value: 'x' })), 'deny');
  assert.equal(hook(e('javascript_tool', { tabId: 7, text: SCRIPT_PERFIL })), 'allow');
  await writeFile(path.join(root, 'state', 'perfil-gupy.json'), '{');
  assert.equal(hook(e('javascript_tool', { tabId: 7, text: SCRIPT_PERFIL })), 'deny');
});

test('sessão é vinculada pelo primeiro envelope real; corrida A/B só admite uma e reinit preserva dono', async t => {
  const root = await tempDir(t);
  await iniciarPerfil(root, { tabId: '7' });
  await assert.rejects(proporPerfil(root, { tabId: '7' }), /vinculada/);
  assert.equal((await aprovarPerfilPorMensagem(root, { mensagem: `aprovar perfil ${'a'.repeat(64)} []`, sessionId })).length, 0);
  const unbound = await lerPerfil(root);
  assert.equal(decidirPerfil(e('javascript_tool', { tabId: 7, text: SCRIPT_PERFIL + ';' }), unbound).decisao, 'negar');
  assert.equal(decidirPerfil({ ...e('javascript_tool', { tabId: 7, text: SCRIPT_PERFIL }), session_id: undefined }, unbound).decisao, 'negar');
  assert.equal(decidirPerfil(e('browser_batch', { actions: [{ name: 'javascript_tool', input: { tabId: 7, text: SCRIPT_PERFIL } }] }), unbound).decisao, 'negar');
  const hook = session_id => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(repoRoot, 'hooks/pre-tool-use.mjs')], { env: { ...process.env, DATA_ROOT: root, CLAUDE_SESSION_ID: '' }, windowsHide: true });
    let output = ''; p.stdout.on('data', b => output += b); p.on('error', reject);
    p.on('exit', code => code === 0 ? resolve(JSON.parse(output).hookSpecificOutput.permissionDecision) : reject(Error(output)));
    p.stdin.end(JSON.stringify(e('javascript_tool', { tabId: 7, text: SCRIPT_PERFIL }, session_id)));
  });
  assert.deepEqual((await Promise.all([hook('sessao-A'), hook('sessao-B')])).sort(), ['allow', 'deny']);
  const owner = (await lerPerfil(root)).abas[0].session_id;
  await iniciarPerfil(root, { tabId: '7', sessionId: 'sessao-C' });
  assert.equal((await lerPerfil(root)).abas[0].session_id, owner);
  assert.equal(await hook('sessao-C'), 'deny');
});
