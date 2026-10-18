// panel/curriculoLogic.mjs
// Módulo puro de lógica, formatação, filtragem e ordenação para a aba Currículo e Provas (F10.4).

export const SITUACOES = ['confere', 'sem_prova', 'fora_do_cv', 'lacunas'];

export const METADADOS_SITUACAO = {
  confere: {
    nome: 'Confere',
    descricao: 'No CV e com dado que prova',
    acaoPadrao: 'Em dia',
    corClasse: 'ok',
    eixoVertical: 'Está no CV',
    eixoHorizontal: 'Tem dado que prova',
  },
  sem_prova: {
    nome: 'Sem prova',
    descricao: 'No CV, mas falta dado ou número',
    acaoPadrao: 'Revisar',
    corClasse: 'atencao',
    eixoVertical: 'Está no CV',
    eixoHorizontal: 'Não tem dado',
  },
  fora_do_cv: {
    nome: 'Fora do CV',
    descricao: 'Tem dado, mas não está no CV',
    acaoPadrao: 'Incluir',
    corClasse: 'info',
    eixoVertical: 'Fora do CV',
    eixoHorizontal: 'Tem dado que prova',
  },
  lacunas: {
    nome: 'Lacunas',
    descricao: 'Pedido pelas vagas, sem dado na base',
    acaoPadrao: 'Responder',
    corClasse: 'perigo',
    eixoVertical: 'Fora do CV',
    eixoHorizontal: 'Não tem dado',
  },
};

export const FORCA_PROVA = {
  verificado: 3,
  entregue: 2,
  proposto: 1,
  relato: 0,
};

/**
 * Normaliza um item individual garantindo campos obrigatórios para renderização.
 */
export function normalizarItem(item = {}, situacao = 'confere') {
  if (!item || typeof item !== 'object') {
    return {
      id: Math.random().toString(36).slice(2),
      texto: '',
      afirmacoes: [],
      evidencias: [],
      nivel_prova: null,
      peso: null,
      motivo: null,
      pergunta: null,
      situacao,
    };
  }

  const id = String(item.id || item.codigo || item.alvo || Math.random().toString(36).slice(2));
  const texto = String(item.texto || item.descricao || item.motivo || '');
  const afirmacoes = Array.isArray(item.afirmacoes)
    ? item.afirmacoes.map(a => (typeof a === 'object' && a !== null ? String(a.id || '') : String(a)))
    : Array.isArray(item.claim_ids)
    ? item.claim_ids.map(String)
    : [];
  const evidencias = Array.isArray(item.evidencias) ? item.evidencias.map(String) : [];
  const nivel_prova = item.nivel_prova || (item.afirmacoes?.[0]?.nivel_prova ?? null);
  const peso = typeof item.peso === 'number' ? item.peso : null;
  const motivo = item.motivo || null;
  const pergunta = item.pergunta || item.pergunta_sugerida || null;
  const status = item.status || null;

  return {
    id,
    texto,
    afirmacoes,
    evidencias,
    nivel_prova,
    peso,
    motivo,
    pergunta,
    situacao,
    ...(status ? { status } : {}),
  };
}

/**
 * Normaliza resposta da API, suportando:
 * 1. O contrato novo direto ({ confere, sem_prova, fora_do_cv, lacunas }).
 * 2. O contrato da F9.5 com chave grupos ({ grupos: { confere, sem_prova, fora_do_cv, lacuna/lacunas } }).
 * 3. O contrato legado (/api/quadrantes com a, b, c, d).
 */
export function normalizarRespostaAnalise(dadosApi = {}) {
  if (!dadosApi || typeof dadosApi !== 'object' || Array.isArray(dadosApi)) {
    return {
      confere: [],
      sem_prova: [],
      fora_do_cv: [],
      lacunas: [],
      contagem: { confere: 0, sem_prova: 0, fora_do_cv: 0, lacunas: 0 },
      avisos: [],
    };
  }

  const fonte = (dadosApi.grupos && typeof dadosApi.grupos === 'object') ? dadosApi.grupos : dadosApi;

  // Se estiver no formato novo (direto ou dentro de grupos)
  if (
    Array.isArray(fonte.confere) ||
    Array.isArray(fonte.sem_prova) ||
    Array.isArray(fonte.fora_do_cv) ||
    Array.isArray(fonte.lacunas) ||
    Array.isArray(fonte.lacuna)
  ) {
    const confere = (fonte.confere || []).map(i => normalizarItem(i, 'confere'));
    const sem_prova = (fonte.sem_prova || []).map(i => normalizarItem(i, 'sem_prova'));
    const fora_do_cv = (fonte.fora_do_cv || []).map(i => normalizarItem(i, 'fora_do_cv'));
    const listaLacunas = fonte.lacunas || fonte.lacuna || [];
    const lacunas = listaLacunas.map(i => normalizarItem(i, 'lacunas'));

    return {
      confere,
      sem_prova,
      fora_do_cv,
      lacunas,
      contagem: {
        confere: confere.length,
        sem_prova: sem_prova.length,
        fora_do_cv: fora_do_cv.length,
        lacunas: lacunas.length,
      },
      avisos: Array.isArray(dadosApi.avisos) ? dadosApi.avisos : [],
    };
  }

  // Mapeamento de fallback do formato legado de quadrantes (a, b, c, d)
  const confere = (fonte.a || []).map(i => normalizarItem(i, 'confere'));
  const fora_do_cv = (fonte.b || []).map(i => normalizarItem(i, 'fora_do_cv'));
  const sem_prova = (fonte.c || []).map(i => normalizarItem(i, 'sem_prova'));
  const lacunas = (fonte.d || []).map(i => normalizarItem(i, 'lacunas'));

  return {
    confere,
    sem_prova,
    fora_do_cv,
    lacunas,
    contagem: {
      confere: confere.length,
      sem_prova: sem_prova.length,
      fora_do_cv: fora_do_cv.length,
      lacunas: lacunas.length,
    },
    avisos: Array.isArray(dadosApi.avisos) ? dadosApi.avisos : [],
  };
}

/**
 * Separa e filtra itens das 4 situações excluindo identificadores ignorados.
 */
export function categorizarItens(analise = {}, ignorados = new Set()) {
  const norm = normalizarRespostaAnalise(analise);
  const ign = ignorados instanceof Set ? ignorados : new Set(ignorados || []);

  return {
    confere: norm.confere.filter(i => !ign.has(i.id)),
    sem_prova: norm.sem_prova.filter(i => !ign.has(i.id)),
    fora_do_cv: norm.fora_do_cv.filter(i => !ign.has(i.id)),
    lacunas: norm.lacunas.filter(i => !ign.has(i.id)),
  };
}

/**
 * Calcula os totais de cada célula e o badge da aba.
 * O badge soma os itens que pedem atenção: sem_prova + lacunas.
 */
export function calcularTotaisCurriculo(analise = {}, ignorados = new Set()) {
  const cat = categorizarItens(analise, ignorados);
  const confere = cat.confere.length;
  const sem_prova = cat.sem_prova.length;
  const fora_do_cv = cat.fora_do_cv.length;
  const lacunas = cat.lacunas.length;
  const badgeCurriculo = sem_prova + lacunas;

  return {
    confere,
    sem_prova,
    fora_do_cv,
    lacunas,
    badgeCurriculo,
    temAtencao: badgeCurriculo > 0,
  };
}

/**
 * Filtra lista de itens por termo de busca textual, nível de prova e status.
 */
export function filtrarItens(itens = [], { busca = '', nivel = '', status = '' } = {}) {
  let resultado = [...itens];

  if (busca && typeof busca === 'string') {
    const q = busca.toLowerCase().trim();
    resultado = resultado.filter(i =>
      (i.texto || '').toLowerCase().includes(q) ||
      (i.id || '').toLowerCase().includes(q) ||
      (i.afirmacoes || []).some(a => String(a).toLowerCase().includes(q)) ||
      (i.motivo && String(i.motivo).toLowerCase().includes(q)) ||
      (i.pergunta && String(i.pergunta).toLowerCase().includes(q))
    );
  }

  if (nivel && typeof nivel === 'string') {
    resultado = resultado.filter(i => i.nivel_prova === nivel);
  }

  if (status && typeof status === 'string') {
    resultado = resultado.filter(i => i.status === status);
  }

  return resultado;
}

/**
 * Ordena itens deterministicamente de acordo com a situação:
 * - lacunas: maior peso primeiro, depois id ASC, depois alfabético por texto.
 * - fora_do_cv: maior nível de prova (verificado > entregue), depois alfabético por id.
 * - sem_prova: itens com divergência/motivo primeiro, depois id ASC.
 * - confere: alfabético por id ASC.
 */
export function ordenarItens(itens = [], situacao = 'confere') {
  const copia = [...itens];

  if (situacao === 'lacunas') {
    return copia.sort((a, b) =>
      (b.peso || 0) - (a.peso || 0) ||
      a.id.localeCompare(b.id, 'pt-BR', { numeric: true }) ||
      (a.texto || '').localeCompare(b.texto || '', 'pt-BR')
    );
  }

  if (situacao === 'fora_do_cv') {
    return copia.sort((a, b) => {
      const forcaA = FORCA_PROVA[a.nivel_prova] ?? -1;
      const forcaB = FORCA_PROVA[b.nivel_prova] ?? -1;
      return (forcaB - forcaA) || a.id.localeCompare(b.id, 'pt-BR', { numeric: true });
    });
  }

  if (situacao === 'sem_prova') {
    return copia.sort((a, b) => {
      const temMotivoA = Boolean(a.motivo);
      const temMotivoB = Boolean(b.motivo);
      if (temMotivoA !== temMotivoB) return temMotivoA ? -1 : 1;
      return a.id.localeCompare(b.id, 'pt-BR', { numeric: true });
    });
  }

  return copia.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }));
}

/**
 * Retorna classe semântica correspondente à situação para estilização CSS.
 */
export function obterClasseCorSituacao(situacao) {
  return METADADOS_SITUACAO[situacao]?.corClasse || 'normal';
}

/**
 * Formata o badge do nível de prova.
 */
export function formatarNivelProvaBadge(nivel) {
  if (!nivel || typeof nivel !== 'string') return null;
  const classe = `nivel-${nivel}`;
  return {
    label: nivel,
    classe,
    verificado: nivel === 'verificado',
  };
}

/**
 * Formata o badge de peso de lacuna.
 */
export function formatarPesoBadge(peso) {
  if (typeof peso !== 'number') return null;
  return {
    label: `peso ${peso}`,
    peso,
  };
}

/**
 * Monta payload de inclusão no currículo.
 */
export function montarPayloadIncluir(itemId, opcoes = {}) {
  if (!itemId || typeof itemId !== 'string' && typeof itemId !== 'number') {
    throw new Error('itemId é obrigatório para inclusão.');
  }
  return {
    item_id: String(itemId),
    afirmacao_id: opcoes.afirmacao_id ? String(opcoes.afirmacao_id) : undefined,
  };
}

/**
 * Monta payload de marcação (revisar ou ignorar).
 */
export function montarPayloadMarcar(itemId, acao) {
  if (!itemId || typeof itemId !== 'string' && typeof itemId !== 'number') {
    throw new Error('itemId é obrigatório.');
  }
  if (!['revisar', 'ignorar'].includes(acao)) {
    throw new Error(`Ação inválida: "${acao}". Esperado "revisar" ou "ignorar".`);
  }
  return {
    item_id: String(itemId),
    acao,
  };
}

/**
 * Monta payload para geração de pergunta de entrevista.
 */
export function montarPayloadEntrevista(itemId) {
  if (!itemId || typeof itemId !== 'string' && typeof itemId !== 'number') {
    throw new Error('itemId é obrigatório para geração de entrevista.');
  }
  return {
    item_id: String(itemId),
  };
}

/**
 * Devolve ícones SVG seguros inline, sem qualquer tag <img>.
 */
export function obterIconeSvgCurriculo(tipo) {
  const map = {
    check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    atencao: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    plus: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    entrevista: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    busca: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };
  return map[tipo] || map.check;
}

export const DDDS_VALIDOS = new Set([
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

/**
 * Regra de privacidade estrita: mascara qualquer telefone (+55, celulares, fixos) e e-mails.
 */
export function mascararDadoSensivel(texto) {
  if (typeof texto !== 'string') return texto;

  // 1. E-mails
  let res = texto.replace(/([A-Za-z0-9_%+.-])[A-Za-z0-9_%+.-]*(@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, '$1***$2');

  // 2. Telefones que começam com "+" (+55 ou internacional)
  res = res.replace(/(?<![\w+])\+(\d{1,4})((?:[\s\-./()]*\d)+[\s\-./()]*)(?![\w])/g, (match, d1) => {
    const allDigits = match.replace(/\D/g, '');
    if (allDigits.length < 8) return match;
    if (allDigits.startsWith('55') && (allDigits.length === 12 || allDigits.length === 13)) {
      const restDigits = allDigits.slice(2);
      const ddd = restDigits.slice(0, 2);
      if (DDDS_VALIDOS.has(ddd)) {
        const ult = restDigits.slice(-2);
        return `(${ddd}) 9****-**${ult}`;
      }
    }
    const ult2 = allDigits.slice(-2);
    return `+${d1} ****-**${ult2}`;
  });

  // 3. Telefones brasileiros com DDD em parênteses: (DD) ...
  res = res.replace(/(?<!\d)\(([1-9][1-9])\)\s*(?:9\s*)?(\d{4,5})[-.\s]?(\d{2})(\d{2})(?!\d)/g, (match, ddd, miolo, penult, ult) => {
    return `(${ddd}) 9****-**${ult}`;
  });

  // 4. Telefones com DDD sem parênteses: DD 9XXXX-XXXX
  res = res.replace(/(?<!\d)([1-9][1-9])(?:[\s.-]+(?:9[\s.-]*)?(\d{4,5})[-.\s]?(\d{2})(\d{2})|(\d{6,7})(\d{2}))(?!\d)/g, (match, ddd, m1, p1, u1, m2, u2) => {
    if (!DDDS_VALIDOS.has(ddd)) return match;
    const ult = u1 ?? u2;
    return `(${ddd}) 9****-**${ult}`;
  });

  // 5. Telefones sem DDD com separador
  res = res.replace(/(?<!\d)(?:9\s*)?(\d{4,5})[-.](\d{2})(\d{2})(?!\d)/g, (match, miolo, penult, ult) => {
    return `9****-**${ult}`;
  });

  return res;
}

/**
 * Higieniza um item de currículo para exibição, mascarando PII de texto, motivo e pergunta.
 */
export function higienizarItemCurriculo(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    texto: item.texto ? mascararDadoSensivel(item.texto) : item.texto,
    motivo: item.motivo ? mascararDadoSensivel(item.motivo) : item.motivo,
    pergunta: item.pergunta ? mascararDadoSensivel(item.pergunta) : item.pergunta,
  };
}
