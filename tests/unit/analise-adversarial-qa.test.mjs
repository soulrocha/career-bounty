import assert from 'node:assert/strict';
import http from 'node:http';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot, run, tempDir } from '../../../../../../../Projetos/career-bounty-backend/tests/helpers/cli.mjs';
import { startPanel } from '../../../../../../../Projetos/career-bounty-backend/panel/server.mjs';
import { readEvents } from '../../../../../../../Projetos/career-bounty-backend/core/store/events.mjs';
import {
  validarAfirmacaoIncluida,
  validarItemMarcado,
  validarLacunaEntrevista,
  STATUS_ITEM_ANALISE,
} from '../../../../../../../Projetos/career-bounty-backend/core/store/rules.mjs';

const kbDir = path.join(repoRoot, 'tests', 'fixtures', 'kb-quadrantes');
const NOW = '2026-10-18T15:00:00.000-03:00';
const DEFAULT_ENV = { CAREER_BOUNTY_NOW: NOW };

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
    nome: 'Pessoa Teste Adversarial',
    email: 'pessoa.adversarial@exemplo.test',
    telefone: ['+55', '11', '98888-8888'].join(' '),
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

function requestHttp({ url, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
      },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('ADVERSARIAL: Segurança de API e Anti-CSRF em todas as rotas POST da F9.5', async t => {
  const { panel, token } = await setupAmbiente(t);
  const endpoints = [
    { path: '/api/analise-curriculo/incluir', payload: { afirmacao_id: 'AF-101' } },
    { path: '/api/analise-curriculo/marcar', payload: { item_id: 'item-1', como: 'revisar' } },
    { path: '/api/analise-curriculo/entrevista', payload: { item_id: 'lacuna:sem_fonte:AF-101' } },
  ];

  const maliciosasOrigins = [
    'http://attacker.com',
    'null',
    'http://evil-site.local',
    'http://127.0.0.1:8880.attacker.com',
    'https://attacker.com',
  ];

  for (const ep of endpoints) {
    const fullUrl = `${panel.url}${ep.path}`;

    // 1. Origins maliciosas
    for (const origin of maliciosasOrigins) {
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Painel-Token': token,
          Origin: origin,
        },
        body: JSON.stringify(ep.payload),
      });
      assert.equal(res.status, 403, `Endpoint ${ep.path} com Origin ${origin} deve retornar 403 Forbidden`);
    }

    // 2. Sem Origin
    const resSemOrigin = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Painel-Token': token,
      },
      body: JSON.stringify(ep.payload),
    });
    assert.equal(resSemOrigin.status, 403, `Endpoint ${ep.path} sem Origin deve retornar 403 Forbidden`);

    // 3. Sem x-painel-token
    const resSemToken = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: panel.url,
      },
      body: JSON.stringify(ep.payload),
    });
    assert.equal(resSemToken.status, 403, `Endpoint ${ep.path} sem token deve retornar 403 Forbidden`);

    // 4. Token forjado / adulterado
    const resTokenForjado = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Painel-Token': 'token_malicioso_1234567890',
        Origin: panel.url,
      },
      body: JSON.stringify(ep.payload),
    });
    assert.equal(resTokenForjado.status, 403, `Endpoint ${ep.path} com token forjado deve retornar 403 Forbidden`);

    // 5. Host header spoofing usando http.request direto
    const resHostSpoof = await requestHttp({
      url: fullUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(ep.payload)),
        'X-Painel-Token': token,
        Origin: panel.url,
        Host: 'evil-host.com',
      },
      body: JSON.stringify(ep.payload),
    });
    assert.equal(resHostSpoof.status, 403, `Endpoint ${ep.path} com Host evil-host.com deve retornar 403 Forbidden`);

    // 6. Host com porta incorreta
    const resHostPortaErrada = await requestHttp({
      url: fullUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(ep.payload)),
        'X-Painel-Token': token,
        Origin: panel.url,
        Host: '127.0.0.1:9999',
      },
      body: JSON.stringify(ep.payload),
    });
    assert.equal(resHostPortaErrada.status, 403, `Endpoint ${ep.path} com Host 127.0.0.1:9999 deve retornar 403 Forbidden`);

    // 7. Payload excessivo (> 8192 bytes)
    const payloadGrande = JSON.stringify({
      ...ep.payload,
      lixo: 'A'.repeat(8500),
    });
    const resPayloadGrande = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Painel-Token': token,
        Origin: panel.url,
      },
      body: payloadGrande,
    });
    assert.equal(resPayloadGrande.status, 413, `Endpoint ${ep.path} com payload > 8KB deve retornar 413 Payload Too Large`);
  }
});

test('ADVERSARIAL: Rejeição estrita em modo sombra (409 Conflict) para todas as rotas POST da F9.5', async t => {
  const sombra = await setupAmbiente(t, { modo: 'shadow' });
  const endpoints = [
    { url: `${sombra.panel.url}/api/analise-curriculo/incluir`, payload: { afirmacao_id: 'AF-101' } },
    { url: `${sombra.panel.url}/api/analise-curriculo/marcar`, payload: { item_id: 'item-1', como: 'revisar' } },
    { url: `${sombra.panel.url}/api/analise-curriculo/entrevista`, payload: { item_id: 'lacuna:sem_fonte:AF-101' } },
  ];

  for (const ep of endpoints) {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Painel-Token': sombra.token,
        Origin: sombra.panel.url,
      },
      body: JSON.stringify(ep.payload),
    });
    assert.equal(res.status, 409, `Endpoint ${ep.url} em modo sombra deve retornar 409 Conflict`);
    const json = await res.json();
    assert.equal(json.gravacao_painel, 'desligada');
  }
});

test('ADVERSARIAL: Invasão de PII com telefones incomuns e e-mails complexos em afirmações e modelos', async t => {
  const dataRoot = await tempDir(t);
  const put = async (relativo, dado) => {
    const alvo = path.join(dataRoot, relativo);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, typeof dado === 'string' ? dado : JSON.stringify(dado));
  };

  await put('state/migration.json', { version: 1, mode: 'ativo', snapshotRoot: null });
  await put('projections/pipeline-vagas.json', { vagas: [] });
  await put('identity.yml', {
    nome: 'Pessoa Teste Adversarial',
    email: 'pessoa.adversarial@exemplo.test',
    telefone: ['+55', '11', '98888-8888'].join(' '),
    cpf: '000.000.000-00',
  });
  await mkdir(path.join(dataRoot, 'events'), { recursive: true });
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });

  const piis = [
    ['usuario.complexo+tag-123_45', '@', 'sub.dominio.exemplo.test'].join(''),
    ['contato-direto', '@', 'advogado-trabalhista.test'].join(''),
    ['ceo.executivo', '@', 'exemplo.test'].join(''),
    ['+55', '11', '91234-5678'].join(' '),
    ['(21)', '98765-4321'].join(' '),
    ['+1', '415', '555-0199'].join(' '),
    ['+44', '20', '7946', '0958'].join(' '),
    ['11', '98888', '7777'].join(''),
  ];

  // Injetar PII em uma claim (afirmação)
  const afPiiMd = [
    '---',
    'id: AF-101',
    'nivel_prova: verificado',
    'empresa: "Empresa Alfa"',
    'periodo: "2018-01..2019-12"',
    'uso: [CV, Ent]',
    'origem: "banco:D1"',
    'publicavel: com-anonimizacao',
    'numeros: ["34%"]',
    '---',
    `Reduziu fechamento negociando com ${piis[0]} e ligando para ${piis[3]}.`,
  ].join('\n');
  await writeFile(path.join(dataRoot, 'kb', 'claims', 'AF-101.md'), afPiiMd);

  // Injetar PII em modelo de CV (bullet)
  const cvPiiMd = [
    '# Modelo base',
    '',
    '## EXPERIENCIA',
    '',
    '### Empresa Alfa',
    `- Atendimento aos clientes via ${piis[1]} e telefone ${piis[4]}.`,
    `- Suporte internacional no fone ${piis[5]} e plantão ${piis[6]} ou ${piis[2]}.`,
    '',
  ].join('\n');
  await writeFile(path.join(dataRoot, 'kb', 'cv', 'modelo-base.md'), cvPiiMd);

  const panel = await startPanel({ dataRoot, port: 0, now: () => NOW });
  t.after(panel.close);

  const pagina = await (await fetch(panel.url)).text();
  const token = JSON.parse(/window\.PAINEL_API=(\{[^;]+\});/.exec(pagina)[1]).token;

  const res = await fetch(`${panel.url}/api/analise-curriculo`, {
    headers: { 'X-Painel-Token': token },
  });
  assert.equal(res.status, 200);

  const dados = await res.json();
  const payloadSerializado = JSON.stringify(dados);

  // Verificar que NENHUM dos telefones ou e-mails crus vazou no JSON retornado
  for (const pii of piis) {
    assert.ok(
      !payloadSerializado.includes(pii),
      `Vazamento de PII detectado! O valor "${pii}" foi exposto na rota /api/analise-curriculo!`
    );
  }

  // Verificar que os padrões de mascaramento (asteriscos de e-mail e telefone) foram aplicados
  assert.ok(payloadSerializado.includes('***@'), 'Deve conter e-mail mascarado com asteriscos (***@)');
  assert.ok(payloadSerializado.includes('****-**'), 'Deve conter telefone mascarado com asteriscos (****-**)');
});

test('ADVERSARIAL: Fuzzing de fuso horário em São Paulo e transições de meia-noite', () => {
  // Cenário 1: Noite em SP (2026-10-18T23:30:00-03:00 -> 2026-10-19T02:30:00Z)
  // Em SP, ainda é 2026-10-18. 2026-10-19 é FUTURO e deve ser rejeitado.
  const antesMeiaNoite = '2026-10-19T02:30:00.000Z'; // 23h30 do dia 18 em SP

  // validarAfirmacaoIncluida
  assert.equal(validarAfirmacaoIncluida({ afirmacao_id: 'AF-1', data: '2026-10-18' }, antesMeiaNoite), null);
  assert.match(
    validarAfirmacaoIncluida({ afirmacao_id: 'AF-1', data: '2026-10-19' }, antesMeiaNoite),
    /data futura/i
  );

  // validarItemMarcado
  assert.equal(validarItemMarcado({ item_id: 'I-1', como: 'revisar', data: '2026-10-18' }, antesMeiaNoite), null);
  assert.match(
    validarItemMarcado({ item_id: 'I-1', como: 'revisar', data: '2026-10-19' }, antesMeiaNoite),
    /data futura/i
  );

  // validarLacunaEntrevista
  assert.equal(
    validarLacunaEntrevista({ item_id: 'L-1', pergunta: 'Como?', data: '2026-10-18' }, antesMeiaNoite),
    null
  );
  assert.match(
    validarLacunaEntrevista({ item_id: 'L-1', pergunta: 'Como?', data: '2026-10-19' }, antesMeiaNoite),
    /data futura/i
  );

  // Cenário 2: Logo após a meia-noite em SP (2026-10-19T00:01:00-03:00 -> 2026-10-19T03:01:00Z)
  // Em SP, virou 2026-10-19. Agora 2026-10-19 é HOJE (permitido). 2026-10-20 é FUTURO.
  const aposMeiaNoite = '2026-10-19T03:01:00.000Z'; // 00h01 do dia 19 em SP

  assert.equal(validarAfirmacaoIncluida({ afirmacao_id: 'AF-1', data: '2026-10-19' }, aposMeiaNoite), null);
  assert.match(
    validarAfirmacaoIncluida({ afirmacao_id: 'AF-1', data: '2026-10-20' }, aposMeiaNoite),
    /data futura/i
  );

  assert.equal(validarItemMarcado({ item_id: 'I-1', como: 'revisar', data: '2026-10-19' }, aposMeiaNoite), null);
  assert.match(
    validarItemMarcado({ item_id: 'I-1', como: 'revisar', data: '2026-10-20' }, aposMeiaNoite),
    /data futura/i
  );

  assert.equal(
    validarLacunaEntrevista({ item_id: 'L-1', pergunta: 'Como?', data: '2026-10-19' }, aposMeiaNoite),
    null
  );
  assert.match(
    validarLacunaEntrevista({ item_id: 'L-1', pergunta: 'Como?', data: '2026-10-20' }, aposMeiaNoite),
    /data futura/i
  );
});

test('ADVERSARIAL: Schema limits e status anômalos em rules', () => {
  const now = '2026-10-18T15:00:00.000Z';

  // Status proibidos/anômalos em validarItemMarcado
  const statusProibidos = ['admin', 'delete', 'revisado', 'concluido', 'pendente', '__proto__', '', 123, null, undefined];
  for (const st of statusProibidos) {
    assert.match(
      validarItemMarcado({ item_id: 'item-1', como: st, data: '2026-10-18' }, now),
      /Status da marcação inválido/i
    );
  }

  // Limite de 500 caracteres no motivo
  assert.equal(
    validarItemMarcado({ item_id: 'item-1', como: 'revisar', motivo: 'B'.repeat(500), data: '2026-10-18' }, now),
    null
  );
  assert.match(
    validarItemMarcado({ item_id: 'item-1', como: 'revisar', motivo: 'B'.repeat(501), data: '2026-10-18' }, now),
    /limite de 500 caracteres/i
  );

  // Tipos incorretos em campos
  assert.match(validarItemMarcado({ item_id: 123, como: 'revisar', data: '2026-10-18' }, now), /ID do item/i);
  assert.match(validarItemMarcado({ item_id: 'item-1', como: 'revisar', motivo: {}, data: '2026-10-18' }, now), /Motivo deve ser um texto/i);
  assert.match(validarItemMarcado({ item_id: 'item-1', como: 'revisar', motivo: [], data: '2026-10-18' }, now), /Motivo deve ser um texto/i);

  // validarLacunaEntrevista campos obrigatórios
  assert.match(validarLacunaEntrevista({ item_id: 'L-1', pergunta: '', data: '2026-10-18' }, now), /Pergunta de entrevista é obrigatória/i);
  assert.match(validarLacunaEntrevista({ item_id: 'L-1', pergunta: '   ', data: '2026-10-18' }, now), /Pergunta de entrevista é obrigatória/i);
  assert.match(validarLacunaEntrevista({ item_id: 'L-1', pergunta: 12345, data: '2026-10-18' }, now), /Pergunta de entrevista é obrigatória/i);
  assert.match(validarLacunaEntrevista({ item_id: '', pergunta: 'Pergunta?', data: '2026-10-18' }, now), /ID do item de lacuna é obrigatório/i);
  assert.match(validarLacunaEntrevista({ item_id: 'L-1', pergunta: 'Pergunta?', arquivo_rascunho: 999, data: '2026-10-18' }, now), /arquivo de rascunho deve ser um texto válido/i);
});

test('ADVERSARIAL: CLI analise com inputs anômalos e IDs inexistentes via subprocesso real', async t => {
  const dataRoot = await tempDir(t);
  assert.equal(run(['setup', '--json'], { dataRoot, env: DEFAULT_ENV }).status, 0);
  await cp(kbDir, path.join(dataRoot, 'kb'), { recursive: true });

  // analise sem subcomando
  const resSemSub = run(['analise'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resSemSub.status, 0);

  // analise incluir sem --afirmacao
  const resSemAf = run(['analise', 'incluir', '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resSemAf.status, 0);
  assert.match(resSemAf.stderr, /Informe --afirmacao/i);

  // analise incluir com afirmacao inexistente
  const resAfInexistente = run(['analise', 'incluir', '--afirmacao', 'AF-INEXISTENTE-999', '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resAfInexistente.status, 0);
  assert.match(resAfInexistente.stderr, /Afirmação não encontrada na base/i);

  // analise incluir com data futura
  const resDataFutura = run(['analise', 'incluir', '--afirmacao', 'AF-101', '--data', '2099-01-01', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resDataFutura.status, 0);
  assert.match(resDataFutura.stderr, /data futura/i);

  // analise marcar sem --item
  const resSemItem = run(['analise', 'marcar', '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resSemItem.status, 0);
  assert.match(resSemItem.stderr, /Informe --item/i);

  // analise marcar com status inválido
  const resStatusInvalido = run(['analise', 'marcar', '--item', 'I-1', '--como', 'status_maluco', '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resStatusInvalido.status, 0);
  assert.match(resStatusInvalido.stderr, /Status da marcação inválido/i);

  // analise marcar com data futura
  const resMarcarFutura = run(['analise', 'marcar', '--item', 'I-1', '--como', 'revisar', '--data', '2099-01-01', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resMarcarFutura.status, 0);
  assert.match(resMarcarFutura.stderr, /data futura/i);

  // analise lacuna sem --entrevista
  const resSemEntrevista = run(['analise', 'lacuna', '--item', 'lacuna:item', '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resSemEntrevista.status, 0);
  assert.match(resSemEntrevista.stderr, /exige a flag --entrevista/i);

  // analise lacuna sem --item
  const resLacunaSemItem = run(['analise', 'lacuna', '--entrevista', '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resLacunaSemItem.status, 0);
  assert.match(resLacunaSemItem.stderr, /Informe --item/i);

  // analise lacuna com item inexistente
  const resLacunaInexistente = run(['analise', 'lacuna', '--entrevista', '--item', 'lacuna:inexistente-xyz', '--now', NOW, '--teste'], { dataRoot, env: DEFAULT_ENV });
  assert.notEqual(resLacunaInexistente.status, 0);
  assert.match(resLacunaInexistente.stderr, /Item de lacuna não encontrado/i);
});
