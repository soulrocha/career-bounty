import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { STATUS, makeLegado } from '../fixtures/make-legado.mjs';
import { importPipeline } from '../../core/migration/import.mjs';
import { marcarCandidatura } from '../../core/store/commands/marcarCandidatura.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { CONFIRMED, MANUAL_STATUS } from '../../core/store/rules.mjs';

const NOW = '2026-10-14T22:00:00.000Z'; // 19h em São Paulo
const HOST = 'pc-a';

async function semeia(t, vagas) {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: vagas.length });
  const limpa = ({ candidatura_usuario, historico_marcacoes, descarte_usuario, historico_descartes, candidatura_email, candidatura_portal, ...resto }) => resto;
  pipeline.vagas = pipeline.vagas.map((vaga, i) => ({ ...limpa(vaga), ...vagas[i] }));
  await importPipeline({ dataRoot, pipeline, ts: '2026-10-14T12:00:00.000Z', host: HOST });
  return { dataRoot, ids: pipeline.vagas.map(v => v.id) };
}
const estado = async dataRoot => projectEvents((await readEvents(dataRoot)).eventos);
const contagem = async dataRoot => (await readEvents(dataRoot)).eventos.length;
const marca = (dataRoot, id, extra = {}) => marcarCandidatura({ dataRoot, id, aplicada: true, data: '2026-10-14', now: NOW, host: HOST, ...extra });

test('marcar com data válida grava evento e a projeção traz a candidatura do usuário', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'avaliada-sem-envio', comprovante: { preservar: true } }, { status: 'nova' }]);
  const before = await estado(dataRoot);
  const marker = await marca(dataRoot, ids[0]);
  assert.equal(marker.aplicada, true);
  assert.equal(marker.data, '2026-10-14');
  assert.equal(marker.origem, 'usuario-no-painel');
  assert.equal(marker.historico_confirmado, false);
  const { eventos } = await readEvents(dataRoot);
  const evento = eventos.find(e => e.tipo === 'candidatura.marcada');
  assert.equal(evento.entidade_id, ids[0]);
  const vaga = (await estado(dataRoot)).vagas[0];
  assert.deepEqual({ ...vaga.candidatura_usuario }, { aplicada: true, data: '2026-10-14', registrado_em: '2026-10-14T19:00:00.000-03:00', origem: 'usuario-no-painel', status_anterior: 'avaliada-sem-envio' });
  assert.equal(vaga.status, MANUAL_STATUS);
  assert.deepEqual(vaga.comprovante, { preservar: true });
  assert.deepEqual((await estado(dataRoot)).vagas[1], before.vagas[1]);
  assert.equal((await estado(dataRoot)).atualizado, '2026-10-14');
  assert.equal(JSON.parse(await readFile(path.join(dataRoot, 'projections/pipeline-vagas.json'), 'utf8')).vagas[0].candidatura_usuario.aplicada, true);
});

test('data futura é recusada sem gravar', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova' }]);
  const total = await contagem(dataRoot);
  await assert.rejects(marca(dataRoot, ids[0], { data: '2026-10-15' }), { code: 'invalido', message: /futura/ });
  assert.equal(await contagem(dataRoot), total);
});

test('datas inexistentes ou mal formadas são recusadas', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova' }]);
  for (const data of ['2026-02-30', '2026-13-01', '14/10/2026', '', undefined, null, '2026-10-14T10:00:00']) {
    await assert.rejects(marca(dataRoot, ids[0], { data }), { code: 'invalido' }, String(data));
  }
});

test('marcar vaga já candidatura-enviada-confirmada mantém o status', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'candidatura-enviada-confirmada' }]);
  const marker = await marca(dataRoot, ids[0]);
  assert.equal(marker.status, 'candidatura-enviada-confirmada');
  assert.equal((await estado(dataRoot)).vagas[0].status, 'candidatura-enviada-confirmada');
  assert.equal((await estado(dataRoot)).vagas[0].candidatura_usuario.aplicada, true);
});

test('desmarcar vaga com histórico confirmado é recusado e preserva o registro', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'candidatura-enviada-confirmada' }, { status: 'processo-seletivo-nao-avancou', candidatura_email: { aplicada: true, data: null, etapa: 'nao-avancou' } }]);
  for (const id of ids) {
    const total = await contagem(dataRoot);
    await assert.rejects(marcarCandidatura({ dataRoot, id, aplicada: false, now: NOW, host: HOST }), { code: 'invalido', message: /registro anterior confirmado foi preservado/ });
    assert.equal(await contagem(dataRoot), total);
  }
});

test('desmarcar marcação manual restaura o status anterior e mantém a auditoria', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'avaliada-sem-envio' }]);
  await marca(dataRoot, ids[0]);
  const marker = await marcarCandidatura({ dataRoot, id: ids[0], aplicada: false, now: '2026-10-14T23:00:00.000Z', host: HOST });
  assert.equal(marker.aplicada, false);
  assert.equal(marker.status, 'avaliada-sem-envio');
  const vaga = (await estado(dataRoot)).vagas[0];
  assert.equal(vaga.candidatura_usuario.aplicada, false);
  assert.equal(vaga.candidatura_usuario.data, null);
  assert.equal(vaga.historico_marcacoes.length, 2);
});

test('cada mudança acrescenta {antes, depois} em historico_marcacoes', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova', historico_marcacoes: [{ antigo: true }] }]);
  await marca(dataRoot, ids[0]);
  await marca(dataRoot, ids[0], { data: '2026-10-13', now: '2026-10-14T23:00:00.000Z' });
  const historico = (await estado(dataRoot)).vagas[0].historico_marcacoes;
  assert.equal(historico.length, 3);
  assert.deepEqual(historico[0], { antigo: true });
  assert.deepEqual(historico[1].antes, {});
  assert.equal(historico[1].depois.aplicada, true);
  assert.equal(historico[2].antes.data, '2026-10-14');
  assert.equal(historico[2].depois.data, '2026-10-13');
  assert.equal(historico[2].depois.status_anterior, 'nova');
});

test('vaga inexistente devolve erro de não encontrada', async t => {
  const { dataRoot } = await semeia(t, [{ status: 'nova' }]);
  await assert.rejects(marca(dataRoot, 'nao-existe'), { code: 'nao_encontrado' });
  await assert.rejects(marcarCandidatura({ dataRoot, id: 7, aplicada: true, data: '2026-10-14', now: NOW }), { code: 'invalido' });
  await assert.rejects(marcarCandidatura({ dataRoot, id: 'x', aplicada: 'sim', now: NOW }), { code: 'invalido' });
});

test('datas na virada de mês, de ano e em ano bissexto; o dia vale no fuso de São Paulo', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova' }]);
  const casos = [
    ['2026-10-15', '2026-10-15T02:30:00.000Z', false], // 23h30 de 14/10 em SP: 15/10 ainda é futuro
    ['2026-10-15', '2026-10-15T03:00:00.000Z', true], // meia-noite em SP
    ['2026-10-31', '2026-11-01T12:00:00.000Z', true],
    ['2025-12-31', '2027-01-01T12:00:00.000Z', true],
    ['2027-02-29', '2027-03-01T12:00:00.000Z', false],
    ['2028-02-29', '2028-03-01T12:00:00.000Z', true],
  ];
  for (const [data, now, ok] of casos) {
    const promessa = marca(dataRoot, ids[0], { data, now });
    if (ok) assert.equal((await promessa).data, data, `${data} @ ${now}`);
    else await assert.rejects(promessa, { code: 'invalido' }, `${data} @ ${now}`);
  }
});

test('para cada um dos 29 status do legado: marcar e desmarcar seguem a regra do legado', async t => {
  assert.equal(STATUS.length, 29);
  const { dataRoot, ids } = await semeia(t, STATUS.map(status => ({ status })));
  for (const [index, status] of STATUS.entries()) {
    const marker = await marca(dataRoot, ids[index]);
    assert.equal(marker.status, CONFIRMED.has(status) ? status : MANUAL_STATUS, status);
    const undo = marcarCandidatura({ dataRoot, id: ids[index], aplicada: false, now: NOW, host: HOST });
    if (CONFIRMED.has(status)) await assert.rejects(undo, { code: 'invalido' }, status);
    else assert.equal((await undo).status, status, status);
  }
});

test('duas marcações simultâneas em vagas diferentes não perdem nenhuma', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova' }, { status: 'nova' }]);
  await Promise.all(ids.map(id => marca(dataRoot, id)));
  assert.ok((await estado(dataRoot)).vagas.every(v => v.candidatura_usuario.aplicada));
});
