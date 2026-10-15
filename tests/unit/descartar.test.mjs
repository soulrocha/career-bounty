import assert from 'node:assert/strict';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { importPipeline } from '../../core/migration/import.mjs';
import { descartar } from '../../core/store/commands/descartar.mjs';
import { marcarCandidatura } from '../../core/store/commands/marcarCandidatura.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';

const NOW = '2026-10-14T22:00:00.000Z';
const HOST = 'pc-a';

async function semeia(t, vagas, { depois } = {}) {
  const dataRoot = await tempDir(t);
  const pipeline = makeLegado({ vagas: vagas.length });
  const limpa = ({ candidatura_usuario, historico_marcacoes, descarte_usuario, historico_descartes, requisicao_id, id_requisicao, ...resto }) => resto;
  pipeline.vagas = pipeline.vagas.map((vaga, i) => ({ ...limpa(vaga), ...vagas[i] }));
  await importPipeline({ dataRoot, pipeline, ts: '2026-10-14T12:00:00.000Z', host: HOST });
  return { dataRoot, pipeline, ids: pipeline.vagas.map(v => v.id) };
}
const estado = async dataRoot => projectEvents((await readEvents(dataRoot)).eventos);

test('descartar grava descarte_usuario e acrescenta em historico_descartes', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova' }]);
  const marker = await descartar({ dataRoot, id: ids[0], descartada: true, now: NOW, host: HOST });
  assert.equal(marker.descartada, true);
  const vaga = (await estado(dataRoot)).vagas[0];
  assert.deepEqual(vaga.descarte_usuario, { descartada: true, registrado_em: '2026-10-14T19:00:00.000-03:00', origem: 'usuario-no-painel' });
  assert.deepEqual(vaga.historico_descartes, [{ antes: {}, depois: vaga.descarte_usuario }]);
  const { eventos } = await readEvents(dataRoot);
  assert.equal(eventos.filter(e => e.tipo === 'vaga.descartada').length, 1);
});

test('restaurar volta a descartada:false e mantém a auditoria', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova' }]);
  await descartar({ dataRoot, id: ids[0], descartada: true, now: NOW, host: HOST });
  const marker = await descartar({ dataRoot, id: ids[0], descartada: false, now: '2026-10-14T23:00:00.000Z', host: HOST });
  assert.equal(marker.descartada, false);
  const vaga = (await estado(dataRoot)).vagas[0];
  assert.equal(vaga.descarte_usuario.descartada, false);
  assert.equal(vaga.historico_descartes.length, 2);
  assert.equal(vaga.historico_descartes[1].antes.descartada, true);
});

test('descarte não remove comprovante_envio nem candidatura_usuario', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'avaliada-sem-envio', comprovante_envio: { arquivo: 'recibo.pdf' } }]);
  await marcarCandidatura({ dataRoot, id: ids[0], aplicada: true, data: '2026-10-14', now: NOW, host: HOST });
  const marker = await descartar({ dataRoot, id: ids[0], descartada: true, now: '2026-10-14T23:00:00.000Z', host: HOST });
  assert.equal(marker.descartada, true);
  assert.equal(marker.aplicada, true);
  const vaga = (await estado(dataRoot)).vagas[0];
  assert.deepEqual(vaga.comprovante_envio, { arquivo: 'recibo.pdf' });
  assert.equal(vaga.candidatura_usuario.aplicada, true);
  await descartar({ dataRoot, id: ids[0], descartada: false, now: '2026-10-15T01:00:00.000Z', host: HOST });
  assert.equal((await estado(dataRoot)).vagas[0].candidatura_usuario.aplicada, true);
});

test('vaga reimportada com novo id mas mesma requisição continua descartada', async t => {
  const { dataRoot, pipeline, ids } = await semeia(t, [{ status: 'nova', requisicao_id: 5551234 }]);
  await descartar({ dataRoot, id: ids[0], descartada: true, now: NOW, host: HOST });
  const republicada = { ...structuredClone(pipeline.vagas[0]), id: 'empresa-alfa-republicada', url: 'https://vagas.exemplo.test/jobs/outro-endereco', status: 'nova' };
  delete republicada.descarte_usuario;
  delete republicada.historico_descartes;
  const novo = { ...pipeline, vagas: [...pipeline.vagas, republicada] };
  await importPipeline({ dataRoot, pipeline: novo, ts: '2026-10-15T12:00:00.000Z', host: HOST });
  const vagas = (await estado(dataRoot)).vagas;
  assert.equal(vagas.find(v => v.id === 'empresa-alfa-republicada').descarte_usuario.descartada, true);
  // restaurar a original libera a republicação
  await descartar({ dataRoot, id: ids[0], descartada: false, now: '2026-10-15T13:00:00.000Z', host: HOST });
  assert.ok(!(await estado(dataRoot)).vagas.find(v => v.id === 'empresa-alfa-republicada').descarte_usuario?.descartada);
});

test('vaga com outra requisição não é afetada pelo descarte', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova', requisicao_id: 1 }, { status: 'nova', requisicao_id: 2 }, { status: 'nova' }]);
  await descartar({ dataRoot, id: ids[0], descartada: true, now: NOW, host: HOST });
  const vagas = (await estado(dataRoot)).vagas;
  assert.equal(Boolean(vagas[1].descarte_usuario), false);
  assert.equal(Boolean(vagas[2].descarte_usuario), false);
});

test('tipo inválido em descartada e vaga inexistente devolvem erro sem gravar', async t => {
  const { dataRoot, ids } = await semeia(t, [{ status: 'nova' }]);
  const total = (await readEvents(dataRoot)).eventos.length;
  for (const descartada of ['sim', 1, null, undefined]) await assert.rejects(descartar({ dataRoot, id: ids[0], descartada, now: NOW }), { code: 'invalido', message: /Descarte inválido/ });
  await assert.rejects(descartar({ dataRoot, id: 42, descartada: true, now: NOW }), { code: 'invalido' });
  await assert.rejects(descartar({ dataRoot, id: 'nao-existe', descartada: true, now: NOW }), { code: 'nao_encontrado' });
  assert.equal((await readEvents(dataRoot)).eventos.length, total);
});
