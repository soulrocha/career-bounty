import assert from 'node:assert/strict';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { readEvents } from '../../core/store/events.mjs';
import { avaliarEmpresa } from '../../core/company/evaluator.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00';

async function ambiente(t) {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot }).status, 0);
  return dataRoot;
}

test('empresa registrar grava evento empresa.avaliada com flags completas', async t => {
  const dataRoot = await ambiente(t);

  const res = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '4.3',
    '--quantidade', '150',
    '--fonte', 'https://example.com/avaliacoes/empresa-alfa',
    '--plataforma', 'Glassdoor',
    '--resumo', 'Excelente ambiente para engenharia.',
    '--data', '2026-10-18',
    '--validade', '90',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json?.ok, true);
  assert.equal(res.json?.empresa, 'Empresa Alfa');
  assert.equal(res.json?.nota, 4.3);
  assert.equal(res.json?.quantidade, 150);
  assert.equal(res.json?.plataforma, 'Glassdoor');

  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'empresa.avaliada');
  assert.ok(ev);
  assert.equal(ev.ator, 'usuario');
  assert.equal(ev.entidade_id, 'empresaalfa');
  assert.equal(ev.dados.empresa, 'Empresa Alfa');
  assert.equal(ev.dados.nota, 4.3);
  assert.equal(ev.dados.quantidade, 150);
  assert.equal(ev.dados.plataforma, 'Glassdoor');
  assert.equal(ev.dados.resumo, 'Excelente ambiente para engenharia.');
  assert.deepEqual(ev.dados.fontes, [{ url: 'https://example.com/avaliacoes/empresa-alfa', plataforma: 'Glassdoor' }]);
});

test('empresa registrar infere plataforma automaticamente a partir do domínio da fonte', async t => {
  const dataRoot = await ambiente(t);

  const res = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Beta',
    '--nota', '4.0',
    '--quantidade', '50',
    '--fonte', 'https://www.indeed.com.br/cmp/Empresa-Beta',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json?.plataforma, 'Indeed');

  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'empresa.avaliada' && e.entidade_id === 'empresabeta');
  assert.ok(ev);
  assert.equal(ev.dados.plataforma, 'Indeed');
});

test('empresa registrar valida campos obrigatórios e rejeita dados inválidos', async t => {
  const dataRoot = await ambiente(t);

  // Sem empresa
  const semEmpresa = run([
    'empresa', 'registrar',
    '--nota', '4.0',
    '--quantidade', '50',
    '--fonte', 'https://example.com/fonte',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });
  assert.notEqual(semEmpresa.status, 0);

  // Nota inválida (> 5.0)
  const notaInvalida = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '5.5',
    '--quantidade', '50',
    '--fonte', 'https://example.com/fonte',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });
  assert.notEqual(notaInvalida.status, 0);

  // Sem fonte
  const semFonte = run([
    'empresa', 'registrar',
    '--empresa', 'Empresa Alfa',
    '--nota', '4.0',
    '--quantidade', '50',
    '--now', NOW,
    '--teste',
    '--json',
  ], { dataRoot, env: { CAREER_BOUNTY_NOW: NOW } });
  assert.notEqual(semFonte.status, 0);
});

test('avaliarEmpresa via subagente com runner fake extrai e grava avaliação', async t => {
  const dataRoot = await ambiente(t);

  const runnerFake = {
    async run({ agente, entrada }) {
      assert.equal(agente, 'avaliador-empresa');
      return {
        json: {
          sucesso: true,
          empresa: entrada.empresa,
          nota: 4.5,
          quantidade: 200,
          plataforma: 'Glassdoor',
          fontes: [{ url: 'https://example.com/busca-alfa', plataforma: 'Glassdoor' }],
          resumo: 'Excelente liderança técnica e autonomia.',
          data: '2026-10-18'
        }
      };
    }
  };

  const fakeSearch = async query => {
    assert.match(query, /Empresa Alfa/);
    return [{ title: 'Empresa Alfa Avaliações', snippet: 'Nota 4.5...', url: 'https://example.com/busca-alfa' }];
  };

  const dados = await avaliarEmpresa({
    empresa: 'Empresa Alfa',
    dataRoot,
    runner: runnerFake,
    searchImpl: fakeSearch,
    now: new Date(NOW)
  });

  assert.equal(dados.empresa, 'Empresa Alfa');
  assert.equal(dados.nota, 4.5);
  assert.equal(dados.quantidade, 200);

  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'empresa.avaliada');
  assert.ok(ev);
  assert.equal(ev.ator, 'radar');
  assert.equal(ev.dados.nota, 4.5);
});

test('avaliarEmpresa recusa avaliação quando o subagente não encontra fontes ou retorna sucesso: false', async t => {
  const dataRoot = await ambiente(t);

  const runnerRecusa = {
    async run() {
      return {
        json: {
          sucesso: false,
          motivo: 'Nenhuma avaliação encontrada na busca pública.'
        }
      };
    }
  };

  await assert.rejects(
    async () => {
      await avaliarEmpresa({
        empresa: 'Empresa Gama',
        dataRoot,
        runner: runnerRecusa,
        searchImpl: async () => [],
        now: new Date(NOW)
      });
    },
    /Avaliação recusada/i
  );

  const { eventos } = await readEvents(dataRoot);
  assert.equal(eventos.filter(e => e.tipo === 'empresa.avaliada').length, 0);
});
