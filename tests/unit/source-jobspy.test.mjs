import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { runSources } from '../../core/sources/index.mjs';
import { createJobSpy } from '../../core/sources/jobspy.mjs';

const fake = fileURLToPath(new URL('../helpers/fake-jobspy.mjs', import.meta.url));
const ctx = dataRoot => ({ janela: { inicio: '2026-10-08', fim: '2026-10-15' }, dataRoot, plano: { termos: ['engenharia'] }, config: {}, now: new Date('2026-10-15T21:00:00Z') });
const cfg = (extra = {}) => ({ comando: process.execPath, args: [fake], ...extra });

test('sem o executável configurado ou instalado a fonte fica indisponível e a coleta segue', async t => {
  const dataRoot = await tempDir(t);
  const semConfig = await runSources([createJobSpy({})], ctx(dataRoot));
  assert.equal(semConfig.fontes[0].estado, 'indisponivel');
  const ausente = await runSources([createJobSpy({ comando: path.join(dataRoot, 'nao-existe'), args: [] })], ctx(dataRoot));
  assert.equal(ausente.fontes[0].estado, 'indisponivel');
});

test('os resultados do executável falso mapeiam para Vaga', async t => {
  const dataRoot = await tempDir(t);
  const { vagas, fontes } = await runSources([createJobSpy(cfg())], ctx(dataRoot));
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(vagas.length, 2);
  assert.equal(fontes[0].invalidas, 1);
  const [a, b] = vagas;
  assert.equal(a.portal, 'indeed');
  assert.equal(a.cargo, 'Gerente de engenharia');
  assert.equal(a.salario_min, 12000);
  assert.equal(a.publicado_em, '2026-10-13');
  assert.equal(b.modalidade, 'remoto');
  assert.equal(b.publicado_em, null);
});

test('o processo roda sem as credenciais do ambiente e com tempo limite', async t => {
  const dataRoot = await tempDir(t);
  const envOut = path.join(dataRoot, 'env.json');
  process.env.GITHUB_TOKEN = 'segredo-de-teste-nao-vaza';
  t.after(() => { delete process.env.GITHUB_TOKEN; });
  await runSources([createJobSpy(cfg({ args: [fake, '--env-out', envOut] }))], ctx(dataRoot));
  assert.equal(JSON.parse(await readFile(envOut, 'utf8')).GITHUB_TOKEN, undefined);
  const lento = await runSources([createJobSpy(cfg({ args: [fake, '--demora'], timeout_ms: 300 }))], ctx(dataRoot));
  assert.equal(lento.fontes[0].codigo, 'timeout');
});

test('saída inválida ou código de saída diferente de zero viram erro da fonte', async t => {
  const dataRoot = await tempDir(t);
  const lixo = await runSources([createJobSpy(cfg({ args: [fake, '--lixo'] }))], ctx(dataRoot));
  assert.equal(lixo.fontes[0].codigo, 'estrutura_mudou');
  const falha = await runSources([createJobSpy(cfg({ args: [fake, '--falhar'] }))], ctx(dataRoot));
  assert.equal(falha.fontes[0].estado, 'erro');
  assert.match(falha.fontes[0].erro, /falha simulada/);
});
