// PROTÓTIPO descartável — painel CareerBounty, mundo "Linha".
// Pergunta: qual organização de tela o painel deve seguir? Um só mundo visual (tipografia, paleta, densidade e o
// diagrama de linha) em três organizações: A Plataforma (lista e detalhe), B Painel lateral (tabela), C Triagem (uma por vez).
// Troca por ?variante=A|B|C, ?tema=claro|escuro e ?aba=. Estado só em memória: nada é gravado e nenhuma rota real é chamada.
(function () {
  const D = window.DADOS;
  const VARIANTES = { A: 'Plataforma', B: 'Painel lateral', C: 'Triagem' };
  const ORDEM = ['alta', 'boa', 'condicional', 'baixa', 'incompativel'];
  const ADER = { alta: 'Alta aderência', boa: 'Boa aderência', condicional: 'Condicional', baixa: 'Baixa aderência', incompativel: 'Incompatível' };
  const CURTO = { alta: 'Alta', boa: 'Boa', condicional: 'Condicional', baixa: 'Baixa', incompativel: 'Incompatível' };
  const DESC = {
    alta: 'Atende os obrigatórios e as suas condições',
    boa: 'Quase tudo; uma lacuna contornável',
    condicional: 'Perfil serve; local, modalidade ou salário não',
    baixa: 'Pouca relação com o que você procura',
    incompativel: 'Esbarra numa condição obrigatória',
  };
  const PORTAL = { gupy: 'Gupy', solides: 'Sólides', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', inhire: 'InHire' };
  const ETAPAS = ['Candidatura', 'Contato', 'Entrevista', 'Devolutiva'];
  const ETAPA_I = { aguardando: 0, em_conversa: 1, entrevista: 2, devolutiva: 3 };
  const ETAPA = { aguardando: 'Aguardando retorno', em_conversa: 'Em conversa', entrevista: 'Entrevista marcada', devolutiva: 'Devolutiva recebida', encerrado: 'Encerrado' };
  const CANAL = { email: ['mail', 'E-mail'], whatsapp: ['msg', 'WhatsApp'], linkedin: ['in', 'LinkedIn'], portal: ['doc', 'Portal'] };

  // Ícones: traço único de 1,75, desenhados no estilo Lucide (ISC).
  const P = {
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    estrela: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
    abrir: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
    perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 7 9 6 9-6"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    in: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    lua: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    mais: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    ok: '<path d="M20 6 9 17l-5-5"/>',
    seta: '<path d="m9 18 6-6-6-6"/>',
    volta: '<path d="m15 18-6-6 6-6"/>',
    alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    cadeado: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    copiar: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
    arquivo: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    ordem: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    mais1: '<path d="M12 5v14M5 12h14"/>',
  };
  const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const logo = '<img class="logo" src="icone.svg" width="30" height="30" alt="">';

  const CORUJA = ['..o......o..', '.obo....obo.', '.obbbbbbbbo.', 'obeeebbeeebo', 'obepebbepebo', 'obeeekkeeebo', 'obbbbkkbbbbo', 'obwwwwwwwwbo', 'obwbwwwwbwbo', 'obwwwwwwwwbo', '.obbwwwwbbo.', '...kk..kk...'];
  const COR_CORUJA = { o: '#2A2140', b: '#7C6BC4', w: '#E9DFC9', e: '#FFFFFF', p: '#1B1530', k: '#E6B450' };
  function coruja() {
    const px = (lin, filtro) => lin.flatMap((l, y) => [...l].map((c, x) => filtro(c) ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${COR_CORUJA[c]}"/>` : '')).join('');
    const fechado = '<rect x="2" y="4" width="3" height="1" fill="#1B1530"/><rect x="7" y="4" width="3" height="1" fill="#1B1530"/><rect x="2" y="3" width="3" height="1" fill="#7C6BC4"/><rect x="7" y="3" width="3" height="1" fill="#7C6BC4"/><rect x="2" y="5" width="3" height="1" fill="#7C6BC4"/><rect x="7" y="5" width="3" height="1" fill="#7C6BC4"/>';
    return `<svg viewBox="0 0 12 12" aria-hidden="true">${px(CORUJA, c => c !== '.' && c !== 'e' && c !== 'p')}<g class="olho-a">${px(CORUJA, c => c === 'e' || c === 'p')}</g><g class="olho-f">${fechado}</g></svg>`;
  }
  function recado() {
    if (S.aba === 'processos') { const l = lembretes()[0]; return l ? `<b>${l.p.empresa}</b> está há <b>${l.d} dias</b> sem resposta. Vale escrever hoje.` : 'Nenhum processo parado. Bom ritmo.'; }
    if (S.aba === 'curriculo') { const n = D.analise.sem_prova.filter(i => !S.ignorados.has(i.id)).length; return n ? `<b>${n}</b> frases do CV ainda sem prova. Comece pela de cima.` : 'Todas as frases do CV têm prova.'; }
    if (S.aba === 'historico') return `<b>${D.historico.length}</b> candidaturas registradas desde agosto.`;
    const altas = D.vagas.filter(v => v.aderencia === 'alta' && !descartada(v) && !aplicada(v));
    return altas.length ? `<b>${altas.length}</b> vagas de alta aderência esperando você. A mais recente: ${altas[0].empresa}.` : 'Nenhuma vaga nova de alta aderência hoje.';
  }
  const pet = () => S.mundo !== 'linha' ? `<button class="pet" data-acao="balao" aria-label="Recado da coruja" aria-expanded="${S.balao}">${coruja()}${S.balao ? `<span class="balao" role="status">${recado()}</span>` : '<span class="pip"></span>'}</button>` : '';
  const params = new URLSearchParams(location.search);
  const S = {
    variante: VARIANTES[params.get('variante')] ? params.get('variante') : 'A',
    mundo: ['misto', 'guilda', 'linha'].includes(params.get('mundo')) ? params.get('mundo') : 'misto', balao: false,
    tema: ['claro', 'escuro'].includes(params.get('tema')) ? params.get('tema') : (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'),
    aba: params.get('aba') || 'vagas',
    ader: new Set(['alta', 'boa', 'condicional', 'baixa']),
    modo: '', regime: '', portal: '', cand: '', desc: 'nao', busca: '',
    sel: null, abreDet: false, bDet: false, ord: ['aderencia', 1],
    proc: null, funil: '', quad: 'semprova', chegou: null, hist: 'todas',
    menu: false, fundoParado: false, aviso: '', ignorados: new Set(),
  };
  const marcas = new Map();

  // ---------- utilidades ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const dia = s => { const [, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}`; };
  const dias = (de, ate = D.hoje) => Math.round((Date.parse(ate) - Date.parse(String(de).slice(0, 10))) / 864e5);
  const virgula = n => n.toFixed(1).replace('.', ',');
  const bola = (a, cls = '') => `<span class="bola ${cls}" data-a="${a}" aria-hidden="true"></span>`;
  const plaqueta = a => `<span class="plaqueta" data-a="${a}">${ADER[a]}</span>`;
  const nota = av => av ? `<span class="nota" title="${esc(av.plataforma)}, ${av.quantidade.toLocaleString('pt-BR')} avaliações">${ic('estrela')}${virgula(av.nota)}<span class="fonte-nota">${esc(av.plataforma)}</span><span class="sr"> (nota da empresa, de 5)</span></span>` : '<span class="nota sem" title="Sem nota da empresa no Glassdoor">' + ic('estrela') + 'sem nota no Glassdoor</span>';
  const salario = v => v.salario ? esc(v.salario) : '<span class="meta">Não divulgado</span>';
  const salCurto = v => { if (!v.salario) return '<span class="meta">—</span>'; const m = String(v.salario).match(/^(R$|US$)/)?.[1] || ''; const n = [...String(v.salario).matchAll(/d[d.]*/g)].map(x => Math.round(+x[0].replace(/./g, '') / 1000)); return esc(`${m} ${n.join(' a ')} mil`); };
  const aplicada = v => marcas.get(v.id)?.aplicada ?? Boolean(v.candidatura_usuario?.aplicada);
  const dataCand = v => marcas.get(v.id)?.data ?? v.candidatura_usuario?.data ?? '';
  const descartada = v => marcas.get(v.id)?.descartada ?? Boolean(v.descarte_usuario?.descartada);
  const marcar = (v, campo, valor) => marcas.set(v.id, { aplicada: aplicada(v), data: dataCand(v), descartada: descartada(v), [campo]: valor });
  const sel = (campo, rotulo, opcoes) => `<select class="campo" data-campo="${campo}" aria-label="${rotulo}">${opcoes.map(([v, t]) => `<option value="${v}" ${S[campo] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;

  // ---------- dados derivados ----------
  function filtradas({ semAder = false } = {}) {
    const b = norm(S.busca);
    return D.vagas.filter(v => (semAder || S.ader.has(v.aderencia))
      && (!S.modo || norm(v.modalidade).startsWith(S.modo))
      && (!S.regime || (S.regime === 'pendente' ? !['CLT', 'PJ'].includes(v.regime) : v.regime === S.regime))
      && (!S.portal || v.portal_candidatura === S.portal)
      && (!S.cand || (S.cand === 'sim') === aplicada(v))
      && (S.desc === 'todas' || (S.desc === 'sim') === descartada(v))
      && (!b || norm([v.empresa, v.cargo, v.descricao, ...(v.motivos || []), ...(v.lacunas || [])].join(' ')).includes(b)))
      .sort((x, y) => ORDEM.indexOf(x.aderencia) - ORDEM.indexOf(y.aderencia) || y.consultado_em.localeCompare(x.consultado_em));
  }
  const contagem = () => { const base = filtradas({ semAder: true }); return Object.fromEntries(ORDEM.map(a => [a, base.filter(v => v.aderencia === a).length])); };
  const lembretes = () => D.processos.filter(p => ['aguardando', 'em_conversa'].includes(p.etapa) && !(p.proxima_etapa && /\d/.test(p.proxima_etapa.data)))
    .map(p => ({ p, d: dias(p.ultima_interacao) })).filter(x => x.d >= 5).sort((a, b) => b.d - a.d);
  const contatosDe = id => D.contatos.filter(c => c.vaga_id === id);
  const vagaDe = id => D.vagas.find(v => v.id === id) || {};
  const contadores = () => ({
    vagas: D.vagas.filter(v => ['alta', 'boa'].includes(v.aderencia) && !descartada(v) && !aplicada(v)).length,
    processos: lembretes().length,
    curriculo: D.analise.sem_prova.filter(i => !S.ignorados.has(i.id)).length + D.analise.lacunas.filter(i => !S.ignorados.has(i.id)).length,
    historico: D.historico.length,
  });
  const ABAS = [['vagas', 'Vagas'], ['processos', 'Processos'], ['curriculo', 'Currículo e provas'], ['historico', 'Histórico']];

  // ---------- casca ----------
  function menuMais(acima) {
    return `<div class="menu"><button class="btn-ic" data-acao="menu" aria-expanded="${S.menu}" aria-label="Mais opções">${ic('mais')}</button>${S.menu ? `<div class="lista" role="menu">
      <button role="menuitem" data-acao="aba" data-v="respostas">Respostas de formulário<small>${D.respostas.length} perguntas esperando você</small></button>
      <button role="menuitem" data-acao="aba" data-v="fontes">Fontes e cobertura<small>De onde vieram as vagas de hoje</small></button>
      <button role="menuitem" data-acao="aba" data-v="linkedin">Perfil do LinkedIn<small>Sugestões, fora das abas principais</small></button>
      <button role="menuitem" data-acao="fundo">${S.fundoParado ? 'Animar o fundo' : 'Parar a animação do fundo'}<small>Ele já fica parado se o sistema pedir menos movimento</small></button></div>` : ''}</div>`;
  }
  const botaoTema = () => `<button class="btn-ic" data-acao="tema" aria-label="Usar tema ${S.tema === 'claro' ? 'escuro' : 'claro'}" title="Usar tema ${S.tema === 'claro' ? 'escuro' : 'claro'}">${ic(S.tema === 'claro' ? 'lua' : 'sol')}</button>`;
  function placa() {
    const n = contadores();
    return `<header class="placa"><div class="marca">${logo}<span class="nome">CareerBounty</span></div>
      <nav class="nav" aria-label="Seções">${ABAS.map(([id, t]) => `<button data-acao="aba" data-v="${id}" ${S.aba === id ? 'aria-current="page"' : ''}>${t}${n[id] ? `<span class="cont ${id === 'processos' ? 'atencao' : ''}">${n[id]}</span>` : ''}</button>`).join('')}</nav>
      <div class="placa-dir">${pet()}<span class="estado" ${S.mundo !== 'linha' && S.balao ? 'hidden' : ''}>Radar das ${esc(D.radar.atualizado.slice(11))} · ${D.radar.na_fila} anúncios na fila de leitura</span>${botaoTema()}${menuMais()}</div></header>`;
  }
  function ferramentas({ semAder = false, total = true } = {}) {
    const n = contagem(), portais = [...new Set(D.vagas.map(v => v.portal_candidatura))].sort();
    return `${semAder ? '' : `<div class="chips" role="group" aria-label="Aderência">${ORDEM.map(a => `<button class="chip" aria-pressed="${S.ader.has(a)}" data-acao="ader" data-v="${a}">${bola(a)}${CURTO[a]}<span class="n">${n[a]}</span></button>`).join('')}</div>`}
      <label class="busca">${ic('busca')}<span class="sr">Buscar vagas</span><input class="campo" id="busca" data-campo="busca" value="${esc(S.busca)}" placeholder="Empresa, cargo ou tecnologia"></label>
      ${sel('modo', 'Modalidade', [['', 'Toda modalidade'], ['remoto', 'Remoto'], ['hibrido', 'Híbrido'], ['presencial', 'Presencial']])}
      ${sel('regime', 'Regime', [['', 'Todo regime'], ['CLT', 'CLT'], ['PJ', 'PJ'], ['pendente', 'Não informado']])}
      ${sel('portal', 'Portal', [['', 'Todo portal'], ...portais.map(p => [p, PORTAL[p] || p])])}
      ${sel('cand', 'Candidatura', [['', 'Com e sem candidatura'], ['nao', 'Ainda não me candidatei'], ['sim', 'Já me candidatei']])}
      ${sel('desc', 'Descartadas', [['nao', 'Sem descartadas'], ['sim', 'Só descartadas'], ['todas', 'Com descartadas']])}
      <button class="btn discreto peq" data-acao="limpar">Limpar filtros</button>${total ? `<span class="total">${filtradas({ semAder }).length} vagas</span>` : ''}`;
  }
  const semResultado = () => `<div class="vazio"><strong>Nenhuma vaga com esses filtros.</strong>Tire um filtro ou <button class="btn discreto peq" data-acao="limpar">limpe todos</button>.</div>`;

  // ---------- detalhe da vaga ----------
  function blocoCvs(v) {
    if (v.portal_candidatura === 'gupy') {
      return `<div class="gupy">${ic('perfil')}<div><strong>A Gupy usa o perfil do site, não PDF.</strong><p class="meta" style="margin:2px 0 10px">${esc(v.perfil_gupy?.resumo || 'Proposta de perfil ainda não gerada.')}</p>
        <button class="btn peq" data-acao="aviso" data-v="No painel real abre a proposta de perfil Gupy desta vaga.">Ver proposta de perfil (${v.perfil_gupy?.campos ?? 0} campos)</button></div></div>`;
    }
    const c = v.cvs;
    if (c?.bloqueio && !c.atual) return `<div class="alerta perigo">${ic('cadeado')}<div><strong>CV bloqueado.</strong> ${esc(c.bloqueio.motivos[0])}<br><button class="btn peq" style="margin-top:8px" data-acao="aba" data-v="curriculo">Resolver em Currículo e provas</button></div></div>`;
    if (!c?.atual) return '<p class="meta">Os CVs desta vaga ainda não foram gerados. Gere pelo comando de currículos; eles aparecem aqui.</p>';
    const doc = (rot, desc) => `<a class="cv" href="#" data-acao="aviso" data-v="No painel real abre o PDF: ${rot}.">${ic('doc')}<div><strong>${rot}</strong><span>${desc}</span><span>Versão ${esc(c.atual.hash)}, aprovada</span></div></a>`;
    return `<div class="cvs">${doc('CV visual', 'Para recrutador e e-mail')}${doc('CV para ATS', 'Texto simples, lido pelos sistemas de triagem')}</div>`;
  }
  function detalhe(v) {
    if (!v) return '<div class="vazio"><strong>Nenhuma vaga escolhida.</strong>Escolha uma estação na lista.</div>';
    const av = v.empresa_avaliacao, cond = v.condicoes && v.condicoes.situacao !== 'ok' ? v.condicoes : null, feita = aplicada(v);
    return `<article class="det" aria-label="${esc(v.cargo)}">
      <div class="det-topo">${plaqueta(v.aderencia)}<strong>${esc(v.empresa)}</strong>${nota(av)}</div>
      <h2>${esc(v.cargo)}</h2>
      ${cond ? `<div class="alerta ${v.aderencia === 'incompativel' ? 'perigo' : ''}">${ic('alerta')}<div><strong>${v.aderencia === 'incompativel' ? 'Não bate com uma condição obrigatória.' : 'Confira as condições.'}</strong> ${esc(cond.motivos.join('; '))}.</div></div>` : ''}
      <dl class="fatos"><div><dt>Modalidade</dt><dd>${esc(v.modalidade)}</dd></div><div><dt>Local</dt><dd>${esc(v.local)}</dd></div><div><dt>Regime</dt><dd>${esc(v.regime || 'Não informado')}</dd></div>
        <div><dt>Salário</dt><dd>${salario(v)}</dd></div><div><dt>Candidatura via</dt><dd>${esc(PORTAL[v.portal_candidatura] || v.portal_candidatura)}</dd></div><div><dt>Vista</dt><dd>${dia(v.consultado_em)}, há ${esc(v.vista_ha)}</dd></div></dl>
      <section><p>${esc(v.descricao)}</p></section>
      ${v.motivos?.length ? `<section><h3>Por que considerar</h3><ul class="marcadores">${v.motivos.map(m => `<li>${ic('ok')}${esc(m)}</li>`).join('')}</ul></section>` : ''}
      ${(v.lacunas?.length || v.pendencias?.length) ? `<section><h3>Lacunas e pendências</h3><ul class="marcadores lacunas">${[...(v.lacunas || []), ...(v.pendencias || [])].map(m => `<li>${ic('alerta')}${esc(m)}</li>`).join('')}</ul></section>` : ''}
      <section><h3>Requisitos</h3><table class="reqs">${v.requisitos.map(r => `<tr><td>${esc(r.requisito)}${r.tipo === 'desejavel' ? ' <span class="meta">desejável</span>' : ''}</td><td class="${r.avaliacao}">${{ atende: 'Atende', parcial: 'Em parte', nao_atende: 'Não atende' }[r.avaliacao]}</td></tr>`).join('')}</table></section>
      <section><h3>Currículos desta vaga</h3>${blocoCvs(v)}</section>
      <section><h3>A empresa no ${esc(av?.plataforma || 'Glassdoor')}</h3>${av ? `<div class="empresa"><div class="grande">${virgula(av.nota)}</div><div><div class="meta">de 5, média de ${av.quantidade.toLocaleString('pt-BR')} avaliações de funcionários no ${esc(av.plataforma)} · coletada em ${dia(av.data)}</div><p style="margin:4px 0 0">${esc(av.resumo)}</p></div></div>` : '<p class="meta">Sem nota da empresa no Glassdoor.</p>'}</section>
      <div class="acoes"><a class="btn prim" href="#" data-acao="aviso" data-v="No painel real abre o anúncio no portal.">Abrir vaga ${ic('abrir')}</a>
        <label><input type="checkbox" data-campo="aplicada" data-id="${v.id}" ${feita ? 'checked' : ''}> Já me candidatei</label>
        ${feita ? `<input type="date" class="campo" data-campo="data" data-id="${v.id}" value="${esc(dataCand(v))}" aria-label="Data da candidatura">` : ''}
        <button class="btn discreto" data-acao="descartar" data-v="${v.id}">${ic('arquivo')}${descartada(v) ? 'Restaurar' : 'Descartar'}</button></div></article>`;
  }

  // Diagrama vertical: um ramal por aderência, cada vaga uma estação.
  function ramais(lista, { compacto = false } = {}) {
    return ORDEM.map(a => {
      const vs = lista.filter(v => v.aderencia === a);
      if (!vs.length) return '';
      return `<section class="ramal" data-a="${a}" aria-label="${ADER[a]}"><header>${plaqueta(a)}<span class="n">${vs.length}</span>${compacto ? '' : `<span class="desc">${DESC[a]}</span>`}</header>
        ${vs.map((v, i) => `<button class="estacao ${i === 0 ? 'ini' : ''} ${i === vs.length - 1 ? 'fim' : ''} ${aplicada(v) ? 'feita' : ''} ${descartada(v) ? 'descartada' : ''}" data-a="${a}" aria-current="${v.id === S.sel}" data-acao="sel" data-v="${v.id}">
          ${bola(a)}<span class="t"><span class="cargo">${esc(v.cargo)}</span><span class="sub">${esc(v.empresa)}${compacto ? '' : ` · ${esc(v.modalidade)} · ${esc(PORTAL[v.portal_candidatura])}`}</span></span>
          ${compacto ? '' : `<span class="lado">${nota(v.empresa_avaliacao)}<span>${aplicada(v) ? `<span class="selo">${ic('ok')}candidatada</span>` : `há ${esc(v.vista_ha)}`}</span></span>`}</button>`).join('')}</section>`;
    }).join('');
  }

  // ---------- A — Plataforma ----------
  function varA() {
    const lista = filtradas();
    if (!lista.some(v => v.id === S.sel)) S.sel = lista[0]?.id ?? null;
    return `${placa()}<main class="A-tela"><div class="ferramentas">${ferramentas()}</div><div class="A-mesa ${S.abreDet ? 'abre-det' : ''}">
      <div class="A-lista" id="a-lista">${ramais(lista) || semResultado()}</div>
      <div class="A-det" id="a-det"><button class="btn peq A-voltar" data-acao="voltar">${ic('volta')}Voltar à lista</button>${detalhe(vagaDe(S.sel).id ? vagaDe(S.sel) : null)}</div></div></main>`;
  }

  // ---------- B — Painel lateral ----------
  const ORDENS = { aderencia: v => ORDEM.indexOf(v.aderencia), vaga: v => norm(v.cargo), nota: v => -(v.empresa_avaliacao?.nota ?? 0), modalidade: v => norm(v.modalidade), salario: v => -(parseInt(String(v.salario || '0').replace(/\D/g, '').slice(0, 5)) || 0), vista: v => v.consultado_em };
  function trilhoB() {
    const n = contadores(), c = contagem();
    return `<aside class="B-trilho"><div class="marca">${logo}<span class="nome">CareerBounty</span></div>
      <nav aria-label="Seções">${ABAS.map(([id, t]) => `<button data-acao="aba" data-v="${id}" ${S.aba === id ? 'aria-current="page"' : ''}>${t}${n[id] ? `<span class="cont ${id === 'processos' ? 'atencao' : ''}">${n[id]}</span>` : ''}</button>`).join('')}</nav>
      ${S.aba === 'vagas' ? `<div class="leg" role="group" aria-label="Linhas de aderência"><h2>${S.mundo === 'linha' ? 'Linhas' : 'Aderência'}</h2>${ORDEM.map(a => `<button data-a="${a}" aria-pressed="${S.ader.has(a)}" data-acao="ader" data-v="${a}"><span class="traco"></span>${CURTO[a]}<span class="n">${c[a]}</span></button>`).join('')}</div>` : ''}
      <div class="pe">${pet()}${botaoTema()}${menuMais()}</div></aside>`;
  }
  function varB() {
    const [k, dir] = S.ord, lista = filtradas().sort((x, y) => { const a = ORDENS[k](x), b = ORDENS[k](y); return (a > b ? 1 : a < b ? -1 : 0) * dir || ORDEM.indexOf(x.aderencia) - ORDEM.indexOf(y.aderencia); });
    const th = (id, t, oc = '') => `<th class="${oc}" ${k === id ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}><button data-acao="ord" data-v="${id}">${t}${k === id ? ic('ordem', 'peq') : ''}</button></th>`;
    const v = S.bDet ? vagaDe(S.sel) : null;
    return `<div class="B-casca">${trilhoB()}<main class="B-principal ${v?.id ? 'com-det' : ''}"><div class="B-col">
      <div class="B-topo"><h1>Vagas</h1>${ferramentas({ semAder: true })}</div>
      <div class="B-tabela-wrap">${lista.length ? `<table class="B-tab"><thead><tr>${th('aderencia', 'Vaga')}${th('nota', 'Glassdoor', 'oc')}${th('modalidade', 'Modalidade', 'oc')}${th('salario', 'Salário', 'oc')}<th class="oc"><button>Portal</button></th>${th('vista', 'Vista')}</tr></thead><tbody>
        ${lista.map(x => `<tr data-acao="sel" data-v="${x.id}" aria-selected="${v?.id === x.id}" tabindex="0" class="${aplicada(x) ? 'feita' : ''} ${descartada(x) ? 'descartada' : ''}" data-a="${x.aderencia}">
          <td><div class="vaga">${bola(x.aderencia)}<div><strong>${esc(x.cargo)}</strong><span>${esc(x.empresa)} · <span class="ader-tx" data-a="${x.aderencia}">${CURTO[x.aderencia]}</span>${aplicada(x) ? ' · candidatada' : ''}</span></div></div></td>
          <td class="oc">${nota(x.empresa_avaliacao)}</td><td class="oc">${esc(x.modalidade)}<div class="meta">${esc(x.regime)}</div></td><td class="oc sal">${salCurto(x)}</td><td class="oc">${esc(PORTAL[x.portal_candidatura])}</td><td class="meta">há ${esc(x.vista_ha)}</td></tr>`).join('')}</tbody></table>` : semResultado()}</div></div>
      ${v?.id ? `<aside class="B-det" id="b-det" aria-label="Detalhe da vaga"><div class="fechar"><button class="btn discreto peq" data-acao="fechar">${ic('x')}Fechar</button></div>${detalhe(v)}</aside>` : ''}</main></div>`;
  }

  // ---------- C — Triagem ----------
  function varC() {
    const lista = filtradas();
    if (!lista.some(v => v.id === S.sel)) S.sel = lista[0]?.id ?? null;
    const i = lista.findIndex(v => v.id === S.sel), v = lista[i];
    return `${placa()}<main><div class="ferramentas">${ferramentas()}</div><div class="C-tela">
      <nav class="C-fila" aria-label="Fila de triagem"><h2>Fila de hoje</h2>${ramais(lista, { compacto: true }) || '<p class="meta" style="padding:0 16px">Fila vazia.</p>'}</nav>
      <section class="C-palco" aria-label="Vaga em triagem">${v ? `<div class="C-barra"><span class="pos">${i + 1} de ${lista.length}</span><span class="meta">J e K andam na fila · A marca candidatura · D descarta · O abre a vaga</span></div>
        ${detalhe(v)}<div class="C-decisao"><button class="btn prim" data-acao="aviso" data-v="No painel real abre o anúncio no portal.">Abrir vaga <span class="tecla">O</span></button>
          <button class="btn" data-acao="candC" data-v="${v.id}">${aplicada(v) ? ic('ok') + 'Candidatada' : 'Já me candidatei'} <span class="tecla">A</span></button>
          <button class="btn discreto" data-acao="descartar" data-v="${v.id}">${descartada(v) ? 'Restaurar' : 'Descartar'} <span class="tecla">D</span></button>
          <span class="dir"><button class="btn" data-acao="passo" data-v="-1" aria-label="Vaga anterior">${ic('volta')}<span class="tecla">K</span></button><button class="btn" data-acao="passo" data-v="1" aria-label="Próxima vaga"><span class="tecla">J</span>${ic('seta')}</button></span></div>` : semResultado()}</section></div></main>`;
  }

  // ---------- Processos ----------
  function trilhoProc(p) {
    const at = ETAPA_I[p.etapa] ?? 3, esperando = ['aguardando', 'em_conversa'].includes(p.etapa), d = dias(p.ultima_interacao);
    return `<div class="trilho" data-a="${vagaDe(p.vaga_id).aderencia || 'boa'}" role="img" aria-label="Etapa atual: ${ETAPAS[at]}${esperando ? `, ${d} dias sem retorno` : ''}">${ETAPAS.map((e, i) => {
      const cls = i < at ? 'feito' : i === at ? `atual ${esperando ? 'espera' : ''}` : '';
      return `<div class="seg ${cls}">${i === at && esperando ? `<span class="espera-n ${d >= 7 ? 'perigo' : d >= 5 ? 'atencao' : ''}">${d === 0 ? 'hoje' : `${d} dias`}</span>` : ''}<span class="bola" style="${i === at ? 'background:var(--cor)' : ''}"></span>${e}</div>`;
    }).join('')}</div>`;
  }
  function processos() {
    const lem = lembretes(), ativos = D.processos.filter(p => p.etapa !== 'encerrado'), lista = ativos.filter(p => !S.funil || p.etapa === S.funil);
    if (!lista.some(p => p.id === S.proc)) S.proc = lista[0]?.id;
    const p = D.processos.find(x => x.id === S.proc);
    return `<div class="pagina"><h1>Processos</h1><p class="sub">Candidaturas em andamento, contatos com recrutadores e o próximo passo de cada uma. O Gmail alimenta a linha do tempo; WhatsApp e LinkedIn você registra aqui.</p>
      ${lem.length ? `<h2>Pedem acompanhamento</h2><div class="painel cobrar">${lem.map(({ p: x, d }) => { const c = contatosDe(x.vaga_id)[0];
        return `<div class="item"><div class="dias ${d >= 7 ? 'perigo' : ''}">${d}<small>dias</small></div><div><strong>${esc(x.empresa)}</strong> · ${esc(x.cargo)}<div class="meta">Último contato${c ? ` com ${esc(c.nome)}, por ${CANAL[c.canal][1]},` : ''} em ${dia(x.ultima_interacao)}. Nenhuma próxima etapa marcada.</div></div>
          <div class="acoes-l"><button class="btn prim peq" data-acao="proc" data-v="${x.id}" data-foco="rascunho">Escrever acompanhamento</button><button class="btn peq" data-acao="rolando" data-v="${x.id}">Ainda em andamento</button><button class="btn discreto peq" data-acao="encerrar" data-v="${x.id}">Encerrar</button></div></div>`; }).join('')}</div>` : ''}
      <div class="filtro-etapas" role="group" aria-label="Filtrar por etapa"><button class="chip" aria-pressed="${!S.funil}" data-acao="funil" data-v="">Todas <span class="n">${ativos.length}</span></button>${Object.keys(ETAPA_I).map(e => `<button class="chip" aria-pressed="${S.funil === e}" data-acao="funil" data-v="${e}">${ETAPA[e]} <span class="n">${ativos.filter(x => x.etapa === e).length}</span></button>`).join('')}</div>
      <div class="proc-grade"><div class="painel proc-lista">${lista.map(x => `<button class="proc" aria-current="${x.id === S.proc}" data-acao="proc" data-v="${x.id}"><span class="cab"><strong>${esc(x.empresa)}</strong><span>${esc(x.cargo)}</span></span>${trilhoProc(x)}</button>`).join('') || '<div class="vazio">Nenhum processo nesta etapa.</div>'}</div>
      <div class="painel proc-det">${p ? detalheProcesso(p) : ''}</div></div>
      <h2 style="margin-top:36px" id="respostas">Respostas de formulário</h2><p class="meta" style="margin:-4px 0 12px">Perguntas dos formulários de candidatura que o banco de respostas ainda não cobre.</p>${respostasBloco()}</div>`;
  }
  function detalheProcesso(p) {
    const v = vagaDe(p.vaga_id), cs = contatosDe(p.vaga_id), c = cs[0], d = dias(p.ultima_interacao);
    const rascunho = `Olá${c ? ' ' + c.nome.split(' ')[0] : ''}, tudo bem? Me candidatei à vaga de ${p.cargo} em ${dia(p.eventos[0].data)} e sigo com interesse. Há novidade sobre os próximos passos? Fico à disposição para conversar.`;
    const fortes = v.motivos || [], atencao = [...(v.requisitos || []).filter(r => r.avaliacao !== 'atende').map(r => r.requisito), ...(v.lacunas || [])];
    return `<div class="det-topo">${v.aderencia ? plaqueta(v.aderencia) : ''}<strong>${esc(p.empresa)}</strong><span>${ETAPA[p.etapa]}</span></div><h2>${esc(p.cargo)}</h2>${trilhoProc(p)}
      ${p.proxima_etapa ? `<div class="alerta" style="margin-top:18px">${ic('alerta')}<div><strong>Próxima etapa:</strong> ${esc(p.proxima_etapa.tipo)}, ${esc(/\d/.test(p.proxima_etapa.data) ? dia(p.proxima_etapa.data) + ' às ' + p.proxima_etapa.data.slice(11) : p.proxima_etapa.data)}.</div></div>` : ''}
      <h3>Contatos</h3>${cs.map(k => `<div class="contato"><span class="canal" title="${CANAL[k.canal][1]}">${ic(CANAL[k.canal][0])}</span><div style="flex:1;min-width:0"><strong>${esc(k.nome)}</strong> <span class="meta">${esc(k.papel)}</span><div class="meta" style="overflow-wrap:anywhere">${esc(k.endereco)}</div></div><span class="meta">há ${dias(k.ultimo_contato)} dias</span></div>`).join('') || '<p class="meta">Nenhum contato registrado.</p>'}
      <h3>Linha do tempo</h3><ol class="tempo">${p.eventos.map(e => `<li><span class="q">${dia(e.data)}</span><span>${esc(e.resumo)}</span><span class="origem">${e.origem === 'gmail' ? 'Gmail' : 'Registro'}</span></li>`).join('')}</ol>
      <div class="registro"><label>Canal<select class="campo" id="rc-canal"><option value="whatsapp">WhatsApp</option><option value="linkedin">LinkedIn</option><option value="email">E-mail</option></select></label>
        <label>O que aconteceu<input class="campo" id="rc-resumo" placeholder="Ex.: recrutadora pediu pretensão salarial"></label><label>Data<input class="campo" type="date" id="rc-data" value="${D.hoje}"></label><button class="btn" data-acao="registrar" data-v="${p.id}">${ic('mais1')}Registrar contato</button></div>
      ${['aguardando', 'em_conversa'].includes(p.etapa) ? `<h3>Mensagem de acompanhamento${d >= 5 ? ` <span style="color:${d >= 7 ? 'var(--perigo)' : 'var(--atencao)'}">· ${d} dias sem retorno</span>` : ''}</h3>
        <textarea class="campo" id="rascunho" rows="4">${esc(rascunho)}</textarea><div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center"><button class="btn peq" data-acao="aviso" data-v="Mensagem copiada.">${ic('copiar')}Copiar</button><button class="btn peq" data-acao="aviso" data-v="No painel real abre um rascunho no Gmail; o envio é seu.">${ic('mail')}Abrir rascunho no Gmail</button><span class="meta">O painel não envia mensagens.</span></div>` : ''}
      ${p.etapa === 'entrevista' ? `<h3>Preparação para a entrevista</h3><div class="prep"><div><strong style="color:var(--ok)">Pontos fortes</strong><ul>${fortes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div><strong style="color:var(--atencao)">Pontos de atenção</strong><ul>${atencao.map(x => `<li>${esc(x)}</li>`).join('') || '<li>Nenhum requisito em aberto.</li>'}</ul></div></div>
        <p class="meta" style="margin-top:10px">Perguntas para levar: como o time mede sucesso no primeiro trimestre; tamanho e senioridade do time; como funciona o plantão.</p>` : ''}
      ${p.etapa === 'devolutiva' ? `<div class="alerta perigo" style="margin-top:18px">${ic('alerta')}<div><strong>Devolutiva negativa.</strong> ${esc(p.eventos.at(-1).resumo)}<br><button class="btn peq" style="margin-top:8px" data-acao="aba" data-v="curriculo">Ver a lacuna em Currículo e provas</button></div></div>` : ''}`;
  }
  const respostasBloco = () => `<div class="painel respostas">${D.respostas.map(r => `<div class="r"><strong>${esc(r.label)}</strong><div class="meta">Pedida por ${esc(r.vagas.join(' e '))}${r.sugestao ? '. Rascunho feito a partir das suas afirmações; revise antes de salvar.' : ''}</div>
    <div class="linha-r">${r.tipo === 'sim_nao' ? `<select class="campo" aria-label="${esc(r.label)}"><option>Escolha</option><option>Sim</option><option>Não</option></select>` : r.tipo === 'texto_longo' ? `<textarea class="campo" rows="2" style="flex:1 1 360px" aria-label="${esc(r.label)}">${esc(r.sugestao)}</textarea>` : `<input class="campo" style="flex:1 1 260px" aria-label="${esc(r.label)}">`}
    <select class="campo" aria-label="Vale para"><option>Vale para todas as vagas</option><option>Só para esta empresa</option></select><button class="btn peq" data-acao="aviso" data-v="Resposta salva no banco de respostas (simulado).">Salvar resposta</button></div></div>`).join('')}</div>`;

  // ---------- Currículo e provas ----------
  const QUAD = { confere: ['alta', 'Confere', 'No CV e com dado que prova', 'Nada a fazer'], sem_prova: ['condicional', 'Sem prova', 'No CV, mas falta dado ou número', 'Adicionar prova'], fora_do_cv: ['boa', 'Fora do CV', 'Tem dado, mas não está no CV', 'Decidir se entra'], lacunas: ['incompativel', 'Lacunas', 'Pedido pelas vagas, sem dado na base', 'Responder'] };
  const QK = { ok: 'confere', semprova: 'sem_prova', fora: 'fora_do_cv', lacuna: 'lacunas' }, KQ = Object.fromEntries(Object.entries(QK).map(([a, b]) => [b, a]));
  function curriculo() {
    const A = D.analise, k = QK[S.quad], vis = ch => A[ch].filter(i => !S.ignorados.has(i.id));
    const cel = ch => { const [a, t, d, ac] = QUAD[ch], n = vis(ch).length;
      return `<button class="celula ${S.chegou === ch ? 'chegou' : ''}" data-q="${ch}" aria-pressed="${k === ch}" data-acao="quad" data-v="${KQ[ch]}"><span class="q-n">${n}</span><span class="q-t">${t}</span><span class="q-d">${d}</span><span class="q-acao">${n ? ac : 'Em dia'}</span></button>`; };
    const ids = i => `<div class="ids">${[...(i.afirmacoes || []), ...(i.evidencias || [])].map(x => `<span class="id">${x}</span>`).join('')}${i.nivel_prova ? `<span class="id">${esc(i.nivel_prova)}</span>` : ''}${i.peso ? `<span class="id">peso ${i.peso}</span>` : ''}</div>`;
    const acoes = i => ({
      confere: `<button class="btn peq" data-acao="aviso" data-v="No painel real abre a evidência.">Ver prova</button><button class="btn discreto peq" data-acao="mover" data-de="confere" data-para="fora_do_cv" data-v="${i.id}">Tirar do CV</button>`,
      sem_prova: `<div class="resp"><input class="campo" id="r-${i.id}" placeholder="${esc(i.pergunta)}" aria-label="${esc(i.pergunta)}"><button class="btn prim peq" data-acao="mover" data-de="sem_prova" data-para="confere" data-v="${i.id}">Salvar prova</button></div><button class="btn discreto peq" data-acao="ignorar" data-v="${i.id}">Tirar do CV</button>`,
      fora_do_cv: `<button class="btn prim peq" data-acao="mover" data-de="fora_do_cv" data-para="confere" data-v="${i.id}">Incluir no CV</button><button class="btn discreto peq" data-acao="ignorar" data-v="${i.id}">Não usar</button>`,
      lacunas: `<div class="resp"><input class="campo" id="r-${i.id}" placeholder="${esc(i.pergunta)}" aria-label="${esc(i.pergunta)}"><button class="btn prim peq" data-acao="mover" data-de="lacunas" data-para="fora_do_cv" data-v="${i.id}">Tenho essa experiência</button></div><button class="btn discreto peq" data-acao="ignorar" data-v="${i.id}">Não tenho</button>`,
    })[k];
    return `<div class="pagina"><h1>Currículo e provas</h1><p class="sub">Compara o que está no seu currículo com o que a sua base consegue provar. Ajuste os itens aqui; a mudança vale para os próximos CVs.</p>
      <div class="matriz"><span></span><span class="eixo">Tem dado que prova</span><span class="eixo">Não tem dado</span><span class="eixo v">Está no CV</span>${cel('confere')}${cel('sem_prova')}<span class="eixo v">Fora do CV</span>${cel('fora_do_cv')}${cel('lacunas')}</div>
      <div class="painel itens-q"><div class="cab-q" data-q="${k}"><span class="bola cheia" aria-hidden="true"></span><strong>${QUAD[k][1]}</strong><span class="meta">${QUAD[k][2]}</span></div>
      ${vis(k).map(i => `<div class="it"><p>${esc(i.texto)}</p>${ids(i)}${i.motivo ? `<p class="meta">${esc(i.motivo)}</p>` : ''}<div class="acoes-i">${acoes(i)}</div></div>`).join('') || '<div class="vazio"><strong>Nada pendente aqui.</strong>Os itens que você ajustar nas outras situações aparecem onde couberem.</div>'}</div></div>`;
  }

  // ---------- Histórico e secundárias ----------
  function historico() {
    const sit = s => /entrevista/i.test(s) ? ['confere', true] : /conversa|aguardando/i.test(s) ? ['fora_do_cv', false] : ['neutro', false];
    const fim = s => /não avançou|encerrada/i.test(s);
    const linhas = D.historico.filter(h => S.hist === 'todas' || (S.hist === 'andamento' ? !fim(h.situacao) : fim(h.situacao))).sort((a, b) => b.data.localeCompare(a.data));
    const ult = id => { const p = D.processos.find(x => x.vaga_id === id); return p ? `há ${dias(p.ultima_interacao)} dias` : '—'; };
    return `<div class="pagina"><h1>Histórico</h1><p class="sub">Todas as candidaturas e como terminaram.</p>
      <div class="chips" style="margin-bottom:14px">${[['todas', 'Todas'], ['andamento', 'Em andamento'], ['fim', 'Encerradas']].map(([v, t]) => `<button class="chip" aria-pressed="${S.hist === v}" data-acao="hist" data-v="${v}">${t}</button>`).join('')}</div>
      <div class="painel" style="overflow-x:auto"><table class="tab"><thead><tr><th>Data</th><th>Empresa</th><th>Vaga</th><th class="oc">Via</th><th>Situação</th><th class="oc">Último contato</th></tr></thead><tbody>
      ${linhas.map(h => { const [a, cheia] = sit(h.situacao); return `<tr><td>${dia(h.data)}</td><td>${esc(h.empresa)}</td><td>${esc(h.cargo)}</td><td class="oc">${esc(h.via)}</td><td><span class="sit" data-q="${a}"><span class="bola ${cheia ? 'cheia' : ''}" aria-hidden="true"></span>${esc(h.situacao)}</span></td><td class="oc meta">${ult(h.vaga_id)}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  const secundaria = {
    respostas: () => `<div class="pagina"><h1>Respostas de formulário</h1><p class="sub">Perguntas dos formulários de candidatura que o banco de respostas ainda não cobre. A candidatura assistida usa o que você salvar aqui.</p>${respostasBloco()}</div>`,
    fontes: () => `<div class="pagina"><h1>Fontes e cobertura</h1><p class="sub">De onde vieram as vagas da rodada de ${dia(D.hoje)}, às ${esc(D.radar.atualizado.slice(11))}. ${D.radar.na_fila} anúncios ainda aguardam leitura e não aparecem como vagas.</p><div class="painel"><table class="tab"><thead><tr><th>Fonte</th><th>Resultados</th><th>Situação</th></tr></thead><tbody>${D.radar.fontes.map(f => `<tr><td>${esc(f.fonte)}</td><td>${f.resultados}</td><td><span class="sit" data-q="confere"><span class="bola cheia" aria-hidden="true"></span>Consultada</span></td></tr>`).join('')}</tbody></table></div></div>`,
    linkedin: () => '<div class="pagina"><h1>Perfil do LinkedIn</h1><p class="sub">Ferramenta secundária: sugestões de título, resumo e experiências a partir da sua base. Fica fora das abas principais de propósito.</p><div class="painel vazio"><strong>Esboço.</strong>Conteúdo a definir com a sessão principal.</div></div>',
  };

  // ---------- render ----------
  function render() {
    const raiz = document.documentElement;
    raiz.dataset.variante = S.variante; raiz.dataset.tema = S.tema; raiz.dataset.mundo = S.mundo;
    history.replaceState(null, '', `?${new URLSearchParams({ mundo: S.mundo, variante: S.variante, tema: S.tema, aba: S.aba })}`);
    const ativo = document.activeElement, idFoco = ativo?.id, pos = ativo?.selectionStart;
    const rolagens = ['a-lista', 'a-det', 'b-det'].map(id => [id, document.getElementById(id)?.scrollTop]);
    const pagina = S.aba === 'vagas' ? null : S.aba === 'processos' ? processos() : S.aba === 'curriculo' ? curriculo() : S.aba === 'historico' ? historico() : (secundaria[S.aba] || historico)();
    let html;
    if (S.aba === 'vagas') html = { A: varA, B: varB, C: varC }[S.variante]();
    else html = S.variante === 'B' ? `<div class="B-casca">${trilhoB()}<main>${pagina}</main></div>` : `${placa()}<main>${pagina}</main>`;
    document.getElementById('app').innerHTML = html + (S.aviso ? `<div class="aviso-voo" role="status">${esc(S.aviso)}</div>` : '');
    document.getElementById('prot-rot').innerHTML = `${{ misto: 'Misto', guilda: 'Guilda', linha: 'Linha' }[S.mundo]} · <b>${S.variante}</b> ${VARIANTES[S.variante]} · ${S.tema}`;
    rolagens.forEach(([id, top]) => { const el = document.getElementById(id); if (el && top != null) el.scrollTop = S._topo && id !== 'a-lista' ? 0 : top; });
    S._topo = false;
    if (idFoco) { const el = document.getElementById(idFoco); if (el) { el.focus(); if (pos != null && el.setSelectionRange) try { el.setSelectionRange(pos, pos); } catch { } } }
    fundo.cores();
  }
  let recadoT;
  function mostrarRecado() { if (S.mundo === 'linha') return; S.balao = true; clearTimeout(recadoT); recadoT = setTimeout(() => { S.balao = false; render(); }, 6000); }
  let avisoT;
  const aviso = t => { S.aviso = t; render(); clearTimeout(avisoT); avisoT = setTimeout(() => { S.aviso = ''; render(); }, 2400); };
  function passo(n) { const l = filtradas(), i = l.findIndex(v => v.id === S.sel); if (!l.length) return; S.sel = l[Math.min(l.length - 1, Math.max(0, i + n))].id; S._topo = true; }

  // ---------- eventos ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-acao]');
    if (!el) { if (S.menu && !e.target.closest('.menu')) { S.menu = false; render(); } return; }
    const a = el.dataset.acao, v = el.dataset.v;
    if (el.tagName === 'A') e.preventDefault();
    if (a !== 'menu') S.menu = false;
    switch (a) {
      case 'aba': S.aba = v; scrollTo(0, 0); mostrarRecado(); break;
      case 'tema': S.tema = S.tema === 'claro' ? 'escuro' : 'claro'; break;
      case 'menu': S.menu = !S.menu; break;
      case 'balao': clearTimeout(recadoT); S.balao = !S.balao; break;
      case 'fundo': S.fundoParado = !S.fundoParado; fundo.reiniciar(); break;
      case 'ader': S.ader.has(v) ? S.ader.delete(v) : S.ader.add(v); break;
      case 'limpar': Object.assign(S, { ader: new Set(['alta', 'boa', 'condicional', 'baixa']), modo: '', regime: '', portal: '', cand: '', desc: 'nao', busca: '' }); break;
      case 'sel': S.sel = v; S.abreDet = true; S.bDet = true; S._topo = true; break;
      case 'voltar': S.abreDet = false; break;
      case 'fechar': S.bDet = false; break;
      case 'ord': S.ord = [v, S.ord[0] === v ? -S.ord[1] : 1]; break;
      case 'passo': passo(Number(v)); break;
      case 'candC': { const x = vagaDe(v); marcar(x, 'aplicada', !aplicada(x)); if (aplicada(x) && !dataCand(x)) marcar(x, 'data', D.hoje); break; }
      case 'descartar': { const x = vagaDe(v); marcar(x, 'descartada', !descartada(x)); break; }
      case 'aviso': return aviso(v);
      case 'proc': S.proc = v; if (el.dataset.foco) setTimeout(() => { const t = document.getElementById('rascunho'); t?.scrollIntoView({ block: 'center' }); t?.focus(); }, 0); break;
      case 'funil': S.funil = v; break;
      case 'rolando': { const p = D.processos.find(x => x.id === v); p.ultima_interacao = D.hoje; p.eventos.push({ data: D.hoje, canal: 'portal', origem: 'manual', resumo: 'Você confirmou que o processo segue em andamento.' }); return aviso('Lembrete adiado. A contagem recomeça hoje.'); }
      case 'encerrar': { const p = D.processos.find(x => x.id === v); p.etapa = 'encerrado'; const h = D.historico.find(x => x.vaga_id === p.vaga_id); if (h) h.situacao = 'Não avançou'; return aviso('Processo encerrado e guardado no Histórico.'); }
      case 'registrar': { const p = D.processos.find(x => x.id === v), r = document.getElementById('rc-resumo').value.trim(); if (!r) return aviso('Descreva o contato antes de registrar.');
        const data = document.getElementById('rc-data').value || D.hoje; p.eventos.push({ data, canal: document.getElementById('rc-canal').value, origem: 'manual', resumo: r }); if (data > p.ultima_interacao) p.ultima_interacao = data; return aviso('Contato registrado.'); }
      case 'quad': S.quad = v; break;
      case 'mover': { const A = D.analise, de = el.dataset.de, para = el.dataset.para, i = A[de].findIndex(x => x.id === v), item = A[de][i], inp = document.getElementById('r-' + v);
        if (inp && !inp.value.trim()) return aviso('Escreva a resposta antes de salvar.');
        A[de].splice(i, 1); if (inp) { item.nivel_prova = 'relato'; item.motivo = 'Sua resposta: ' + inp.value.trim(); }
        A[para].unshift(item); S.chegou = para; setTimeout(() => { S.chegou = null; }, 800); break; }
      case 'ignorar': S.ignorados.add(v); break;
      case 'hist': S.hist = v; break;
    }
    render();
  });
  document.addEventListener('input', e => { if (e.target.dataset.campo === 'busca') { S.busca = e.target.value; render(); } });
  document.addEventListener('change', e => {
    const c = e.target.dataset.campo; if (!c || c === 'busca') return;
    if (c === 'aplicada' || c === 'data') { const v = vagaDe(e.target.dataset.id); if (c === 'aplicada') { marcar(v, 'aplicada', e.target.checked); if (e.target.checked && !dataCand(v)) marcar(v, 'data', D.hoje); } else marcar(v, 'data', e.target.value); }
    else S[c] = e.target.value;
    render();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (S.menu) S.menu = false; else if (S.variante === 'B' && S.bDet) S.bDet = false; else return; render(); return; }
    if (e.target.closest('input,textarea,select,[contenteditable]') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' && e.target.matches('tr[data-acao]')) { e.target.click(); return; }
    if (S.variante === 'C' && S.aba === 'vagas') {
      const v = vagaDe(S.sel), k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') { passo(k === 'j' ? 1 : -1); render(); return; }
      if (k === 'a' && v.id) { marcar(v, 'aplicada', !aplicada(v)); if (aplicada(v) && !dataCand(v)) marcar(v, 'data', D.hoje); render(); return; }
      if (k === 'd' && v.id) { marcar(v, 'descartada', !descartada(v)); passo(1); render(); return; }
      if (k === 'o' && v.id) { aviso('No painel real abre o anúncio no portal.'); return; }
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { trocar(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); }
  });
  function trocar(n) { const ks = Object.keys(VARIANTES); S.variante = ks[(ks.indexOf(S.variante) + n + ks.length) % ks.length]; S.menu = false; render(); }

  // ---------- fundo: mapa de linhas com trens ----------
  // Rede pré-desenhada num canvas à parte; a cada quadro só os trens se movem. ~30 qps, pausa com a aba oculta,
  // quadro fixo com prefers-reduced-motion ou quando a pessoa para a animação no menu.
  const fundo = (function () {
    const cv = document.getElementById('fundo'), ctx = cv.getContext('2d'), rede = document.createElement('canvas'), rctx = rede.getContext('2d');
    const reduz = matchMedia('(prefers-reduced-motion: reduce)');
    let w, h, dpr, raf, ultimo = 0, t0 = performance.now(), linhas = [], cores = {}, chaveCor = '';
    const parado = () => reduz.matches || S.fundoParado;
    function rng(s) { return () => (s = (s * 16807) % 2147483647) / 2147483647; }
    function tracar() {
      const r = rng(7), dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([x, y]) => [x / Math.hypot(x, y), y / Math.hypot(x, y)]);
      linhas = ORDEM.map((a, n) => {
        let x = r() * w * 0.2 + (n % 2 ? w * 0.8 : 0), y = (n + 0.5) * h / ORDEM.length, d = n % 2 ? 4 : 0;
        const pts = [[x, y]];
        for (let k = 0; k < 9; k++) { const len = 140 + r() * 260; d = (d + [0, 1, 7][Math.floor(r() * 3)]) % 8; if (d === 2 || d === 6) d = (d + 1) % 8;
          x = Math.max(-80, Math.min(w + 80, x + dirs[d][0] * len)); y = Math.max(-80, Math.min(h + 80, y + dirs[d][1] * len)); pts.push([x, y]); }
        const segs = []; let total = 0; for (let k = 1; k < pts.length; k++) { const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); segs.push([pts[k - 1], pts[k], total, l]); total += l; }
        return { a, pts, segs, total };
      });
    }
    function lerCores() { const s = getComputedStyle(document.documentElement); cores = Object.fromEntries(['chao', 'sup', 'sup2', 'sup3', 'borda', ...ORDEM.map(a => 'l-' + a)].map(k => [k, s.getPropertyValue('--' + k).trim()])); }
    function desenharRede() {
      rede.width = w * dpr; rede.height = h * dpr; rctx.setTransform(dpr, 0, 0, dpr, 0, 0); rctx.clearRect(0, 0, w, h);
      rctx.lineCap = 'round'; rctx.lineJoin = 'round';
      for (const L of linhas) {
        rctx.globalAlpha = 0.16; rctx.strokeStyle = cores['l-' + L.a]; rctx.lineWidth = 7; rctx.beginPath(); L.pts.forEach(([x, y], i) => i ? rctx.lineTo(x, y) : rctx.moveTo(x, y)); rctx.stroke();
        rctx.globalAlpha = 0.35; for (let s = 90; s < L.total; s += 170) { const [x, y] = ponto(L, s); rctx.fillStyle = cores.chao; rctx.beginPath(); rctx.arc(x, y, 5, 0, 7); rctx.fill(); rctx.lineWidth = 2.5; rctx.stroke(); }
      }
      rctx.globalAlpha = 1;
    }
    function ponto(L, s) { s = ((s % L.total) + L.total) % L.total; for (const [p, q, ini, l] of L.segs) if (s <= ini + l) { const f = (s - ini) / l; return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, Math.atan2(q[1] - p[1], q[0] - p[0])]; } return L.pts.at(-1); }
    let estrelas = [], nuvens = [], serra = [];
    function cenario() {
      const r = rng(11), P = 4;
      estrelas = Array.from({ length: Math.round(w * h / 9000) }, () => ({ x: Math.floor(r() * w / P) * P, y: Math.floor(r() * h * 0.8 / P) * P, f: r() * 6, g: r() < 0.15 }));
      nuvens = Array.from({ length: 6 }, (_, i) => ({ x: r() * w, y: 60 + r() * h * 0.45, l: 10 + Math.floor(r() * 10), v: 4 + r() * 6 }));
      serra = []; let y = h * 0.86; for (let x = 0; x <= w + P * 6; x += P * 6) { y = Math.max(h * 0.74, Math.min(h * 0.94, y + (r() - 0.5) * 60)); serra.push([x, Math.floor(y / P) * P]); }
    }
    function ceu(t) {
      const P = 4, escuro = S.tema === 'escuro';
      ctx.clearRect(0, 0, w, h);
      if (escuro) for (const e of estrelas) { const b = 0.5 + 0.5 * Math.sin(t * 0.9 + e.f); if (b < 0.25) continue; ctx.globalAlpha = 0.25 + 0.6 * b; ctx.fillStyle = e.g ? '#E6B450' : '#CFC6EA'; ctx.fillRect(e.x, e.y, e.g ? P : 2, e.g ? P : 2); }
      else for (const n of nuvens) { const x = ((n.x + t * n.v) % (w + 200)) - 100; ctx.globalAlpha = 0.9; ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(Math.round(x / P) * P, n.y, n.l * P, P * 2); ctx.fillRect(Math.round(x / P) * P + P * 2, n.y - P * 2, (n.l - 4) * P, P * 2); ctx.fillRect(Math.round(x / P) * P + P * 4, n.y - P * 3, P * 3, P); }
      ctx.globalAlpha = escuro ? 0.9 : 0.7; ctx.fillStyle = escuro ? cores.sup : cores.sup3;
      for (let i = 0; i < serra.length - 1; i++) { const [x, y] = serra[i]; ctx.fillRect(x, y, P * 6, h - y); }
      ctx.globalAlpha = escuro ? 0.9 : 0.6; ctx.fillStyle = escuro ? cores.sup2 : cores.borda;
      for (let i = 0; i < serra.length - 1; i += 2) { const [x, y] = serra[i]; ctx.fillRect(x + P * 3, y + P * 6, P * 6, h); }
      ctx.globalAlpha = 1;
    }
    function quadro(agora) {
      const t = (agora - t0) / 1000;
      if (S.mundo !== 'linha') return ceu(t);
      ctx.clearRect(0, 0, w, h); ctx.drawImage(rede, 0, 0, w, h);
      linhas.forEach((L, n) => { for (let k = 0; k < 2; k++) { const [x, y, ang] = ponto(L, t * (28 + n * 4) * (k ? -1 : 1) + k * L.total / 2 + n * 300);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = 0.55; ctx.fillStyle = cores['l-' + L.a]; ctx.beginPath(); ctx.roundRect(-14, -4.5, 28, 9, 4.5); ctx.fill(); ctx.restore(); } });
      ctx.globalAlpha = 1;
    }
    function tamanho() { dpr = Math.min(devicePixelRatio || 1, 2); w = innerWidth; h = innerHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); tracar(); cenario(); lerCores(); desenharRede(); }
    function laco(agora) { raf = requestAnimationFrame(laco); if (agora - ultimo < 33) return; ultimo = agora; quadro(agora); }
    function reiniciar() { cancelAnimationFrame(raf); if (document.hidden) return; if (parado()) quadro(t0 + 20000); else raf = requestAnimationFrame(laco); }
    addEventListener('resize', () => { tamanho(); reiniciar(); });
    document.addEventListener('visibilitychange', reiniciar);
    reduz.addEventListener?.('change', reiniciar);
    tamanho();
    return {
      reiniciar,
      recriar() { chaveCor = ''; },
      cores() { const s = getComputedStyle(document.documentElement).getPropertyValue('--chao') + S.mundo; if (s !== chaveCor) { chaveCor = s; lerCores(); desenharRede(); if (parado()) quadro(t0 + 20000); } },
      medir(n = 120) { const ts = []; for (let i = 0; i < n; i++) { const a = performance.now(); quadro(a + i * 33); ts.push(performance.now() - a); } ts.sort((a, b) => a - b); return { quadros: n, mediana_ms: +ts[n >> 1].toFixed(3), p95_ms: +ts[Math.floor(n * .95)].toFixed(3), largura: w, altura: h }; },
    };
  })();
  window.__fundo = fundo;

  // ---------- seletor de variação ----------
  document.getElementById('prot-ant').onclick = () => trocar(-1);
  document.getElementById('prot-prox').onclick = () => trocar(1);
  document.getElementById('prot-mundo').onclick = () => { S.mundo = { misto: 'guilda', guilda: 'linha', linha: 'misto' }[S.mundo]; fundo.recriar(); render(); };
  document.getElementById('prot-tema').onclick = () => { S.tema = S.tema === 'claro' ? 'escuro' : 'claro'; render(); };
  mostrarRecado(); render(); fundo.reiniciar();
})();
