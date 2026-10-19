import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir, run, repoRoot } from '../helpers/cli.mjs';
import { PLATAFORMAS_AVALIACAO, validarEmpresaAvaliada } from '../../core/store/rules.mjs';
import { projectAvaliacoes, obterAvaliacaoVigente } from '../../core/store/projections/avaliacoes.mjs';
import { projectEvents } from '../../core/store/project.mjs';
import { migrarAvaliacoesLegadas } from '../../core/migration/avaliacoes.mjs';
import { importPipeline } from '../../core/migration/import.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { avaliarEmpresa } from '../../core/company/evaluator.mjs';
import { renderPainel } from '../../panel/render.mjs';
import { resolveTemplate } from '../../panel/template.mjs';

const NOW_SP = '2026-10-18T15:00:00.000-03:00'; // São Paulo (-03:00)
const NOW_DATE = new Date(NOW_SP);

function basePayload(override = {}) {
  return {
    empresa: 'Empresa Alfa',
    empresa_chave: 'empresaalfa',
    nota: 4.2,
    quantidade: 150,
    plataforma: 'Glassdoor',
    data: '2026-10-18',
    fontes: [
      { url: 'https://example.com/avaliacoes/empresa-alfa', plataforma: 'Glassdoor' }
    ],
    resumo: 'Ambiente de trabalho positivo com bons benefícios.',
    validade_dias: 90,
    ...override
  };
}

// =============================================================================
// 1. FUZZING DE LIMITES E REJEIÇÃO DE DADOS ADVERSARIAIS
// =============================================================================

test('ADVERSARIAL: Rejeição estrita de notas fora do intervalo [1.0, 5.0]', () => {
  const notasInvalidas = [
    0.5, 0.99, -1, 0, 5.01, 5.5, 10, 100,
    NaN, Infinity, -Infinity,
    '4.5', 'nota', null, undefined, {}, []
  ];

  for (const nota of notasInvalidas) {
    const err = validarEmpresaAvaliada(basePayload({ nota }), NOW_SP);
    assert.match(err, /Nota deve ser um número entre 1\.0 e 5\.0/i, `Deveria rejeitar nota: ${nota}`);
  }

  // Limites exatos válidos
  assert.equal(validarEmpresaAvaliada(basePayload({ nota: 1.0 }), NOW_SP), null);
  assert.equal(validarEmpresaAvaliada(basePayload({ nota: 5.0 }), NOW_SP), null);
  assert.equal(validarEmpresaAvaliada(basePayload({ nota: 2.7 }), NOW_SP), null);
});

test('ADVERSARIAL: Fuzzing de datas, fusos e transição de meia-noite em São Paulo', () => {
  // Transição de meia-noite em São Paulo (UTC-3)
  // 2026-10-18 23:59:59-03:00 é 2026-10-19T02:59:59.000Z
  const antesMeiaNoite = '2026-10-19T02:59:59.000Z'; // 23:59:59 em SP no dia 18
  const aposMeiaNoite = '2026-10-19T03:00:01.000Z';  // 00:00:01 em SP no dia 19

  // Para antes da meia-noite, a data civil local é 2026-10-18. 2026-10-19 é FUTURA.
  assert.equal(validarEmpresaAvaliada(basePayload({ data: '2026-10-18' }), antesMeiaNoite), null);
  assert.match(validarEmpresaAvaliada(basePayload({ data: '2026-10-19' }), antesMeiaNoite), /data futura/i);

  // Logo após a meia-noite, a data civil local vira 2026-10-19. 2026-10-19 é PERMITIDA.
  assert.equal(validarEmpresaAvaliada(basePayload({ data: '2026-10-19' }), aposMeiaNoite), null);
  assert.match(validarEmpresaAvaliada(basePayload({ data: '2026-10-20' }), aposMeiaNoite), /data futura/i);

  // Datas impossíveis no calendário (calendário gregoriano real)
  const datasImpossiveis = [
    '2026-02-29', // 2026 não é bissexto
    '2026-04-31', // abril tem 30 dias
    '2026-06-31', // junho tem 30 dias
    '2026-09-31', // setembro tem 30 dias
    '2026-11-31', // novembro tem 30 dias
    '2026-00-10',
    '2026-13-01',
    '2026-10-32',
    '2026-10-00',
    '18/10/2026',
    '2026-10-18T10:00:00Z',
    '2026-10-18; DROP TABLE',
    'null',
    'undefined',
    ''
  ];

  for (const data of datasImpossiveis) {
    const err = validarEmpresaAvaliada(basePayload({ data }), NOW_SP);
    assert.match(err, /Data da avaliação inválida/i, `Deveria rejeitar data impossível: ${data}`);
  }

  // Ano bissexto válido (ex: 2024-02-29)
  assert.equal(validarEmpresaAvaliada(basePayload({ data: '2024-02-29' }), NOW_SP), null);
});

test('ADVERSARIAL: Rejeição estrita de fontes sem URL válida http/https e injeções de protocolo', () => {
  const fontesInvalidas = [
    [],
    null,
    undefined,
    'https://example.com',
    [null],
    [{}],
    [{ url: '' }],
    [{ url: '   ' }],
    [{ url: 'ftp://ftp.example.com/file' }],
    [{ url: 'javascript:alert(1)' }],
    [{ url: 'file:///etc/passwd' }],
    [{ url: 'data:text/html;base64,PHNjcmlwdD4=' }],
    [{ url: 'http://' }],
    [{ url: 'https://' }],
    [{ url: 'ht tps://example.com' }],
    [{ url: 'https://example.com', plataforma: 'HACKED' }]
  ];

  for (const fontes of fontesInvalidas) {
    const err = validarEmpresaAvaliada(basePayload({ fontes }), NOW_SP);
    assert.ok(err, `Deveria rejeitar fontes: ${JSON.stringify(fontes)}`);
  }
});

test('ADVERSARIAL: Limites de tamanho no resumo (> 500 caracteres) e tipos incorretos', () => {
  // Exatamente 500 caracteres -> válido
  const texto500 = 'x'.repeat(500);
  assert.equal(validarEmpresaAvaliada(basePayload({ resumo: texto500 }), NOW_SP), null);

  // 501 caracteres -> inválido
  const texto501 = 'x'.repeat(501);
  assert.match(validarEmpresaAvaliada(basePayload({ resumo: texto501 }), NOW_SP), /500 caracteres/i);

  // 5000 caracteres -> inválido
  const texto5000 = 'x'.repeat(5000);
  assert.match(validarEmpresaAvaliada(basePayload({ resumo: texto5000 }), NOW_SP), /500 caracteres/i);

  // Tipos incorretos para resumo
  assert.match(validarEmpresaAvaliada(basePayload({ resumo: 12345 }), NOW_SP), /Resumo deve ser um texto/i);
  assert.match(validarEmpresaAvaliada(basePayload({ resumo: {} }), NOW_SP), /Resumo deve ser um texto/i);
  assert.match(validarEmpresaAvaliada(basePayload({ resumo: ['texto'] }), NOW_SP), /Resumo deve ser um texto/i);
});

test('ADVERSARIAL: CLI empresa registrar rejeita entradas anômalas via flags', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);

  const errMsg = res => res.json?.error || res.stderr;

  // 1. Nota < 1.0 (ex: 0.5)
  const rNotaBaixa = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '0.5',
    '--quantidade', '10',
    '--fonte', 'https://example.com/alfa',
    '--now', NOW_SP,
    '--teste',
    '--json'
  ], { dataRoot });
  assert.notEqual(rNotaBaixa.status, 0);
  assert.match(errMsg(rNotaBaixa), /Nota deve ser um número entre 1\.0 e 5\.0/i);

  // 2. Nota > 5.0 (ex: 5.5)
  const rNotaAlta = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '5.5',
    '--quantidade', '10',
    '--fonte', 'https://example.com/alfa',
    '--now', NOW_SP,
    '--teste',
    '--json'
  ], { dataRoot });
  assert.notEqual(rNotaAlta.status, 0);
  assert.match(errMsg(rNotaAlta), /Nota deve ser um número entre 1\.0 e 5\.0/i);

  // 3. Data futura
  const rDataFutura = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '4.0',
    '--quantidade', '10',
    '--fonte', 'https://example.com/alfa',
    '--data', '2099-01-01',
    '--now', NOW_SP,
    '--teste',
    '--json'
  ], { dataRoot });
  assert.notEqual(rDataFutura.status, 0);
  assert.match(errMsg(rDataFutura), /data futura/i);

  // 4. Fonte com protocolo não http/https
  const rFonteFtp = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '4.0',
    '--quantidade', '10',
    '--fonte', 'ftp://example.com/alfa',
    '--now', NOW_SP,
    '--teste',
    '--json'
  ], { dataRoot });
  assert.notEqual(rFonteFtp.status, 0);
  assert.match(errMsg(rFonteFtp), /URL da fonte inválida/i);

  // 5. Resumo > 500 caracteres
  const rResumoLongo = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '4.0',
    '--quantidade', '10',
    '--fonte', 'https://example.com/alfa',
    '--resumo', 'a'.repeat(501),
    '--now', NOW_SP,
    '--teste',
    '--json'
  ], { dataRoot });
  assert.notEqual(rResumoLongo.status, 0);
  assert.match(errMsg(rResumoLongo), /500 caracteres/i);
});

// =============================================================================
// 2. AUDITORIA DO AVALIADOR E REGRAS DE LLM (ZERO SCRAPING)
// =============================================================================

test('ADVERSARIAL: agents/avaliador-empresa.md cumpre contrato estrito sem ferramentas e exige URL pública', async () => {
  const promptText = await readFile(path.join(repoRoot, 'agents', 'avaliador-empresa.md'), 'utf8');

  // tools: none
  assert.match(promptText, /tools:\s*none/i, 'O subagente não deve ter permissão para ferramentas/executáveis');
  // model: haiku
  assert.match(promptText, /model:\s*haiku/i, 'O subagente deve operar em modelo rápido e barato Haiku');
  // Regra de recusa se não houver URL pública
  assert.match(promptText, /A URL da fonte é OBRIGATÓRIA/i);
  assert.match(promptText, /sucesso":\s*false/i);
  assert.match(promptText, /Não faça suposições nem invente números/i);
});

test('ADVERSARIAL: core/company/evaluator.mjs NÃO faz chamadas HTTP diretas ao Glassdoor e recusa saída sem URL comprovável', async t => {
  const evaluatorCode = await readFile(path.join(repoRoot, 'core', 'company', 'evaluator.mjs'), 'utf8');

  // Não deve conter fetch() ou chamadas diretas de scraping para glassdoor
  assert.doesNotMatch(evaluatorCode, /\bfetch\s*\(/i, 'Evaluator não pode fazer chamadas de rede/fetch diretas');
  assert.doesNotMatch(evaluatorCode, /axios|got|superagent|puppeteer|playwright/i, 'Sem bibliotecas de scraping');

  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);

  // Teste de recusa quando o LLM devolve sucesso: false
  const runnerFalha = {
    async run() {
      return { json: { sucesso: false, motivo: 'Nenhuma avaliação localizada' } };
    }
  };

  await assert.rejects(
    async () => {
      await avaliarEmpresa({
        empresa: 'Empresa Alfa',
        dataRoot,
        runner: runnerFalha,
        searchImpl: async () => [{ titulo: 'Empresa Alfa: avaliações', url: 'https://avaliacoes.exemplo.test/empresa-alfa', trecho: 'Nota 4,0' }],
        now: NOW_DATE
      });
    },
    /Avaliação recusada/i
  );

  // Teste de recusa quando o LLM devolve sucesso: true mas sem fontes
  const runnerSemFontes = {
    async run() {
      return {
        json: {
          sucesso: true,
          empresa: 'Empresa Alfa',
          nota: 4.2,
          quantidade: 50,
          plataforma: 'Glassdoor',
          fontes: [], // vazio!
          data: '2026-10-18'
        }
      };
    }
  };

  await assert.rejects(
    async () => {
      await avaliarEmpresa({
        empresa: 'Empresa Alfa',
        dataRoot,
        runner: runnerSemFontes,
        searchImpl: async () => [{ titulo: 'Empresa Alfa: avaliações', url: 'https://avaliacoes.exemplo.test/empresa-alfa', trecho: 'Nota 4,0' }],
        now: NOW_DATE
      });
    },
    /Fontes com URL são obrigatórias/i
  );

  // Teste de recusa quando o LLM alucina URL não-http (ex: ftp ou vazia)
  const runnerUrlInvalida = {
    async run() {
      return {
        json: {
          sucesso: true,
          empresa: 'Empresa Alfa',
          nota: 4.2,
          quantidade: 50,
          plataforma: 'Glassdoor',
          fontes: [{ url: 'ftp://fake.com/review', plataforma: 'Glassdoor' }],
          data: '2026-10-18'
        }
      };
    }
  };

  await assert.rejects(
    async () => {
      await avaliarEmpresa({
        empresa: 'Empresa Alfa',
        dataRoot,
        runner: runnerUrlInvalida,
        searchImpl: async () => [{ titulo: 'Empresa Alfa: avaliações', url: 'https://avaliacoes.exemplo.test/empresa-alfa', trecho: 'Nota 4,0' }],
        now: NOW_DATE
      });
    },
    /URL da fonte inválida/i
  );

  // Nenhum evento foi gravado no log
  const { eventos } = await readEvents(dataRoot);
  assert.equal(eventos.filter(e => e.tipo === 'empresa.avaliada').length, 0);
});

// =============================================================================
// 3. PROJEÇÃO PURA, EXPIRAÇÃO TEMPORAL E INTEGRAÇÃO DE VAGAS
// =============================================================================

test('ADVERSARIAL: Exata transição de 90 para 91 dias na vigência de avaliação', () => {
  // NOW é 2026-10-18
  // 89 dias antes: 2026-07-21
  // 90 dias antes: 2026-07-20
  // 91 dias antes: 2026-07-19

  const baseEv = (data, id) => ({
    id,
    ts: `${data}T12:00:00.000Z`,
    host: 'host-adv',
    seq: 1,
    ator: 'cli',
    tipo: 'empresa.avaliada',
    entidade: 'empresa',
    entidade_id: 'empresaalfa',
    dados: {
      empresa: 'Empresa Alfa',
      empresa_chave: 'empresaalfa',
      nota: 4.5,
      quantidade: 100,
      plataforma: 'Glassdoor',
      data,
      fontes: [{ url: 'https://example.com/alfa', plataforma: 'Glassdoor' }],
      validade_dias: 90
    }
  });

  // 89 dias -> VÁLIDA
  const p89 = projectAvaliacoes([baseEv('2026-07-21', 'ev-89')], { now: NOW_DATE });
  const a89 = p89.por_empresa['empresaalfa'];
  assert.equal(a89.valida, true);
  assert.equal(a89.expirada, false);
  assert.equal(a89.dias_decorridos, 89);
  assert.equal(a89.dias_restantes, 1);
  assert.equal(p89.total_vigentes, 1);

  // 90 dias -> VÁLIDA no último dia
  const p90 = projectAvaliacoes([baseEv('2026-07-20', 'ev-90')], { now: NOW_DATE });
  const a90 = p90.por_empresa['empresaalfa'];
  assert.equal(a90.valida, true);
  assert.equal(a90.expirada, false);
  assert.equal(a90.dias_decorridos, 90);
  assert.equal(a90.dias_restantes, 0);
  assert.equal(p90.total_vigentes, 1);

  // 91 dias -> EXPIRADA
  const p91 = projectAvaliacoes([baseEv('2026-07-19', 'ev-91')], { now: NOW_DATE });
  const a91 = p91.por_empresa['empresaalfa'];
  assert.equal(a91.valida, false);
  assert.equal(a91.expirada, true);
  assert.equal(a91.dias_decorridos, 91);
  assert.equal(a91.dias_restantes, 0);
  assert.equal(p91.total_vigentes, 0);
});

test('ADVERSARIAL: Vaga com avaliação expirada NUNCA recebe empresa_avaliacao e template renderiza "Sem avaliações"', async () => {
  const vagaEvento = {
    id: 'vaga-adv-01',
    ts: '2026-10-18T10:00:00.000Z',
    host: 'host-1',
    seq: 1,
    ator: 'radar',
    tipo: 'vaga.descoberta',
    entidade: 'vaga',
    entidade_id: 'vaga-adv-01',
    dados: {
      vaga: {
        id: 'vaga-adv-01',
        empresa: 'Empresa Alfa',
        cargo: 'Staff Engineer',
        url: 'https://example.com/vaga/1',
        fonte: 'radar'
      }
    }
  };

  const avaliacaoExpirada = {
    id: 'av-exp',
    ts: '2026-07-01T10:00:00.000Z',
    host: 'host-1',
    seq: 2,
    ator: 'cli',
    tipo: 'empresa.avaliada',
    entidade: 'empresa',
    entidade_id: 'empresaalfa',
    dados: {
      empresa: 'Empresa Alfa',
      empresa_chave: 'empresaalfa',
      nota: 4.8,
      quantidade: 200,
      plataforma: 'Glassdoor',
      data: '2026-07-01', // mais de 100 dias atrás
      fontes: [{ url: 'https://example.com/alfa', plataforma: 'Glassdoor' }],
      validade_dias: 90
    }
  };

  const doc = projectEvents([vagaEvento, avaliacaoExpirada], { now: NOW_DATE });
  const vaga = doc.vagas.find(v => v.id === 'vaga-adv-01');

  assert.ok(vaga);
  // O campo NÃO pode estar presente
  assert.equal(vaga.empresa_avaliacao, undefined);
  assert.ok(!('empresa_avaliacao' in vaga), 'empresa_avaliacao deve ser deletado se expirada');

  // Renderização no template do painel
  const { html: template } = await resolveTemplate();
  const renderedHtml = renderPainel(doc, { template, hoje: '2026-10-18' });

  // NUNCA renderizar 0, 0.0, traço vazio ou estrelas vazias
  assert.doesNotMatch(renderedHtml, /★\s*0/);
  assert.doesNotMatch(renderedHtml, /★\s*—/);
  assert.doesNotMatch(renderedHtml, /★\s*NaN/);
});

// =============================================================================
// 4. MIGRAÇÃO LEGADA: IDEMPOTÊNCIA E RESILIÊNCIA
// =============================================================================

test('ADVERSARIAL: migrarAvaliacoesLegadas é rigorosamente idempotente e tolerante a dados legados corrompidos', async t => {
  const dataRoot = await tempDir(t);

  // Snapshot legado misto: empresas válidas duplicadas, empresas sem avaliação, e dados anômalos
  const pipelineLegado = {
    schema_version: 1,
    atualizado: '2026-10-18',
    vagas: [
      {
        id: 'v1',
        empresa: 'Empresa Alfa',
        cargo: 'Eng 1',
        url: 'https://vagas.exemplo.test/alfa-1',
        empresa_avaliacao: { nota: 4.1, quantidade: 30, plataforma: 'glassdoor', data: '2026-10-15', fontes: ['https://avaliacoes.exemplo.test/empresa-alfa'] }
      },
      {
        id: 'v2',
        empresa: 'Empresa Alfa', // duplicada
        cargo: 'Eng 2',
        empresa_avaliacao: { nota: 4.1, quantidade: 30, plataforma: 'glassdoor', data: '2026-10-15' }
      },
      {
        id: 'v3',
        empresa: 'Empresa Beta',
        cargo: 'Eng 3',
        empresa_avaliacao: { nota: 3.9, avaliacoes: 45, plataforma: 'indeed', data: '2026-10-16', fontes: [{ url: 'https://avaliacoes.exemplo.test/empresa-beta', plataforma: 'indeed' }] }
      },
      {
        id: 'v7',
        empresa: 'Empresa Zeta',
        cargo: 'Eng 7',
        url: 'https://vagas.exemplo.test/zeta-7',
        empresa_avaliacao: { nota: 4.5, quantidade: 12, plataforma: 'glassdoor', data: '2026-10-16' } // sem fonte: não migra
      },
      {
        id: 'v4',
        empresa: 'Empresa Gama',
        cargo: 'Eng 4'
        // sem avaliação
      },
      {
        id: 'v5',
        empresa: 'Empresa Delta',
        cargo: 'Eng 5',
        empresa_avaliacao: { nota: null, plataforma: 'glassdoor' } // nota nula corrompida
      },
      {
        id: 'v6',
        empresa: 'Empresa Épsilon',
        cargo: 'Eng 6',
        empresa_avaliacao: { nota: 0.2 } // nota menor que 1.0 corrompida
      }
    ],
    eventos_email_sem_requisicao: []
  };

  await importPipeline({ dataRoot, pipeline: pipelineLegado, host: 'adv-host', ts: NOW_SP });

  // Primeira execução
  const r1 = await migrarAvaliacoesLegadas({ dataRoot, host: 'adv-host', now: NOW_SP });
  assert.equal(r1.empresas_migradas, 2); // Alfa e Beta
  assert.equal(r1.empresas_sem_fonte, 1); // Zeta: sem fonte, não inventa procedência
  assert.equal(r1.novos_eventos, 2);

  const { eventos: evs1 } = await readEvents(dataRoot);
  const doc1 = projectEvents(evs1, { now: NOW_DATE });
  const migrados = evs1.filter(e => e.tipo === 'empresa.avaliada');
  const fontesDe = nome => migrados.find(e => e.dados.empresa === nome)?.dados.fontes.map(f => f.url);
  assert.deepEqual(fontesDe('Empresa Alfa'), ['https://avaliacoes.exemplo.test/empresa-alfa'], 'URL em texto do legado é preservada');
  assert.deepEqual(fontesDe('Empresa Beta'), ['https://avaliacoes.exemplo.test/empresa-beta']);
  assert.equal(fontesDe('Empresa Zeta'), undefined, 'sem fonte não vira evento');
  assert.ok(!migrados.some(e => e.dados.fontes.some(f => f.url.includes('vagas.exemplo.test'))), 'o link da vaga nunca vira fonte da nota');

  // Segunda execução consecutiva
  const r2 = await migrarAvaliacoesLegadas({ dataRoot, host: 'adv-host', now: NOW_SP });
  assert.equal(r2.novos_eventos, 0);

  // Terceira execução consecutiva
  const r3 = await migrarAvaliacoesLegadas({ dataRoot, host: 'adv-host', now: NOW_SP });
  assert.equal(r3.novos_eventos, 0);

  const { eventos: evs2 } = await readEvents(dataRoot);
  assert.equal(evs2.length, evs1.length, 'Nenhum novo evento deve ter sido gerado');

  const doc2 = projectEvents(evs2, { now: NOW_DATE });
  assert.deepEqual(doc2, doc1, 'A projeção deve ser idêntica após re-execuções da migração');
});

// =============================================================================
// 5. SEGURANÇA DE API, HOST SPOOFING E PRIVACIDADE
// =============================================================================

test('ADVERSARIAL: Segurança HTTP do painel - rejeição de token forjado e host spoofing', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);

  const { startPanel } = await import('../../panel/server.mjs');
  const panel = await startPanel({ dataRoot, port: 0, now: () => NOW_SP });
  t.after(panel.close);

  const port = new URL(panel.url).port;
  const pagina = await (await fetch(panel.url)).text();
  const tokenMatch = /window\.PAINEL_API=(\{[^;]+\});/.exec(pagina);
  assert.ok(tokenMatch, 'Token do painel deve estar presente na página principal');
  const token = JSON.parse(tokenMatch[1]).token;

  // 1. Chamada sem x-painel-token -> 403 Forbidden
  const resSemToken = await fetch(`${panel.url}/api/candidaturas`);
  assert.equal(resSemToken.status, 403);

  // 2. Chamada com token forjado -> 403 Forbidden
  const resTokenForjado = await fetch(`${panel.url}/api/candidaturas`, {
    headers: { 'X-Painel-Token': 'token-forjado-invalido-1234567890' }
  });
  assert.equal(resTokenForjado.status, 403);

  // 3. Chamada com token válido -> 200 OK
  const resTokenValido = await fetch(`${panel.url}/api/candidaturas`, {
    headers: { 'X-Painel-Token': token }
  });
  assert.equal(resTokenValido.status, 200);

  // 4. Host Spoofing: rejeita conexões com Host externo mesmo na mesma porta
  const net = await import('node:net');
  const cru = (linha, cabecalhos) => new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), '127.0.0.1');
    let data = '';
    socket.setEncoding('latin1');
    socket.on('data', chunk => { data += chunk; });
    socket.on('error', reject);
    socket.on('close', () => {
      const [head] = data.split('\r\n\r\n');
      resolve(Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1]));
    });
    socket.write([linha, ...cabecalhos, 'Connection: close', '', ''].join('\r\n'));
  });

  // Host spoofing com evil.com
  const statusSpoof = await cru('GET /api/status HTTP/1.1', ['Host: evil.attacker.com']);
  assert.equal(statusSpoof, 403, 'Host spoofing com domínio externo deve retornar 403');

  // Host correto 127.0.0.1:port
  const statusOk = await cru('GET /api/status HTTP/1.1', [`Host: 127.0.0.1:${port}`]);
  assert.equal(statusOk, 200);
});

test('ADVERSARIAL: Conformidade estrita de documentos, allowlist de empresas e ausência de menção ao Vault', async () => {
  const { readdir } = await import('node:fs/promises');
  const { findViolations } = await import('../helpers/allowlist.mjs');
  const { buildContext, scanText } = await import('../../core/privacy/scan.mjs');

  const allowed = (await readFile(path.join(repoRoot, 'tests', 'fixtures', 'empresas-ficticias.txt'), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean);

  async function filesUnder(dir, ext) {
    const out = [];
    for (const entry of await readdir(path.join(repoRoot, dir), { withFileTypes: true }).catch(() => [])) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...await filesUnder(rel, ext));
      else if (rel.endsWith(ext)) out.push(rel);
    }
    return out;
  }

  // Verifica CHANGELOG.md e docs/
  const docFiles = [...await filesUnder('docs', '.md'), 'CHANGELOG.md'];

  for (const file of docFiles) {
    const text = await readFile(path.join(repoRoot, file), 'utf8');

    // Varredura estrita de PII
    const pii = scanText(text, buildContext(), file);
    assert.deepEqual(pii, [], `Vazamento de PII encontrado em ${file}`);

    // Varredura de empresas reais fora da allowlist
    const hosts = findViolations(text, allowed).filter(v => v.kind === 'empresa');
    assert.deepEqual(hosts, [], `Empresa real fora da allowlist encontrada em ${file}`);
  }

  // CHANGELOG.md não deve conter menção a Vault
  const changelogText = await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  assert.doesNotMatch(changelogText, /\bvault\b/i, 'CHANGELOG.md não deve conter menção a Vault');
});

