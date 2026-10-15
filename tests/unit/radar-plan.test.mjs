import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, janela } from '../../core/sources/plan.mjs';
import { validateSettings } from '../../core/config.mjs';

const termos = Array.from({ length: 21 }, (_, i) => `termo ${String(i + 1).padStart(2, '0')}`);
const empresas = Array.from({ length: 12 }, (_, i) => `Empresa ${String(i + 1).padStart(2, '0')}`);
const radar = { termos, empresas_monitoradas: empresas, janela_dias: 7 };
const dia = iso => new Date(`${iso}T15:00:00Z`); // 12:00 em São Paulo

test('devolve os 21 termos da configuração', () => {
  assert.equal(buildPlan(radar, dia('2026-10-14')).termos.length, 21);
});

test('segunda a sexta escolhem a fatia certa de empresas; fim de semana nenhuma', () => {
  const fatias = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map(d => buildPlan(radar, dia(d)).empresas);
  assert.deepEqual(fatias[0], ['Empresa 01', 'Empresa 06', 'Empresa 11']);
  assert.deepEqual(fatias[4], ['Empresa 05', 'Empresa 10']);
  assert.equal(new Set(fatias.flat()).size, 12, 'a semana cobre todas as empresas, sem repetir');
  assert.deepEqual(buildPlan(radar, dia('2026-10-17')).empresas, []);
  assert.deepEqual(buildPlan(radar, dia('2026-10-18')).empresas, []);
  assert.equal(buildPlan(radar, dia('2026-10-18')).dia_util, false);
});

test('a rotação segue o dia da semana na virada de mês e de ano, não o dia do mês', () => {
  assert.deepEqual(buildPlan(radar, dia('2026-09-30')).empresas, ['Empresa 03', 'Empresa 08']); // quarta
  assert.deepEqual(buildPlan(radar, dia('2026-10-01')).empresas, ['Empresa 04', 'Empresa 09']); // quinta
  assert.deepEqual(buildPlan(radar, dia('2026-12-31')).empresas, ['Empresa 04', 'Empresa 09']); // quinta
  assert.deepEqual(buildPlan(radar, dia('2027-01-01')).empresas, ['Empresa 05', 'Empresa 10']); // sexta
});

test('o dia civil é o de São Paulo: 23h30 de quinta ainda é quinta', () => {
  assert.deepEqual(buildPlan(radar, new Date('2026-10-16T02:30:00Z')).empresas, ['Empresa 04', 'Empresa 09']);
});

test('janela de 7 dias na virada de mês e de ano', () => {
  assert.deepEqual(janela(dia('2026-11-03'), 7), { inicio: '2026-10-27', fim: '2026-11-03' });
  assert.deepEqual(janela(dia('2027-01-03'), 7), { inicio: '2026-12-27', fim: '2027-01-03' });
});

test('termo vazio ou duplicado é descartado com aviso', () => {
  const plan = buildPlan({ ...radar, termos: ['Tech Lead', ' ', 'tech lead', 'Engineering Manager', ''] }, dia('2026-10-14'));
  assert.deepEqual(plan.termos, ['Tech Lead', 'Engineering Manager']);
  assert.equal(plan.avisos.length, 3);
  assert.match(plan.avisos.join(' '), /vazio/);
  assert.match(plan.avisos.join(' '), /duplicado/);
});

test('a configuração valida termos e empresas monitoradas', () => {
  const ok = validateSettings({ radar: { termos: ['a'], empresas_monitoradas: ['Empresa 01'] } });
  assert.deepEqual(ok.radar.termos, ['a']);
  assert.throws(() => validateSettings({ radar: { termos: 'a' } }), /radar.termos/);
  assert.throws(() => validateSettings({ radar: { empresas_monitoradas: [1] } }), /radar.empresas_monitoradas/);
});
