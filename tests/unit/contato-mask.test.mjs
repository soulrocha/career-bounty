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
  assert.equal(mascararTelefone(null), null);
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
