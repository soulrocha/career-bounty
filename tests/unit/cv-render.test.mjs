import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { baseCv, fixturesCv, perfilCvBruto, vagaAlta } from '../helpers/cv.mjs';
import { selecionarCv } from '../../core/cv/select.mjs';
import { fotoComoDataUri } from '../../core/cv/html.mjs';
import { encontrarNavegador } from '../../core/cv/navegador.mjs';
import { extrairTexto, fontes, temImagem } from '../../core/cv/pdf.mjs';
import { gerarPdfVisual, renderVisual } from '../../core/cv/renderVisual.mjs';
import { SECOES_ATS, gerarPdfAts, renderAts } from '../../core/cv/renderAts.mjs';

const navegador = encontrarNavegador();
const semNavegador = navegador ? false : 'nenhum Chrome, Chromium ou Edge instalado (CAREER_BOUNTY_BROWSER)';

async function payloadBase(extra = {}) {
  const base = await baseCv();
  const perfil = await perfilCvBruto();
  const payload = selecionarCv({ vaga: vagaAlta(), perfil, afirmacoes: base.claims, config: {} });
  return { ...payload, palavras_chave: ['indicadores', 'migração'], ...extra };
}
const foto = () => fotoComoDataUri(path.join(fixturesCv, 'foto.svg'));

// Os PDFs são gerados uma vez e reaproveitados pelos testes.
let pdfs;
const gerar = () => (pdfs ??= (async () => {
  const payload = await payloadBase();
  return { payload, visual: await gerarPdfVisual(payload, { fotoDataUri: await foto(), navegador }), ats: await gerarPdfAts(payload, { navegador }) };
})());

const normalizar = texto => texto.replace(/\s+/g, ' ');

// ---- F5.3 CV visual ----

test('o PDF visual é gerado, abre e tem de 1 a 2 páginas', { skip: semNavegador }, async () => {
  const { visual } = await gerar();
  assert.equal(visual.pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(visual.paginas >= 1 && visual.paginas <= 2, `páginas: ${visual.paginas}`);
  assert.ok(temImagem(visual.pdf), 'a foto entra no PDF visual');
  assert.match(normalizar(extrairTexto(visual.pdf)), /Ana Exemplo/);
});

test('o HTML visual tem cabeçalho, foto e os 4 cards', async () => {
  const payload = await payloadBase();
  const html = await renderVisual(payload, { fotoDataUri: await foto() });
  assert.match(html, /<header class="hero">/);
  assert.match(html, /<img class="portrait" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
  assert.equal((html.match(/<div class="stat">/g) ?? []).length, 4);
  for (const card of payload.cards) assert.ok(html.includes(`<strong>${card.valor}</strong>`), card.valor);
  assert.match(html, /<h1>Ana Exemplo<\/h1>/);
  // Sem foto, o cabeçalho continua com um marcador no lugar.
  assert.match(await renderVisual(payload), /<div class="portrait" role="img" aria-label="Sem foto">AE<\/div>/);
});

test('nenhuma marca claim fica visível e o texto do payload é escapado', { skip: semNavegador }, async () => {
  const payload = await payloadBase();
  payload.experiencias[0].itens[0] = { afirmacao: 'AF-209', texto: 'Economizou R$ 2,3 mi <!-- claim:AF-209 --> em <b>contratos</b>' };
  const html = await renderVisual(payload);
  assert.doesNotMatch(html, /claim:/);
  assert.match(html, /Economizou R\$ 2,3 mi\s+em &lt;b&gt;contratos&lt;\/b&gt;/);
  assert.doesNotMatch(await renderAts(payload), /claim:/);
  const { visual, ats } = await gerar();
  assert.doesNotMatch(extrairTexto(visual.pdf), /claim:/);
  assert.doesNotMatch(extrairTexto(ats.pdf), /claim:/);
});

test('mesmo payload, mesmo HTML (visual e ATS)', async () => {
  const payload = await payloadBase();
  const fotoUri = await foto();
  assert.equal(await renderVisual(payload, { fotoDataUri: fotoUri }), await renderVisual(structuredClone(payload), { fotoDataUri: fotoUri }));
  assert.equal(await renderAts(payload), await renderAts(structuredClone(payload)));
});

test('texto longo demais não estoura a página: a geração falha com mensagem', { skip: semNavegador }, async () => {
  const payload = await payloadBase();
  const longo = 'Conduziu alinhamentos técnicos com um fornecedor internacional e equipes internas de várias áreas. '.repeat(6);
  payload.experiencias = payload.experiencias.map(exp => ({ ...exp, itens: Array.from({ length: 14 }, (_, i) => ({ afirmacao: `AF-${i}`, texto: longo })) }));
  await assert.rejects(gerarPdfVisual(payload, { navegador }), /CV visual ficou com \d+ páginas; o limite é 2/);
  await assert.rejects(gerarPdfAts(payload, { navegador }), /CV ATS ficou com \d+ páginas; o limite é 2/);
});

// ---- F5.4 CV ATS ----

test('o texto extraído do PDF ATS contém todas as seções, na ordem', { skip: semNavegador }, async () => {
  const { ats, payload } = await gerar();
  const texto = extrairTexto(ats.pdf);
  const linhas = texto.split('\n');
  const presentes = SECOES_ATS.filter(secao => linhas.includes(secao));
  assert.deepEqual(presentes, ['Resumo', 'Experiência', 'Destaques', 'Formação', 'Cursos', 'Competências', 'Idiomas']);
  const posicoes = presentes.map(secao => linhas.indexOf(secao));
  assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b));
  // Contatos não colam um no outro na extração.
  assert.match(normalizar(texto), new RegExp(payload.cabecalho.contatos.map(c => c.replace(/[+.]/g, '\\$&')).join(' \\| ')));
});

test('o HTML ATS é de coluna única: sem tabela, imagem, flex, grid, float ou posicionamento', async () => {
  const html = await renderAts(await payloadBase());
  assert.doesNotMatch(html, /<table|<img|<svg|<canvas/i);
  assert.doesNotMatch(html, /position\s*:\s*(absolute|fixed)|float\s*:|display\s*:\s*(flex|grid|inline-flex|inline-grid)|columns?\s*:|column-count/i);
});

test('o PDF ATS não tem imagem', { skip: semNavegador }, async () => {
  const { ats } = await gerar();
  assert.equal(temImagem(ats.pdf), false);
});

test('as palavras-chave presentes nas afirmações aparecem no texto extraído do ATS', { skip: semNavegador }, async () => {
  const { ats, payload } = await gerar();
  const texto = normalizar(extrairTexto(ats.pdf)).toLowerCase();
  for (const palavra of payload.palavras_chave) assert.ok(texto.includes(palavra.toLowerCase()), palavra);
  for (const exp of payload.experiencias) for (const item of exp.itens) assert.ok(texto.includes(normalizar(item.texto).toLowerCase()), item.afirmacao);
});

test('as fontes do PDF ATS estão embutidas e o texto é selecionável', { skip: semNavegador }, async () => {
  const { ats } = await gerar();
  const lista = fontes(ats.pdf);
  assert.ok(lista.length >= 1);
  assert.ok(lista.every(f => f.embutida), JSON.stringify(lista));
  assert.ok(extrairTexto(ats.pdf).length > 500);
});

test('experiência sem bullet sai com cargo, período e intro, sem lista vazia (visual e ATS)', async () => {
  const payload = await payloadBase();
  payload.experiencias.push({ id: 'exp-sigma', empresa: 'Empresa Sigma', cargo: 'Estagiária de Operações', periodo: 'jan/2016 - dez/2017', intro: 'Apoio à rotina de pedidos.', itens: [] });
  for (const html of [await renderVisual(payload), await renderAts(payload)]) {
    assert.match(html, /Estagiária de Operações/);
    assert.match(html, /jan\/2016 - dez\/2017/);
    assert.match(html, /Apoio à rotina de pedidos\./);
    assert.doesNotMatch(html, /<ul[^>]*><\/ul>/);
  }
});