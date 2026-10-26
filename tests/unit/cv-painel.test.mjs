import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { encontrarNavegador } from '../../core/cv/navegador.mjs';
import { cabecalhoDownloadCv, gravarCv, nomeArquivoCv } from '../../core/cv/artifacts.mjs';
import { cvsDoPainel, renderPainel } from '../../panel/render.mjs';
import { PUBLIC_TEMPLATE } from '../../panel/template.mjs';
import { startPanel } from '../../panel/server.mjs';

const navegador = encontrarNavegador();
const semNavegador = navegador ? false : 'nenhum Chrome, Chromium ou Edge instalado (CAREER_BOUNTY_BROWSER)';

// DOM depois do JS do painel montar os cards (o template monta tudo no navegador).
async function domDe(html) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cb-dom-'));
  try {
    const arquivo = path.join(dir, 'painel.html');
    await writeFile(arquivo, html, 'utf8');
    const args = ['--headless=new', '--edge-skip-compat-layer-relaunch', '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${path.join(dir, 'perfil')}`, '--dump-dom', pathToFileURL(arquivo).href];
    if (process.platform === 'linux') args.unshift('--no-sandbox');
    return spawnSync(navegador, args, { encoding: 'utf8', timeout: 60000, windowsHide: true }).stdout;
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); }
}
const card = (dom, id) => dom.match(new RegExp(`<article class="card[^"]*" data-vaga-id="${id}">[\\s\\S]*?</article>`))?.[0] ?? '';

const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const H3 = '3'.repeat(64);
const vagaDe = (id, extra = {}) => ({ id, empresa: `Empresa ${id.slice(-2)}`, cargo: 'Gerente de Produto', url: `https://vagas.exemplo.test/${id}`, aderencia: 'alta', url_status: 'aberta', status: 'avaliada-sem-envio', modalidade: 'Remoto', local: 'Brasil', ...extra });
const links = (vaga, hash) => ({ hash, tipo: 'adaptado', gerado_em: '2026-10-17T12:00:00.000Z', ats: `artifacts/cv/${vaga}/${hash}/cv-ats.pdf`, visual: `artifacts/cv/${vaga}/${hash}/cv-visual.pdf` });

async function painel() {
  const projecao = { schema_version: 1, atualizado: '2026-10-17', vagas: [
    vagaDe('vaga-cv-01'),
    vagaDe('vaga-cv-02', { aderencia: 'media' }),
    vagaDe('vaga-cv-04', { cv_gate: { status: 'bloqueado', motivos: [{ codigo: 'numero_orfao', motivo: 'resumo: número 99% sem afirmação que o sustente' }], versao: H3, tipo_cv: 'adaptado', aprovada: null } }),
  ] };
  const cvs = {
    'vaga-cv-01': { atual: links('vaga-cv-01', H2), enviado: { ...links('vaga-cv-01', H1), registrado_em: '2026-10-16T12:00:00.000Z' }, bloqueio: null },
    'vaga-cv-02': { atual: { ...links('vaga-cv-02', H1), tipo: 'base' }, enviado: null, bloqueio: null },
    'vaga-cv-04': { atual: null, enviado: null, bloqueio: { hash: H3, motivos: ['resumo: número 99% sem afirmação que o sustente'] } },
  };
  return domDe(renderPainel(projecao, { template: await readFile(PUBLIC_TEMPLATE, 'utf8'), cvs, hoje: '2026-10-17' }));
}

test('a linha da vaga mostra "PDF para enviar" (ATS), "PDF visual" e o PDF enviado', { skip: semNavegador }, async () => {
  const c = card(await painel(), 'vaga-cv-01');
  assert.ok(c, 'card da vaga');
  assert.match(c, new RegExp(`<a href="/artifacts/cv/vaga-cv-01/${H2}/cv-ats.pdf"[^>]*>PDF para enviar</a>`));
  assert.match(c, new RegExp(`<a href="/artifacts/cv/vaga-cv-01/${H2}/cv-visual.pdf"[^>]*>PDF visual</a>`));
  assert.match(c, new RegExp(`<a href="/artifacts/cv/vaga-cv-01/${H1}/cv-ats.pdf"[^>]*>PDF enviado</a>`));
  assert.doesNotMatch(c, /CV bloqueado/);
});

test('vaga com CV bloqueado mostra o motivo e nenhum PDF', { skip: semNavegador }, async () => {
  const c = card(await painel(), 'vaga-cv-04');
  assert.match(c, /CV bloqueado:<\/strong> resumo: número 99% sem afirmação que o sustente/);
  assert.doesNotMatch(c, /PDF/);
});

test('vaga sem adaptação mostra "PDF-base", sem prometer adaptação', { skip: semNavegador }, async () => {
  const c = card(await painel(), 'vaga-cv-02');
  assert.match(c, />PDF-base para enviar<\/a>/);
  assert.match(c, />PDF-base visual<\/a>/);
  assert.doesNotMatch(c, />PDF para enviar</);
  assert.doesNotMatch(c, /adaptad/i);
});

test('o painel lê o CV de cada vaga dos manifestos', async t => {
  const dataRoot = await tempDir(t);
  const gate = { status: 'ok', motivos: [], versao: H1 };
  await gravarCv(dataRoot, { vagaId: 'vaga-cv-01', versao: H1, tipo: 'base', payload: {}, gate, ts: '2026-10-17T12:00:00.000Z',
    arquivos: { 'cv-visual.html': 'v', 'cv-visual.pdf': Buffer.from('%PDF-v'), 'cv-ats.html': 'a', 'cv-ats.pdf': Buffer.from('%PDF-a') } });
  const cvs = await cvsDoPainel({ vagas: [vagaDe('vaga-cv-01'), vagaDe('vaga-sem-cv'), { id: '../fora' }] }, dataRoot);
  assert.deepEqual(Object.keys(cvs), ['vaga-cv-01']);
  assert.equal(cvs['vaga-cv-01'].atual.ats, `artifacts/cv/vaga-cv-01/${H1}/cv-ats.pdf`);
});

test('o servidor só entrega PDFs de CV listados no manifesto (path traversal bloqueado)', async t => {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const pipeline = makeLegado({ vagas: 2 });
  const arquivo = path.join(origem, 'pipeline-vagas.json');
  await writeFile(arquivo, JSON.stringify(pipeline));
  assert.equal(run(['migrate', '--from', arquivo, '--json'], { dataRoot }).status, 0);
  const estado = path.join(dataRoot, 'state/migration.json');
  await writeFile(estado, JSON.stringify({ ...JSON.parse(await readFile(estado, 'utf8')), mode: 'ativo' }));
  const vagaId = pipeline.vagas[0].id;
  await gravarCv(dataRoot, { vagaId, versao: H1, tipo: 'adaptado', payload: {}, gate: { status: 'ok', motivos: [], versao: H1 }, ts: '2026-10-17T12:00:00.000Z',
    arquivos: { 'cv-visual.html': 'v', 'cv-visual.pdf': Buffer.from('%PDF-visual'), 'cv-ats.html': 'a', 'cv-ats.pdf': Buffer.from('%PDF-ats') } });
  const panel = await startPanel({ dataRoot, port: 0, now: () => new Date().toISOString(), hostId: 'pc-a' });
  t.after(panel.close);
  const get = rota => fetch(`${panel.url}${rota}`);

  const ok = await get(`/artifacts/cv/${vagaId}/${H1}/cv-ats.pdf`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.equal(await ok.text(), '%PDF-ats');
  assert.equal((await get(`/artifacts/cv/${vagaId}/${H1}/cv-visual.pdf`)).status, 200);

  // Ao salvar, o nome sugerido é Empresa-Vaga-Nome, com o nome do perfil de CV privado.
  await mkdir(path.join(dataRoot, 'cv'), { recursive: true });
  await writeFile(path.join(dataRoot, 'cv/perfil.json'), JSON.stringify({ nome_arquivo: 'Ana Exemplo', cabecalho: { nome: 'Ana Maria Exemplo' } }));
  const vaga = pipeline.vagas[0];
  const esperado = nomeArquivoCv({ empresa: vaga.empresa, cargo: vaga.cargo, nome: 'Ana Exemplo', tipo: 'ats' });
  assert.match(esperado, /-Ana Exemplo\.pdf$/);
  assert.equal((await get(`/artifacts/cv/${vagaId}/${H1}/cv-ats.pdf`)).headers.get('content-disposition'), cabecalhoDownloadCv(esperado));
  assert.match((await get(`/artifacts/cv/${vagaId}/${H1}/cv-visual.pdf`)).headers.get('content-disposition'), /Ana%20Exemplo%20%28visual%29\.pdf$/);

  for (const rota of [
    `/artifacts/cv/${vagaId}/${H2}/cv-ats.pdf`, // versão fora do manifesto
    `/artifacts/cv/${vagaId}/${H1}/payload.json`, // arquivo que não é PDF servível
    `/artifacts/cv/${vagaId}/${H1}/cv-visual.html`,
    `/artifacts/cv/${vagaId}/manifesto.json`,
    `/artifacts/cv/outra-vaga/${H1}/cv-ats.pdf`,
    '/artifacts/cv/../state/migration.json',
    '/artifacts/cv/%2e%2e/%2e%2e/state/migration.json',
    `/artifacts/cv/${vagaId}/${H1}/..%2f..%2f..%2fstate%2fmigration.json`,
  ]) {
    const r = await get(rota);
    assert.equal(r.status, 404, rota);
    assert.doesNotMatch(await r.text(), /version|mode|%PDF/, rota);
  }
});
