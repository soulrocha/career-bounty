import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { configurarSync } from '../../core/sync/index.mjs';
import { sincronizarComPrazo } from '../../core/sync/hook.mjs';
import { repoRoot, tempDir } from '../helpers/cli.mjs';

const configurar = dir => configurarSync(dir, { comando: ['ssh', 'u@h', 'node', '/opt/app/bin/career-bounty.mjs'], raiz: '/srv/cb' });

test('sem configuração o hook não sincroniza nem avisa', async t => {
  const dir = await tempDir(t);
  let chamou = false;
  assert.equal(await sincronizarComPrazo(dir, { rodada: async () => { chamou = true; } }), null);
  assert.equal(chamou, false);
});

test('rodada ok fica em silêncio; conflito e falha viram aviso curto', async t => {
  const dir = await tempDir(t);
  await configurar(dir);
  assert.equal(await sincronizarComPrazo(dir, { rodada: async () => ({ ok: true, conflitos: [] }) }), null);
  assert.match(await sincronizarComPrazo(dir, { rodada: async () => ({ ok: true, conflitos: ['kb/answers.yml'] }) }), /kb\/answers\.yml/);
  assert.match(await sincronizarComPrazo(dir, { rodada: async () => { throw new Error('ssh: sem rota'); } }), /falhou \(ssh: sem rota\)/);
});

test('rodada lenta não segura a sessão além do prazo', async t => {
  const dir = await tempDir(t);
  await configurar(dir);
  const inicio = Date.now();
  const aviso = await sincronizarComPrazo(dir, { prazoMs: 100, rodada: () => new Promise(() => {}) });
  assert.match(aviso, /sem resposta/);
  assert.ok(Date.now() - inicio < 2000);
});

test('SessionEnd registrado em hooks.json aponta para o script de fim de sessão', async () => {
  const hooks = JSON.parse(await readFile(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
  assert.match(hooks.hooks.SessionEnd[0].hooks[0].command, /hooks\/session-end\.mjs/);
});
