/**
 * @file panel/menuCorujaLogic.mjs
 * Módulo de lógica pura funcional para o Menu ⋯ e a Coruja Batedora do CareerBounty.
 * Sem dependências de DOM ou efeitos colaterais.
 */

/**
 * Normaliza string para busca e ordenação (minúsculas, sem acentos nem diacríticos).
 *
 * @param {string|null|undefined} texto
 * @returns {string}
 */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 1. Calcula o recado factual estrito e status da coruja com base na aba ativa e dados em memória.
 *
 * @param {Object} [params={}]
 * @param {'vagas'|'processos'|'curriculo'|'historico'} [params.aba='vagas'] - Aba atualmente ativa
 * @param {Array<Object>} [params.vagas=[]] - Lista de vagas da rodada
 * @param {Array<Object>} [params.processos=[]] - Lista de processos seletivos
 * @param {Object} [params.analiseCurriculo=null] - Dados da matriz de currículo e provas
 * @param {Array<Object>} [params.historico=[]] - Lista de candidaturas do histórico
 * @returns {{ texto: string, temNovidade: boolean, contagem: number, aba: string }}
 */
export function calcularRecadoCoruja({
  aba = 'vagas',
  vagas = [],
  processos = [],
  analiseCurriculo = null,
  historico = [],
} = {}) {
  // Aba Vagas: avalia vagas ativas e de alta aderência
  if (aba === 'vagas') {
    const ativas = (vagas || []).filter(v =>
      !v?.descarte_usuario?.descartada &&
      !v?.candidatura_usuario?.aplicada &&
      v?.url_status !== 'encerrada'
    );
    const altas = ativas.filter(v => v?.aderencia === 'alta');

    if (ativas.length === 0) {
      return {
        texto: 'Nenhuma vaga ativa na rodada atual.',
        temNovidade: false,
        contagem: 0,
        aba: 'vagas',
      };
    }

    if (altas.length === 0) {
      return {
        texto: `${ativas.length} vaga${ativas.length > 1 ? 's' : ''} na rodada. Nenhuma de alta aderência pendente.`,
        temNovidade: false,
        contagem: 0,
        aba: 'vagas',
      };
    }

    return {
      texto: `${ativas.length} vaga${ativas.length > 1 ? 's' : ''} nova${ativas.length > 1 ? 's' : ''} na rodada, ${altas.length} de alta aderência.`,
      temNovidade: true,
      contagem: altas.length,
      aba: 'vagas',
    };
  }

  // Aba Processos: avalia processos sem retorno há mais de 5 dias
  if (aba === 'processos') {
    const ativos = (processos || []).filter(p => p?.situacao !== 'encerrado');
    const parados = ativos.filter(p => {
      const dias = p?.dias_inatividade ?? p?.dias_sem_contato ?? 0;
      return dias >= 5 || p?.alerta === 'atencao' || p?.alerta === 'lembrar';
    });

    if (processos.length === 0) {
      return {
        texto: 'Nenhum processo seletivo em andamento.',
        temNovidade: false,
        contagem: 0,
        aba: 'processos',
      };
    }

    if (parados.length === 0) {
      return {
        texto: 'Todos os processos estão com contato recente.',
        temNovidade: false,
        contagem: 0,
        aba: 'processos',
      };
    }

    return {
      texto: `${parados.length} processo${parados.length > 1 ? 's' : ''} sem retorno há mais de 5 dias.`,
      temNovidade: true,
      contagem: parados.length,
      aba: 'processos',
    };
  }

  // Aba Currículo e provas: avalia lacunas e itens sem prova
  if (aba === 'curriculo') {
    const contadores = analiseCurriculo?.contadores || {};
    const grupos = analiseCurriculo?.grupos || {};

    const lacunas = contadores.lacuna ?? contadores.lacunas ?? grupos.lacuna?.length ?? grupos.lacunas?.length ?? 0;
    const semProva = contadores.sem_prova ?? grupos.sem_prova?.length ?? 0;

    if (lacunas === 0 && semProva === 0) {
      return {
        texto: 'Currículo 100% comprovado pela base de dados.',
        temNovidade: false,
        contagem: 0,
        aba: 'curriculo',
      };
    }

    return {
      texto: `${lacunas} lacuna${lacunas > 1 ? 's' : ''} e ${semProva} ite${semProva > 1 ? 'ns' : 'm'} sem prova identificados.`,
      temNovidade: true,
      contagem: lacunas + semProva,
      aba: 'curriculo',
    };
  }

  // Aba Histórico: avalia total de candidaturas registradas
  if (aba === 'historico') {
    const total = (historico || []).length;
    if (total === 0) {
      return {
        texto: 'Nenhuma candidatura registrada no histórico.',
        temNovidade: false,
        contagem: 0,
        aba: 'historico',
      };
    }
    return {
      texto: `${total} candidatura${total > 1 ? 's' : ''} registrada${total > 1 ? 's' : ''} no histórico.`,
      temNovidade: false,
      contagem: total,
      aba: 'historico',
    };
  }

  // Fallback seguro para aba desconhecida
  return {
    texto: 'Radar ativo e pronto para novas consultas.',
    temNovidade: false,
    contagem: 0,
    aba,
  };
}

/**
 * 2. Alterna o estado da animação do fundo de pixel art e gera rótulos acessíveis.
 *
 * @param {Object} [params={}]
 * @param {boolean} [params.pausadoAtual=false] - Estado booleano atual de pausa
 * @param {string|null} [params.preferenciaStorage=null] - Valor salvo em localStorage ('1' ou '0')
 * @param {boolean} [params.prefersReducedMotion=false] - Respeito à preferência do sistema operacional
 * @returns {{ pausado: boolean, valorStorage: '1'|'0', rotuloBotao: string, rotuloDescricao: string, fundoAtivo: boolean }}
 */
export function alternarEstadoAnimacao({
  pausadoAtual = false,
  preferenciaStorage = null,
  prefersReducedMotion = false,
} = {}) {
  const novoPausado = !pausadoAtual;
  const valorStorage = novoPausado ? '1' : '0';
  const rotuloBotao = novoPausado ? 'Retomar a animação do fundo' : 'Parar a animação do fundo';
  const rotuloDescricao = novoPausado
    ? 'Ativa o céu animado em pixel art'
    : 'Pausa o céu em pixel art se preferir tela estática';
  const fundoAtivo = !novoPausado && !prefersReducedMotion;

  return {
    pausado: novoPausado,
    valorStorage,
    rotuloBotao,
    rotuloDescricao,
    fundoAtivo,
  };
}

/**
 * 3. Filtra e ordena as respostas de formulário do Answer Bank.
 *
 * @param {Array<Object>} [respostas=[]] - Lista bruta de respostas salvas
 * @param {Object} [filtros={}]
 * @param {string} [filtros.termo=''] - Termo de busca textual
 * @param {string} [filtros.escopo=''] - Tipo de escopo ('global', 'portal', 'empresa')
 * @param {boolean} [filtros.apenasSensiveis=false] - Se deve filtrar apenas itens sensíveis
 * @returns {Array<Object>} Lista filtrada de respostas
 */
export function filtrarRespostasFormulario(
  respostas = [],
  { termo = '', escopo = '', apenasSensiveis = false } = {}
) {
  const t = normalizarTexto(termo);
  const escFiltro = String(escopo ?? '').trim().toLowerCase();

  return (respostas || []).filter(r => {
    if (!r) return false;

    if (apenasSensiveis && !r.sensivel) {
      return false;
    }

    if (escFiltro && r.escopo?.tipo !== escFiltro) {
      return false;
    }

    if (t) {
      const variantes = Array.isArray(r.variantes_label) ? r.variantes_label.join(' ') : '';
      const respostaStr = typeof r.resposta === 'object' ? JSON.stringify(r.resposta) : String(r.resposta ?? '');
      const escopoValor = String(r.escopo?.valor ?? '');
      const id = String(r.id ?? '');

      const buscaCompleta = normalizarTexto(`${id} ${variantes} ${respostaStr} ${escopoValor}`);
      if (!buscaCompleta.includes(t)) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => {
    const labelA = normalizarTexto(a.variantes_label?.[0] || a.id);
    const labelB = normalizarTexto(b.variantes_label?.[0] || b.id);
    return labelA.localeCompare(labelB);
  });
}

/**
 * 4. Agrega e formata a cobertura de fontes e portais da rodada.
 *
 * @param {Object} [params={}]
 * @param {Array<Object>} [params.vagas=[]] - Vagas encontradas na rodada
 * @param {Array<Object>} [params.coverage=[]] - Entradas configuradas do radar
 * @param {string} [params.atualizado=''] - Carimbo de data da última varredura
 * @param {number} [params.fila=0] - Quantidade de itens na fila de leitura
 * @returns {Object} Dados estruturados para exibição no modal
 */
export function formatarCoberturaFontes({
  vagas = [],
  coverage = [],
  atualizado = '',
  fila = 0,
} = {}) {
  const contagemPorPortal = new Map();
  const recenciaPorPortal = new Map();

  for (const v of (vagas || [])) {
    const p = v?.portal_candidatura || (v?.url ? extrairNomePortal(v.url) : 'outro') || 'outro';
    contagemPorPortal.set(p, (contagemPorPortal.get(p) || 0) + 1);

    const dataVaga = v?.consultado_em || v?.data_publicacao || atualizado;
    if (dataVaga) {
      const atual = recenciaPorPortal.get(p) || '';
      if (dataVaga > atual) recenciaPorPortal.set(p, dataVaga);
    }
  }

  const portais = Array.from(contagemPorPortal.entries()).map(([portal, total]) => ({
    portal,
    total,
    recencia: recenciaPorPortal.get(portal) || atualizado || 'Hoje',
    status: 'Ativo na rodada',
  })).sort((a, b) => b.total - a.total);

  const fontesConfiguradas = (coverage || []).map(c => ({
    fonte: c?.fonte || 'Desconhecida',
    consulta: c?.consulta || '—',
    resultados: c?.resultados ?? '—',
    status: c?.status || c?.limite || 'Monitoramento regular',
  }));

  return {
    resumo: {
      atualizado: atualizado || 'Não informado',
      totalVagas: (vagas || []).length,
      filaLeitura: fila || 0,
    },
    portais,
    fontesConfiguradas,
  };
}

function extrairNomePortal(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    if (host.includes('gupy.io')) return 'gupy';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('linkedin.com')) return 'linkedin';
    return host.replace(/^www\./, '');
  } catch {
    return 'outro';
  }
}
