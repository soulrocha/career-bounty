import assert from 'node:assert/strict';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { importPipeline } from '../../core/migration/import.mjs';
import { migrarAvaliacoesLegadas } from '../../core/migration/avaliacoes.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { projectEvents } from '../../core/store/project.mjs';

function makePipelineLegado() {
  return {
    schema_version: 1,
    atualizado: '2026-10-18',
    vagas: [
      {
        id: 'vaga-01',
        empresa: 'Empresa Alfa',
        cargo: 'Software Engineer',
        url: 'https://example.com/vagas/1',
        empresa_avaliacao: {
          nota: 4.2,
          quantidade: 150,
          plataforma: 'glassdoor',
          data: '2026-10-18',
          resumo: 'Excelente empresa para se trabalhar.',
          fontes: ['https://example.com/avaliacoes/empresa-alfa'] // formato do legado: URL em texto
        }
      },
      {
        id: 'vaga-02',
        empresa: 'Empresa Alfa',
        cargo: 'Senior Engineer',
        url: 'https://example.com/vagas/2',
        empresa_avaliacao: {
          nota: 4.2,
          quantidade: 150,
          plataforma: 'glassdoor',
          data: '2026-10-18'
        }
      },
      {
        id: 'vaga-03',
        empresa: 'Empresa Beta',
        cargo: 'Product Manager',
        url: 'https://example.com/vagas/3',
        empresa_avaliacao: {
          nota: 4.8,
          avaliacoes: 80, // campo legado alternativo
          plataforma: 'indeed',
          data: '2026-10-15',
          fontes: [{ url: 'https://example.com/indeed-beta', plataforma: 'Indeed' }]
        }
      },
      {
        id: 'vaga-04',
        empresa: 'Empresa Gama',
        cargo: 'Designer',
        url: 'https://example.com/vagas/4'
        // sem empresa_avaliacao
      }
    ],
    eventos_email_sem_requisicao: []
  };
}

const NOW = '2026-10-18T15:00:00.000Z';

test('migrarAvaliacoesLegadas converte avaliações embutidas em eventos empresa.avaliada', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makePipelineLegado();

  await importPipeline({ dataRoot, pipeline, host: 'test-host', ts: NOW });

  const resultado = await migrarAvaliacoesLegadas({ dataRoot, host: 'test-host', now: NOW });
  assert.equal(resultado.empresas_migradas, 2); // Empresa Alfa e Empresa Beta (Alfa duplicada em vaga-01 e vaga-02 agrupada)

  const { eventos } = await readEvents(dataRoot);
  const eventosAvaliacao = eventos.filter(e => e.tipo === 'empresa.avaliada');
  assert.equal(eventosAvaliacao.length, 2);

  const evAlfa = eventosAvaliacao.find(e => e.entidade_id === 'empresaalfa');
  assert.ok(evAlfa);
  assert.equal(evAlfa.dados.empresa, 'Empresa Alfa');
  assert.equal(evAlfa.dados.nota, 4.2);
  assert.equal(evAlfa.dados.quantidade, 150);
  assert.equal(evAlfa.dados.plataforma, 'Glassdoor'); // normalizado
  assert.equal(evAlfa.dados.data, '2026-10-18');
  assert.equal(evAlfa.dados.resumo, 'Excelente empresa para se trabalhar.');
  assert.deepEqual(evAlfa.dados.fontes.map(f => f.url), ['https://example.com/avaliacoes/empresa-alfa']); // nunca o link da vaga

  const evBeta = eventosAvaliacao.find(e => e.entidade_id === 'empresabeta');
  assert.ok(evBeta);
  assert.equal(evBeta.dados.empresa, 'Empresa Beta');
  assert.equal(evBeta.dados.nota, 4.8);
  assert.equal(evBeta.dados.quantidade, 80); // lido de avaliacoes
  assert.equal(evBeta.dados.plataforma, 'Indeed'); // normalizado
});

test('migrarAvaliacoesLegadas é puramente idempotente', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makePipelineLegado();

  await importPipeline({ dataRoot, pipeline, host: 'test-host', ts: NOW });

  const r1 = await migrarAvaliacoesLegadas({ dataRoot, host: 'test-host', now: NOW });
  assert.equal(r1.empresas_migradas, 2);

  // Segunda execução não gera novos eventos
  const r2 = await migrarAvaliacoesLegadas({ dataRoot, host: 'test-host', now: NOW });
  assert.equal(r2.novos_eventos, 0);

  const { eventos } = await readEvents(dataRoot);
  const eventosAvaliacao = eventos.filter(e => e.tipo === 'empresa.avaliada');
  assert.equal(eventosAvaliacao.length, 2);
});

test('teste de não-perda: projeção subsequente mantém avaliações nas vagas', async t => {
  const dataRoot = await tempDir(t);
  const pipeline = makePipelineLegado();

  await importPipeline({ dataRoot, pipeline, host: 'test-host', ts: NOW });
  await migrarAvaliacoesLegadas({ dataRoot, host: 'test-host', now: NOW });

  const { eventos } = await readEvents(dataRoot);
  const doc = projectEvents(eventos, { now: new Date(NOW) });

  const v1 = doc.vagas.find(v => v.id === 'vaga-01');
  assert.ok(v1.empresa_avaliacao);
  assert.equal(v1.empresa_avaliacao.nota, 4.2);

  const v2 = doc.vagas.find(v => v.id === 'vaga-02');
  assert.ok(v2.empresa_avaliacao);
  assert.equal(v2.empresa_avaliacao.nota, 4.2);

  const v3 = doc.vagas.find(v => v.id === 'vaga-03');
  assert.ok(v3.empresa_avaliacao);
  assert.equal(v3.empresa_avaliacao.nota, 4.8);

  const v4 = doc.vagas.find(v => v.id === 'vaga-04');
  assert.ok(!v4.empresa_avaliacao);
});
