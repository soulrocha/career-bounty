import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { auditTemplate } from '../../core/privacy/auditTemplate.mjs';
import { buildContext } from '../../core/privacy/scan.mjs';
import { PUBLIC_TEMPLATE, resolveTemplate } from '../../panel/template.mjs';

const persona = JSON.parse(await readFile(path.join(repoRoot, 'examples/persona-ficticia/identity.yml'), 'utf8'));

// Dados "reais" montados por partes: o código-fonte do teste não contém e-mail, telefone nem CPF literais.
function cpfValido() {
  const base = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const digito = (lista, peso) => ((lista.reduce((soma, n, i) => soma + n * (peso - i), 0) * 10) % 11) % 10;
  const d1 = digito(base, 10);
  const d2 = digito([...base, d1], 11);
  return `${base.slice(0, 3).join('')}.${base.slice(3, 6).join('')}.${base.slice(6, 9).join('')}-${d1}${d2}`;
}
const email = ['fulana', ['dominio', 'com', 'br'].join('.')].join('@');
const telefone = `(31) 9${'8765'}-${'4321'}`;
const caminho = ['C:', 'Users', 'fulana', 'Documentos'].join('\\');
const foto = `data:image/png;base64,${randomBytes(600).toString('base64')}`;

const sujo = [
  '<!doctype html><html><body>',
  `<img src="${foto}" alt="foto">`,
  `<p>Contato ${email}</p>`,
  `<p>Telefone ${telefone}</p>`,
  `<p>CPF ${cpfValido()}</p>`,
  `<p>${persona.nome}</p>`,
  `<p>Arquivo em ${caminho}</p>`,
  '<p>Trabalhei na Empresa Zeta por anos</p>',
  '</body></html>',
].join('\n');

// A CLI de teste isola IDENTITY_FILE; a identidade fictícia entra pelo DATA_ROOT, como no uso real.
async function comIdentidade(t) {
  const dataRoot = await tempDir(t);
  await writeFile(path.join(dataRoot, 'identity.yml'), JSON.stringify(persona));
  return dataRoot;
}

async function ambiente(t) {
  const dataRoot = await comIdentidade(t);
  await mkdir(path.join(dataRoot, 'privacy'), { recursive: true });
  await writeFile(path.join(dataRoot, 'privacy/denylist.txt'), 'Empresa Zeta\n');
  const arquivo = path.join(dataRoot, 'template-sujo.html');
  await writeFile(arquivo, sujo);
  return { dataRoot, arquivo };
}

test('audit-template acusa foto em base64, e-mail, telefone, CPF, identidade, caminho de usuário e empresa da denylist, e sai com 1', async t => {
  const { dataRoot, arquivo } = await ambiente(t);
  const result = run(['audit-template', arquivo, '--json'], { dataRoot });
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.json.ok, false);
  const tipos = new Set(result.json.achados.map(a => a.tipo));
  for (const esperado of ['imagem-base64', 'email', 'telefone', 'cpf', 'identidade', 'caminho-usuario', 'empresa-denylist']) assert.ok(tipos.has(esperado), `faltou ${esperado}`);
  assert.deepEqual(result.json.achados.find(a => a.tipo === 'imagem-base64'), { tipo: 'imagem-base64', linha: 2, coluna: 11 });
});

test('o relatório nunca imprime o valor encontrado, só tipo e posição', async t => {
  const { dataRoot, arquivo } = await ambiente(t);
  for (const json of [true, false]) {
    const result = run(['audit-template', arquivo, ...(json ? ['--json'] : [])], { dataRoot });
    const saida = result.stdout + result.stderr;
    for (const valor of [email, telefone, cpfValido(), persona.nome, caminho, 'fulana', 'Empresa Zeta', foto.slice(30, 80)]) assert.ok(!saida.includes(valor), `vazou ${valor.slice(0, 6)}...`);
    assert.match(saida, /imagem-base64/);
  }
});

test('um template limpo sai com 0 e lista o que verificou', async t => {
  const dataRoot = await comIdentidade(t);
  const arquivo = path.join(dataRoot, 'limpo.html');
  await writeFile(arquivo, '<html><body><h1>Radar</h1><p>Texto sem dado pessoal.</p></body></html>');
  const result = run(['audit-template', arquivo, '--json'], { dataRoot });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.ok, true);
  assert.deepEqual(result.json.achados, []);
  for (const tipo of ['imagem-base64', 'email', 'telefone', 'identidade']) assert.ok(result.json.verificados.includes(tipo), tipo);
  const texto = run(['audit-template', arquivo], { dataRoot });
  assert.match(texto.stdout, /verificado: .*imagem-base64/);
  assert.match(texto.stdout, /ok$/m);
});

test('sem identity.yml o relatório avisa que a identidade não foi verificada', () => {
  const report = auditTemplate('<p>texto</p>', buildContext());
  assert.equal(report.ok, true);
  assert.ok(!report.verificados.includes('identidade'));
  assert.match(report.avisos[0], /identity\.yml ausente/);
});

test('imagem pequena (ícone) não é tratada como foto, mas imagem grande sim', () => {
  assert.equal(auditTemplate('<img src="data:image/png;base64,iVBORw0KGgo=">', buildContext()).ok, true);
  assert.equal(auditTemplate(`<img src="${foto}">`, buildContext()).achados[0].tipo, 'imagem-base64');
});

test('o template público do repositório passa na auditoria e usa placeholders, sem foto', async t => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');
  const report = auditTemplate(html, buildContext({ identity: persona }));
  assert.deepEqual(report.achados, []);
  assert.ok(html.includes('__DATA__') && html.includes('__STAMP__'));
  assert.ok(!/data:image/i.test(html));
  assert.ok(!/<img\b/i.test(html), 'sem imagem embutida: o avatar nasce das iniciais do perfil');
  const cli = run(['audit-template', PUBLIC_TEMPLATE, '--json'], { dataRoot: await comIdentidade(t) });
  assert.equal(cli.status, 0, cli.stdout);
});

test('template privado em DATA_ROOT/templates tem preferência; sem ele, vale o público', async t => {
  const dataRoot = await tempDir(t);
  assert.equal((await resolveTemplate({ dataRoot })).origem, 'publico');
  await mkdir(path.join(dataRoot, 'templates'), { recursive: true });
  await writeFile(path.join(dataRoot, 'templates/painel-template.html'), '<html>privado __DATA__</html>');
  const escolhido = await resolveTemplate({ dataRoot });
  assert.equal(escolhido.origem, 'privado');
  assert.match(escolhido.html, /privado/);
  assert.equal((await resolveTemplate({})).origem, 'publico');
});

test('audit-template exige o arquivo', async t => {
  const result = run(['audit-template', '--json'], { dataRoot: await tempDir(t) });
  assert.equal(result.status, 2);
});
