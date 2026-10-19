// core/interview/preparation.mjs
// Lógica pura de preparação para entrevista de emprego (F9.6).
// Desacoplada de I/O de rede e determinística.

import { localDay } from '../store/schema.mjs';
import { gravarProposta, slug } from '../kb/outbox.mjs';
import path from 'node:path';

// Divide a história do story-bank em Situação, Tarefa, Ação e Resultado. A parte que a história não traz fica null:
// a preparação é o que a pessoa vai dizer na entrevista, então nada é preenchido com texto pronto.
function extrairStar(texto) {
  const vazio = { situacao: null, tarefa: null, acao: null, resultado: null };
  if (!texto || typeof texto !== 'string' || !texto.trim()) return vazio;

  // Cabeçalho só no começo da linha ("## Ação" ou "Ação:"), para não casar "ação" dentro de "Situação" ou "migração".
  const ROTULOS = 'Situa[çc][ãa]o|Tarefa|A[çc][ãa]o|Resultado';
  const secao = rotulo => new RegExp(`(?:^|\\n)[ \\t]*(?:##[ \\t]*${rotulo}[ \\t]*:?|${rotulo}[ \\t]*:)[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*(?:##[ \\t]*(?:${ROTULOS})|(?:${ROTULOS})[ \\t]*:)|$)`, 'i').exec(texto)?.[1]?.trim() || null;
  const comCabecalho = { situacao: secao('Situa[çc][ãa]o'), tarefa: secao('Tarefa'), acao: secao('A[çc][ãa]o'), resultado: secao('Resultado') };
  if (Object.values(comCabecalho).some(Boolean)) return comCabecalho;

  // Sem cabeçalhos: quatro parágrafos (ou, sem linha em branco, quatro linhas) ou mais viram as quatro partes, com o texto
  // da própria história; menos que isso, o texto inteiro é a situação.
  let paragrafos = texto.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragrafos.length < 4) {
    const linhas = texto.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (linhas.length >= 4) paragrafos = linhas;
  }
  if (paragrafos.length >= 4) {
    return { situacao: paragrafos[0], tarefa: paragrafos[1], acao: paragrafos[2], resultado: paragrafos.slice(3).join('\n\n') };
  }
  return { ...vazio, situacao: texto.trim() };
}
export function gerarPreparacaoEntrevista({
  vaga,
  avaliacao,
  base = {},
  now = new Date().toISOString(),
}) {
  const vagaObj = vaga || {};
  const dataHoje = localDay(now);

  const vagaId = vagaObj.id || 'vaga-desconhecida';
  const cargo = vagaObj.cargo ?? vagaObj.vaga?.cargo ?? 'Cargo não especificado';
  const empresa = vagaObj.empresa ?? vagaObj.vaga?.empresa ?? 'Empresa não especificada';
  const aderencia = vagaObj.aderencia ?? avaliacao?.aderencia ?? 'não avaliada';

  const claims = base.claims ?? [];
  const evidence = base.evidence ?? [];
  const historias = base.historias ?? [];

  const claimsMap = new Map(claims.map(c => [c.id, c]));

  // Mapa de evidências por ID de afirmação
  const evidenciasPorClaim = new Map();
  for (const ev of evidence) {
    for (const afId of ev.afirmacoes ?? []) {
      if (!evidenciasPorClaim.has(afId)) evidenciasPorClaim.set(afId, []);
      evidenciasPorClaim.get(afId).push({
        id: ev.id,
        fonte: ev.fonte ?? 'documento',
        texto: ev.texto ?? '',
      });
    }
  }

  const requisitosOriginais = (avaliacao?.requisitos ?? vagaObj.requisitos ?? [])
    .filter(r => r && typeof r === 'object');

  const pontosFortes = [];
  const pontosFracosOuLacunas = [];

  for (const req of requisitosOriginais) {
    const nomeReq = (typeof req.requisito === 'string' && req.requisito.trim()) ? req.requisito.trim() : 'Requisito técnico';
    const tipo = req.tipo ?? 'obrigatorio';
    const statusAv = req.avaliacao ?? 'nao_avaliado'; // sem avaliação não é prova de nada
    const naoVerificado = Boolean(req.nao_verificado);

    const claimIds = Array.isArray(req.afirmacoes) ? req.afirmacoes : [];
    const claimsValidas = claimIds.map(id => claimsMap.get(id)).filter(Boolean);

    // Afirmações com prova factual consolidada
    const claimsComProva = claimsValidas.filter(
      c => c.nivel_prova === 'verificado' || c.nivel_prova === 'entregue'
    );

    const isAtendido = (statusAv === 'atendido') && !naoVerificado;

    if (isAtendido && claimsComProva.length > 0) {
      // Ponto forte comprovado
      const afirmacoesFormatadas = claimsComProva.map(c => ({
        id: c.id,
        texto: c.texto,
        nivel_prova: c.nivel_prova,
        empresa: c.empresa ?? null,
        periodo: c.periodo ?? null,
        evidencias: evidenciasPorClaim.get(c.id) ?? [],
      }));

      const empresaContexto = claimsComProva[0].empresa ? `na ${claimsComProva[0].empresa}` : 'em projetos anteriores';
      const orientacao = `Destaque a entrega factual realizada ${empresaContexto}. Conecte os resultados práticos obtidos diretamente à demanda de "${nomeReq}".`;

      pontosFortes.push({
        requisito: nomeReq,
        tipo,
        afirmacoes: afirmacoesFormatadas,
        orientacao_resposta: orientacao,
      });
    } else {
      // Ponto fraco, lacuna ou requisito rebaixado por falta de prova
      const statusFinal = ['parcial', 'nao_avaliado'].includes(statusAv) ? statusAv : 'lacuna';
      const afirmacoesRelacionadas = claimsValidas.map(c => ({
        id: c.id,
        texto: c.texto,
        nivel_prova: c.nivel_prova ?? 'não classificado',
      }));

      let estrategiaDefesa = '';
      if (statusFinal === 'lacuna') {
        estrategiaDefesa = `Diga com transparência que não tem vivência prática comprovada em "${nomeReq}". Se houver experiência próxima na sua base, cite-a pelo que ela é; senão, explique como aprenderia.`;
      } else {
        estrategiaDefesa = `Destacar a sólida base conceitual já adquirida em "${nomeReq}", diferenciando-a claramente de vivência em grandes arquiteturas de escala produtiva.`;
      }

      pontosFracosOuLacunas.push({
        requisito: nomeReq,
        tipo,
        status_avaliacao: statusFinal,
        afirmacoes_relacionadas: afirmacoesRelacionadas,
        estrategia_defesa: estrategiaDefesa,
        postura_recomendada: 'Transparência total e humildade técnica. Jamais blefar ou inventar experiência prática inexistente.',
      });
    }
  }

  // 3. Perguntas Prováveis & Histórias STAR
  const perguntasStar = [];
  const historiasUsadas = new Set();

  // 3.1 Match de histórias vinculadas aos requisitos
  for (const req of requisitosOriginais) {
    const nomeReq = (typeof req.requisito === 'string' && req.requisito.trim()) ? req.requisito.trim() : 'Requisito técnico';
    const reqClaimIds = new Set(Array.isArray(req.afirmacoes) ? req.afirmacoes : []);

    for (const h of historias) {
      if (historiasUsadas.has(h.id)) continue;
      const hClaimIds = h.afirmacoes ?? [];
      const match = hClaimIds.some(id => reqClaimIds.has(id));

      if (match) {
        historiasUsadas.add(h.id);
        const star = extrairStar(h.texto);
        const categoria = /lideran|gest|equipe|conflito/i.test(nomeReq)
          ? 'lideranca'
          : /arquitet/i.test(nomeReq)
          ? 'arquitetura'
          : 'tecnica';

        perguntasStar.push({
          id: `star-${h.id}`,
          pergunta: `Conte sobre uma situação em que você precisou lidar com ${nomeReq}.`,
          categoria,
          requisito_associado: nomeReq,
          historia_id: h.id,
          historia_titulo: h.titulo ?? 'Experiência relevante',
          star,
          afirmacoes_referenciadas: hClaimIds,
          dica_articulacao: 'Articule a resposta de 2 a 3 minutos enfatizando o desafio inicial, o seu papel específico e as métricas concretas do resultado.',
        });
        break; // uma história prioritária por requisito
      }
    }
  }

  // 3.2 Histórias não associadas viram perguntas comportamentais / transversais
  for (const h of historias) {
    if (historiasUsadas.has(h.id)) continue;
    historiasUsadas.add(h.id);
    const star = extrairStar(h.texto);
    const categoria = /conflito|impasse|diverg/i.test(h.titulo || h.texto)
      ? 'comportamental'
      : /lider|mentoria/i.test(h.titulo || h.texto)
      ? 'lideranca'
      : 'tecnica';

    perguntasStar.push({
      id: `star-${h.id}`,
      pergunta: h.titulo ? `Como você conduziu: "${h.titulo}"?` : 'Conte sobre um desafio técnico complexo que você solucionou em equipe.',
      categoria,
      requisito_associado: null,
      historia_id: h.id,
      historia_titulo: h.titulo ?? 'História de repertório',
      star,
      afirmacoes_referenciadas: h.afirmacoes ?? [],
      dica_articulacao: 'Foque na maturidade de comunicação, escuta ativa e pragmatismo na tomada de decisão.',
    });
  }

  // 4. O que NÃO alegar
  const oQueNaoAlegar = [];
  const jaVisto = new Set();

  function adicionarBloqueio(topico, motivo_bloqueio, detalhe, recomendacao_humana) {
    const chave = `${topico}::${motivo_bloqueio}`;
    if (jaVisto.has(chave)) return;
    jaVisto.add(chave);
    oQueNaoAlegar.push({
      topico,
      motivo_bloqueio,
      detalhe,
      recomendacao_humana,
    });
  }

  // 4.1 Afirmações em nível de relato ou proposta
  for (const c of claims) {
    if (c.nivel_prova === 'relato') {
      adicionarBloqueio(
        `[${c.id}] ${c.texto.slice(0, 75)}...`,
        'afirmacao_relato',
        'Afirmação em nível de relato sem evidência documental associada na base.',
        'Use apenas como contexto qualitativo secundário; não fundamente promessas técnicas nessa alegação.'
      );
    } else if (c.nivel_prova === 'proposta' || c.nivel_prova === 'proposto') {
      adicionarBloqueio(
        `[${c.id}] ${c.texto.slice(0, 75)}...`,
        'sem_prova_documental',
        'Afirmação em nível de proposta sem comprovação factual concluída.',
        'Não alegue esta capacidade como competência consolidada.'
      );
    }

    // 4.2 Itens com publicavel: 'nao'
    if (c.publicavel === 'nao' || c.publicavel === false) {
      adicionarBloqueio(
        `[${c.id}] ${c.texto.slice(0, 75)}...`,
        'nao_publicavel',
        'Afirmação marcada com sigilo ou restrição de divulgação (publicavel: não).',
        'Não mencione este contexto específico em entrevistas externas.'
      );
    }

    // 4.3 Termos em anonimizar
    if (Array.isArray(c.anonimizar) && c.anonimizar.length > 0) {
      adicionarBloqueio(
        `Termos confidenciais: ${c.anonimizar.join(', ')}`,
        'termo_anonimizar',
        `Afirmação ${c.id} possui termos sujeitos a sigilo contratual ou anonimização.`,
        `Nunca mencione os nomes restritos [${c.anonimizar.join(', ')}]; refira-se genericamente como cliente ou setor análogo.`
      );
    }
  }

  // 4.4 Lacunas críticas obrigatórias da oportunidade
  for (const lac of pontosFracosOuLacunas) {
    if (lac.tipo === 'obrigatorio') {
      adicionarBloqueio(
        lac.requisito,
        'lacuna_critica',
        'Requisito obrigatório identificado como lacuna técnica na avaliação da vaga.',
        'Nunca afirme que domina esta tecnologia em produção; admita a lacuna com transparência e destaque sua agilidade de aprendizado.'
      );
    }
  }

  const resumoEstrategico = `Vaga com aderência ${aderencia}. O foco da entrevista deve ser a sustentação factual dos ${pontosFortes.length} pontos fortes comprovados, mantendo postura de humildade e clareza de curva de aprendizado nas ${pontosFracosOuLacunas.length} lacunas identificadas.`;

  return {
    vaga_id: vagaId,
    cargo,
    empresa,
    aderencia,
    data: dataHoje,
    contadores: {
      pontos_fortes: pontosFortes.length,
      pontos_fracos_e_lacunas: pontosFracosOuLacunas.length,
      perguntas_star: perguntasStar.length,
      itens_nao_alegar: oQueNaoAlegar.length,
    },
    pontos_fortes: pontosFortes,
    pontos_fracos_e_lacunas: pontosFracosOuLacunas,
    perguntas_star: perguntasStar,
    o_que_nao_alegar: oQueNaoAlegar,
    resumo_estrategico: resumoEstrategico,
  };
}

export function formatarPreparacaoMarkdown(prep) {
  const linhas = [];

  linhas.push(`# Preparação para Entrevista: ${prep.cargo} na ${prep.empresa}`);
  linhas.push('');
  linhas.push(`- **Vaga ID:** \`${prep.vaga_id}\``);
  linhas.push(`- **Data de Geração:** \`${prep.data}\``);
  linhas.push(`- **Aderência Global:** \`${prep.aderencia}\``);
  linhas.push(`- **Pontos Fortes com Prova:** ${prep.contadores.pontos_fortes}`);
  linhas.push(`- **Lacunas / Pontos Fracos:** ${prep.contadores.pontos_fracos_e_lacunas}`);
  linhas.push(`- **Histórias STAR Prontas:** ${prep.contadores.perguntas_star}`);
  linhas.push('');
  linhas.push('---');
  linhas.push('');

  // 1. Pontos Fortes
  linhas.push('## 1. Pontos Fortes (Comprovações Fatuais)');
  linhas.push('');
  if (prep.pontos_fortes.length === 0) {
    linhas.push('Nenhum ponto forte com comprovação factual na base para esta oportunidade.');
    linhas.push('');
  } else {
    prep.pontos_fortes.forEach((pf, i) => {
      linhas.push(`### 1.${i + 1} ${pf.requisito} [${pf.tipo}]`);
      linhas.push('- **Afirmações de Sustentação:**');
      for (const af of pf.afirmacoes) {
        const emp = af.empresa ? ` (Empresa: ${af.empresa}${af.periodo ? `, Período: ${af.periodo}` : ''})` : '';
        linhas.push(`  - \`[${af.id}]\` (${af.nivel_prova}) ${af.texto}${emp}`);
        for (const ev of af.evidencias) {
          linhas.push(`    - *Evidência:* \`${ev.id}\` (${ev.fonte})`);
        }
      }
      linhas.push(`- **Orientação de Resposta:** ${pf.orientacao_resposta}`);
      linhas.push('');
    });
  }

  linhas.push('---');
  linhas.push('');

  // 2. Pontos Fracos e Lacunas
  linhas.push('## 2. Pontos Fracos e Lacunas (Plano de Contingência)');
  linhas.push('');
  if (prep.pontos_fracos_e_lacunas.length === 0) {
    linhas.push('Nenhuma lacuna técnica identificada para esta oportunidade.');
    linhas.push('');
  } else {
    prep.pontos_fracos_e_lacunas.forEach((pfl, i) => {
      linhas.push(`### 2.${i + 1} ${pfl.requisito} [${pfl.tipo}] — Status: ${pfl.status_avaliacao}`);
      linhas.push('- **Diagnóstico:** Requisito não comprovado documentalmente na base.');
      linhas.push(`- **Estratégia de Defesa:** ${pfl.estrategia_defesa}`);
      linhas.push(`- **Postura Recomendada:** ${pfl.postura_recomendada}`);
      linhas.push('');
    });
  }

  linhas.push('---');
  linhas.push('');

  // 3. Perguntas Prováveis & Histórias STAR
  linhas.push('## 3. Perguntas Prováveis & Histórias STAR');
  linhas.push('');
  if (prep.perguntas_star.length === 0) {
    linhas.push('Nenhuma pergunta STAR mapeada.');
    linhas.push('');
  } else {
    prep.perguntas_star.forEach((star, i) => {
      linhas.push(`### 3.${i + 1} "${star.pergunta}"`);
      const reqTxt = star.requisito_associado ? ` | **Requisito Associado:** ${star.requisito_associado}` : '';
      linhas.push(`- **Categoria:** ${star.categoria}${reqTxt}`);
      if (star.historia_id) {
        linhas.push(`- **História de Referência:** \`${star.historia_id}\` — *${star.historia_titulo}*`);
      }
      linhas.push('- **Estrutura STAR:**');
      const parte = valor => valor ?? '_não está na história registrada; complete antes da entrevista_';
      linhas.push(`  - **S (Situação):** ${parte(star.star.situacao)}`);
      linhas.push(`  - **T (Tarefa):** ${parte(star.star.tarefa)}`);
      linhas.push(`  - **A (Ação):** ${parte(star.star.acao)}`);
      linhas.push(`  - **R (Resultado):** ${parte(star.star.resultado)}`);
      linhas.push(`- **Dica de Articulação:** ${star.dica_articulacao}`);
      linhas.push('');
    });
  }

  linhas.push('---');
  linhas.push('');

  // 4. O que NÃO alegar
  linhas.push('## 4. O que NÃO alegar (Limites de Credibilidade)');
  linhas.push('');
  if (prep.o_que_nao_alegar.length === 0) {
    linhas.push('Nenhum bloqueio ou alerta específico para esta vaga.');
    linhas.push('');
  } else {
    linhas.push('| Tópico | Motivo | Recomendação de Postura |');
    linhas.push('| :--- | :--- | :--- |');
    for (const item of prep.o_que_nao_alegar) {
      const topicoEsc = item.topico.replaceAll('|', '\\|').replaceAll('\n', ' ');
      const motivoEsc = item.motivo_bloqueio;
      const recEsc = item.recomendacao_humana.replaceAll('|', '\\|').replaceAll('\n', ' ');
      linhas.push(`| **${topicoEsc}** | \`${motivoEsc}\` | ${recEsc} |`);
    }
    linhas.push('');
  }

  linhas.push('---');
  linhas.push(`*Dossiê gerado pelo CareerBounty em ${prep.data}. Fatos sustentados por evidências; zero conjectura.*`);
  linhas.push('');

  return linhas.join('\n');
}

export function gerarRoteiroSimulacao({ preparacao, vaga }) {
  const cargo = preparacao.cargo;
  const empresa = preparacao.empresa;

  const linhas = [];
  linhas.push(`# Simulação de Entrevista: ${cargo} na ${empresa}`);
  linhas.push('');
  linhas.push('> Copie o bloco de instruções abaixo e inicie uma conversa com o assistente Claude para simular a entrevista.');
  linhas.push('');
  linhas.push('## Instruções para o Claude (System Prompt)');
  linhas.push('');
  linhas.push('```markdown');
  linhas.push(`Você é o entrevistador técnico sênior da empresa "${empresa}".`);
  linhas.push(`Você está conduzindo uma entrevista técnica para a posição de "${cargo}".`);
  linhas.push('Seu objetivo é avaliar a solidez técnica, a capacidade de comunicação estruturada no padrão STAR (Situação, Tarefa, Ação e Resultado) e a humildade/honestidade técnica do candidato.');
  linhas.push('Regras de condução:');
  linhas.push('1. Faça UMA pergunta por vez e aguarde a resposta do candidato.');
  linhas.push('2. Avalie se a resposta foi direta, sem prolixidade e sustentada por fatos concretos.');
  linhas.push('3. Ao final de cada resposta, dê um breve feedback (1 a 2 linhas) apontando pontos fortes e pontos de melhoria, antes de avançar para a próxima rodada.');
  linhas.push('```');
  linhas.push('');
  linhas.push('## Rodadas da Simulação');
  linhas.push('');

  linhas.push('### Rodada 1: Quebra-Gelo e Trajetória');
  linhas.push(`- **Objetivo:** Avaliar síntese profissional conectada aos requisitos centrais da vaga de ${cargo}.`);
  linhas.push('- **Pergunta Típica:** "Pode resumir brevemente sua trajetória profissional e o que mais chamou sua atenção no desafio da nossa vaga?"');
  linhas.push('');

  linhas.push('### Rodada 2: Desafio Técnico Profundo');
  const pTecnica = preparacao.perguntas_star.find(p => p.categoria === 'tecnica' || p.categoria === 'arquitetura')
    ?? preparacao.pontos_fortes[0];
  const perguntaTec = pTecnica?.pergunta ?? (pTecnica?.requisito ? `Como você projeta e entrega soluções envolvendo ${pTecnica.requisito}?` : 'Conte sobre um desafio técnico complexo que você solucionou.');
  linhas.push('- **Objetivo:** Avaliar profundidade arquitetural e métricas de impacto real.');
  linhas.push(`- **Pergunta Típica:** "${perguntaTec}"`);
  linhas.push('');

  linhas.push('### Rodada 3: Pergunta de Lacuna / Honestidade');
  const lacuna = preparacao.pontos_fracos_e_lacunas[0];
  const perguntaLacuna = lacuna
    ? `Qual é o seu nível de experiência com "${lacuna.requisito}" em cenários de alta criticidade?`
    : 'Qual tecnologia exigida na vaga você considera seu maior desafio técnico de adaptação?';
  linhas.push('- **Objetivo:** Avaliar integridade técnica, humildade e reação sob pressão sem tentar blefar.');
  linhas.push(`- **Pergunta Típica:** "${perguntaLacuna}"`);
  linhas.push('');

  linhas.push('### Rodada 4: Pergunta Comportamental STAR');
  const pComportamental = preparacao.perguntas_star.find(p => p.categoria === 'comportamental' || p.categoria === 'lideranca');
  const perguntaComp = pComportamental?.pergunta ?? 'Conte sobre uma divergência técnica ou negociação de escopo complexa que você precisou gerenciar.';
  linhas.push('- **Objetivo:** Avaliar inteligência interpessoal, liderança situacional e foco em resultado.');
  linhas.push(`- **Pergunta Típica:** "${perguntaComp}"`);
  linhas.push('');

  linhas.push('## Rubrica de Autoavaliação');
  linhas.push('');
  linhas.push('- [ ] **Duração:** Respostas objetivas entre 2 e 3 minutos (sem prolixidade).');
  linhas.push('- [ ] **Estrutura STAR:** Contexto, Desafio, Ação individual e Resultado quantificado.');
  linhas.push('- [ ] **Lacunas:** Confissão limpa e transparente sem tentar adivinhar ou blefar.');
  linhas.push('- [ ] **Credibilidade:** Fatos 100% ancorados em experiências reais.');
  linhas.push('');

  return linhas.join('\n');
}

export async function salvarPreparacao({
  dataRoot,
  preparacao,
  vagaId,
  saida,
  now = new Date().toISOString(),
}) {
  const dataHoje = localDay(now);
  const nomePadrao = `entrevista-${slug(vagaId)}-${dataHoje}.md`;
  let nomeArquivo = nomePadrao;

  if (saida) {
    if (saida.includes('\0') || saida.split(/[\\/]/).some(part => part === '..')) {
      throw new Error('Caminho de saída inválido (não pode conter ".." ou caracteres nulos).');
    }
    nomeArquivo = path.basename(saida);
  }

  const markdown = formatarPreparacaoMarkdown(preparacao);
  const arquivoAbsoluto = await gravarProposta(dataRoot, 'entrevistas', nomeArquivo, markdown);
  return path.relative(dataRoot, arquivoAbsoluto).replaceAll('\\', '/');
}
