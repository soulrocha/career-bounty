import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { tempRepo } from '../helpers/git.mjs';
import { buildContext, scanContent, scanText } from '../../core/privacy/scan.mjs';

// Tudo é montado em pedaços ou em tempo de execução para o arquivo de teste não conter o padrão literal.
const IDENTITY = { nome: 'Fulano Identidade Silva', email: ['fulano.identidade', 'provedor-exemplo.invalid'].join('@'), documento: 'ref-interna-98765' };
const withIdentity = buildContext({ identity: IDENTITY });
const generic = buildContext();
const rules = (text, context = generic, file = 'a.md') => [...new Set(scanText(text, context, file).map(f => f.rule))];
const b64 = text => Buffer.from(text, 'utf8').toString('base64');
const realEmail = ['joao.silva', 'provedor.com'].join('@');

function cpfWithCheckDigits(base) {
  const digits = base.split('').map(Number);
  for (const size of [9, 10]) {
    const sum = digits.slice(0, size).reduce((acc, d, i) => acc + d * (size + 1 - i), 0);
    digits.push(((sum * 10) % 11) % 10);
  }
  return digits.join('');
}

test('e-mail da identidade com espaços, (at), [at] e (dot) é detectado', () => {
  for (const text of [
    'fulano.identidade @ provedor-exemplo.invalid',
    'fulano.identidade (at) provedor-exemplo.invalid',
    'fulano.identidade [at] provedor-exemplo [dot] invalid',
    'FULANO . IDENTIDADE  @  PROVEDOR-EXEMPLO . INVALID',
    'Fulano   Identidade   Silva',
  ]) assert.ok(rules(text, withIdentity).includes('identidade'), text);
  assert.deepEqual(rules('nada a ver com ninguém', withIdentity), []);
});

test('regra genérica de e-mail pega espaços e (at); exemplos e noreply passam', () => {
  for (const text of [realEmail, realEmail.replace('@', ' @ ').replace('.com', ' . com'), realEmail.replace('@', ' (at) '), realEmail.replace('@', '[at]')]) {
    assert.ok(rules(text).includes('email'), text);
  }
  const ok = ['ana@example.com', 'ana@exemplo.test', 'ana@qualquer.test', 'ana@dominio.invalid', '22529786+x@users.noreply.github.com',
    'noreply@github.com', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', 'arroba @ 10 e fim.'];
  for (const text of ok) assert.deepEqual(rules(text), [], text);
});

test('e-mail em base64 é decodificado e reescaneado, inclusive em bloco quebrado em linhas', () => {
  assert.ok(rules(`token=${b64(IDENTITY.email)}`, withIdentity).includes('identidade'));
  assert.ok(rules(`dados: ${b64(`contato ${realEmail}`)}`).includes('email'));
  const blob = b64(`contato ${realEmail} e mais texto para quebrar em linhas`);
  const lines = blob.match(/.{1,20}/g).join('\n');
  assert.ok(rules(lines).includes('email'));
  assert.ok(rules(`token=${b64(b64(realEmail))}`).includes('email'));
  assert.deepEqual(rules('InternationalizationServiceFactoryBean e abcdefghijklmnopqrstuvwxyz0123456789'), []);
});

test('arquivo UTF-16 (com e sem BOM) e arquivo com NUL são escaneados', () => {
  const text = `contato ${realEmail}\n`;
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.from(le).swap16();
  const cases = [
    Buffer.concat([Buffer.from([0xff, 0xfe]), le]),
    Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
    le,
    be,
    Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(text)]),
  ];
  for (const buffer of cases) assert.ok(scanContent(buffer, generic, 'x.txt').some(f => f.rule === 'email'));
  assert.deepEqual(scanContent(Buffer.from([0, 1, 2, 0, 255, 254, 0]), generic, 'x.bin'), []);
  assert.deepEqual(scanContent(Buffer.concat([Buffer.from([0, 1]), Buffer.from(text)]), generic, 'logo.png'), []);
});

test('nome da pessoa no NOME do arquivo é achado sem imprimir o nome', () => {
  const findings = scanContent(Buffer.from('conteudo limpo\n'), withIdentity, 'docs/curriculo fulano identidade silva.md', 3);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'identidade');
  assert.ok(!/fulano/i.test(findings[0].file));
  assert.deepEqual(scanContent(Buffer.from('limpo\n'), withIdentity, 'docs/curriculo.md'), []);
});

test('telefone com espaços e fixo bloqueiam; datas e números soltos passam', () => {
  const join = (...parts) => parts.join('');
  for (const text of [join('31 9 ', '8765 4321'), join('(31) 9 ', '8765-4321'), join('(31) 34', '56-7890'), join('+55 31 34', '56 7890'), join('31 34', '56-7890')])
    assert.ok(rules(text).includes('telefone'), text);
  for (const text of ['2026-10-14', '1752345678', 'versão 12.345.678', 'porta 3456 7890'])
    assert.ok(!rules(text).includes('telefone'), text);
});

test('CPF com espaços bloqueia', () => {
  const d = cpfWithCheckDigits('123456789');
  for (const text of [`${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)} - ${d.slice(9)}`, d])
    assert.ok(rules(text).includes('cpf'), text);
});

test('caminho de usuário: minúsculo e sem barra final bloqueiam; placeholders passam', () => {
  const win = name => ['C:', 'Users', name].join('\\');
  const unix = name => ['', 'home', name].join('/');
  const mac = name => ['', 'Users', name].join('/');
  for (const text of [win('maria'), win('maria').toLowerCase(), `${win('maria')}\\x`, unix('maria'), `ver ${unix('maria')}.`, mac('maria'), `"${win('maria')}"`])
    assert.ok(rules(text).includes('caminho-usuario'), text);
  for (const text of [win('<usuario>'), win('%USERNAME%'), unix('<usuario>'), mac('$USER'), 'o diretório /home/ do Linux', 'https://x.test/home/a'])
    assert.deepEqual(rules(text), [], text);
});

test('caminho de Vault bloqueia', () => {
  for (const text of [['C:', 'Vault', 'nota.md'].join('\\'), ['c:', 'vault'].join('\\'), ['', 'Vault', 'y'].join('\\'), ['', 'Vault', 'nota'].join('/')])
    assert.ok(rules(text).includes('caminho-vault'), text);
  assert.deepEqual(rules('HashiCorp Vault e vault_root'), []);
});

test('identificador do repositório só é liberado no README', () => {
  const context = buildContext({ identity: { usuario: 'soulrocha' } });
  const text = 'https://github.com/soulrocha/career-bounty';
  assert.deepEqual(rules(text, context, 'README.md'), []);
  assert.deepEqual(rules(text, context, 'README.en.md'), []);
  assert.deepEqual(rules('veja soulrocha/career-bounty e soulrocha', context, 'README.md'), ['identidade']);
  assert.ok(rules(text, context, 'docs/x.md').includes('identidade'));
});

test('mensagem de commit aplica as mesmas normalizações; trailer noreply passa', async t => {
  const dataRoot = await tempDir(t, 'cb-dados-');
  await writeFile(path.join(dataRoot, 'identity.yml'), JSON.stringify(IDENTITY));
  const repo = await tempRepo(t, { dataRoot });
  await repo.write('limpo.md', 'nada\n');
  assert.equal(repo.commit('contato fulano.identidade (at) provedor-exemplo.invalid').status, 1);
  assert.equal(repo.commit(`contato ${realEmail}`).status, 1);
  assert.equal(repo.commit(`token ${b64(IDENTITY.email)}`).status, 1);
  assert.equal(repo.commit('ok\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>').status, 0);
});

test('commit com arquivo UTF-16 e com nome da pessoa é bloqueado', async t => {
  const dataRoot = await tempDir(t, 'cb-dados-');
  await writeFile(path.join(dataRoot, 'identity.yml'), JSON.stringify(IDENTITY));
  const a = await tempRepo(t, { dataRoot });
  await a.write('u16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`x ${IDENTITY.email}`, 'utf16le')]));
  const blocked = a.commit();
  assert.equal(blocked.status, 1);
  assert.ok(!blocked.stderr.includes(IDENTITY.email));
  const b = await tempRepo(t, { dataRoot });
  await b.write('Fulano Identidade Silva.md', 'limpo\n');
  const named = b.commit();
  assert.equal(named.status, 1);
  assert.ok(!/fulano/i.test(named.stderr));
});
