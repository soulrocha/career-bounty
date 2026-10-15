import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { createRunner, LlmSaidaInvalida } from '../../core/llm/runner.mjs';
import { loadAgent } from '../../core/llm/agents.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { extrairItensCv } from '../../core/kb/cvItems.mjs';
import { lerBase } from '../../core/kb/base.mjs';
import { sugerirMarcas } from '../../core/kb/suggest.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');

async function ambiente(t, fake) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  const base = await lerBase([{ nome: 'markdown-folder', fonte: createMarkdownFolder(path.join(dataRoot, 'kb')) }]);
  const itens = base.cvTemplates.flatMap(cv => extrairItensCv(cv, new Set(base.claims.map(c => c.id))));
  const chamadas = [];
  const runner = createRunner({ modo: 'fake', dataRoot, fake: async ({ entrada, tentativa }) => { chamadas.push(entrada); return fake(entrada, tentativa); } });
  return { dataRoot, base, itens, runner, chamadas };
}

const sugestao = (ref, claim_ids, confianca = 'alta', motivo = 'mesmos números') => ({ ref, claim_ids, confianca, motivo });
const refDoSemMarca = itens => `${itens.find(i => i.sem_marca).modelo}:${itens.find(i => i.sem_marca).linha}`;

async function arvore(dir) {
  const itens = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) { const f = path.join(e.parentPath ?? e.path, e.name); itens.push(`${path.relative(dir, f)}:${createHash('sha256').update(await readFile(f)).digest('hex')}`); }
  }
  return itens.sort().join('\n');
}

test('o agente mapeador usa Sonnet e nenhuma ferramenta', async () => {
  const agente = await loadAgent('mapeador');
  assert.equal(agente.modelo, 'sonnet');
  assert.deepEqual(agente.tools, ['none']);
});

test('a entrada traz só os bullets sem marca, as afirmações publicáveis e a prioridade do quadrante (b)', async t => {
  const a = await ambiente(t, entrada => ({ sugestoes: [sugestao(refDoSemMarca(a0(a)), ['AF-104'])] }));
  function a0(x) { return x.itens; }
  await sugerirMarcas({ runner: a.runner, dataRoot: a.dataRoot, base: a.base, itens: a.itens, snapshotHash: 'h1' });
  const entrada = a.chamadas[0];
  assert.deepEqual(entrada.itens.map(i => i.ref), [refDoSemMarca(a.itens)]);
  assert.ok(entrada.afirmacoes.every(af => af.id !== 'AF-108'), 'afirmação não publicável não é oferecida');
  assert.deepEqual(entrada.prioridade, ['AF-104', 'AF-106']);
  assert.ok(!JSON.stringify(entrada).includes('Ana Quadrantes'));
});

test('saída só com IDs existentes; ID inventado é rejeitado e, persistindo, vira LlmSaidaInvalida', async t => {
  const boa = await ambiente(t, (entrada) => ({ sugestoes: [sugestao(entrada.itens[0].ref, ['AF-104'])] }));
  const r = await sugerirMarcas({ runner: boa.runner, dataRoot: boa.dataRoot, base: boa.base, itens: boa.itens, snapshotHash: 'h1' });
  assert.deepEqual(r.propostas.map(p => [p.claim_ids]), [[['AF-104']]]);
  const ruim = await ambiente(t, entrada => ({ sugestoes: [sugestao(entrada.itens[0].ref, ['AF-999'])] }));
  await assert.rejects(sugerirMarcas({ runner: ruim.runner, dataRoot: ruim.dataRoot, base: ruim.base, itens: ruim.itens, snapshotHash: 'h1' }), LlmSaidaInvalida);
  const corrige = await ambiente(t, (entrada, tentativa) => ({ sugestoes: [sugestao(entrada.itens[0].ref, [tentativa === 1 ? 'AF-999' : 'AF-104'])] }));
  assert.equal((await sugerirMarcas({ runner: corrige.runner, dataRoot: corrige.dataRoot, base: corrige.base, itens: corrige.itens, snapshotHash: 'h1' })).propostas.length, 1);
});

test('referência fora do lote, contrato extra e confiança inválida são rejeitados', async t => {
  for (const saida of [{ sugestoes: [sugestao('nao-existe:1', ['AF-104'])] }, { sugestoes: [], extra: 1 }, { sugestoes: [sugestao('x', ['AF-104'], 'certeza')] }]) {
    const a = await ambiente(t, () => saida);
    await assert.rejects(sugerirMarcas({ runner: a.runner, dataRoot: a.dataRoot, base: a.base, itens: a.itens, snapshotHash: 'h1' }), LlmSaidaInvalida);
  }
});

test('sugestão de baixa confiança, ou sem ID, vai para "mapear à mão"', async t => {
  const a = await ambiente(t, entrada => ({ sugestoes: [sugestao(entrada.itens[0].ref, ['AF-104'], 'baixa', 'talvez')] }));
  const r = await sugerirMarcas({ runner: a.runner, dataRoot: a.dataRoot, base: a.base, itens: a.itens, snapshotHash: 'h1' });
  assert.equal(r.propostas.length, 0);
  assert.equal(r.mapear_a_mao.length, 1);
  assert.match(r.mapear_a_mao[0].texto, /melhoria contínua/);
  const vazia = await ambiente(t, entrada => ({ sugestoes: [sugestao(entrada.itens[0].ref, [], 'alta', 'nenhuma serve')] }));
  assert.equal((await sugerirMarcas({ runner: vazia.runner, dataRoot: vazia.dataRoot, base: vazia.base, itens: vazia.itens, snapshotHash: 'h1' })).mapear_a_mao.length, 1);
});

test('sugestão cujos números não batem com a afirmação é rebaixada para mapear à mão', async t => {
  const a = await ambiente(t, entrada => ({ sugestoes: [sugestao(entrada.itens[0].ref, ['AF-105'], 'alta', 'parece')] }));
  const itens = [{ ...a.itens.find(i => i.sem_marca), texto: 'Cortou o retrabalho em 77% no ano.', numeros: [{ bruto: '77%', valor: 77, tipo: 'percentual' }] }];
  const r = await sugerirMarcas({ runner: a.runner, dataRoot: a.dataRoot, base: a.base, itens, snapshotHash: 'h1' });
  assert.equal(r.propostas.length, 0);
  assert.match(r.mapear_a_mao[0].motivo, /77%/);
});

test('o resultado nunca altera o CV nem a base: só grava proposta em outbox/marcas', async t => {
  const a = await ambiente(t, entrada => ({ sugestoes: [sugestao(entrada.itens[0].ref, ['AF-104'])] }));
  const antesKb = await arvore(path.join(a.dataRoot, 'kb'));
  const r = await sugerirMarcas({ runner: a.runner, dataRoot: a.dataRoot, base: a.base, itens: a.itens, snapshotHash: 'h1' });
  assert.equal(await arvore(path.join(a.dataRoot, 'kb')), antesKb);
  assert.ok(r.arquivo.replaceAll('\\', '/').includes('/outbox/marcas/'));
  const md = await readFile(r.arquivo, 'utf8');
  assert.match(md, /claim:AF-104/);
  assert.match(md, /Proposta; nada foi aplicado/);
});

test('um lote único por rodada e cache por hash do snapshot', async t => {
  const a = await ambiente(t, entrada => ({ sugestoes: [sugestao(entrada.itens[0].ref, ['AF-104'])] }));
  const args = { runner: a.runner, dataRoot: a.dataRoot, base: a.base, itens: a.itens };
  const primeira = await sugerirMarcas({ ...args, snapshotHash: 'h1' });
  assert.equal(a.chamadas.length, 1);
  assert.equal(primeira.do_cache, false);
  const segunda = await sugerirMarcas({ ...args, snapshotHash: 'h1' });
  assert.equal(a.chamadas.length, 1, 'mesmo snapshot: nenhuma chamada nova');
  assert.equal(segunda.do_cache, true);
  assert.deepEqual(segunda.propostas, primeira.propostas);
  await sugerirMarcas({ ...args, snapshotHash: 'h2' });
  assert.equal(a.chamadas.length, 2, 'snapshot novo invalida o cache');
});

test('sem bullets sem marca não há chamada ao LLM', async t => {
  const a = await ambiente(t, () => { throw new Error('não deveria chamar'); });
  const r = await sugerirMarcas({ runner: a.runner, dataRoot: a.dataRoot, base: a.base, itens: a.itens.filter(i => !i.sem_marca), snapshotHash: 'h1' });
  assert.deepEqual([r.propostas, r.mapear_a_mao, a.chamadas.length], [[], [], 0]);
});

test('bin kb suggest exige --live ou --replay e recusa os dois juntos; sem gravação em replay falha com instrução', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  const sem = run(['kb', 'suggest', '--json'], { dataRoot });
  assert.equal(sem.status, 2);
  assert.match(sem.json.error, /--live.*--replay/);
  assert.equal(run(['kb', 'suggest', '--live', '--replay', dataRoot, '--json'], { dataRoot }).status, 2);
  const vazio = run(['kb', 'suggest', '--replay', path.join(dataRoot, 'nada'), '--json'], { dataRoot });
  assert.equal(vazio.status, 2);
  assert.match(vazio.json.error, /Sem gravação para mapeador/);
});

test('replay gravado com a persona fictícia: o bullet sem número vai para mapear à mão e a proposta sai em outbox/marcas', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  const r = run(['kb', 'suggest', '--replay', path.join(repoRoot, 'tests', 'replay', 'llm'), '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(r.json.propostas.length + r.json.mapear_a_mao.length, 1);
  assert.match(r.json.arquivo.replaceAll('\\', '/'), /\/outbox\/marcas\/sugestoes-[0-9a-f]{16}\.md$/);
});
