import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { startServer } from '../helpers/http-server.mjs';
import { runSources } from '../../core/sources/index.mjs';
import { createLinkedinGuest, parseSearch } from '../../core/sources/linkedinGuest.mjs';
import { createBudget } from '../../core/sources/budget.mjs';
import { loadSettings, validateSettings } from '../../core/config.mjs';

const html = await readFile(new URL('../replay/http/linkedin/busca-1.html', import.meta.url), 'utf8');
const desafio = await readFile(new URL('../replay/http/linkedin/desafio.html', import.meta.url), 'utf8');
const now = new Date('2026-10-15T21:00:00Z');
const ctx = dataRoot => ({ janela: { inicio: '2026-10-08', fim: '2026-10-15' }, dataRoot, plano: { termos: [] }, config: {}, now });
const ligado = (server, extra = {}) => ({ ativo: true, aceite_termos: true, base_url: server.base, termos: ['tech lead'], espera_s: [0, 0], ...extra });
const semEspera = { sleep: async () => {}, random: () => 0 };

const servidorHtml = (t, corpo = html, status = 200) => startServer(t, (req, res) => { res.statusCode = status; res.setHeader('content-type', 'text/html'); res.end(corpo); });

test('config padrão: zero requisição ao LinkedIn', async t => {
  const dataRoot = await tempDir(t);
  const server = await servidorHtml(t);
  const padrao = (await loadSettings({ dataRoot })).fontes.linkedin_guest;
  const { fontes } = await runSources([createLinkedinGuest({ ...padrao, base_url: server.base }, semEspera)], ctx(dataRoot));
  assert.equal(fontes[0].estado, 'desligada');
  assert.equal(server.requests.length, 0);
});

test('ligar exige aceite_termos no mesmo bloco do config pessoal', () => {
  assert.throws(() => validateSettings({ fontes: { linkedin_guest: { ativo: true } } }), /aceite_termos/);
  const ok = validateSettings({ fontes: { linkedin_guest: { ativo: true, aceite_termos: true, termos: ['a'] } } });
  assert.deepEqual(ok.fontes.linkedin_guest.termos, ['a']);
});

test('parseSearch extrai id, cargo, empresa, local e data e remove o rastreio da URL', () => {
  const cards = parseSearch(html);
  assert.equal(cards.length, 3);
  assert.equal(cards[0].requisicao_id, '4400000001');
  assert.equal(cards[0].empresa, 'Empresa Alfa');
  assert.equal(cards[0].local, 'São Paulo, SP');
  assert.equal(cards[0].publicado_em, '2026-10-14');
  assert.ok(!cards[0].url.includes('?'), cards[0].url);
  assert.equal(cards[2].publicado_em, null);
  assert.ok(cards.every(c => c.aparicao === true && c.portal === 'linkedin'));
});

test('sem cookie nem Authorization; resultado vem como aparição', async t => {
  const dataRoot = await tempDir(t);
  const server = await servidorHtml(t);
  const { vagas, fontes } = await runSources([createLinkedinGuest(ligado(server), semEspera)], ctx(dataRoot));
  assert.equal(fontes[0].estado, 'ok');
  assert.equal(vagas.length, 3);
  assert.ok(vagas.every(v => v.aparicao === true));
  server.assertSemCredenciais();
  assert.equal(server.requests[0].headers['accept'], 'text/html');
});

test('a 11ª chamada do dia é recusada sem tocar a rede e o contador persiste', async t => {
  const dataRoot = await tempDir(t);
  const server = await servidorHtml(t);
  const termos = Array.from({ length: 12 }, (_, i) => `termo ${i}`);
  const { fontes } = await runSources([createLinkedinGuest(ligado(server, { termos }), semEspera)], ctx(dataRoot));
  assert.equal(server.requests.length, 10);
  assert.match(fontes[0].avisos.join(' '), /orçamento/);
  const outra = await runSources([createLinkedinGuest(ligado(server, { termos }), semEspera)], ctx(dataRoot));
  assert.equal(server.requests.length, 10, 'segunda execução no mesmo dia não gasta nada');
  assert.equal(outra.vagas.length, 0);
});

test('o teto de 10 vale mesmo que a config peça mais', async t => {
  const dataRoot = await tempDir(t);
  const server = await servidorHtml(t);
  const termos = Array.from({ length: 15 }, (_, i) => `termo ${i}`);
  await runSources([createLinkedinGuest(ligado(server, { termos, orcamento_diario: 50 }), semEspera)], ctx(dataRoot));
  assert.equal(server.requests.length, 10);
});

test('o contador zera na virada do dia local', async t => {
  const dataRoot = await tempDir(t);
  const noite = new Date('2026-10-16T02:30:00Z'); // 23h30 de 15/10 em São Paulo
  const manha = new Date('2026-10-16T12:00:00Z'); // 16/10
  const antes = createBudget({ dataRoot, nome: 'x', limite: 2, now: noite });
  assert.equal(await antes.consume(), true);
  assert.equal(await antes.consume(), true);
  assert.equal(await antes.consume(), false);
  const depois = createBudget({ dataRoot, nome: 'x', limite: 2, now: manha });
  assert.equal(await depois.consume(), true);
});

test('429 para a fonte pelo resto do dia e vira erro de bloqueio', async t => {
  const dataRoot = await tempDir(t);
  const server = await servidorHtml(t, desafio, 429);
  const primeira = await runSources([createLinkedinGuest(ligado(server, { termos: ['a', 'b'] }), semEspera)], ctx(dataRoot));
  assert.equal(primeira.fontes[0].codigo, 'bloqueio');
  assert.equal(server.requests.length, 1, 'não insiste no mesmo dia');
  const segunda = await runSources([createLinkedinGuest(ligado(server), semEspera)], ctx(dataRoot));
  assert.equal(segunda.fontes[0].codigo, 'bloqueio');
  assert.equal(server.requests.length, 1);
});

test('desafio anti-bot com HTTP 200 também bloqueia, sem tentar resolver', async t => {
  const dataRoot = await tempDir(t);
  const server = await servidorHtml(t, desafio, 200);
  const { fontes } = await runSources([createLinkedinGuest(ligado(server), semEspera)], ctx(dataRoot));
  assert.equal(fontes[0].codigo, 'bloqueio');
  assert.equal(server.requests.length, 1);
});

test('collect pela CLI com a config padrão não registra requisição nem erro', async t => {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ radar: { termos: ['x'] } }));
  const { json, status } = run(['collect', '--dry-run', '--json', '--source', 'linkedin_guest'], { dataRoot });
  assert.equal(status, 0);
  assert.equal(json.fontes[0].estado, 'desligada');
});
