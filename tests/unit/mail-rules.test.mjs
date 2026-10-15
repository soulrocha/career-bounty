import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCorpus } from '../fixtures/mail/make-corpus.mjs';
import { avaliarDominio, classificar, formatarRelatorio, REGRAS, relatorioPorRegra } from '../../core/mail/rules.mjs';

const corpus = makeCorpus();
const amostra = corpus.itens.map(item => ({ item, rotulo: corpus.labels[item.message_id], corpo: corpus.fulls[item.message_id] }));
const base = { remetente_dominio: 'gupy.com.br', assunto: '', trecho: '' };

test('cada classe é reconhecida pelo padrão do portal (assunto ou trecho)', () => {
  const casos = [
    [{ assunto: 'Confirmação de Inscrição' }, 'confirmacao'],
    [{ trecho: 'Recebemos sua candidatura para a vaga X' }, 'confirmacao'],
    [{ assunto: 'A próxima etapa já está disponível' }, 'etapa_liberada'],
    [{ assunto: 'Falta um passo', trecho: 'Entrevista você está aqui' }, 'etapa_liberada'],
    [{ assunto: 'Convite para entrevista' }, 'entrevista_agendada'],
    [{ trecho: 'Sua entrevista está agendada para 20/10 às 14h.' }, 'entrevista_agendada'],
    [{ trecho: 'Optamos por seguir com outros perfis neste momento.' }, 'negativa'],
    [{ assunto: 'Proposta de trabalho' }, 'oferta'],
    [{ assunto: 'Novas vagas para "Tech Lead" em Brasil' }, 'alerta'],
    [{ assunto: 'Última chamada - Não fique de fora do Processo Seletivo' }, 'acao_necessaria'],
    [{ assunto: '[Empresa Alfa] - Personal Data Privacy' }, 'ruido'],
  ];
  for (const [parcial, esperado] of casos) {
    const r = classificar({ ...base, ...parcial });
    assert.equal(r.classe, esperado, JSON.stringify(parcial));
    assert.equal(r.confianca, 'alta');
    assert.equal(r.precisa_abrir, false);
  }
});

test('assunto ambíguo vai para precisa_abrir, sem chute', () => {
  for (const assunto of ['Obrigada pelo interesse em fazer parte do nosso time', 'Feedback processo seletivo', 'Atualização sobre sua candidatura', 'Retorno do Processo Seletivo', 'Retorno sobre sua candidatura', 'Obrigada por dedicar tempo e energia ao processo']) {
    const r = classificar({ ...base, assunto, trecho: 'Empresa Alfa - Analista' });
    assert.equal(r.classe, null, assunto);
    assert.equal(r.precisa_abrir, true, assunto);
  }
  const semPadrao = classificar({ ...base, assunto: 'Novidade', trecho: 'Há algo novo.' });
  assert.deepEqual([semPadrao.classe, semPadrao.precisa_abrir], [null, true]);
});

test('sinais em conflito entre as regras também sobem, em vez de escolher um', () => {
  const r = classificar({ ...base, assunto: 'Confirmação de Inscrição e convite para entrevista' });
  assert.deepEqual([r.classe, r.precisa_abrir], [null, true]);
});

test('domínio parecido com o do portal, mas diferente, tem baixa confiança', () => {
  for (const d of ['gupy-com-br.test', 'mail.gupy.com.br.golpe.test', 'vagas-inhire.test']) {
    assert.equal(avaliarDominio(d).tipo, 'suspeito', d);
    const r = classificar({ remetente_dominio: d, assunto: 'Convite para entrevista', trecho: '' });
    assert.equal(r.classe, 'entrevista_agendada');
    assert.equal(r.confianca, 'baixa');
  }
  assert.equal(avaliarDominio('ses-mail.inhire.app').tipo, 'portal');
  assert.equal(avaliarDominio('rh.empresa-alfa.test').confianca, 'media');
  assert.equal(avaliarDominio('rh.empresa-alfa.test', { confiaveis: ['empresa-alfa.test'] }).confianca, 'alta');
});

test('português e inglês', () => {
  assert.equal(classificar({ ...base, assunto: 'Thank you for applying' }).classe, 'confirmacao');
  assert.equal(classificar({ ...base, assunto: 'Update', trecho: 'We decided to move forward with other candidates.' }).classe, 'negativa');
  assert.equal(classificar({ ...base, assunto: 'Interview scheduled' }).classe, 'entrevista_agendada');
  assert.equal(classificar({ ...base, assunto: 'Offer letter' }).classe, 'oferta');
});

test('ruído de remetente desconhecido nunca vira etapa; de portal desconhecido sobe', () => {
  const r = classificar({ remetente_dominio: 'news.carreira-exemplo.test', assunto: 'Dicas', trecho: 'Cinco hábitos.' });
  assert.deepEqual([r.classe, r.precisa_abrir], ['ruido', false]);
  assert.equal(classificar({ remetente_dominio: 'vagas-promo.test', assunto: 'Você foi selecionado!', trecho: 'Responda.' }).classe, 'ruido');
});

test('as regras só leem campos do digest; a que precisa do corpo declara e só roda com corpo', () => {
  for (const regra of REGRAS) {
    assert.ok(['assunto', 'trecho', 'corpo'].includes(regra.campo), regra.id);
    assert.equal(regra.campo === 'corpo', regra.precisa_corpo === true, regra.id);
  }
  const item = { ...base, assunto: 'Atualização sobre sua candidatura', trecho: 'Empresa Alfa - Analista' };
  const corpo = 'Decidimos não avançar com sua candidatura neste momento.';
  assert.equal(classificar(item).classe, null);
  assert.equal(classificar(item, { corpo }).classe, 'negativa');
  assert.equal(classificar(item, { corpo: 'Há novidades no portal.' }).precisa_llm, true);
});

test('no corpus sintético: ≥ 90% por regra, ≥ 90% por classe e ambíguos encaminhados', () => {
  const rel = relatorioPorRegra(amostra);
  console.log(formatarRelatorio(rel));
  assert.ok(rel.regras.length >= 10);
  for (const l of rel.regras) assert.ok(l.precisao >= 0.9, `${l.regra}: ${l.precisao}`);
  for (const c of rel.classes.filter(c => c.classe !== 'pendente')) assert.ok(c.cobertura >= 0.9, `${c.classe}: ${c.cobertura}`);
  assert.ok(rel.ambiguos.taxa >= 0.9, `ambíguos: ${rel.ambiguos.taxa}`);
});

test('a injeção no trecho não muda a classe resolvida pelo assunto', () => {
  const alvo = amostra.find(a => a.rotulo.armadilha === 'injecao' && a.rotulo.classe === 'confirmacao');
  assert.equal(classificar(alvo.item).classe, 'confirmacao');
});
