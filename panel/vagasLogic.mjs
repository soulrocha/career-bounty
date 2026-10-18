// panel/vagasLogic.mjs
// Lógica pura de filtragem, agrupamento, atalhos e formatação para a aba Vagas (F10.1).

export const ORDEM_ADERENCIA = ['alta', 'boa', 'condicional', 'baixa', 'incompativel'];

export const LABELS_ADERENCIA = {
  alta: 'Alta aderência',
  boa: 'Boa aderência',
  condicional: 'Condicional',
  baixa: 'Baixa aderência',
  incompativel: 'Incompatível',
};

export const DESC_ADERENCIA = {
  alta: 'Atende os obrigatórios e as suas condições',
  boa: 'Quase tudo; uma lacuna contornável',
  condicional: 'Perfil serve; local, modalidade ou salário não',
  baixa: 'Pouca relação com o que você procura',
  incompativel: 'Esbarra numa condição obrigatória',
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function filtrarVagas(vagas = [], filtros = {}, marcas = new Map()) {
  const b = norm(filtros.busca);
  const aderSet = filtros.ader ? (filtros.ader instanceof Set ? filtros.ader : new Set(filtros.ader)) : null;

  return vagas.filter(v => {
    const aplicada = marcas.get(v.id)?.aplicada ?? Boolean(v.candidatura_usuario?.aplicada);
    const descartada = marcas.get(v.id)?.descartada ?? Boolean(v.descarte_usuario?.descartada);

    if (aderSet && !aderSet.has(v.aderencia)) return false;
    if (filtros.modo && !norm(v.modalidade).startsWith(norm(filtros.modo))) return false;
    if (filtros.regime) {
      if (filtros.regime === 'pendente') {
        if (['CLT', 'PJ'].includes(v.regime)) return false;
      } else if (v.regime !== filtros.regime) {
        return false;
      }
    }
    if (filtros.portal && v.portal_candidatura !== filtros.portal) return false;
    if (filtros.cand) {
      if ((filtros.cand === 'sim') !== aplicada) return false;
    }
    if (filtros.desc && filtros.desc !== 'todas') {
      if ((filtros.desc === 'sim') !== descartada) return false;
    }
    if (b) {
      const textoVaga = norm([
        v.empresa,
        v.cargo,
        v.descricao,
        ...(v.motivos || []),
        ...(v.lacunas || []),
      ].join(' '));
      if (!textoVaga.includes(b)) return false;
    }
    return true;
  }).sort((x, y) => {
    const ox = ORDEM_ADERENCIA.indexOf(x.aderencia);
    const oy = ORDEM_ADERENCIA.indexOf(y.aderencia);
    if (ox !== oy) return ox - oy;
    return (y.consultado_em || '').localeCompare(x.consultado_em || '');
  });
}

export function agruparPorRamais(vagas = []) {
  const grupos = {
    alta: [],
    boa: [],
    condicional: [],
    baixa: [],
    incompativel: [],
  };
  for (const v of vagas) {
    if (grupos[v.aderencia]) {
      grupos[v.aderencia].push(v);
    }
  }
  return grupos;
}

export function proximoId(listaIds = [], idAtual, direcao = 1) {
  if (!listaIds.length) return null;
  const idx = listaIds.indexOf(idAtual);
  if (idx === -1) return listaIds[0];
  const proximo = idx + direcao;
  if (proximo < 0) return listaIds[0];
  if (proximo >= listaIds.length) return listaIds[listaIds.length - 1];
  return listaIds[proximo];
}

export function deveIgnorarAtalho({ targetTag = '', isContentEditable = false, ctrlKey = false, altKey = false, metaKey = false } = {}) {
  if (ctrlKey || altKey || metaKey) return true;
  if (isContentEditable) return true;
  const tag = String(targetTag ?? '').toUpperCase();
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return true;
  return false;
}

export function formatarSalario(salario) {
  if (salario === null || salario === undefined || salario === '') return 'Não divulgado';
  if (typeof salario === 'number') {
    return `R$ ${salario.toLocaleString('pt-BR')}`;
  }
  return String(salario);
}

export function formatarNotaEmpresa(avaliacao) {
  if (!avaliacao || typeof avaliacao !== 'object') return null;
  const nota = Number(avaliacao.nota);
  if (!Number.isFinite(nota) || nota <= 0) return null;
  const qtd = Number(avaliacao.quantidade) || 0;
  return {
    nota,
    notaFormatada: nota.toFixed(1).replace('.', ','),
    plataforma: avaliacao.plataforma || 'Glassdoor',
    quantidade: qtd,
    quantidadeFormatada: qtd.toLocaleString('pt-BR'),
  };
}
