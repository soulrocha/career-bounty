import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';
import { appendEvents } from '../../core/store/events.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00'; // Hoje = 2026-10-18

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
  const api = (urlPath, headers = {}) => fetch(`${panel.url}${urlPath}`, { headers });

  return { dataRoot, panel, token, api };
}

test('GET /api/processos exige token do painel (403 sem token ou inválido)', async t => {
  const env = await setupAmbiente(t);

  const semToken = await env.api('/api/processos');
  assert.equal(semToken.status, 403);
  const errSemToken = await semToken.json();
  assert.equal(errSemToken.erro, 'Acesso inválido.');

  const tokenInvalido = await env.api('/api/processos', { 'x-painel-token': 'token-falso' });
  assert.equal(tokenInvalido.status, 403);

  const comToken = await env.api('/api/processos', { 'x-painel-token': env.token });
  assert.equal(comToken.status, 200);
});

test('GET /api/acompanhamento exige token do painel (403 sem token ou inválido)', async t => {
  const env = await setupAmbiente(t);

  const semToken = await env.api('/api/acompanhamento');
  assert.equal(semToken.status, 403);

  const comToken = await env.api('/api/acompanhamento', { 'x-painel-token': env.token });
  assert.equal(comToken.status, 200);
});

test('GET /api/processos suporta filtros ?situacao e ?alerta', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    // Processo 1: ativo, 2 dias (normal)
    {
      id: 'e1',
      ts: '2026-10-16T10:00:00Z',
      ator: 'usuario',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v1',
      dados: { aplicada: true, data: '2026-10-16' },
    },
    // Processo 2: aguardando_retorno, 5 dias (atencao)
    {
      id: 'e2',
      ts: '2026-10-13T10:00:00Z',
      ator: 'usuario',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v2',
      dados: { aplicada: true, data: '2026-10-13' },
    },
    // Processo 3: encerrado, 10 dias (normal)
    {
      id: 'e3',
      ts: '2026-10-08T10:00:00Z',
      ator: 'usuario',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v3',
      dados: { aplicada: true, data: '2026-10-08' },
    },
    {
      id: 'e4',
      ts: '2026-10-09T10:00:00Z',
      ator: 'usuario',
      tipo: 'processo.encerrado',
      entidade: 'processo',
      entidade_id: 'v3',
      dados: { vaga_id: 'v3', desfecho: 'reprovado', data: '2026-10-09' },
    },
  ];
  await appendEvents(env.dataRoot, eventos, { now: NOW });

  // Sem filtro
  const todos = await (await env.api('/api/processos', { 'x-painel-token': env.token })).json();
  assert.equal(todos.total, 3);

  // Filtro por situacao=encerrado
  const encerrados = await (await env.api('/api/processos?situacao=encerrado', { 'x-painel-token': env.token })).json();
  assert.equal(encerrados.total, 1);
  assert.equal(encerrados.processos[0].vaga_id, 'v3');

  // Filtro por alerta=atencao
  const emAtencao = await (await env.api('/api/processos?alerta=atencao', { 'x-painel-token': env.token })).json();
  assert.equal(emAtencao.total, 1);
  assert.equal(emAtencao.processos[0].vaga_id, 'v2');
});

test('GET /api/acompanhamento retorna apenas processos pendentes de inatividade', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    // Recente (2 dias) -> alerta normal
    {
      id: 'e-rec',
      ts: '2026-10-16T10:00:00Z',
      ator: 'usuario',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v-rec',
      dados: { aplicada: true, data: '2026-10-16' },
    },
    // Lembrar (8 dias) -> alerta lembrar
    {
      id: 'e-lem',
      ts: '2026-10-10T10:00:00Z',
      ator: 'usuario',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v-lem',
      dados: { aplicada: true, data: '2026-10-10' },
    },
    // Encerrado -> alerta normal
    {
      id: 'e-enc-1',
      ts: '2026-10-01T10:00:00Z',
      ator: 'usuario',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v-enc',
      dados: { aplicada: true, data: '2026-10-01' },
    },
    {
      id: 'e-enc-2',
      ts: '2026-10-02T10:00:00Z',
      ator: 'usuario',
      tipo: 'processo.encerrado',
      entidade: 'processo',
      entidade_id: 'v-enc',
      dados: { vaga_id: 'v-enc', desfecho: 'cancelado', data: '2026-10-02' },
    },
  ];
  await appendEvents(env.dataRoot, eventos, { now: NOW });

  const res = await env.api('/api/acompanhamento', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.pendentes.length, 1);
  assert.equal(data.pendentes[0].vaga_id, 'v-lem');
  assert.equal(data.pendentes[0].alerta, 'lembrar');
});

test('teste de privacidade: mascaramento recursivo de qualquer PII em notas, detalhes e resumos', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    {
      id: 'pii-1',
      ts: '2026-10-10T10:00:00Z',
      ator: 'usuario',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'vaga-pii',
      dados: { aplicada: true, data: '2026-10-10' },
    },
    {
      id: 'pii-2',
      ts: '2026-10-12T10:00:00Z',
      ator: 'usuario',
      tipo: 'processo.etapa',
      entidade: 'processo',
      entidade_id: 'vaga-pii',
      dados: {
        vaga_id: 'vaga-pii',
        etapa: 'entrevista_rh',
        data: '2026-10-12',
        detalhe: `Ligar para a recrutadora no telefone (11) 9${'8765'}-${'4321'} ou email maria.silva@tech.test`,
      },
    },
    {
      id: 'pii-3',
      ts: '2026-10-14T10:00:00Z',
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-pii',
      dados: {
        vaga_id: 'vaga-pii',
        canal: 'whatsapp',
        direcao: 'recebido',
        data: '2026-10-14',
        resumo: `Mensagem recebida de +55 21 9${'9999'}-${'8877'} confirmando envio`,
      },
    },
  ];
  await appendEvents(env.dataRoot, eventos, { now: NOW });

  const res = await env.api('/api/processos', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);
  const data = await res.json();
  const jsonString = JSON.stringify(data);

  // Nenhum telefone ou email explícito pode vazar na resposta da API
  assert.doesNotMatch(jsonString, new RegExp(`9${'8765'}-${'4321'}`));
  assert.doesNotMatch(jsonString, /maria\.silva@tech\.test/);
  assert.doesNotMatch(jsonString, new RegExp(`9${'9999'}-${'8877'}`));

  // Deve conter o padrão mascarado
  assert.match(jsonString, /\(11\) 9\*\*\*\*-\*\*21/);
  assert.match(jsonString, /m\*\*\*@tech\.test/);
  assert.match(jsonString, /\(21\) 9\*\*\*\*-\*\*77/);
});
