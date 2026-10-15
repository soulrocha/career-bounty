import assert from 'node:assert/strict';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { localDay } from '../../core/store/schema.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');

async function ambiente(t, { kb = true } = {}) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  if (kb) await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  return dataRoot;
}

test('quadrantes grava o relatório em DATA_ROOT/reports e devolve só números e o caminho', async t => {
  const dataRoot = await ambiente(t);
  const cwd = await tempDir(t);
  const r = run(['quadrantes', '--json'], { dataRoot, cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([r.json.contagem.a, r.json.contagem.b, r.json.contagem.c], [1, 3, 4]);
  const esperado = path.join(dataRoot, 'reports', `quadrantes-${localDay(new Date())}.md`);
  assert.equal(path.resolve(r.json.relatorio), esperado);
  assert.ok(!('c' in r.json) && !('b' in r.json), 'a saída traz contagens, não os itens');
  const md = await readFile(esperado, 'utf8');
  for (const titulo of ['## (a) Dado e CV conferem (1)', '## (b) Dado fora do CV (3)', '## (c) CV sem dado (4)', '## (d) Lacunas (4)']) assert.ok(md.includes(titulo), titulo);
  assert.match(md, /AF-104 \(verificado\)/);
  assert.match(md, /número 41 diverge de AF-102/);
  assert.match(md, /\[7\] Sem afirmações entre 2021-07 e 2022-01/);
  assert.deepEqual(await readdir(cwd), [], 'nada é escrito fora do DATA_ROOT');
});

test('o relatório sugere afirmações candidatas por número para bullets sem marca', async t => {
  const dataRoot = await ambiente(t);
  await writeFile(path.join(dataRoot, 'kb', 'cv', 'outro.md'), '- Cortou o retrabalho em 60%, de 20 para 8 horas por semana.\n- Atuou em projetos variados.\n');
  const r = run(['quadrantes', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  const md = await readFile(r.json.relatorio, 'utf8');
  assert.match(md, /Cortou o retrabalho em 60%.*\n\s+candidatas por número: AF-104/);
  assert.match(md, /Atuou em projetos variados\..*\n\s+candidatas por número: nenhuma/);
});

test('base vazia gera relatório com zeros, sem erro', async t => {
  const dataRoot = await ambiente(t, { kb: false });
  const r = run(['quadrantes', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.json.contagem, { a: 0, b: 0, c: 0, d: 0 });
  assert.match(await readFile(r.json.relatorio, 'utf8'), /## \(a\) Dado e CV conferem \(0\)/);
});

test('texto do comando resume as quatro contagens e o caminho', async t => {
  const dataRoot = await ambiente(t);
  const r = run(['quadrantes'], { dataRoot });
  assert.match(r.stdout, /\(a\) 1.*\(b\) 3.*\(c\) 4.*\(d\) 4/s);
  assert.match(r.stdout, /relatório em .*quadrantes-\d{4}-\d{2}-\d{2}\.md/);
  assert.equal(run(['quadrantes', '--nada'], { dataRoot }).status, 2);
});

test('erro na base falha com a mensagem e sem gravar relatório', async t => {
  const dataRoot = await ambiente(t);
  await writeFile(path.join(dataRoot, 'kb', 'cv', 'ruim.md'), '- Item. <!-- claim:AF-XXX -->');
  const r = run(['quadrantes', '--json'], { dataRoot });
  assert.equal(r.status, 2);
  assert.match(r.json.error, /AF-XXX/);
  await assert.rejects(readdir(path.join(dataRoot, 'reports')), { code: 'ENOENT' });
});

test('o comando /quadrantes só chama a CLI e fala em números', async () => {
  const md = await readFile(path.join(repoRoot, 'commands', 'quadrantes.md'), 'utf8');
  assert.match(md, /^allowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/career-bounty\.mjs":\*\)$/m);
  assert.match(md, /career-bounty\.mjs" quadrantes/);
});
