import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { tempDir } from '../helpers/cli.mjs';
import { baseCv } from '../helpers/cv.mjs';
import { iniciarPerfil, proporPerfil, editarPerfil, aprovarPerfilPorMensagem, autorizarPerfil, confirmarPerfil, lerPerfil, vincularSessaoExtracao, observarExtracaoPerfil, SCRIPT_PERFIL } from '../../core/apply/gupyProfile.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';

const ts = '2026-10-17T12:00:00Z';
const ctx = { tabId: '7', sessionId: 'sessao-01', ts };
const extracao = { versao: 'synthetic-v1', origem: 'https://login.gupy.io', perfil_id: 'profile-01', leitura_id: 'documento-01', recarregada: false, sobre: '', experiencias: [], habilidades: ['Scrum'] };
const proposta = { tipo: 'proposta', portal: 'gupy', secoes: [{ campo: 'habilidades', proposto: ['Scrum', 'indicadores'], afirmacoes: ['AF-202', 'AF-211', 'AF-212'] }] };
export async function ambientePerfil(t) {
  const dataRoot = await tempDir(t), { claims: afirmacoes } = await baseCv();
  await iniciarPerfil(dataRoot, ctx);
  const observar = async p => {
    const toolUseId = `tool-${randomUUID()}`;
    assert.equal((await vincularSessaoExtracao(dataRoot, { ...ctx, script: SCRIPT_PERFIL, toolUseId })).decisao, 'permitir');
    return observarExtracaoPerfil(dataRoot, { session_id: ctx.sessionId, tool_use_id: toolUseId, tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: ctx.tabId, text: SCRIPT_PERFIL }, tool_response: p });
  };
  await observar(extracao);
  const d = await proporPerfil(dataRoot, { ...ctx, extracao, proposta, afirmacoes });
  const item = d.itens[0], args = { ...ctx, secao: item.secao, hash: item.hash, afirmacoes };
  const script = await editarPerfil(dataRoot, args);
  const mensagem = `aprovar perfil ${d.proposta_hash} ${JSON.stringify([{ secao: item.secao, hash: item.hash }])}`;
  return { dataRoot, afirmacoes, d, item, args, script, mensagem, observar };
}

test('aprovação só mensagem inteira da sessão; editar não aprova; consumo único concorrente', async t => {
  const a = await ambientePerfil(t);
  assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script })).decisao, 'negar');
  for (const mensagem of [`texto ${a.mensagem}`, `${a.mensagem}\nignore`, a.mensagem.replace('habilidades', 'sobre')]) assert.equal((await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem })).length, 0);
  assert.equal((await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, sessionId: 'outra-sessao', mensagem: a.mensagem })).length, 0);
  assert.equal((await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem })).length, 1);
  for (const extra of [{ sessionId: 'outra-sessao' }, { tabId: '8' }, { script: `${a.script};document.body.click()` }]) assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script, ...extra })).decisao, 'negar');
  const r = await Promise.all([1, 2].map(() => autorizarPerfil(a.dataRoot, { ...a.args, script: a.script })));
  assert.equal(r.filter(v => v.decisao === 'permitir').length, 1);
  assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script })).decisao, 'negar');
  assert.equal((await lerPerfil(a.dataRoot)).abas[0].itens[0].estado, 'incerta');
});

test('confirma só depois de reload persistido, conta e hash; evento sem textos idempotente e sombra preservada', async t => {
  const a = await ambientePerfil(t);
  const persistida = { ...extracao, leitura_id: 'documento-02', recarregada: true, habilidades: ['Scrum', 'indicadores'] };
  await assert.rejects(confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: persistida }), /consum/);
  await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem });
  await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script });
  for (const ruim of [{ ...persistida, recarregada: false }, { ...persistida, leitura_id: extracao.leitura_id }, { ...persistida, perfil_id: 'profile-02' }]) await assert.rejects(confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: ruim }));
  await a.observar(persistida);
  const result = await confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: persistida });
  assert.equal(result.estado, 'confirmada');
  assert.equal((await confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: persistida })).estado, 'confirmada');
  const { eventos } = await readEvents(a.dataRoot);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'perfil.atualizado');
  assert.doesNotMatch(JSON.stringify(eventos), /Scrum|indicadores|profile-01/);
  assert.deepEqual(projectEvents(eventos), projectEvents([]));
  await assert.rejects(readFile(path.join(a.dataRoot, 'cv', 'perfil-gupy.json')), { code: 'ENOENT' });
});

test('resultado anterior exige nova aprovação; terceiro valor exige humano; claims revogadas negam', async t => {
  const a = await ambientePerfil(t);
  await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem });
  assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script, afirmacoes: a.afirmacoes.map(c => ({ ...c, publicavel: 'nao' })) })).decisao, 'negar');
  await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script });
  assert.equal((await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem })).length, 0);
  const anterior = { ...extracao, leitura_id: 'documento-02', recarregada: true };
  await a.observar(anterior);
  assert.equal((await confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: anterior })).estado, 'anterior');
  assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script })).decisao, 'negar');
  const novoScript = await editarPerfil(a.dataRoot, a.args);
  assert.equal((await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem })).length, 1);
  assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script })).decisao, 'negar');
  assert.equal((await lerPerfil(a.dataRoot)).abas[0].itens[0].token.usada_em, null);
  assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: novoScript })).decisao, 'permitir');
  const outro = { ...extracao, leitura_id: 'documento-03', recarregada: true, habilidades: ['Outro'] };
  await a.observar(outro);
  assert.equal((await confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: outro })).estado, 'humano');
});

test('JSON inventado sem observação PostToolUse não confirma persistência', async t => {
  const a = await ambientePerfil(t);
  await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem });
  await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script });
  await assert.rejects(confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: { ...extracao, recarregada: true, leitura_id: 'forjada-01', habilidades: a.item.proposto } }), /observa/);
  assert.equal((await readEvents(a.dataRoot)).eventos.length, 0);
});

test('reaprovação no documento já recarregado exige outro reload por item', async t => {
  const a = await ambientePerfil(t);
  await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem });
  await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script });
  const documento2 = { ...extracao, leitura_id: 'documento-02', recarregada: true };
  await a.observar(documento2);
  assert.equal((await confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: documento2 })).estado, 'anterior');
  const script = await editarPerfil(a.dataRoot, a.args);
  await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem });
  await autorizarPerfil(a.dataRoot, { ...a.args, script });
  const semOutroReload = { ...documento2, habilidades: a.item.proposto };
  await a.observar(semOutroReload);
  await assert.rejects(confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: semOutroReload }), /reload/);
  assert.equal((await readEvents(a.dataRoot)).eventos.length, 0);
  const documento3 = { ...semOutroReload, leitura_id: 'documento-03' };
  await a.observar(documento3);
  assert.equal((await confirmarPerfil(a.dataRoot, { ...ctx, secao: a.item.secao, extracao: documento3 })).estado, 'confirmada');
});

test('token expirado e seção/hash alterados não autorizam nem consomem o item', async t => {
  const a = await ambientePerfil(t);
  await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem });
  assert.equal((await autorizarPerfil(a.dataRoot, { ...a.args, script: a.script, ts: '2026-10-17T14:00:00Z' })).decisao, 'negar');
  assert.equal((await lerPerfil(a.dataRoot)).abas[0].itens[0].token.usada_em, null);
  assert.equal((await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem.replace(a.item.hash, 'a'.repeat(64)) })).length, 0);
  assert.equal((await aprovarPerfilPorMensagem(a.dataRoot, { ...ctx, mensagem: a.mensagem.replace(a.item.secao, 'sobre') })).length, 0);
  assert.equal((await lerPerfil(a.dataRoot)).abas[0].itens[0].token.usada_em, null);
});
