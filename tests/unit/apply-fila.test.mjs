import assert from 'node:assert/strict';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { montarFila } from '../../core/apply/queue.mjs';
import { rotaDe } from '../../core/apply/route.mjs';
import { chaveTentativa, projetarTentativas, registrarDesfecho, reservarTentativa } from '../../core/apply/attempts.mjs';
import { readEvents } from '../../core/store/events.mjs';

const H = 'a'.repeat(64);
const AGORA = '2026-10-17T12:00:00.000Z';
const vaga = (id, extra = {}) => ({ id, empresa: `Empresa ${id.slice(-2)}`, cargo: 'Gerente de Produto', aderencia: 'alta', url_status: 'aberta', status: 'avaliada-sem-envio',
  url: `https://job-boards.greenhouse.io/empresa${id.slice(-2)}/jobs/${id.slice(-2)}`, requisicao_id: `REQ-${id}`, ...extra });
const cvOk = id => ({ [id]: { atual: { hash: H, ats: `artifacts/cv/${id}/${H}/cv-ats.pdf` }, enviado: null, bloqueio: null } });

test('elegível: alta ou média pedida, não aplicada, não descartada, viva, com CV aprovado; 12 casos com o motivo de cada exclusão', () => {
  const vagas = [
    vaga('vaga-01'),
    vaga('vaga-02', { aderencia: 'media' }),
    vaga('vaga-03', { aderencia: 'baixa' }),
    vaga('vaga-04', { candidatura_usuario: { aplicada: true } }),
    vaga('vaga-05', { candidatura_herdada: { aplicada: true, herdado_de: 'vaga-99' } }),
    vaga('vaga-06', { descarte_usuario: { descartada: true } }),
    vaga('vaga-07', { url_status: 'encerrada' }),
    vaga('vaga-08'),
    vaga('vaga-09', { cv_gate: { status: 'bloqueado', motivos: [], aprovada: null } }),
    vaga('vaga-10'),
    vaga('vaga-11', { url: 'https://empresa11.gupy.io/jobs/11', curriculo_necessario: false }),
    vaga('vaga-12', { condicoes: { situacao: 'incompativel' } }),
  ];
  const cvs = { ...cvOk('vaga-01'), ...cvOk('vaga-02'), ...cvOk('vaga-08'), ...cvOk('vaga-09') };
  const { fila, excluidas } = montarFila({ vagas, perguntasPorVaga: new Map([['vaga-08', ['pq-1']]]), cvs, agora: AGORA });
  assert.deepEqual(fila.map(f => f.vaga_id), ['vaga-01', 'vaga-11', 'vaga-02']);
  assert.deepEqual(Object.fromEntries(excluidas.map(e => [e.vaga_id, e.codigo])), {
    'vaga-03': 'aderencia', 'vaga-04': 'aplicada', 'vaga-05': 'aplicada', 'vaga-06': 'descartada', 'vaga-07': 'encerrada',
    'vaga-08': 'aguarda_resposta', 'vaga-09': 'cv_bloqueado', 'vaga-10': 'sem_cv', 'vaga-12': 'incompativel',
  });
  assert.match(excluidas.find(e => e.vaga_id === 'vaga-05').motivo, /outra aparição da mesma requisição/);
  assert.ok(excluidas.every(e => e.motivo));
  assert.equal(fila.find(f => f.vaga_id === 'vaga-11').cv, null);
  assert.deepEqual(montarFila({ vagas: [...vagas].reverse(), perguntasPorVaga: new Map([['vaga-08', ['pq-1']]]), cvs, agora: AGORA }).fila.map(f => f.vaga_id), ['vaga-01', 'vaga-11', 'vaga-02']);
  assert.deepEqual(montarFila({ vagas, cvs, aderencias: ['alta'], agora: AGORA }).fila.map(f => f.vaga_id), ['vaga-01', 'vaga-08', 'vaga-11']);
});

test('Greenhouse, Lever e Ashby vão para o driver; Gupy para o fluxo próprio; o resto para o assistido', () => {
  assert.deepEqual(rotaDe({ url: 'https://job-boards.greenhouse.io/x/jobs/1' }), { rota: 'driver', portal: 'greenhouse' });
  assert.deepEqual(rotaDe({ application_url: 'https://jobs.lever.co/x/abc' }), { rota: 'driver', portal: 'lever' });
  assert.deepEqual(rotaDe({ url: 'https://jobs.ashbyhq.com/x/abc' }), { rota: 'driver', portal: 'ashby' });
  assert.deepEqual(rotaDe({ url: 'https://empresa.gupy.io/jobs/1' }), { rota: 'gupy', portal: 'gupy' });
  assert.deepEqual(rotaDe({ url: 'https://www.linkedin.com/jobs/view/1' }), { rota: 'assistido', portal: 'linkedin' });
  assert.deepEqual(rotaDe({ url: 'https://empresa.inhire.app/vagas/1' }), { rota: 'assistido', portal: 'inhire' });
  assert.deepEqual(rotaDe({ url: 'https://vagas.solides.com.br/vaga/1' }), { rota: 'assistido', portal: 'solides' });
  assert.deepEqual(rotaDe({ url: 'https://carreiras.exemplo.test/1' }), { rota: 'assistido', portal: 'carreiras.exemplo.test' });
  assert.equal(rotaDe({ url: 'https://greenhouse.io.evil.test/x' }).rota, 'assistido');
});

test('a reserva é gravada antes de agir e bloqueia a segunda tentativa na mesma requisição', async t => {
  const dataRoot = await tempDir(t);
  const v = vaga('vaga-01');
  const r = await reservarTentativa(dataRoot, { vaga: v, rota: 'driver', ts: AGORA });
  const eventos = (await readEvents(dataRoot)).eventos;
  assert.equal(eventos.at(-1).tipo, 'candidatura.tentativa');
  await assert.rejects(reservarTentativa(dataRoot, { vaga: v, rota: 'driver', ts: AGORA }), e => e.code === 'em_andamento');
  // Outra aparição da mesma requisição (outro id e endereço) também é bloqueada.
  await assert.rejects(reservarTentativa(dataRoot, { vaga: { ...v, id: 'vaga-01-b', url: 'https://outra.exemplo.test/1' }, rota: 'assistido', ts: AGORA }), e => e.code === 'em_andamento');
  await registrarDesfecho(dataRoot, { ...r, vagaId: v.id, estado: 'enviada', comprovante: { texto: 'Application submitted' }, ts: '2026-10-17T12:05:00.000Z' });
  await assert.rejects(reservarTentativa(dataRoot, { vaga: v, rota: 'driver', ts: '2026-10-17T13:00:00.000Z' }), e => e.code === 'ja_enviada');
  const fila = montarFila({ vagas: [v], tentativas: projetarTentativas((await readEvents(dataRoot)).eventos), cvs: cvOk('vaga-01'), agora: '2026-10-17T13:00:00.000Z' });
  assert.deepEqual(fila.excluidas.map(e => e.codigo), ['ja_enviada']);
});

test('tentativa travada há mais de 30 minutos pede conferência manual; bloqueada por humano pode tentar de novo', async t => {
  const dataRoot = await tempDir(t);
  const v = vaga('vaga-02');
  const r = await reservarTentativa(dataRoot, { vaga: v, rota: 'assistido', ts: AGORA });
  await assert.rejects(reservarTentativa(dataRoot, { vaga: v, rota: 'assistido', ts: '2026-10-17T12:45:00.000Z' }), e => e.code === 'travada' && /confira manualmente/.test(e.message));
  await registrarDesfecho(dataRoot, { ...r, vagaId: v.id, estado: 'bloqueada:humano', motivo: 'captcha', ts: '2026-10-17T12:46:00.000Z' });
  assert.ok(await reservarTentativa(dataRoot, { vaga: v, rota: 'assistido', ts: '2026-10-17T12:50:00.000Z' }));
});

test('duas abas reservando ao mesmo tempo: só uma passa', async t => {
  const dataRoot = await tempDir(t);
  const v = vaga('vaga-03');
  const resultados = await Promise.allSettled([1, 2, 3].map(() => reservarTentativa(dataRoot, { vaga: v, rota: 'driver', ts: AGORA })));
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(chaveTentativa(v), 'req:REQ-vaga-03');
});

test('revisão do lote só admite a reserva viva da mesma vaga e mantém todos os demais gates', () => {
  const v = vaga('vaga-01');
  const base = { chave: chaveTentativa(v), vaga_id: v.id, estado: 'em_andamento', desde: AGORA };
  const montar = (extra = {}, reserva = base) => montarFila({ vagas: [v], tentativas: new Map([[chaveTentativa(v), reserva]]), cvs: cvOk(v.id),
    vagasEmRevisao: new Set([v.id]), agora: AGORA, ...extra });
  assert.equal(montar().fila.length, 1);
  assert.equal(montar({ vagasEmRevisao: new Set() }).excluidas[0].codigo, 'em_andamento');
  assert.equal(montar({}, { ...base, vaga_id: 'outra-aparicao' }).excluidas[0].codigo, 'em_andamento');
  for (const estado of ['enviada', 'enviada_sem_comprovante', 'incerta']) assert.equal(montar({}, { ...base, estado }).fila.length, 0, estado);
  assert.equal(montar({ agora: '2026-10-17T12:31:00.000Z' }).excluidas[0].codigo, 'travada');
  assert.equal(montar({ perguntasPorVaga: new Map([[v.id, ['pq-1']]]) }).excluidas[0].codigo, 'aguarda_resposta');
  assert.equal(montar({ cvs: {} }).excluidas[0].codigo, 'sem_cv');
  for (const extra of [{ candidatura_usuario: { aplicada: true } }, { descarte_usuario: { descartada: true } }, { url_status: 'encerrada' }, { condicoes: { situacao: 'incompativel' } }]) {
    assert.equal(montar({ vagas: [{ ...v, ...extra }] }).fila.length, 0);
  }
});
