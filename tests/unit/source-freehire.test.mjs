import assert from 'node:assert/strict';
import test from 'node:test';
import { json, startServer } from '../helpers/http-server.mjs';
import { runSources } from '../../core/sources/index.mjs';
import { createFreehire } from '../../core/sources/freehire.mjs';

const ctx = { janela: { inicio: '2026-10-08', fim: '2026-10-15' }, plano: { termos: [] }, config: {}, now: new Date('2026-10-15T21:00:00Z') };
const semEspera = { sleep: async () => {} };

const item = (n, extra = {}) => ({ public_slug: `empresa-alfa-vaga-${n}`, source: 'greenhouse', external_id: String(n), url: `https://boards.exemplo.test/empresa-alfa/${n}`,
  title: `Tech Manager ${n}`, company: 'Empresa Alfa', company_slug: 'empresa-alfa', location: 'Brasil', description: null, skills: [], work_mode: 'remote',
  regions: [], countries: ['BR'], cities: [], posted_at: '2026-10-14T10:00:00Z', created_at: null, enrichment: {}, ...extra });

// Catálogo por consulta: q -> lista completa; o servidor fatia por offset/limit.
function freehireServer(t, catalogo, { status } = {}) {
  return startServer(t, (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (status) return json(res, { error: 'x' }, status);
    const todas = catalogo[url.searchParams.get('q')] ?? [];
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return json(res, { data: todas.slice(offset, offset + limit), meta: { total: todas.length, limit, offset } });
  });
}

const fonte = (server, config = {}) => createFreehire({ base_url: server.base, termos: ['tech manager'], espera_ms: 0, ...config }, semEspera);

test('pagina até a página vir vazia ou curta e usa país, janela e limite 20', async t => {
  const server = await freehireServer(t, { 'tech manager': Array.from({ length: 25 }, (_, i) => item(i + 1)) });
  const { vagas, fontes } = await runSources([fonte(server)], ctx);
  assert.equal(vagas.length, 25);
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(server.requests.length, 2, 'página cheia de 20 e página curta de 5');
  const query = new URL(server.requests[0].url, 'http://x').searchParams;
  assert.equal(query.get('limit'), '20');
  assert.equal(query.get('offset'), '0');
  assert.equal(query.get('countries'), 'BR');
  assert.equal(query.get('posted_within_days'), '7');
  assert.equal(new URL(server.requests[1].url, 'http://x').searchParams.get('offset'), '20');
});

test('no máximo 3 páginas por consulta', async t => {
  const server = await freehireServer(t, { 'tech manager': Array.from({ length: 200 }, (_, i) => item(i + 1)) });
  const { vagas } = await runSources([fonte(server)], ctx);
  assert.equal(server.requests.length, 3);
  assert.equal(vagas.length, 60);
});

test('página repetida encerra a varredura', async t => {
  const repetida = Array.from({ length: 20 }, (_, i) => item(i + 1));
  const server = await startServer(t, (req, res) => json(res, { data: repetida, meta: { total: 99 } }));
  const { vagas } = await runSources([fonte(server)], ctx);
  assert.equal(server.requests.length, 2);
  assert.equal(vagas.length, 20);
});

test('429 e 5xx repetem com espera limitada e depois viram erro da fonte', async t => {
  const server = await freehireServer(t, {}, { status: 503 });
  const esperas = [];
  const source = createFreehire({ base_url: server.base, termos: ['x'], tentativas: 2 }, { sleep: async ms => esperas.push(ms) });
  const { fontes } = await runSources([source], ctx);
  assert.equal(fontes[0].estado, 'erro');
  assert.equal(server.requests.length, 3);
  assert.ok(esperas.length >= 2 && esperas.every(ms => ms <= 4000));
});

test('a mesma vaga em duas consultas aparece uma vez', async t => {
  const comum = item(1);
  const server = await freehireServer(t, { 'tech manager': [comum, item(2)], 'engineering manager': [comum, item(3)] });
  const { vagas } = await runSources([fonte(server, { termos: ['tech manager', 'engineering manager'] })], ctx);
  assert.equal(vagas.length, 3);
});

test('data ausente mantém a vaga sem data', async t => {
  const server = await freehireServer(t, { 'tech manager': [item(1, { posted_at: null })] });
  const { vagas } = await runSources([fonte(server)], ctx);
  assert.equal(vagas.length, 1);
  assert.equal(vagas[0].publicado_em, null);
});

test('vaga publicada antes da janela é descartada', async t => {
  const server = await freehireServer(t, { 'tech manager': [item(1), item(2, { posted_at: '2026-09-01T00:00:00Z' })] });
  const { vagas } = await runSources([fonte(server)], ctx);
  assert.equal(vagas.length, 1);
});

test('nenhuma requisição leva cookie ou credencial', async t => {
  const server = await freehireServer(t, { 'tech manager': [item(1)] });
  await runSources([fonte(server)], ctx);
  server.assertSemCredenciais();
});

test('resposta sem data[] é estrutura_mudou', async t => {
  const server = await startServer(t, (req, res) => json(res, { items: [] }));
  const { fontes } = await runSources([fonte(server)], ctx);
  assert.equal(fontes[0].codigo, 'estrutura_mudou');
});
