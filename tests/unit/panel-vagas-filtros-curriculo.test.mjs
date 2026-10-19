// Dois defeitos da v0.3.0 que só aparecem no navegador:
//  1. as fichas de aderência (Alta, Boa, Condicional, Baixa, Incompatível) mostravam o total de todas as vagas e
//     ignoravam os outros filtros (candidatura, descartadas, modalidade...);
//  2. na aba Currículo e provas, clicar num grupo com itens quebrava com "badgesHtml is not defined", e o catch mostrava
//     "Painel desconectado" em vez de mostrar os itens.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { pagina, semNavegador } from '../helpers/navegador.mjs';
import { repoRoot } from '../helpers/cli.mjs';
import { startPanel } from '../../panel/server.mjs';

const NOW = '2026-10-18T15:00:00.000-03:00';
const FICHAS = ['alta', 'boa', 'condicional', 'baixa', 'incompativel'];

// Painel da demonstração (persona fictícia): 2 alta, 2 boa, 1 condicional e 1 incompatível.
async function painelDemo(t) {
  const raiz = await mkdtemp(path.join(tmpdir(), 'cb-filtros-'));
  t.after(() => rm(raiz, { recursive: true, force: true }));
  const pasta = path.join(raiz, 'demo');
  const demo = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'career-bounty.mjs'), 'demo', '--pasta', pasta, '--json'], { encoding: 'utf8' });
  assert.equal(demo.status, 0, demo.stderr || demo.stdout);
  const panel = await startPanel({ dataRoot: pasta, port: 0, now: () => NOW, hostId: 'teste' });
  t.after(() => { panel.server.closeAllConnections(); return panel.close(); });
  return panel;
}

const contadores = p => p.avaliar(`Object.fromEntries(${JSON.stringify(FICHAS)}.map(a => [a, Number(document.getElementById('n-' + a).textContent)]))`);
const idsDaFicha = (p, ader) => p.avaliar(`DATA.vagas.filter(v => v.aderencia === '${ader}').map(v => v.id)`);
const escolher = (p, id, valor) => p.avaliar(`(() => { const s = document.getElementById('${id}'); s.value = '${valor}'; s.dispatchEvent(new Event('change')); })()`);

test('as fichas de aderência contam as vagas dos filtros ativos, não o total', { skip: semNavegador }, async t => {
  const p = await pagina(t, (await painelDemo(t)).url);

  // Sem filtro extra: o total de cada aderência da demonstração.
  const total = await contadores(p);
  assert.deepEqual(total, { alta: 2, boa: 2, condicional: 1, baixa: 0, incompativel: 1 });

  // "Ainda não me candidatei": marca as duas altas como já candidatadas, e a ficha Alta cai para zero.
  const altas = await idsDaFicha(p, 'alta');
  await p.avaliar(`${JSON.stringify(altas)}.forEach(id => marcas.set(id, { aplicada: true, data: '2026-10-17' })); render();`);
  await escolher(p, 'applied', 'nao');
  assert.deepEqual(await contadores(p), { alta: 0, boa: 2, condicional: 1, baixa: 0, incompativel: 1 });
  assert.equal(await p.avaliar("document.getElementById('total-vagas').textContent"), '3 vagas'); // a ficha Incompatível vem desligada: a lista tem boa, boa e condicional

  // "Já me candidatei": só as duas altas contam.
  await escolher(p, 'applied', 'sim');
  assert.deepEqual(await contadores(p), { alta: 2, boa: 0, condicional: 0, baixa: 0, incompativel: 0 });

  // Voltando a "com e sem": o total de novo.
  await escolher(p, 'applied', '');
  assert.deepEqual(await contadores(p), total);
});

test('descartadas, busca e modalidade também movem as fichas; ligar ou desligar uma ficha não mexe nas outras', { skip: semNavegador }, async t => {
  const p = await pagina(t, (await painelDemo(t)).url);
  const total = await contadores(p);

  // Descarta uma vaga Boa: com "Sem descartadas" (padrão) a ficha Boa perde uma; com "Com descartadas" volta.
  const [boa] = await idsDaFicha(p, 'boa');
  await p.avaliar(`marcas.set('${boa}', { descartada: true }); render();`);
  assert.equal((await contadores(p)).boa, total.boa - 1);
  await escolher(p, 'discard', 'todas');
  assert.equal((await contadores(p)).boa, total.boa);
  await escolher(p, 'discard', 'nao');

  // Busca por um termo que só uma vaga tem: só a ficha dela fica com 1.
  const { alvo, ader } = await p.avaliar("(() => { const v = DATA.vagas.find(x => x.aderencia === 'condicional'); return { alvo: v.cargo, ader: v.aderencia }; })()");
  await p.avaliar(`(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(alvo)}; s.dispatchEvent(new Event('input')); })()`);
  const buscado = await contadores(p);
  assert.equal(buscado[ader], 1);
  assert.equal(Object.values(buscado).reduce((a, b) => a + b, 0), 1);
  await p.avaliar("(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input')); })()");

  // Desligar a ficha Alta tira as altas da lista, mas o número dela e o das outras não mudam.
  const antes = await contadores(p);
  await p.avaliar("document.querySelector('.chip[data-ader=\"alta\"]').click()");
  assert.deepEqual(await contadores(p), antes);
});

// Análise sintética no formato de /api/analise-curriculo, com texto que parece HTML para conferir o escape.
const ANALISE = {
  contadores: { confere: 0, sem_prova: 2, fora_do_cv: 1, lacuna: 1 },
  grupos: {
    confere: [],
    sem_prova: [
      { id: 'it-1', texto: 'Liderou a migração de 5 sistemas <img src=x onerror="window.injetado=true">', afirmacoes: ['AF-1'], evidencias: [], nivel_prova: 'relato', motivo: 'Falta número que prove', peso: 2 },
      { id: 'it-2', texto: 'Reduziu o tempo de fechamento', afirmacoes: [], evidencias: ['EV-1'], nivel_prova: 'proposto' },
    ],
    fora_do_cv: [{ id: 'it-3', texto: 'Painel de indicadores usado por 41 pessoas', afirmacoes: ['AF-3'], evidencias: ['EV-3'], nivel_prova: 'verificado' }],
    lacuna: [{ id: 'it-4', texto: 'Experiência com Kubernetes', afirmacoes: [], evidencias: [], pergunta: 'Você já operou clusters em produção?' }],
  },
};

test('Currículo e provas lista os itens do grupo escolhido, escapa o texto e não esconde erro de tela atrás de "painel desconectado"', { skip: semNavegador }, async t => {
  const p = await pagina(t, (await painelDemo(t)).url);
  await p.avaliar(`(() => { const original = window.fetch; window.fetch = (url, opcoes) => String(url).includes('/api/analise-curriculo') && !(opcoes && opcoes.method === 'POST') ? Promise.resolve(new Response(JSON.stringify(${JSON.stringify(ANALISE)}), { status: 200, headers: { 'Content-Type': 'application/json' } })) : original(url, opcoes); })()`);
  await p.avaliar("document.querySelector('[data-aba=\"curriculo\"]').click()");
  await p.avaliar("new Promise(r => setTimeout(r, 400))");

  for (const [grupo, itens] of [['sem_prova', 2], ['fora_do_cv', 1], ['lacunas', 1]]) {
    await p.avaliar(`document.querySelector('.celula[data-q="${grupo}"]').click()`);
    await p.avaliar('new Promise(r => setTimeout(r, 150))');
    const estado = await p.avaliar("({ itens: document.querySelectorAll('#lista-itens-curriculo .it').length, texto: document.getElementById('lista-itens-curriculo').textContent })");
    assert.equal(estado.itens, itens, `${grupo}: ${estado.texto.slice(0, 120)}`);
    assert.doesNotMatch(estado.texto, /desconectado|Erro ao exibir/, grupo);
  }

  // A coruja lê a análise já carregada: com itens pendentes, o recado diz quantos (e não "ainda não há currículo").
  const recado = await p.avaliar("calcularRecadoCorujaClient('curriculo')");
  assert.equal(recado.texto, '1 lacuna e 2 itens sem prova identificados.');
  assert.equal(recado.temNovidade, true);
  assert.equal(recado.contagem, 3);

  // O primeiro grupo de novo: selos de prova (nível, peso, afirmação) e o texto com HTML escapado.
  await p.avaliar('document.querySelector(\'.celula[data-q="sem_prova"]\').click()');
  await p.avaliar('new Promise(r => setTimeout(r, 150))');
  assert.equal(await p.avaliar("document.querySelectorAll('#lista-itens-curriculo .it .ids .id').length"), 5); // relato, peso 2 e AF-1; proposto e EV-1
  assert.match(await p.avaliar("document.querySelector('#lista-itens-curriculo .it .ids').textContent"), /relato.*peso 2.*AF-1/s);
  assert.equal(await p.avaliar("document.querySelectorAll('#lista-itens-curriculo img').length"), 0);
  assert.equal(await p.avaliar('window.injetado === true'), false);
});

test('erro ao desenhar a lista aparece como erro de tela, e só falha de rede aparece como painel desconectado', { skip: semNavegador }, async t => {
  const p = await pagina(t, (await painelDemo(t)).url);
  // Resposta válida, mas o desenho do item falha (aqui forçado: a máscara lança erro): erro de tela, não de conexão.
  await p.avaliar(`window.fetch = () => Promise.resolve(new Response(JSON.stringify({ contadores: { sem_prova: 1 }, grupos: { sem_prova: [{ id: 'x', texto: 'Item com texto', afirmacoes: [] }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))`);
  await p.avaliar("ordenarItensCurriculo = () => [new Proxy({}, { get() { throw new Error('falha de desenho forçada pelo teste'); } })]");
  await p.avaliar("document.querySelector('[data-aba=\"curriculo\"]').click()");
  await p.avaliar('new Promise(r => setTimeout(r, 400))');
  await p.avaliar('document.querySelector(\'.celula[data-q="sem_prova"]\').click()');
  await p.avaliar('new Promise(r => setTimeout(r, 200))');
  const tela = await p.avaliar("document.getElementById('lista-itens-curriculo').textContent");
  assert.match(tela, /Erro ao exibir os itens/);
  assert.doesNotMatch(tela, /desconectado/);

  // Falha de rede de verdade: aí sim, painel desconectado.
  await p.avaliar("window.fetch = () => Promise.reject(new TypeError('Failed to fetch')); cacheCurriculo = null; carregarCurriculo()");
  await p.avaliar('new Promise(r => setTimeout(r, 300))');
  assert.match(await p.avaliar("document.getElementById('lista-itens-curriculo').textContent"), /desconectado/);
});
