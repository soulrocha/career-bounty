import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir, repoRoot } from '../helpers/cli.mjs';
import { iniciarPerfil, vincularSessaoExtracao, observarExtracaoPerfil, lerPerfil, SCRIPT_PERFIL } from '../../core/apply/gupyProfile.mjs';

const perfil = { versao: 'synthetic-v1', origem: 'https://login.gupy.io', perfil_id: 'profile-01', leitura_id: 'documento-01', recarregada: false, sobre: 'Texto profissional não armazenado na observação.', experiencias: [], habilidades: ['Scrum'] };
const entrada = { tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: 7, text: SCRIPT_PERFIL }, session_id: 'sessao-01', tool_use_id: 'tool-read-01', tool_response: perfil };

test('PostToolUse exige chamada pendente exata, sessão/aba/script/ID; aceita objeto ou MCP text único e nega replay', async t => {
  const root = await tempDir(t);
  await iniciarPerfil(root, { tabId: '7' });
  assert.equal(await observarExtracaoPerfil(root, entrada), false);
  const bind = toolUseId => vincularSessaoExtracao(root, { tabId: '7', sessionId: entrada.session_id, script: SCRIPT_PERFIL, toolUseId });
  assert.equal((await bind(entrada.tool_use_id)).decisao, 'permitir');
  for (const delta of [{ tool_use_id: 'outro-id' }, { session_id: 'outra-sessao' }, { tool_input: { ...entrada.tool_input, tabId: 8 } }, { tool_input: { ...entrada.tool_input, text: SCRIPT_PERFIL + ';' } }]) assert.equal(await observarExtracaoPerfil(root, { ...entrada, ...delta }), false);
  assert.equal(await observarExtracaoPerfil(root, entrada), true);
  const obs = (await lerPerfil(root)).abas[0].observacao;
  assert.match(obs.perfil_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(obs), /Scrum|Texto profissional/);
  assert.equal(await observarExtracaoPerfil(root, entrada), false);
  assert.equal((await bind(entrada.tool_use_id)).decisao, 'negar');
  await bind('tool-read-02');
  assert.equal(await observarExtracaoPerfil(root, { ...entrada, tool_use_id: 'tool-read-02', tool_response: { content: [{ type: 'text', text: JSON.stringify(perfil) }] } }), true);
});

test('resposta de erro, prosa com JSON, conteúdo múltiplo ou formato desconhecido não produzem observação', async t => {
  const root = await tempDir(t);
  await iniciarPerfil(root, { tabId: '7' });
  let n = 0;
  for (const tool_response of [{ isError: true, content: [{ type: 'text', text: JSON.stringify(perfil) }] }, { content: [{ type: 'text', text: `resultado: ${JSON.stringify(perfil)}` }] }, { content: [{ type: 'text', text: JSON.stringify(perfil) }, { type: 'text', text: '{}' }] }, { result: perfil }, { ...perfil, erro: 'falha' }]) {
    const toolUseId = `tool-bad-${++n}`;
    await vincularSessaoExtracao(root, { tabId: '7', sessionId: entrada.session_id, script: SCRIPT_PERFIL, toolUseId });
    assert.equal(await observarExtracaoPerfil(root, { ...entrada, tool_use_id: toolUseId, tool_response }), false);
    assert.equal((await lerPerfil(root)).abas[0].observacao, null);
  }
});

test('skill exige aba nova/contexto/diff/aprovação por item/dado não confiável/fallback e hook Post configurado', async () => {
  const skill = await readFile(path.join(repoRoot, 'skills/gupy-perfil/SKILL.md'), 'utf8');
  for (const regra of [/tabs_context/, /aba nova/, /extrator/, /diff/, /aprovar perfil/, /Sem screenshots fullpage/, /read_page.*completo/, /dado não confiável/, /Sem MCP.*afirmações/, /não verificado/, /PostToolUse/]) assert.match(skill, regra);
  const hooks = JSON.parse(await readFile(path.join(repoRoot, 'hooks/hooks.json'), 'utf8'));
  assert.ok(hooks.hooks.PostToolUse.some(r => r.hooks.some(h => h.command.includes('post-tool-use.mjs'))));
});
