import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { runSources } from '../../core/sources/index.mjs';
import { createCareerOps } from '../../core/sources/careerOps.mjs';

const fake = fileURLToPath(new URL('../helpers/fake-career-ops.mjs', import.meta.url));
const janela = { inicio: '2026-10-08', fim: '2026-10-15' };

const config = (extra = {}) => ({ comando: process.execPath, versao_args: [fake, '--version'], args: [fake, 'scan', '--dry-run', '--json'], ...extra });
const ctx = dataRoot => ({ janela, dataRoot, plano: { termos: [] }, config: {}, now: new Date('2026-10-15T21:00:00Z') });

test('mapeia a saída gravada do scan para Vaga', async t => {
  const dataRoot = await tempDir(t);
  const { vagas, fontes } = await runSources([createCareerOps(config())], ctx(dataRoot));
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(vagas.length, 3, 'a linha sem título é descartada como inválida');
  assert.equal(fontes[0].invalidas, 1);
  const gupy = vagas.find(v => v.cargo === 'Gerente de Engenharia');
  assert.equal(gupy.portal, 'gupy');
  assert.equal(gupy.requisicao_id, '1234567');
  assert.equal(gupy.empresa, 'Empresa Alfa');
  assert.equal(gupy.publicado_em, '2026-10-14');
  assert.equal(gupy.modalidade, 'remoto');
  const ats = vagas.find(v => v.cargo === 'Tech Lead');
  assert.equal(ats.modalidade, 'hibrido');
  assert.equal(ats.requisicao_id, null, 'sem identificador reconhecível na URL');
});

test('URL Gupy codificada e direta geram a mesma requisição; campo inesperado é ignorado', async t => {
  const dataRoot = await tempDir(t);
  const { vagas } = await runSources([createCareerOps(config())], ctx(dataRoot));
  const gupy = vagas.filter(v => v.portal === 'gupy');
  assert.equal(gupy.length, 2);
  assert.equal(new Set(gupy.map(v => v.requisicao_id)).size, 1);
  assert.ok(!('campo_novo' in gupy[0]));
});

test('o processo recebe ambiente limpo e CAREER_OPS_DATA_DIR dentro do DATA_ROOT', async t => {
  const dataRoot = await tempDir(t);
  const envOut = path.join(dataRoot, 'env.json');
  process.env.ANTHROPIC_API_KEY = 'segredo-de-teste-nao-vaza';
  t.after(() => { delete process.env.ANTHROPIC_API_KEY; });
  await runSources([createCareerOps(config({ args: [fake, 'scan', '--dry-run', '--json', '--env-out', envOut] }))], ctx(dataRoot));
  const env = JSON.parse(await readFile(envOut, 'utf8'));
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(path.dirname(env.CAREER_OPS_DATA_DIR), path.join(dataRoot, 'cache'));
});

test('tag diferente da fixada falha com mensagem clara', async t => {
  const dataRoot = await tempDir(t);
  const { fontes } = await runSources([createCareerOps(config({ versao_args: [fake, '--version', '--versao', 'v1.20.0'] }))], ctx(dataRoot));
  assert.equal(fontes[0].estado, 'erro');
  assert.equal(fontes[0].codigo, 'versao');
  assert.match(fontes[0].erro, /v1\.36\.0/);
});

test('processo que sai com erro vira erro da fonte, sem exceção', async t => {
  const dataRoot = await tempDir(t);
  const { fontes } = await runSources([createCareerOps(config({ args: [fake, 'scan', '--falhar'] }))], ctx(dataRoot));
  assert.equal(fontes[0].estado, 'erro');
  assert.match(fontes[0].erro, /erro simulado/);
});

test('saída que não é JSON e executável ausente são erros distintos', async t => {
  const dataRoot = await tempDir(t);
  const lixo = await runSources([createCareerOps(config({ args: [fake, 'scan', '--lixo'] }))], ctx(dataRoot));
  assert.equal(lixo.fontes[0].codigo, 'estrutura_mudou');
  const ausente = await runSources([createCareerOps({ comando: path.join(dataRoot, 'nao-existe'), args: [] })], ctx(dataRoot));
  assert.equal(ausente.fontes[0].estado, 'indisponivel');
});
