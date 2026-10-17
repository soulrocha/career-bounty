import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { decidirNavegador } from '../../core/apply/hook.mjs';
import { SCRIPT_EXTRATOR } from '../../core/apply/extrator.mjs';
import { lerAprovacoes, proporLote } from '../../core/apply/approval.mjs';
import { hashScript, lerSessao, marcarAba, registrarScript, scriptDeClique, scriptDeEnvio } from '../../core/apply/sessao.mjs';

const AGORA = '2026-10-17T12:00:00.000Z';
const CHROME = 'mcp__claude-in-chrome__';
const INTEGRADO = 'mcp__Claude_Browser__';
const sessao = { abas: [{ tab_id: '7', vaga_id: 'vaga-01', expira_em: '2026-10-17T15:00:00.000Z' }], scripts: [] };
const semAprovacao = { aprovacoes: [] };
const comAprovacao = { aprovacoes: [{ id: 'x', vaga_id: 'vaga-01', emitida_em: AGORA, expira_em: '2026-10-17T14:00:00.000Z', usada_em: null }] };
const decidir = (tool, input, extra = {}) => decidirNavegador({ tool_name: tool, tool_input: input }, { sessao, aprovacoes: semAprovacao, agora: AGORA, ...extra });

test('clique em botão de envio na aba de candidatura é negado sem aprovação (por coordenada e pelo script de clique)', () => {
  for (const acao of ['left_click', 'double_click', 'triple_click', 'right_click', 'left_click_drag']) {
    assert.equal(decidir(`${CHROME}computer`, { action: acao, coordinate: [10, 10], tabId: 7 })?.decisao, 'negar', acao);
  }
  for (const texto of ['Enviar', 'Candidatar-se', 'Submit Application', 'Apply', 'Finalizar candidatura']) {
    assert.match(scriptDeClique(texto), /botão de envio: use o script de envio/);
  }
  assert.equal(decidir(`${CHROME}computer`, { action: 'key', text: 'Return', tabId: 7 })?.decisao, 'negar');
  assert.equal(decidir(`${CHROME}computer`, { action: 'key', text: 'space', tabId: 7 })?.decisao, 'negar');
  assert.equal(decidir(`${CHROME}computer`, { action: 'key', text: 'Tab', tabId: 7 }), null);
});

test('javascript_tool que chama submit() ou click() fora dos scripts do CareerBounty é negado', () => {
  for (const texto of ['document.forms[0].submit()', "document.querySelector('button').click()", 'document.forms[0].requestSubmit()']) {
    assert.equal(decidir(`${CHROME}javascript_tool`, { action: 'javascript_exec', text: texto, tabId: 7 })?.decisao, 'negar', texto);
  }
});

test('preenchimento comum, leitura e scripts do CareerBounty passam', () => {
  assert.equal(decidir(`${CHROME}form_input`, { ref: 'ref_1', value: 'Ana', tabId: 7 }), null);
  assert.equal(decidir(`${CHROME}computer`, { action: 'type', text: 'Ana', tabId: 7 }), null);
  assert.equal(decidir(`${CHROME}find`, { query: 'Email', tabId: 7 }), null);
  assert.equal(decidir(`${CHROME}javascript_tool`, { text: SCRIPT_EXTRATOR, tabId: 7 }), null);
  assert.equal(decidir(`${CHROME}javascript_tool`, { text: scriptDeClique('Próximo'), tabId: 7 }), null);
  const preenche = '(()=>{/*preenchimento*/})()';
  assert.equal(decidir(`${CHROME}javascript_tool`, { text: preenche, tabId: 7 })?.decisao, 'negar');
  assert.equal(decidir(`${CHROME}javascript_tool`, { text: preenche, tabId: 7 }, { sessao: { ...sessao, scripts: [{ hash: hashScript(preenche), vaga_id: 'vaga-01', expira_em: '2026-10-17T15:00:00.000Z' }] } }), null);
  // Script registrado para outra vaga não vale nesta aba.
  assert.equal(decidir(`${CHROME}javascript_tool`, { text: preenche, tabId: 7 }, { sessao: { ...sessao, scripts: [{ hash: hashScript(preenche), vaga_id: 'vaga-02', expira_em: '2026-10-17T15:00:00.000Z' }] } })?.decisao, 'negar');
  // Aba que não é de candidatura: o hook não decide nada.
  assert.equal(decidir(`${CHROME}computer`, { action: 'left_click', coordinate: [1, 1], tabId: 99 }), null);
});

test('o envio exige aprovação válida da própria vaga; aprovação de uma vaga não libera outra', () => {
  const envio = { text: scriptDeEnvio('vaga-01'), tabId: 7 };
  assert.match(decidir(`${CHROME}javascript_tool`, envio).motivo, /envio sem aprovação/);
  assert.deepEqual(decidir(`${CHROME}javascript_tool`, envio, { aprovacoes: comAprovacao }), { decisao: 'permitir', consumir: 'vaga-01', motivo: 'envio aprovado pela pessoa' });
  const outraVaga = { aprovacoes: [{ ...comAprovacao.aprovacoes[0], vaga_id: 'vaga-02' }] };
  assert.equal(decidir(`${CHROME}javascript_tool`, envio, { aprovacoes: outraVaga }).decisao, 'negar');
  const vencida = { aprovacoes: [{ ...comAprovacao.aprovacoes[0], expira_em: '2026-10-17T11:59:00.000Z' }] };
  assert.equal(decidir(`${CHROME}javascript_tool`, envio, { aprovacoes: vencida }).decisao, 'negar');
  const usada = { aprovacoes: [{ ...comAprovacao.aprovacoes[0], usada_em: AGORA }] };
  assert.equal(decidir(`${CHROME}javascript_tool`, envio, { aprovacoes: usada }).decisao, 'negar');
  // Script de envio de outra vaga na aba desta: negado.
  assert.equal(decidir(`${CHROME}javascript_tool`, { text: scriptDeEnvio('vaga-02'), tabId: 7 }, { aprovacoes: comAprovacao }).decisao, 'negar');
});

test('entrada inválida, estado ausente, ferramenta desconhecida e chamada sem aba explícita falham fechado', () => {
  assert.equal(decidirNavegador({ tool_name: `${CHROME}computer`, tool_input: { action: 'left_click' } }, { sessao: null, agora: AGORA }).decisao, 'negar');
  assert.equal(decidir(`${CHROME}computer`, { action: 'left_click', coordinate: [1, 1] }).decisao, 'negar');
  assert.equal(decidir(`${CHROME}ferramenta_nova`, { tabId: 7 }).decisao, 'negar');
  assert.equal(decidir(`${CHROME}browser_batch`, { actions: 'x' }).decisao, 'negar');
  assert.equal(decidir(`${CHROME}browser_batch`, { actions: [{ name: 'find', input: { tabId: 7 } }, { name: 'computer', input: { action: 'left_click', coordinate: [1, 1], tabId: 7 } }] }).decisao, 'negar');
  assert.equal(decidirNavegador({ tool_name: 'mcp__outro__qualquer', tool_input: {} }, { sessao, agora: AGORA }), null);
});

test('o hook cobre o Claude in Chrome, o navegador integrado e a variante remota', () => {
  for (const prefixo of [CHROME, INTEGRADO, 'mcp__remote-devices__Claude_Browser__']) {
    assert.equal(decidir(`${prefixo}computer`, { action: 'left_click', coordinate: [1, 1], tabId: 7 }).decisao, 'negar', prefixo);
  }
});

// ---- Scripts de hook como o Claude Code os chama ----
const hook = (script, entrada, dataRoot, agora = AGORA) => {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'hooks', script)], { input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada), encoding: 'utf8', env: { ...process.env, DATA_ROOT: dataRoot, CAREER_BOUNTY_NOW: agora } });
  const linha = r.stdout.trim();
  return linha ? JSON.parse(linha) : null;
};
const decisao = saida => saida?.hookSpecificOutput?.permissionDecision ?? null;

test('fluxo completo: só a frase digitada pela pessoa aprova, e o envio consome a aprovação (uso único)', async t => {
  const dataRoot = await tempDir(t);
  await marcarAba(dataRoot, { tabId: 7, vagaId: 'vaga-01', ts: AGORA });
  const lote = await proporLote(dataRoot, { vagas: [{ vaga_id: 'vaga-01', empresa: 'Empresa 01', cargo: 'Gerente de Produto' }], ts: AGORA });
  assert.equal(lote.frase, 'enviar estas 1: Empresa 01 (Gerente de Produto)');
  const envio = { tool_name: `${CHROME}javascript_tool`, tool_input: { action: 'javascript_exec', text: scriptDeEnvio('vaga-01'), tabId: 7 } };
  assert.equal(decisao(hook('pre-tool-use.mjs', envio, dataRoot)), 'deny');
  const errada = hook('user-prompt-submit.mjs', { prompt: 'enviar estas 1: Empresa 02 (Gerente de Produto)' }, dataRoot);
  assert.match(errada.hookSpecificOutput.additionalContext, /nada foi aprovado/);
  const certa = hook('user-prompt-submit.mjs', { prompt: 'Ok, enviar estas 1: Empresa 01 (Gerente de Produto)' }, dataRoot);
  assert.match(certa.hookSpecificOutput.additionalContext, /aprovado pela pessoa para 1 vaga/);
  assert.equal(decisao(hook('pre-tool-use.mjs', envio, dataRoot)), 'allow');
  assert.equal(decisao(hook('pre-tool-use.mjs', envio, dataRoot)), 'deny', 'uso único');
  assert.ok((await lerAprovacoes(dataRoot)).aprovacoes[0].usada_em);
  // O lote vence em 1 hora: frase digitada depois disso não aprova.
  await proporLote(dataRoot, { vagas: [{ vaga_id: 'vaga-01', empresa: 'Empresa 01', cargo: 'Gerente de Produto' }], ts: AGORA });
  hook('user-prompt-submit.mjs', { prompt: 'enviar estas 1: Empresa 01 (Gerente de Produto)' }, dataRoot, '2026-10-17T13:30:00.000Z');
  assert.equal(decisao(hook('pre-tool-use.mjs', envio, dataRoot, '2026-10-17T13:31:00.000Z')), 'deny');
});

test('script de hook com entrada ilegível ou estado corrompido nega as ferramentas de navegador', async t => {
  const dataRoot = await tempDir(t);
  await marcarAba(dataRoot, { tabId: 7, vagaId: 'vaga-01', ts: AGORA });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(dataRoot, 'state', 'aprovacoes.json'), '{ corrompido');
  assert.equal(decisao(hook('pre-tool-use.mjs', { tool_name: `${CHROME}computer`, tool_input: { action: 'type', text: 'a', tabId: 7 } }, dataRoot)), 'deny');
  assert.equal(hook('pre-tool-use.mjs', 'não é json', dataRoot), null, 'fora do leitor de e-mail, entrada ilegível não decide');
  assert.equal(decisao(hook('pre-tool-use.mjs', { tool_name: 'mcp__ai-memory__memory_write_page', tool_input: {} }, dataRoot)), null);
  assert.ok((await lerSessao(dataRoot)).abas.length);
  await registrarScript(dataRoot, { vagaId: 'vaga-01', script: 'x', ts: AGORA });
});

test('na página: o script de clique recusa o botão de envio e o script de envio clica nele', { skip: (await import('../helpers/navegador.mjs')).semNavegador }, async t => {
  const { pagina, portal } = await import('../helpers/navegador.mjs');
  const p = await pagina(t, portal('greenhouse'));
  assert.deepEqual(await p.avaliar(scriptDeClique('Submit Application')), { erro: 'botão de envio: use o script de envio com aprovação' });
  assert.match((await p.avaliar(scriptDeClique('Attach'))).erro, /não reconhecida/);
  await p.avaliar('document.forms[0].insertAdjacentHTML("beforeend", "<button type=button>Próximo</button>")');
  assert.deepEqual(await p.avaliar(scriptDeClique('Próximo')), { clicado: 'Próximo' });
  assert.equal(await p.avaliar('document.body.dataset.enviado ?? null'), null);
  await p.avaliar(`document.querySelectorAll('[required]').forEach(e => e.removeAttribute('required')); document.forms[0].onsubmit = e => { e.preventDefault(); document.body.dataset.enviado = '1'; }`);
  assert.deepEqual(await p.avaliar(scriptDeEnvio('vaga-01')), { enviado: 'Submit Application' });
  assert.equal(await p.avaliar('document.body.dataset.enviado'), '1');
});

test('na aba de candidatura, upload só do PDF ATS versionado da própria vaga', () => {
  const H = 'b'.repeat(64);
  const ok = ['D:', 'dados', 'artifacts', 'cv', 'vaga-01', H, 'cv-ats.pdf'].join(String.fromCharCode(92));
  assert.equal(decidir(`${CHROME}file_upload`, { ref: 'ref_3', tabId: 7, paths: [ok] }), null);
  assert.equal(decidir(`${CHROME}file_upload`, { ref: 'ref_3', tabId: 7, paths: [`/srv/dados/artifacts/cv/vaga-01/${H}/cv-ats.pdf`] }), null);
  for (const paths of [[ok.replace('vaga-01', 'vaga-02')], [ok.replace('cv-ats', 'cv-visual')], ['D:/dados/outro.pdf'], [], [ok, 'D:/dados/.ssh/id_rsa']]) {
    assert.equal(decidir(`${CHROME}file_upload`, { ref: 'ref_3', tabId: 7, paths })?.decisao, 'negar', JSON.stringify(paths));
  }
  assert.equal(decidir(`${CHROME}file_upload`, { ref: 'ref_3', tabId: 7, paths: [ok], files: [{ name: 'x', data: 'eA==' }] })?.decisao, 'negar');
});

test('script de navegação nunca aciona submit com rótulo não reconhecido', { skip: (await import('../helpers/navegador.mjs')).semNavegador }, async t => {
  const { pagina } = await import('../helpers/navegador.mjs');
  const p = await pagina(t, 'data:text/html,<form><button type="submit">Confirmar candidatura</button></form>');
  await p.avaliar('window.envios=0;document.forms[0].onsubmit=e=>{e.preventDefault();window.envios++}');
  const script = scriptDeClique('Confirmar candidatura');
  assert.equal(decidir(`${CHROME}javascript_tool`, { text: script, tabId: 7 }), null);
  const resultado = await p.avaliar(script);
  assert.ok(resultado.erro);
  assert.equal(await p.avaliar('window.envios'), 0);
});

test('navegação falha fechada para controles implícitos, ocultos, desabilitados e ambíguos', { skip: (await import('../helpers/navegador.mjs')).semNavegador }, async t => {
  const { pagina } = await import('../helpers/navegador.mjs');
  const p = await pagina(t, 'data:text/html,<form></form>');
  for (const html of ['<button>Próximo</button>', '<button type="submit">Próximo</button>', '<input type="image" value="Próximo">',
    '<button type="reset">Próximo</button>', '<a href="#">Próximo</a>', '<div role="button">Próximo</div>',
    '<button type="button" disabled>Próximo</button>', '<button type="button" aria-disabled="true">Próximo</button>',
    '<button type="button" hidden>Próximo</button>', '<button type="button" style="visibility:hidden">Próximo</button>',
    '<button type="button">Próximo</button><button type="button">Próximo</button>']) {
    await p.avaliar(`document.forms[0].innerHTML=${JSON.stringify(html)};window.cliques=0;document.forms[0].onclick=()=>window.cliques++;document.forms[0].onsubmit=e=>e.preventDefault()`);
    assert.ok((await p.avaliar(scriptDeClique('Próximo'))).erro, html);
    assert.equal(await p.avaliar('window.cliques'), 0, html);
  }
  await p.avaliar('document.forms[0].innerHTML="<button type=button>Continuar</button>"');
  assert.deepEqual(await p.avaliar(scriptDeClique('Continuar')), { clicado: 'Continuar' });
  assert.equal(await p.avaliar('window.cliques'), 1);
});
