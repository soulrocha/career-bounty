import assert from 'node:assert/strict';
import test from 'node:test';
import { SCRIPT_EXTRATOR, bloqueadaPorHumano, normalizarExtracao, seletorDoCampo } from '../../core/apply/extrator.mjs';
import { pagina, portal, semNavegador } from '../helpers/navegador.mjs';

const extrair = async (t, nome) => {
  const p = await pagina(t, portal(nome));
  return { p, r: normalizarExtracao(await p.avaliar(SCRIPT_EXTRATOR)) };
};
const porLabel = (r, trecho) => r.campos.find(c => c.label.includes(trecho));

test('formulário com texto, select, radio, checkbox e upload vira lista {ref, label, tipo, obrigatorio, opcoes}', { skip: semNavegador }, async t => {
  const { r } = await extrair(t, 'greenhouse');
  assert.deepEqual(r.campos.map(c => [c.label, c.tipo, c.obrigatorio]), [
    ['First Name *', 'text', true], ['Last Name *', 'text', true], ['Email *', 'email', true], ['Phone', 'tel', false],
    ['Resume/CV *', 'file', true], ['LinkedIn Profile', 'text', false], ['What are your salary expectations? *', 'text', true],
    ['Are you legally authorized to work in Brazil? *', 'select', true], ['Gender (voluntary)', 'radio', false],
  ]);
  assert.deepEqual(porLabel(r, 'authorized').opcoes, ['Yes', 'No']);
  assert.deepEqual(porLabel(r, 'Gender').opcoes, ['Female', 'Male', 'Decline to self-identify']);
  assert.deepEqual(r.campos.map(c => c.ref), r.campos.map((_, i) => `c${i + 1}`));
  assert.deepEqual(r.botoes_envio, ['Submit Application']);
  const g = await extrair(t, 'gupy');
  assert.deepEqual(g.r.campos.map(c => [c.label, c.tipo]), [
    ['Qual a sua pretensão salarial?', 'text'],
    ['Você possui disponibilidade para trabalho híbrido em Cidade Exemplo?', 'radio'],
    ['Você é uma pessoa com deficiência (PcD)?', 'select'],
    ['Conte sobre um projeto em que você liderou uma migração.', 'textarea'],
    ['Quais ferramentas você usa?', 'checkbox_grupo'],
  ]);
  assert.deepEqual(porLabel(g.r, 'ferramentas').opcoes, ['Jira', 'SQL', 'Figma']);
});

test('o rótulo vem de <label for>, de label que envolve, de aria-label, de aria-labelledby ou do texto vizinho', { skip: semNavegador }, async t => {
  const lever = (await extrair(t, 'lever')).r;
  assert.ok(porLabel(lever, 'Full name'), 'texto vizinho');
  assert.equal(porLabel(lever, 'privacy notice').tipo, 'checkbox');
  assert.ok(porLabel(lever, 'privacy notice').obrigatorio, 'label que envolve');
  const ashby = (await extrair(t, 'ashby')).r;
  assert.equal(porLabel(ashby, 'Years of experience').tipo, 'number');
  assert.ok(porLabel(ashby, 'Years of experience').obrigatorio, 'aria-label');
  assert.ok(porLabel(ashby, 'Email').obrigatorio, 'aria-labelledby + aria-required');
  assert.equal(porLabel(ashby, 'sponsorship').tipo, 'radio');
});

test('captcha, tela de login e MFA viram bloqueios', { skip: semNavegador }, async t => {
  assert.deepEqual((await extrair(t, 'bloqueios')).r.bloqueios, { captcha: true, login: false, mfa: false });
  assert.deepEqual((await extrair(t, 'login')).r.bloqueios, { captcha: false, login: true, mfa: false });
  assert.deepEqual((await extrair(t, 'mfa')).r.bloqueios, { captcha: false, login: false, mfa: true });
  assert.equal(bloqueadaPorHumano((await extrair(t, 'mfa')).r), true);
  assert.equal(bloqueadaPorHumano((await extrair(t, 'greenhouse')).r), false);
});

test('campos ocultos, hidden, senha e honeypot ficam de fora; o upload escondido atrás de botão entra', { skip: semNavegador }, async t => {
  const { r } = await extrair(t, 'greenhouse');
  const labels = r.campos.map(c => c.label).join(' | ');
  assert.doesNotMatch(labels, /oculto|website|token/i);
  assert.ok(porLabel(r, 'Resume'));
  assert.equal((await extrair(t, 'login')).r.campos.some(c => /senha/i.test(c.label)), false);
});

test('o script é curto e a saída é pequena, com limite por campo', { skip: semNavegador }, async t => {
  assert.ok(SCRIPT_EXTRATOR.length <= 3500, `script com ${SCRIPT_EXTRATOR.length} caracteres`);
  const { r } = await extrair(t, 'greenhouse');
  assert.ok(JSON.stringify(r).length < 2000, `saída com ${JSON.stringify(r).length} caracteres`);
  const longo = normalizarExtracao({ campos: [{ ref: 'c1', label: 'x'.repeat(500), tipo: 'select', opcoes: Array(50).fill('y'.repeat(200)) }], bloqueios: {} });
  assert.equal(longo.campos[0].label.length, 120);
  assert.equal(longo.campos[0].opcoes.length, 30);
  assert.equal(longo.campos[0].opcoes[0].length, 80);
  assert.throws(() => normalizarExtracao(null), /Extração inválida/);
  assert.deepEqual(normalizarExtracao({ campos: [{ ref: 'x"]; alert(1)', label: 'a' }] }).campos, []);
});

test('o valor digitado nunca é lido nem devolvido; o ref marca o campo para preencher depois', { skip: semNavegador }, async t => {
  const p = await pagina(t, portal('greenhouse'));
  await p.avaliar(`document.getElementById('email').value = 'digitado@exemplo.test'; document.getElementById('salary').value = 'DIGITADO-123'`);
  const r = normalizarExtracao(await p.avaliar(SCRIPT_EXTRATOR));
  assert.doesNotMatch(JSON.stringify(r), /Valor pre-existente|segredo|digitado@|DIGITADO/);
  assert.equal(await p.avaliar(`document.querySelector('${seletorDoCampo('c1')}').id`), 'first_name');
});
