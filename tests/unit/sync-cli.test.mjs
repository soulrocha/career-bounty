import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cli, run, tempDir } from '../helpers/cli.mjs';

// O "servidor" dos testes é `node <cli>` local; a validação do comando só aceita isso com esta variável.
process.env.CAREER_BOUNTY_SYNC_TESTE = '1';

// Dois "PCs" (DATA_ROOT) e um "servidor" (pasta) falando pelo próprio CLI: o comando remoto é `node <cli>`,
// exatamente o que o ssh executaria na VM.
async function cenario(t) {
  const raiz = await tempDir(t, 'cb-sync-');
  const pcA = path.join(raiz, 'pc-a');
  const pcB = path.join(raiz, 'pc-b');
  const hub = path.join(raiz, 'hub');
  for (const pasta of [pcA, pcB]) {
    await mkdir(pasta, { recursive: true });
    const r = run(['sync', 'configurar', '--comando-json', JSON.stringify([process.execPath, cli]), '--raiz', hub, '--json'], { dataRoot: pasta });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  return { pcA, pcB, hub };
}

async function escrever(raiz, rel, conteudo) {
  await mkdir(path.dirname(path.join(raiz, rel)), { recursive: true });
  await writeFile(path.join(raiz, rel), conteudo);
}
const ler = (raiz, rel) => readFile(path.join(raiz, rel), 'utf8');
const existe = (raiz, rel) => readFile(path.join(raiz, rel)).then(() => true, () => false);
const sync = (dataRoot, extra = []) => run(['sync', ...extra, '--json'], { dataRoot });

async function listar(raiz, prefixo = '') {
  const saida = [];
  for (const item of await readdir(path.join(raiz, prefixo), { withFileTypes: true })) {
    const rel = prefixo ? `${prefixo}/${item.name}` : item.name;
    if (item.isDirectory()) saida.push(...await listar(raiz, rel));
    else saida.push(rel);
  }
  return saida.sort();
}

test('sync configurar recusa comando ou raiz inválidos', async t => {
  const dir = await tempDir(t);
  assert.equal(run(['sync', 'configurar', '--comando-json', '"ssh"', '--raiz', '/srv/x', '--json'], { dataRoot: dir }).status, 2);
  assert.equal(run(['sync', 'configurar', '--comando-json', '["ssh"]', '--raiz', '/srv/com espaco', '--json'], { dataRoot: dir }).status, 2);
  assert.equal(run(['sync', '--json'], { dataRoot: dir }).json.error.includes('sync configurar'), true);
  // Nome curto do Windows (RUNNER~1) no meio do caminho é aceito; "~" no início, não.
  assert.equal(run(['sync', 'configurar', '--comando-json', '["ssh","u@h","node","/a.mjs"]', '--raiz', 'D:\\a\\RUNNER~1\\x', '--json'], { dataRoot: dir }).status, 0);
  assert.equal(run(['sync', 'configurar', '--comando-json', '["ssh","u@h","node","/a.mjs"]', '--raiz', '~/x', '--json'], { dataRoot: dir }).status, 2);
});

test('envio inicial, PC novo recebe tudo e os arquivos locais da máquina ficam de fora', async t => {
  const { pcA, pcB, hub } = await cenario(t);
  await escrever(pcA, 'events/2026/10/28.pc-a.jsonl', '{"a":1}\n');
  await escrever(pcA, 'artifacts/cv/v1/abc/cv.pdf', Buffer.from([0, 1, 2, 255, 10, 13, 0]));
  await escrever(pcA, 'config.yml', '{"radar":{}}\n');
  await escrever(pcA, 'projections/pipeline-vagas.json', '{}');
  await escrever(pcA, 'launcher.json', '{"node":"C:/x"}');
  await escrever(pcA, 'secrets/token', 'segredo');
  await escrever(pcA, 'state/sessao.lock', '{}');

  const a = sync(pcA);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.equal(a.json.enviados, 3);
  assert.deepEqual((await listar(hub)).filter(rel => !rel.startsWith('.sync/')), ['artifacts/cv/v1/abc/cv.pdf', 'config.yml', 'events/2026/10/28.pc-a.jsonl']);

  // PC novo com o esqueleto do setup: o config.yml vazio local não sobrescreve o do hub.
  await escrever(pcB, 'config.yml', '{}\n');
  const b = sync(pcB);
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.equal(b.json.baixados, 3);
  assert.deepEqual(b.json.conflitos, ['config.yml']);
  assert.equal(await ler(pcB, 'config.yml'), '{"radar":{}}\n');
  assert.deepEqual(await readFile(path.join(pcB, 'artifacts/cv/v1/abc/cv.pdf')), Buffer.from([0, 1, 2, 255, 10, 13, 0]));
  const copia = (await readdir(pcB)).find(nome => nome.startsWith('config.yml.conflito-'));
  assert.equal(await ler(pcB, copia), '{}\n');
  assert.equal(await existe(pcB, 'launcher.json'), false);

  // Nada mais a fazer: segunda rodada é vazia.
  const de_novo = sync(pcB);
  assert.equal(de_novo.json.baixados + de_novo.json.enviados, 0);
});

test('cada PC grava o seu log e as marcações se encontram nos dois', async t => {
  const { pcA, pcB } = await cenario(t);
  await escrever(pcA, 'events/2026/10/28.pc-a.jsonl', '{"a":1}\n');
  sync(pcA);
  sync(pcB);
  await escrever(pcB, 'events/2026/10/30.pc-b.jsonl', '{"b":1}\n');
  await escrever(pcA, 'events/2026/10/28.pc-a.jsonl', '{"a":1}\n{"a":2}\n');
  assert.equal(sync(pcB).json.enviados, 1);
  const a = sync(pcA);
  assert.equal(a.json.enviados, 1);
  assert.equal(a.json.baixados, 1);
  assert.equal(sync(pcB).json.baixados, 1);
  for (const pc of [pcA, pcB]) {
    assert.equal(await ler(pc, 'events/2026/10/28.pc-a.jsonl'), '{"a":1}\n{"a":2}\n');
    assert.equal(await ler(pc, 'events/2026/10/30.pc-b.jsonl'), '{"b":1}\n');
  }
});

test('mesmo arquivo alterado nos dois PCs: o primeiro a enviar vence e o outro guarda a sua versão', async t => {
  const { pcA, pcB } = await cenario(t);
  await escrever(pcA, 'kb/answers.yml', 'v0');
  sync(pcA);
  sync(pcB);
  await escrever(pcA, 'kb/answers.yml', 'versao-a');
  await escrever(pcB, 'kb/answers.yml', 'versao-b');
  assert.equal(sync(pcA).json.enviados, 1);
  const b = sync(pcB);
  assert.deepEqual(b.json.conflitos, ['kb/answers.yml']);
  assert.equal(await ler(pcB, 'kb/answers.yml'), 'versao-a');
  const copia = (await readdir(path.join(pcB, 'kb'))).find(nome => nome.startsWith('answers.yml.conflito-'));
  assert.equal(await ler(pcB, `kb/${copia}`), 'versao-b');
  const status = run(['sync', 'status', '--json'], { dataRoot: pcB });
  assert.deepEqual(status.json.conflitos, ['kb/answers.yml']);
});

test('apagar se propaga pela lixeira, e apagar em massa exige confirmação', async t => {
  const { pcA, pcB, hub } = await cenario(t);
  for (let i = 0; i < 14; i++) await escrever(pcA, `kb/claims/c${i}.md`, `c${i}`);
  sync(pcA);
  sync(pcB);
  await rm(path.join(pcA, 'kb/claims/c0.md'));
  assert.equal(sync(pcA).json.apagados_remoto, 1);
  assert.equal(await existe(hub, 'kb/claims/c0.md'), false);
  assert.equal((await listar(hub)).some(rel => rel.startsWith('.sync/lixeira/') && rel.endsWith('kb/claims/c0.md')), true);
  assert.equal(sync(pcB).json.apagados_local, 1);
  assert.equal(await existe(pcB, 'kb/claims/c0.md'), false);

  await rm(path.join(pcA, 'kb/claims'), { recursive: true });
  const recusa = sync(pcA);
  assert.equal(recusa.status, 2);
  assert.match(recusa.json.error, /--permitir-apagar/);
  assert.equal(await existe(hub, 'kb/claims/c1.md'), true);
  assert.equal(sync(pcA, ['--permitir-apagar']).json.apagados_remoto, 13);
});

test('sync-remote recusa caminho fora da raiz e arquivo fora das regras', async t => {
  const hub = await tempDir(t);
  const quadro = (rel, conteudo) => `${JSON.stringify({ path: rel, sha256: 'x', size: Buffer.byteLength(conteudo), esperado: null })}\n${conteudo}`;
  const entrada = quadro('../fora.txt', 'x') + quadro('projections/p.json', 'y') + '{"fim":true}\n';
  const r = run(['sync-remote', 'put', '--raiz', hub, '--json'], { input: entrada });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json.resultados.map(item => item.ok), [false, false]);
  assert.deepEqual(await listar(hub).catch(() => []), []);
});
