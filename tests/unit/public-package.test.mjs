import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { auditLicenses, checkLicenseExpression, checkVendorNotice } from '../../core/plugin/licenses.mjs';

const read = relative => readFile(path.join(repoRoot, relative), 'utf8');
const exists = relative => access(path.join(repoRoot, relative)).then(() => true, () => false);

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

test('os documentos do pacote público existem', async () => {
  for (const name of ['LICENSE', 'NOTICE', 'LEGAL_DISCLAIMER.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md', 'README.md', 'README.en.md']) {
    assert.equal(await exists(name), true, name);
  }
});

test('os dois READMEs têm as mesmas seções, na mesma ordem', async () => {
  const sections = text => [...text.matchAll(/^(#{1,3}) .*?\s*<!-- sec:([\w-]+) -->\s*$/gm)].map(m => `${m[1]}:${m[2]}`);
  const pt = sections(await read('README.md'));
  const en = sections(await read('README.en.md'));
  assert.ok(pt.length >= 6, 'seções marcadas');
  assert.deepEqual(en, pt);
  for (const file of ['README.md', 'README.en.md']) {
    const headings = (await read(file)).split('\n').filter(l => /^#{1,3} /.test(l));
    assert.equal(headings.filter(l => l.startsWith('# ')).length, 1);
    assert.equal(headings.length, pt.length, `${file}: todo título deve ter marcador de seção`);
  }
});

test('LICENSE é o texto MIT padrão', async () => {
  const [first, ...rest] = (await read('LICENSE')).trimEnd().split('\n');
  assert.equal(first, 'MIT License');
  const body = rest.join('\n').trim();
  assert.match(body.split('\n')[0], /^Copyright \(c\) \d{4} \S/);
  assert.equal(body.split('\n').slice(2).join('\n'), MIT_BODY);
});

test('o nome não contém "career-ops" nos manifestos nem nos títulos', async () => {
  for (const file of ['package.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    assert.ok(!/career-ops/i.test(await read(file)), file);
  }
  for (const file of ['README.md', 'README.en.md']) {
    const title = (await read(file)).split('\n').find(l => l.startsWith('# '));
    assert.ok(!/career-ops/i.test(title), file);
  }
});

test('dependências instaladas só usam licenças permitidas', async () => {
  const result = await auditLicenses(repoRoot);
  assert.deepEqual(result.violations, []);
});

test('o verificador de licenças recusa AGPL, GPL e Commons Clause e aceita as permitidas', () => {
  for (const ok of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', '(MIT OR GPL-3.0)', '(MIT AND Apache-2.0)']) assert.equal(checkLicenseExpression(ok), true, ok);
  for (const bad of ['AGPL-3.0', 'GPL-3.0-only', 'MIT AND GPL-2.0', 'MIT WITH Commons-Clause', 'Commons Clause', 'UNLICENSED', undefined]) assert.equal(checkLicenseExpression(bad), false, String(bad));
});

test('todo arquivo em vendor/ precisa de entrada no NOTICE com origem e licença MIT', async t => {
  assert.deepEqual(await checkVendorNotice(repoRoot), []);
  const dir = await tempDir(t);
  await mkdir(path.join(dir, 'vendor'));
  await writeFile(path.join(dir, 'vendor', 'trecho.mjs'), 'export {}');
  await writeFile(path.join(dir, 'NOTICE'), 'nada aqui\n');
  assert.match((await checkVendorNotice(dir)).join('\n'), /vendor\/trecho\.mjs/);
  await writeFile(path.join(dir, 'NOTICE'), 'vendor/trecho.mjs | origem: https://exemplo.test/projeto | licença: MIT\n');
  assert.deepEqual(await checkVendorNotice(dir), []);
});

test('CONTRIBUTING proíbe copiar código dos projetos AGPL e Commons Clause', async () => {
  const text = await read('CONTRIBUTING.md');
  for (const word of ['AGPL', 'Commons Clause', 'ApplyPilot', 'job-ops', 'ideias']) assert.ok(text.includes(word), word);
});

test('LEGAL_DISCLAIMER cobre termos de cada site, candidatura em massa e envio desligado; README linka na primeira tela', async () => {
  const text = await read('LEGAL_DISCLAIMER.md');
  assert.match(text, /termos de uso de cada site/i);
  assert.match(text, /candidatura em massa/i);
  assert.match(text, /envio automático.*desligado/is);
  for (const file of ['README.md', 'README.en.md']) {
    const firstScreen = (await read(file)).split('\n').slice(0, 25).join('\n');
    assert.match(firstScreen, /LEGAL_DISCLAIMER\.md/, file);
  }
});

test('SECURITY tem canal de reporte e política de divulgação', async () => {
  const text = await read('SECURITY.md');
  assert.match(text, /canal de reporte/i);
  assert.match(text, /política de divulgação/i);
  assert.match(text, /\d+ dias/);
});

test('PRIVACY lista o que nunca entra no repositório e onde ficam os dados', async () => {
  const text = await read('PRIVACY.md');
  for (const item of ['config.yml', 'identity.yml', 'denylist.txt', 'secrets/', 'DATA_ROOT', 'kb/', 'events/']) assert.ok(text.includes(item), item);
  assert.match(text, /nunca entra/i);
});

test('CI roda gitleaks com o .gitleaks.toml e o scan de privacidade em todos os arquivos', async () => {
  const ci = await readFile(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  // Action fixada por SHA de commit (tag é mutável), com a major anotada ao lado.
  assert.match(ci, /gitleaks\/gitleaks-action@[0-9a-f]{40} # v2/);
  assert.doesNotMatch(ci, /uses: [^\s#]+@v\d/);
  assert.match(ci, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(ci, /GITLEAKS_CONFIG:\s*\.gitleaks\.toml/);
  assert.match(ci, /fetch-depth:\s*0/);
  assert.match(ci, /node bin\/career-bounty\.mjs privacy scan --all/);
});

test('expressão mista com AND de licença proibida é recusada; parênteses decidem a precedência', () => {
  for (const bad of ['(MIT OR ISC) AND GPL-3.0', '(MIT OR GPL-3.0) AND AGPL-3.0', 'MIT OR GPL-3.0 AND AGPL-3.0', 'MIT AND (ISC OR GPL-3.0) AND AGPL-3.0', '(MIT', 'MIT)'])
    assert.equal(checkLicenseExpression(bad), false, bad);
  for (const ok of ['(MIT OR GPL-3.0) AND ISC', '(MIT AND GPL-2.0) OR ISC', 'MIT AND (ISC OR GPL-3.0)']) assert.equal(checkLicenseExpression(ok), true, ok);
});
