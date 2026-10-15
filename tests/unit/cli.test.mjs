import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../../bin/career-bounty.mjs', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('--version imprime a versão do pacote e termina com sucesso', () => {
  const result = run('--version');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${version}\n`);
  assert.equal(result.stderr, '');
});

test('subcomando desconhecido termina com 2 e erro em português no stderr', () => {
  const result = run('inexistente');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Comando desconhecido: inexistente\n');
});

test('--json produz JSON no stdout tanto no sucesso quanto no erro', () => {
  const success = run('--version', '--json');
  assert.equal(success.status, 0);
  assert.deepEqual(JSON.parse(success.stdout), { version });
  assert.equal(success.stderr, '');

  const failure = run('inexistente', '--json');
  assert.equal(failure.status, 2);
  assert.deepEqual(JSON.parse(failure.stdout), { error: 'Comando desconhecido: inexistente' });
  assert.equal(failure.stderr, '');
});
