import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ensureSkeleton, resolveDataRoot } from '../../core/store/dataRoot.mjs';
import { loadSettings } from '../../core/config.mjs';
import { run, tempDir } from '../helpers/cli.mjs';

const SKELETON = ['artifacts', 'cache', 'events', 'kb', 'outbox', 'projections', 'secrets', 'state', 'templates'];

test('doctor devolve o DATA_ROOT definido pela variável', async t => {
  const root = await tempDir(t);
  const result = run(['doctor', '--json'], { dataRoot: root });
  assert.equal(result.status, 0);
  assert.equal(result.json.dataRoot, path.resolve(root));
  assert.equal(result.json.ok, true);
});

test('sem variável usa .career-bounty no diretório inicial injetado', () => {
  const home = path.resolve(path.sep, 'casa-ficticia');
  assert.equal(resolveDataRoot({ env: {}, home }), path.join(home, '.career-bounty'));
  assert.equal(resolveDataRoot({ env: { DATA_ROOT: '' }, home }), path.join(home, '.career-bounty'));
});

test('DATA_ROOT dentro de um repositório git é recusado', async t => {
  const root = await tempDir(t);
  await mkdir(path.join(root, '.git'));
  const result = run(['doctor', '--json'], { dataRoot: path.join(root, 'dados') });
  assert.equal(result.status, 2);
  assert.match(result.json.error, /fora de repositórios/);
});

test('DATA_ROOT dentro do vault_root configurado é recusado', async t => {
  const vault = await tempDir(t);
  const dataRoot = path.join(vault, 'dados');
  await mkdir(dataRoot);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ vault_root: vault }));
  const result = run(['doctor', '--json'], { dataRoot });
  assert.equal(result.status, 2);
  assert.match(result.json.error, /vault_root/);
});

test('setup cria o esqueleto quando config.yml não existe e doctor não escreve nada', async t => {
  const root = await tempDir(t);
  const dataRoot = path.join(root, 'dados');
  assert.equal(run(['doctor', '--json'], { dataRoot }).status, 0);
  await assert.rejects(readdir(dataRoot), { code: 'ENOENT' });
  const setup = run(['setup', '--json'], { dataRoot });
  assert.equal(setup.status, 0);
  assert.deepEqual((await readdir(dataRoot)).sort(), [...SKELETON, 'config.yml', 'identity.yml'].sort());
  assert.deepEqual(JSON.parse(await readFile(path.join(dataRoot, 'config.yml'), 'utf8')), {});
});

test('config inválida aponta a chave', async t => {
  const root = await tempDir(t);
  const cases = [
    [{ envio: { padrao: 'enviar_tudo' } }, /envio\.padrao/],
    [{ vault_root: 'relativo/vault' }, /vault_root/],
    [{ ai_memory: { url: 42 } }, /ai_memory\.url/],
    [{ panel: { port: 'abc' } }, /panel\.port/],
    [{ envio: 'x' }, /envio/],
  ];
  for (const [config, pattern] of cases) {
    await writeFile(path.join(root, 'config.yml'), JSON.stringify(config));
    await assert.rejects(loadSettings({ dataRoot: root }), pattern);
  }
});

test('config vazia carrega os padrões seguros', async t => {
  const root = await tempDir(t);
  await writeFile(path.join(root, 'config.yml'), '{}');
  const settings = await loadSettings({ dataRoot: root });
  assert.equal(settings.envio.padrao, 'parar_antes_de_enviar');
  assert.deepEqual(settings.envio.regras, []);
  assert.equal(settings.fontes.linkedin_guest.ativo, false);
  const missing = await loadSettings({ dataRoot: path.join(root, 'nao-existe') });
  assert.equal(missing.fontes.linkedin_guest.ativo, false);
});

test('chaves pessoais só vêm de DATA_ROOT/config.yml', async t => {
  const root = await tempDir(t);
  const dataRoot = path.join(root, 'dados');
  await mkdir(dataRoot);
  await writeFile(path.join(root, 'config.example.yml'), JSON.stringify({ vault_root: path.join(root, 'vault'), envio: { padrao: 'confirmar_lote' } }));
  const env = { VAULT_ROOT: path.join(root, 'vault'), AI_MEMORY_URL: 'http://exemplo.test', ENVIO_PADRAO: 'confirmar_lote' };
  const settings = await loadSettings({ dataRoot, env, cwd: root });
  assert.equal(settings.vault_root, null);
  assert.equal(settings.ai_memory.url, null);
  assert.equal(settings.envio.padrao, 'parar_antes_de_enviar');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ vault_root: path.join(root, 'outro-vault') }));
  assert.equal((await loadSettings({ dataRoot, env })).vault_root, path.join(root, 'outro-vault'));
});

test('setup cria identity.yml como modelo vazio com instrução, sem dados, e nunca sobrescreve', async t => {
  const dataRoot = path.join(await tempDir(t), 'dados');
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  const file = path.join(dataRoot, 'identity.yml');
  const model = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(typeof model._instrucao, 'string');
  const valores = Object.entries(model).filter(([k]) => !k.startsWith('_')).map(([, v]) => v);
  assert.ok(valores.length > 0);
  assert.ok(valores.every(v => v === ''));
  await writeFile(file, JSON.stringify({ nome: 'Mantido Ficticio' }));
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).nome, 'Mantido Ficticio');
});

test('secrets/ é criada e reforçada com modo 0o700', async t => {
  const dataRoot = path.join(await tempDir(t), 'dados');
  const calls = [];
  await ensureSkeleton(dataRoot, { chmod: async (target, mode) => { calls.push([path.relative(dataRoot, target), mode]); } });
  assert.deepEqual(calls, [['secrets', 0o700]]);
  if (process.platform !== 'win32') {
    const { stat } = await import('node:fs/promises');
    assert.equal((await stat(path.join(dataRoot, 'secrets'))).mode & 0o777, 0o700);
  }
});
