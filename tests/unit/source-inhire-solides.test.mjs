import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { json, startServer } from '../helpers/http-server.mjs';
import { runSources } from '../../core/sources/index.mjs';
import { createInhire } from '../../core/sources/inhire.mjs';
import { createSolides } from '../../core/sources/solides.mjs';

const fixture = async nome => JSON.parse(await readFile(new URL(`../replay/http/${nome}`, import.meta.url), 'utf8'));
const ctx = (extra = {}) => ({ janela: { inicio: '2026-10-08', fim: '2026-10-15' }, plano: { termos: [] }, config: {}, now: new Date('2026-10-15T21:00:00Z'), conhecidas: new Map(), ...extra });
const semEspera = { sleep: async () => {} };

// ---------- Inhire ----------

async function inhireServer(t, { pages, resolve = 200 } = {}) {
  const resolveBody = await fixture('inhire/resolve.json');
  const pagesBody = pages ?? await fixture('inhire/pages.json');
  const detalhes = { 1: await fixture('inhire/detail-1.json'), 2: await fixture('inhire/detail-2.json'), 3: await fixture('inhire/detail-3.json') };
  return startServer(t, (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/tenants/public/config/resolve/')) {
      const tenant = url.pathname.split('/').pop();
      return tenant === 'empresa-alfa' && resolve === 200 ? json(res, resolveBody) : json(res, { message: 'não encontrado' }, 404);
    }
    if (req.headers['x-tenant'] !== 'empresa-alfa') return json(res, { message: 'Missing required request parameters: [X-Tenant]' }, 400);
    if (url.pathname === '/job-posts/public/pages') return json(res, pagesBody);
    const detalhe = /\/job-posts\/public\/pages\/.*-00000000000(\d)$/.exec(url.pathname);
    return detalhe ? json(res, detalhes[detalhe[1]]) : json(res, {}, 404);
  });
}

const inhire = (server, config = {}) => createInhire({ base_url: server.base, tenants: ['empresa-alfa'], espera_ms: 0, ...config }, semEspera);

test('inhire: lista, valida o tenant, busca o detalhe e mapeia para Vaga', async t => {
  const server = await inhireServer(t);
  const { vagas, fontes } = await runSources([inhire(server)], ctx());
  assert.equal(fontes[0].estado, 'ok');
  assert.deepEqual(vagas.map(v => v.cargo).sort(), ['Gerente de Engenharia', 'Tech Lead']);
  const gerente = vagas.find(v => v.cargo === 'Gerente de Engenharia');
  assert.equal(gerente.portal, 'inhire');
  assert.equal(gerente.requisicao_id, '11111111-aaaa-4bbb-8ccc-000000000001');
  assert.equal(gerente.empresa, 'Empresa Alfa');
  assert.equal(gerente.modalidade, 'remoto');
  assert.equal(gerente.regime, 'CLT');
  assert.equal(gerente.publicado_em, '2026-10-14');
  assert.equal(gerente.url, 'https://empresa-alfa.inhire.app/vagas/11111111-aaaa-4bbb-8ccc-000000000001');
  assert.match(gerente.descricao, /Descrição sintética da vaga 1\./);
  server.assertSemCredenciais();
  assert.ok(server.requests.every(r => r.url.startsWith('/tenants') || r.headers['x-tenant'] === 'empresa-alfa'));
});

test('inhire: vaga pausada e vaga fora da janela são ignoradas', async t => {
  const server = await inhireServer(t);
  const { vagas } = await runSources([inhire(server)], ctx());
  assert.ok(!vagas.some(v => v.cargo === 'Vaga pausada' || v.cargo === 'Analista Júnior'));
});

test('inhire: detalhe só das vagas ainda desconhecidas', async t => {
  const server = await inhireServer(t);
  const conhecidas = new Map([['inhire', new Set(['11111111-aaaa-4bbb-8ccc-000000000001'])]]);
  const { vagas } = await runSources([inhire(server)], ctx({ conhecidas }));
  assert.deepEqual(vagas.map(v => v.cargo), ['Tech Lead']);
  assert.ok(!server.requests.some(r => r.url.endsWith('000000000001')));
});

test('inhire: tenant inexistente é erro nomeado, não lista vazia', async t => {
  const server = await inhireServer(t, { resolve: 404 });
  const { fontes } = await runSources([inhire(server)], ctx());
  assert.equal(fontes[0].estado, 'erro');
  assert.equal(fontes[0].codigo, 'tenant_invalido');
});

test('inhire: um tenant ruim não derruba os outros', async t => {
  const server = await inhireServer(t);
  const { vagas, fontes } = await runSources([inhire(server, { tenants: ['sumiu', 'empresa-alfa'] })], ctx());
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(vagas.length, 2);
  assert.match(fontes[0].avisos.join(' '), /sumiu/);
});

test('inhire: estrutura mudada (sem jobsPage ou item sem jobId) é erro nomeado', async t => {
  const semLista = await inhireServer(t, { pages: { tenantName: 'Empresa Alfa' } });
  assert.equal((await runSources([inhire(semLista)], ctx())).fontes[0].codigo, 'estrutura_mudou');
  const semId = await inhireServer(t, { pages: { jobsPage: [{ displayName: 'x', status: 'published' }] } });
  assert.equal((await runSources([inhire(semId)], ctx())).fontes[0].codigo, 'estrutura_mudou');
});

test('inhire: empresa sem vagas não é erro', async t => {
  const server = await inhireServer(t, { pages: { tenantName: 'Empresa Alfa', jobsPage: [] } });
  const { vagas, fontes } = await runSources([inhire(server)], ctx());
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(vagas.length, 0);
});

// ---------- Solides ----------

const itemSolides = (id, extra = {}) => ({ id, title: `Tech Lead ${id}`, description: '<p>Texto <b>sintético</b>.</p>', companyName: 'Empresa Beta', slug: 'empresa-beta', currentState: 'em_andamento',
  jobType: 'hibrido', homeOffice: false, city: { name: 'Belo Horizonte' }, state: { code: 'MG' }, createdAt: '2026-10-14', salary: { initialRange: 0, finalRange: 0, negotiable: false },
  recruitmentContractType: ['CLT (Efetivo)'], isDisabled: false, redirectLink: 'https://quebrado./vacancies/1', ...extra });

function solidesServer(t, catalogo, { status } = {}) {
  return startServer(t, (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (status) return json(res, { error: 'Failed to fetch vacancies' }, status);
    const todas = catalogo[url.searchParams.get('title')] ?? [];
    const take = Number(url.searchParams.get('take'));
    const page = Number(url.searchParams.get('page'));
    return json(res, { totalPages: Math.ceil(todas.length / take), currentPage: page, count: todas.length, data: todas.slice((page - 1) * take, page * take) });
  });
}

const solides = (server, config = {}) => createSolides({ base_url: server.base, termos: ['tech lead'], espera_ms: 0, ...config }, semEspera);

test('solides: busca por título com take 14, mapeia e monta a URL pública', async t => {
  const server = await solidesServer(t, { 'tech lead': [itemSolides(900001), itemSolides(900002, { jobType: 'remoto', salary: { initialRange: 15000, finalRange: 18000 } })] });
  const { vagas, fontes } = await runSources([solides(server)], ctx());
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(vagas.length, 2);
  assert.equal(new URL(server.requests[0].url, 'http://x').searchParams.get('take'), '14');
  const a = vagas[0];
  assert.equal(a.portal, 'solides');
  assert.equal(a.requisicao_id, '900001');
  assert.equal(a.url, 'https://vagas.solides.com.br/vaga/900001');
  assert.equal(a.local, 'Belo Horizonte, MG');
  assert.equal(a.modalidade, 'hibrido');
  assert.equal(a.regime, 'CLT');
  assert.equal(a.salario_min, null);
  assert.equal(vagas[1].salario_min, 15000);
  assert.equal(vagas[1].modalidade, 'remoto');
  assert.equal(a.descricao, 'Texto sintético.');
  server.assertSemCredenciais();
});

test('solides: pagina em 14, para ao sair da janela e respeita o máximo de páginas', async t => {
  const recentes = Array.from({ length: 30 }, (_, i) => itemSolides(800000 + i));
  const server = await solidesServer(t, { 'tech lead': recentes });
  await runSources([solides(server)], ctx());
  assert.equal(server.requests.length, 3, '30 vagas = 3 páginas de 14');
  server.requests.length = 0;
  await runSources([solides(server, { max_paginas_por_termo: 2 })], ctx());
  assert.equal(server.requests.length, 2);
  const antigas = Array.from({ length: 30 }, (_, i) => itemSolides(700000 + i, { createdAt: '2026-09-01' }));
  const outro = await solidesServer(t, { 'tech lead': antigas });
  const { vagas } = await runSources([solides(outro)], ctx());
  assert.equal(outro.requests.length, 1, 'a primeira página já está fora da janela');
  assert.equal(vagas.length, 0);
});

test('solides: encerrada, desativada e repetida entre termos', async t => {
  const server = await solidesServer(t, { 'tech lead': [itemSolides(1), itemSolides(2, { currentState: 'encerrada' }), itemSolides(3, { isDisabled: true })], 'líder técnico': [itemSolides(1), itemSolides(4)] });
  const { vagas } = await runSources([solides(server, { termos: ['tech lead', 'líder técnico'] })], ctx());
  assert.deepEqual(vagas.map(v => v.requisicao_id).sort(), ['1', '4']);
});

test('solides: 500 repete uma vez e depois vira erro da fonte', async t => {
  const server = await solidesServer(t, {}, { status: 500 });
  const { fontes } = await runSources([solides(server)], ctx());
  assert.equal(fontes[0].estado, 'erro');
  assert.equal(server.requests.length, 2);
});

test('solides: sem data/count é estrutura_mudou; zero resultados não é erro', async t => {
  const quebrado = await startServer(t, (req, res) => json(res, { resultados: [] }));
  assert.equal((await runSources([solides(quebrado)], ctx())).fontes[0].codigo, 'estrutura_mudou');
  const vazio = await solidesServer(t, {});
  const result = await runSources([solides(vazio)], ctx());
  assert.equal(result.fontes[0].estado, 'ok');
  assert.equal(result.vagas.length, 0);
});
