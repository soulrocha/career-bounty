import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');

async function arvore(dir) {
  const itens = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) { const f = path.join(e.parentPath ?? e.path, e.name); itens.push(`${path.relative(dir, f)}:${createHash('sha256').update(await readFile(f)).digest('hex')}`); }
  }
  return itens.sort().join('\n');
}

async function ambiente(t, { comVault = true } = {}) {
  const dataRoot = await tempDir(t);
  const vault = await tempDir(t, 'vault-falso-');
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  await mkdir(path.join(vault, '50-Resultados'), { recursive: true });
  await writeFile(path.join(vault, '50-Resultados', 'arco-ligado.md'), '---\ntipo: resultado\ncontexto: pessoal\nafirmacoes: [AF-101]\n---\n# Arco ligado\n');
  await writeFile(path.join(vault, '50-Resultados', 'arco-solto.md'), '---\ntipo: resultado\ncontexto: pessoal\n---\n# Arco solto\n');
  await writeFile(path.join(vault, 'cv-vault.txt'), 'EXPERIENCIA\n• Cortou o retrabalho em 60%, de 20 para 8 horas por semana.\n• Fez algo ligado. <!-- claim:AF-101 -->\n');
  if (comVault) {
    await writeFile(path.join(dataRoot, 'fontes.yml'), JSON.stringify({ versao: 1, obsidian_vault: { raiz: vault, contextos_permitidos: ['pessoal'], notas: [
      { caminho: '50-Resultados/arco-ligado.md', papel: 'arco' }, { caminho: '50-Resultados/arco-solto.md', papel: 'arco' }, { caminho: 'cv-vault.txt', papel: 'modelo_cv', modelo: 'cv-vault' }] } }));
  }
  return { dataRoot, vault };
}

test('vault plan escreve a proposta em outbox/vault sem tocar em nada do Vault', async t => {
  const a = await ambiente(t);
  const antes = await arvore(a.vault);
  const r = run(['vault', 'plan', '--json'], { dataRoot: a.dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await arvore(a.vault), antes, 'diff do Vault vazio');
  assert.equal(path.resolve(r.json.proposta), path.join(a.dataRoot, 'outbox', 'vault', 'proposta-f4.md'));
  const md = await readFile(r.json.proposta, 'utf8');
  assert.match(md, /Nenhum arquivo do Vault foi alterado/);
  for (const n of [1, 2, 3, 4, 5]) assert.match(md, new RegExp(`^## ${n}\\. `, 'm'));
});

test('a proposta lista arcos sem o campo afirmacoes e os bullets sem marca com candidatas', async t => {
  const a = await ambiente(t);
  const md = await readFile(run(['vault', 'plan', '--json'], { dataRoot: a.dataRoot }).json.proposta, 'utf8');
  assert.match(md, /arco-solto/);
  assert.ok(!/arco-ligado/.test(md.split('## 3.')[0].split('## 2.')[1]), 'arco já ligado não entra na lista');
  assert.match(md, /cv-vault.*linha 2: Cortou o retrabalho em 60%.*AF-104 \(3\/3\)/s);
  assert.match(md, /<!-- claim:ID -->/);
  assert.match(md, /afirmacoes: \[AF-001, AF-002\]/);
  assert.match(md, /AGENTS\.md/);
});

test('os itens 1, 4 e 5 saem como dispensado ou adiado, com o motivo', async t => {
  const a = await ambiente(t);
  const md = await readFile(run(['vault', 'plan', '--json'], { dataRoot: a.dataRoot }).json.proposta, 'utf8');
  assert.match(md, /## 1\. .*dispensad/i);
  assert.match(md, /fontes\.yml/);
  assert.match(md, /## 4\. .*adiad/i);
  assert.match(md, /F2\.22/);
  assert.match(md, /Iniciar painel\.cmd/);
  assert.match(md, /## 5\. .*adiad/i);
});

test('é idempotente e funciona sem Vault configurado', async t => {
  const a = await ambiente(t);
  const um = run(['vault', 'plan', '--json'], { dataRoot: a.dataRoot });
  const primeiro = await readFile(um.json.proposta, 'utf8');
  assert.equal(await readFile(run(['vault', 'plan', '--json'], { dataRoot: a.dataRoot }).json.proposta, 'utf8'), primeiro);
  const b = await ambiente(t, { comVault: false });
  const r = run(['vault', 'plan', '--json'], { dataRoot: b.dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.match(await readFile(r.json.proposta, 'utf8'), /nenhum arco do Vault configurado/i);
});

test('não existe modo de aplicar: vault apply e subcomando desconhecido falham', async t => {
  const a = await ambiente(t);
  const antes = await arvore(a.vault);
  const apply = run(['vault', 'apply', '--item', '3', '--json'], { dataRoot: a.dataRoot });
  assert.equal(apply.status, 2);
  assert.match(apply.json.error, /apply.*não existe|aplic/i);
  assert.equal(run(['vault'], { dataRoot: a.dataRoot }).status, 2);
  assert.equal(await arvore(a.vault), antes);
});
