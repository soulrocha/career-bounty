import assert from 'node:assert/strict';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { appendEvents } from '../../core/store/events.mjs';
import {
  gerarPreparacaoEntrevista,
  formatarPreparacaoMarkdown,
  salvarPreparacao,
} from '../../core/interview/preparation.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const NOW = '2026-10-18T16:00:00.000-03:00';
const DEFAULT_ENV = { CAREER_BOUNTY_NOW: NOW };

test('Fase 5: Segurança e Adversarial QA para Preparação de Entrevista', async (t) => {
  await t.test('5.1 Rejeita tentativas de Path Traversal no parâmetro --saida e em salvarPreparacao', async () => {
    const maliciousPaths = [
      '../../etc/passwd',
      '..\\malicious.md',
      'sub/../../escape.md',
      'outbox/\0exploit.md',
    ];

    for (const badPath of maliciousPaths) {
      await assert.rejects(
        () =>
          salvarPreparacao({
            dataRoot: 'C:/fake/data',
            preparacao: { data: '2026-10-18' },
            vagaId: 'vaga-01',
            saida: badPath,
          }),
        /caminho.*inválido/i,
        `Deveria ter rejeitado path traversal: ${badPath}`
      );
    }
  });

  await t.test('5.2 Processa de forma resiliente vaga com requisitos vazios, nulos ou anômalos', () => {
    const vagaAnomala = {
      id: 'vaga-anomala-01',
      cargo: null,
      empresa: undefined,
      requisitos: [
        null,
        undefined,
        {},
        { requisito: '', tipo: 'obrigatorio', avaliacao: 'atendido' },
        { requisito: 'Tecnologia X', afirmacoes: null, avaliacao: null },
      ],
    };

    assert.doesNotThrow(() => {
      const prep = gerarPreparacaoEntrevista({
        vaga: vagaAnomala,
        base: {},
        now: NOW,
      });

      assert.ok(prep);
      assert.equal(prep.cargo, 'Cargo não especificado');
      assert.equal(prep.empresa, 'Empresa não especificada');
      assert.ok(prep.contadores);

      const md = formatarPreparacaoMarkdown(prep);
      assert.ok(typeof md === 'string');
    });
  });

  await t.test('5.3 Degradação graciosa quando a base de conhecimento não tem histórias nem arcos', () => {
    const vaga = {
      id: 'vaga-sem-historias',
      cargo: 'Engenheiro Sênior',
      empresa: 'Startup Inovadora',
      requisitos: [
        {
          requisito: 'Arquitetura de Sistemas Distribuídos',
          tipo: 'obrigatorio',
          avaliacao: 'atendido',
          afirmacoes: [],
        },
      ],
    };

    const prep = gerarPreparacaoEntrevista({
      vaga,
      base: { claims: [], evidence: [], historias: [], arcos: [] },
      now: NOW,
    });

    assert.ok(prep);
    assert.equal(prep.contadores.perguntas_star, 0);

    const md = formatarPreparacaoMarkdown(prep);
    assert.match(md, /Nenhuma pergunta STAR mapeada/);
  });

  await t.test('5.4 Sanitização contra injeção de Markdown e pipes de tabela (|)', () => {
    const vagaMaliciosa = {
      id: 'vaga-injecao-01',
      cargo: 'Dev | rm -rf / | [Exploit](http://evil.com)',
      empresa: 'EvilCorp | Injeção',
      requisitos: [
        {
          requisito: 'Requisito | com pipes || e quebras\nde linha',
          tipo: 'obrigatorio',
          avaliacao: 'lacuna',
        },
      ],
    };

    const prep = gerarPreparacaoEntrevista({
      vaga: vagaMaliciosa,
      base: {
        claims: [
          {
            id: 'AF-INJ',
            texto: 'Afirmação | com pipe e\nquebra de linha',
            nivel_prova: 'relato',
            publicavel: 'sim',
          },
        ],
      },
      now: NOW,
    });

    const md = formatarPreparacaoMarkdown(prep);
    assert.ok(md);
    // Cada linha da tabela em Markdown deve ter formato consistente
    const linhasTabela = md.split('\n').filter(l => l.startsWith('| **'));
    for (const linha of linhasTabela) {
      assert.ok(!linha.includes('\n'), 'Linha da tabela não pode ter quebra de linha embutida');
    }
  });

  await t.test('5.5 Monotonicidade e Determinismo: mesmas entradas geram rigorosamente a mesma saída', () => {
    const vaga = {
      id: 'vaga-deterministica',
      cargo: 'Lead Engineer',
      empresa: 'Deterministic Corp',
      requisitos: [
        {
          requisito: 'Node.js',
          tipo: 'obrigatorio',
          avaliacao: 'atendido',
          afirmacoes: ['AF-01'],
        },
      ],
    };

    const base = {
      claims: [
        {
          id: 'AF-01',
          texto: 'Desenvolveu backend em Node.js.',
          nivel_prova: 'verificado',
        },
      ],
      evidence: [
        {
          id: 'EV-01',
          fonte: 'doc.md',
          texto: 'Comprovante',
          afirmacoes: ['AF-01'],
        },
      ],
      historias: [
        {
          id: 'H-01',
          titulo: 'Migração Node.js',
          afirmacoes: ['AF-01'],
          texto: 'Situação: teste. Tarefa: teste. Ação: teste. Resultado: teste.',
        },
      ],
    };

    const prep1 = gerarPreparacaoEntrevista({ vaga, base, now: NOW });
    const prep2 = gerarPreparacaoEntrevista({ vaga, base, now: NOW });

    assert.deepEqual(prep1, prep2);
    assert.equal(formatarPreparacaoMarkdown(prep1), formatarPreparacaoMarkdown(prep2));
  });
});
