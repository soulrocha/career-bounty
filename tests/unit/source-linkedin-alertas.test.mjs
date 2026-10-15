import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runSources } from '../../core/sources/index.mjs';
import { createLinkedinAlertas } from '../../core/sources/linkedinAlerts.mjs';

const { itens } = JSON.parse(await readFile(new URL('../replay/mail/alertas.json', import.meta.url), 'utf8'));
const ctx = { janela: { inicio: '2026-10-08', fim: '2026-10-15' }, plano: { termos: ['Tech Lead'] }, config: {}, now: new Date('2026-10-15T21:00:00Z') };
const fonte = (config = {}, lista = itens) => createLinkedinAlertas({ termos: ['Tech Lead'], ...config }, { lerAlertas: async () => lista });

test('item alerta vira aparições com título, empresa e URL do LinkedIn sem rastreio', async () => {
  const { vagas, fontes } = await runSources([fonte()], ctx);
  assert.equal(fontes[0].estado, 'ok');
  const alfa = vagas.find(v => v.cargo === 'Tech Lead Plataforma 1');
  assert.equal(alfa.empresa, 'Empresa Alfa');
  assert.equal(alfa.portal, 'linkedin');
  assert.equal(alfa.aparicao, true);
  assert.equal(alfa.requisicao_id, '440000001');
  assert.equal(alfa.url, 'https://www.linkedin.com/jobs/view/440000001');
  assert.equal(vagas.length, 3, 'um item com 1 vaga, um com 2; os demais ficam de fora');
});

test('alerta de termo que não está na configuração é ignorado com aviso', async () => {
  const { vagas, fontes } = await runSources([fonte()], ctx);
  assert.ok(!vagas.some(v => v.cargo === 'Pintor'));
  assert.match(fontes[0].avisos.join(' '), /Pintor/);
});

test('alerta nunca comprova candidatura', async () => {
  const { vagas } = await runSources([fonte()], ctx);
  for (const v of vagas) {
    for (const campo of ['candidatura', 'aplicada', 'status', 'candidatura_email']) assert.ok(!(campo in v), campo);
  }
});

test('o mesmo message_id repetido é ignorado', async () => {
  const { vagas } = await runSources([fonte()], ctx);
  assert.equal(vagas.filter(v => v.cargo === 'Tech Lead Plataforma 1').length, 1);
  const vistas = await runSources([fonte()], { ...ctx, mensagensVistas: new Set(['msg-alerta-1', 'msg-alerta-2']) });
  assert.equal(vistas.vagas.length, 0);
});

test('zero requisição ao LinkedIn', async t => {
  const original = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => { chamadas += 1; throw new Error('rede bloqueada no teste'); };
  t.after(() => { globalThis.fetch = original; });
  await runSources([fonte()], ctx);
  assert.equal(chamadas, 0);
});

test('alerta sem a lista de vagas pede a fase B em vez de uma segunda busca', async () => {
  const { fontes } = await runSources([fonte()], ctx);
  assert.deepEqual(fontes[0].fase_b, ['msg-alerta-4']);
  assert.match(fontes[0].avisos.join(' '), /fase B/);
});

test('só remetente do próprio portal vale como alerta', async () => {
  const falso = { ...itens[0], message_id: 'msg-x', remetente_dominio: 'golpe.example' };
  const { vagas, fontes } = await runSources([fonte({}, [falso])], ctx);
  assert.equal(vagas.length, 0);
  assert.match(fontes[0].avisos.join(' '), /remetente/);
});

test('sem leitor de e-mail disponível a fonte fica indisponível', async () => {
  const { fontes } = await runSources([createLinkedinAlertas({ termos: ['Tech Lead'] }, {})], ctx);
  assert.equal(fontes[0].estado, 'indisponivel');
});
