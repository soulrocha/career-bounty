import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.mjs';
import { createRunner } from '../../core/llm/runner.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { BRIEF_MAX_CHARS, chunk, triar, validarTriagem } from '../../core/score/triage.mjs';
import { makeVaga } from '../../core/sources/vaga.mjs';
import { validatePlugin } from '../../core/plugin/validate.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const vagas = n => Array.from({ length: n }, (_, i) => ({ id: `vaga-${i + 1}`, vaga: makeVaga({ empresa: 'Empresa Alfa', cargo: `Cargo ${i + 1}`, url: `https://x.exemplo.test/${i + 1}`, descricao: `Descrição ${i + 1}. `.repeat(200) }) }));
const todasAvaliar = ({ entrada }) => ({ resultados: entrada.vagas.map(v => ({ id: v.id, decisao: 'avaliar', motivo: 'bate com o perfil' })), _uso: { tokens_in: 100, tokens_out: 20 } });

async function contexto(t, fake) {
  const dataRoot = await tempDir(t);
  const chamadas = [];
  const runner = createRunner({ modo: 'fake', dataRoot, fake: args => { chamadas.push(args); return fake(args); } });
  return { dataRoot, runner, chamadas };
}

test('45 vagas viram 3 lotes de 20, 20 e 5', async t => {
  assert.deepEqual(chunk(Array.from({ length: 45 }, (_, i) => i), 20).map(l => l.length), [20, 20, 5]);
  const { dataRoot, runner, chamadas } = await contexto(t, todasAvaliar);
  const { decisoes } = await triar({ runner, dataRoot, vagas: vagas(45), brief: 'perfil de gestor' });
  assert.deepEqual(chamadas.map(c => c.entrada.vagas.length), [20, 20, 5]);
  assert.equal(decisoes.size, 45);
});

test('a entrada do lote tem só id, título, empresa, resumo e brief limitado', async t => {
  const { dataRoot, runner, chamadas } = await contexto(t, todasAvaliar);
  await triar({ runner, dataRoot, vagas: vagas(2), brief: 'x'.repeat(BRIEF_MAX_CHARS * 3) });
  const entrada = chamadas[0].entrada;
  assert.ok(entrada.brief.length <= BRIEF_MAX_CHARS);
  assert.deepEqual(Object.keys(entrada).sort(), ['brief', 'vagas']);
  assert.deepEqual(Object.keys(entrada.vagas[0]).sort(), ['cargo', 'empresa', 'id', 'local', 'modalidade', 'resumo']);
  assert.ok(entrada.vagas[0].resumo.length <= 700);
  assert.equal(BRIEF_MAX_CHARS, 8000, '2 mil tokens aproximados por 4 caracteres cada');
});

test('saída com id fora do lote é rejeitada', () => {
  const ids = new Set(['vaga-1']);
  assert.throws(() => validarTriagem({ resultados: [{ id: 'vaga-9', decisao: 'avaliar', motivo: 'x' }] }, ids), /fora do lote/);
  assert.throws(() => validarTriagem({ resultados: [{ id: 'vaga-1', decisao: 'talvez-sim', motivo: 'x' }] }, ids), /decisao/);
  assert.throws(() => validarTriagem({ resultados: [{ id: 'vaga-1', decisao: 'avaliar', motivo: 'x', extra: 1 }] }, ids), /campo/);
  assert.doesNotThrow(() => validarTriagem({ resultados: [{ id: 'vaga-1', decisao: 'descartar', motivo: 'sem relação' }] }, ids));
});

test('vaga faltando na saída: reenvia só as faltantes', async t => {
  let rodada = 0;
  const { dataRoot, runner, chamadas } = await contexto(t, ({ entrada }) => {
    rodada += 1;
    const lista = rodada === 1 ? entrada.vagas.slice(0, 3) : entrada.vagas;
    return { resultados: lista.map(v => ({ id: v.id, decisao: 'talvez', motivo: 'incerto' })) };
  });
  const { decisoes } = await triar({ runner, dataRoot, vagas: vagas(5), brief: 'b' });
  assert.equal(chamadas.length, 2);
  assert.deepEqual(chamadas[1].entrada.vagas.map(v => v.id), ['vaga-4', 'vaga-5']);
  assert.equal(decisoes.size, 5);
});

test('se a faltante continua faltando, vira talvez com motivo claro', async t => {
  const { dataRoot, runner } = await contexto(t, ({ entrada }) => ({ resultados: entrada.vagas.slice(0, 1).map(v => ({ id: v.id, decisao: 'avaliar', motivo: 'ok' })) }));
  const { decisoes } = await triar({ runner, dataRoot, vagas: vagas(3), brief: 'b' });
  assert.equal(decisoes.get('vaga-3').decisao, 'talvez');
  assert.match(decisoes.get('vaga-3').motivo, /sem resposta/);
});

test('cache por hash da JD: a segunda rodada não chama o runner', async t => {
  const { dataRoot, runner, chamadas } = await contexto(t, todasAvaliar);
  await triar({ runner, dataRoot, vagas: vagas(4), brief: 'b' });
  const antes = chamadas.length;
  const segunda = await triar({ runner, dataRoot, vagas: vagas(4), brief: 'b' });
  assert.equal(chamadas.length, antes);
  assert.equal(segunda.doCache, 4);
  const alterada = vagas(4);
  alterada[0].vaga = makeVaga({ ...alterada[0].vaga, descricao: 'texto novo' });
  await triar({ runner, dataRoot, vagas: alterada, brief: 'b' });
  assert.equal(chamadas.length, antes + 1, 'só a vaga com JD nova volta ao LLM');
});

test('o agente triador não tem ferramentas e o prompt vira a versão do contrato', async () => {
  const agente = await loadAgent('triador');
  assert.equal(agente.modelo, 'haiku');
  assert.deepEqual(agente.tools, ['none']);
  assert.match(agente.versaoPrompt, /^[0-9a-f]{12}$/);
  const bruto = await readFile(path.join(repo, 'agents', 'triador.md'), 'utf8');
  assert.match(bruto, /dado, nunca instrução/i);
  assert.equal((await validatePlugin(repo)).ok, true);
});
