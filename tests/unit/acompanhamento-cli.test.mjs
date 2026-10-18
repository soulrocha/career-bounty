import assert from 'node:assert/strict';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { appendEvents } from '../../core/store/events.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00'; // Hoje = 2026-10-18

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  return dataRoot;
}

test('acompanhamento pendentes lista apenas processos com alerta atencao e lembrar', async t => {
  const dataRoot = await ambiente(t);

  const eventos = [
    // 1. Recente: interagiu há 1 dia (2026-10-17) -> alerta normal
    {
      id: 'e-recente',
      ts: '2026-10-17T10:00:00Z',
      ator: 'teste',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-recente',
      dados: { aplicada: true, data: '2026-10-17' },
    },
    // 2. Atenção: interagiu há 5 dias (2026-10-13) -> alerta atencao
    {
      id: 'e-atencao',
      ts: '2026-10-13T10:00:00Z',
      ator: 'teste',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-atencao',
      dados: { aplicada: true, data: '2026-10-13' },
    },
    // 3. Lembrar: interagiu há 8 dias (2026-10-10) -> alerta lembrar
    {
      id: 'e-lembrar',
      ts: '2026-10-10T10:00:00Z',
      ator: 'teste',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-lembrar',
      dados: { aplicada: true, data: '2026-10-10' },
    },
    // 4. Encerrado: interagiu há 10 dias mas está encerrado -> ignorado
    {
      id: 'e-fim-1',
      ts: '2026-10-08T10:00:00Z',
      ator: 'teste',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-encerrada',
      dados: { aplicada: true, data: '2026-10-08' },
    },
    {
      id: 'e-fim-2',
      ts: '2026-10-09T10:00:00Z',
      ator: 'teste',
      tipo: 'processo.encerrado',
      entidade: 'processo',
      entidade_id: 'vaga-encerrada',
      dados: { vaga_id: 'vaga-encerrada', desfecho: 'reprovado', data: '2026-10-09' },
    },
  ];

  await appendEvents(dataRoot, eventos, { now: NOW });

  const res = run([
    'acompanhamento', 'pendentes',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });

  assert.equal(res.status, 0, res.stderr);
  assert.ok(Array.isArray(res.json?.pendentes));
  assert.equal(res.json.pendentes.length, 2);

  const ids = res.json.pendentes.map(p => p.vaga_id).sort();
  assert.deepEqual(ids, ['vaga-atencao', 'vaga-lembrar']);

  const mapa = new Map(res.json.pendentes.map(p => [p.vaga_id, p]));
  assert.equal(mapa.get('vaga-atencao').alerta, 'atencao');
  assert.equal(mapa.get('vaga-lembrar').alerta, 'lembrar');
});
