// PROTÓTIPO — dados 100% sintéticos (empresas, pessoas e links fictícios). Não ligar a dado real.
// Formato espelha o que o painel recebe hoje (vagas, cvs) mais os nomes combinados com a sessão principal:
// empresa_avaliacao nas vagas e as rotas /api/processos, /api/contatos, /api/acompanhamento, /api/historico, /api/analise-curriculo.
window.DADOS = (function () {
  const hoje = '2026-10-18';
  const av = (nota, quantidade, resumo, plataforma = 'Glassdoor') => ({ nota, quantidade, plataforma, data: '2026-10-10', fontes: [plataforma], resumo });
  const req = (requisito, avaliacao, tipo = 'obrigatorio') => ({ requisito, avaliacao, tipo });
  const cv = (id, extra = {}) => ({ atual: { tipo: 'adaptado', hash: id.slice(0, 8), ats: `artifacts/cv/${id}/cv-ats.pdf`, visual: `artifacts/cv/${id}/cv-visual.pdf` }, ...extra });

  const vagas = [
    { id: 'lumen-001', empresa: 'Lumen Pagamentos', cargo: 'Engineering Manager — Plataforma de Pagamentos', aderencia: 'alta', modalidade: 'remoto', local: 'Brasil', regime: 'CLT', salario: 'R$ 24.000 a R$ 28.000', portal_candidatura: 'greenhouse', url_status: 'aberta', consultado_em: '2026-10-18', vista_ha: '2 h',
      descricao: 'Lidera dois times de backend (14 pessoas) responsáveis por conciliação e liquidação. Responde por roadmap técnico, contratação e indicadores de confiabilidade.',
      motivos: ['Liderou time de 12 pessoas em produto financeiro', 'Migração de monólito para eventos com resultado medido', 'Faixa salarial acima do piso'],
      lacunas: [], requisitos: [req('Gestão de times de engenharia', 'atende'), req('Sistemas distribuídos e mensageria', 'atende'), req('Experiência com meios de pagamento', 'parcial'), req('Inglês avançado', 'atende', 'desejavel')],
      empresa_avaliacao: av(4.4, 1240, 'Boa nota em cultura e liderança; críticas a ritmo de entregas no fim do trimestre.') },
    { id: 'trilha-002', empresa: 'Trilha Logística', cargo: 'Tech Lead Backend (Node.js)', aderencia: 'alta', modalidade: 'remoto', local: 'Brasil', regime: 'PJ', salario: 'R$ 22.000 a R$ 25.000', portal_candidatura: 'gupy', url_status: 'aberta', consultado_em: '2026-10-18', vista_ha: '5 h',
      descricao: 'Referência técnica de um time de roteirização. Desenho de APIs, revisão de código, observabilidade e mentoria de quatro pessoas.',
      motivos: ['Node.js e TypeScript em produção há 6 anos', 'Experiência com observabilidade e SLOs'], lacunas: ['Roteirização e otimização combinatória'],
      requisitos: [req('Node.js e TypeScript', 'atende'), req('Arquitetura de APIs', 'atende'), req('Algoritmos de roteirização', 'nao_atende', 'desejavel')],
      perfil_gupy: { campos: 6, resumo: 'Atualizar resumo profissional, incluir 2 experiências e 4 competências; nenhum campo sensível.' },
      empresa_avaliacao: av(3.9, 412, 'Benefícios elogiados; reclamações sobre plano de carreira pouco claro.') },
    { id: 'orbe-003', empresa: 'Orbe Saúde', cargo: 'Gerente de Engenharia — Produtos Clínicos', aderencia: 'alta', modalidade: 'híbrido', local: 'São Paulo, SP (2x por semana)', regime: 'CLT', salario: null, portal_candidatura: 'lever', url_status: 'aberta', consultado_em: '2026-10-17', vista_ha: '1 d',
      descricao: 'Gestão de três squads que constroem prontuário e agenda. Exige proximidade com produto e compliance de dados de saúde.',
      motivos: ['Gestão de múltiplos squads', 'Projetos com LGPD e dado sensível'], lacunas: [], pendencias: ['Salário não divulgado'],
      requisitos: [req('Gestão de gestores', 'parcial'), req('LGPD e dado sensível', 'atende'), req('Produto B2B', 'atende')],
      empresa_avaliacao: av(4.1, 860, 'Equilíbrio entre vida pessoal e trabalho bem avaliado.') },
    { id: 'vetor-004', empresa: 'Vetor Seguros', cargo: 'Staff Engineer — Arquitetura', aderencia: 'boa', modalidade: 'remoto', local: 'Brasil', regime: 'CLT', salario: 'R$ 26.000', portal_candidatura: 'greenhouse', url_status: 'aberta', consultado_em: '2026-10-17', vista_ha: '1 d',
      descricao: 'Define padrões de arquitetura para 20 times e conduz a saída de um legado em .NET para serviços em nuvem.',
      motivos: ['Conduziu migração de legado', 'Escrita de ADRs e padrões'], lacunas: ['.NET em produção recente'],
      requisitos: [req('Arquitetura de software', 'atende'), req('.NET', 'parcial'), req('AWS', 'atende')],
      empresa_avaliacao: av(3.6, 530, 'Notas medianas; comentários citam reestruturação recente.') },
    { id: 'ponte-005', empresa: 'Ponte Educação', cargo: 'Head de Engenharia', aderencia: 'boa', modalidade: 'remoto', local: 'Brasil', regime: 'PJ', salario: 'R$ 30.000 a R$ 34.000', portal_candidatura: 'solides', url_status: 'aberta', consultado_em: '2026-10-16', vista_ha: '2 d',
      descricao: 'Primeira liderança de engenharia da empresa (30 pessoas). Estruturar carreira, processos de entrega e orçamento de nuvem.',
      motivos: ['Estruturou trilha de carreira', 'Reduziu custo de nuvem com número comprovado'], lacunas: ['Gestão de orçamento acima de R$ 1 mi'],
      requisitos: [req('Liderança de liderança', 'parcial'), req('Orçamento de engenharia', 'nao_atende'), req('Edtech', 'parcial', 'desejavel')],
      empresa_avaliacao: av(4.6, 98, 'Poucas avaliações, todas recentes e positivas sobre propósito.') },
    { id: 'nimbo-006', empresa: 'Nimbo Cloud', cargo: 'Engineering Manager — SRE', aderencia: 'boa', modalidade: 'remoto', local: 'América Latina', regime: 'PJ', salario: 'US$ 7.000', portal_candidatura: 'ashby', url_status: 'aberta', consultado_em: '2026-10-16', vista_ha: '2 d',
      descricao: 'Time de 8 SREs, plantão em escala, Kubernetes multi-região e redução de custo.',
      motivos: ['Experiência com plantão e SLOs', 'Kubernetes em produção'], lacunas: ['Plantão como gestor de incidentes maiores'],
      requisitos: [req('Kubernetes', 'atende'), req('Gestão de incidentes', 'parcial'), req('Terraform', 'atende')],
      empresa_avaliacao: av(4.2, 233, 'Remuneração bem avaliada; carga de plantão é a principal crítica.') , cvs: { bloqueio: { motivos: ['Número de redução de custo sem evidência ligada (AF-014)'] } } },
    { id: 'grao-007', empresa: 'Grão Agrotech', cargo: 'Tech Lead Dados', aderencia: 'condicional', modalidade: 'híbrido', local: 'Campinas, SP', regime: 'CLT', salario: 'R$ 19.000', portal_candidatura: 'gupy', url_status: 'aberta', consultado_em: '2026-10-15', vista_ha: '3 d',
      descricao: 'Pipeline de dados de sensores de campo, modelagem e time de 5 pessoas.',
      motivos: ['Liderança técnica', 'Pipelines de dados em nuvem'], lacunas: [], condicoes: { situacao: 'condicional', motivos: ['Híbrido fora da região preferida (3x por semana)'] },
      requisitos: [req('Engenharia de dados', 'parcial'), req('Liderança técnica', 'atende')],
      perfil_gupy: { campos: 4, resumo: 'Trocar título do perfil e incluir projeto de dados de 2024.' },
      empresa_avaliacao: av(3.8, 140, 'Ambiente descrito como colaborativo, com processos ainda informais.') },
    { id: 'mapa-008', empresa: 'Mapa Mobilidade', cargo: 'Coordenador de Desenvolvimento', aderencia: 'condicional', modalidade: 'presencial', local: 'Belo Horizonte, MG', regime: 'CLT', salario: 'R$ 17.500', portal_candidatura: 'gupy', url_status: 'aberta', consultado_em: '2026-10-15', vista_ha: '3 d',
      descricao: 'Coordenação de 3 times de app e backoffice.', motivos: ['Gestão de times de produto digital'], lacunas: [],
      condicoes: { situacao: 'condicional', motivos: ['Presencial em outra cidade', 'Salário perto do piso'] }, requisitos: [req('Gestão de times', 'atende'), req('Mobile', 'parcial')],
      empresa_avaliacao: null },
    { id: 'selo-009', empresa: 'Selo Bank', cargo: 'Engineering Manager — Crédito', aderencia: 'alta', modalidade: 'remoto', local: 'Brasil', regime: 'CLT', salario: 'R$ 25.000', portal_candidatura: 'greenhouse', url_status: 'aberta', consultado_em: '2026-10-12', vista_ha: '6 d',
      candidatura_usuario: { aplicada: true, data: '2026-10-08' },
      descricao: 'Times de análise de crédito e cobrança.', motivos: ['Produto financeiro', 'Gestão de times'], lacunas: [], requisitos: [req('Gestão de times', 'atende')],
      empresa_avaliacao: av(4.0, 702, 'Boa avaliação de gestão direta.') },
    { id: 'quanta-010', empresa: 'Quanta Dados', cargo: 'Tech Lead Plataforma', aderencia: 'boa', modalidade: 'remoto', local: 'Brasil', regime: 'CLT', salario: 'R$ 21.000', portal_candidatura: 'lever', url_status: 'aberta', consultado_em: '2026-10-11', vista_ha: '1 sem',
      candidatura_usuario: { aplicada: true, data: '2026-10-10' },
      descricao: 'Plataforma interna de deploy e observabilidade.', motivos: ['Observabilidade', 'CI/CD'], lacunas: [], requisitos: [req('CI/CD', 'atende')],
      empresa_avaliacao: av(4.3, 310, 'Elogios a autonomia técnica.') },
    { id: 'casa-011', empresa: 'Casa Pátio', cargo: 'Desenvolvedor Backend Pleno', aderencia: 'baixa', modalidade: 'remoto', local: 'Brasil', regime: 'CLT', salario: 'R$ 11.000', portal_candidatura: 'gupy', url_status: 'aberta', consultado_em: '2026-10-17', vista_ha: '1 d',
      descricao: 'Vaga individual de backend para e-commerce.', motivos: ['Stack conhecida'], lacunas: ['Senioridade abaixo da sua'], condicoes: { situacao: 'abaixo_piso', motivos: ['Salário abaixo do piso'] },
      requisitos: [req('Node.js', 'atende')], perfil_gupy: { campos: 2, resumo: 'Nenhuma mudança relevante.' }, empresa_avaliacao: av(3.4, 88, 'Opiniões divididas sobre liderança.') },
    { id: 'faro-012', empresa: 'Faro Jurídico', cargo: 'Analista de Sistemas Sênior', aderencia: 'baixa', modalidade: 'híbrido', local: 'Rio de Janeiro, RJ', regime: 'CLT', salario: null, portal_candidatura: 'solides', url_status: 'aberta', consultado_em: '2026-10-16', vista_ha: '2 d',
      descricao: 'Sustentação de sistemas internos.', motivos: [], lacunas: ['Escopo sem liderança'], requisitos: [req('Sustentação', 'parcial')], empresa_avaliacao: null },
    { id: 'brisa-013', empresa: 'Brisa Telecom', cargo: 'Gerente de TI — Infraestrutura', aderencia: 'incompativel', modalidade: 'presencial', local: 'Recife, PE', regime: 'CLT', salario: 'R$ 16.000', portal_candidatura: 'gupy', url_status: 'aberta', consultado_em: '2026-10-17', vista_ha: '1 d',
      descricao: 'Infraestrutura on-premises e contratos de telecom.', motivos: [], lacunas: ['Exige mudança de cidade', 'Foco em infraestrutura física'],
      condicoes: { situacao: 'incompativel', motivos: ['Presencial obrigatório fora da região'] }, requisitos: [req('Data center', 'nao_atende')], empresa_avaliacao: av(3.1, 450, 'Críticas a hierarquia rígida.') },
    { id: 'aurora-014', empresa: 'Aurora Energia', cargo: 'Arquiteto de Soluções', aderencia: 'boa', modalidade: 'remoto', local: 'Brasil', regime: 'PJ', salario: 'R$ 23.000', portal_candidatura: 'inhire', url_status: 'aberta', consultado_em: '2026-10-14', vista_ha: '4 d',
      descricao: 'Arquitetura de integração entre sistemas de medição e faturamento.', motivos: ['Integrações e mensageria', 'Documentação de arquitetura'], lacunas: ['Setor elétrico'],
      requisitos: [req('Integração de sistemas', 'atende'), req('Setor elétrico', 'nao_atende', 'desejavel')], empresa_avaliacao: av(4.0, 51, 'Poucas avaliações.') },
    { id: 'viva-015', empresa: 'Rede Clínica Viva', cargo: 'Tech Manager', aderencia: 'alta', modalidade: 'remoto', local: 'Brasil', regime: 'CLT', salario: 'R$ 23.500', portal_candidatura: 'solides', url_status: 'aberta', consultado_em: '2026-10-13', vista_ha: '5 d', descarte_usuario: { descartada: true },
      descricao: 'Gestão de times de agendamento e teleconsulta.', motivos: ['Saúde digital'], lacunas: [], requisitos: [req('Gestão de times', 'atende')], empresa_avaliacao: av(2.9, 610, 'Alta rotatividade citada em muitas avaliações.') },
    { id: 'ferro-016', empresa: 'Ferro & Cia Varejo', cargo: 'Líder de Engenharia — E-commerce', aderencia: 'boa', modalidade: 'híbrido', local: 'São Paulo, SP (1x por semana)', regime: 'CLT', salario: 'R$ 20.000 a R$ 24.000', portal_candidatura: 'greenhouse', url_status: 'aberta', consultado_em: '2026-10-18', vista_ha: '3 h',
      descricao: 'Checkout e catálogo, alta sazonalidade em datas de varejo.', motivos: ['Sistemas com pico de tráfego', 'Gestão de 2 times'], lacunas: [],
      requisitos: [req('Escala e desempenho', 'atende'), req('Varejo', 'parcial', 'desejavel')], empresa_avaliacao: av(3.7, 1980, 'Boa estabilidade; críticas a ferramentas internas.') },
  ];
  for (const v of vagas) if (!v.cvs && v.portal_candidatura !== 'gupy' && ['alta', 'boa'].includes(v.aderencia)) v.cvs = cv(v.id.padEnd(8, '0') + 'a1b2c3d4');

  const contatos = [
    { id: 'ct-1', vaga_id: 'selo-009', nome: 'Marina Teixeira', papel: 'Recrutadora', canal: 'email', endereco: 'marina@selo.exemplo.test', ultimo_contato: '2026-10-11' },
    { id: 'ct-2', vaga_id: 'quanta-010', nome: 'Rafael Moura', papel: 'Talent partner', canal: 'linkedin', endereco: 'linkedin.exemplo.test/in/rafael-moura', ultimo_contato: '2026-10-12' },
    { id: 'ct-3', vaga_id: 'lumen-001', nome: 'Beatriz Lins', papel: 'Recrutadora técnica', canal: 'whatsapp', endereco: 'WhatsApp (número salvo só no seu computador)', ultimo_contato: '2026-10-16' },
    { id: 'ct-4', vaga_id: 'orbe-003', nome: 'Caio Nunes', papel: 'Gestor da vaga', canal: 'email', endereco: 'caio@orbe.exemplo.test', ultimo_contato: '2026-10-14' },
    { id: 'ct-5', vaga_id: 'vetor-004', nome: 'Paula Rezende', papel: 'Recrutadora', canal: 'linkedin', endereco: 'linkedin.exemplo.test/in/paula-rezende', ultimo_contato: '2026-10-03' },
  ];

  const processos = [
    { id: 'pr-1', vaga_id: 'selo-009', empresa: 'Selo Bank', cargo: 'Engineering Manager — Crédito', etapa: 'aguardando', ultima_interacao: '2026-10-11', proxima_etapa: null,
      eventos: [{ data: '2026-10-08', canal: 'portal', origem: 'manual', resumo: 'Candidatura enviada pelo Greenhouse.' }, { data: '2026-10-11', canal: 'email', origem: 'gmail', resumo: 'Marina confirmou recebimento e disse que retorna em uma semana.' }] },
    { id: 'pr-2', vaga_id: 'quanta-010', empresa: 'Quanta Dados', cargo: 'Tech Lead Plataforma', etapa: 'em_conversa', ultima_interacao: '2026-10-12', proxima_etapa: null,
      eventos: [{ data: '2026-10-10', canal: 'portal', origem: 'manual', resumo: 'Candidatura enviada.' }, { data: '2026-10-12', canal: 'linkedin', origem: 'manual', resumo: 'Rafael pediu pretensão salarial e disponibilidade.' }] },
    { id: 'pr-3', vaga_id: 'lumen-001', empresa: 'Lumen Pagamentos', cargo: 'Engineering Manager — Plataforma de Pagamentos', etapa: 'entrevista', ultima_interacao: '2026-10-16', proxima_etapa: { tipo: 'Entrevista técnica', data: '2026-10-21 14:00' },
      eventos: [{ data: '2026-10-14', canal: 'whatsapp', origem: 'manual', resumo: 'Beatriz fez contato e marcou conversa inicial.' }, { data: '2026-10-16', canal: 'email', origem: 'gmail', resumo: 'Convite para entrevista técnica em 21/10, 14h.' }] },
    { id: 'pr-4', vaga_id: 'orbe-003', empresa: 'Orbe Saúde', cargo: 'Gerente de Engenharia — Produtos Clínicos', etapa: 'em_conversa', ultima_interacao: '2026-10-14', proxima_etapa: { tipo: 'Conversa com gestor', data: 'a combinar' },
      eventos: [{ data: '2026-10-14', canal: 'email', origem: 'gmail', resumo: 'Caio pediu horários para conversa com o gestor.' }] },
    { id: 'pr-5', vaga_id: 'vetor-004', empresa: 'Vetor Seguros', cargo: 'Staff Engineer — Arquitetura', etapa: 'devolutiva', ultima_interacao: '2026-10-03', proxima_etapa: null, devolutiva: 'negativa',
      eventos: [{ data: '2026-09-29', canal: 'portal', origem: 'manual', resumo: 'Candidatura enviada.' }, { data: '2026-10-03', canal: 'email', origem: 'gmail', resumo: 'Retorno negativo: seguiram com perfil com .NET recente.' }] },
  ];

  const historico = [
    { vaga_id: 'selo-009', empresa: 'Selo Bank', cargo: 'Engineering Manager — Crédito', data: '2026-10-08', via: 'Greenhouse', situacao: 'Aguardando retorno' },
    { vaga_id: 'quanta-010', empresa: 'Quanta Dados', cargo: 'Tech Lead Plataforma', data: '2026-10-10', via: 'Lever', situacao: 'Em conversa' },
    { vaga_id: 'lumen-001', empresa: 'Lumen Pagamentos', cargo: 'Engineering Manager — Plataforma de Pagamentos', data: '2026-10-13', via: 'Greenhouse', situacao: 'Entrevista marcada' },
    { vaga_id: 'orbe-003', empresa: 'Orbe Saúde', cargo: 'Gerente de Engenharia — Produtos Clínicos', data: '2026-10-12', via: 'Lever', situacao: 'Em conversa' },
    { vaga_id: 'vetor-004', empresa: 'Vetor Seguros', cargo: 'Staff Engineer — Arquitetura', data: '2026-09-29', via: 'Greenhouse', situacao: 'Não avançou' },
    { vaga_id: 'antiga-1', empresa: 'Delta Fretes', cargo: 'Tech Lead', data: '2026-08-20', via: 'Gupy', situacao: 'Vaga encerrada' },
    { vaga_id: 'antiga-2', empresa: 'Cais Digital', cargo: 'Engineering Manager', data: '2026-08-02', via: 'Sólides', situacao: 'Não avançou' },
  ];

  // /api/analise-curriculo — as quatro situações: CV × dado que sustenta.
  const analise = {
    confere: [
      { id: 'c1', texto: 'Liderei a migração do monólito de pedidos para eventos, reduzindo o tempo de deploy de 2 dias para 3 horas.', afirmacoes: ['AF-003'], evidencias: ['EV-002'], nivel_prova: 'verificado' },
      { id: 'c2', texto: 'Gestão de 12 pessoas em dois times de produto financeiro.', afirmacoes: ['AF-001'], evidencias: ['EV-001'], nivel_prova: 'verificado' },
      { id: 'c3', texto: 'Estruturei trilha de carreira de engenharia com 4 níveis.', afirmacoes: ['AF-007'], evidencias: ['EV-005'], nivel_prova: 'entregue' },
    ],
    fora_do_cv: [
      { id: 'f1', texto: 'Reduziu em 31% o custo mensal de nuvem em 2024.', afirmacoes: ['AF-014'], evidencias: ['EV-009'], nivel_prova: 'verificado', motivo: 'Tem prova e aparece em 5 vagas do radar.' },
      { id: 'f2', texto: 'Palestra sobre observabilidade em evento regional.', afirmacoes: ['AF-019'], evidencias: ['EV-012'], nivel_prova: 'entregue', motivo: 'Reforça vagas de plataforma.' },
    ],
    sem_prova: [
      { id: 's1', texto: 'Responsável pela melhoria de desempenho da API principal.', afirmacoes: [], motivo: 'Sem número nem afirmação ligada.', pergunta: 'Qual foi o ganho (tempo de resposta, custo ou erros) e em que período?' },
      { id: 's2', texto: 'Atuação na redução de incidentes em produção.', afirmacoes: ['AF-011'], motivo: 'Afirmação só com relato, sem linha de base.', pergunta: 'Quantos incidentes por mês antes e depois?' },
    ],
    lacunas: [
      { id: 'l1', texto: 'Orçamento de engenharia', peso: 5, motivo: 'Pedido em 4 vagas boas do radar.', pergunta: 'Você já respondeu por orçamento de time ou de nuvem? Qual valor aproximado?' },
      { id: 'l2', texto: '.NET em produção recente', peso: 3, motivo: 'Motivo da devolutiva negativa da Vetor Seguros.', pergunta: 'Usou .NET nos últimos 3 anos? Em que projeto?' },
      { id: 'l3', texto: 'Linha do tempo: jan–jun 2021', peso: 2, motivo: 'Buraco no histórico.', pergunta: 'O que você fez nesse período?' },
    ],
  };

  // /api/perguntas de hoje (banco de respostas de formulário), que a skill aplicar usa.
  const respostas = [
    { id: 'p1', label: 'Pretensão salarial (CLT, mensal)', tipo: 'texto', vagas: ['Trilha Logística', 'Grão Agrotech'], sugestao: '' },
    { id: 'p2', label: 'Você tem disponibilidade para viagens?', tipo: 'sim_nao', vagas: ['Orbe Saúde'], sugestao: '' },
    { id: 'p3', label: 'Conte um projeto em que você liderou uma mudança de arquitetura.', tipo: 'texto_longo', vagas: ['Vetor Seguros', 'Aurora Energia'], sugestao: 'Liderei a migração do monólito de pedidos para eventos (AF-003), reduzindo o deploy de 2 dias para 3 horas.' },
  ];

  const perfil = { nome: 'Ana Exemplo', especialidade: 'Liderança de engenharia', regiao: 'São Paulo e remoto' };
  const radar = { atualizado: '2026-10-18 07:12', fontes: [{ fonte: 'Gupy', resultados: 41 }, { fonte: 'Sólides', resultados: 12 }, { fonte: 'Freehire', resultados: 9 }, { fonte: 'InHire', resultados: 4 }], na_fila: 7 };
  return { hoje, perfil, radar, vagas, contatos, processos, historico, analise, respostas };
})();
