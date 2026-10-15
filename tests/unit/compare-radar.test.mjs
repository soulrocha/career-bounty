import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { compararRadar } from '../../core/radar/compare.mjs';

const antiga = (n, extra = {}) => ({ id: `legado-${n}`, empresa: 'Empresa Alfa', cargo: `Cargo ${n}`, url: `https://empresa-alfa.gupy.io/jobs/${9100000 + n}`, aderencia: 'boa', consultado_em: '2026-10-14', ...extra });
const nova = (n, extra = {}) => ({ id: `novo-${n}`, empresa: 'Empresa Alfa', cargo: `Cargo ${n}`, url: `https://empresa-alfa.gupy.io/jobs/${9100000 + n}`, aderencia: 'alta', consultado_em: '2026-10-14', portal_origem: 'gupy', aparicoes: [{ fonte: 'gupy' }], ...extra });

test('vaga só no antigo, só no novo e em ambos', () => {
  const r = compararRadar({ antigo: [antiga(1), antiga(2)], novo: [nova(2), nova(3)], desde: '2026-10-08' });
  assert.deepEqual(r.ambos.map(v => v.chave), ['gupy:9100002']);
  assert.deepEqual(r.so_antigo.map(v => v.cargo), ['Cargo 1']);
  assert.deepEqual(r.so_novo.map(v => v.cargo), ['Cargo 3']);
  assert.deepEqual([r.contagem.antigo, r.contagem.novo, r.contagem.ambos], [2, 2, 1]);
});

test('altas e boas só no antigo são destacadas para explicação; baixas e incompatíveis não', () => {
  const r = compararRadar({ antigo: [antiga(1), antiga(2, { aderencia: 'incompativel' }), antiga(3, { aderencia: 'alta' })], novo: [], desde: '2026-10-08' });
  assert.deepEqual(r.altas_boas_so_antigo.map(v => v.cargo), ['Cargo 1', 'Cargo 3']);
});

test('só conta o que foi consultado a partir da data e ignora vaga do legado importada sem radar', () => {
  const r = compararRadar({ antigo: [antiga(1, { consultado_em: '2026-09-01' })], novo: [nova(2, { consultado_em: '2026-09-01' }), { id: 'x', empresa: 'Empresa Beta', cargo: 'Legado puro', url: 'https://x.exemplo.test/1', consultado_em: '2026-10-14', aderencia: 'boa' }], desde: '2026-10-08' });
  assert.deepEqual([r.contagem.antigo, r.contagem.novo], [0, 0]);
});

test('compare-radar --json compara o legado configurado com a projeção', async t => {
  const dataRoot = await tempDir(t);
  const legado = path.join(dataRoot, 'pipeline-vagas.json');
  await writeFile(legado, JSON.stringify({ schema_version: 1, atualizado: '2026-10-14', vagas: [antiga(1)], eventos_email_sem_requisicao: [] }));
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({}));
  const r = run(['compare-radar', '--antigo', legado, '--desde', '2026-10-08', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json.so_antigo.map(v => v.cargo), ['Cargo 1']);
  assert.ok(!('url' in r.json.so_antigo[0]), 'sem URL no relatório');
});
