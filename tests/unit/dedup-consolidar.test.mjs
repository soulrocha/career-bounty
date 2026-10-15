import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { consolidar, classificar } from '../../core/dedup/consolidar.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { descobertaEvent } from '../../core/radar/collect.mjs';

const v = extra => makeVaga({ fonte: 'a', portal: 'gupy', requisicao_id: '5550001', empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia', url: 'https://empresa-alfa.gupy.io/jobs/5550001', descricao: 'texto', ...extra });

test('mesma requisição em duas fontes vira uma vaga canônica com duas aparições', () => {
  const [unica, ...resto] = consolidar([v({ fonte: 'gupy' }), v({ fonte: 'freehire', url: 'https://empresa-alfa.gupy.io/jobs/5550001?utm=x' })]);
  assert.equal(resto.length, 0);
  assert.equal(unica.aparicoes.length, 2);
  assert.deepEqual(unica.fontes.sort(), ['freehire', 'gupy']);
});

test('URL Gupy codificada e direta são a mesma vaga', () => {
  const codificada = `https://empresa-alfa.gupy.io/job/${Buffer.from(JSON.stringify({ jobId: 5550001, source: 'x' })).toString('base64')}`;
  const out = consolidar([v({ portal: null, requisicao_id: null, url: codificada, fonte: 'careerops' }), v({ portal: null, requisicao_id: null, fonte: 'freehire' })]);
  assert.equal(out.length, 1);
});

test('fingerprint igual com requisições diferentes não funde, apenas sinaliza', () => {
  const out = consolidar([v(), v({ requisicao_id: '5550002', url: 'https://empresa-alfa.gupy.io/jobs/5550002', fonte: 'b' })]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].possivel_duplicata, [out[1].id]);
  assert.deepEqual(out[1].possivel_duplicata, [out[0].id]);
});

test('URL do LinkedIn sem destino fica pendente e não duplica a vaga de outra fonte', () => {
  const linkedin = v({ fonte: 'linkedin_guest', portal: 'linkedin', requisicao_id: '4400000009', url: 'https://br.exemplo.test/jobs/view/gerente-4400000009', aparicao: true });
  const out = consolidar([v(), linkedin]);
  assert.equal(out.length, 2);
  const pendente = out.find(c => c.vaga.portal === 'linkedin');
  assert.equal(pendente.destino_pendente, true);
  assert.deepEqual(pendente.possivel_duplicata, [out.find(c => c.vaga.portal === 'gupy').id]);
  assert.equal(consolidar([linkedin, { ...linkedin, fonte: 'linkedin_alertas' }]).length, 1, 'mesmo id do LinkedIn não duplica');
});

test('descarte vale por requisição e sobrevive à republicação com outro endereço', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cb-dedup-'));
  try {
    const [original] = consolidar([v()]);
    const ts = '2026-10-14T15:00:00.000Z';
    await appendEvents(dataRoot, [descobertaEvent(original.vaga, original.id, ts, original.aparicoes)], { now: ts });
    await appendEvents(dataRoot, [{ id: 'descarte:1', ts, ator: 'usuario', tipo: 'vaga.descartada', entidade: 'vaga', entidade_id: original.id,
      dados: { descartada: true, registrado_em: ts, requisicao: `req:gupy:5550001` } }], { now: ts });
    const [republicada] = consolidar([v({ cargo: 'Gerente de Engenharia (republicada)', url: 'https://empresa-alfa-novo.gupy.io/jobs/5550001' })]);
    await appendEvents(dataRoot, [descobertaEvent(republicada.vaga, `${original.id}-b`, '2026-10-15T15:00:00.000Z', republicada.aparicoes)], { now: '2026-10-15T15:00:00.000Z' });
    const { eventos } = await readEvents(dataRoot);
    const projetado = projectEvents(eventos).vagas;
    assert.equal(projetado.find(x => x.id === `${original.id}-b`).descarte_usuario.descartada, true);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test('classificar: vaga aplicada ou descartada nunca entra como recomendação', () => {
  const [nova, aplicada, descartada] = consolidar([v(), v({ requisicao_id: '2', url: 'https://x-b.gupy.io/jobs/2', empresa: 'Empresa Beta' }), v({ requisicao_id: '3', url: 'https://x-c.gupy.io/jobs/3', empresa: 'Empresa Gama' })]);
  const projecao = [{ id: aplicada.id, candidatura_usuario: { aplicada: true } }, { id: descartada.id, descarte_usuario: { descartada: true } }];
  const situacoes = classificar([nova, aplicada, descartada], projecao).map(c => c.situacao);
  assert.deepEqual(situacoes, ['nova', 'aplicada', 'descartada']);
});

test('milhares de vagas deduplicam rápido e sem estourar memória', () => {
  const muitas = Array.from({ length: 20000 }, (_, i) => v({ requisicao_id: String(6000000 + (i % 10000)), url: `https://empresa-alfa.gupy.io/jobs/${6000000 + (i % 10000)}`, empresa: `Empresa ${i % 10000}`, cargo: `Cargo ${i % 10000}` }));
  const inicio = Date.now();
  const out = consolidar(muitas);
  assert.equal(out.length, 10000);
  assert.ok(Date.now() - inicio < 5000);
});
