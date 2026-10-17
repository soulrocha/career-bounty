// Regressões do QA adversarial da F6.13 (achados 1 a 8), com fixture e estado temporário.
import assert from 'node:assert/strict';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { baseCv } from '../helpers/cv.mjs';
import { pagina, portal, semNavegador } from '../helpers/navegador.mjs';
import { diffPerfil, encerrarPerfil, extrairPerfil, iniciarPerfil, lerPerfil, scriptDoItem } from '../../core/apply/gupyProfile.mjs';
import { decidirPerfil } from '../../core/apply/gupyProfileHook.mjs';
import { scriptDeEnvio } from '../../core/apply/sessao.mjs';

const LOCAL = { origin: 'https://login.gupy.io', pathname: '/candidates/curriculum' };
const AGORA = '2026-10-17T12:00:00.000Z';
const ORIGINAL = 'Gestão de produto de uma plataforma interna de dados.';
const DESCRICAO = 'Economizou R$ 2,3 mi em renegociação de contratos.';
const extrair = p => p.avaliar(`(${extrairPerfil.toString()})(document,${JSON.stringify(LOCAL)})`);

async function preparar(p) {
  const { claims } = await baseCv();
  const d = diffPerfil({ extracao: await extrair(p), afirmacoes: claims, proposta: { tipo: 'proposta', portal: 'gupy', secoes: [{ campo: 'experiencia:p0', atual: '', proposto: DESCRICAO, afirmacoes: ['AF-209'] }] } });
  const script = scriptDoItem({ perfil: d.perfil, observacao: { leitura_id: d.perfil.leitura_id } }, d.itens[0]);
  return () => p.avaliar(`(()=>{const location=${JSON.stringify(LOCAL)};return ${script}})()`);
}
const marcas = p => p.avaliar('({ exp: document.body.dataset.salvo ?? null, hab: document.body.dataset.salvoHabilidades ?? null, dados: document.body.dataset.salvoDados ?? null })');

test('QA 1: batch que toca a aba de perfil não leva ação a outra aba (envio, clique, script livre, navegação)', () => {
  const estado = { abas: [{ tab_id: '7', session_id: 's1', itens: [], expira_em: '2999-01-01T00:00:00.000Z' }] };
  const batch = outro => decidirPerfil({ tool_name: 'mcp__claude-in-chrome__browser_batch', session_id: 's1', tool_input: { actions: [{ name: 'computer', input: { action: 'scroll', tabId: 7 } }, outro] } }, estado, AGORA);
  for (const outro of [
    { name: 'javascript_tool', input: { tabId: 8, text: scriptDeEnvio('vaga-x') } },
    { name: 'computer', input: { action: 'left_click', coordinate: [1, 1], tabId: 8 } },
    { name: 'javascript_tool', input: { tabId: 8, text: 'document.forms[0].submit()' } },
    { name: 'navigate', input: { tabId: 9, url: 'https://exemplo.test' } },
  ]) assert.equal(batch(outro)?.decisao, 'negar', JSON.stringify(outro));
  // Batch só na aba de perfil continua permitido.
  assert.equal(batch({ name: 'computer', input: { action: 'wait', tabId: 7 } })?.decisao, 'permitir');
});

test('QA 2: com outra seção suja ("Salvar" visível antes), o item não escreve nem salva', { skip: semNavegador }, async t => {
  for (const sujar of [
    "document.querySelector('[onclick*=salvoHabilidades]').parentElement.classList.remove('fechado')",
    "document.getElementById('sec-dados').classList.remove('fechado');document.getElementById('sec-dados').insertAdjacentHTML('beforeend','<button type=\"button\" onclick=\"document.body.dataset.salvoDados=1\">Salvar</button>')",
  ]) {
    const p = await pagina(t, portal('gupy-curriculo'));
    const executar = await preparar(p);
    await p.avaliar(sujar);
    assert.match((await executar()).erro, /alteração não salva/);
    assert.deepEqual(await marcas(p), { exp: null, hab: null, dados: null });
    assert.equal(await p.avaliar("document.getElementById('activitiesPerformed-0').value"), ORIGINAL);
  }
});

test('QA 2: "Salvar" invisível (altura zero, opacidade zero) ou fora da seção Experiência não é clicado', { skip: semNavegador }, async t => {
  for (const [esconder, nome] of [
    ["document.getElementById('barra-exp').style.cssText='height:0;overflow:hidden'", 'altura zero'],
    ["document.getElementById('barra-exp').style.opacity='0'", 'opacidade zero'],
    ["document.getElementById('sec-exp').addEventListener('input',()=>{document.getElementById('barra-exp').remove();document.body.insertAdjacentHTML('beforeend','<button type=\"button\" onclick=\"document.body.dataset.salvoDados=1\">Salvar</button>')})", 'Salvar fora da seção'],
  ]) {
    const p = await pagina(t, portal('gupy-curriculo'));
    const executar = await preparar(p);
    await p.avaliar(esconder);
    const r = await executar();
    assert.ok(r.erro, nome);
    assert.deepEqual(await marcas(p), { exp: null, hab: null, dados: null }, nome);
  }
});

test('QA 3: restauração é conferida; handler que reescreve o texto dá "restauração não confirmada"', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('gupy-curriculo'));
  const executar = await preparar(p);
  await p.avaliar("document.getElementById('salvar').disabled=true");
  assert.deepEqual(await executar(), { erro: 'perfil/alvo/hash/formulário mudou; ação humana necessária', restaurado: true });
  assert.equal(await p.avaliar("document.getElementById('activitiesPerformed-0').value"), ORIGINAL);
  const p2 = await pagina(t, portal('gupy-curriculo'));
  const executar2 = await preparar(p2);
  await p2.avaliar("document.getElementById('salvar').disabled=true;document.getElementById('activitiesPerformed-0').addEventListener('input',e=>{if(e.target.value!=='texto não aprovado')e.target.value='texto não aprovado'})");
  const r = await executar2();
  assert.equal(r.restaurado, false);
  assert.match(r.erro, /restauração não confirmada/);
  assert.equal((await marcas(p2)).exp, null);
});

test('QA 4 e 5: aba de perfil vence em 24 h, encerra pelo comando e recomeça na mesma aba', async t => {
  const dataRoot = await tempDir(t);
  await iniciarPerfil(dataRoot, { tabId: '7', ts: AGORA });
  const estado = await lerPerfil(dataRoot);
  const semAba = { tool_name: 'mcp__claude-in-chrome__computer', tool_input: { action: 'left_click', coordinate: [1, 1] } };
  assert.equal(decidirPerfil(semAba, estado, AGORA)?.decisao, 'negar');
  assert.equal(decidirPerfil(semAba, estado, '2026-10-18T12:00:01.000Z'), null, 'depois de 24 h a aba não prende mais o navegador');
  Object.assign(estado.abas[0], { session_id: 's1', perfil: { perfil_id: 'conta-1' }, itens: [{ secao: 'experiencia:p0', estado: 'editavel' }] });
  const { atomicJson } = await import('../../core/store/atomicWrite.mjs');
  const path = (await import('node:path')).default;
  await atomicJson(path.join(dataRoot, 'state', 'perfil-gupy.json'), estado);
  const de_novo = await iniciarPerfil(dataRoot, { tabId: '7', ts: AGORA });
  assert.equal(de_novo.recomecada, true);
  assert.deepEqual((await lerPerfil(dataRoot)).abas[0].itens, []);
  assert.equal((await lerPerfil(dataRoot)).abas[0].session_id, 's1', 'o dono da aba é preservado');
  assert.deepEqual(await encerrarPerfil(dataRoot, { tabId: '7' }), { encerrada: true });
  assert.equal((await lerPerfil(dataRoot)).abas.length, 0);
  assert.equal(decidirPerfil(semAba, await lerPerfil(dataRoot), AGORA), null);
});

test('QA 6: a saída de propor embrulha o texto da página e não devolve o perfil cru', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = (await import('node:path')).default;
  const { repoRoot } = await import('../helpers/cli.mjs');
  const cli = await readFile(path.join(repoRoot, 'core/cli/gupy.mjs'), 'utf8');
  assert.match(cli, /embrulhar/);
  assert.match(cli, /resumoDaProposta\(await proporPerfil/);
});

test('QA 3: com um item incerto na aba, o próximo item não é autorizado (o Salvar dele persistiria o texto não confirmado)', async t => {
  const { randomUUID } = await import('node:crypto');
  const g = await import('../../core/apply/gupyProfile.mjs');
  const dataRoot = await tempDir(t);
  const { claims: afirmacoes } = await baseCv();
  const ctx = { tabId: '7', sessionId: 'sessao-01', ts: '2026-10-17T12:00:00Z' };
  const extracao = { versao: 'synthetic-v1', origem: 'https://login.gupy.io', perfil_id: 'profile-01', leitura_id: 'documento-01', recarregada: false, sobre: '', experiencias: [], habilidades: ['Scrum'] };
  const proposta = { tipo: 'proposta', portal: 'gupy', secoes: [
    { campo: 'sobre', proposto: 'Analista de produto que implantou um painel de indicadores usado por 41 pessoas.', afirmacoes: ['AF-202'] },
    { campo: 'habilidades', proposto: ['Scrum', 'indicadores'], afirmacoes: ['AF-202', 'AF-212'] },
  ] };
  await g.iniciarPerfil(dataRoot, ctx);
  const toolUseId = `tool-${randomUUID()}`;
  await g.vincularSessaoExtracao(dataRoot, { ...ctx, script: g.SCRIPT_PERFIL, toolUseId });
  await g.observarExtracaoPerfil(dataRoot, { session_id: ctx.sessionId, tool_use_id: toolUseId, tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: ctx.tabId, text: g.SCRIPT_PERFIL }, tool_response: extracao });
  const d = await g.proporPerfil(dataRoot, { ...ctx, extracao, proposta, afirmacoes });
  const scripts = [];
  for (const item of d.itens) scripts.push(await g.editarPerfil(dataRoot, { ...ctx, secao: item.secao, hash: item.hash, afirmacoes }));
  const aprovados = await g.aprovarPerfilPorMensagem(dataRoot, { mensagem: `aprovar perfil ${d.proposta_hash} ${JSON.stringify(d.itens.map(i => ({ secao: i.secao, hash: i.hash })))}`, sessionId: ctx.sessionId, ts: ctx.ts });
  assert.equal(aprovados.length, 2);
  assert.equal((await g.autorizarPerfil(dataRoot, { ...ctx, script: scripts[0], afirmacoes })).decisao, 'permitir');
  const segundo = await g.autorizarPerfil(dataRoot, { ...ctx, script: scripts[1], afirmacoes });
  assert.equal(segundo.decisao, 'negar');
  assert.match(segundo.motivo, /Outro item desta aba está incerto/);
});

test('re-QA: item incerto não vence com o tempo; aba antiga sem validade vence', () => {
  const semAba = { tool_name: 'mcp__claude-in-chrome__computer', tool_input: { action: 'left_click', coordinate: [1, 1] } };
  const incerta = { abas: [{ tab_id: '7', session_id: 's1', itens: [{ estado: 'incerta' }], expira_em: '2026-10-17T13:00:00.000Z' }] };
  assert.equal(decidirPerfil(semAba, incerta, '2026-10-20T00:00:00.000Z')?.decisao, 'negar');
  const antiga = { abas: [{ tab_id: '7', session_id: 's1', itens: [] }] };
  assert.equal(decidirPerfil(semAba, antiga, AGORA), null);
});

test('re-QA: depois de encerrar à força com item incerto, propor na mesma aba exige leitura recarregada', async t => {
  const { atomicJson } = await import('../../core/store/atomicWrite.mjs');
  const path = (await import('node:path')).default;
  const dataRoot = await tempDir(t);
  await atomicJson(path.join(dataRoot, 'state', 'perfil-gupy.json'), { versao: 1, abas: [{ tab_id: '7', session_id: 's1', itens: [{ secao: 'experiencia:p0', estado: 'incerta' }], expira_em: '2999-01-01T00:00:00.000Z' }] });
  await assert.rejects(encerrarPerfil(dataRoot, { tabId: '7' }), /item incerto/);
  assert.deepEqual(await encerrarPerfil(dataRoot, { tabId: '7', forcar: true }), { encerrada: true });
  assert.deepEqual((await lerPerfil(dataRoot)).exige_recarga, ['7']);
});
