import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00';

async function setupAmbiente(t) {
  const dataRoot = await tempDir(t);
  const put = async (relativo, dado) => {
    const alvo = path.join(dataRoot, relativo);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, typeof dado === 'string' ? dado : JSON.stringify(dado));
  };
  await put('state/migration.json', { version: 1, mode: 'ativo', snapshotRoot: null });
  await put('projections/pipeline-vagas.json', { vagas: [] });
  await mkdir(path.join(dataRoot, 'events'), { recursive: true });

  const panel = await startPanel({
    dataRoot,
    port: 0,
    now: () => NOW,
  });
  t.after(panel.close);

  const get = (urlPath = '/') => fetch(`${panel.url}${urlPath}`);
  return { dataRoot, panel, get };
}

test('GET /icone.svg e /favicon.ico servem o ícone em SVG', async t => {
  const env = await setupAmbiente(t);

  const resIcon = await env.get('/icone.svg');
  assert.equal(resIcon.status, 200);
  assert.match(resIcon.headers.get('content-type'), /image\/svg\+xml/);
  const textoIcon = await resIcon.text();
  assert.match(textoIcon, /<svg/);
  assert.match(textoIcon, /#0E2240/);

  const resFavicon = await env.get('/favicon.ico');
  assert.equal(resFavicon.status, 200);
  assert.match(resFavicon.headers.get('content-type'), /image\/svg\+xml/);
});

test('GET /fontes/<arquivo.woff2> serve arquivos woff2 permitidos', async t => {
  const env = await setupAmbiente(t);

  const fontes = [
    'schibsted-grotesk-400.woff2',
    'schibsted-grotesk-500.woff2',
    'schibsted-grotesk-600.woff2',
    'schibsted-grotesk-700.woff2',
    'pixelify-sans-500.woff2',
  ];

  for (const fonte of fontes) {
    const res = await env.get(`/fontes/${fonte}`);
    assert.equal(res.status, 200, `Falha ao carregar fonte: ${fonte}`);
    assert.match(res.headers.get('content-type'), /font\/woff2/);
    const bytes = await res.arrayBuffer();
    assert.ok(bytes.byteLength > 1000, `Tamanho insuficiente para ${fonte}: ${bytes.byteLength}`);
  }
});

test('GET /fontes/ bloqueia traversal e fontes fora da allowlist', async t => {
  const env = await setupAmbiente(t);

  const naoPermitida = await env.get('/fontes/outra-fonte.woff2');
  assert.equal(naoPermitida.status, 404);

  const inexistente = await env.get('/fontes/inexistente.woff2');
  assert.equal(inexistente.status, 404);

  const traversal1 = await env.get('/fontes/../server.mjs');
  assert.equal(traversal1.status, 404);

  const traversal2 = await env.get('/fontes/%2e%2e/server.mjs');
  assert.equal(traversal2.status, 404);

  const traversalPrivado = await env.get('/fontes/../privado');
  assert.equal(traversalPrivado.status, 404);
});

test('GET / retorna HTML sem qualquer tag <img> e com CSP restritiva', async t => {
  const env = await setupAmbiente(t);

  const res = await env.get('/');
  assert.equal(res.status, 200);

  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.ok(!csp.includes('https:'));
  assert.ok(!csp.includes('*'));

  const html = await res.text();
  assert.equal(html.match(/<img\b[^>]*>/gi), null, 'HTML não deve conter tags <img>');
});

