import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startPanel } from '../../panel/server.mjs';

async function fixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'career-panel-'));
  const snapshot = join(dataRoot, 'backups', 'test');
  async function put(path, data) {
    const target = join(dataRoot, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, typeof data === 'string' ? data : JSON.stringify(data));
  }
  await put('state/migration.json', { version: 1, mode: 'shadow', snapshotRoot: 'backups/test' });
  await put('projections/pipeline-vagas.json', { vagas: [{ id: 'fixture', status: 'nova' }] });
  await put('backups/test/carreira/pipeline-vagas.json', { vagas: [{ id: 'fixture', status: 'nova' }] });
  await put('backups/test/carreira/busca-vagas/painel-vagas.html', '<html><head></head><body>Fixture<script>let applicationApiReady=false; applicationApiReady=true;</script></body></html>');
  await put('backups/test/carreira/busca-vagas/curriculos-manifest.json', []);
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  return { dataRoot, snapshot, put };
}

test('painel local identifica modo sombra e entrega HTML com token efêmero', async t => {
  const { dataRoot } = await fixture(t);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const response = await fetch(`${panel.url}/api/status`);
  assert.deepEqual(await response.json(), { app: 'career-bounty', version: 1, mode: 'shadow' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const page = await (await fetch(panel.url)).text();
  assert.match(page, /window\.PAINEL_API=\{"token":"[a-f0-9]{64}"\}/);
  assert.match(page, /SOMBRA/);
});

test('somente materiais e relatórios permitidos ficam disponíveis; outros arquivos são privados', async t => {
  const { dataRoot, put } = await fixture(t);
  await put('backups/test/curriculos/vagas/fixture/curriculo-ats.pdf', '%PDF-ATS');
  await put('backups/test/curriculos/vagas/fixture/exportado.pdf', '%PDF-exportado');
  await put('backups/test/curriculos/vagas/fixture/secreto.txt', 'Privado');
  await put('state/migration.json', { version: 1, mode: 'shadow', snapshotRoot: 'backups/test', allowedBaseFiles: ['ats/curriculo-base.pdf', 'curriculo-visual-base.pdf'] });
  await put('backups/test/curriculos/curriculo-visual-base.pdf', '%PDF-base');
  await put('backups/test/curriculos/ats/curriculo-base.pdf', '%PDF-base');
  await put('backups/test/carreira/busca-vagas/relatorio-vagas.md', '# Relatório');
  await put('backups/test/carreira/busca-vagas/curriculos-manifest.json', [{ pdf_ats: '../../curriculos/vagas/fixture/exportado.pdf' }]);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  for (const path of ['/curriculos/vagas/fixture/curriculo-ats.pdf', '/curriculos/vagas/fixture/exportado.pdf', '/curriculos/curriculo-visual-base.pdf', '/curriculos/ats/curriculo-base.pdf']) {
    const response = await fetch(panel.url + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(await response.text(), /^%PDF/);
  }
  assert.equal((await fetch(`${panel.url}/carreira/busca-vagas/relatorio-vagas.md`)).status, 200);
  for (const path of ['/curriculos/vagas/fixture/secreto.txt', '/state/migration.json', '/carreira/busca-vagas/curriculos-manifest.json']) {
    assert.equal((await fetch(panel.url + path)).status, 404);
  }
});

test('marcadores preservam chaves nulas como no contrato legado', async t => {
  const { dataRoot, put } = await fixture(t);
  const pipeline = { vagas: [{ id: 'explicit-null', historico_anterior: null, historico: true }] };
  await put('projections/pipeline-vagas.json', pipeline);
  await put('backups/test/carreira/pipeline-vagas.json', pipeline);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const page = await (await fetch(panel.url)).text();
  const token = JSON.parse(page.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  const response = await fetch(`${panel.url}/api/candidaturas`, { headers: { 'X-Painel-Token': token } });
  assert.deepEqual(await response.json(), { vagas: [{ id: 'explicit-null', aplicada: false, data: null,
    historico_confirmado: false, status: null, evidencia_email: null, etapa_email: null,
    origem: null, historico_anterior: null, descartada: false }] });
});

test('PDFs base exigem allowlist privada segura e não possuem fallback', async t => {
  const { dataRoot, put } = await fixture(t);
  await put('backups/test/curriculos/curriculo-base.pdf', '%PDF-base');
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  assert.equal((await fetch(`${panel.url}/curriculos/curriculo-base.pdf`)).status, 404);
  for (const allowedBaseFiles of [['../secreto.pdf'], ['/secreto.pdf'], ['ats\\secreto.pdf'], ['ats/secreto.html'], 'curriculo-base.pdf']) {
    await put('state/migration.json', { version: 1, mode: 'shadow', snapshotRoot: 'backups/test', allowedBaseFiles });
    await assert.rejects(startPanel({ dataRoot, port: 0 }), /base/);
  }
});

function rawStatus(url, path, headers = {}) {
  return new Promise((done, fail) => {
    const req = request(url, { path, headers }, res => { res.resume(); res.once('end', () => done(res.statusCode)); });
    req.once('error', fail);
    req.end();
  });
}

test('Host adulterado, traversal e links simbólicos não expõem dados privados', async t => {
  const { dataRoot, put } = await fixture(t);
  await put('secreto.txt', 'Fora do snapshot');
  await put('curriculo-ats.pdf', '%PDF-privado-fora-do-snapshot');
  await mkdir(join(dataRoot, 'backups/test/curriculos/vagas'), { recursive: true });
  await symlink(dataRoot, join(dataRoot, 'backups/test/curriculos/vagas/link'), 'junction');
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  assert.equal(await rawStatus(panel.url, '/api/status', { Host: 'evil.example' }), 403);
  for (const path of ['/curriculos/vagas/%2e%2e/%2e%2e/secreto.txt', '/curriculos/vagas/%252e%252e/secreto.txt', '/curriculos/vagas/..%5c..%5csecreto.txt', '/curriculos/vagas/link/curriculo-ats.pdf']) {
    assert.equal(await rawStatus(panel.url, path), 404, path);
  }
  await assert.rejects(startPanel({ dataRoot, host: '0.0.0.0', port: 0 }), /local/);
});

test('estado inválido ou snapshot fora de backups impede inicialização', async t => {
  const { dataRoot, put } = await fixture(t);
  await rm(join(dataRoot, 'state/migration.json'));
  await assert.rejects(startPanel({ dataRoot, port: 0 }), { code: 'ENOENT' });
  for (const state of [{ mode: 'active', snapshotRoot: 'backups/test' }, { version: 1, mode: 'shadow', snapshotRoot: '../other' }, { version: 1, mode: 'shadow', snapshotRoot: 'backups/../state' }]) {
    await put('state/migration.json', state);
    await assert.rejects(startPanel({ dataRoot, port: 0 }));
  }
  await symlink(join(dataRoot, 'backups/test'), join(dataRoot, 'backups/link'), 'junction');
  await put('state/migration.json', { version: 1, mode: 'shadow', snapshotRoot: 'backups/link' });
  await assert.rejects(startPanel({ dataRoot, port: 0 }), /Link/);
});

test('leituras preservam marcadores históricos e gravações autenticadas ficam bloqueadas', async t => {
  const { dataRoot, put } = await fixture(t);
  const pipeline = { vagas: [
    { id: 'confirmada', status: 'candidatura-enviada-confirmada', candidatura_email: { data: '2026-10-01', etapa: 'triagem', observacao: 'Recebida' } },
    { id: 'manual', candidatura_usuario: { aplicada: true, data: '2026-10-02' }, descarte_usuario: { descartada: true } },
    { id: 'portal', candidatura_portal: { aplicada: true, data: '2026-10-03' } },
    { id: 'nova', status: 'nova' }
  ] };
  await put('projections/pipeline-vagas.json', pipeline);
  await put('backups/test/carreira/pipeline-vagas.json', pipeline);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const page = await (await fetch(panel.url)).text();
  const token = JSON.parse(page.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  assert.equal((await fetch(`${panel.url}/api/candidaturas`)).status, 403);
  const headers = { 'X-Painel-Token': token };
  const body = await (await fetch(`${panel.url}/api/candidaturas`, { headers })).json();
  assert.equal(body.vagas[0].historico_confirmado, true);
  assert.equal(body.vagas[0].data, '2026-10-01');
  assert.equal(body.vagas[0].etapa_email, 'triagem');
  assert.equal(body.vagas[1].origem, 'usuario-no-painel');
  assert.equal(body.vagas[1].descartada, true);
  assert.equal(body.vagas[2].aplicada, true);
  assert.equal(body.vagas[3].aplicada, false);
  assert.match(page, /gravação desligada/);
  assert.doesNotMatch(page, /applicationApiReady=true/);
  for (const route of ['candidaturas', 'descarte']) {
    assert.equal((await fetch(`${panel.url}/api/${route}`, { method: 'POST', headers })).status, 403);
    const response = await fetch(`${panel.url}/api/${route}`, { method: 'POST', headers: { ...headers, Origin: panel.url } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).gravacao_painel, 'desligada');
  }
  assert.deepEqual(JSON.parse(await readFile(join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8')), pipeline);
});

test('projeção divergente do snapshot bloqueia inicialização e nova importação não muda sessão aberta', async t => {
  const { dataRoot, put } = await fixture(t);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const page = await (await fetch(panel.url)).text();
  const token = JSON.parse(page.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  await put('projections/pipeline-vagas.json', { vagas: [] });
  await assert.rejects(startPanel({ dataRoot, port: 0 }), /snapshot/);
  const response = await fetch(`${panel.url}/api/candidaturas`, { headers: { 'X-Painel-Token': token } });
  assert.equal((await response.json()).vagas.length, 1);
});

test('links relativos dos três relatórios funcionam ao abrir a raiz do painel', async t => {
  const { dataRoot, put } = await fixture(t);
  const reports = ['relatorio-vagas.md', 'busca-browseruse-2026-10-05.md', 'busca-linkedin-ampla-2026-10-05.md'];
  await put('backups/test/carreira/busca-vagas/painel-vagas.html', `<html><head></head><body>${reports.map(name => `<a href="${name}">Relatório</a>`).join('')}</body></html>`);
  for (const name of reports) await put(`backups/test/carreira/busca-vagas/${name}`, '# Relatório sintético');
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const page = await (await fetch(panel.url)).text();
  const base = page.match(/<base href="([^"]+)"/);
  assert.ok(base, 'HTML servido precisa preservar a base original dos links relativos');
  const documentBase = new URL(base[1], panel.url);
  for (const name of reports) {
    const link = new URL(name, documentBase);
    assert.equal(link.pathname, `/carreira/busca-vagas/${name}`);
    const response = await fetch(link);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '# Relatório sintético');
    assert.equal((await fetch(`${panel.url}/${name}`)).status, 404);
  }
});
