import assert from 'node:assert/strict';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { aplicarEfeitos, extrairEntrevista, extrairPrazo } from '../../core/mail/effects.mjs';

const AGORA = new Date('2026-10-14T18:00:00Z');
const vagas = [
  { id: 'v1', empresa: 'Empresa Alfa', cargo: 'Analista de Dados', requisicao_id: 'job:48213' },
  { id: 'v2', empresa: 'Empresa Alfa', cargo: 'Analista de Dados', requisicao_id: 'job:47105' },
];
const alta = classe => ({ classe, confianca: 'alta', origem: 'regra' });
const msg = (id, data, classe, vaga = 'v1', extra = {}) => ({
  item: { message_id: id, data, remetente_dominio: 'gupy.com.br', assunto: extra.assunto ?? 'Assunto', trecho: extra.trecho ?? '' },
  classificacao: extra.classificacao ?? alta(classe), vinculo: { status: 'vinculado', vaga_id: vaga, requisicao: 'job:48213' }, corpo: extra.corpo,
});
const tipos = eventos => eventos.map(e => e.tipo);
const importar = (id, vaga, n = 0) => ({ id: `imp-${id}`, ts: `2026-10-01T00:00:0${n}Z`, ator: 'teste', tipo: 'vaga.importada', entidade: 'vaga', entidade_id: id, dados: { legado: vaga } });

test('email.recebido leva o message_id e a etapa avança uma única vez', async t => {
  const dataRoot = await tempDir(t);
  const { eventos } = aplicarEfeitos({ itens: [msg('m1', '2026-10-10', 'confirmacao'), msg('m2', '2026-10-11', 'confirmacao')], vagas, now: AGORA });
  assert.deepEqual(eventos.map(e => e.id), ['email.recebido:m1', 'email.recebido:m2']);
  assert.deepEqual(eventos.map(e => e.dados.avancou), [true, false]);
  await appendEvents(dataRoot, [importar('v1', vagas[0]), ...eventos]);
  await appendEvents(dataRoot, eventos); // outra rodada com o mesmo message_id: um evento só
  const lido = (await readEvents(dataRoot)).eventos;
  assert.equal(lido.filter(e => e.tipo === 'email.recebido').length, 2);
  const vaga = projectEvents(lido).vagas[0];
  assert.equal(vaga.candidatura_email.etapa, 'inscrita');
  assert.equal(vaga.candidatura_email.aplicada, true);
  assert.deepEqual(vaga.candidatura_email.mensagens, ['m1', 'm2']);
});

test('a data do e-mail nunca vira data de inscrição', async t => {
  const dataRoot = await tempDir(t);
  const { eventos } = aplicarEfeitos({ itens: [msg('m1', '2026-10-10', 'confirmacao')], vagas, now: AGORA });
  await appendEvents(dataRoot, [importar('v1', vagas[0]), ...eventos]);
  const vaga = projectEvents((await readEvents(dataRoot)).eventos).vagas[0];
  assert.equal(vaga.candidatura_email.data, undefined);
  assert.equal(vaga.candidatura_email.ultimo_email_em, '2026-10-10');
});

test('a etapa não retrocede por e-mail atrasado e a negativa encerra só aquela vaga', async t => {
  const dataRoot = await tempDir(t);
  const adiantada = { ...vagas[0], candidatura_email: { aplicada: true, etapa: 'entrevista' } };
  const { eventos, resumo } = aplicarEfeitos({ itens: [msg('m1', '2026-10-10', 'confirmacao'), msg('m4', '2026-10-13', 'negativa', 'v2')], vagas: [adiantada, vagas[1]], now: AGORA });
  assert.equal(eventos.find(e => e.id === 'email.recebido:m1').dados.avancou, false);
  assert.equal(resumo.avancaram, 1);
  await appendEvents(dataRoot, [importar('v1', adiantada), importar('v2', vagas[1], 1), ...eventos]);
  const [v1, v2] = projectEvents((await readEvents(dataRoot)).eventos).vagas;
  assert.equal(v1.candidatura_email.etapa, 'entrevista');
  assert.equal(v1.candidatura_email.encerrada, undefined);
  assert.equal(v2.candidatura_email.encerrada, true);
  assert.equal(v2.candidatura_email.encerrada_em, '2026-10-13');
});

test('e-mail posterior ao encerramento não reabre a candidatura', () => {
  const { eventos } = aplicarEfeitos({ itens: [msg('m1', '2026-10-10', 'negativa'), msg('m2', '2026-10-12', 'etapa_liberada', 'v1', { trecho: 'Realize o teste em até 3 dias.' })], vagas, now: AGORA });
  assert.deepEqual(eventos.map(e => [e.id, e.dados.avancou]), [['email.recebido:m1', true], ['email.recebido:m2', false]]);
  assert.ok(!tipos(eventos).includes('aviso.prazo'));
});

test('entrevista agendada gera proposta de evento (título, data, local) e nada é criado no Calendar', () => {
  const corpo = 'Gostaríamos de convidar você para uma entrevista. A conversa será no dia 20/10 às 14h30, videochamada (Google Meet).';
  const { eventos, resumo } = aplicarEfeitos({ itens: [msg('m1', '2026-10-12', 'entrevista_agendada', 'v1', { corpo })], vagas, now: AGORA });
  const proposta = eventos.find(e => e.tipo === 'calendario.proposto');
  assert.deepEqual({ ...proposta.dados }, { message_id: 'm1', vaga_id: 'v1', status: 'proposto', titulo: 'Entrevista - Empresa Alfa - Analista de Dados', data: '2026-10-20', hora: '14:30', local: 'videochamada (Google Meet)' });
  assert.equal(resumo.propostas, 1);
  assert.deepEqual(extrairEntrevista('dia 5 de novembro às 9h, presencial', '2026-10-30'), { data: '2026-11-05', hora: '09:00', local: 'presencial' });
  assert.deepEqual(extrairEntrevista('dia 03/01 às 10:00', '2026-12-28'), { data: '2027-01-03', hora: '10:00', local: null });
  assert.equal(extrairEntrevista('dia 31/02 às 10h', '2026-10-10'), null);
  assert.equal(extrairEntrevista('sem data nenhuma', '2026-10-10'), null);
});

test('prazo de teste ou vídeo gera aviso com data', () => {
  const { eventos } = aplicarEfeitos({ itens: [msg('m1', '2026-10-12', 'etapa_liberada', 'v1', { trecho: 'Realize o teste de lógica em até 5 dias.' })], vagas, now: AGORA });
  assert.deepEqual(eventos.find(e => e.tipo === 'aviso.prazo').dados, { message_id: 'm1', vaga_id: 'v1', ate: '2026-10-17', motivo: 'etapa_liberada' });
  assert.equal(extrairPrazo('Grave o vídeo em até 48 horas', '2026-10-12'), '2026-10-14');
  assert.equal(extrairPrazo('sem prazo', '2026-10-12'), null);
});

test('e-mail falso de entrevista (domínio não confere) não avança etapa e vira "revisar", sem proposta', () => {
  const falso = msg('m1', '2026-10-12', 'entrevista_agendada', 'v1', { classificacao: { classe: 'entrevista_agendada', confianca: 'baixa', origem: 'regra' }, trecho: 'Sua entrevista está agendada para 20/10 às 10h.' });
  const media = msg('m2', '2026-10-12', 'confirmacao', 'v1', { classificacao: { classe: 'confirmacao', confianca: 'media', origem: 'regra' } });
  const { eventos, resumo } = aplicarEfeitos({ itens: [falso, media], vagas, now: AGORA });
  assert.deepEqual(tipos(eventos), ['email.revisar', 'email.revisar']);
  assert.equal(resumo.avancaram, 0);
  assert.equal(resumo.propostas, 0);
});

test('pendentes: sem vínculo, classe incerta; ruído e alerta não geram evento', () => {
  const semVinculo = { item: { message_id: 'm1', data: '2026-10-12', remetente_dominio: 'gupy.com.br', assunto: 'Recebemos sua candidatura', trecho: '' }, classificacao: alta('confirmacao'), vinculo: { status: 'pendente', motivo: 'sem_id' } };
  const incerta = { ...msg('m2', '2026-10-12', 'pendente'), classificacao: { classe: 'pendente', confianca: 'baixa', origem: 'pendente' } };
  const ruido = { item: { message_id: 'm3', data: '2026-10-12', remetente_dominio: 'x.test', assunto: 'x', trecho: '' }, classificacao: alta('ruido'), vinculo: { status: 'sem_candidatura' } };
  const { eventos, resumo } = aplicarEfeitos({ itens: [semVinculo, incerta, ruido], vagas, now: AGORA });
  assert.deepEqual(eventos.map(e => [e.tipo, e.dados.motivo]), [['email.pendente', 'sem_id'], ['email.pendente', 'classe_incerta']]);
  assert.equal(resumo.ignorados, 1);
});

test('nenhuma URL nem endereço de e-mail vai para os eventos', () => {
  const sujo = msg('m1', '2026-10-12', 'confirmacao', 'v1', { assunto: 'Veja https://click.exemplo.test/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAA?token=segredo', trecho: 'http://x.test/y', corpo: 'link https://portal.gupy.io/confirmar?code=1' });
  const { eventos } = aplicarEfeitos({ itens: [sujo], vagas, now: AGORA });
  const json = JSON.stringify(eventos);
  assert.ok(!/https?:\/\//.test(json), json);
  assert.ok(!/@/.test(json));
});
