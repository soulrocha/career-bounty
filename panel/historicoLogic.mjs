// panel/historicoLogic.mjs
// Lógica pura de formatação, filtragem e ícones para a aba Histórico (F10.2).

export const TIPOS_EVENTO = ['descoberta', 'candidatura', 'etapa', 'contato', 'desfecho', 'descarte'];

export const ROTULOS_TIPO = {
  descoberta: 'Descoberta',
  candidatura: 'Candidatura',
  etapa: 'Etapa',
  contato: 'Contato',
  desfecho: 'Desfecho',
  descarte: 'Descarte',
};

export const ROTULOS_ORIGEM = {
  radar: 'Radar',
  painel: 'Painel',
  email: 'E-mail',
  cli: 'CLI',
  recrutador: 'Recrutador',
  candidato: 'Você',
};

export const ROTULOS_SITUACAO = {
  ativo: 'Ativo',
  aguardando_retorno: 'Aguardando retorno',
  aguardando_voce: 'Aguardando você',
  encerrado: 'Encerrado',
};

export const CORES_TIPO = {
  descoberta: 'var(--l-condicional)', // azul-claro
  candidatura: 'var(--ouro)',          // ouro/âmbar
  etapa: 'var(--l-boa)',              // roxo/índigo
  contato: '#008F85',                 // ciano/teal
  aprovado: 'var(--ok)',              // verde
  encerrado: 'var(--tx3)',            // cinza neutro
  descarte: 'var(--perigo)',          // vermelho suave
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Formata data no padrão brasileiro DD/MM/AAAA.
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
 * Determina o identificador de cor/classe do evento.
 */
export function obterClasseCorEvento(tipo, desfecho = null) {
  if (tipo === 'desfecho') {
    return desfecho === 'aprovado' ? 'desfecho-aprovado' : 'desfecho-encerrado';
  }
  return tipo;
}

/**
 * Retorna o SVG embutido limpo para cada tipo de evento (zero <img>).
 */
export function obterIconeSvg(tipo, { desfecho = null } = {}) {
  switch (tipo) {
    case 'descoberta':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    case 'candidatura':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    case 'etapa':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/></svg>';
    case 'contato':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    case 'desfecho':
      if (desfecho === 'aprovado') {
        return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M12 2v2M12 14v8M8 22h8"/></svg>';
      }
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>';
    case 'descarte':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/></svg>';
    default:
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
  }
}

/**
 * Filtra puramente o histórico em memória.
 */
export function filtrarHistorico(historico = [], filtros = {}) {
  const lista = Array.isArray(historico) ? historico : [];
  const b = norm(filtros.busca);
  const portalNorm = filtros.portal ? norm(filtros.portal) : null;

  return lista.filter(v => {
    if (filtros.inicio && (v.ultimo_movimento || '') < filtros.inicio) return false;
    if (filtros.fim && (v.ultimo_movimento || '') > filtros.fim) return false;
    if (filtros.situacao && v.situacao_processo !== filtros.situacao) return false;
    if (portalNorm && norm(v.portal) !== portalNorm) return false;

    if (b) {
      const eventos = v.linha_do_tempo || v.itens || [];
      const textoVaga = norm([
        v.empresa,
        v.cargo,
        v.portal,
        v.situacao_processo,
        v.desfecho,
        ...eventos.flatMap(it => [it.titulo, it.detalhe, it.resumo, it.motivo, it.origem]),
      ].join(' '));
      if (!textoVaga.includes(b)) return false;
    }
    return true;
  }).sort((a, b) => (b.ultimo_movimento || '').localeCompare(a.ultimo_movimento || '') || (b.vaga_id || '').localeCompare(a.vaga_id || ''));
}

/**
 * Extrai lista única e ordenada de portais presentes no histórico.
 */
export function extrairPortaisHistorico(historico = []) {
  if (!Array.isArray(historico)) return [];
  const portais = new Set();
  for (const v of historico) {
    if (v && v.portal && typeof v.portal === 'string' && v.portal.trim()) {
      portais.add(v.portal.trim().toLowerCase());
    }
  }
  return [...portais].sort();
}

/**
 * Recalcula totais agregados a partir de uma lista filtrada.
 */
export function calcularTotaisHistorico(historico = []) {
  const lista = Array.isArray(historico) ? historico : [];
  return {
    total: lista.length,
    ativos: lista.filter(v => v.situacao_processo === 'ativo').length,
    aguardando_retorno: lista.filter(v => v.situacao_processo === 'aguardando_retorno').length,
    aguardando_voce: lista.filter(v => v.situacao_processo === 'aguardando_voce').length,
    encerrados: lista.filter(v => v.situacao_processo === 'encerrado').length,
  };
}
