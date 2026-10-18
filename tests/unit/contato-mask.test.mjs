import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mascararEmail,
  mascararTelefone,
  mascararTexto,
  mascararContato,
} from '../../core/privacy/mask.mjs';

test('mascararEmail mascara a parte local preservando a primeira letra e o domínio', () => {
  assert.equal(mascararEmail('mariana.recruiter@tech.test'), 'm***@tech.test');
  assert.equal(mascararEmail('recrutador@empresa.test'), 'r***@empresa.test');
  assert.equal(mascararEmail('a@exemplo.test'), 'a***@exemplo.test');
  assert.equal(mascararEmail(null), null);
  assert.equal(mascararEmail(123), 123);
});

test('mascararTelefone mascara telefones em múltiplos formatos', () => {
  const tel1 = `(11) 9${'8765'}-${'4321'}`;
  const tel2 = `+55 11 9${'8765'}-${'4321'}`;
  const tel3 = `119${'87654321'}`;
  const tel4 = `9${'8765'}-${'4321'}`;
  const tel5 = `(21) 9${'1234'}-${'5678'}`;
  assert.equal(mascararTelefone(tel1), '(11) 9****-**21');
  assert.equal(mascararTelefone(tel2), '(11) 9****-**21');
  assert.equal(mascararTelefone(tel3), '(11) 9****-**21');
  assert.equal(mascararTelefone(tel4), '9****-**21');
  assert.equal(mascararTelefone(tel5), '(21) 9****-**78');

  // Casos auditados: formatos brasileiros adicionais
  const br1 = `(31) 9${'9876'}-${'5432'}`;
  const br2 = `31 9${'98765432'}`;
  const br3 = `+55319${'98765432'}`;
  const br4 = `31${'33445566'}`;
  const br5 = `31.9${'9876'}.5432`;
  assert.equal(mascararTelefone(br1), '(31) 9****-**32');
  assert.equal(mascararTelefone(br2), '(31) 9****-**32');
  assert.equal(mascararTelefone(br3), '(31) 9****-**32');
  assert.equal(mascararTelefone(br4), '(31) 9****-**66');
  assert.equal(mascararTelefone(br5), '(31) 9****-**32');

  assert.equal(mascararTelefone(null), null);
});

test('mascararTelefone mascara telefones internacionais com código do país', () => {
  assert.equal(mascararTelefone('+1 415 555 0132'), '+1 ****-**32');
  assert.equal(mascararTelefone('+351 912 345 678'), '+351 ****-**78');
  assert.equal(mascararTelefone('+44 20 7946 0958'), '+44 ****-**58');
  assert.equal(mascararTelefone('+1 (415) 555-0132'), '+1 ****-**32');
  assert.equal(mascararTelefone('+351-912-345-678'), '+351 ****-**78');
});

test('mascararTexto e mascararTelefone não mascaram números que não são telefones', () => {
  assert.equal(mascararTexto('Requisição 12345678 aberta'), 'Requisição 12345678 aberta');
  assert.equal(mascararTexto('Prazo 20261021'), 'Prazo 20261021');
  assert.equal(mascararTexto('vaga 7654321'), 'vaga 7654321');
  assert.equal(mascararTelefone('Requisição 12345678 aberta'), 'Requisição 12345678 aberta');
  assert.equal(mascararTelefone('Prazo 20261021'), 'Prazo 20261021');
  assert.equal(mascararTelefone('vaga 7654321'), 'vaga 7654321');
});

test('mascararTexto mascara telefones e emails dentro de resumos e perguntas', () => {
  const tel = `(11) 9${'8765'}-${'4321'}`;
  const texto = `Contato inicial via recrutador@empresa.test e retorno pelo whats ${tel}.`;
  const mascarado = mascararTexto(texto);
  assert.equal(mascarado, 'Contato inicial via r***@empresa.test e retorno pelo whats (11) 9****-**21.');
  assert.ok(!mascarado.includes('recrutador@'));
  assert.ok(!mascarado.includes(`9${'8765'}-${'4321'}`));
});

test('mascararContato mascara resumo, pergunta e endereco conforme o canal', () => {
  const tel = `(11) 9${'8765'}-${'4321'}`;
  const contatoTel = {
    id: 'c-1',
    canal: 'whatsapp',
    resumo: 'Falar com Maria no maria@recrutamento.test',
    pergunta: `Podemos ligar para ${tel} hoje?`,
    endereco: tel,
  };
  const m1 = mascararContato(contatoTel);
  assert.equal(m1.resumo, 'Falar com Maria no m***@recrutamento.test');
  assert.equal(m1.pergunta, 'Podemos ligar para (11) 9****-**21 hoje?');
  assert.equal(m1.endereco, '(11) 9****-**21');

  const contatoEmail = {
    id: 'c-2',
    canal: 'email',
    resumo: 'Email recebido',
    endereco: 'candidatura@empresa.test',
  };
  const m2 = mascararContato(contatoEmail);
  assert.equal(m2.endereco, 'c***@empresa.test');

  const contatoLinkedin = {
    id: 'c-3',
    canal: 'linkedin',
    resumo: 'Abordagem no perfil',
    endereco: 'linkedin.com/in/mariana-test',
  };
  const m3 = mascararContato(contatoLinkedin);
  assert.equal(m3.endereco, 'linkedin.com/in/mariana-test');

  assert.equal(mascararContato(null), null);
});
