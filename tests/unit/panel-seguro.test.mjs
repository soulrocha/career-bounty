import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir, repoRoot } from '../helpers/cli.mjs';
import { createMaterials, validateBaseFiles } from '../../panel/materials.mjs';
import { startPanel } from '../../panel/server.mjs';
import { loadSettings } from '../../core/config.mjs';

const fixture = path.join(repoRoot, 'tests/fixtures/legado-1-vaga.json');

test('/api/status usa o nome do app vindo do config.yml (alias da sombra fora do código)', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['migrate', '--from', fixture, '--json'], { dataRoot }).status, 0);
  const padrao = await startPanel({ dataRoot, port: 0 });
  t.after(padrao.close);
  assert.equal((await (await fetch(`${padrao.url}/api/status`)).json()).app, 'career-bounty');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ panel: { app_name: 'app-alias' } }));
  const settings = await loadSettings({ dataRoot });
  const alias = await startPanel({ dataRoot, port: 0, appName: settings.panel.app_name });
  t.after(alias.close);
  assert.equal((await (await fetch(`${alias.url}/api/status`)).json()).app, 'app-alias');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ panel: { app_name: '../x' } }));
  await assert.rejects(loadSettings({ dataRoot }), /app_name/);
});

test('cabeçalhos de segurança valem também em 403, 404 e 409', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['migrate', '--from', fixture, '--json'], { dataRoot }).status, 0);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  for (const response of [await fetch(`${panel.url}/api/candidaturas`), await fetch(`${panel.url}/nao-existe`), await fetch(`${panel.url}/curriculos/vagas/x/curriculo.html`)]) {
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('política de materiais: só nome-base, manifesto, PDF base da allowlist e relatórios', async t => {
  const snapshot = await tempDir(t);
  await mkdir(path.join(snapshot, 'curriculos/vagas/a'), { recursive: true });
  await writeFile(path.join(snapshot, 'curriculos/vagas/a/curriculo-ats.pdf'), '%PDF');
  await writeFile(path.join(snapshot, 'curriculos/vagas/a/segredo.txt'), 'x');
  const policy = createMaterials({ snapshot, namedMaterials: new Set(['/carreira/busca-vagas/../../curriculos/vagas/a/extra.pdf']), baseFiles: ['base.pdf'] });
  assert.equal(policy.allows('/curriculos/vagas/a/curriculo-ats.pdf'), true);
  assert.equal(policy.allows('/curriculos/base.pdf'), true);
  assert.equal(policy.allows('/curriculos/vagas/a/segredo.txt'), false);
  assert.equal(policy.allows('/carreira/busca-vagas/relatorio-vagas.md'), true);
  assert.equal(policy.allows('/state/migration.json'), false);
  assert.equal((await policy.read('/curriculos/vagas/a/curriculo-ats.pdf')).type, 'application/pdf');
  assert.equal(await policy.read('/curriculos/vagas/a/segredo.txt'), null);
  assert.equal(createMaterials({ snapshot: null }).allows('/curriculos/vagas/a/curriculo.html'), false);
  assert.throws(() => validateBaseFiles(['../x.pdf']), /base/);
});
