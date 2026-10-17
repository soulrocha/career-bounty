import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { run, tempDir } from '../helpers/cli.mjs';
import { pagina, semNavegador } from '../helpers/navegador.mjs';
import { makeLegado } from '../fixtures/make-legado.mjs';
import { appendEvents } from '../../core/store/events.mjs';
import { eventoPerguntaPendente } from '../../core/apply/perguntas.mjs';
import { lerRespostas } from '../../core/apply/answers.mjs';
import { reservarTentativa, registrarDesfecho } from '../../core/apply/attempts.mjs';
import { startPanel } from '../../panel/server.mjs';

const TS = '2026-10-17T12:00:00.000Z';
const TEXTO = '<img src=x onerror="window.injetado=true">';
const ESTADOS = ['pronta', 'aguarda_resposta', 'bloqueada:humano', 'pronta_para_enviar', 'enviada', 'enviada_sem_comprovante', 'incerta'];

async function painel(t, quantidade = 7) {
  const dataRoot = await tempDir(t);
  const origem = await tempDir(t);
  const pipeline = makeLegado({ vagas: quantidade, emails: 0 });
  pipeline.vagas = pipeline.vagas.map((v, i) => ({ id: v.id, empresa: v.empresa, cargo: i === 0 ? TEXTO : v.cargo,
    url: v.url, requisicao_id: `REQ-${i}`, status: 'avaliada-sem-envio', aderencia: 'alta', url_status: 'aberta', curriculo_necessario: false }));
  const arquivo = path.join(origem, 'pipeline-vagas.json');
  await writeFile(arquivo, JSON.stringify(pipeline));
  const migracao = run(['migrate', '--from', arquivo, '--json'], { dataRoot });
  assert.equal(migracao.status, 0, migracao.stdout);
  if (quantidade) {
    await appendEvents(dataRoot, [eventoPerguntaPendente({ vaga: pipeline.vagas[1],
      campo: { ref: 'c1', label: `Disponibilidade ${TEXTO}`, tipo: 'text', obrigatorio: true, categoria: 'factual' }, portal: 'Portal fictício', ts: TS })], { now: TS });
    for (let i = 2; i < quantidade; i++) {
      const vaga = pipeline.vagas[i];
      const tentativa = await reservarTentativa(dataRoot, { vaga, rota: 'assistido', ts: TS });
      if (i !== 3) await registrarDesfecho(dataRoot, { ...tentativa, vagaId: vaga.id, estado: ESTADOS[i], ts: TS,
        ...(i === 4 ? { comprovante: { texto: `Application submitted ${TEXTO}`, url: 'https://vagas.exemplo.test/confirmacao', data: TS, hash_pdf: 'a'.repeat(64) } } : { motivo: `Detalhe ${TEXTO}` }) });
    }
  }
  const server = await startPanel({ dataRoot, port: 0, now: () => TS, hostId: 'pc-a' });
  t.after(() => { server.server.closeAllConnections(); return server.close(); });
  const html = await (await fetch(server.url)).text();
  const token = JSON.parse(html.match(/window\.PAINEL_API=(\{[^;]+\});/)[1]).token;
  return { ...server, dataRoot, token, vagas: pipeline.vagas };
}

async function esperar(p, expressao) {
  await p.avaliar(`new Promise((resolve,reject)=>{const fim=Date.now()+5000;function tentar(){if(${expressao})return resolve(true);if(Date.now()>fim)return reject(new Error('Estado esperado não apareceu'));setTimeout(tentar,25)}tentar()})`);
}

test('GET /api/fila recusa token ausente ou inválido e lista os sete estados sem alterar a sombra', async t => {
  const p = await painel(t);
  for (const headers of [{}, { 'X-Painel-Token': 'invalido' }]) assert.equal((await fetch(`${p.url}/api/fila`, { headers })).status, 403);
  const resposta = await fetch(`${p.url}/api/fila`, { headers: { 'X-Painel-Token': p.token } });
  assert.equal(resposta.status, 200);
  const { fila } = await resposta.json();
  assert.deepEqual(fila.map(v => v.estado), ESTADOS);
  assert.deepEqual(fila.map(v => v.vaga_id), p.vagas.map(v => v.id));
  assert.equal(fila[0].cargo, TEXTO);
  assert.equal(fila[2].motivo, `Detalhe ${TEXTO}`);
  assert.deepEqual(fila[4].comprovante, { texto: `Application submitted ${TEXTO}`, url: 'https://vagas.exemplo.test/confirmacao', data: TS });
  assert.equal(run(['verify', '--json'], { dataRoot: p.dataRoot }).status, 0);
});

test('abas reais: Fila escapa texto, Perguntas salva resposta e voltar à Fila atualiza o estado', { skip: semNavegador }, async t => {
  const server = await painel(t);
  const p = await pagina(t, server.url);
  await p.avaliar("document.getElementById('aba-fila').click()");
  await esperar(p, "document.querySelectorAll('#fila-conteudo td.f-estado').length===7");
  assert.deepEqual(await p.avaliar("Array.from(document.querySelectorAll('#fila-conteudo .f-estado')).map(n=>n.textContent)"),
    ['Pronta', 'Aguarda sua resposta', 'Bloqueada (precisa de você)', 'Pronta para enviar', 'Enviada', 'Enviada sem comprovante (confira)', 'Incerta (confira)']);
  assert.equal(await p.avaliar("document.querySelector('#fila-conteudo').textContent.includes(" + JSON.stringify(TEXTO) + ')'), true);
  assert.equal(await p.avaliar("document.querySelectorAll('#fila-conteudo img').length"), 0);
  await p.avaliar("document.getElementById('aba-perguntas').click()");
  await esperar(p, "document.querySelectorAll('#perguntas-conteudo .p-item').length===1");
  assert.equal(await p.avaliar("document.querySelectorAll('#perguntas-conteudo img').length"), 0);
  assert.deepEqual(await p.avaliar("[document.getElementById('fila-painel').hidden,document.getElementById('perguntas-painel').hidden,document.getElementById('aba-perguntas').getAttribute('aria-selected')]"), [true, false, 'true']);
  await p.avaliar("document.querySelector('#perguntas-conteudo button').click()");
  assert.equal(await p.avaliar("document.querySelector('.p-erro').textContent"), 'Preencha a resposta.');
  await p.avaliar("document.querySelector('#perguntas-conteudo input').value='Imediata';document.querySelector('#perguntas-conteudo button').click()");
  await esperar(p, "document.getElementById('perguntas-conteudo').textContent==='Nenhuma pergunta pendente.'");
  assert.equal((await lerRespostas(server.dataRoot))[0].resposta, 'Imediata');
  await p.avaliar("document.getElementById('aba-fila').click()");
  await esperar(p, "document.querySelectorAll('#fila-conteudo .f-estado').length===7 && !document.getElementById('fila-conteudo').textContent.includes('Aguarda sua resposta')");
  assert.equal(await p.avaliar("Array.from(document.querySelectorAll('#fila-conteudo .f-estado')).filter(n=>n.textContent==='Pronta').length"), 2);
  assert.equal(await p.avaliar('window.injetado===true'), false);
  await p.avaliar("document.getElementById('aba-vagas').click()");
  assert.deepEqual(await p.avaliar("[document.getElementById('fila-painel').hidden,document.getElementById('perguntas-painel').hidden,document.getElementById('aba-vagas').getAttribute('aria-selected')]"), [true, true, 'true']);
});

test('abas reais mostram vazio, recusa de autenticação e falha de rede sem deixar conteúdo antigo', { skip: semNavegador }, async t => {
  const server = await painel(t, 0);
  const p = await pagina(t, server.url);
  for (const [aba, vazio] of [['fila', 'Nenhuma vaga na fila.'], ['perguntas', 'Nenhuma pergunta pendente.']]) {
    await p.avaliar(`document.getElementById('aba-${aba}').click()`);
    await esperar(p, `document.getElementById('${aba}-conteudo').textContent.startsWith(${JSON.stringify(vazio)})`);
  }
  await p.avaliar("window.PAINEL_API.token='invalido'");
  for (const aba of ['fila', 'perguntas']) {
    await p.avaliar(`document.getElementById('aba-${aba}').click()`);
    await esperar(p, `!document.getElementById('${aba}-conteudo').textContent.startsWith('Carregando')`);
    assert.match(await p.avaliar(`document.getElementById('${aba}-conteudo').textContent`), /token|autoriz|acesso/i);
  }
  await p.avaliar("window.fetch=()=>Promise.reject(new Error('Falha sintética'))");
  for (const aba of ['fila', 'perguntas']) {
    await p.avaliar(`document.getElementById('aba-${aba}').click()`);
    await esperar(p, `document.getElementById('${aba}-conteudo').textContent==='Painel local fora do ar.'`);
  }
});

test('abas contêm texto longo e controles de Perguntas têm nome acessível', { skip: semNavegador }, async t => {
  const server = await painel(t, 0);
  const p = await pagina(t, server.url);
  await p.comando('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });
  await p.avaliar(`window.fetch=async url=>({ok:true,json:async()=>url.includes('/api/fila')?{fila:[{estado:'pronta',empresa:'Empresa 01',cargo:'X'.repeat(500),motivo:'Y'.repeat(500)}]}:{perguntas:[{id:'pq-teste',label:'Z'.repeat(500),tipo:'text',categoria:'factual',vagas:[{empresa:'Empresa 01',cargo:'Cargo',portal:'Portal'}]}]}})`);
  for (const aba of ['fila', 'perguntas']) {
    await p.avaliar(`document.getElementById('aba-${aba}').click()`);
    await esperar(p, `document.getElementById('${aba}-conteudo').textContent.includes('${aba === 'fila' ? 'X' : 'Z'}'.repeat(500))`);
    const medida = await p.avaliar(`({largura:document.documentElement.clientWidth,conteudo:document.getElementById('${aba}-painel').scrollWidth})`);
    assert.ok(medida.conteudo <= medida.largura, `${aba}: ${JSON.stringify(medida)}`);
  }
  assert.equal(await p.avaliar(`Array.from(document.querySelectorAll('#perguntas-conteudo input,#perguntas-conteudo textarea,#perguntas-conteudo select')).every(e=>e.getAttribute('aria-label')||document.getElementById(e.getAttribute('aria-labelledby'))?.textContent)`), true);
});
