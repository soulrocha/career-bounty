import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCorpus } from '../fixtures/mail/make-corpus.mjs';
import { classificar } from '../../core/mail/rules.mjs';
import { chavesDaVaga, extrairRequisicoes, portalDoRemetente, vincular } from '../../core/mail/link.mjs';

const UUID_A = '3f2c1a9e-5b7d-4c68-9a10-0d4e6f8b2c31';
const UUID_B = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const vagas = [
  { id: 'v1', empresa: 'Empresa Alfa', cargo: 'Analista de Dados', requisicao_id: 'Job-48213', aparicoes: [{ url: `https://jobs.lever.co/alfa/${UUID_A}` }] },
  { id: 'v2', empresa: 'Empresa Alfa', cargo: 'Analista de Dados', requisicao_id: 'job:47105', portal_origem: 'lever' },
  { id: 'v3', empresa: 'Empresa Beta', cargo: 'Tech Lead', requisicao_id: 'gupy:70123456' },
  { id: 'v4', empresa: 'Empresa Gama', cargo: 'Tech Lead', requisicao_id: 'gupy:rhb4417' },
  { id: 'v5', empresa: 'Empresa Delta', cargo: 'Product Manager', requisicao_id: null },
  { id: 'v6', empresa: 'Empresa Eta', cargo: 'Dev', url: `https://app.inhire.app/vagas/${UUID_B}/dev` },
  { id: 'v7', empresa: 'Empresa Teta', cargo: 'Dev', aparicoes: [{ url: 'https://boards.greenhouse.io/teta/jobs/5544321' }] },
  { id: 'v8', empresa: 'Empresa Iota', cargo: 'Dev', requisicao_id: 'solides:5001' },
];
const email = (classe, assunto, trecho = '', corpo, dominio = 'hire.lever.co') => ({ classe, item: { assunto, trecho, remetente_dominio: dominio }, corpo });

test('o portal do remetente vem do domínio; fora dos portais conhecidos vira "proprio"', () => {
  assert.equal(portalDoRemetente('ses-mail.inhire.app'), 'inhire');
  assert.equal(portalDoRemetente('us.greenhouse-mail.io'), 'greenhouse');
  assert.equal(portalDoRemetente('rh.empresa.test'), 'proprio');
  assert.equal(portalDoRemetente('rh.empresa.test', ['empresa.test']), 'proprio');
});

test('Job-N: precisa de 4 ou mais dígitos e de contexto; vira chave no portal do remetente', () => {
  for (const texto of ['[Job-48213] Confirmação', '[Job - 48213] Confirmação', '[Job 48213] Confirmação', 'Sobre Job-48213: retorno', 'Job ID: 48213']) {
    assert.deepEqual(extrairRequisicoes(texto, { portal: 'lever' }), ['lever:48213'], texto);
  }
  assert.deepEqual(extrairRequisicoes('[Job-48213] x', { portal: 'inhire' }), ['inhire:48213']);
  assert.deepEqual(extrairRequisicoes('[Job-48213] x'), ['proprio:48213']);
  for (const texto of ['Job 2024 summary', 'Job-123 curto', 'job48213', 'Jobs 48213', 'seu job 31 de março', '[Job-123]']) {
    assert.deepEqual(extrairRequisicoes(texto, { portal: 'lever' }), [], texto);
  }
});

test('código Gupy só vale quando o remetente é a Gupy', () => {
  assert.deepEqual(extrairRequisicoes('70123456 - ANALISTA DE DADOS: Recebemos sua inscrição', { portal: 'gupy' }), ['gupy:70123456']);
  assert.deepEqual(extrairRequisicoes('TITULO DA VAGA - RHB4417', { portal: 'gupy' }), ['gupy:rhb4417']);
  assert.deepEqual(extrairRequisicoes('70123456 - ANALISTA DE DADOS', { portal: 'lever' }), []);
  assert.deepEqual(extrairRequisicoes('Sem identificador aqui. 2026 e 12345', { portal: 'gupy' }), []);
});

test('URLs de portal viram a mesma chave canônica da coleta (Gupy, Inhire, Lever, Greenhouse, Ashby)', () => {
  assert.deepEqual(extrairRequisicoes('Veja https://acme.gupy.io/jobs/70123456?jobBoardSource=x.', { portal: 'gupy' }), ['gupy:70123456']);
  assert.deepEqual(extrairRequisicoes(`https://app.inhire.app/vagas/${UUID_B}/dev`, { portal: 'inhire' }), [`inhire:${UUID_B}`]);
  assert.deepEqual(extrairRequisicoes(`https://jobs.lever.co/alfa/${UUID_A}`, { portal: 'lever' }), [`lever:${UUID_A}`]);
  assert.deepEqual(extrairRequisicoes('https://boards.greenhouse.io/teta/jobs/5544321', { portal: 'greenhouse' }), ['greenhouse:5544321']);
  assert.deepEqual(extrairRequisicoes(`https://jobs.ashbyhq.com/acme/${UUID_A}`, { portal: 'ashby' }), [`ashby:${UUID_A}`]);
});

test('URL de outro portal que o do remetente conhecido não conta', () => {
  assert.deepEqual(extrairRequisicoes('https://acme.gupy.io/jobs/70123456', { portal: 'lever' }), []);
});

test('chavesDaVaga: requisição, URL e aparições no formato canônico; Job-N usa o portal da vaga', () => {
  assert.deepEqual(chavesDaVaga(vagas[0]).sort(), ['lever:48213', `lever:${UUID_A}`].sort());
  assert.deepEqual(chavesDaVaga(vagas[1]), ['lever:47105']);
  assert.deepEqual(chavesDaVaga(vagas[2]), ['gupy:70123456']);
  assert.deepEqual(chavesDaVaga(vagas[3]), ['gupy:rhb4417']);
  assert.deepEqual(chavesDaVaga(vagas[4]), []);
  assert.deepEqual(chavesDaVaga(vagas[5]), [`inhire:${UUID_B}`]);
  assert.deepEqual(chavesDaVaga(vagas[6]), ['greenhouse:5544321']);
  assert.deepEqual(chavesDaVaga({ id: 'x', requisicao_id: 'Job-48213' }), ['proprio:48213'], 'sem portal conhecido, a vaga fica no bucket próprio');
});

test('chave de requisição liga à vaga certa, mesmo com outra vaga igual da mesma empresa', () => {
  assert.deepEqual(vincular(email('confirmacao', '[Job - 47105] Confirmação'), vagas), { status: 'vinculado', vaga_id: 'v2', requisicao: 'lever:47105' });
  assert.equal(vincular(email('etapa_liberada', 'Próxima etapa', '70123456 - Tech Lead: realize o teste', undefined, 'gupy.com.br'), vagas).vaga_id, 'v3');
  assert.equal(vincular(email('negativa', 'Retorno', 'Tech Lead - RHB4417', undefined, 'gupy.com.br'), vagas).vaga_id, 'v4');
  assert.equal(vincular(email('negativa', 'Retorno', '', 'Sobre a vaga [Job 48213]: decidimos não avançar.'), vagas).vaga_id, 'v1');
});

test('liga por URL do portal mesmo sem requisicao_id na vaga (Inhire, Greenhouse, Lever por aparição)', () => {
  assert.equal(vincular(email('confirmacao', 'Inscrição', `Veja https://app.inhire.app/vagas/${UUID_B}`, undefined, 'ses-mail.inhire.app'), vagas).vaga_id, 'v6');
  assert.equal(vincular(email('confirmacao', 'Application', 'https://boards.greenhouse.io/teta/jobs/5544321', undefined, 'us.greenhouse-mail.io'), vagas).vaga_id, 'v7');
  assert.equal(vincular(email('confirmacao', 'Application', `https://jobs.lever.co/alfa/${UUID_A}`), vagas).vaga_id, 'v1');
});

test('o mesmo número em outro portal não liga: Job-5001 do Lever não é solides:5001', () => {
  assert.equal(vincular(email('negativa', '[Job-5001] Retorno'), vagas).motivo, 'id_sem_vaga');
  assert.equal(vincular(email('negativa', '[Job-5001] Retorno', '', undefined, 'solides.com'), vagas).vaga_id, 'v8');
  assert.equal(vincular(email('negativa', '[Job-47105] Retorno', '', undefined, 'ses-mail.inhire.app'), vagas).motivo, 'id_sem_vaga', 'número de vaga do Lever vindo de e-mail do Inhire');
  assert.equal(vincular(email('negativa', '[Job-48213] Retorno', '', undefined, 'gupy.com.br'), [{ id: 'g', requisicao_id: 'gupy:48213' }]).motivo, 'sem_id', 'Job-N da Gupy sem o formato Gupy não vira gupy:N');
});

test('sem chave fica pendente de conferência, nunca por semelhança de cargo ou empresa', () => {
  const r = vincular(email('confirmacao', 'Candidatura efetuada com sucesso', 'Sua candidatura para Analista de Dados na Empresa Alfa foi efetuada.'), vagas);
  assert.deepEqual([r.status, r.motivo], ['pendente', 'sem_id']);
  assert.equal(r.vaga_id, undefined);
  assert.equal(vincular(email('negativa', 'Job 2024 summary'), vagas).motivo, 'sem_id');
});

test('chave que não existe no tracker, ou que bate com duas vagas, também fica pendente', () => {
  assert.equal(vincular(email('negativa', '[Job-99999] Retorno'), vagas).motivo, 'id_sem_vaga');
  const duplicadas = [...vagas, { id: 'v9', requisicao_id: 'lever:48213' }];
  assert.equal(vincular(email('negativa', '[Job-48213] Retorno'), duplicadas).motivo, 'ambigua');
});

test('a negativa de uma candidatura aponta só para ela e não para outra da mesma empresa', () => {
  const r = vincular(email('negativa', '[Job-48213] Agradecimento de participação'), vagas);
  assert.equal(r.vaga_id, 'v1');
  assert.notEqual(r.vaga_id, 'v2');
});

test('recibo genérico da empresa não confirma a requisição; alerta e ruído não viram candidatura', () => {
  assert.equal(vincular(email('confirmacao', 'Recebemos sua candidatura', 'Obrigada, recebemos a sua candidatura.'), vagas).status, 'pendente');
  assert.equal(vincular(email('alerta', 'Novas vagas para "Tech Lead"', 'Tech Lead - 70123456 - X', undefined, 'gupy.com.br'), vagas).status, 'sem_candidatura');
  assert.equal(vincular(email('ruido', '[Job-48213] Personal Data Privacy'), vagas).status, 'sem_candidatura');
});

test('o resultado do vínculo não carrega data alguma do e-mail', () => {
  assert.deepEqual(Object.keys(vincular(email('confirmacao', '[Job-48213] x'), vagas)).sort(), ['requisicao', 'status', 'vaga_id']);
});

test('no corpus: o vínculo bate com o rótulo (vaga certa, pendente ou sem candidatura)', () => {
  const corpus = makeCorpus();
  let verificados = 0;
  for (const item of corpus.itens) {
    const rotulo = corpus.labels[item.message_id];
    const corpo = corpus.fulls[item.message_id];
    const r = classificar(item, { corpo });
    const classe = r.classe ?? rotulo.classe;
    if (rotulo.ambiguo && r.classe === null) continue;
    const v = vincular({ classe, item, corpo }, corpus.vagas);
    if (['alerta', 'ruido'].includes(rotulo.classe)) assert.equal(v.status, 'sem_candidatura', item.message_id);
    else if (rotulo.vaga_id) assert.deepEqual([v.status, v.vaga_id], ['vinculado', rotulo.vaga_id], item.message_id);
    else if (rotulo.requisicao) assert.equal(v.motivo, 'id_sem_vaga', item.message_id);
    else assert.equal(v.status, 'pendente', item.message_id);
    verificados += 1;
  }
  assert.ok(verificados > 120);
});
