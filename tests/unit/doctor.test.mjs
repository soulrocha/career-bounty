import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { runDoctor } from '../../core/doctor/index.mjs';

const healthyDeps = { nodeVersion: '22.1.0', platform: 'linux', hooksPath: () => '.githooks', stat: async () => ({ mode: 0o40700 }) };

async function ready(t, config = {}) {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify(config));
  await mkdir(path.join(dataRoot, 'secrets'));
  await writeFile(path.join(dataRoot, 'identity.yml'), JSON.stringify({ nome: 'Pessoa Ficticia Teste' }));
  await mkdir(path.join(dataRoot, 'engines', 'career-ops'), { recursive: true });
  await writeFile(path.join(dataRoot, 'engines', 'career-ops', 'package.json'), JSON.stringify({ name: 'career-ops-falso', version: '1.36.0' }));
  await mkdir(path.join(dataRoot, 'state'), { recursive: true });
  await writeFile(path.join(dataRoot, 'state', 'migration.json'), JSON.stringify({ mode: 'ativo' }));
  await mkdir(path.join(dataRoot, 'cv'), { recursive: true });
  await writeFile(path.join(dataRoot, 'cv', 'perfil.json'), JSON.stringify({ resumo: 'Resumo profissional teste' }));
  return dataRoot;
}
const check = (report, id) => report.checks.find(c => c.id === id);

test('ambiente saudável: todas as checagens ok e relatório com id, status e mensagem', async t => {
  const dataRoot = await ready(t);
  const report = await runDoctor({ dataRoot, ...healthyDeps });
  assert.equal(report.ok, true);
  for (const c of report.checks) {
    assert.ok(['ok', 'aviso', 'falha'].includes(c.status), c.id);
    assert.equal(typeof c.mensagem, 'string');
  }
  assert.deepEqual(report.checks.filter(c => c.status !== 'ok').map(c => c.id), []);
});

test('Node abaixo de 20 falha com instrução', async t => {
  const report = await runDoctor({ dataRoot: await ready(t), ...healthyDeps, nodeVersion: '18.19.0' });
  assert.equal(check(report, 'node').status, 'falha');
  assert.match(check(report, 'node').mensagem, /Node 20/);
  assert.equal(report.ok, false);
});

test('DATA_ROOT ausente vira aviso apontando o setup', async t => {
  const dataRoot = path.join(await tempDir(t), 'nao-existe');
  const report = await runDoctor({ dataRoot, ...healthyDeps });
  assert.equal(check(report, 'data_root').status, 'aviso');
  assert.match(check(report, 'data_root').mensagem, /setup/);
});

test('career-ops: ausente traz instruções de clone; tag diferente de v1.36.0 é aviso', async t => {
  const dataRoot = await ready(t);
  await writeFile(path.join(dataRoot, 'engines', 'career-ops', 'package.json'), JSON.stringify({ version: '1.30.2' }));
  const diferente = await runDoctor({ dataRoot, ...healthyDeps });
  assert.equal(check(diferente, 'career_ops').status, 'aviso');
  assert.match(check(diferente, 'career_ops').mensagem, /v1\.36\.0/);
  const vazio = await tempDir(t);
  const ausente = await runDoctor({ dataRoot: vazio, ...healthyDeps });
  assert.equal(check(ausente, 'career_ops').status, 'ok', 'opcional: ausente não é aviso');
  assert.match(check(ausente, 'career_ops').mensagem, /git clone/);
});

test('secrets/ com permissão aberta avisa no Linux; no Windows só confere existência', async t => {
  const dataRoot = await ready(t);
  const aberto = await runDoctor({ dataRoot, ...healthyDeps, stat: async () => ({ mode: 0o40755 }) });
  assert.equal(check(aberto, 'secrets').status, 'aviso');
  assert.match(check(aberto, 'secrets').mensagem, /chmod 700/);
  const windows = await runDoctor({ dataRoot, ...healthyDeps, platform: 'win32', stat: async () => ({ mode: 0o40777 }) });
  assert.equal(check(windows, 'secrets').status, 'ok');
  const semPasta = await runDoctor({ dataRoot: await tempDir(t), ...healthyDeps, platform: 'win32', stat: async () => { throw new Error('ausente'); } });
  assert.equal(check(semPasta, 'secrets').status, 'aviso');
});

test('core.hooksPath que não aponta para .githooks falha', async t => {
  const dataRoot = await ready(t);
  const report = await runDoctor({ dataRoot, ...healthyDeps, hooksPath: () => '' });
  assert.equal(check(report, 'hooks').status, 'falha');
  assert.match(check(report, 'hooks').mensagem, /npm run prepare/);
  assert.equal(report.ok, false);
});

test('regra de envio ativa ou LinkedIn guest ligado aparece como aviso em destaque', async t => {
  const regra = await ready(t, { envio: { regras: [{ id: 'r', acao: 'enviar_automatico', limite_dia: 2, quando: { portal: ['greenhouse'] } }] } });
  const r1 = await runDoctor({ dataRoot: regra, ...healthyDeps });
  assert.equal(check(r1, 'envio').status, 'aviso');
  assert.match(check(r1, 'envio').mensagem, /^ATENÇÃO/);
  const guest = await ready(t, { fontes: { linkedin_guest: { ativo: true, aceite_termos: true } } });
  const r2 = await runDoctor({ dataRoot: guest, ...healthyDeps });
  assert.equal(check(r2, 'linkedin_guest').status, 'aviso');
  assert.match(check(r2, 'linkedin_guest').mensagem, /^ATENÇÃO/);
  assert.equal(check(await runDoctor({ dataRoot: await ready(t), ...healthyDeps }), 'envio').status, 'ok');
});

test('conector Gmail é informativo e nunca falha', async t => {
  const report = await runDoctor({ dataRoot: await ready(t), ...healthyDeps });
  assert.notEqual(check(report, 'conector_gmail').status, 'falha');
  assert.match(check(report, 'conector_gmail').mensagem, /informativo/);
});

test('doctor --json lista as checagens e sai com 1 quando algo falha', async t => {
  const dataRoot = await ready(t);
  const result = run(['doctor', '--json'], { dataRoot });
  assert.ok(Array.isArray(result.json.checks));
  assert.equal(typeof result.json.dataRoot, 'string');
  assert.ok(['ok', 'aviso', 'falha'].includes(result.json.checks[0].status));
});

test('setup é idempotente e não sobrescreve a config existente', async t => {
  const dataRoot = path.join(await tempDir(t), 'dados');
  assert.ok(run(['setup', '--json'], { dataRoot }).json.created.length > 0);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ panel: { port: 9000 } }));
  const second = run(['setup', '--json'], { dataRoot });
  assert.equal(second.status, 0);
  assert.deepEqual(second.json.created, []);
  assert.deepEqual(JSON.parse(await (await import('node:fs/promises')).readFile(path.join(dataRoot, 'config.yml'), 'utf8')), { panel: { port: 9000 } });
});

test('clone git sem core.hooksPath (condição da CI Linux) faz o doctor falhar; fora de clone ele passa', async t => {
  const { git } = await import('../helpers/git.mjs');
  const dataRoot = await ready(t);
  const clone = await tempDir(t, 'cb-clone-');
  git(clone, ['init', '-q']);
  const falha = run(['doctor', '--json'], { dataRoot, env: { CAREER_BOUNTY_REPO_ROOT: clone } });
  assert.equal(falha.status, 1);
  assert.equal(falha.json.checks.find(c => c.id === 'hooks').status, 'falha');
  git(clone, ['config', 'core.hooksPath', '.githooks']);
  assert.equal(run(['doctor', '--json'], { dataRoot, env: { CAREER_BOUNTY_REPO_ROOT: clone } }).status, 0);
});

test('identity.yml ausente ou sem valores avisa e aponta o setup; preenchido fica ok', async t => {
  const dataRoot = await ready(t);
  assert.equal(check(await runDoctor({ dataRoot, ...healthyDeps }), 'identidade').status, 'ok');
  await rm(path.join(dataRoot, 'identity.yml'));
  const ausente = check(await runDoctor({ dataRoot, ...healthyDeps }), 'identidade');
  assert.equal(ausente.status, 'aviso');
  assert.match(ausente.mensagem, /identity\.yml/);
  assert.match(ausente.mensagem, /setup/);
  await writeFile(path.join(dataRoot, 'identity.yml'), JSON.stringify({ _instrucao: 'texto', nome: '', email: '' }));
  assert.equal(check(await runDoctor({ dataRoot, ...healthyDeps }), 'identidade').status, 'aviso');
});

test('migracao: ausente é instalação nova (ok); em sombra avisa o corte; em ativo fica ok', async t => {
  const dataRoot = await ready(t);
  assert.equal(check(await runDoctor({ dataRoot, ...healthyDeps }), 'migracao').status, 'ok');
  await writeFile(path.join(dataRoot, 'state', 'migration.json'), JSON.stringify({ mode: 'shadow' }));
  const sombra = check(await runDoctor({ dataRoot, ...healthyDeps }), 'migracao');
  assert.equal(sombra.status, 'aviso');
  assert.match(sombra.mensagem, /sombra/);
  await rm(path.join(dataRoot, 'state', 'migration.json'));
  const ausente = check(await runDoctor({ dataRoot, ...healthyDeps }), 'migracao');
  assert.equal(ausente.status, 'ok');
  assert.match(ausente.mensagem, /instalação nova/);
});

test('cv_perfil: ausente ou sem conteudo avisa; preenchido fica ok', async t => {
  const dataRoot = await ready(t);
  assert.equal(check(await runDoctor({ dataRoot, ...healthyDeps }), 'cv_perfil').status, 'ok');
  await writeFile(path.join(dataRoot, 'cv', 'perfil.json'), JSON.stringify({}));
  const semConteudo = check(await runDoctor({ dataRoot, ...healthyDeps }), 'cv_perfil');
  assert.equal(semConteudo.status, 'aviso');
  await rm(path.join(dataRoot, 'cv', 'perfil.json'));
  const ausente = check(await runDoctor({ dataRoot, ...healthyDeps }), 'cv_perfil');
  assert.equal(ausente.status, 'aviso');
  assert.match(ausente.mensagem, /docs\/CV\.md/);
});

test('doctor recusa flag desconhecida', async t => {
  const result = run(['doctor', '--nao-existe', '--json'], { dataRoot: await ready(t) });
  assert.equal(result.status, 2);
  assert.match(result.json.error, /--nao-existe/);
});
