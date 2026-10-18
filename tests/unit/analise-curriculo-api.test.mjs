import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';
import { readEvents } from '../../core/store/events.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const NOW = '2026-10-18T15:00:00.000-03:00';

async function setupAmbiente(t, { modo = 'ativo' } = {}) {
  const dataRoot = await tempDir(t);
  const put = async (relativo, dado) => {
    const alvo = path.join(dataRoot, relativo);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, typeof dado === 'string' ? dado : JSON.stringify(dado));
  };

  await put('state/migration.json', { version: 1, mode: modo, snapshotRoot: null });
  await put('projections/pipeline-vagas.json', { vagas: [] });
  await put('identity.yml', {
    nome: 'Pessoa Teste',
    email: 'pessoa.teste@exemplo.test',
    telefone: '+55' + ' 11 9' + '8888-8888',
    cpf: '000.000.000-00',
  });
  await mkdir(path.join(dataRoot, 'events'), { recursive: true });
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });

  const panel = await startPanel({ dataRoot, port: 0, now: () => NOW });
  t.after(panel.close);

  const pagina = await (await fetch(panel.url)).text();
  const token = JSON.parse(/window\.PAINEL_API=(\{[^;]+\});/.exec(pagina)[1]).token;

  return { dataRoot, panel, token, put };
}

test('GET /api/analise-curriculo exige token e devolve dados com mascaramento de PII', async t => {
  const { panel, token } = await setupAmbiente(t);

  // Sem token -> 403
  const resSemToken = await fetch(`${panel.url}/api/analise-curriculo`);
  assert.equal(resSemToken.status, 403);

  // Token incorreto -> 403
  const resTokenErrado = await fetch(`${panel.url}/api/analise-curriculo`, {
    headers: { 'X-Painel-Token': 'invalido' },
  });
  assert.equal(resTokenErrado.status, 403);

  // Token correto -> 200
  const resOk = await fetch(`${panel.url}/api/analise-curriculo`, {
    headers: { 'X-Painel-Token': token },
  });
  assert.equal(resOk.status, 200);

  const corpo = await resOk.json();
  assert.ok(corpo.grupos);
  assert.ok(corpo.contadores);
  assert.ok(Array.isArray(corpo.avisos));
  assert.equal(corpo.contadores.total > 0, true);
  assert.equal(corpo.contadores.confere, corpo.grupos.confere.length);
  assert.equal(corpo.contadores.sem_prova, corpo.grupos.sem_prova.length);
  assert.equal(corpo.contadores.fora_do_cv, corpo.grupos.fora_do_cv.length);
  assert.equal(corpo.contadores.lacuna, corpo.grupos.lacuna.length);

  // Nenhum campo deve vazar e-mails nem telefones reais
  const jsonStr = JSON.stringify(corpo);
  assert.doesNotMatch(jsonStr, /[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(jsonStr, new RegExp('\\+55' + '\\s*11\\s*9' + '8888-8888'));
});

test('POST /api/analise-curriculo/incluir valida permissões, modo sombra e inclui afirmação', async t => {
  const { dataRoot, panel, token } = await setupAmbiente(t);

  // 1. Rejeição CSRF: Origin externa
  const resOrigemRuim = await fetch(`${panel.url}/api/analise-curriculo/incluir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: 'http://evil.com',
    },
    body: JSON.stringify({ afirmacao_id: 'AF-101', experiencia_id: 'exp-1' }),
  });
  assert.equal(resOrigemRuim.status, 403);

  // 2. Afirmação inexistente -> 400
  const resInexistente = await fetch(`${panel.url}/api/analise-curriculo/incluir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: JSON.stringify({ afirmacao_id: 'AF-INEXISTENTE' }),
  });
  assert.equal(resInexistente.status, 400);

  // 3. Sucesso na inclusão
  const resOk = await fetch(`${panel.url}/api/analise-curriculo/incluir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: JSON.stringify({ afirmacao_id: 'AF-101', experiencia_id: 'exp-alfa' }),
  });
  assert.equal(resOk.status, 200);
  const jsonOk = await resOk.json();
  assert.equal(jsonOk.ok, true);
  assert.equal(jsonOk.afirmacao_id, 'AF-101');
  assert.equal(jsonOk.experiencia_id, 'exp-alfa');

  // Verifica evento gravado
  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'analise.afirmacao_incluida');
  assert.ok(ev);
  assert.equal(ev.dados.afirmacao_id, 'AF-101');

  // 4. Modo sombra recusa gravação com 409
  const sombra = await setupAmbiente(t, { modo: 'shadow' });
  const resSombra = await fetch(`${sombra.panel.url}/api/analise-curriculo/incluir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': sombra.token,
      Origin: sombra.panel.url,
    },
    body: JSON.stringify({ afirmacao_id: 'AF-101' }),
  });
  assert.equal(resSombra.status, 409);
});

test('POST /api/analise-curriculo/marcar altera status de item com validação e segurança', async t => {
  const { dataRoot, panel, token } = await setupAmbiente(t);

  // 1. Status inválido -> 400
  const resInvalido = await fetch(`${panel.url}/api/analise-curriculo/marcar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: JSON.stringify({ item_id: 'item-1', como: 'status_inexistente' }),
  });
  assert.equal(resInvalido.status, 400);

  // 2. Sucesso com revisar
  const resRevisar = await fetch(`${panel.url}/api/analise-curriculo/marcar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: JSON.stringify({ item_id: 'item-1', como: 'revisar', motivo: 'Verificar com RH' }),
  });
  assert.equal(resRevisar.status, 200);
  const jsonRevisar = await resRevisar.json();
  assert.equal(jsonRevisar.ok, true);
  assert.equal(jsonRevisar.item_id, 'item-1');
  assert.equal(jsonRevisar.como, 'revisar');

  // 3. Sucesso com ignorar (normalizado para ignorado)
  const resIgnorar = await fetch(`${panel.url}/api/analise-curriculo/marcar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: JSON.stringify({ item_id: 'item-1', como: 'ignorar' }),
  });
  assert.equal(resIgnorar.status, 200);
  const jsonIgnorar = await resIgnorar.json();
  assert.equal(jsonIgnorar.ok, true);
  assert.equal(jsonIgnorar.como, 'ignorado');

  // Verifica evento gravado
  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.filter(e => e.tipo === 'analise.item_marcado');
  assert.equal(ev.length, 2);
  assert.equal(ev[1].dados.como, 'ignorado');
});

test('POST /api/analise-curriculo/entrevista gera rascunho de entrevista para lacuna', async t => {
  const { dataRoot, panel, token } = await setupAmbiente(t);

  // 1. Obtém um item de lacuna existente
  const resGet = await fetch(`${panel.url}/api/analise-curriculo`, {
    headers: { 'X-Painel-Token': token },
  });
  const { grupos } = await resGet.json();
  assert.ok(grupos.lacuna.length > 0);
  const lacunaAlvo = grupos.lacuna[0];

  // 2. Lacuna inexistente -> 404
  const res404 = await fetch(`${panel.url}/api/analise-curriculo/entrevista`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: JSON.stringify({ item_id: 'lacuna:inexistente' }),
  });
  assert.equal(res404.status, 404);

  // 3. Sucesso na geração de entrevista
  const resOk = await fetch(`${panel.url}/api/analise-curriculo/entrevista`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: JSON.stringify({ item_id: lacunaAlvo.id }),
  });
  assert.equal(resOk.status, 200);
  const jsonOk = await resOk.json();
  assert.equal(jsonOk.ok, true);
  assert.equal(jsonOk.item_id, lacunaAlvo.id);
  assert.ok(jsonOk.rascunho);
  assert.ok(jsonOk.pergunta);

  // Verifica que o arquivo foi gravado no disco
  const conteudo = await readFile(path.join(dataRoot, jsonOk.rascunho), 'utf8');
  assert.match(conteudo, /# Pergunta de Entrevista de Lacuna/);

  // Verifica evento gravado
  const { eventos } = await readEvents(dataRoot);
  const ev = eventos.find(e => e.tipo === 'analise.lacuna_entrevista');
  assert.ok(ev);
  assert.equal(ev.dados.item_id, lacunaAlvo.id);
  assert.equal(ev.dados.arquivo_rascunho, jsonOk.rascunho);
});

test('POST nas rotas de analise-curriculo rejeita payload excessivo (> 8192 bytes)', async t => {
  const { panel, token } = await setupAmbiente(t);

  const payloadGigante = JSON.stringify({
    item_id: 'item-1',
    como: 'revisar',
    motivo: 'x'.repeat(8500),
  });

  const res = await fetch(`${panel.url}/api/analise-curriculo/marcar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Painel-Token': token,
      Origin: panel.url,
    },
    body: payloadGigante,
  });

  assert.equal(res.status, 413);
});
