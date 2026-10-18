// core/privacy/mask.mjs
// Motor de mascaramento de PII para dados de contatos de recrutadores.
// Garante que telefones e e-mails nunca vazem sem mascaramento na API e resumos.

const EMAIL_REGEX = /([A-Za-z0-9_%+.-])[A-Za-z0-9_%+.-]*(@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const TELEFONE_COMPLETO_REGEX = /(?:\+55\s*)?(?:\(?([1-9][1-9])\)?\s*)?(?:9\s*)?(\d{4,5})[-.\s]?(\d{2})(\d{2})/g;

export function mascararEmail(email) {
  if (typeof email !== 'string') return email;
  return email.replace(EMAIL_REGEX, '$1***$2');
}

export function mascararTelefone(telefone) {
  if (typeof telefone !== 'string') return telefone;
  // Transforma qualquer telefone celular brasileiro em (DD) 9****-**XX ou similar
  return telefone.replace(TELEFONE_COMPLETO_REGEX, (match, ddd, miolo, penult, ult) => {
    const d = ddd ? `(${ddd}) ` : '';
    return `${d}9****-**${ult}`;
  });
}

export function mascararTexto(texto) {
  if (typeof texto !== 'string') return texto;
  return mascararTelefone(mascararEmail(texto));
}

export function mascararContato(contato) {
  if (!contato || typeof contato !== 'object') return contato;
  const copia = { ...contato };
  if (copia.resumo) copia.resumo = mascararTexto(copia.resumo);
  if (copia.pergunta) copia.pergunta = mascararTexto(copia.pergunta);
  if (copia.nome) copia.nome = mascararTexto(copia.nome);
  if (copia.papel) copia.papel = mascararTexto(copia.papel);
  if (copia.pessoa && typeof copia.pessoa === 'object') {
    copia.pessoa = {
      ...copia.pessoa,
      nome: copia.pessoa.nome ? mascararTexto(copia.pessoa.nome) : null,
      papel: copia.pessoa.papel ? mascararTexto(copia.pessoa.papel) : null,
    };
  }
  if (copia.proxima_etapa && typeof copia.proxima_etapa === 'object') {
    copia.proxima_etapa = {
      ...copia.proxima_etapa,
      texto: copia.proxima_etapa.texto ? mascararTexto(copia.proxima_etapa.texto) : null,
    };
  }
  if (copia.endereco) {
    copia.endereco = mascararTexto(copia.endereco);
  }
  return copia;
}
