// panel/processosLogic.mjs
// Lógica pura desacoplada para a Aba Processos (F10.3).
// Mapeamento de estações canônicas, inatividade, filtros, ordenação e templates seguros.

export const ESTAPAS_CANONICAS = ['Candidatura', 'Contato', 'Entrevista', 'Devolutiva'];

export const ROTULOS_ESTACAO = {
  candidatura: 'Candidatura',
  contato: 'Contato',
  entrevista: 'Entrevista',
  devolutiva: 'Devolutiva',
};

export const ROTULOS_ETAPA_BACKEND = {
  aplicada: 'Candidatura enviada',
  triagem: 'Em triagem',
  teste: 'Desafio prático',
  entrevista_rh: 'Alinhamento com RH',
  entrevista_tecnica: 'Entrevista técnica',
  entrevista_gestor: 'Entrevista com gestor',
  proposta: 'Proposta recebida',
  aprovado: 'Aprovado',
  encerrado: 'Encerrado',
  negativa: 'Processo encerrado',
};

export const CANAIS_ICONES = {
  email: 'mail',
  whatsapp: 'msg',
  linkedin: 'in',
  portal: 'doc',
  outro: 'doc',
};

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

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Formata data no formato brasileiro DD/MM/AAAA.
 */
export function formatarDataPtBr(dataStr) {
  if (!dataStr || typeof dataStr !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataStr);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return dataStr;
}

/**
 * Calcula o nível de inatividade e alerta:
 * - < 5 dias: 'normal'
 * - 5 a 6 dias: 'atencao'
 * - >= 7 dias: 'lembrar'
 * - situacao === 'encerrado': 'encerrado'
 */
export function calcularNivelInatividade(dias, situacao) {
  let sit = situacao;
  let d = dias;
  if (typeof dias === 'object' && dias !== null) {
    sit = dias.situacao;
    d = dias.dias_inatividade;
  }
  if (sit === 'encerrado') return 'encerrado';
  const n = Number(d) || 0;
  if (n >= 7) return 'lembrar';
  if (n >= 5) return 'atencao';
  return 'normal';
}

/**
 * Retorna classe CSS semântica de alerta a partir do nível ou dias.
 */
export function obterClasseAlerta(alertaOuDias) {
  if (typeof alertaOuDias === 'number') {
    return alertaOuDias >= 7 ? 'perigo' : alertaOuDias >= 5 ? 'atencao' : 'normal';
  }
  if (alertaOuDias === 'lembrar') return 'perigo';
  return alertaOuDias || 'normal';
}

/**
 * Mapeia a etapa detalhada do backend para uma das 4 estações canônicas.
 * Suporta string direta ou objeto processo.
 */
export function mapearEstacaoCanonica(processo = {}) {
  const p = typeof processo === 'string' ? { etapa_atual: processo } : (processo || {});
  const etapa = p.etapa_atual || 'aplicada';
  const situacao = p.situacao || 'ativo';
  const desfecho = p.desfecho || null;
  const dias = Number(p.dias_inatividade) || 0;

  let indice = 0;
  let nome = 'Candidatura';
  let chave = 'candidatura';
  let esperando = false;
  let alerta = 'normal';

  // Estação 3: Devolutiva
  if (situacao === 'encerrado' || desfecho !== null || ['proposta', 'aprovado', 'negativa', 'encerrado'].includes(etapa)) {
    indice = 3;
    nome = 'Devolutiva';
    chave = 'devolutiva';
    esperando = false;
    alerta = 'normal';
  } else if (['teste', 'entrevista_rh', 'entrevista_tecnica', 'entrevista_gestor'].includes(etapa)) {
    // Estação 2: Entrevista
    indice = 2;
    nome = 'Entrevista';
    chave = 'entrevista';
    esperando = (situacao === 'aguardando_retorno');
    alerta = esperando ? calcularNivelInatividade(dias, situacao) : 'normal';
  } else {
    // Verificar se há triagem ou contato registrado
    const temContato = Array.isArray(p.eventos) && p.eventos.some(e => e.tipo === 'contato.registrado' || e.tipo === 'email.recebido');
    if (etapa === 'triagem' || temContato) {
      // Estação 1: Contato
      indice = 1;
      nome = 'Contato';
      chave = 'contato';
      esperando = (situacao === 'aguardando_retorno');
      alerta = esperando ? calcularNivelInatividade(dias, situacao) : 'normal';
    } else {
      // Estação 0: Candidatura
      indice = 0;
      nome = 'Candidatura';
      chave = 'candidatura';
      esperando = (situacao === 'aguardando_retorno' || situacao === 'ativo');
      alerta = esperando ? calcularNivelInatividade(dias, situacao) : 'normal';
    }
  }

  return {
    indice,
    nome,
    chave,
    esperando,
    diasInatividade: dias,
    alerta,
    valueOf() { return this.indice; },
    toString() { return this.nome; },
  };
}

/**
 * Identifica e ordena os processos que pedem acompanhamento:
 * Não encerrados e com inatividade >= 5 dias (ou alerta !== 'normal').
 */
export function identificarProcessosPedemAcompanhamento(processos = []) {
  if (!Array.isArray(processos)) return [];
  return processos
    .filter(p => p.situacao !== 'encerrado' && (Number(p.dias_inatividade) >= 5 || (p.alerta && p.alerta !== 'normal')))
    .sort((a, b) => (Number(b.dias_inatividade) || 0) - (Number(a.dias_inatividade) || 0));
}

/**
 * Filtra processos por estação canônica, situação, alerta e busca textual.
 */
export function filtrarProcessos(processos = [], filtros = {}) {
  if (!Array.isArray(processos)) return [];
  const b = norm(filtros.busca);
  const estacaoFiltro = filtros.estacao ? norm(filtros.estacao) : (filtros.etapa ? norm(filtros.etapa) : null);

  return processos.filter(p => {
    if (filtros.situacao && p.situacao !== filtros.situacao) return false;
    if (filtros.alerta && p.alerta !== filtros.alerta) return false;

    if (estacaoFiltro) {
      const canonica = mapearEstacaoCanonica(p);
      if (norm(canonica.nome) !== estacaoFiltro && norm(canonica.chave) !== estacaoFiltro && String(canonica.indice) !== estacaoFiltro) {
        return false;
      }
    }

    if (b) {
      const eventosTexto = (p.eventos || []).flatMap(e => [e.detalhe, e.resumo, e.assunto, e.etapa]);
      const textoGeral = norm([
        p.empresa,
        p.cargo,
        p.etapa_atual,
        p.situacao,
        p.desfecho,
        ...eventosTexto,
      ].join(' '));
      if (!textoGeral.includes(b)) return false;
    }

    return true;
  });
}

/**
 * Ordena processos: processos ativos por maior inatividade primeiro, depois encerrados.
 */
export function ordenarProcessos(processos = []) {
  if (!Array.isArray(processos)) return [];
  return [...processos].sort((a, b) => {
    const aEnc = a.situacao === 'encerrado';
    const bEnc = b.situacao === 'encerrado';
    if (aEnc && !bEnc) return 1;
    if (!aEnc && bEnc) return -1;
    return (Number(b.dias_inatividade) || 0) - (Number(a.dias_inatividade) || 0);
  });
}

/**
 * Gera rascunho amigável e profissional para mensagem de acompanhamento.
 */
export function gerarRascunhoMensagem(processo = {}, contato = null) {
  const primeiroNome = contato?.nome ? contato.nome.trim().split(' ')[0] : '';
  const saudacao = primeiroNome ? `Olá ${primeiroNome}, tudo bem?` : 'Olá, tudo bem?';
  const cargo = processo.cargo || 'oportunidade';
  const empresa = processo.empresa ? ` na ${processo.empresa}` : '';
  const dataRef = processo.eventos?.[0]?.data ? formatarDataPtBr(processo.eventos[0].data) : '';
  const mencaoData = dataRef ? ` em ${dataRef}` : '';

  return `${saudacao} Me candidatei à vaga de ${cargo}${empresa}${mencaoData} e sigo com muito interesse na oportunidade. Gostaria de saber se há novidades sobre os próximos passos do processo seletivo. Fico à disposição para conversar.`;
}

export const gerarRascunhoAcompanhamento = gerarRascunhoMensagem;

/**
 * Gera URL segura de rascunho no Gmail (apenas abre compositor web; nunca envia).
 */
export function gerarMailtoGmail(destinatario = '', assunto = '', corpo = '') {
  let to = destinatario;
  let su = assunto;
  let body = corpo;
  if (typeof destinatario === 'object' && destinatario !== null) {
    to = destinatario.destinatario || destinatario.to || destinatario.email || '';
    su = destinatario.assunto || destinatario.su || destinatario.subject || '';
    body = destinatario.corpo || destinatario.body || '';
  }
  const base = 'https://mail.google.com/mail/?view=cm&fs=1';
  const params = new URLSearchParams();
  if (to) params.set('to', to);
  if (su) params.set('su', su);
  if (body) params.set('body', body);
  const q = params.toString();
  return q ? `${base}&${q}` : base;
}

export const gerarUrlGmailDraft = gerarMailtoGmail;

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
 * Retorna catálogo de ícones SVG limpos e vetoriais (zero tags de imagem).
 */
export function obterIconeSvgProcesso(tipo) {
  switch (tipo) {
    case 'mail':
    case 'email':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
    case 'msg':
    case 'whatsapp':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>';
    case 'in':
    case 'linkedin':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/></svg>';
    case 'doc':
    case 'portal':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>';
    case 'copiar':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    case 'mais':
    case 'adicionar':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    case 'alerta':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    case 'check':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    default:
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
  }
}

/**
 * Calcula totais por etapa canônica e situação.
 */
export function calcularTotaisProcessos(processos = []) {
  const lista = Array.isArray(processos) ? processos : [];
  const ativos = lista.filter(p => p.situacao !== 'encerrado');
  const pedem = identificarProcessosPedemAcompanhamento(lista);

  const porEstacao = {
    candidatura: 0,
    contato: 0,
    entrevista: 0,
    devolutiva: 0,
  };

  for (const p of ativos) {
    const st = mapearEstacaoCanonica(p);
    if (porEstacao[st.chave] !== undefined) {
      porEstacao[st.chave] += 1;
    }
  }

  return {
    total: lista.length,
    ativos: ativos.length,
    pedemAcompanhamento: pedem.length,
    encerrados: lista.filter(p => p.situacao === 'encerrado').length,
    porEstacao,
  };
}
