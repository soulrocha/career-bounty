import assert from 'node:assert/strict';
import test from 'node:test';
import { getText } from '../../core/sources/http.mjs';
import { checkedBase } from '../../core/sources/endpoints.mjs';
import { startServer } from '../helpers/http-server.mjs';

const ok = (res, texto = 'ok') => { res.statusCode = 200; res.end(texto); };
const redirecionar = (res, destino, status = 302) => { res.statusCode = status; res.setHeader('location', destino); res.end(); };

test('redirect para outro host fora da allowlist é recusado e o destino nunca é requisitado', async t => {
  const alvo = await startServer(t, (req, res) => ok(res, 'segredo'));
  const origem = await startServer(t, (req, res) => redirecionar(res, `${alvo.base}/x`));
  await assert.rejects(() => getText(`${origem.base}/a`, { retries: 0 }), error => error.codigo === 'redirect_bloqueado' || /redirect/i.test(error.message));
  assert.equal(alvo.requests.length, 0);
});

test('redirect para host permitido é seguido, e cada salto conta no orçamento da fonte', async t => {
  const alvo = await startServer(t, (req, res) => ok(res, 'final'));
  const origem = await startServer(t, (req, res) => (req.url === '/a' ? redirecionar(res, '/b') : req.url === '/b' ? redirecionar(res, alvo.base + '/c', 301) : ok(res)));
  let saltos = 0;
  const resposta = await getText(`${origem.base}/a`, { retries: 0, hosts: [new URL(origem.base).host, new URL(alvo.base).host], gastar: async () => { saltos += 1; return true; } });
  assert.equal(resposta.text, 'final');
  assert.equal(saltos, 2);
});

test('orçamento esgotado no salto interrompe a cadeia', async t => {
  const origem = await startServer(t, (req, res) => redirecionar(res, '/b'));
  await assert.rejects(() => getText(`${origem.base}/a`, { retries: 0, gastar: async () => false }), /limite|orçamento/i);
  assert.equal(origem.requests.length, 1);
});

test('limite de saltos: laço de redirects termina com erro', async t => {
  const origem = await startServer(t, (req, res) => redirecionar(res, '/loop'));
  await assert.rejects(() => getText(`${origem.base}/a`, { retries: 0, maxSaltos: 3 }), /saltos|redirect/i);
  assert.equal(origem.requests.length, 4);
});

test('checkedBase só aceita loopback http em modo de teste explícito', () => {
  const antes = process.env.CAREER_BOUNTY_TESTE;
  try {
    delete process.env.CAREER_BOUNTY_TESTE;
    assert.throws(() => checkedBase('http://localhost:8080', 'https://exemplo.test', 'x'), /não permitido|teste/);
    assert.throws(() => checkedBase('http://127.0.0.1:8080', 'https://exemplo.test', 'x'), /não permitido|teste/);
    assert.equal(checkedBase('https://exemplo.test/', 'https://exemplo.test', 'x'), 'https://exemplo.test');
    process.env.CAREER_BOUNTY_TESTE = '1';
    assert.equal(checkedBase('http://127.0.0.1:8080/', 'https://exemplo.test', 'x'), 'http://127.0.0.1:8080');
  } finally { if (antes === undefined) delete process.env.CAREER_BOUNTY_TESTE; else process.env.CAREER_BOUNTY_TESTE = antes; }
});
