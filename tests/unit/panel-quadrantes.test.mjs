import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const IDENTIDADE = { nome: 'Ana Quadrantes', email: 'ana.quadrantes@exemplo.test', telefone: '+55 00 90000-0000', cpf: '000.000.000-00' };

async function ambiente(t, { kb = true, modo = 'ativo' } = {}) {
  const dataRoot = await tempDir(t);
  const put = async (relativo, dado) => { const alvo = path.join(dataRoot, relativo); await mkdir(path.dirname(alvo), { recursive: true }); await writeFile(alvo, typeof dado === 'string' ? dado : JSON.stringify(dado)); };
  await put('state/migration.json', { version: 1, mode: modo, snapshotRoot: null });
  await put('projections/pipeline-vagas.json', { vagas: [] });
  await put('identity.yml', IDENTIDADE);
  await mkdir(path.join(dataRoot, 'events'), { recursive: true });
  if (kb) await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });
  const panel = await startPanel({ dataRoot, port: 0 });
  t.after(panel.close);
  const pagina = await (await fetch(panel.url)).text();
  const token = JSON.parse(/window\.PAINEL_API=(\{[^;]+\});/.exec(pagina)[1]).token;
  const api = (headers = {}) => fetch(`${panel.url}/api/quadrantes`, { headers });
  return { dataRoot, panel, pagina, token, api, put };
}

test('GET /api/quadrantes exige o token do painel', async t => {
  const a = await ambiente(t);
  assert.equal((await a.api()).status, 403);
  assert.equal((await a.api({ 'X-Painel-Token': 'errado' })).status, 403);
  const post = await fetch(`${a.panel.url}/api/quadrantes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: a.panel.url, 'X-Painel-Token': a.token }, body: '{}' });
  assert.equal(post.status, 403);
  assert.equal((await a.api({ 'X-Painel-Token': a.token })).status, 200);
});

test('devolve os quatro quadrantes com contagem e itens', async t => {
  const a = await ambiente(t);
  const resposta = await a.api({ 'X-Painel-Token': a.token });
  const corpo = await resposta.json();
  assert.equal(corpo.estado, 'ok');
  assert.deepEqual([corpo.contagem.a, corpo.contagem.b, corpo.contagem.c], [1, 3, 4]);
  assert.equal(corpo.contagem.d, 4, "sem vagas no log, só as lacunas da base");
  assert.equal(corpo.a.length, 1);
  assert.deepEqual(corpo.b.map(x => x.id), ['AF-104', 'AF-106', 'HI-102']);
  assert.ok(corpo.c.every(x => x.motivo && x.codigo));
  assert.ok(corpo.d.every(x => x.pergunta_sugerida && typeof x.peso === 'number'));
  assert.equal(corpo.d[0].peso >= corpo.d.at(-1).peso, true);
  assert.equal(resposta.headers.get('cache-control'), 'no-store');
});

test('sem dados e com erro a resposta é definida: sem_dados vazio e erro 500 sem vazar detalhe interno', async t => {
  const vazio = await ambiente(t, { kb: false });
  const semDados = await (await vazio.api({ 'X-Painel-Token': vazio.token })).json();
  assert.equal(semDados.estado, 'sem_dados');
  assert.deepEqual(semDados.contagem, { a: 0, b: 0, c: 0, d: 0 });
  assert.match(semDados.mensagem, /kb sync|base/i);
  const ruim = await ambiente(t);
  await ruim.put('kb/claims/AF-130.md', '---\nid: AF-130\nnivel_prova: inventado\n---\nTexto.\n');
  const resposta = await ruim.api({ 'X-Painel-Token': ruim.token });
  assert.equal(resposta.status, 500);
  const erro = await resposta.json();
  assert.equal(erro.estado, 'erro');
  assert.match(erro.erro, /Não foi possível/);
  assert.match(erro.detalhe, /AF-130\.md.*nivel_prova/);
  assert.ok(!erro.detalhe.includes(ruim.dataRoot));
});

test('nenhum texto da identidade aparece na API nem na página', async t => {
  const a = await ambiente(t);
  await a.put('kb/claims/AF-150.md', '---\nid: AF-150\nnivel_prova: verificado\nuso: [CV]\npublicavel: sim\n---\nAna Quadrantes apresentou o painel a 8 gestores.\n');
  const texto = await (await a.api({ 'X-Painel-Token': a.token })).text();
  assert.match(texto, /AF-150/);
  for (const valor of Object.values(IDENTIDADE)) {
    assert.ok(!texto.includes(valor), `API: ${valor}`);
    assert.ok(!a.pagina.includes(valor), `página: ${valor}`);
  }
  assert.match(texto, /\[REDIGIDO\] apresentou/);
});

// Parser mínimo: confere que as tags do trecho injetado abrem e fecham em ordem.
function tags(html) {
  const pilha = [];
  const vazias = new Set(['br', 'meta', 'link', 'input', 'img', 'hr']);
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const [, fecha, nome, resto] = m;
    if (vazias.has(nome.toLowerCase()) || resto.endsWith('/')) continue;
    if (!fecha) pilha.push(nome.toLowerCase());
    else assert.equal(pilha.pop(), nome.toLowerCase(), `tag </${nome}> fora de ordem`);
  }
  assert.deepEqual(pilha, []);
}

test('a aba Quadrantes renderiza no HTML gerado, com estados e sem recurso externo', async t => {
  for (const modo of ['ativo', 'shadow']) {
    const a = await ambiente(t, { modo });
    const pagina = a.pagina;
    const abas = [...pagina.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map(m => m[1]);
    assert.deepEqual(abas, ['Vagas', 'Quadrantes', 'Perguntas'], modo);
    assert.match(pagina, /<nav id="abas-painel" aria-label="Abas do painel">/);
    assert.match(pagina, /<section id="quadrantes-painel" role="tabpanel" aria-labelledby="aba-quadrantes" data-aba-painel="quadrantes" hidden>/);
    assert.match(pagina, /fetch\('\/api\/quadrantes'/);
    for (const texto of ['Carregando quadrantes', 'Não foi possível carregar', 'Nada para mostrar ainda', 'Sem permissão', 'Tentar de novo']) assert.ok(pagina.includes(texto), texto);
    const injetado = pagina.slice(pagina.indexOf('<nav id="abas-painel"'), pagina.indexOf('</nav>') + 6) + pagina.slice(pagina.indexOf('<section id="quadrantes-painel"'), pagina.indexOf('</section>', pagina.indexOf('<section id="quadrantes-painel"')) + 10);
    tags(injetado);
    assert.ok(!/https?:\/\//.test(injetado), 'sem URL externa');
    assert.ok(!/innerHTML/.test(pagina.slice(pagina.indexOf('quadrantes-painel-script'))), 'dados entram por textContent');
  }
});
