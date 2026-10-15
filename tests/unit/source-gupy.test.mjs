import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { json, startServer } from '../helpers/http-server.mjs';
import { runSources } from '../../core/sources/index.mjs';
import { createGupy } from '../../core/sources/gupy.mjs';

const dataset = JSON.parse(await readFile(new URL('../replay/http/gupy/dataset.json', import.meta.url), 'utf8'));
const ctx = { janela: { inicio: '2026-10-08', fim: '2026-10-15' }, plano: { termos: [] }, config: {}, now: new Date('2026-10-15T21:00:00Z') };
const semEspera = { sleep: async () => {} };

function gupyServer(t, { falhar } = {}) {
  return startServer(t, (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (falhar) return json(res, falhar.corpo ?? { erro: true }, falhar.status ?? 200);
    const nome = (url.searchParams.get('jobName') ?? '').toLowerCase();
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset'));
    const todas = dataset.filter(item => item.name.toLowerCase().includes(nome));
    return json(res, { data: todas.slice(offset, offset + limit), pagination: { total: limit, offset, limit } });
  });
}

const fonte = (server, config = {}) => createGupy({ base_url: `${server.base}/api/job-search/jobs`, pagina: 3, espera_ms: 0, termos: ['Tech Lead', 'Gerente de Engenharia'], ...config }, semEspera);

test('varre cada termo, mapeia os campos e filtra pela janela de dias', async t => {
  const server = await gupyServer(t);
  const { vagas, fontes } = await runSources([fonte(server)], ctx);
  assert.equal(fontes[0].estado, 'ok');
  assert.deepEqual(vagas.map(v => v.requisicao_id).sort(), ['7000001', '7000002', '7000007']);
  const alta = vagas.find(v => v.requisicao_id === '7000002');
  assert.equal(alta.portal, 'gupy');
  assert.equal(alta.empresa, 'Empresa Beta');
  assert.equal(alta.cargo, 'Tech Lead Backend');
  assert.equal(alta.modalidade, 'remoto');
  assert.equal(alta.publicado_em, '2026-10-13');
  assert.equal(alta.local, 'Belo Horizonte, Minas Gerais');
  assert.equal(alta.url, 'https://empresa-alfa.gupy.io/jobs/7000002');
  server.assertSemCredenciais();
});

test('descarta vaga confidencial e URL fora de gupy.io', async t => {
  const server = await gupyServer(t);
  const { vagas } = await runSources([fonte(server, { termos: ['Coordenador', 'Gerente de Produto', 'Líder'] })], ctx);
  assert.deepEqual(vagas, []);
});

test('para quando a página volta curta e quando a página passa da janela', async t => {
  const server = await gupyServer(t);
  await runSources([fonte(server, { termos: ['Gerente de Engenharia'], pagina: 2 })], ctx);
  assert.equal(server.requests.length, 2, 'página cheia, depois página curta');
  server.requests.length = 0;
  await runSources([fonte(server, { termos: ['Tech Lead'], pagina: 2 })], ctx);
  assert.equal(server.requests.length, 1, 'a primeira página já passou da janela');
});

test('mesma vaga achada por dois termos aparece uma vez', async t => {
  const server = await gupyServer(t);
  const { vagas } = await runSources([fonte(server, { termos: ['Gerente', 'Engenharia'] })], ctx);
  assert.equal(vagas.filter(v => v.requisicao_id === '7000001').length, 1);
});

test('o orçamento de páginas conta tentativas no total da chamada', async t => {
  const server = await gupyServer(t);
  await runSources([fonte(server, { termos: ['Tech Lead', 'Gerente', 'Engenharia', 'Líder'], max_paginas: 2 })], ctx);
  assert.equal(server.requests.length, 2);
});

test('429 repete com espera limitada e depois vira erro da fonte', async t => {
  const server = await gupyServer(t, { falhar: { status: 429 } });
  const esperas = [];
  const source = createGupy({ base_url: `${server.base}/api/job-search/jobs`, termos: ['Tech Lead'], espera_ms: 0, tentativas: 2 }, { sleep: async ms => esperas.push(ms) });
  const { fontes } = await runSources([source], ctx);
  assert.equal(fontes[0].estado, 'erro');
  assert.equal(fontes[0].codigo, 'limite');
  assert.equal(server.requests.length, 3, '1 tentativa + 2 repetições');
  assert.ok(esperas.length >= 2 && esperas.every(ms => ms <= 4000));
});

test('uma varredura que falha não derruba as outras: resultado parcial com aviso', async t => {
  let chamadas = 0;
  const server = await startServer(t, (req, res) => {
    chamadas += 1;
    if (new URL(req.url, 'http://x').searchParams.get('jobName') === 'ruim') return json(res, {}, 500);
    return json(res, { data: dataset.slice(0, 2), pagination: { total: 2, offset: 0, limit: 3 } });
  });
  const { vagas, fontes } = await runSources([fonte(server, { termos: ['ruim', 'bom'], tentativas: 0 })], ctx);
  assert.equal(fontes[0].estado, 'ok');
  assert.ok(vagas.length >= 1);
  assert.match(fontes[0].avisos.join(' '), /ruim/);
  assert.ok(chamadas >= 2);
});

test('estrutura inesperada é erro nomeado, nunca lista vazia', async t => {
  const server = await gupyServer(t, { falhar: { status: 200, corpo: { items: [] } } });
  const { fontes } = await runSources([fonte(server)], ctx);
  assert.equal(fontes[0].codigo, 'estrutura_mudou');
});

test('data vazia é resultado legítimo, não erro', async t => {
  const server = await gupyServer(t, { falhar: { corpo: { data: [], pagination: { total: 0 } } } });
  const { fontes } = await runSources([fonte(server)], ctx);
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(fontes[0].vagas, 0);
});

test('recusa endereço de API fora do portal ou do loopback', () => {
  assert.throws(() => createGupy({ base_url: 'https://evil.example/api' }), /host/);
});
