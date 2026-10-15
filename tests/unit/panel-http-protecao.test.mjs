// F1.8: prova por HTTP de que o Host check e a barreira de caminho funcionam. Cada alvo é um arquivo que
// VAZARIA se a proteção fosse removida (mutação verificada à mão: tirar a linha faz o teste falhar).
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startPanel } from '../../panel/server.mjs';

const PRIVADO = '%PDF-PRIVADO-NAO-PODE-VAZAR';

async function ambiente(t, mode = 'shadow') {
  const dataRoot = await mkdtemp(join(tmpdir(), 'career-panel-http-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const put = async (path, data) => {
    const target = join(dataRoot, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, typeof data === 'string' ? data : JSON.stringify(data));
  };
  await put('state/migration.json', { version: 1, mode, snapshotRoot: 'backups/test' });
  await put('projections/pipeline-vagas.json', { vagas: [{ id: 'fixture', status: 'nova' }] });
  await put('backups/test/carreira/pipeline-vagas.json', { vagas: [{ id: 'fixture', status: 'nova' }] });
  await put('backups/test/carreira/busca-vagas/painel-vagas.html', '<html><head></head><body>Fixture</body></html>');
  await put('backups/test/carreira/busca-vagas/curriculos-manifest.json', []);
  await put('backups/test/curriculos/vagas/fixture/curriculo-ats.pdf', '%PDF-PUBLICO');
  // alvos de vazamento: nome-base permitido (curriculo-ats.pdf) em lugares onde NÃO deveria ser servido
  await put('backups/test/carreira/privado/curriculo-ats.pdf', PRIVADO);
  await put('backups/test/curriculos/vagas/fixture/%2e%2e/curriculo-ats.pdf', PRIVADO);
  if (process.platform !== 'win32') await put('backups/test/curriculos/vagas/fixture/a\\b/curriculo-ats.pdf', PRIVADO);
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  return { dataRoot, panel, port: new URL(panel.url).port };
}

// Requisição crua: nada normaliza o caminho nem completa o cabeçalho Host.
function cru(port, linhaDeRequisicao, cabecalhos = []) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), '127.0.0.1');
    let data = '';
    socket.setEncoding('latin1');
    socket.on('data', chunk => { data += chunk; });
    socket.on('error', reject);
    socket.on('close', () => {
      const [head, ...rest] = data.split('\r\n\r\n');
      resolve({ status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1]), head, body: rest.join('\r\n\r\n') });
    });
    socket.write([linhaDeRequisicao, ...cabecalhos, 'Connection: close', '', ''].join('\r\n'));
  });
}

test('Host check: só 127.0.0.1:porta e localhost:porta; qualquer outro é 403 mesmo com token válido', async t => {
  const { port } = await ambiente(t);
  const certo = `127.0.0.1:${port}`;
  const pagina = await cru(port, 'GET / HTTP/1.1', [`Host: ${certo}`]);
  assert.equal(pagina.status, 200);
  const token = /"token":"([a-f0-9]{64})"/.exec(pagina.body)?.[1];
  assert.ok(token);
  assert.equal((await cru(port, 'GET /api/status HTTP/1.1', [`Host: localhost:${port}`])).status, 200);
  const invalidos = ['evil.example', `evil.example:${port}`, `localhost.evil.example:${port}`, `127.0.0.1.evil.example:${port}`, '127.0.0.1', 'localhost', `127.0.0.1:${Number(port) + 1}`, `0.0.0.0:${port}`, `[::1]:${port}`];
  for (const host of invalidos) {
    for (const caminho of ['/api/status', '/', '/api/candidaturas']) {
      const resposta = await cru(port, `GET ${caminho} HTTP/1.1`, [`Host: ${host}`, `X-Painel-Token: ${token}`]);
      assert.equal(resposta.status, 403, `${host} ${caminho}`);
      assert.ok(!resposta.body.includes(token), `${host} ${caminho}: o token não pode vazar`);
    }
  }
  assert.equal((await cru(port, 'GET /api/status HTTP/1.0')).status, 403, 'sem cabeçalho Host');
});

test('traversal por HTTP: ponto-ponto, %2e, %252e, barra invertida e NUL nunca chegam a arquivo privado', async t => {
  const { port } = await ambiente(t);
  const host = [`Host: 127.0.0.1:${port}`];
  const controle = await cru(port, 'GET /curriculos/vagas/fixture/curriculo-ats.pdf HTTP/1.1', host);
  assert.equal(controle.status, 200);
  assert.match(controle.body, /PUBLICO/);
  const barraInvertida = process.platform === 'win32'
    ? '/curriculos/vagas/fixture/..%5C..%5C..%5Ccarreira%5Cprivado/curriculo-ats.pdf'
    : '/curriculos/vagas/fixture/a%5Cb/curriculo-ats.pdf';
  const alvos = {
    'ponto-ponto': '/curriculos/vagas/fixture/../../../carreira/privado/curriculo-ats.pdf',
    '%2e%2e': '/curriculos/vagas/fixture/%2e%2e/%2e%2e/%2e%2e/carreira/privado/curriculo-ats.pdf',
    '%2E%2E maiúsculo': '/curriculos/vagas/fixture/%2E%2E/%2E%2E/%2E%2E/carreira/privado/curriculo-ats.pdf',
    'ponto simples': '/curriculos/vagas/fixture/./curriculo-ats.pdf',
    '%252e (dupla codificação)': '/curriculos/vagas/fixture/%252e%252e/curriculo-ats.pdf',
    'barra invertida': barraInvertida,
    'NUL': '/curriculos/vagas/fixture/curriculo-ats.pdf%00.png',
    'NUL no meio': '/curriculos/vagas/fixture/%00/../../carreira/privado/curriculo-ats.pdf',
  };
  for (const [nome, caminho] of Object.entries(alvos)) {
    const resposta = await cru(port, `GET ${caminho} HTTP/1.1`, host);
    assert.equal(resposta.status, 404, nome);
    assert.ok(!resposta.body.includes('PRIVADO'), `${nome}: conteúdo privado vazou`);
  }
});

test('todas as respostas levam CSP restritiva, Referrer-Policy e demais cabeçalhos de segurança', async t => {
  const { port } = await ambiente(t);
  const host = [`Host: 127.0.0.1:${port}`];
  const casos = [['GET / HTTP/1.1', host, 200], ['GET /api/status HTTP/1.1', host, 200], ['GET /nao-existe HTTP/1.1', host, 404], ['GET / HTTP/1.1', ['Host: evil.example'], 403]];
  for (const [linha, cabecalhos, status] of casos) {
    const resposta = await cru(port, linha, cabecalhos);
    assert.equal(resposta.status, status, linha);
    const cabecalho = nome => new RegExp(`^${nome}: (.*)$`, 'im').exec(resposta.head)?.[1];
    assert.equal(cabecalho('Referrer-Policy'), 'no-referrer', linha);
    const csp = cabecalho('Content-Security-Policy');
    assert.ok(csp, linha);
    for (const diretiva of ["default-src 'none'", "connect-src 'self'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(csp.includes(diretiva), `${linha}: ${diretiva}`);
    assert.ok(!/(^|[ ;])(\*|https?:)/.test(csp.replace(/'self'|'none'/g, '')), `${linha}: nenhuma origem externa`);
    assert.equal(cabecalho('X-Content-Type-Options'), 'nosniff');
  }
});

test('/api/status informa o modo real (shadow ou ativo), não um valor fixo', async t => {
  const sombra = await ambiente(t);
  assert.equal((await (await fetch(`${sombra.panel.url}/api/status`)).json()).mode, 'shadow');
  const ativo = await ambiente(t, 'ativo');
  assert.equal((await (await fetch(`${ativo.panel.url}/api/status`)).json()).mode, 'ativo');
});
