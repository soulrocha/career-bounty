import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, validateSettings } from '../../core/config.mjs';
import { buildDigest } from '../../core/score/digest.mjs';
import { selecionarEmpresasParaAvaliar, executarAvaliacoesDaily } from '../../core/company/daily.mjs';
import { tempDir } from '../helpers/cli.mjs';
import { appendEvents, readEvents } from '../../core/store/events.mjs';

const NOW = new Date('2026-10-18T15:00:00.000Z');

test('config.mjs possui valores padrão e validação para avaliacoes', () => {
  const padrao = defaultSettings();
  assert.deepEqual(padrao.avaliacoes, {
    teto_diario: 5,
    validade_dias: 90,
    aderencias_alvo: ['alta', 'boa']
  });

  // Validação aceita valores válidos
  const custom = validateSettings({
    avaliacoes: {
      teto_diario: 10,
      validade_dias: 60,
      aderencias_alvo: ['alta']
    }
  });
  assert.equal(custom.avaliacoes.teto_diario, 10);
  assert.equal(custom.avaliacoes.validade_dias, 60);
  assert.deepEqual(custom.avaliacoes.aderencias_alvo, ['alta']);

  // Validação rejeita teto_diario < 1 ou não inteiro
  assert.throws(() => validateSettings({ avaliacoes: { teto_diario: 0 } }), /teto_diario/);
  assert.throws(() => validateSettings({ avaliacoes: { teto_diario: 2.5 } }), /teto_diario/);

  // Validação rejeita validade_dias < 1
  assert.throws(() => validateSettings({ avaliacoes: { validade_dias: -1 } }), /validade_dias/);
});

test('selecionarEmpresasParaAvaliar filtra aderência, vigência e respeita teto diário', () => {
  const vagas = [
    { id: 'v1', empresa: 'Empresa Alfa', aderencia: 'alta', url_status: 'aberta' },
    { id: 'v2', empresa: 'Empresa Beta', aderencia: 'boa', url_status: 'aberta' },
    { id: 'v3', empresa: 'Empresa Gama', aderencia: 'condicional', url_status: 'aberta' }, // fora das aderências alvo
    { id: 'v4', empresa: 'Empresa Delta', aderencia: 'alta', descarte_usuario: { descartada: true } }, // descartada
    { id: 'v5', empresa: 'Empresa Épsilon', aderencia: 'alta', url_status: 'aberta' },
    { id: 'v6', empresa: 'Empresa 01', aderencia: 'alta', url_status: 'aberta' },
    { id: 'v7', empresa: 'Empresa 02', aderencia: 'alta', url_status: 'aberta' }
  ];

  // Projeção onde Empresa Alfa já possui avaliação vigente (< 90 dias)
  // e Empresa Beta possui avaliação expirada
  const projAvaliacoes = {
    por_empresa: {
      empresaalfa: { valida: true, dias_decorridos: 10 },
      empresabeta: { valida: false, expirada: true, dias_decorridos: 95 }
    }
  };

  const settings = {
    avaliacoes: {
      teto_diario: 3,
      validade_dias: 90,
      aderencias_alvo: ['alta', 'boa']
    }
  };

  const selecionadas = selecionarEmpresasParaAvaliar({ vagas, projAvaliacoes, settings });

  // Empresa Alfa ignorada (já é válida)
  // Empresa Beta incluída (expirada)
  // Empresa Gama ignorada (condicional)
  // Empresa Delta ignorada (descartada)
  // Empresa Épsilon, 01, 02 incluídas
  // Teto é 3: deve retornar 3 empresas
  assert.equal(selecionadas.length, 3);
  assert.deepEqual(selecionadas.map(s => s.empresa), ['Empresa Beta', 'Empresa Épsilon', 'Empresa 01']);
});

test('buildDigest inclui seção de avaliações de empresas da rodada', () => {
  const rodada = {
    ts: '2026-10-18T10:00:00.000Z',
    novas_ids: [],
    avaliadas_ids: [],
    fontes: []
  };

  const avaliacoes = [
    { empresa: 'Empresa Alfa', nota: 4.2, plataforma: 'Glassdoor', quantidade: 150 },
    { empresa: 'Empresa Beta', nota: 4.5, plataforma: 'Indeed', quantidade: 80 }
  ];

  const digest = buildDigest({ rodada, projecao: [], avaliacoes });

  assert.match(digest.texto, /## Avaliações de empresas da rodada \(2\)/);
  assert.match(digest.texto, /- Empresa Alfa: 4.2 \(Glassdoor, 150 avaliações\)/);
  assert.match(digest.texto, /- Empresa Beta: 4.5 \(Indeed, 80 avaliações\)/);
});

test('executarAvaliacoesDaily é resiliente a falhas individuais e grava eventos de sucesso', async t => {
  const dataRoot = await tempDir(t);

  // Inicializa log com 2 vagas: Empresa Alfa e Empresa Beta
  await appendEvents(dataRoot, [
    {
      id: 'legado:teste',
      ts: NOW.toISOString(),
      host: 'test-host',
      seq: 1,
      ator: 'migracao',
      tipo: 'legado.importado',
      entidade: 'pipeline',
      entidade_id: 'legado',
      dados: {
        sourceHash: 'sha256-xxx',
        legado: {
          schema_version: 1,
          atualizado: '2026-10-18',
          vagas: [
            { id: 'vaga-alfa', empresa: 'Empresa Alfa', cargo: 'Dev', url: 'https://example.com/1', aderencia: 'alta', url_status: 'aberta' },
            { id: 'vaga-beta', empresa: 'Empresa Beta', cargo: 'Dev', url: 'https://example.com/2', aderencia: 'alta', url_status: 'aberta' }
          ]
        }
      }
    }
  ]);

  const runner = {
    async run({ entrada }) {
      if (entrada.empresa === 'Empresa Alfa') {
        return {
          json: {
            sucesso: true,
            empresa: 'Empresa Alfa',
            nota: 4.3,
            quantidade: 100,
            plataforma: 'Glassdoor',
            fontes: [{ url: 'https://example.com/alfa', plataforma: 'Glassdoor' }],
            data: '2026-10-18'
          }
        };
      }
      // Empresa Beta falha na LLM
      return {
        json: {
          sucesso: false,
          motivo: 'Sem dados suficientes.'
        }
      };
    }
  };

  const fakeSearch = async () => [{ url: 'https://example.com/alfa' }];

  const resultado = await executarAvaliacoesDaily({
    dataRoot,
    settings: {
      avaliacoes: {
        teto_diario: 5,
        validade_dias: 90,
        aderencias_alvo: ['alta', 'boa']
      }
    },
    runner,
    searchImpl: fakeSearch,
    now: NOW
  });

  assert.equal(resultado.avaliadas.length, 1);
  assert.equal(resultado.avaliadas[0].empresa, 'Empresa Alfa');
  assert.equal(resultado.falhas.length, 1);
  assert.equal(resultado.falhas[0].empresa, 'Empresa Beta');

  // Confere que evento de Empresa Alfa foi gravado no log
  const { eventos } = await readEvents(dataRoot);
  const evAlfa = eventos.find(e => e.tipo === 'empresa.avaliada' && e.entidade_id === 'empresaalfa');
  assert.ok(evAlfa);
});
