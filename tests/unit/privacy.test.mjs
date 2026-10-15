import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir, run } from '../helpers/cli.mjs';
import { tempRepo } from '../helpers/git.mjs';

const IDENTITY = { nome: 'Fulano Identidade Silva', email: 'fulano.identidade@provedor-exemplo.invalid', documento: 'ref-interna-98765' };

function cpfWithCheckDigits(base) {
  const digits = base.split('').map(Number);
  for (const size of [9, 10]) {
    const sum = digits.slice(0, size).reduce((acc, d, i) => acc + d * (size + 1 - i), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  const s = digits.join('');
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
}

// Montados em pedaços para que este arquivo de teste não contenha o padrão literal.
const winUserPath = name => ['C:', 'Users', name, 'Documentos', 'cv.md'].join('\\');
const unixHome = name => ['', 'home', name, 'projetos'].join('/');
const macHome = name => ['', 'Users', name, 'projetos'].join('/');

async function setup(t, { identity = IDENTITY, denylist } = {}) {
  const dataRoot = await tempDir(t, 'cb-dados-');
  if (identity) await writeFile(path.join(dataRoot, 'identity.yml'), JSON.stringify(identity));
  if (denylist) {
    await mkdir(path.join(dataRoot, 'privacy'));
    await writeFile(path.join(dataRoot, 'privacy', 'denylist.txt'), denylist.join('\n'));
  }
  return tempRepo(t, { dataRoot });
}

test('valor da identidade bloqueia o commit citando arquivo e linha, sem imprimir o valor', async t => {
  const repo = await setup(t);
  await repo.write('notas.md', `linha um\ncontato: ${IDENTITY.email}\n`);
  const result = repo.commit();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /notas\.md:2/);
  assert.ok(!result.stderr.includes(IDENTITY.email));
  assert.ok(!result.stderr.includes('provedor-exemplo'));
  assert.ok(!result.stdout.includes(IDENTITY.email));
});

test('CPF válido por dígito verificador bloqueia; CPF inválido e sequência repetida passam', async t => {
  const repo = await setup(t);
  await repo.write('a.md', `cpf ${cpfWithCheckDigits('123456789')}\n`);
  assert.equal(repo.commit().status, 1);
  const ok = await setup(t);
  await ok.write('b.md', 'cpf 123.456.789-00\ncpf 000.000.000-00\ncpf 111.111.111-11\n');
  assert.equal(ok.commit().status, 0);
});

test('telefone brasileiro bloqueia; DDD inválido e texto comum passam', async t => {
  const repo = await setup(t);
  await repo.write('a.md', `ligar ${['+55', '31', '91234-5678'].join(' ')} depois\n`);
  assert.equal(repo.commit().status, 1);
  const ok = await setup(t);
  await ok.write('b.md', 'fictício: +55 00 90000-0000 e versão 1.2.3 e 2026-10-14\n');
  assert.equal(ok.commit().status, 0);
});

test('caminho absoluto de usuário bloqueia nas três plataformas; placeholders passam', async t => {
  for (const content of [winUserPath('maria'), unixHome('maria'), macHome('maria'), winUserPath('maria').replaceAll('\\', '\\\\')]) {
    const repo = await setup(t);
    await repo.write('a.md', `caminho ${content}\n`);
    assert.equal(repo.commit().status, 1, content);
  }
  const ok = await setup(t);
  await ok.write('b.md', [winUserPath('<usuario>'), '%USERPROFILE%\\x', '~/.career-bounty', unixHome('<usuario>'), macHome('$USER')].join('\n'));
  assert.equal(ok.commit().status, 0);
});

test('valores da persona fictícia e domínios .test passam', async t => {
  const repo = await setup(t);
  await repo.write('persona.md', 'Ana Exemplo, ana@exemplo.test, +55 00 90000-0000, https://vaga.exemplo.test/x\n');
  assert.equal(repo.commit().status, 0);
});

test('sem identity.yml roda só as regras genéricas e avisa', async t => {
  const repo = await setup(t, { identity: null });
  await repo.write('a.md', `contato ${IDENTITY.email}\n`);
  const result = repo.commit();
  assert.equal(result.status, 0);
  assert.match(result.stderr, /identity\.yml ausente/);
  const blocked = await setup(t, { identity: null });
  await blocked.write('b.md', `cpf ${cpfWithCheckDigits('987654321')}\n`);
  assert.equal(blocked.commit().status, 1);
});

test('binário sem texto legível passa; binário com texto da identidade é bloqueado; imagem é ignorada', async t => {
  const limpo = await setup(t);
  await limpo.write('dados.bin', Buffer.from([0, 1, 2, 0, 255, 254, 0, 9]));
  assert.equal(limpo.commit().status, 0);
  const sujo = await setup(t);
  await sujo.write('dados.bin', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(IDENTITY.email)]));
  assert.equal(sujo.commit().status, 1);
  const imagem = await setup(t);
  await imagem.write('imagem.png', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(IDENTITY.email)]));
  assert.equal(imagem.commit().status, 0);
});

test('denylist de empresas em DATA_ROOT/privacy bloqueia ocorrência sem imprimir o nome', async t => {
  const repo = await setup(t, { denylist: ['Nome Real Sociedade', 'ab'] });
  await repo.write('a.md', 'trabalhei na nome real sociedade por anos\n');
  const result = repo.commit();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /a\.md:1/);
  assert.ok(!/nome real sociedade/i.test(result.stderr));
  const ok = await setup(t, { denylist: ['Nome Real Sociedade', 'ab'] });
  await ok.write('b.md', 'Empresa Alfa, abacaxi e subnome real sociedadex\n');
  assert.equal(ok.commit().status, 0);
});

test('commit-msg aplica as mesmas regras à mensagem', async t => {
  const repo = await setup(t);
  await repo.write('limpo.md', 'nada\n');
  const result = repo.commit(`ajuste de ${IDENTITY.email}`);
  assert.equal(result.status, 1);
  assert.ok(!result.stderr.includes(IDENTITY.email));
  assert.equal(repo.commit('mensagem limpa').status, 0);
});

test('build-denylist gera a lista a partir das empresas do pipeline legado', async t => {
  const root = await tempDir(t);
  const dataRoot = path.join(root, 'dados');
  const careerRoot = path.join(root, 'legado', 'carreira');
  await mkdir(dataRoot);
  await mkdir(path.join(careerRoot, 'busca-vagas'), { recursive: true });
  await mkdir(path.join(root, 'legado', 'curriculos'));
  await writeFile(path.join(careerRoot, 'pipeline-vagas.json'), JSON.stringify({ vagas: [
    { id: '1', empresa: 'Razão Social Quatro' }, { id: '2', empresa: 'Razão Social Quatro' }, { id: '3', empresa: 'Outra Fantasia' }, { id: '4' },
  ] }));
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({
    legado_path: path.join(careerRoot, 'pipeline-vagas.json'),
    legacy_assets: path.join(careerRoot, 'busca-vagas'),
    legacy_materials: path.join(root, 'legado', 'curriculos'),
  }));
  const result = run(['privacy', 'build-denylist', '--json'], { dataRoot });
  assert.equal(result.status, 0);
  assert.equal(result.json.entries, 2);
  assert.ok(!result.stdout.includes('Razão'));
  const file = await readFile(path.join(dataRoot, 'privacy', 'denylist.txt'), 'utf8');
  assert.deepEqual(file.trim().split('\n').sort(), ['Outra Fantasia', 'Razão Social Quatro']);
});

test('scan --all varre os arquivos versionados do diretório atual', async t => {
  const repo = await setup(t);
  await repo.write('a.md', `cpf ${cpfWithCheckDigits('555666777')}\n`);
  const result = run(['privacy', 'scan', '--all', '--json'], { dataRoot: repo.env.DATA_ROOT, cwd: repo.dir });
  assert.equal(result.status, 1);
  assert.equal(result.json.findings[0].file, 'a.md');
  assert.equal(result.json.findings[0].rule, 'cpf');
});

test('testes ignoram IDENTITY_FILE e DATA_ROOT herdados do ambiente', async t => {
  const dir = await tempDir(t, 'cb-herdado-');
  const herdado = path.join(dir, 'real.json');
  await writeFile(herdado, JSON.stringify({ nome: 'Pessoa Herdada Ambiente', email: 'herdado@ambiente-real.invalid' }));
  const antes = { IDENTITY_FILE: process.env.IDENTITY_FILE, DATA_ROOT: process.env.DATA_ROOT };
  process.env.IDENTITY_FILE = herdado;
  process.env.DATA_ROOT = dir;
  t.after(() => { for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const repo = await setup(t, { identity: null });
  await repo.write('a.md', 'contato herdado@ambiente-real.invalid\n');
  assert.equal(repo.commit().status, 0);
  const cli = run(['privacy', 'scan', '--all', '--json'], { dataRoot: repo.env.DATA_ROOT, cwd: repo.dir });
  assert.equal(cli.status, 0);
});
