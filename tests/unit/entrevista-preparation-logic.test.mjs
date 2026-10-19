import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gerarPreparacaoEntrevista,
  formatarPreparacaoMarkdown,
  gerarRoteiroSimulacao,
} from '../../core/interview/preparation.mjs';

test('Fase 2: Lógica Pura de Preparação de Entrevista (F9.6)', async (t) => {
  const now = '2026-10-18T15:30:00.000-03:00';

  const mockBase = {
    claims: [
      {
        id: 'AF-001',
        texto: 'Projetou arquitetura orientada a eventos para microsserviços Node.js com redução de 40% na latência.',
        nivel_prova: 'verificado',
        empresa: 'Empresa Alfa',
        periodo: '2022-2024',
        publicavel: 'sim',
      },
      {
        id: 'AF-002',
        texto: 'Liderou squad de 6 engenheiros na migração de monolito para Kubernetes na AWS.',
        nivel_prova: 'entregue',
        empresa: 'Empresa Alfa',
        periodo: '2023-2024',
        publicavel: 'sim',
      },
      {
        id: 'AF-003',
        texto: 'Escreveu scripts de automação em Python para processamento de logs.',
        nivel_prova: 'relato',
        empresa: 'Empresa Beta',
        periodo: '2021-2022',
        publicavel: 'sim',
      },
      {
        id: 'AF-004',
        texto: 'Desenvolveu protótipo sigiloso de pagamentos para o Banco Secreto XYZ.',
        nivel_prova: 'verificado',
        empresa: 'Empresa Alfa',
        periodo: '2024',
        publicavel: 'nao',
        anonimizar: ['Banco Secreto XYZ'],
      },
    ],
    evidence: [
      {
        id: 'EV-001',
        fonte: 'docs/arquitetura.md',
        texto: 'Documento técnico de arquitetura com benchmark de latência aprovado pela diretoria.',
        afirmacoes: ['AF-001'],
      },
      {
        id: 'EV-002',
        fonte: 'docs/k8s-migration.md',
        texto: 'Relatório pós-mortem de migração concluída com zero downtime.',
        afirmacoes: ['AF-002'],
      },
    ],
    historias: [
      {
        id: 'historia-latencia-node',
        titulo: 'Otimização de latência do checkout em microsserviços',
        afirmacoes: ['AF-001'],
        texto: `## Situação
O sistema de checkout sofria com picos de latência de até 800ms em datas promocionais.

## Tarefa
Reduzir a latência p95 para menos de 200ms mantendo a consistência dos pedidos.

## Ação
Refatorei os microsserviços Node.js para comunicação assíncrona orientada a eventos com RabbitMQ.

## Resultado
A latência p95 caiu em 40% (para 110ms) e o sistema suportou o dobro de transações sem degradação.`,
      },
      {
        id: 'historia-conflito-tecnico',
        titulo: 'Resolução de impasse sobre escolha de banco de dados',
        afirmacoes: ['AF-002'],
        texto: `Havia uma divergência na equipe entre adotar PostgreSQL ou MongoDB para novo módulo.
Como líder técnico, estruturei um benchmark prático de 3 dias com os padrões de consulta reais.
Apresentei os dados numéricos à equipe e alinhamos a escolha com consenso unânime.
O módulo foi entregue sem retrabalho técnico.`,
      },
    ],
    arcos: [],
    preferencias: {},
  };

  const mockVaga = {
    id: 'vaga-tech-senior',
    cargo: 'Engenheiro de Software Sênior',
    empresa: 'TechCorp Soluções',
    aderencia: 'alta',
    requisitos: [
      {
        requisito: 'Experiência sólida com Node.js e microsserviços',
        tipo: 'obrigatorio',
        avaliacao: 'atendido',
        afirmacoes: ['AF-001'],
      },
      {
        requisito: 'Liderança técnica e mentoria de desenvolvedores',
        tipo: 'desejavel',
        avaliacao: 'atendido',
        afirmacoes: ['AF-002'],
      },
      {
        requisito: 'Domínio avançado de Kubernetes em produção',
        tipo: 'obrigatorio',
        avaliacao: 'lacuna',
        afirmacoes: [],
      },
      {
        requisito: 'Automação de scripts com Python',
        tipo: 'desejavel',
        avaliacao: 'parcial',
        afirmacoes: ['AF-003'],
      },
    ],
  };

  await t.test('2.1 Pontos Fortes: inclui apenas requisitos atendidos com prova documental', () => {
    const prep = gerarPreparacaoEntrevista({
      vaga: mockVaga,
      base: mockBase,
      now,
    });

    assert.equal(prep.vaga_id, 'vaga-tech-senior');
    assert.equal(prep.cargo, 'Engenheiro de Software Sênior');
    assert.equal(prep.empresa, 'TechCorp Soluções');
    assert.equal(prep.data, '2026-10-18');
    assert.equal(prep.contadores.pontos_fortes, 2);

    const pf1 = prep.pontos_fortes.find(p => p.requisito.includes('Node.js'));
    assert.ok(pf1);
    assert.equal(pf1.tipo, 'obrigatorio');
    assert.equal(pf1.afirmacoes.length, 1);
    assert.equal(pf1.afirmacoes[0].id, 'AF-001');
    assert.equal(pf1.afirmacoes[0].nivel_prova, 'verificado');
    assert.equal(pf1.afirmacoes[0].evidencias.length, 1);
    assert.equal(pf1.afirmacoes[0].evidencias[0].id, 'EV-001');
    assert.ok(pf1.orientacao_resposta);

    const pf2 = prep.pontos_fortes.find(p => p.requisito.includes('Liderança'));
    assert.ok(pf2);
    assert.equal(pf2.tipo, 'desejavel');
    assert.equal(pf2.afirmacoes[0].id, 'AF-002');
    assert.equal(pf2.afirmacoes[0].nivel_prova, 'entregue');
  });

  await t.test('2.2 Pontos Fracos e Lacunas: classifica lacunas e parciais com defesas realistas', () => {
    const prep = gerarPreparacaoEntrevista({
      vaga: mockVaga,
      base: mockBase,
      now,
    });

    assert.equal(prep.contadores.pontos_fracos_e_lacunas, 2);

    const lacunaK8s = prep.pontos_fracos_e_lacunas.find(l => l.requisito.includes('Kubernetes'));
    assert.ok(lacunaK8s);
    assert.equal(lacunaK8s.tipo, 'obrigatorio');
    assert.equal(lacunaK8s.status_avaliacao, 'lacuna');
    assert.ok(lacunaK8s.estrategia_defesa.length > 10);
    assert.ok(lacunaK8s.postura_recomendada.length > 10);

    const parcialPy = prep.pontos_fracos_e_lacunas.find(l => l.requisito.includes('Python'));
    assert.ok(parcialPy);
    assert.equal(parcialPy.tipo, 'desejavel');
    assert.equal(parcialPy.status_avaliacao, 'parcial');
    assert.equal(parcialPy.afirmacoes_relacionadas.length, 1);
    assert.equal(parcialPy.afirmacoes_relacionadas[0].id, 'AF-003');
  });

  await t.test('2.3 Requisito atendido mas sustentado apenas por afirmação relato NÃO vira ponto forte', () => {
    const vagaComRelato = {
      id: 'vaga-relato',
      cargo: 'Dev Python',
      empresa: 'Beta',
      aderencia: 'media',
      requisitos: [
        {
          requisito: 'Automação Python',
          tipo: 'obrigatorio',
          avaliacao: 'atendido',
          afirmacoes: ['AF-003'], // AF-003 é relato!
        },
      ],
    };

    const prep = gerarPreparacaoEntrevista({
      vaga: vagaComRelato,
      base: mockBase,
      now,
    });

    assert.equal(prep.contadores.pontos_fortes, 0, 'Requisito com relato não deve virar ponto forte');
    assert.equal(prep.contadores.pontos_fracos_e_lacunas, 1, 'Requisito rebaixado entra como ponto de atenção');
  });

  await t.test('2.4 Perguntas STAR: mapeia histórias do story-bank vinculadas aos requisitos e extrai dimensões STAR', () => {
    const prep = gerarPreparacaoEntrevista({
      vaga: mockVaga,
      base: mockBase,
      now,
    });

    assert.ok(prep.perguntas_star.length >= 2);

    const pNode = prep.perguntas_star.find(p => p.historia_id === 'historia-latencia-node');
    assert.ok(pNode);
    assert.equal(pNode.historia_titulo, 'Otimização de latência do checkout em microsserviços');
    assert.ok(pNode.requisito_associado.includes('Node.js'));
    assert.match(pNode.star.situacao, /picos de latência/i);
    assert.match(pNode.star.tarefa, /Reduzir a latência/i);
    assert.match(pNode.star.acao, /Refatorei os microsserviços/i);
    assert.match(pNode.star.resultado, /40%/i);
    assert.ok(pNode.dica_articulacao);

    const pComportamental = prep.perguntas_star.find(p => p.historia_id === 'historia-conflito-tecnico');
    assert.ok(pComportamental);
    assert.ok(pComportamental.star.situacao);
    assert.ok(pComportamental.star.acao);
    assert.ok(pComportamental.star.resultado);
  });

  await t.test('2.5 O que NÃO alegar: inclui afirmações de relato, não publicáveis, termos a anonimizar e lacunas críticas', () => {
    const prep = gerarPreparacaoEntrevista({
      vaga: mockVaga,
      base: mockBase,
      now,
    });

    const itens = prep.o_que_nao_alegar;
    assert.ok(itens.length >= 3);

    const itemRelato = itens.find(i => i.motivo_bloqueio === 'afirmacao_relato');
    assert.ok(itemRelato, 'Deve listar AF-003 como afirmação de relato');

    const itemNaoPublicavel = itens.find(i => i.motivo_bloqueio === 'nao_publicavel');
    assert.ok(itemNaoPublicavel, 'Deve listar AF-004 como não publicável');

    const itemAnonimizar = itens.find(i => i.motivo_bloqueio === 'termo_anonimizar');
    assert.ok(itemAnonimizar, 'Deve alertar para anonimizar termos confidenciais');
    assert.match(itemAnonimizar.recomendacao_humana, /Banco Secreto XYZ/);

    const itemLacuna = itens.find(i => i.motivo_bloqueio === 'lacuna_critica');
    assert.ok(itemLacuna, 'Deve incluir lacuna obrigatória Kubernetes em o que não alegar');
  });

  await t.test('2.6 formatarPreparacaoMarkdown: gera markdown estruturado com seções 1, 2, 3 e 4', () => {
    const prep = gerarPreparacaoEntrevista({
      vaga: mockVaga,
      base: mockBase,
      now,
    });

    const md = formatarPreparacaoMarkdown(prep);
    assert.ok(md.includes('# Preparação para Entrevista: Engenheiro de Software Sênior na TechCorp Soluções'));
    assert.ok(md.includes('## 1. Pontos Fortes (Comprovações Fatuais)'));
    assert.ok(md.includes('## 2. Pontos Fracos e Lacunas (Plano de Contingência)'));
    assert.ok(md.includes('## 3. Perguntas Prováveis & Histórias STAR'));
    assert.ok(md.includes('## 4. O que NÃO alegar (Limites de Credibilidade)'));
    assert.ok(md.includes('| Tópico | Motivo | Recomendação de Postura |'));
    assert.ok(md.includes('Dossiê gerado pelo CareerBounty'));
  });

  await t.test('2.7 gerarRoteiroSimulacao: gera roteiro com prompt de sistema, rodadas 1 a 4 e rubrica', () => {
    const prep = gerarPreparacaoEntrevista({
      vaga: mockVaga,
      base: mockBase,
      now,
    });

    const roteiro = gerarRoteiroSimulacao({ preparacao: prep, vaga: mockVaga });
    assert.ok(roteiro.includes('# Simulação de Entrevista: Engenheiro de Software Sênior na TechCorp Soluções'));
    assert.ok(roteiro.includes('Instruções para o Claude (System Prompt)'));
    assert.ok(roteiro.includes('Rodada 1'));
    assert.ok(roteiro.includes('Rodada 2'));
    assert.ok(roteiro.includes('Rodada 3'));
    assert.ok(roteiro.includes('Rodada 4'));
    assert.ok(roteiro.includes('Rubrica de Autoavaliação'));
  });
});

// A preparação é material para a pessoa falar numa entrevista: nada pode ser inventado em nome dela.
test('história sem as partes do STAR não ganha texto pronto: a parte que falta fica marcada para completar', () => {
  const base = {
    claims: [{ id: 'AF-010', texto: 'Liderou a migração de um sistema legado.', nivel_prova: 'verificado', empresa: 'Empresa Alfa' }],
    evidence: [],
    historias: [{ id: 'HI-010', titulo: 'Migração do legado', afirmacoes: ['AF-010'], texto: 'Conduzi a migração do sistema legado com o time.' }],
  };
  const vaga = { id: 'vaga-10', cargo: 'Gerente', empresa: 'Empresa Beta', requisitos: [{ requisito: 'Migração de sistemas', tipo: 'obrigatorio', avaliacao: 'atendido', afirmacoes: ['AF-010'] }] };
  const prep = gerarPreparacaoEntrevista({ vaga, avaliacao: vaga, base, now: '2026-10-18T12:00:00.000Z' });
  const star = prep.perguntas_star.find(p => p.historia_id === 'HI-010').star;
  assert.equal(star.situacao, 'Conduzi a migração do sistema legado com o time.');
  assert.equal(star.tarefa, null);
  assert.equal(star.resultado, null);
  const md = formatarPreparacaoMarkdown(prep);
  assert.match(md, /não está na história registrada/);
  for (const inventado of ['Entrega finalizada com sucesso', 'Impacto mensurável', 'Resultados numéricos e qualitativos', 'curva de aprendizado demonstrada']) {
    assert.doesNotMatch(md, new RegExp(inventado), inventado);
  }
});

test('requisito sem avaliação não vira ponto forte', () => {
  const base = { claims: [{ id: 'AF-011', texto: 'Implantou CI/CD.', nivel_prova: 'verificado' }], evidence: [], historias: [] };
  const vaga = { id: 'vaga-11', cargo: 'Gerente', empresa: 'Empresa Beta', requisitos: [{ requisito: 'CI/CD', tipo: 'obrigatorio', afirmacoes: ['AF-011'] }] };
  const prep = gerarPreparacaoEntrevista({ vaga, avaliacao: vaga, base, now: '2026-10-18T12:00:00.000Z' });
  assert.equal(prep.pontos_fortes.length, 0);
  assert.equal(prep.pontos_fracos_e_lacunas[0].status_avaliacao, 'nao_avaliado');
});