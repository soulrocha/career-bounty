// F7.3 (limite diário) e F7.4 (duplicidade e reconciliação de tentativa incerta).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { concluirEnvio, reservarEnvio } from '../../core/apply/policy/limits.mjs';
import { projetarTentativas, reconciliarIncertas, registrarDesfecho, reservarTentativa, chaveTentativa } from '../../core/apply/attempts.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';

const reservar = (dataRoot, ts, extra = {}) => reservarEnvio(dataRoot, { regraId: 'ats', limiteRegra: 5, vagaId: `v-${ts}-${Math.random()}`, ts, ...extra });

test('a 6ª reserva do dia com limite 5 é bloqueada; bloqueada e falha devolvem a vaga, enviada consome', async t => {
  const dataRoot = await tempDir(t);
  const ts = '2026-10-17T15:00:00.000Z';
  const reservas = [];
  for (let i = 0; i < 5; i++) reservas.push(await reservar(dataRoot, ts));
  assert.ok(reservas.every(r => r.ok));
  assert.deepEqual(await reservar(dataRoot, ts), { ok: false, motivo: 'limite diário da regra ats atingido (5)' });
  await concluirEnvio(dataRoot, { reservaId: reservas[0].reserva_id, vagaId: 'v', resultado: 'bloqueou', ts });
  await concluirEnvio(dataRoot, { reservaId: reservas[1].reserva_id, vagaId: 'v', resultado: 'falhou', ts });
  await concluirEnvio(dataRoot, { reservaId: reservas[2].reserva_id, vagaId: 'v', resultado: 'enviou', ts });
  assert.equal((await reservar(dataRoot, ts)).ok, true);
  assert.equal((await reservar(dataRoot, ts)).ok, true);
  assert.equal((await reservar(dataRoot, ts)).ok, false);
});

test('a virada do dia em São Paulo zera o contador (23:59 e 00:01, -03); reinício do processo não zera', async t => {
  const dataRoot = await tempDir(t);
  for (let i = 0; i < 5; i++) assert.equal((await reservar(dataRoot, '2026-10-18T02:59:00.000Z')).ok, true);
  assert.equal((await reservar(dataRoot, '2026-10-18T02:59:30.000Z')).ok, false, '23:59 de 17/10');
  assert.equal((await reservar(dataRoot, '2026-10-18T03:01:00.000Z')).ok, true, '00:01 de 18/10');
  // Outro processo (reinício) lê o mesmo log: o dia 18 já tem 1.
  const r = await new Promise(resolve => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', `import { reservarEnvio } from ${JSON.stringify(path.join(repoRoot, 'core/apply/policy/limits.mjs').replaceAll('\\', '/').replace(/^([A-Z]):/, 'file:///$1:'))};
      const r = await reservarEnvio(${JSON.stringify(dataRoot)}, { regraId: 'ats', limiteRegra: 1, vagaId: 'v9', ts: '2026-10-18T04:00:00.000Z' }); console.log(JSON.stringify(r));`]);
    let saida = ''; filho.stdout.on('data', d => { saida += d; }); filho.on('exit', () => resolve(JSON.parse(saida)));
  });
  assert.equal(r.ok, false);
});

test('dois processos no limite: só um reserva; o limite global soma todas as regras', async t => {
  const dataRoot = await tempDir(t);
  const ts = '2026-10-17T15:00:00.000Z';
  const r = await Promise.all(Array.from({ length: 6 }, (_, i) => reservarEnvio(dataRoot, { regraId: 'ats', limiteRegra: 1, vagaId: `v${i}`, ts })));
  assert.equal(r.filter(x => x.ok).length, 1);
  assert.equal((await reservarEnvio(dataRoot, { regraId: 'outra', limiteRegra: 5, limiteGlobal: 2, vagaId: 'w1', ts })).ok, true);
  assert.deepEqual(await reservarEnvio(dataRoot, { regraId: 'outra', limiteRegra: 5, limiteGlobal: 2, vagaId: 'w2', ts }), { ok: false, motivo: 'limite diário global atingido (2)' });
  await assert.rejects(reservarEnvio(dataRoot, { regraId: 'x', vagaId: 'w3', ts }), /negado por padrão/);
});

const vaga = { id: 'vaga-gh', empresa: 'Empresa 01', cargo: 'Gerente de Produto', url: 'https://job-boards.greenhouse.io/empresa01/jobs/1', requisicao_id: 'REQ-1' };

test('F7.4: reserva antes do envio; queda entre o clique e o comprovante deixa incerta e bloqueia nova tentativa', async t => {
  const dataRoot = await tempDir(t);
  const ts = '2026-10-17T15:00:00.000Z';
  const r = await reservarTentativa(dataRoot, { vaga, rota: 'driver', ts });
  await assert.rejects(reservarTentativa(dataRoot, { vaga, rota: 'driver', ts }), e => e.code === 'em_andamento');
  await registrarDesfecho(dataRoot, { ...r, vagaId: vaga.id, estado: 'incerta', motivo: 'queda depois do clique', ts });
  await assert.rejects(reservarTentativa(dataRoot, { vaga, rota: 'driver', ts: '2026-10-17T18:00:00.000Z' }), e => e.code === 'incerta');
  // Outra aparição da mesma requisição também fica bloqueada.
  await assert.rejects(reservarTentativa(dataRoot, { vaga: { ...vaga, id: 'vaga-gh-2', url: 'https://outro.exemplo.test/1' }, rota: 'assistido', ts: '2026-10-17T18:00:00.000Z' }), e => e.code === 'incerta');
});

test('F7.4: a confirmação por e-mail (F3) resolve a incerta como enviada; e-mail anterior à tentativa não resolve', async t => {
  const dataRoot = await tempDir(t);
  const ts = '2026-10-17T15:00:00.000Z';
  const r = await reservarTentativa(dataRoot, { vaga, rota: 'driver', ts });
  await registrarDesfecho(dataRoot, { ...r, vagaId: vaga.id, estado: 'incerta', ts });
  const email = (id, quando) => ({ id, ts: quando, ator: 'email', tipo: 'email.recebido', entidade: 'vaga', entidade_id: vaga.id, dados: { etapa: 'inscrita' } });
  await appendEvents(dataRoot, [email('mail-antigo', '2026-10-17T14:00:00.000Z')], { now: ts });
  assert.deepEqual(await reconciliarIncertas(dataRoot, { ts }), []);
  await appendEvents(dataRoot, [email('mail-novo', '2026-10-17T15:10:00.000Z')], { now: ts });
  assert.deepEqual(await reconciliarIncertas(dataRoot, { ts: '2026-10-17T15:20:00.000Z' }), [vaga.id]);
  const t1 = projetarTentativas((await readEvents(dataRoot)).eventos).get(chaveTentativa(vaga));
  assert.equal(t1.estado, 'enviada');
  assert.deepEqual(t1.comprovante, { origem: 'email', email_evento_id: 'mail-novo', data: '2026-10-17T15:10:00.000Z' });
});

test('F7.4: dois hosts reservando a mesma requisição ao mesmo tempo: o log ordena e um perde', async t => {
  const dataRoot = await tempDir(t);
  const ts = '2026-10-17T15:00:00.000Z';
  const r = await Promise.allSettled(['pc-a', 'pc-b'].map(() => reservarTentativa(dataRoot, { vaga, rota: 'driver', ts })));
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
});
