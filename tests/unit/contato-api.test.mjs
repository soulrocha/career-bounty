import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';
import { appendEvents } from '../../core/store/events.mjs';

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

  const panel = await startPanel({
    dataRoot,
    port: 0,
    now: () => NOW,
  });
  t.after(panel.close);

  const pagina = await (await fetch(panel.url)).text();
  const tokenMatch = /window\.PAINEL_API=(\{[^;]+\});/.exec(pagina);
  const token = JSON.parse(tokenMatch[1]).token;
  const api = (urlPath = '/api/contatos', headers = {}) => fetch(`${panel.url}${urlPath}`, { headers });

  return { dataRoot, panel, token, api };
}

test('GET /api/contatos exige token do painel (403 sem token ou inválido)', async t => {
  const env = await setupAmbiente(t);

  const semToken = await env.api('/api/contatos');
  assert.equal(semToken.status, 403);
  const errSemToken = await semToken.json();
  assert.equal(errSemToken.erro, 'Acesso inválido.');

  const tokenInvalido = await env.api('/api/contatos', { 'x-painel-token': 'token-falso' });
  assert.equal(tokenInvalido.status, 403);

  const comToken = await env.api('/api/contatos', { 'x-painel-token': env.token });
  assert.equal(comToken.status, 200);
});

test('GET /api/contatos retorna dados no contrato e mascaramento estrito de PII', async t => {
  const env = await setupAmbiente(t);

  // Insere eventos com dados sensíveis
  const eventos = [
    {
      id: 'contato.registrado:1',
      ts: '2026-10-18T10:00:00.000-03:00',
      host: 'host-teste',
      seq: 1,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-1',
      dados: {
        id: 'con-1',
        vaga_id: 'vaga-corp-tech-01',
        canal: 'whatsapp',
        direcao: 'recebido',
        pessoa: { nome: 'Mariana Recruiter', papel: 'Tech Recruiter' },
        resumo: `Abordagem via ${'mariana.recruiter'}@${'tech.test'} ou ligue (11) 9${'8765'}-${'4321'} com urgência`,
        pergunta: `Disponibilidade para falar no whats (11) 9${'8765'}-${'4321'}?`,
        proxima_etapa: { texto: 'Alinhamento com gestor', data: '2026-10-24' },
        data: '2026-10-18',
        endereco: `(11) 9${'8765'}-${'4321'}`,
      },
      evidencia: [],
    },
    {
      id: 'contato.registrado:2',
      ts: '2026-10-15T09:00:00.000-03:00',
      host: 'host-teste',
      seq: 2,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-2',
      dados: {
        id: 'con-2',
        vaga_id: null,
        canal: 'email',
        direcao: 'recebido',
        pessoa: { nome: 'Rodrigo Santos', papel: 'Headhunter' },
        resumo: 'Sondagem de perfil reservado',
        data: '2026-10-15',
        endereco: 'rodrigo.santos@consultoria.test',
      },
      evidencia: [],
    },
  ];

  await appendEvents(env.dataRoot, eventos, { now: NOW, host: 'host-teste' });

  const res = await env.api('/api/contatos', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);

  const corpoRaw = await res.text();
  // Teste de ataque PII: nenhum dado sensivel desmascarado pode estar na resposta
  assert.ok(!corpoRaw.includes(`${'mariana.recruiter'}@`), 'mariana.recruiter@ não deve estar na resposta crua');
  assert.ok(!corpoRaw.includes('rodrigo.santos@'), 'rodrigo.santos@ não deve estar na resposta crua');
  assert.ok(!corpoRaw.includes(`9${'8765'}-${'4321'}`), '98765-4321 não deve estar na resposta crua');

  // Parse do JSON
  const dados = JSON.parse(corpoRaw);
  assert.equal(dados.total, 2);
  assert.equal(dados.contatos.length, 2);
  assert.ok(dados.por_vaga['vaga-corp-tech-01']);
  assert.ok(dados.por_pessoa['mariana-recruiter']);

  const con1 = dados.contatos.find(c => c.id === 'con-1');
  assert.equal(con1.endereco, '(11) 9****-**21');
  assert.equal(con1.resumo, 'Abordagem via m***@tech.test ou ligue (11) 9****-**21 com urgência');
  assert.equal(con1.pergunta, 'Disponibilidade para falar no whats (11) 9****-**21?');

  const con2 = dados.contatos.find(c => c.id === 'con-2');
  assert.equal(con2.endereco, 'r***@consultoria.test');
});

test('GET /api/contatos suporta query params ?vaga=<id> e ?ativos=1', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    {
      id: 'contato.registrado:1',
      ts: '2026-08-01T10:00:00.000-03:00',
      host: 'host-teste',
      seq: 1,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-antigo',
      dados: {
        id: 'con-antigo',
        vaga_id: 'vaga-a',
        canal: 'email',
        direcao: 'recebido',
        resumo: 'Contato antigo de agosto',
        data: '2026-08-01',
      },
      evidencia: [],
    },
    {
      id: 'contato.registrado:2',
      ts: '2026-10-18T10:00:00.000-03:00',
      host: 'host-teste',
      seq: 2,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-recente-a',
      dados: {
        id: 'con-recente-a',
        vaga_id: 'vaga-a',
        canal: 'linkedin',
        direcao: 'enviado',
        resumo: 'Contato recente vaga A',
        data: '2026-10-18',
      },
      evidencia: [],
    },
    {
      id: 'contato.registrado:3',
      ts: '2026-10-17T10:00:00.000-03:00',
      host: 'host-teste',
      seq: 3,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-recente-b',
      dados: {
        id: 'con-recente-b',
        vaga_id: 'vaga-b',
        canal: 'telefone',
        direcao: 'recebido',
        resumo: 'Contato recente vaga B',
        data: '2026-10-17',
      },
      evidencia: [],
    },
  ];

  await appendEvents(env.dataRoot, eventos, { now: NOW, host: 'host-teste' });

  // Filtro por vaga
  const resVaga = await env.api('/api/contatos?vaga=vaga-a', { 'x-painel-token': env.token });
  assert.equal(resVaga.status, 200);
  const dadosVaga = await resVaga.json();
  assert.equal(dadosVaga.total, 2);
  assert.ok(dadosVaga.contatos.every(c => c.vaga_id === 'vaga-a'));

  // Filtro por ativos (exclui o contato antigo de agosto)
  const resAtivos = await env.api('/api/contatos?ativos=1', { 'x-painel-token': env.token });
  assert.equal(resAtivos.status, 200);
  const dadosAtivos = await resAtivos.json();
  assert.equal(dadosAtivos.total, 2);
  assert.ok(!dadosAtivos.contatos.some(c => c.id === 'con-antigo'));

  // Filtro combinado: vaga-a E ativos
  const resCombinado = await env.api('/api/contatos?vaga=vaga-a&ativos=1', { 'x-painel-token': env.token });
  assert.equal(resCombinado.status, 200);
  const dadosCombinado = await resCombinado.json();
  assert.equal(dadosCombinado.total, 1);
  assert.equal(dadosCombinado.contatos[0].id, 'con-recente-a');
});

test('GET /api/contatos não retorna contatos que receberam contato.removido', async t => {
  const env = await setupAmbiente(t);

  const eventos = [
    {
      id: 'contato.registrado:1',
      ts: '2026-10-18T10:00:00.000-03:00',
      host: 'host-teste',
      seq: 1,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-para-remover',
      dados: {
        id: 'con-para-remover',
        vaga_id: 'vaga-x',
        canal: 'linkedin',
        direcao: 'recebido',
        resumo: 'Contato gravado por engano em teste',
        data: '2026-10-18',
      },
      evidencia: [],
    },
    {
      id: 'contato.registrado:2',
      ts: '2026-10-18T11:00:00.000-03:00',
      host: 'host-teste',
      seq: 2,
      ator: 'usuario',
      tipo: 'contato.registrado',
      entidade: 'contato',
      entidade_id: 'con-valido',
      dados: {
        id: 'con-valido',
        vaga_id: 'vaga-x',
        canal: 'email',
        direcao: 'recebido',
        resumo: 'Contato válido e ativo',
        data: '2026-10-18',
      },
      evidencia: [],
    },
    {
      id: 'contato.removido:1',
      ts: '2026-10-18T12:00:00.000-03:00',
      host: 'host-teste',
      seq: 3,
      ator: 'usuario',
      tipo: 'contato.removido',
      entidade: 'contato',
      entidade_id: 'con-para-remover',
      dados: {
        contato_id: 'con-para-remover',
        motivo: 'Exclusão solicitada pelo usuário',
      },
      evidencia: [],
    },
  ];

  await appendEvents(env.dataRoot, eventos, { now: NOW, host: 'host-teste' });

  const res = await env.api('/api/contatos', { 'x-painel-token': env.token });
  assert.equal(res.status, 200);
  const dados = await res.json();
  assert.equal(dados.total, 1);
  assert.equal(dados.contatos.length, 1);
  assert.equal(dados.contatos[0].id, 'con-valido');
  assert.ok(!dados.contatos.some(c => c.id === 'con-para-remover'));
});

