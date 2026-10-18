// Fábricas fictícias para os testes de candidatura (F6/F7).
export const HOJE = '2026-10-17';

export const resposta = (extra = {}) => ({
  id: 'pretensao-salarial',
  variantes_label: ['Pretensão salarial', 'Salário desejado', 'What are your salary expectations?', 'Qual a sua pretensão salarial?'],
  resposta: 'R$ 10.000 (CLT)',
  escopo: { tipo: 'global' },
  sensivel: true,
  proveniencia: { origem: 'usuario', registrado_em: '2026-10-17T12:00:00.000Z' },
  validade: '2027-04-17',
  ...extra,
});

// Answer bank da persona fictícia, cobrindo o formulário sintético do Greenhouse.
export const bancoPersona = () => [
  resposta(),
  resposta({ id: 'nome', variantes_label: ['First Name', 'Nome'], resposta: 'Ana', sensivel: false, validade: null }),
  resposta({ id: 'sobrenome', variantes_label: ['Last Name', 'Sobrenome'], resposta: 'Exemplo', sensivel: false, validade: null }),
  resposta({ id: 'email', variantes_label: ['Email', 'E-mail'], resposta: 'ana@exemplo.test', sensivel: false, validade: null }),
  resposta({ id: 'telefone', variantes_label: ['Phone', 'Telefone', 'Celular'], resposta: '+55 00 90000-0000', sensivel: true, validade: null }),
  resposta({ id: 'linkedin', variantes_label: ['LinkedIn Profile', 'LinkedIn URL', 'LinkedIn'], resposta: 'https://linkedin.example/ana', sensivel: false, validade: null }),
  resposta({ id: 'autorizacao-trabalho', variantes_label: ['Are you legally authorized to work in Brazil?'], resposta: 'Yes', sensivel: false, validade: null }),
  resposta({ id: 'genero', variantes_label: ['Gender (voluntary)', 'Gênero'], resposta: 'Decline to self-identify', sensivel: true, validade: null }),
];
