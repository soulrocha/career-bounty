// F7.5 (driver base) e F7.6 a F7.8 (Greenhouse, Lever, Ashby) contra formulários sintéticos num servidor local.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { HOJE, bancoPersona, resposta } from '../helpers/apply.mjs';
import { semNavegador } from '../helpers/navegador.mjs';
import { servidorPortais } from '../helpers/servidor-portais.mjs';
import { executarDriver } from '../../core/apply/drivers/base.mjs';
import { PORTAIS, enviarAshby, enviarGreenhouse, enviarLever } from '../../core/apply/drivers/portais.mjs';

const banco = () => [...bancoPersona(), resposta({ id: 'nome-completo', variantes_label: ['Full name', 'Name'], resposta: 'Ana Exemplo', sensivel: false, validade: null })];
async function pdf(t) {
  const dir = await tempDir(t);
  const caminho = path.join(dir, 'cv-ats.pdf');
  await writeFile(caminho, '%PDF-1.4 cv ficticio');
  return { caminho, sha256: createHash('sha256').update(await readFile(caminho)).digest('hex') };
}
const base = async (t, extra = {}) => ({ respostas: banco(), hoje: HOJE, cv: await pdf(t), timeoutMs: 60_000, ...extra });

test('dry-run preenche e para antes do clique: nada chega ao portal', { skip: semNavegador }, async t => {
  const s = await servidorPortais(t);
  const r = await enviarGreenhouse({ ...(await base(t)), url: s.url('/greenhouse'), dryRun: true });
  assert.equal(r.estado, 'dry_run');
  assert.ok(r.preenchidos.length >= 5);
  assert.deepEqual(s.recebidos, []);
});

test('Greenhouse: formulário conhecido é preenchido e enviado, com o PDF certo e comprovante', { skip: semNavegador }, async t => {
  const s = await servidorPortais(t);
  let antes = 0;
  const args = await base(t);
  const r = await enviarGreenhouse({ ...args, url: s.url('/greenhouse'), dryRun: false, antesDoClique: async () => { antes += 1; } });
  assert.equal(r.estado, 'enviada', JSON.stringify(r));
  assert.match(r.comprovante.texto, /Thank you for applying/);
  assert.equal(r.comprovante.pdf_sha256, args.cv.sha256);
  assert.equal(antes, 1, 'a tentativa é gravada antes do clique');
  assert.deepEqual(s.recebidos, [{ portal: 'greenhouse', pdf: true, sensivel: false }]);
});

test('Lever e Ashby: mesmo contrato, com os DOMs próprios', { skip: semNavegador }, async t => {
  const s = await servidorPortais(t);
  assert.equal((await enviarLever({ ...(await base(t)), url: s.url('/lever'), dryRun: false })).estado, 'enviada');
  assert.equal((await enviarAshby({ ...(await base(t)), url: s.url('/ashby'), dryRun: false })).estado, 'enviada');
  assert.deepEqual(s.recebidos.map(r => [r.portal, r.pdf]), [['lever', true], ['ashby', true]]);
});

test('pergunta extra (EEO/legal) ou campo novo obrigatório: blocked com os campos, nada enviado', { skip: semNavegador }, async t => {
  const s = await servidorPortais(t);
  const eeo = await enviarGreenhouse({ ...(await base(t)), url: s.url('/greenhouse-eeo'), dryRun: false });
  assert.equal(eeo.estado, 'blocked');
  assert.equal(eeo.motivo, 'campo_desconhecido');
  assert.match(eeo.campos[0].label, /protected veteran/);
  const novo = await enviarGreenhouse({ ...(await base(t)), url: s.url('/greenhouse-novo'), dryRun: false });
  assert.equal(novo.motivo, 'campo_desconhecido');
  assert.deepEqual(s.recebidos, []);
});

test('captcha, página de login e DOM sem o botão esperado: blocked, nada enviado', { skip: semNavegador }, async t => {
  const s = await servidorPortais(t);
  assert.deepEqual([(await enviarGreenhouse({ ...(await base(t)), url: s.url('/captcha'), dryRun: false })).motivo], ['captcha']);
  assert.match((await enviarGreenhouse({ ...(await base(t)), url: s.url('/login'), dryRun: false })).motivo, /login/);
  const semBotao = await enviarGreenhouse({ ...(await base(t)), url: s.url('/greenhouse-sem-botao'), dryRun: false });
  assert.deepEqual([semBotao.estado, semBotao.motivo], ['blocked', 'dom_mudou']);
  assert.deepEqual(s.recebidos, []);
});

test('página de erro do portal é distinguida da de sucesso', { skip: semNavegador }, async t => {
  const s = await servidorPortais(t);
  const r = await enviarGreenhouse({ ...(await base(t)), url: s.url('/greenhouse-erro'), dryRun: false });
  assert.equal(r.estado, 'falhou');
  assert.match(r.detalhe, /There was an error/);
});

test('só o PDF aprovado: arquivo trocado no disco (hash diferente) bloqueia antes de abrir o navegador', async t => {
  const args = await base(t);
  await writeFile(args.cv.caminho, '%PDF-1.4 outro conteúdo');
  let abriu = false;
  const r = await executarDriver({ ...args, portal: PORTAIS.greenhouse, url: 'http://127.0.0.1:1/x', dryRun: false, abrir: async () => { abriu = true; throw new Error('não deveria abrir'); } });
  assert.deepEqual([r.estado, r.motivo], ['blocked', 'pdf_diferente']);
  assert.equal(abriu, false);
});

test('timeout total por candidatura: antes do clique é blocked; o navegador é sempre fechado', async t => {
  let fechou = false;
  const lento = async () => ({ novaPagina: async () => ({ ir: () => new Promise(() => {}) }), fechar: async () => { fechou = true; } });
  const r = await executarDriver({ ...(await base(t)), portal: PORTAIS.greenhouse, url: 'http://127.0.0.1:1/x', dryRun: false, timeoutMs: 300, abrir: lento });
  assert.deepEqual([r.estado, r.motivo], ['blocked', 'timeout']);
  assert.equal(fechou, true);
});

test('contexto efêmero: o driver não lê secrets/, cookies nem perfil persistente', async () => {
  const codigo = (await readFile(path.join(repoRoot, 'core/apply/drivers/base.mjs'), 'utf8')) + (await readFile(path.join(repoRoot, 'core/browser/cdp.mjs'), 'utf8'));
  assert.doesNotMatch(codigo, /['"`]secrets['"`/\\]|Network\.setCookie|Storage\.setCookies|--profile-directory/);
  assert.match(codigo, /mkdtemp\(path\.join\(tmpdir\(\), 'cb-cdp-'\)\)/);
});
