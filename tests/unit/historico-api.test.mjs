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

test('GET /api/historico exige token do painel (403 sem token ou inválido)', async t => {
  const env = await setupAmbiente(t);

  const semToken = await env.api('/api/historico');
  assert.equal(semToken.status, 403);
  const errSemToken = await semToken.json();
  assert.equal(errSemToken.erro, 'Acesso inválido.');

  const tokenInvalido = await env.api('/api/historico', { 'x-painel-token': 'token-falso' });
  assert.equal(tokenInvalido.status, 403);

  const comToken = await env.api('/api/historico', { 'x-painel-token': env.token });
  assert.equal(comToken.status, 200);
});

test('GET /api/historico retorna 200 OK com historico, totais e total', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    {
      id: 'e1',
      ts: '2026-10-10T10:00:00Z',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: 'v1',
      dados: { vaga: { empresa: 'Alpha Corp', cargo: 'Dev Senior', portal: 'gupy' } },
    },
    {
      id: 'e2',
      ts: '2026-10-12T14:00:00Z',
      ator: 'painel',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v1',
      dados: { aplicada: true, data: '2026-10-12' },
    },
  ];
  await appendEvents(env.dataRoot, eventos, { now: NOW });

  const res = await env.api('/api/historico', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);
  const corpo = await res.json();
  assert.ok(Array.isArray(corpo.historico));
  assert.equal(corpo.total, 1);
  assert.equal(corpo.totais.total, 1);
  assert.equal(corpo.totais.aguardando_retorno, 1);
  assert.equal(corpo.historico[0].vaga_id, 'v1');
  assert.equal(corpo.historico[0].linha_do_tempo.length, 2);
});

test('GET /api/historico suporta query params ?inicio=...&fim=...&situacao=...&portal=...', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    // Vaga 1: Gupy, ativa, descoberta em 2026-10-05
    {
      id: 'e1',
      ts: '2026-10-05T10:00:00Z',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: 'v-gupy-ativa',
      dados: { vaga: { empresa: 'Gupy Empresa', cargo: 'Engenheiro', portal: 'gupy' } },
    },
    // Vaga 2: Greenhouse, aguardando_retorno, candidatura em 2026-10-12
    {
      id: 'e2',
      ts: '2026-10-08T10:00:00Z',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: 'v-green-ret',
      dados: { vaga: { empresa: 'Green Empresa', cargo: 'Tech Lead', portal: 'greenhouse' } },
    },
    {
      id: 'e3',
      ts: '2026-10-12T10:00:00Z',
      ator: 'painel',
      tipo: 'candidatura.marcada',
      entidade: 'vaga',
      entidade_id: 'v-green-ret',
      dados: { aplicada: true, data: '2026-10-12' },
    },
    // Vaga 3: Gupy, descartada (encerrado) em 2026-10-16
    {
      id: 'e4',
      ts: '2026-10-10T10:00:00Z',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: 'v-gupy-desc',
      dados: { vaga: { empresa: 'Gupy Descarte', cargo: 'Dev Pleno', portal: 'gupy' } },
    },
    {
      id: 'e5',
      ts: '2026-10-16T10:00:00Z',
      ator: 'painel',
      tipo: 'vaga.descartada',
      entidade: 'vaga',
      entidade_id: 'v-gupy-desc',
      dados: { vaga_id: 'v-gupy-desc', data: '2026-10-16' },
    },
  ];
  await appendEvents(env.dataRoot, eventos, { now: NOW });

  // 1. Filtro portal=greenhouse
  const resPortal = await (await env.api('/api/historico?portal=greenhouse', { 'x-painel-token': env.token })).json();
  assert.equal(resPortal.total, 1);
  assert.equal(resPortal.historico[0].vaga_id, 'v-green-ret');

  // 2. Filtro situacao=encerrado
  const resSituacao = await (await env.api('/api/historico?situacao=encerrado', { 'x-painel-token': env.token })).json();
  assert.equal(resSituacao.total, 1);
  assert.equal(resSituacao.historico[0].vaga_id, 'v-gupy-desc');

  // 3. Filtro periodo inicio e fim
  const resPeriodo = await (await env.api('/api/historico?inicio=2026-10-06&fim=2026-10-14', { 'x-painel-token': env.token })).json();
  assert.equal(resPeriodo.total, 1);
  assert.equal(resPeriodo.historico[0].vaga_id, 'v-green-ret');
});

test('teste de invasao/privacidade: nenhum telefone ou email cru vaza na resposta da API', async t => {
  const env = await setupAmbiente(t);

  const telCru = `(11) 9${'9876'}-${'5432'}`;
  const emailCru = 'recruiter.privado@empresa.test';

  const eventos = [
    {
      id: 'e-desc',
      ts: '2026-10-10T10:00:00Z',
      ator: 'radar',
      tipo: 'vaga.descoberta',
      entidade: 'vaga',
      entidade_id: 'v-privacidade',
      dados: {
        vaga: {
          empresa: `Empresa Gama ${emailCru}`,
          cargo: `Dev Staff - ligar ${telCru}`,
          portal: 'gupy',
        },
      },
    },
    {
      id: 'e-contato',
      ts: '2026-10-14T10:00:00Z',
      ator: 'painel',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'c-privacidade',
      dados: {
        id: 'c-privacidade',
        vaga_id: 'v-privacidade',
        canal: 'whatsapp',
        direcao: 'recebido',
        data: '2026-10-14',
        resumo: `Mensagem direta via WhatsApp de ${telCru} e email alternativo ${emailCru}`,
        pergunta: `Confirma recebimento no ${emailCru}?`,
        endereco: telCru,
        pessoa: { nome: `Recrutador ${emailCru}`, papel: 'HR Business Partner' },
      },
    },
  ];
  await appendEvents(env.dataRoot, eventos, { now: NOW });

  const res = await env.api('/api/historico', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);
  const textoResposta = await res.text();

  // Teste estrito: nem o telefone cru nem o email cru devem aparecer em qualquer lugar da resposta!
  assert.ok(!textoResposta.includes(`9${'9876'}-${'5432'}`), 'Telefone cru vazou na resposta HTTP!');
  assert.ok(!textoResposta.includes('recruiter.privado@'), 'Email cru vazou na resposta HTTP!');

  // Formatos mascarados devem estar presentes
  assert.ok(textoResposta.includes('9****-**32'), 'Telefone mascarado esperado');
  assert.ok(textoResposta.includes('r***@empresa.test'), 'Email mascarado esperado');
});
