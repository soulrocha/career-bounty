import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from '../helpers/cli.mjs';
import { findViolations } from '../helpers/allowlist.mjs';
import { buildContext, scanText, scanTracked } from '../../core/privacy/scan.mjs';
import { loadPrivacyContext } from '../../core/privacy/context.mjs';

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(path.join(repoRoot, dir), { withFileTypes: true }).catch(() => [])) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(relative));
    else out.push(relative);
  }
  return out;
}

test('todo arquivo da persona fictícia passa no scan de dado pessoal', async () => {
  const files = await filesUnder('examples/persona-ficticia');
  assert.ok(files.length >= 8);
  for (const file of files) {
    const findings = scanText(await readFile(path.join(repoRoot, file), 'utf8'), buildContext(), file);
    assert.deepEqual(findings, [], file);
  }
});

test('o repositório inteiro está livre de dado real (identidade local quando IDENTITY_FILE existe)', async () => {
  const context = await loadPrivacyContext({ env: process.env });
  assert.deepEqual(await scanTracked(context, repoRoot), []);
  if (process.env.IDENTITY_FILE) assert.equal(context.hasIdentity, true);
});

test('empresas e domínios em fixtures e exemplos pertencem à lista fictícia ou a .test/.example', async () => {
  const allowed = (await readFile(path.join(repoRoot, 'tests/fixtures/empresas-ficticias.txt'), 'utf8')).split(/\r?\n/).filter(Boolean);
  assert.ok(allowed.length >= 3);
  const files = [...await filesUnder('tests/fixtures'), ...await filesUnder('examples')].filter(f => !f.endsWith('empresas-ficticias.txt'));
  for (const file of files) assert.deepEqual(findViolations(await readFile(path.join(repoRoot, file), 'utf8'), allowed), [], file);
});

test('o verificador de allowlist acusa empresa e domínio fora da lista', () => {
  const allowed = ['Empresa Alfa'];
  assert.equal(findViolations('empresa: Empresa Alfa\nhttps://vaga.exemplo.test/x\nana@exemplo.example', allowed).length, 0);
  assert.deepEqual(findViolations('{"empresa": "Outra Coisa"}', allowed), [{ kind: 'empresa' }]);
  assert.deepEqual(findViolations('veja https://portal-real.com.br/vaga', allowed), [{ kind: 'dominio' }]);
  assert.deepEqual(findViolations(`contato ${['fulano', 'provedor.com'].join('@')}`, allowed), [{ kind: 'dominio' }]);
  assert.equal(findViolations('<svg xmlns="http://www.w3.org/2000/svg"></svg>', allowed).length, 0);
  assert.deepEqual(findViolations('<a href="http://www.w3.org/x">', allowed), [{ kind: 'dominio' }]);
});

test('código e instruções não contêm caminho de usuário, IP privado, nome de máquina nem URL de ai-memory', async () => {
  const dirs = ['core', 'panel', 'commands', 'agents', 'skills', 'hooks'];
  const privateIp = /(?<![\d.])(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}(?![\d.])/;
  const machine = hostname().toLowerCase();
  const context = buildContext();
  for (const file of (await Promise.all(dirs.map(filesUnder))).flat()) {
    const text = await readFile(path.join(repoRoot, file), 'utf8');
    assert.deepEqual(scanText(text, context, file).filter(f => f.rule === 'caminho-usuario'), [], file);
    assert.ok(!privateIp.test(text), `${file}: IP de rede privada`);
    assert.ok(!/\/api\/v1/.test(text) || !/https?:\/\/(?!localhost|127\.0\.0\.1)/.test(text), `${file}: URL de ai-memory`);
    if (machine.length >= 4) assert.ok(!text.toLowerCase().includes(machine), `${file}: nome de máquina`);
  }
});
