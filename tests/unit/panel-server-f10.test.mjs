import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';

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

  const get = (urlPath = '/') => fetch(`${panel.url}${urlPath}`);
  return { dataRoot, panel, get };
}

test('GET /icone.svg e /favicon.ico servem o ícone em SVG', async t => {
  const env = await setupAmbiente(t);

  const resIcon = await env.get('/icone.svg');
  assert.equal(resIcon.status, 200);
  assert.match(resIcon.headers.get('content-type'), /image\/svg\+xml/);
  const textoIcon = await resIcon.text();
  assert.match(textoIcon, /<svg/);
  assert.match(textoIcon, /#0E2240/);

  const resFavicon = await env.get('/favicon.ico');
  assert.equal(resFavicon.status, 200);
  assert.match(resFavicon.headers.get('content-type'), /image\/svg\+xml/);
});

test('GET /fontes/<arquivo.woff2> serve arquivos woff2 permitidos', async t => {
  const env = await setupAmbiente(t);

  const fontes = [
    'schibsted-grotesk-400.woff2',
    'schibsted-grotesk-500.woff2',
    'schibsted-grotesk-600.woff2',
    'schibsted-grotesk-700.woff2',
    'pixelify-sans-500.woff2',
  ];

  for (const fonte of fontes) {
    const res = await env.get(`/fontes/${fonte}`);
    assert.equal(res.status, 200, `Falha ao carregar fonte: ${fonte}`);
    assert.match(res.headers.get('content-type'), /font\/woff2/);
    const bytes = await res.arrayBuffer();
    assert.ok(bytes.byteLength > 1000, `Tamanho insuficiente para ${fonte}: ${bytes.byteLength}`);
  }
});

test('GET /fontes/ bloqueia traversal e fontes fora da allowlist', async t => {
  const env = await setupAmbiente(t);

  const naoPermitida = await env.get('/fontes/outra-fonte.woff2');
  assert.equal(naoPermitida.status, 404);

  const inexistente = await env.get('/fontes/inexistente.woff2');
  assert.equal(inexistente.status, 404);

  const traversal1 = await env.get('/fontes/../server.mjs');
  assert.equal(traversal1.status, 404);

  const traversal2 = await env.get('/fontes/%2e%2e/server.mjs');
  assert.equal(traversal2.status, 404);

  const traversalPrivado = await env.get('/fontes/../privado');
  assert.equal(traversalPrivado.status, 404);
});

test('GET / retorna HTML sem qualquer tag <img> e com CSP restritiva', async t => {
  const env = await setupAmbiente(t);

  const res = await env.get('/');
  assert.equal(res.status, 200);

  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.ok(!csp.includes('https:'));
  assert.ok(!csp.includes('*'));

  const html = await res.text();
  assert.equal(html.match(/<img\b[^>]*>/gi), null, 'HTML não deve conter tags <img>');
});

test('GET /api/respostas exige x-painel-token e retorna respostas mascaradas', async t => {
  const env = await setupAmbiente(t);

  const emailFake = ['segredo', 'empresa.com'].join('@');
  const telFake = ['+55 11 9', '8888-7777'].join('');

  // identity.yml para mascarar
  const identityData = {
    nome: 'Nome Secreto do Candidato',
    email: emailFake,
    telefone: telFake,
  };
  await writeFile(path.join(env.dataRoot, 'identity.yml'), JSON.stringify(identityData));

  // answers.yml
  const answersData = {
    respostas: [
      {
        id: 'pretensao-salarial',
        variantes_label: ['Pretensão Salarial'],
        resposta: 'R$ 20.000 PJ',
        escopo: { tipo: 'global' },
        sensivel: true,
        proveniencia: { origem: 'usuario', registrado_em: '2026-10-18T10:00:00.000Z' },
        validade: '2027-01-01',
      },
      {
        id: 'contato-candidato',
        variantes_label: ['Dados de contato'],
        resposta: `Falar com Nome Secreto do Candidato no email ${emailFake} ou ${telFake}`,
        escopo: { tipo: 'global' },
        sensivel: false,
        proveniencia: { origem: 'usuario', registrado_em: '2026-10-18T10:00:00.000Z' },
        validade: null,
      },
    ],
  };
  await mkdir(path.join(env.dataRoot, 'kb'), { recursive: true });
  await writeFile(path.join(env.dataRoot, 'kb', 'answers.yml'), JSON.stringify(answersData));

  // Extrai o token efêmero da página inicial
  const pagina = await (await env.get('/')).text();
  const token = JSON.parse(/window\.PAINEL_API=(\{[^;]+\});/.exec(pagina)[1]).token;

  // Sem token -> 403
  const semToken = await fetch(`${env.panel.url}/api/respostas`);
  assert.equal(semToken.status, 403);

  // Com token inválido -> 403
  const tokenErrado = await fetch(`${env.panel.url}/api/respostas`, {
    headers: { 'x-painel-token': 'token-invalido' },
  });
  assert.equal(tokenErrado.status, 403);

  // Com token correto -> 200 e mascaramento de PII
  const ok = await fetch(`${env.panel.url}/api/respostas`, {
    headers: { 'x-painel-token': token },
  });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.total, 2);
  assert.equal(data.respostas.length, 2);

  const respostaContato = data.respostas.find(r => r.id === 'contato-candidato');
  assert.ok(respostaContato);
  assert.ok(!respostaContato.resposta.includes(emailFake), 'E-mail não pode vazar');
  assert.ok(!respostaContato.resposta.includes(telFake), 'Telefone não pode vazar');
  assert.ok(!respostaContato.resposta.includes('Nome Secreto do Candidato'), 'Nome da identidade não pode vazar');
  assert.ok(respostaContato.resposta.includes('[REDIGIDO]'), 'PII deve ser substituída por [REDIGIDO]');
});
