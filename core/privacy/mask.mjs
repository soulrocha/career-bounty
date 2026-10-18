// core/privacy/mask.mjs
// Motor de mascaramento de PII para dados de contatos de recrutadores.
// Garante que telefones e e-mails nunca vazem sem mascaramento na API e resumos.

const EMAIL_REGEX = /([A-Za-z0-9_%+.-])[A-Za-z0-9_%+.-]*(@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

const DDDS_VALIDOS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export function mascararEmail(email) {
  if (typeof email !== 'string') return email;
  return email.replace(EMAIL_REGEX, '$1***$2');
}

export function mascararTelefone(telefone) {
  if (typeof telefone !== 'string') return telefone;

  // 1. Telefones internacionais e +55 que começam com "+"
  let res = telefone.replace(/(?<![\w+])\+(\d{1,4})((?:[\s\-./()]*\d)+[\s\-./()]*)(?![\w])/g, (match, d1) => {
    const allDigits = match.replace(/\D/g, '');
    if (allDigits.length < 8) return match;
    // Se for +55 seguido de DDD brasileiro válido e 8-9 dígitos, trata como brasileiro
    if (allDigits.startsWith('55') && (allDigits.length === 12 || allDigits.length === 13)) {
      const restDigits = allDigits.slice(2);
      const ddd = restDigits.slice(0, 2);
      if (DDDS_VALIDOS.has(ddd)) {
        const ult = restDigits.slice(-2);
        return `(${ddd}) 9****-**${ult}`;
      }
    }
    // Internacional genérico: +<código do país> ****-**<últimos 2>
    const ult2 = allDigits.slice(-2);
    return `+${d1} ****-**${ult2}`;
  });

  // 2. Telefones brasileiros com DDD em parênteses: (DD) ...
  res = res.replace(/(?<!\d)\(([1-9][1-9])\)\s*(?:9\s*)?(\d{4,5})[-.\s]?(\d{2})(\d{2})(?!\d)/g, (match, ddd, miolo, penult, ult) => {
    return `(${ddd}) 9****-**${ult}`;
  });

  // 3. Telefones brasileiros com DDD + separador (espaço, ponto) ou 10-11 dígitos contínuos com DDD válido
  res = res.replace(/(?<!\d)([1-9][1-9])(?:[\s.-]+(?:9[\s.-]*)?(\d{4,5})[-.\s]?(\d{2})(\d{2})|(\d{6,7})(\d{2}))(?!\d)/g, (match, ddd, m1, p1, u1, m2, u2) => {
    if (!DDDS_VALIDOS.has(ddd)) return match;
    const ult = u1 ?? u2;
    return `(${ddd}) 9****-**${ult}`;
  });

  // 4. Telefone sem DDD, mas com separador de blocos: 8 ou 9 dígitos separados
  res = res.replace(/(?<!\d)(?:9\s*)?(\d{4,5})[-.](\d{2})(\d{2})(?!\d)/g, (match, miolo, penult, ult) => {
    return `9****-**${ult}`;
  });

  return res;
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

export function mascararProcesso(processo) {
  if (!processo || typeof processo !== 'object') return processo;
  const copia = { ...processo };
  if (copia.empresa) copia.empresa = mascararTexto(copia.empresa);
  if (copia.cargo) copia.cargo = mascararTexto(copia.cargo);
  if (copia.nota) copia.nota = mascararTexto(copia.nota);
  if (Array.isArray(copia.eventos)) {
    copia.eventos = copia.eventos.map(e => {
      const ev = { ...e };
      if (ev.detalhe) ev.detalhe = mascararTexto(ev.detalhe);
      if (ev.nota) ev.nota = mascararTexto(ev.nota);
      if (ev.resumo) ev.resumo = mascararTexto(ev.resumo);
      if (ev.pergunta) ev.pergunta = mascararTexto(ev.pergunta);
      return ev;
    });
  }
  return copia;
}

export function mascararItemHistorico(item) {
  if (!item || typeof item !== 'object') return item;
  const copia = { ...item };
  if (copia.titulo) copia.titulo = mascararTexto(copia.titulo);
  if (copia.resumo) copia.resumo = mascararTexto(copia.resumo);
  if (copia.detalhe) copia.detalhe = mascararTexto(copia.detalhe);
  if (copia.assunto) copia.assunto = mascararTexto(copia.assunto);
  if (copia.nota) copia.nota = mascararTexto(copia.nota);
  if (copia.pergunta) copia.pergunta = mascararTexto(copia.pergunta);
  if (copia.endereco) copia.endereco = mascararTexto(copia.endereco);
  if (copia.motivo) copia.motivo = mascararTexto(copia.motivo);
  if (copia.pessoa && typeof copia.pessoa === 'object') {
    copia.pessoa = {
      ...copia.pessoa,
      nome: copia.pessoa.nome ? mascararTexto(copia.pessoa.nome) : null,
      papel: copia.pessoa.papel ? mascararTexto(copia.pessoa.papel) : null,
    };
  }
  if (copia.proxima_etapa) {
    if (typeof copia.proxima_etapa === 'string') {
      copia.proxima_etapa = mascararTexto(copia.proxima_etapa);
    } else if (typeof copia.proxima_etapa === 'object') {
      copia.proxima_etapa = {
        ...copia.proxima_etapa,
        texto: copia.proxima_etapa.texto ? mascararTexto(copia.proxima_etapa.texto) : null,
      };
    }
  }
  return copia;
}

export function mascararVagaHistorico(vaga) {
  if (!vaga || typeof vaga !== 'object') return vaga;
  const copia = { ...vaga };
  if (copia.empresa) copia.empresa = mascararTexto(copia.empresa);
  if (copia.cargo) copia.cargo = mascararTexto(copia.cargo);
  if (Array.isArray(copia.linha_do_tempo)) {
    copia.linha_do_tempo = copia.linha_do_tempo.map(mascararItemHistorico);
  }
  if (Array.isArray(copia.itens)) {
    copia.itens = copia.itens.map(mascararItemHistorico);
  }
  return copia;
}

export function mascararHistorico(historicoOuEnvelope) {
  if (!historicoOuEnvelope) return historicoOuEnvelope;
  if (Array.isArray(historicoOuEnvelope)) {
    return historicoOuEnvelope.map(mascararVagaHistorico);
  }
  if (typeof historicoOuEnvelope === 'object' && Array.isArray(historicoOuEnvelope.historico)) {
    return {
      ...historicoOuEnvelope,
      historico: historicoOuEnvelope.historico.map(mascararVagaHistorico),
    };
  }
  return historicoOuEnvelope;
}


