import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCorpus } from '../fixtures/mail/make-corpus.mjs';
import { classificar } from '../../core/mail/rules.mjs';
import { chaveDaVaga, extrairRequisicoes, vincular } from '../../core/mail/link.mjs';

const vagas = [
  { id: 'v1', empresa: 'Empresa Alfa', cargo: 'Analista de Dados', requisicao_id: 'job:31790' },
  { id: 'v2', empresa: 'Empresa Alfa', cargo: 'Analista de Dados', requisicao_id: 'job:31375' },
  { id: 'v3', empresa: 'Empresa Beta', cargo: 'Tech Lead', requisicao_id: 'gupy:12341100' },
  { id: 'v4', empresa: 'Empresa Gama', cargo: 'Tech Lead', requisicao_id: 'gupy:rha2601' },
  { id: 'v5', empresa: 'Empresa Delta', cargo: 'Product Manager', requisicao_id: null },
];
const email = (classe, assunto, trecho = '', corpo) => ({ classe, item: { assunto, trecho }, corpo });

test('normaliza as variações de ID: Job-N, Job - N, Job N, código Gupy no início e no fim', () => {
  for (const texto of ['[Job-31790] Confirmação', '[Job - 31790] Confirmação', '[Job 31790] Confirmação', 'job31790']) {
    assert.deepEqual(extrairRequisicoes(texto), [{ sistema: 'job', id: '31790' }], texto);
  }
  assert.deepEqual(extrairRequisicoes('12341100 - ANALISTA DE DADOS: Recebemos sua inscrição'), [{ sistema: 'gupy', id: '12341100' }]);
  assert.deepEqual(extrairRequisicoes('TITULO DA VAGA - RHA2601'), [{ sistema: 'gupy', id: 'rha2601' }]);
  assert.deepEqual(extrairRequisicoes('Sem identificador aqui. 2026 e 12345'), []);
  assert.deepEqual(chaveDaVaga('Job-31790'), { portal: null, id: '31790' });
  assert.deepEqual(chaveDaVaga('gupy:123'), { portal: 'gupy', id: '123' });
  assert.equal(chaveDaVaga(null), null);
});

test('ID de requisição presente liga à vaga certa, mesmo com outra vaga igual da mesma empresa', () => {
  assert.deepEqual(vincular(email('confirmacao', '[Job - 31375] Confirmação'), vagas), { status: 'vinculado', vaga_id: 'v2', requisicao: 'job:31375' });
  assert.equal(vincular(email('etapa_liberada', 'Próxima etapa', '12341100 - Tech Lead: realize o teste'), vagas).vaga_id, 'v3');
  assert.equal(vincular(email('negativa', 'Retorno', 'Tech Lead - RHA2601'), vagas).vaga_id, 'v4');
  assert.equal(vincular(email('negativa', 'Retorno', '', 'Sobre a vaga [Job 31790]: decidimos não avançar.'), vagas).vaga_id, 'v1');
});

test('sem ID fica pendente de conferência, nunca por semelhança de cargo ou empresa', () => {
  const r = vincular(email('confirmacao', 'Candidatura efetuada com sucesso', 'Sua candidatura para Analista de Dados na Empresa Alfa foi efetuada.'), vagas);
  assert.deepEqual([r.status, r.motivo], ['pendente', 'sem_id']);
  assert.equal(r.vaga_id, undefined);
});

test('ID que não existe no tracker, ou que bate com duas vagas, também fica pendente', () => {
  assert.equal(vincular(email('negativa', '[Job-99999] Retorno'), vagas).motivo, 'id_sem_vaga');
  const duplicadas = [...vagas, { id: 'v6', requisicao_id: 'Job-31790' }];
  assert.equal(vincular(email('negativa', '[Job-31790] Retorno'), duplicadas).motivo, 'ambigua');
  assert.equal(vincular(email('negativa', '[Job-31790] Retorno'), [{ id: 'g', requisicao_id: 'gupy:31790' }]).motivo, 'id_sem_vaga', 'número igual em portal diferente não liga');
});

test('a negativa de uma candidatura aponta só para ela e não para outra da mesma empresa', () => {
  const r = vincular(email('negativa', '[Job-31790] Agradecimento de participação'), vagas);
  assert.equal(r.vaga_id, 'v1');
  assert.notEqual(r.vaga_id, 'v2');
});

test('recibo genérico da empresa não confirma a requisição; alerta e ruído não viram candidatura', () => {
  assert.equal(vincular(email('confirmacao', 'Recebemos sua candidatura', 'Obrigada, recebemos a sua candidatura.'), vagas).status, 'pendente');
  assert.equal(vincular(email('alerta', 'Novas vagas para "Tech Lead"', 'Tech Lead - 12341100 - X'), vagas).status, 'sem_candidatura');
  assert.equal(vincular(email('ruido', '[Job-31790] Personal Data Privacy'), vagas).status, 'sem_candidatura');
});

test('o resultado do vínculo não carrega data alguma do e-mail', () => {
  assert.deepEqual(Object.keys(vincular(email('confirmacao', '[Job-31790] x'), vagas)).sort(), ['requisicao', 'status', 'vaga_id']);
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
