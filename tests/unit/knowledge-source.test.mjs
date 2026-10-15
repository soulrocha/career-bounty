import assert from 'node:assert/strict';
import { cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';

const persona = path.join(repoRoot, 'examples', 'persona-ficticia');

async function copyPersona(t) {
  const dir = path.join(await tempDir(t), 'kb');
  await cp(persona, dir, { recursive: true });
  return dir;
}

test('claims() devolve as afirmações da persona com id, texto e nível de prova', async () => {
  const claims = await createMarkdownFolder(persona).claims();
  assert.deepEqual(claims.map(c => c.id), ['AF-001', 'AF-002', 'AF-003']);
  assert.equal(claims[0].nivel_prova, 'documentado');
  assert.match(claims[0].texto, /tempo de triagem de chamados de 5 dias para 2 dias/);
  assert.equal(claims[0].arquivo, 'claims/AF-001.md');
});

test('frontmatter sem nivel_prova ou com nível desconhecido é erro que nomeia o arquivo', async t => {
  const dir = await copyPersona(t);
  await writeFile(path.join(dir, 'claims', 'AF-009.md'), '---\nid: AF-009\n---\nTexto sem prova.\n');
  await assert.rejects(createMarkdownFolder(dir).claims(), /claims\/AF-009\.md.*nivel_prova/);
  await writeFile(path.join(dir, 'claims', 'AF-009.md'), '---\nid: AF-009\nnivel_prova: absoluto\n---\nTexto.\n');
  await assert.rejects(createMarkdownFolder(dir).claims(), /claims\/AF-009\.md.*nivel_prova/);
});

test('id de afirmação duplicado é erro', async t => {
  const dir = await copyPersona(t);
  await writeFile(path.join(dir, 'claims', 'AF-010.md'), '---\nid: AF-001\nnivel_prova: declarado\n---\nOutra afirmação.\n');
  await assert.rejects(createMarkdownFolder(dir).claims(), /AF-001.*duplicad/);
});

test('evidence() liga cada evidência a afirmações existentes', async () => {
  const evidence = await createMarkdownFolder(persona).evidence();
  assert.deepEqual(evidence.map(e => [e.id, e.afirmacoes]), [['EV-001', ['AF-001']], ['EV-002', ['AF-002', 'AF-003']]]);
  assert.equal(evidence[0].fonte, 'https://exemplo.test/relatorios/triagem');
});

test('evidência que referencia afirmação inexistente é erro que nomeia o arquivo', async t => {
  const dir = await copyPersona(t);
  await writeFile(path.join(dir, 'evidence', 'EV-009.md'), '---\nid: EV-009\nafirmacoes: [AF-404]\n---\nSolta.\n');
  await assert.rejects(createMarkdownFolder(dir).evidence(), /evidence\/EV-009\.md.*AF-404/);
});

test('identity() devolve só o caminho, nunca o conteúdo', async () => {
  const identity = await createMarkdownFolder(persona).identity();
  assert.equal(typeof identity, 'string');
  assert.equal(path.basename(identity), 'identity.yml');
  assert.ok(!identity.includes('Ana Exemplo'));
});

test('pasta vazia ou sem subpastas devolve listas vazias sem exceção', async t => {
  const dir = await tempDir(t);
  const source = createMarkdownFolder(dir);
  assert.deepEqual(await source.claims(), []);
  assert.deepEqual(await source.evidence(), []);
  assert.equal(await source.identity(), null);
  const missing = createMarkdownFolder(path.join(dir, 'nao-existe'));
  assert.deepEqual(await missing.claims(), []);
});

test('a persona fictícia carrega inteira pelo adaptador', async () => {
  const source = createMarkdownFolder(persona);
  assert.equal((await source.claims()).length, 3);
  assert.equal((await source.evidence()).length, 2);
});
