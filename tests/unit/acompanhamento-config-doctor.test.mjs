import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { defaultSettings, validateSettings } from '../../core/config.mjs';
import { runDoctor } from '../../core/doctor/index.mjs';
import { tempDir } from '../helpers/cli.mjs';

test('defaultSettings possui acompanhamento configurado com 5 e 7 dias', () => {
  const defaults = defaultSettings();
  assert.ok(defaults.acompanhamento, 'acompanhamento deve existir em defaultSettings');
  assert.equal(defaults.acompanhamento.dias_aviso, 5);
  assert.equal(defaults.acompanhamento.dias_lembrete, 7);
});

test('validateSettings aceita customizações inteiras válidas para acompanhamento', () => {
  const settings = validateSettings({
    acompanhamento: { dias_aviso: 3, dias_lembrete: 10 },
  });
  assert.equal(settings.acompanhamento.dias_aviso, 3);
  assert.equal(settings.acompanhamento.dias_lembrete, 10);

  const iguais = validateSettings({
    acompanhamento: { dias_aviso: 7, dias_lembrete: 7 },
  });
  assert.equal(iguais.acompanhamento.dias_aviso, 7);
  assert.equal(iguais.acompanhamento.dias_lembrete, 7);
});

test('validateSettings rejeita valores inválidos para dias_aviso e dias_lembrete', () => {
  assert.throws(
    () => validateSettings({ acompanhamento: { dias_aviso: 0 } }),
    /acompanhamento\.dias_aviso deve ser inteiro >= 1/i
  );
  assert.throws(
    () => validateSettings({ acompanhamento: { dias_aviso: 2.5 } }),
    /acompanhamento\.dias_aviso deve ser inteiro >= 1/i
  );
  assert.throws(
    () => validateSettings({ acompanhamento: { dias_aviso: '5' } }),
    /acompanhamento\.dias_aviso deve ser inteiro >= 1/i
  );
  assert.throws(
    () => validateSettings({ acompanhamento: { dias_lembrete: 0 } }),
    /acompanhamento\.dias_lembrete deve ser inteiro >= 1/i
  );
  assert.throws(
    () => validateSettings({ acompanhamento: { dias_lembrete: 'dez' } }),
    /acompanhamento\.dias_lembrete deve ser inteiro >= 1/i
  );
});

test('validateSettings rejeita dias_aviso maior que dias_lembrete', () => {
  assert.throws(
    () => validateSettings({ acompanhamento: { dias_aviso: 8, dias_lembrete: 7 } }),
    /acompanhamento\.dias_aviso/i
  );
});

test('runDoctor inclui check acompanhamento com status ok', async t => {
  const dataRoot = await tempDir(t);
  await mkdir(path.join(dataRoot, 'secrets'));
  const report = await runDoctor({
    dataRoot,
    nodeVersion: '22.1.0',
    platform: 'linux',
    hooksPath: () => '.githooks',
    stat: async () => ({ mode: 0o40700 }),
  });
  const check = report.checks.find(c => c.id === 'acompanhamento');
  assert.ok(check, 'check acompanhamento deve estar presente nos checks do doctor');
  assert.equal(check.status, 'ok');
  assert.match(check.mensagem, /aviso/i);
});
