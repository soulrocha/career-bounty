import assert from 'node:assert/strict';
import test from 'node:test';
import { sincronizavel } from '../../core/sync/regras.mjs';
import { planejar } from '../../core/sync/plano.mjs';

const snapshot = 'backups/abc123';

test('dados de trabalho sincronizam; derivados, locais e segredos não', () => {
  for (const rel of ['events/2026/10/28.pc-a.jsonl', 'artifacts/cv/x/manifesto.json', 'kb/claims/a.md', 'state/migration.json',
    'state/daily-run.json', 'config.yml', 'identity.yml', 'cv/perfil.json', `${snapshot}/carreira/pipeline-vagas.json`]) {
    assert.equal(sincronizavel(rel, { snapshotRoot: snapshot }), true, rel);
  }
  for (const rel of ['projections/pipeline-vagas.json', 'cache/x.json', 'logs/panel.stdout.log', 'secrets/token', 'rollback-backups/a.json',
    'backups/outro/arquivo.json', 'launcher.json', 'iniciar-painel.ps1', 'Iniciar painel.cmd', 'state/pipeline.lock',
    'state/leitor-email.settings.json', 'state/aprovacoes.json', 'state/sessao-candidatura.json', 'state/orcamento-linkedin.json', 'config.yml.bak-2026-10-18', 'state/.migration.json.123.tmp', '.sync/base.json',
    'kb/.obsidian/x.json', 'state/aprovacoes.json.conflito-pc-a-20261030T2200']) {
    assert.equal(sincronizavel(rel, { snapshotRoot: snapshot }), false, rel);
  }
});

test('sem snapshot conhecido nenhum backup sincroniza; com "*" todos', () => {
  assert.equal(sincronizavel(`${snapshot}/a.json`, { snapshotRoot: null }), false);
  assert.equal(sincronizavel('backups/qualquer/a.json', { snapshotRoot: '*' }), true);
  assert.equal(sincronizavel('backups', { snapshotRoot: '*' }), false);
});

test('caminho inseguro nunca sincroniza', () => {
  for (const rel of ['../fora.json', '/abs.json', 'C:/x.json', 'a\\b.json', 'kb//a.md', '', 'kb/a\nb.md']) {
    assert.equal(sincronizavel(rel, { snapshotRoot: '*' }), false, JSON.stringify(rel));
  }
});

const m = obj => new Map(Object.entries(obj));

test('plano de três vias: novo, alterado de um lado, igual e apagado', () => {
  const plano = planejar({
    local: m({ 'so-local': 'L1', 'mudou-local': 'L2', igual: 'I', 'apagou-remoto': 'B4', 'mudou-remoto': 'B5' }),
    remoto: m({ 'so-remoto': 'R1', 'mudou-local': 'B2', igual: 'I', 'apagou-local': 'B3', 'mudou-remoto': 'R5' }),
    base: m({ 'mudou-local': 'B2', igual: 'I', 'apagou-local': 'B3', 'apagou-remoto': 'B4', 'mudou-remoto': 'B5', 'sumiu-dos-dois': 'X' }),
  });
  assert.deepEqual(plano.enviar, [{ path: 'mudou-local', sha256: 'L2', esperado: 'B2' }, { path: 'so-local', sha256: 'L1', esperado: null }]);
  assert.deepEqual(plano.baixar, [{ path: 'mudou-remoto', sha256: 'R5', localEsperado: 'B5' }, { path: 'so-remoto', sha256: 'R1', localEsperado: null }]);
  assert.deepEqual(plano.apagarRemoto, [{ path: 'apagou-local', esperado: 'B3' }]);
  assert.deepEqual(plano.apagarLocal, [{ path: 'apagou-remoto', esperado: 'B4' }]);
  assert.deepEqual(plano.conflitos, []);
  assert.deepEqual(plano.iguais, [{ path: 'igual', sha256: 'I' }]);
});

test('os dois lados mudaram: conflito em que o servidor vence e a versão local é preservada', () => {
  const plano = planejar({ local: m({ a: 'L' }), remoto: m({ a: 'R' }), base: m({ a: 'B' }) });
  assert.deepEqual(plano.conflitos, [{ path: 'a', sha256: 'R', localEsperado: 'L' }]);
  assert.deepEqual(plano.enviar, []);
});

test('PC novo com arquivo diferente e sem base: conflito, o servidor vence (o esqueleto local não sobrescreve o hub)', () => {
  const plano = planejar({ local: m({ 'config.yml': 'vazio' }), remoto: m({ 'config.yml': 'real' }), base: new Map() });
  assert.deepEqual(plano.conflitos, [{ path: 'config.yml', sha256: 'real', localEsperado: 'vazio' }]);
});

test('apagado local mas alterado no servidor: baixa de novo em vez de apagar', () => {
  const plano = planejar({ local: new Map(), remoto: m({ a: 'R2' }), base: m({ a: 'R1' }) });
  assert.deepEqual(plano.baixar, [{ path: 'a', sha256: 'R2', localEsperado: null }]);
  assert.deepEqual(plano.apagarRemoto, []);
});

test('apagado no servidor mas alterado local: envia de novo em vez de apagar', () => {
  const plano = planejar({ local: m({ a: 'L2' }), remoto: new Map(), base: m({ a: 'L1' }) });
  assert.deepEqual(plano.enviar, [{ path: 'a', sha256: 'L2', esperado: null }]);
  assert.deepEqual(plano.apagarLocal, []);
});
