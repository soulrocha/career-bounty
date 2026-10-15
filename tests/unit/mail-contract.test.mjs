import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LIMITES, MailContractError, lerJson, paraRemetente, validarDigest, validarFull } from '../../core/mail/contract.mjs';

const AGORA = new Date('2026-10-14T15:00:00-03:00');
const item = (n, extra = {}) => ({ message_id: `msg-${n}`, data: '2026-10-13', remetente_nome: 'Portal Exemplo', remetente_dominio: 'gupy.com.br', assunto: `Assunto ${n}`, trecho: `Trecho ${n}`, ...extra });
const digest = (itens, extra = {}) => ({ cursor_usado: '2026-10-07', consultado_em: '2026-10-14T18:00:00.000Z', itens, precisa_abrir: [], ...extra });

test('MailDigest válido é aceito e sai normalizado', () => {
  const { digest: d, avisos, rejeitados } = validarDigest(digest([item(1), item(2)]), { now: AGORA });
  assert.equal(d.itens.length, 2);
  assert.deepEqual(d.itens[0], { message_id: 'msg-1', data: '2026-10-13', remetente_nome: 'Portal Exemplo', remetente_dominio: 'gupy.com.br', assunto: 'Assunto 1', trecho: 'Trecho 1' });
  assert.deepEqual([avisos, rejeitados], [[], []]);
});

test('trecho acima de 300 caracteres é truncado com aviso', () => {
  const { digest: d, avisos } = validarDigest(digest([item(1, { trecho: 'x'.repeat(500) })]), { now: AGORA });
  assert.equal(d.itens[0].trecho.length, LIMITES.trecho);
  assert.match(avisos[0], /trecho.*truncado/);
});

test('campo extra no item ou na raiz rejeita o digest inteiro com erro tipado', () => {
  for (const ruim of [digest([item(1, { acao: 'forward' })]), digest([item(1, { corpo: 'texto da fase B' })]), digest([item(1)], { executar: 'x' })]) {
    assert.throws(() => validarDigest(ruim, { now: AGORA }), error => error instanceof MailContractError && error.codigo === 'campo_extra');
  }
});

test('message_id duplicado no mesmo digest vira um item só', () => {
  const { digest: d, avisos } = validarDigest(digest([item(1), item(1, { assunto: 'Outro' }), item(2)]), { now: AGORA });
  assert.deepEqual(d.itens.map(i => i.message_id), ['msg-1', 'msg-2']);
  assert.equal(d.itens[0].assunto, 'Assunto 1');
  assert.match(avisos.join(' '), /duplicado/);
});

test('data inválida ou futura rejeita só o item', () => {
  const { digest: d, rejeitados } = validarDigest(digest([item(1, { data: '2026-02-30' }), item(2, { data: '2026-10-20' }), item(3, { data: 'ontem' }), item(4, { data: '2026-10-14T20:00:00-03:00' }), item(5)]), { now: AGORA });
  assert.deepEqual(d.itens.map(i => i.message_id), ['msg-4', 'msg-5']);
  assert.deepEqual(rejeitados.map(r => r.message_id), ['msg-1', 'msg-2', 'msg-3']);
});

test('precisa_abrir com id fora de itens rejeita o digest', () => {
  assert.throws(() => validarDigest(digest([item(1)], { precisa_abrir: ['msg-9'] }), { now: AGORA }), error => error.codigo === 'precisa_abrir_invalido');
  assert.deepEqual(validarDigest(digest([item(1)], { precisa_abrir: ['msg-1'] }), { now: AGORA }).digest.precisa_abrir, ['msg-1']);
});

test('MailFull só é aceito para os ids pedidos e o corpo passa de 1.500 com aviso', () => {
  const ok = validarFull({ itens: [{ message_id: 'msg-1', corpo: 'Olá' }] }, { pedidos: ['msg-1', 'msg-2'] });
  assert.deepEqual(ok.itens, [{ message_id: 'msg-1', corpo: 'Olá' }]);
  assert.throws(() => validarFull({ itens: [{ message_id: 'msg-7', corpo: 'x' }] }, { pedidos: ['msg-1'] }), error => error.codigo === 'corpo_nao_pedido');
  assert.throws(() => validarFull({ itens: [{ message_id: 'msg-1', corpo: 'x', acao: 'apagar' }] }, { pedidos: ['msg-1'] }), error => error.codigo === 'campo_extra');
  const longo = validarFull({ itens: [{ message_id: 'msg-1', corpo: 'y'.repeat(2000) }] }, { pedidos: ['msg-1'] });
  assert.equal(longo.itens[0].corpo.length, LIMITES.corpo);
  assert.match(longo.avisos[0], /corpo.*truncado/);
});

test('JSON truncado, vazio ou sem cerca válida vira erro tipado, sem efeito', () => {
  for (const texto of ['{"itens":[{"message_id":"a"', '', 'não é json']) {
    assert.throws(() => lerJson(texto), error => error instanceof MailContractError && error.codigo === 'json_invalido');
  }
  assert.deepEqual(lerJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('remetente guardado só como domínio e nome exibido, nunca o endereço', () => {
  assert.deepEqual(paraRemetente('Empresa Alfa <no-reply@vagas.exemplo.test>'), { remetente_nome: 'Empresa Alfa', remetente_dominio: 'vagas.exemplo.test' });
  assert.deepEqual(paraRemetente('rh@exemplo.test'), { remetente_nome: '', remetente_dominio: 'exemplo.test' });
  const { digest: d } = validarDigest(digest([{ message_id: 'm1', data: '2026-10-13', remetente: 'Time de Talentos <talentos@vagas.exemplo.test>', assunto: 'a', trecho: 'b' }, item(2, { remetente_nome: 'Fulano <fulano@vagas.exemplo.test>' })]), { now: AGORA });
  assert.deepEqual(d.itens.map(i => [i.remetente_nome, i.remetente_dominio]), [['Time de Talentos', 'vagas.exemplo.test'], ['Fulano', 'gupy.com.br']]);
  assert.ok(!JSON.stringify(d).includes('@'));
  const sem = validarDigest(digest([{ message_id: 'm3', data: '2026-10-13', assunto: 'a', trecho: 'b' }]), { now: AGORA });
  assert.equal(sem.rejeitados[0].message_id, 'm3');
});

test('os arquivos de schema declaram exatamente os campos aceitos e proíbem extras', async () => {
  const dig = JSON.parse(await readFile(new URL('../../core/mail/schema/mail-digest.json', import.meta.url), 'utf8'));
  const full = JSON.parse(await readFile(new URL('../../core/mail/schema/mail-full.json', import.meta.url), 'utf8'));
  assert.equal(dig.additionalProperties, false);
  assert.deepEqual(Object.keys(dig.properties).sort(), ['consultado_em', 'cursor_usado', 'itens', 'precisa_abrir']);
  assert.equal(dig.properties.itens.items.additionalProperties, false);
  assert.equal(full.properties.itens.items.additionalProperties, false);
  assert.deepEqual(full.properties.itens.items.required.sort(), ['corpo', 'message_id']);
});
