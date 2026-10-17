import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { cvDoPainel, gravarCv, lerManifesto, marcarEnviado } from '../../core/cv/artifacts.mjs';

const pacote = (versao, extra = {}) => ({
  vagaId: 'vaga-cv-01',
  versao,
  tipo: 'adaptado',
  payload: { versao: 1, vaga_id: 'vaga-cv-01', resumo: `resumo ${versao}` },
  arquivos: { 'cv-visual.html': '<html>v</html>', 'cv-visual.pdf': Buffer.from('%PDF-visual'), 'cv-ats.html': '<html>a</html>', 'cv-ats.pdf': Buffer.from('%PDF-ats') },
  gate: { status: 'ok', motivos: [], versao },
  ts: '2026-10-17T12:00:00.000Z',
  ...extra,
});
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const H3 = 'c'.repeat(64);

test('cada CV novo vai para artifacts/cv/<vaga>/<hash>/, sem tocar no anterior', async t => {
  const dataRoot = await tempDir(t);
  const um = await gravarCv(dataRoot, pacote(H1));
  const dois = await gravarCv(dataRoot, pacote(H2, { ts: '2026-10-18T12:00:00.000Z' }));
  const pasta = path.join(dataRoot, 'artifacts', 'cv', 'vaga-cv-01');
  assert.equal(um.pasta, path.join(pasta, H1));
  assert.equal(dois.pasta, path.join(pasta, H2));
  assert.deepEqual((await readdir(pasta)).sort(), [H1, H2, 'manifesto.json'].sort());
  assert.deepEqual((await readdir(um.pasta)).sort(), ['cv-ats.html', 'cv-ats.pdf', 'cv-visual.html', 'cv-visual.pdf', 'gate.json', 'payload.json']);
  assert.equal(await readFile(path.join(um.pasta, 'cv-visual.pdf'), 'latin1'), '%PDF-visual');
  assert.deepEqual(JSON.parse(await readFile(path.join(um.pasta, 'payload.json'), 'utf8')).resumo, `resumo ${H1}`);
});

test('vaga com id inválido para pasta é recusada; hash precisa ser sha256', async t => {
  const dataRoot = await tempDir(t);
  await assert.rejects(gravarCv(dataRoot, pacote(H1, { vagaId: '../fora' })), /id de vaga/);
  await assert.rejects(gravarCv(dataRoot, pacote('abc')), /versão/);
});

test('o CV anexado a uma candidatura enviada fica imutável', async t => {
  const dataRoot = await tempDir(t);
  await gravarCv(dataRoot, pacote(H1));
  await marcarEnviado(dataRoot, { vagaId: 'vaga-cv-01', versao: H1, ts: '2026-10-17T13:00:00.000Z' });
  const outro = pacote(H1, { arquivos: { ...pacote(H1).arquivos, 'cv-visual.pdf': Buffer.from('%PDF-outro') } });
  await assert.rejects(gravarCv(dataRoot, outro), /enviado.*imutável/);
  const pasta = path.join(dataRoot, 'artifacts', 'cv', 'vaga-cv-01', H1);
  assert.equal(await readFile(path.join(pasta, 'cv-visual.pdf'), 'latin1'), '%PDF-visual');
  // Os arquivos do enviado ficam somente leitura no disco.
  assert.equal((await stat(path.join(pasta, 'cv-visual.pdf'))).mode & 0o222, 0);
  // Marcar enviado uma versão que não existe falha.
  await assert.rejects(marcarEnviado(dataRoot, { vagaId: 'vaga-cv-01', versao: H2, ts: '2026-10-17T13:00:00.000Z' }), /não existe/);
});

test('versão ainda não enviada pode ser regravada (mesmo hash, sem duplicar no manifesto)', async t => {
  const dataRoot = await tempDir(t);
  await gravarCv(dataRoot, pacote(H1));
  await gravarCv(dataRoot, pacote(H1, { arquivos: { ...pacote(H1).arquivos, 'cv-visual.pdf': Buffer.from('%PDF-novo') } }));
  const manifesto = await lerManifesto(dataRoot, 'vaga-cv-01');
  assert.equal(manifesto.versoes.length, 1);
  assert.equal(await readFile(path.join(dataRoot, 'artifacts', 'cv', 'vaga-cv-01', H1, 'cv-visual.pdf'), 'latin1'), '%PDF-novo');
});

test('o manifesto lista data, hash, tipo e gate de cada versão', async t => {
  const dataRoot = await tempDir(t);
  await gravarCv(dataRoot, pacote(H1));
  await gravarCv(dataRoot, pacote(H2, { ts: '2026-10-18T12:00:00.000Z', gate: { status: 'bloqueado', motivos: [{ codigo: 'numero_orfao', motivo: 'resumo: número 99% sem afirmação' }], versao: H2 } }));
  const manifesto = await lerManifesto(dataRoot, 'vaga-cv-01');
  assert.equal(manifesto.vaga_id, 'vaga-cv-01');
  assert.deepEqual(manifesto.versoes.map(v => [v.hash, v.gerado_em, v.tipo, v.gate.status]), [
    [H1, '2026-10-17T12:00:00.000Z', 'adaptado', 'ok'],
    [H2, '2026-10-18T12:00:00.000Z', 'adaptado', 'bloqueado'],
  ]);
  assert.deepEqual(manifesto.versoes[1].gate.motivos, ['resumo: número 99% sem afirmação']);
  assert.equal(manifesto.enviado, null);
  assert.equal(await lerManifesto(dataRoot, 'vaga-sem-cv'), null);
});

test('o painel aponta para o CV aprovado mais novo e mantém o link do enviado', async t => {
  const dataRoot = await tempDir(t);
  await gravarCv(dataRoot, pacote(H1));
  await marcarEnviado(dataRoot, { vagaId: 'vaga-cv-01', versao: H1, ts: '2026-10-17T13:00:00.000Z' });
  await gravarCv(dataRoot, pacote(H2, { ts: '2026-10-18T12:00:00.000Z' }));
  await gravarCv(dataRoot, pacote(H3, { ts: '2026-10-19T12:00:00.000Z', gate: { status: 'bloqueado', motivos: [{ codigo: 'x', motivo: 'm' }], versao: H3 } }));
  const painel = cvDoPainel(await lerManifesto(dataRoot, 'vaga-cv-01'));
  assert.equal(painel.atual.hash, H2);
  assert.equal(painel.atual.ats, `artifacts/cv/vaga-cv-01/${H2}/cv-ats.pdf`);
  assert.equal(painel.atual.visual, `artifacts/cv/vaga-cv-01/${H2}/cv-visual.pdf`);
  assert.equal(painel.enviado.hash, H1);
  assert.equal(painel.enviado.ats, `artifacts/cv/vaga-cv-01/${H1}/cv-ats.pdf`);
  // A última versão está bloqueada: o painel mostra o motivo, mas continua oferecendo a aprovada anterior.
  assert.deepEqual(painel.bloqueio, { hash: H3, motivos: ['m'] });
  assert.equal(cvDoPainel(null), null);
});
