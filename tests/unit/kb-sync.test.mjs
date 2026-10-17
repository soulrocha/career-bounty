import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { createMarkdownFolder } from '../../core/kb/sources/markdownFolder.mjs';
import { gravarDependente, lerDependente } from '../../core/kb/cache.mjs';
import { lerSnapshot, syncKb } from '../../core/kb/sync.mjs';
import { parseFrontmatter } from '../../core/kb/schema.mjs';

const personaQuadrantes = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');

const IDENTIDADE = { nome: 'Ana Quadrantes', email: 'ana.quadrantes@exemplo.test', telefone: '+55 00 90000-0000', cpf: '000.000.000-00' };

// A identidade fictícia nasce na cópia temporária: o repositório não versiona identity.yml fora do exemplo público.
async function ambiente(t) {
  const dataRoot = await tempDir(t);
  const kb = path.join(dataRoot, 'kb');
  await cp(personaQuadrantes, kb, { recursive: true });
  await writeFile(path.join(kb, 'identity.yml'), JSON.stringify(IDENTIDADE));
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  return { dataRoot, kb, fontes: [{ nome: 'markdown-folder', fonte: createMarkdownFolder(kb) }] };
}

async function arvore(dir) {
  const itens = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      const arquivo = path.join(entry.parentPath ?? entry.path, entry.name);
      itens.push(`${path.relative(dir, arquivo)}:${createHash('sha256').update(await readFile(arquivo)).digest('hex')}`);
    }
  }
  return itens.sort().join('\n');
}

test('o frontmatter lê aspas, números pt-BR em lista e lista em bloco', () => {
  const { data } = parseFrontmatter('---\nempresa: "Empresa Alfa"\nnumeros: ["58%", "36,18", 8]\nuso: [CV, Ent]\ncargos:\n  - "A"\n  - B\n---\nCorpo');
  assert.equal(data.empresa, 'Empresa Alfa');
  assert.deepEqual(data.numeros, ['58%', '36,18', '8']);
  assert.deepEqual(data.uso, ['CV', 'Ent']);
  assert.deepEqual(data.cargos, ['A', 'B']);
});

test('o adaptador lê os campos extras da afirmação, histórias, modelos de CV e preferências', async () => {
  const fonte = createMarkdownFolder(personaQuadrantes);
  const af = (await fonte.claims()).find(c => c.id === 'AF-101');
  assert.deepEqual([af.empresa, af.periodo, af.uso, af.publicavel, af.numeros], ['Empresa Alfa', '2018-01..2019-12', ['CV', 'Ent'], 'com-anonimizacao', ['34%', '12', '8']]);
  assert.deepEqual((await fonte.stories()).map(s => [s.id, s.afirmacoes]), [['HI-101', ['AF-101']], ['HI-102', []]]);
  assert.equal((await fonte.cvTemplates())[0].modelo, 'modelo-base');
  const preferencias = await fonte.preferences();
  assert.equal(preferencias.cargo_alvo, 'Analista de Operações');
  assert.deepEqual(preferencias.cargos_alvo, ['Analista de Operações', 'Coordenadora de Processos']);
});

test('claims.local.md com vários blocos entra como afirmações confirmadas', async t => {
  const { kb } = await ambiente(t);
  await writeFile(path.join(kb, 'claims.local.md'), '---\nid: AFL-001\nnivel_prova: relato\nuso: [Ent]\n---\nPrimeira.\n\n---\nid: AFL-002\nnivel_prova: relato\n---\nSegunda.\n');
  const claims = await createMarkdownFolder(kb).claims();
  assert.deepEqual(claims.filter(c => c.arquivo === 'claims.local.md').map(c => [c.id, c.texto]), [['AFL-001', 'Primeira.'], ['AFL-002', 'Segunda.']]);
});

test('o snapshot da persona tem hash estável entre execuções e entre pastas', async t => {
  const a = await ambiente(t);
  const b = await ambiente(t);
  const primeiro = await syncKb({ dataRoot: a.dataRoot, fontes: a.fontes });
  const segundo = await syncKb({ dataRoot: a.dataRoot, fontes: a.fontes });
  const outro = await syncKb({ dataRoot: b.dataRoot, fontes: b.fontes });
  assert.match(primeiro.hash, /^[0-9a-f]{16}$/);
  assert.equal(segundo.hash, primeiro.hash);
  assert.equal(segundo.mudou, false);
  assert.equal(outro.hash, primeiro.hash);
  assert.equal(primeiro.contagem.afirmacoes, 8);
  assert.equal((await lerSnapshot(a.dataRoot)).hash, primeiro.hash);
});

test('arquivo alterado muda o hash e invalida o cache dependente', async t => {
  const a = await ambiente(t);
  const antes = await syncKb({ dataRoot: a.dataRoot, fontes: a.fontes });
  await gravarDependente(a.dataRoot, 'avaliacoes', antes.hash, { ok: 1 });
  await gravarDependente(a.dataRoot, 'cv', antes.hash, { ok: 2 });
  assert.deepEqual(await lerDependente(a.dataRoot, 'avaliacoes', antes.hash), { ok: 1 });
  const arquivo = path.join(a.kb, 'claims', 'AF-105.md');
  await writeFile(arquivo, (await readFile(arquivo, 'utf8')).replace('Treinou 3 pessoas', 'Treinou 4 pessoas'));
  const depois = await syncKb({ dataRoot: a.dataRoot, fontes: a.fontes });
  assert.notEqual(depois.hash, antes.hash);
  assert.equal(depois.mudou, true);
  assert.deepEqual(depois.invalidou, ['avaliacoes', 'cv']);
  assert.equal(await lerDependente(a.dataRoot, 'avaliacoes', antes.hash), null);
  assert.equal(await lerDependente(a.dataRoot, 'avaliacoes', depois.hash), null);
});

test('a identidade vai para identity.yml local e nenhum valor dela entra no snapshot', async t => {
  const a = await ambiente(t);
  await writeFile(path.join(a.kb, 'claims', 'AF-120.md'), '---\nid: AF-120\nnivel_prova: relato\n---\nAna Quadrantes escreveu para ana.quadrantes@exemplo.test sobre o tema.\n');
  const r = await syncKb({ dataRoot: a.dataRoot, fontes: a.fontes });
  assert.equal(r.identidade_copiada, true);
  const local = JSON.parse(await readFile(path.join(a.dataRoot, 'identity.yml'), 'utf8'));
  assert.equal(local.nome, 'Ana Quadrantes');
  const snapshot = await readFile(path.join(a.dataRoot, 'state', 'kb-snapshot.json'), 'utf8');
  for (const valor of ['Ana Quadrantes', 'ana.quadrantes@exemplo.test', '+55 00 90000-0000', '000.000.000-00']) assert.ok(!snapshot.includes(valor), valor);
  assert.match(snapshot, /\[REDIGIDO\]/);
});

test('identity.yml local já preenchido nunca é sobrescrito', async t => {
  const a = await ambiente(t);
  await writeFile(path.join(a.dataRoot, 'identity.yml'), JSON.stringify({ nome: 'Outra Pessoa Fictícia' }));
  const r = await syncKb({ dataRoot: a.dataRoot, fontes: a.fontes });
  assert.equal(r.identidade_copiada, false);
  assert.equal(JSON.parse(await readFile(path.join(a.dataRoot, 'identity.yml'), 'utf8')).nome, 'Outra Pessoa Fictícia');
});

test('fonte ilegível dá erro nomeado e preserva o snapshot anterior', async t => {
  const a = await ambiente(t);
  const bom = await syncKb({ dataRoot: a.dataRoot, fontes: a.fontes });
  const antes = await readFile(path.join(a.dataRoot, 'state', 'kb-snapshot.json'), 'utf8');
  await writeFile(path.join(a.kb, 'claims', 'AF-130.md'), '---\nid: AF-130\nnivel_prova: inventado\n---\nTexto.\n');
  await assert.rejects(syncKb({ dataRoot: a.dataRoot, fontes: a.fontes }), /kb sync: fonte ilegível.*claims\/AF-130\.md.*nivel_prova.*Snapshot anterior preservado/);
  assert.equal(await readFile(path.join(a.dataRoot, 'state', 'kb-snapshot.json'), 'utf8'), antes);
  assert.equal((await lerSnapshot(a.dataRoot)).hash, bom.hash);
});

test('kb sync não escreve fora do DATA_ROOT nem na pasta de origem', async t => {
  const dataRoot = await tempDir(t);
  const externa = path.join(await tempDir(t), 'base');
  await cp(personaQuadrantes, externa, { recursive: true });
  await writeFile(path.join(externa, 'identity.yml'), JSON.stringify(IDENTIDADE));
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  const antes = await arvore(externa);
  const vizinho = await arvore(path.dirname(externa));
  const r = await syncKb({ dataRoot, fontes: [{ nome: 'markdown-folder', fonte: createMarkdownFolder(externa) }] });
  assert.equal(await arvore(externa), antes);
  assert.equal(await arvore(path.dirname(externa)), vizinho);
  assert.ok((await lerSnapshot(dataRoot)).hash === r.hash);
});

test('bin kb sync lê DATA_ROOT/kb, imprime o resumo e repete sem mudança', async t => {
  const a = await ambiente(t);
  const primeiro = run(['kb', 'sync', '--json'], { dataRoot: a.dataRoot });
  assert.equal(primeiro.status, 0, primeiro.stderr);
  assert.equal(primeiro.json.contagem.afirmacoes, 8);
  const segundo = run(['kb', 'sync', '--json'], { dataRoot: a.dataRoot });
  assert.equal(segundo.json.mudou, false);
  assert.equal(segundo.json.hash, primeiro.json.hash);
  const texto = run(['kb', 'sync'], { dataRoot: a.dataRoot });
  assert.match(texto.stdout, /sem mudança.*8 afirmações/);
  assert.equal(run(['kb', 'nada'], { dataRoot: a.dataRoot }).status, 2);
});

test('pasta kb vazia gera snapshot vazio sem erro', async t => {
  const dataRoot = await tempDir(t);
  await mkdir(path.join(dataRoot, 'kb'));
  const r = run(['kb', 'sync', '--json'], { dataRoot });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.contagem.afirmacoes, 0);
});
