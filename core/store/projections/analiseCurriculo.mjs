// core/store/projections/analiseCurriculo.mjs
// Projeção pura e determinística da Análise de Currículo contra a Base (F9.5).

export function projectAnaliseCurriculo({ quadrantes = {}, evidencias = [], eventos = [], now = new Date() }) {
  // 1. Processar histórico de eventos de análise ordenados cronologicamente
  const marcacoes = new Map();
  const inclusoes = new Map();
  const entrevistas = new Map();

  const eventosOrdenados = [...(eventos ?? [])].filter(e => e?.tipo?.startsWith('analise.')).sort((a, b) => {
    const tsA = Date.parse(a.ts || 0);
    const tsB = Date.parse(b.ts || 0);
    return tsA - tsB || (a.seq ?? 0) - (b.seq ?? 0);
  });

  for (const evento of eventosOrdenados) {
    const d = evento.dados;
    if (!d) continue;

    if (evento.tipo === 'analise.item_marcado') {
      marcacoes.set(d.item_id, { status: d.como, motivo: d.motivo ?? null, data: d.data, ts: evento.ts });
    } else if (evento.tipo === 'analise.afirmacao_incluida') {
      inclusoes.set(d.afirmacao_id, { experiencia_id: d.experiencia_id ?? null, data: d.data, ts: evento.ts });
    } else if (evento.tipo === 'analise.lacuna_entrevista') {
      entrevistas.set(d.item_id, { pergunta: d.pergunta, data: d.data, arquivo_rascunho: d.arquivo_rascunho ?? null, ts: evento.ts });
    }
  }

  function obterMarcacao(id) {
    if (marcacoes.has(id)) return marcacoes.get(id);
    if (id.startsWith('lacuna:')) {
      const semPrefixo = id.slice(7);
      if (marcacoes.has(semPrefixo)) return marcacoes.get(semPrefixo);
    } else {
      const comPrefixo = `lacuna:${id}`;
      if (marcacoes.has(comPrefixo)) return marcacoes.get(comPrefixo);
    }
    return null;
  }

  function obterEntrevista(id) {
    if (entrevistas.has(id)) return entrevistas.get(id);
    if (id.startsWith('lacuna:')) {
      const semPrefixo = id.slice(7);
      if (entrevistas.has(semPrefixo)) return entrevistas.get(semPrefixo);
    } else {
      const comPrefixo = `lacuna:${id}`;
      if (entrevistas.has(comPrefixo)) return entrevistas.get(comPrefixo);
    }
    return null;
  }

  // 2. Mapa inverso de evidências por afirmação
  const evidenciasPorAfirmacao = new Map();
  for (const ev of evidencias ?? []) {
    for (const afId of ev.afirmacoes ?? []) {
      if (!evidenciasPorAfirmacao.has(afId)) evidenciasPorAfirmacao.set(afId, new Set());
      evidenciasPorAfirmacao.get(afId).add(ev.id);
    }
  }

  // 3. Mapear grupo `confere` (antigo quadrante a)
  const contagemClaimsA = new Map();
  for (const item of quadrantes.a ?? []) {
    for (const cid of item.claim_ids ?? []) {
      contagemClaimsA.set(cid, (contagemClaimsA.get(cid) ?? 0) + 1);
    }
  }

  const itensConfere = (quadrantes.a ?? []).map(item => {
    const claims = item.claim_ids ?? (item.afirmacoes ? item.afirmacoes.map(a => a.id ?? a) : []);
    const id = (claims.length === 1 && contagemClaimsA.get(claims[0]) === 1)
      ? `confere:claim:${claims[0]}`
      : `confere:${item.modelo || 'cv'}:linha:${item.linha ?? 0}`;

    const evSet = new Set();
    for (const afId of claims) {
      for (const evId of evidenciasPorAfirmacao.get(afId) ?? []) {
        evSet.add(evId);
      }
    }
    const evList = Array.from(evSet).sort();

    // Determinar nivel_prova
    let nivel = 'verificado';
    if (item.afirmacoes && Array.isArray(item.afirmacoes) && item.afirmacoes.length) {
      if (item.afirmacoes.some(a => (a.nivel_prova || a) === 'entregue')) nivel = 'entregue';
    }

    const marcacao = obterMarcacao(id);
    const status = marcacao?.status ?? 'ativo';

    return {
      id,
      grupo: 'confere',
      tipo_origem: 'cv_bullet',
      texto: item.texto,
      afirmacoes: claims,
      evidencias: evList,
      nivel_prova: nivel,
      motivo: item.motivo || 'Fato e números conferem com afirmações comprovadas da base.',
      pergunta: null,
      peso: nivel === 'verificado' ? 2 : 1,
      status,
    };
  });

  // 4. Mapear grupo `sem_prova` (antigo quadrante c)
  const itensSemProva = (quadrantes.c ?? []).map(item => {
    const id = `sem_prova:${item.modelo || 'cv'}:linha:${item.linha ?? 0}`;
    const claims = item.claim_ids ?? [];

    const evSet = new Set();
    for (const afId of claims) {
      for (const evId of evidenciasPorAfirmacao.get(afId) ?? []) {
        evSet.add(evId);
      }
    }
    const evList = Array.from(evSet).sort();

    let nivel = 'nenhum';
    if (item.afirmacoes && Array.isArray(item.afirmacoes) && item.afirmacoes.length) {
      nivel = item.afirmacoes[0].nivel_prova ?? 'relato';
    } else if (claims.length) {
      nivel = 'relato';
    }

    let peso = 3;
    if (item.codigo === 'numero_orfao' || item.codigo === 'numero_divergente') {
      peso = 5;
    } else if (item.codigo === 'afirmacao_sem_prova') {
      peso = 4;
    } else if (item.codigo === 'sem_marca' || item.sem_marca) {
      peso = 3;
    }

    const marcacao = obterMarcacao(id);
    const status = marcacao?.status ?? 'ativo';

    return {
      id,
      grupo: 'sem_prova',
      tipo_origem: 'cv_bullet',
      texto: item.texto,
      afirmacoes: claims,
      evidencias: evList,
      nivel_prova: nivel,
      motivo: item.motivo || 'Item de currículo sem prova correspondente na base.',
      pergunta: item.pergunta ?? `Qual registro ou documento comprova a informação: "${item.texto}"?`,
      peso,
      status,
    };
  });

  // 5. Mapear grupo `fora_do_cv` (antigo quadrante b)
  const itensForaDoCv = (quadrantes.b ?? []).map(item => {
    const ehAfirmacao = item.tipo === 'afirmacao';
    const id = ehAfirmacao ? `fora_do_cv:af:${item.id}` : `fora_do_cv:arco:${item.id}`;
    const claims = ehAfirmacao ? [item.id] : [];
    const evList = ehAfirmacao ? Array.from(evidenciasPorAfirmacao.get(item.id) ?? []).sort() : [];
    const nivel = ehAfirmacao ? (item.nivel_prova || 'entregue') : 'nenhum';

    let peso = 1;
    if (ehAfirmacao) {
      peso = nivel === 'verificado' ? 3 : 2;
    }

    const marcacao = obterMarcacao(id);
    const status = marcacao?.status ?? 'ativo';

    const resultado = {
      id,
      grupo: 'fora_do_cv',
      tipo_origem: ehAfirmacao ? 'afirmacao' : 'arco',
      texto: ehAfirmacao ? item.texto : (item.titulo ? `${item.id}: ${item.titulo}` : (item.texto || item.id)),
      afirmacoes: claims,
      evidencias: evList,
      nivel_prova: nivel,
      motivo: item.motivo || (ehAfirmacao ? 'Afirmação com prova liberada para CV que nenhum bullet cita' : 'Arco ou história sem afirmação ligada'),
      pergunta: item.pergunta ?? (ehAfirmacao ? 'Em qual experiência do currículo esta afirmação comprovada pode ser incluída?' : 'Quais afirmações da base sustentam este arco de história?'),
      peso,
      status,
    };

    if (ehAfirmacao && inclusoes.has(item.id)) {
      const inc = inclusoes.get(item.id);
      resultado.inclusao = {
        incluida: true,
        experiencia_id: inc.experiencia_id ?? null,
        data: inc.data,
      };
    }

    return resultado;
  });

  // 6. Mapear grupo `lacuna` (antigo quadrante d)
  const mapaTipoLacuna = {
    sem_fonte: 'lacuna_fonte',
    sem_linha_base: 'lacuna_linha_base',
    buraco_timeline: 'lacuna_timeline',
    requisito_frequente: 'lacuna_vagas',
  };

  const itensLacuna = (quadrantes.d ?? []).map(item => {
    const id = item.id?.startsWith('lacuna:') ? item.id : `lacuna:${item.id}`;
    const claims = (item.origem === 'afirmacao' && item.alvo) ? [item.alvo] : [];

    const marcacao = obterMarcacao(id);
    const status = marcacao?.status ?? 'ativo';

    const resultado = {
      id,
      grupo: 'lacuna',
      tipo_origem: mapaTipoLacuna[item.tipo] ?? (item.origem || 'lacuna'),
      texto: item.descricao,
      afirmacoes: claims,
      evidencias: [],
      nivel_prova: item.nivel_prova ?? 'nenhum',
      motivo: item.descricao,
      pergunta: item.pergunta_sugerida ?? null,
      peso: Number.isInteger(item.peso) ? item.peso : Math.round(Number(item.peso ?? 1)),
      status,
    };

    const ent = obterEntrevista(id);
    if (ent) {
      resultado.entrevista = {
        pergunta: ent.pergunta,
        data: ent.data,
        arquivo_rascunho: ent.arquivo_rascunho ?? null,
      };
    }

    return resultado;
  });

  // 7. Agrupamento e contadores
  const todosItens = [
    ...itensConfere,
    ...itensSemProva,
    ...itensForaDoCv,
    ...itensLacuna,
  ];

  return {
    grupos: {
      confere: itensConfere,
      sem_prova: itensSemProva,
      fora_do_cv: itensForaDoCv,
      lacuna: itensLacuna,
    },
    contadores: {
      total: todosItens.length,
      confere: itensConfere.length,
      sem_prova: itensSemProva.length,
      fora_do_cv: itensForaDoCv.length,
      lacuna: itensLacuna.length,
      ativos: todosItens.filter(i => i.status === 'ativo').length,
      revisar: todosItens.filter(i => i.status === 'revisar').length,
      ignorados: todosItens.filter(i => i.status === 'ignorado').length,
    },
    avisos: quadrantes.avisos ?? [],
  };
}
