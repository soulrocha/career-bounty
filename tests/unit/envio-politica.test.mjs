// F7.1 e F7.2: schema das regras de envio e avaliador de política.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { loadSettings } from '../../core/config.mjs';
import { validarRegras } from '../../core/apply/policy/schema.mjs';
import { avaliarPolitica, tabelaVerdade } from '../../core/apply/policy/evaluate.mjs';

// Regra do exemplo da arquitetura (seção de aplicação), em JSON.
const EXEMPLO = { id: 'ats-publico-alta', quando: { aderencia: ['alta'], portal: ['greenhouse', 'lever', 'ashby'], rascunhos_llm: 0, respostas_novas_na_rodada: 0, cv_gate: 'ok', ja_aplicada: false }, acao: 'enviar_automatico', limite_dia: 5 };
const OK = { aderencia: 'alta', portal: 'greenhouse', rascunhos_llm: 0, respostas_novas_na_rodada: 0, cv_gate: 'ok', ja_aplicada: false };

test('F7.1: a regra do exemplo da arquitetura é aceita e normalizada', () => {
  assert.deepEqual(validarRegras([EXEMPLO]), [{ ...EXEMPLO, ativa: true }]);
});

test('F7.1: condição desconhecida, limite ausente ou não positivo e ação fora do enum dão erro nomeado', () => {
  const casos = [
    [{ ...EXEMPLO, quando: { ...EXEMPLO.quando, salario_minimo: 1 } }, /condição desconhecida "salario_minimo"/],
    [{ ...EXEMPLO, limite_dia: undefined }, /limite_dia.*obrigatório/],
    [{ ...EXEMPLO, limite_dia: 0 }, /limite_dia deve ser inteiro >= 1/],
    [{ ...EXEMPLO, acao: 'mandar_tudo' }, /acao deve ser uma de/],
    [{ ...EXEMPLO, quando: { ...EXEMPLO.quando, cv_gate: 'qualquer' } }, /cv_gate só aceita "ok"/],
    [{ ...EXEMPLO, quando: { ...EXEMPLO.quando, aderencia: ['otima'] } }, /aderencia deve ser lista/],
    [{ ...EXEMPLO, extra: 1 }, /campo desconhecido "extra"/],
  ];
  for (const [regra, erro] of casos) assert.throws(() => validarRegras([regra]), erro, JSON.stringify(regra));
  assert.throws(() => validarRegras([EXEMPLO, EXEMPLO]), /id repetido/);
});

test('F7.1: enviar_automatico em portal sem driver é recusado com "portal sem driver"', () => {
  for (const portal of ['gupy', 'inhire', 'solides', 'linkedin']) {
    assert.throws(() => validarRegras([{ ...EXEMPLO, quando: { ...EXEMPLO.quando, portal: ['greenhouse', portal] } }]), new RegExp(`portal sem driver: ${portal}`), portal);
  }
  assert.throws(() => validarRegras([{ ...EXEMPLO, quando: { aderencia: ['alta'] } }]), /exige a lista de portais/);
  // Parar antes de enviar em qualquer portal é permitido.
  assert.equal(validarRegras([{ id: 'gupy-para', quando: { portal: ['gupy'] }, acao: 'parar_antes_de_enviar' }]).length, 1);
});

test('F7.1: regra ativa:false é ignorada; sem envio no config vale parar_antes_de_enviar; regras só do config', async t => {
  assert.equal(avaliarPolitica({ regras: validarRegras([{ ...EXEMPLO, ativa: false }]), contexto: OK }).acao, 'pronto_para_enviar');
  const dataRoot = await tempDir(t);
  const padrao = await loadSettings({ dataRoot });
  assert.equal(padrao.envio.padrao, 'parar_antes_de_enviar');
  assert.deepEqual(padrao.envio.regras, []);
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ envio: { regras: [EXEMPLO] } }));
  assert.equal((await loadSettings({ dataRoot })).envio.regras[0].id, 'ats-publico-alta');
  await writeFile(path.join(dataRoot, 'config.yml'), JSON.stringify({ envio: { regras: [{ ...EXEMPLO, quando: { ...EXEMPLO.quando, portal: ['gupy'] } }] } }));
  await assert.rejects(loadSettings({ dataRoot }), /portal sem driver/);
});

test('F7.2: todas as condições ok liberam enviar_automatico com o id da regra; cada condição falhando sozinha nega', () => {
  const regras = validarRegras([EXEMPLO]);
  assert.deepEqual(avaliarPolitica({ regras, contexto: OK }), { acao: 'enviar_automatico', regra: 'ats-publico-alta', limite_dia: 5, motivos: [] });
  const tabela = tabelaVerdade(regras[0], OK);
  console.log(tabela.map(l => `${l.caso.padEnd(36)} -> ${l.resultado}`).join('\n'));
  assert.equal(tabela.length, 7);
  assert.deepEqual(tabela.slice(1).map(l => l.resultado), Array(6).fill('parar_antes_de_enviar'));
  const parcial = avaliarPolitica({ regras, contexto: { ...OK, aderencia: 'media', rascunhos_llm: 1 } });
  assert.equal(parcial.acao, 'parar_antes_de_enviar');
  assert.match(parcial.motivos[0], /aderencia: precisa \["alta"\], está "media"; rascunhos_llm: precisa 0, está 1/);
});

test('F7.2: conflito entre regras vale a mais restritiva; sem regra é pronto_para_enviar; contexto incompleto nega', () => {
  const duas = validarRegras([EXEMPLO, { id: 'gh-cauteloso', quando: { portal: ['greenhouse'] }, acao: 'enviar_automatico', limite_dia: 2 }]);
  assert.deepEqual(avaliarPolitica({ regras: duas, contexto: OK }), { acao: 'enviar_automatico', regra: 'gh-cauteloso', limite_dia: 2, motivos: [] });
  const comParada = validarRegras([EXEMPLO, { id: 'para-gh', quando: { portal: ['greenhouse'] }, acao: 'parar_antes_de_enviar' }]);
  assert.equal(avaliarPolitica({ regras: comParada, contexto: OK }).acao, 'parar_antes_de_enviar');
  assert.equal(avaliarPolitica({ regras: [], contexto: OK }).acao, 'pronto_para_enviar');
  for (const campo of Object.keys(OK)) {
    const { [campo]: _, ...incompleto } = OK;
    assert.equal(avaliarPolitica({ regras: validarRegras([EXEMPLO]), contexto: incompleto }).acao, 'parar_antes_de_enviar', campo);
  }
  assert.equal(avaliarPolitica({ regras: validarRegras([EXEMPLO]), contexto: null }).acao, 'parar_antes_de_enviar');
});

test('F7.2: com a config padrão nunca há enviar_automatico', async t => {
  const settings = await loadSettings({ dataRoot: await tempDir(t) });
  for (const portal of ['greenhouse', 'lever', 'ashby', 'gupy']) {
    assert.notEqual(avaliarPolitica({ regras: settings.envio.regras, contexto: { ...OK, portal } }).acao, 'enviar_automatico');
  }
});
