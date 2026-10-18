import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';
import { appendEvents } from '../../core/store/events.mjs';
import { projectHistorico } from '../../core/store/projections/historico.mjs';
import { planejarAplicacao, planApply } from '../../core/apply/plan.mjs';
import { defaultSettings } from '../../core/config.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00'; // São Paulo

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

  const panel = await startPanel({
    dataRoot,
    port: 0,
    now: () => NOW,
  });
  t.after(panel.close);

  const pagina = await (await fetch(panel.url)).text();
  const tokenMatch = /window\.PAINEL_API=(\{[^;]+\});/.exec(pagina);
  const token = JSON.parse(tokenMatch[1]).token;
  const api = (urlPath, headers = {}, options = {}) => fetch(`${panel.url}${urlPath}`, { headers, ...options });

  return { dataRoot, panel, token, api };
}

// -----------------------------------------------------------------------------
// ADVERSARIAL 1: Linha do tempo, agregação de todos os tipos e ordenação estrita
// -----------------------------------------------------------------------------
test('ADVERSARIAL: Linha do tempo agrega todos os tipos de eventos na ordem cronológica estrita', () => {
  // Inserção fora de ordem cronológica para testar o algoritmo de ordenação
  const eventos = [
    {
      id: 'e-desc-1',
      ts: '2026-10-01T10:00:00Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'vaga-adv-1',
      dados: { vaga: { empresa: 'Tech Corp', cargo: 'Tech Lead', portal: 'gupy' } },
    },
    {
      id: 'e-desfecho-5',
      ts: '2026-10-20T16:00:00Z',
      tipo: 'processo.encerrado',
      ator: 'cli',
      entidade: 'processo',
      entidade_id: 'vaga-adv-1',
      dados: { vaga_id: 'vaga-adv-1', desfecho: 'aprovado', data: '2026-10-20', nota: 'Oferta aceita' },
    },
    {
      id: 'e-cand-2',
      ts: '2026-10-05T12:00:00Z',
      tipo: 'candidatura.marcada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'vaga-adv-1',
      dados: { aplicada: true, data: '2026-10-05' },
    },
    {
      id: 'e-etapa-4',
      ts: '2026-10-15T14:00:00Z',
      tipo: 'processo.etapa',
      ator: 'cli',
      entidade: 'processo',
      entidade_id: 'vaga-adv-1',
      dados: { vaga_id: 'vaga-adv-1', etapa: 'entrevista_gestor', data: '2026-10-15', detalhe: 'Entrevista técnica final' },
    },
    {
      id: 'e-contato-3',
      ts: '2026-10-10T11:00:00Z',
      tipo: 'contato.registrado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-adv-1',
      dados: {
        id: 'c-adv-1',
        vaga_id: 'vaga-adv-1',
        canal: 'email',
        direcao: 'recebido',
        data: '2026-10-10',
        resumo: 'Agendamento de entrevista',
      },
    },
    {
      id: 'e-descarte-6',
      ts: '2026-10-21T09:00:00Z',
      tipo: 'vaga.descartada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'vaga-adv-1',
      dados: { vaga_id: 'vaga-adv-1', motivo: 'Processo encerrado com sucesso', data: '2026-10-21' },
    },
  ];

  const proj = projectHistorico(eventos, { now: NOW });
  assert.equal(proj.historico.length, 1);
  const vaga = proj.historico[0];

  assert.equal(vaga.vaga_id, 'vaga-adv-1');
  assert.equal(vaga.linha_do_tempo.length, 6);

  // Validar ordem cronológica estrita por data / ts
  const tiposEsperados = ['descoberta', 'candidatura', 'contato', 'etapa', 'desfecho', 'descarte'];
  const datasEsperadas = ['2026-10-01', '2026-10-05', '2026-10-10', '2026-10-15', '2026-10-20', '2026-10-21'];

  for (let i = 0; i < tiposEsperados.length; i++) {
    assert.equal(vaga.linha_do_tempo[i].tipo, tiposEsperados[i], `Item ${i} deve ser ${tiposEsperados[i]}`);
    assert.equal(vaga.linha_do_tempo[i].data, datasEsperadas[i], `Data do item ${i} deve ser ${datasEsperadas[i]}`);
  }

  assert.equal(vaga.ultimo_movimento, '2026-10-21');
  assert.equal(vaga.situacao_processo, 'encerrado');
  assert.equal(vaga.desfecho, 'aprovado');
});

// -----------------------------------------------------------------------------
// ADVERSARIAL 2: contato.removido expurga da linha do tempo mesmo se vinculado
// -----------------------------------------------------------------------------
test('ADVERSARIAL: contato.removido remove o contato da linha do tempo da vaga mesmo se vinculado depois', () => {
  const eventos = [
    {
      id: 'e-desc-1',
      ts: '2026-10-01T10:00:00Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'vaga-expurgo',
      dados: { vaga: { empresa: 'Inovação SA', cargo: 'Engenheiro SRE' } },
    },
    {
      id: 'e-contato-avulso',
      ts: '2026-10-02T10:00:00Z',
      tipo: 'contato.registrado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-avulso-1',
      dados: {
        id: 'c-avulso-1',
        vaga_id: null,
        canal: 'whatsapp',
        direcao: 'recebido',
        data: '2026-10-02',
        resumo: 'Mensagem de spam ou recruiter errado',
      },
    },
    {
      id: 'e-vinc',
      ts: '2026-10-03T10:00:00Z',
      tipo: 'contato.vinculado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-avulso-1',
      dados: { contato_id: 'c-avulso-1', vaga_id: 'vaga-expurgo' },
    },
    {
      id: 'e-removido',
      ts: '2026-10-04T10:00:00Z',
      tipo: 'contato.removido',
      ator: 'cli',
      entidade: 'contato',
      entidade_id: 'c-avulso-1',
      dados: { contato_id: 'c-avulso-1', motivo: 'Spam' },
    },
  ];

  const proj = projectHistorico(eventos, { now: NOW });
  const vaga = proj.historico[0];
  assert.equal(vaga.linha_do_tempo.length, 1);
  assert.equal(vaga.linha_do_tempo[0].tipo, 'descoberta');
  assert.ok(!vaga.linha_do_tempo.some(i => i.id === 'c-avulso-1'));
});

// -----------------------------------------------------------------------------
// ADVERSARIAL 3: Filtros de query na API com entradas malformadas, absurdas e inválidas
// -----------------------------------------------------------------------------
test('ADVERSARIAL: Query params bizarros ou sem match não causam 500 nem travam o servidor', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    {
      id: 'e1',
      ts: '2026-10-10T10:00:00Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'vaga-1',
      dados: { vaga: { empresa: 'Empresa Teste', cargo: 'Dev', portal: 'gupy' } },
    },
  ];
  await appendEvents(env.dataRoot, eventos, { now: NOW });

  // 1. Data início maior que data fim
  const rInvertido = await env.api('/api/historico?inicio=2026-12-31&fim=2026-01-01', { 'x-painel-token': env.token });
  assert.equal(rInvertido.status, 200);
  const jInvertido = await rInvertido.json();
  assert.equal(jInvertido.total, 0);
  assert.deepEqual(jInvertido.historico, []);

  // 2. Data com caracteres especiais / injeção SQL-like ou XSS
  const rInvalido = await env.api('/api/historico?inicio=<script>alert(1)</script>&portal=\' OR 1=1--', { 'x-painel-token': env.token });
  assert.equal(rInvalido.status, 200);
  const jInvalido = await rInvalido.json();
  assert.equal(jInvalido.total, 0);

  // 3. Situação desconhecida
  const rSituacao = await env.api('/api/historico?situacao=alienigena', { 'x-painel-token': env.token });
  assert.equal(rSituacao.status, 200);
  const jSituacao = await rSituacao.json();
  assert.equal(jSituacao.total, 0);

  // 4. Portal em maiúsculas (deve casar case-insensitive)
  const rPortalCase = await env.api('/api/historico?portal=GUPY', { 'x-painel-token': env.token });
  assert.equal(rPortalCase.status, 200);
  const jPortalCase = await rPortalCase.json();
  assert.equal(jPortalCase.total, 1);
  assert.equal(jPortalCase.historico[0].vaga_id, 'vaga-1');
});

// -----------------------------------------------------------------------------
// ADVERSARIAL 4: Invasão e vazamento de PII complexos (Fuzzing de Telefones e E-mails)
// -----------------------------------------------------------------------------
test('ADVERSARIAL: Fuzzing de PII (telefones internacionais, nacionais variados e emails complexos) NUNCA vazam', async t => {
  const env = await setupAmbiente(t);

  const telefonesAtaque = [
    `+55 11 9${'8888'}-${'1122'}`,
    `+55 (21) 9${'7777'}-${'3344'}`,
    `+55119${'9999'}5566`,
    `(31) 9${'6666'}-${'7788'}`,
    `(41) 9${'5555'}8899`,
    `11 9${'4444'}-${'1234'}`,
    `19.9${'3333'}.5678`,
    `+1 415 555 0199`,
    `+44 20 7946 0958`,
    `+351 912 345 678`,
  ];

  const emailsAtaque = [
    'recruiter.lead+rh_test-tag@corp.global.company.test',
    'maria_recruiter.123@sub.dominio.test',
    'talents-br@recruitment-specialists.test',
    'rh@empresa.test',
  ];

  const eventos = [
    {
      id: 'e-vaga-pii',
      ts: '2026-10-10T10:00:00Z',
      tipo: 'vaga.descoberta',
      ator: 'radar',
      entidade: 'vaga',
      entidade_id: 'v-ataque-pii',
      dados: {
        vaga: {
          empresa: `Tech Empresa com email ${emailsAtaque[0]}`,
          cargo: `Especialista ligar ${telefonesAtaque[0]}`,
          portal: 'gupy',
        },
      },
    },
    {
      id: 'e-contato-pii-1',
      ts: '2026-10-12T10:00:00Z',
      tipo: 'contato.registrado',
      ator: 'painel',
      entidade: 'contato',
      entidade_id: 'c-ataque-pii-1',
      dados: {
        id: 'c-ataque-pii-1',
        vaga_id: 'v-ataque-pii',
        canal: 'whatsapp',
        direcao: 'recebido',
        data: '2026-10-12',
        resumo: `Recrutador entrou em contato usando ${telefonesAtaque[1]} e ${emailsAtaque[1]} e internacional ${telefonesAtaque[7]}`,
        pergunta: `Você confirma disponibilidade pelo telefone ${telefonesAtaque[2]} ou ${emailsAtaque[2]}?`,
        endereco: telefonesAtaque[3],
        pessoa: {
          nome: `Recrutador ${emailsAtaque[3]}`,
          papel: `Headhunter ${telefonesAtaque[4]}`,
        },
        proxima_etapa: {
          texto: `Entrevista ligando para ${telefonesAtaque[5]} ou ${telefonesAtaque[8]}`,
          data: '2026-10-25',
        },
      },
    },
    {
      id: 'e-email-pii',
      ts: '2026-10-14T10:00:00Z',
      tipo: 'email.recebido',
      ator: 'radar',
      entidade: 'email',
      entidade_id: 'v-ataque-pii',
      dados: {
        vaga_id: 'v-ataque-pii',
        etapa: 'triagem',
        assunto: `Avanço no processo - retorno para ${telefonesAtaque[6]} e ${telefonesAtaque[9]}`,
        data_email: '2026-10-14',
      },
    },
    {
      id: 'e-desfecho-pii',
      ts: '2026-10-16T10:00:00Z',
      tipo: 'processo.encerrado',
      ator: 'cli',
      entidade: 'processo',
      entidade_id: 'v-ataque-pii',
      dados: {
        vaga_id: 'v-ataque-pii',
        desfecho: 'reprovado',
        data: '2026-10-16',
        nota: `Desfecho comunicado pelo telefone ${telefonesAtaque[0]}`,
      },
    },
    {
      id: 'e-descarte-pii',
      ts: '2026-10-17T10:00:00Z',
      tipo: 'vaga.descartada',
      ator: 'painel',
      entidade: 'vaga',
      entidade_id: 'v-ataque-pii',
      dados: {
        vaga_id: 'v-ataque-pii',
        data: '2026-10-17',
        motivo: `Descartada após contato com ${emailsAtaque[0]}`,
      },
    },
  ];

  await appendEvents(env.dataRoot, eventos, { now: NOW });

  const res = await env.api('/api/historico', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);
  const texto = await res.text();

  // Teste de contenção estrita: nenhum e-mail ou telefone cru pode estar no texto JSON da resposta
  for (const tel of telefonesAtaque) {
    const rawMatch = tel.replace(/[-+()\s.]/g, '');
    assert.ok(!texto.includes(tel), `Telefone cru vazou na resposta: ${tel}`);
  }

  for (const em of emailsAtaque) {
    const userPart = em.split('@')[0];
    assert.ok(!texto.includes(em), `Email cru vazou na resposta: ${em}`);
    assert.ok(!texto.includes(userPart + '@'), `Prefixo de email cru vazou na resposta: ${userPart}`);
  }
});

// -----------------------------------------------------------------------------
// ADVERSARIAL 5: Segurança de acesso e métodos HTTP não permitidos
// -----------------------------------------------------------------------------
test('ADVERSARIAL: GET /api/historico sem token ou com método não GET responde 403 / 405', async t => {
  const env = await setupAmbiente(t);

  // Sem token
  const rSemToken = await env.api('/api/historico');
  assert.equal(rSemToken.status, 403);

  // Token inválido
  const rTokenInvalido = await env.api('/api/historico', { 'x-painel-token': 'token-falso-123' });
  assert.equal(rTokenInvalido.status, 403);

  // POST em rota somente GET
  const rPost = await env.api('/api/historico', { 'x-painel-token': env.token }, { method: 'POST' });
  assert.ok([403, 405].includes(rPost.status), 'POST em rota GET deve responder 403 ou 405');

  // PUT em rota somente GET
  const rPut = await env.api('/api/historico', { 'x-painel-token': env.token }, { method: 'PUT' });
  assert.ok([403, 405].includes(rPut.status), 'PUT em rota GET deve responder 403 ou 405');
});

// -----------------------------------------------------------------------------
// ADVERSARIAL 6: Garantia de não-regressão (/api/fila e core/apply/plan.mjs)
// -----------------------------------------------------------------------------
test('NÃO-REGRESSÃO: GET /api/fila continua 100% íntegro e funcional', async t => {
  const env = await setupAmbiente(t);

  const resSemToken = await env.api('/api/fila');
  assert.equal(resSemToken.status, 403);

  const resComToken = await env.api('/api/fila', { 'x-painel-token': env.token });
  assert.equal(resComToken.status, 200);
  const j = await resComToken.json();
  assert.ok(j !== null && typeof j === 'object');
  assert.ok(Array.isArray(j.fila));
});

test('NÃO-REGRESSÃO: core/apply/plan.mjs funciona perfeitamente', async t => {
  const dataRoot = await tempDir(t);
  await mkdir(path.join(dataRoot, 'events'), { recursive: true });

  const settings = defaultSettings();
  const plano = planApply(settings);
  assert.equal(plano.acao, 'parar_antes_de_enviar');
  assert.equal(typeof plano.regras_ativas, 'number');

  const resultado = await planejarAplicacao({
    dataRoot,
    settings,
    paraLote: false,
    agora: NOW,
  });

  assert.equal(resultado.acao, 'parar_antes_de_enviar');
  assert.ok(Array.isArray(resultado.fila));
  assert.ok(Array.isArray(resultado.excluidas));
});
