import assert from 'node:assert/strict';
import { cp, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../helpers/cli.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const NOW = '2026-10-18T16:00:00.000-03:00';
const DEFAULT_ENV = { CAREER_BOUNTY_NOW: NOW };

async function criarAmbiente(t) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot, env: DEFAULT_ENV }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });

  // Cria uma vaga descoberta e avaliada
  const vagaId = 'vaga-backend-node';
  const eventosIniciais = [
    {
      id: `descoberta:${vagaId}`,
      ts: '2026-10-18T10:00:00.000-03:00',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: vagaId,
      dados: {
        vaga: {
          id: vagaId,
          cargo: 'Engenheiro Backend Node.js Sênior',
          empresa: 'TechCorp Solutions',
          url: 'https://exemplo.com/vaga/123',
          fonte: 'exemplo',
          descricao: 'Vaga para atuar com Node.js, microsserviços, RabbitMQ e Kubernetes.',
        },
      },
    },
    {
      id: `avaliacao:${vagaId}`,
      ts: '2026-10-18T11:00:00.000-03:00',
      ator: 'radar',
      tipo: 'vaga.avaliada',
      entidade: 'vagas',
      entidade_id: vagaId,
      dados: {
        descricao_hash: 'hash-node-123',
        avaliacao: {
          aderencia: 'alta',
          resumo: 'Forte aderência em Node.js e mensageria.',
          requisitos: [
            {
              requisito: 'Experiência sólida com Node.js em produção',
              tipo: 'obrigatorio',
              avaliacao: 'atendido',
              afirmacoes: ['AF-101'],
            },
            {
              requisito: 'Kubernetes e orquestração em nuvem',
              tipo: 'obrigatorio',
              avaliacao: 'lacuna',
              afirmacoes: [],
            },
          ],
          pendencias: [],
          snapshot_afirmacoes: 'snap123',
          versaoPrompt: '1.0',
          modelo: 'sonnet',
          aderencia_sugerida_llm: 'alta',
          ajustes: [],
        },
      },
    },
  ];

  await appendEvents(dataRoot, eventosIniciais, { now: NOW });
  return { dataRoot, vagaId };
}

test('Fase 3: CLI entrevista preparar e simular', async (t) => {
  await t.test('3.1 entrevista preparar --vaga <id> com vaga avaliada gera markdown e evento', async (t2) => {
    const { dataRoot, vagaId } = await criarAmbiente(t2);

    const res = run(['entrevista', 'preparar', '--vaga', vagaId, '--now', NOW, '--teste'], {
      dataRoot,
      env: DEFAULT_ENV,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Preparação para Entrevista:/);
    assert.match(res.stdout, /TechCorp Solutions/);
    assert.match(res.stdout, /Arquivo salvo em:/i);

    // Verifica que o evento foi persistido no log
    const { eventos } = await readEvents(dataRoot);
    const evPrep = eventos.find(e => e.tipo === 'entrevista.preparada');
    assert.ok(evPrep, 'Deve gravar evento entrevista.preparada');
    assert.equal(evPrep.dados.vaga_id, vagaId);
    assert.equal(evPrep.dados.data, '2026-10-18');
    assert.equal(evPrep.dados.pontos_fortes_count, 1);
    assert.equal(evPrep.dados.lacunas_count, 1);

    // Verifica que o arquivo físico existe no outbox
    const arquivoPath = path.join(dataRoot, evPrep.dados.arquivo);
    const conteudo = await readFile(arquivoPath, 'utf8');
    assert.match(conteudo, /# Preparação para Entrevista:/);
    assert.match(conteudo, /## 1\. Pontos Fortes/);
    assert.match(conteudo, /## 2\. Pontos Fracos e Lacunas/);
    assert.match(conteudo, /## 3\. Perguntas Prováveis/);
    assert.match(conteudo, /## 4\. O que NÃO alegar/);
  });

  await t.test('3.2 entrevista preparar --vaga <id> com formato --json', async (t2) => {
    const { dataRoot, vagaId } = await criarAmbiente(t2);

    const res = run(['entrevista', 'preparar', '--vaga', vagaId, '--now', NOW, '--teste', '--json'], {
      dataRoot,
      env: DEFAULT_ENV,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.json, 'Deve retornar JSON parseável');
    assert.equal(res.json.ok, true);
    assert.equal(res.json.vaga_id, vagaId);
    assert.equal(res.json.pontos_fortes_count, 1);
    assert.equal(res.json.lacunas_count, 1);
    assert.ok(res.json.arquivo.startsWith('outbox/entrevistas/'));
    assert.ok(res.json.preparacao);
  });

  await t.test('3.3 entrevista preparar para vaga inexistente falha com mensagem amigável', async (t2) => {
    const { dataRoot } = await criarAmbiente(t2);

    const res = run(['entrevista', 'preparar', '--vaga', 'vaga-fantasma', '--now', NOW, '--teste', '--json'], {
      dataRoot,
      env: DEFAULT_ENV,
    });

    assert.notEqual(res.status, 0);
    assert.match(res.stderr + (res.json?.error || ''), /Vaga não encontrada: vaga-fantasma/);
  });

  await t.test('3.4 entrevista preparar aceita flag --saida customizada', async (t2) => {
    const { dataRoot, vagaId } = await criarAmbiente(t2);

    const res = run([
      'entrevista', 'preparar',
      '--vaga', vagaId,
      '--saida', 'custom-preparacao.md',
      '--now', NOW, '--teste',
      '--json',
    ], {
      dataRoot,
      env: DEFAULT_ENV,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.json.arquivo.endsWith('custom-preparacao.md'));

    const arquivoExiste = await access(path.join(dataRoot, res.json.arquivo)).then(() => true).catch(() => false);
    assert.ok(arquivoExiste, 'Arquivo de saída customizado deve existir');
  });

  await t.test('3.5 entrevista simular gera roteiro interativo de treino', async (t2) => {
    const { dataRoot, vagaId } = await criarAmbiente(t2);

    const res = run(['entrevista', 'simular', '--vaga', vagaId, '--now', NOW, '--teste'], {
      dataRoot,
      env: DEFAULT_ENV,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Simulação de Entrevista:/);
    assert.match(res.stdout, /System Prompt/);
    assert.match(res.stdout, /Rodada 1/);
    assert.match(res.stdout, /Rodada 2/);
    assert.match(res.stdout, /Rodada 3/);
    assert.match(res.stdout, /Rodada 4/);
    assert.match(res.stdout, /Rubrica de Autoavaliação/);
  });

  await t.test('3.6 alias de topo preparar-entrevista funciona identicamente a entrevista preparar', async (t2) => {
    const { dataRoot, vagaId } = await criarAmbiente(t2);

    const res = run(['preparar-entrevista', '--vaga', vagaId, '--now', NOW, '--teste', '--json'], {
      dataRoot,
      env: DEFAULT_ENV,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.vaga_id, vagaId);
  });

  await t.test('3.7 preservação dos subcomandos legados da entrevista investigativa', async (t2) => {
    const { dataRoot } = await criarAmbiente(t2);

    const resLacunas = run(['entrevista', 'lacunas', '--json'], {
      dataRoot,
      env: DEFAULT_ENV,
    });
    assert.equal(resLacunas.status, 0, resLacunas.stderr);
    assert.ok(Array.isArray(resLacunas.json?.lacunas));

    const resPendentes = run(['entrevista', 'pendentes', '--json'], {
      dataRoot,
      env: DEFAULT_ENV,
    });
    assert.equal(resPendentes.status, 0, resPendentes.stderr);
    assert.ok(Array.isArray(resPendentes.json?.pendentes));
  });
});
