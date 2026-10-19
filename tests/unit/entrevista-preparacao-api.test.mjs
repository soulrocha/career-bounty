import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';
import { appendEvents } from '../../core/store/events.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const NOW = '2026-10-18T15:00:00.000-03:00';

async function setupAmbiente(t) {
  const dataRoot = await tempDir(t);
  const put = async (relativo, dado) => {
    const alvo = path.join(dataRoot, relativo);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, typeof dado === 'string' ? dado : JSON.stringify(dado));
  };

  await put('state/migration.json', { version: 1, mode: 'ativo', snapshotRoot: null });
  await put('projections/pipeline-vagas.json', { vagas: [] });
  await mkdir(path.join(dataRoot, 'events'), { recursive: true });

  // Copia fixtures de KB para o diretório
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });

  // Cria arquivo de identidade para teste de redação (subconjunto JSON de YAML)
  await put('identity.yml', JSON.stringify({
    nome: 'Candidato Exemplo',
    email: 'candidato.seguro@exemplo.test',
    telefone: '11' + '977776666',
  }));

  // Cria vagas no log: uma avaliada e outra sem avaliação
  const eventos = [
    {
      id: 'vaga-descoberta-1',
      ts: '2026-10-18T10:00:00.000-03:00',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: 'vaga-avaliada-01',
      dados: {
        vaga: {
          id: 'vaga-avaliada-01',
          cargo: 'Engenheiro de Software Sênior',
          empresa: 'TechCorp Soluções',
          url: 'https://exemplo.com/vaga/1',
          fonte: 'exemplo',
          descricao: `Contato do recrutador: recrutador@techcorp.exemplo.test ou telefone ${'(11) ' + '98888-7777'}. Requer Node.js e Kubernetes.`,
        },
      },
    },
    {
      id: 'vaga-avaliada-ev-1',
      ts: '2026-10-18T11:00:00.000-03:00',
      ator: 'radar',
      tipo: 'vaga.avaliada',
      entidade: 'vagas',
      entidade_id: 'vaga-avaliada-01',
      dados: {
        descricao_hash: 'hash-tech-1',
        avaliacao: {
          aderencia: 'alta',
          resumo: `Alinhado com a história do Candidato Exemplo. Dúvidas com recrutador@techcorp.exemplo.test`,
          requisitos: [
            {
              requisito: 'Arquitetura Node.js e microsserviços',
              tipo: 'obrigatorio',
              avaliacao: 'atendido',
              afirmacoes: ['AF-101'],
            },
            {
              requisito: 'Kubernetes em produção',
              tipo: 'obrigatorio',
              avaliacao: 'lacuna',
              afirmacoes: [],
            },
          ],
          pendencias: [],
          snapshot_afirmacoes: 'snap1',
          versaoPrompt: '1.0',
          modelo: 'sonnet',
          aderencia_sugerida_llm: 'alta',
          ajustes: [],
        },
      },
    },
    {
      id: 'vaga-descoberta-2',
      ts: '2026-10-18T10:30:00.000-03:00',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: 'vaga-sem-avaliacao-02',
      dados: {
        vaga: {
          id: 'vaga-sem-avaliacao-02',
          cargo: 'Arquiteto de Soluções Cloud',
          empresa: 'Inovação Cloud Ltda',
          url: 'https://exemplo.com/vaga/2',
          fonte: 'exemplo',
          descricao: 'Vaga nova ainda não avaliada.',
        },
      },
    },
  ];

  await appendEvents(dataRoot, eventos, { now: NOW });

  const panel = await startPanel({
    dataRoot,
    port: 0,
    now: () => NOW,
  });
  t.after(panel.close);

  const pagina = await (await fetch(panel.url)).text();
  const tokenMatch = /window\.PAINEL_API=(\{[^;]+\});/.exec(pagina);
  const token = JSON.parse(tokenMatch[1]).token;
  const api = (urlPath, headers = {}) => fetch(`${panel.url}${urlPath}`, { headers });

  return { dataRoot, panel, token, api };
}

test('Fase 4: Rota HTTP /api/entrevistas/preparacao', async (t) => {
  await t.test('4.1 Rejeita requisição sem token ou token falso com 403 Forbidden', async (t2) => {
    const env = await setupAmbiente(t2);

    const semToken = await env.api('/api/entrevistas/preparacao?vaga=vaga-avaliada-01');
    assert.equal(semToken.status, 403);
    const errSemToken = await semToken.json();
    assert.equal(errSemToken.erro, 'Acesso inválido.');

    const tokenFalso = await env.api('/api/entrevistas/preparacao?vaga=vaga-avaliada-01', {
      'x-painel-token': 'token-errado',
    });
    assert.equal(tokenFalso.status, 403);
  });

  await t.test('4.2 Rejeita requisição sem parâmetro vaga com 400 Bad Request', async (t2) => {
    const env = await setupAmbiente(t2);

    const semVaga = await env.api('/api/entrevistas/preparacao', {
      'x-painel-token': env.token,
    });
    assert.equal(semVaga.status, 400);
    const body = await semVaga.json();
    assert.match(body.erro, /Parâmetro "vaga" é obrigatório/);
  });

  await t.test('4.3 Retorna 404 Not Found para vaga inexistente no log', async (t2) => {
    const env = await setupAmbiente(t2);

    const naoExiste = await env.api('/api/entrevistas/preparacao?vaga=vaga-inexistente', {
      'x-painel-token': env.token,
    });
    assert.equal(naoExiste.status, 404);
    const body = await naoExiste.json();
    assert.match(body.erro, /Vaga não encontrada: vaga-inexistente/);
  });

  await t.test('4.4 Retorna 422 Unprocessable Entity para vaga sem avaliação', async (t2) => {
    const env = await setupAmbiente(t2);

    const semAvaliacao = await env.api('/api/entrevistas/preparacao?vaga=vaga-sem-avaliacao-02', {
      'x-painel-token': env.token,
    });
    assert.equal(semAvaliacao.status, 422);
    const body = await semAvaliacao.json();
    assert.match(body.erro, /Vaga ainda não avaliada/);
  });

  await t.test('4.5 Retorna 200 OK com payload estruturado e mascaramento estrito de PII', async (t2) => {
    const env = await setupAmbiente(t2);

    const res = await env.api('/api/entrevistas/preparacao?vaga=vaga-avaliada-01', {
      'x-painel-token': env.token,
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.vaga_id, 'vaga-avaliada-01');
    assert.equal(body.cargo, 'Engenheiro de Software Sênior');
    assert.equal(body.empresa, 'TechCorp Soluções');
    assert.equal(body.aderencia, 'alta');
    assert.ok(body.contadores);
    assert.ok(Array.isArray(body.pontos_fortes));
    assert.ok(Array.isArray(body.pontos_fracos_e_lacunas));
    assert.ok(Array.isArray(body.perguntas_star));
    assert.ok(Array.isArray(body.o_que_nao_alegar));
    assert.ok(typeof body.markdown === 'string' && body.markdown.includes('# Preparação para Entrevista'));
    assert.ok(typeof body.arquivo === 'string');

    // Teste de privacidade e mascaramento de PII:
    const payloadStr = JSON.stringify(body);
    // E-mail do recrutador deve estar mascarado (ex: r***@techcorp.exemplo.test)
    assert.ok(!payloadStr.includes('recrutador@techcorp.exemplo.test'), 'Email do recrutador não pode vazar');
    // Telefone do recrutador não pode vazar
    const telRecrutadorCru = '98888-7777';
    assert.ok(!payloadStr.includes(telRecrutadorCru), 'Telefone do recrutador não pode vazar');
    // Nome do candidato da identidade não pode vazar (redigido para [REDACTED])
    assert.ok(!payloadStr.includes('Candidato Exemplo'), 'Identidade do candidato deve estar redigida');
  });
});
