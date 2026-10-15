import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { runSources, SourceError } from '../../core/sources/index.mjs';
import { createFake } from '../../core/sources/fake.mjs';
import { validateVaga } from '../../core/sources/vaga.mjs';

const vaga = (extra = {}) => ({ fonte: 'fake', portal: 'fake', requisicao_id: '1001', empresa: 'Empresa Alfa', cargo: 'Gerente de Engenharia',
  local: 'Brasil', modalidade: 'remoto', regime: 'CLT', url: 'https://vagas.exemplo.test/vaga/1001', publicado_em: '2026-10-14', descricao: 'Lidera times de plataforma.', ...extra });

async function configurar(dataRoot, vagas) {
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ fontes: { fake: { vagas } } }));
}

const ctx = { janela: { inicio: '2026-10-08', fim: '2026-10-15' }, config: {}, now: new Date('2026-10-15T21:00:00Z') };

test('collect --dry-run --json com fonte fake devolve a vaga e não escreve eventos', async t => {
  const dataRoot = await tempDir(t);
  await configurar(dataRoot, [vaga()]);
  const result = run(['collect', '--dry-run', '--json', '--source', 'fake', '--now', '2026-10-15T21:00:00Z'], { dataRoot });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.json.dry_run, true);
  assert.equal(result.json.coletadas, 1);
  assert.equal(result.json.novas, 1);
  assert.equal(result.json.fontes[0].id, 'fake');
  assert.equal(result.json.fontes[0].estado, 'ok');
  assert.deepEqual(await readdir(dataRoot).then(names => names.filter(n => n === 'events')), []);
});

test('collect sem --dry-run grava vaga.descoberta e a projeção mostra a vaga', async t => {
  const dataRoot = await tempDir(t);
  await configurar(dataRoot, [vaga()]);
  const collected = run(['collect', '--json', '--source', 'fake', '--now', '2026-10-15T21:00:00Z'], { dataRoot });
  assert.equal(collected.status, 0, collected.stdout + collected.stderr);
  assert.equal(collected.json.eventos_gravados, 1);
  const projected = run(['project', '--json'], { dataRoot });
  assert.equal(projected.json.vagas, 1);
  const again = run(['collect', '--json', '--source', 'fake', '--now', '2026-10-15T21:00:00Z'], { dataRoot });
  assert.equal(again.json.eventos_gravados, 0, 'a mesma descoberta não duplica');
  assert.equal(run(['project', '--json'], { dataRoot }).json.vagas, 1);
});

test('fonte que lança erro vira fontes[].erro e não derruba as outras', async () => {
  const quebrada = { id: 'quebrada', collect: async () => { throw new SourceError('estrutura_mudou', 'campo data ausente'); } };
  const boa = createFake([vaga()]);
  const result = await runSources([quebrada, boa], ctx);
  assert.equal(result.vagas.length, 1);
  const erro = result.fontes.find(f => f.id === 'quebrada');
  assert.equal(erro.estado, 'erro');
  assert.equal(erro.codigo, 'estrutura_mudou');
  assert.match(erro.erro, /campo data ausente/);
  assert.equal(result.fontes.find(f => f.id === 'fake').estado, 'ok');
  assert.equal(result.encerradas, undefined, 'falha de fonte nunca produz vaga encerrada');
});

test('fonte indisponível é estado próprio, não erro', async () => {
  const result = await runSources([{ id: 'ausente', collect: async () => { throw new SourceError('indisponivel', 'executável não encontrado'); } }], ctx);
  assert.equal(result.fontes[0].estado, 'indisponivel');
});

test('timeout por fonte encerra só aquela fonte', async () => {
  const lenta = { id: 'lenta', collect: () => new Promise(() => {}) };
  const result = await runSources([lenta, createFake([vaga()])], ctx, { timeoutMs: 50 });
  assert.equal(result.fontes.find(f => f.id === 'lenta').estado, 'erro');
  assert.equal(result.fontes.find(f => f.id === 'lenta').codigo, 'timeout');
  assert.equal(result.vagas.length, 1);
});

test('saída de collect --json tem schema estável', async t => {
  const dataRoot = await tempDir(t);
  await configurar(dataRoot, [vaga()]);
  const { json } = run(['collect', '--dry-run', '--json', '--source', 'fake', '--now', '2026-10-15T21:00:00Z'], { dataRoot });
  assert.deepEqual(Object.keys(json).sort(), ['coletadas', 'delta', 'dry_run', 'eventos_gravados', 'fontes', 'janela', 'novas']);
  assert.deepEqual(Object.keys(json.fontes[0]).sort(), ['estado', 'id', 'vagas']);
  assert.deepEqual(json.janela, { inicio: '2026-10-08', fim: '2026-10-15' });
});

test('contrato Vaga recusa vaga sem empresa, cargo ou URL http(s)', () => {
  assert.doesNotThrow(() => validateVaga(vaga()));
  for (const campo of ['empresa', 'cargo', 'url']) assert.throws(() => validateVaga(vaga({ [campo]: '' })), new RegExp(campo));
  assert.throws(() => validateVaga(vaga({ url: 'javascript:alert(1)' })), /url/);
});

test('fonte desconhecida em --source falha com mensagem clara', async t => {
  const dataRoot = await tempDir(t);
  const result = run(['collect', '--dry-run', '--json', '--source', 'inexistente'], { dataRoot });
  assert.equal(result.status, 2);
  assert.match(result.json.error, /Fonte desconhecida/);
});
