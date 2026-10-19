import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PUBLIC_TEMPLATE } from '../../panel/template.mjs';

test('template.html implementa a estrutura do Menu ⋯ na Placa', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Botão do menu com atributos de acessibilidade
  assert.match(html, /<button[^>]+id="btn-menu"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="btn-menu"[^>]*aria-label="Mais opções"/);

  // Menu suspenso com role="menu" e inicialmente hidden
  assert.match(html, /<div[^>]+id="menu-suspenso"[^>]*role="menu"[^>]*hidden/);

  // 4 itens do menu suspenso
  assert.match(html, /id="opt-menu-respostas"/);
  assert.match(html, /role="menuitem"[^>]*id="opt-menu-respostas"|id="opt-menu-respostas"[^>]*role="menuitem"/);
  assert.match(html, /Respostas de formulário/);

  assert.match(html, /id="opt-menu-fontes"/);
  assert.match(html, /role="menuitem"[^>]*id="opt-menu-fontes"|id="opt-menu-fontes"[^>]*role="menuitem"/);
  assert.match(html, /Fontes e cobertura/);

  assert.match(html, /id="opt-menu-linkedin"/);
  assert.match(html, /role="menuitem"[^>]*id="opt-menu-linkedin"|id="opt-menu-linkedin"[^>]*role="menuitem"/);
  assert.match(html, /Perfil do LinkedIn/);

  assert.match(html, /id="opt-menu-fundo"/);
  assert.match(html, /role="menuitem"[^>]*id="opt-menu-fundo"|id="opt-menu-fundo"[^>]*role="menuitem"/);
  assert.match(html, /id="rotulo-fundo-animacao"[^>]*>Parar a animação do fundo</);
  assert.match(html, /id="desc-fundo-animacao"/);
});

test('template.html implementa a Coruja Batedora com SVG inline, losango e balão factual', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Botão da coruja com .pet e #btn-coruja
  assert.match(html, /<button[^>]+id="btn-coruja"[^>]*aria-label="Recado da coruja batedora"/);
  assert.match(html, /class="[^"]*\bpet\b[^"]*"[^>]*id="btn-coruja"|id="btn-coruja"[^>]*class="[^"]*\bpet\b/);

  // SVG da coruja 12x12 e bico laranja #E07000
  assert.match(html, /viewBox="0 0 12 12"[^>]*class="[^"]*\bic-coruja\b/);
  assert.match(html, /fill="#E07000"/);

  // Losango dourado de novidade
  assert.match(html, /id="losango-coruja"/);
  assert.match(html, /class="[^"]*\blosango-recado\b[^"]*"[^>]*id="losango-coruja"|id="losango-coruja"[^>]*class="[^"]*\blosango-recado\b/);

  // Balão factual
  assert.match(html, /id="balao-coruja"/);
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*hidden|id="balao-coruja"[^>]*aria-live="polite"/);
});

test('template.html implementa os três modais acessíveis', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Modal 1: Respostas de Formulário
  assert.match(html, /id="modal-respostas-formulario"/);
  assert.match(html, /id="modal-respostas-formulario"[^>]*role="dialog"|role="dialog"[^>]*id="modal-respostas-formulario"/);
  assert.match(html, /id="modal-respostas-formulario"[^>]*aria-modal="true"|aria-modal="true"[^>]*id="modal-respostas-formulario"/);
  assert.match(html, /id="tit-modal-respostas"/);
  assert.match(html, /id="busca-respostas-form"/);
  assert.match(html, /class="[^"]*\bfiltros-escopo-respostas\b/);
  assert.match(html, /data-escopo="global"/);
  assert.match(html, /data-escopo="portal"/);
  assert.match(html, /data-escopo="empresa"/);
  assert.match(html, /id="lista-respostas-form"/);
  assert.match(html, /data-fecha="modal-respostas-formulario"/);

  // Modal 2: Fontes e Cobertura
  assert.match(html, /id="modal-fontes-cobertura"/);
  assert.match(html, /id="modal-fontes-cobertura"[^>]*role="dialog"|role="dialog"[^>]*id="modal-fontes-cobertura"/);
  assert.match(html, /id="modal-fontes-cobertura"[^>]*aria-modal="true"|aria-modal="true"[^>]*id="modal-fontes-cobertura"/);
  assert.match(html, /id="tit-modal-fontes"/);
  assert.match(html, /id="status-resumo-radar"/);
  assert.match(html, /id="tabela-portais-vagas"/);
  assert.match(html, /id="corpo-tabela-portais"/);
  assert.match(html, /id="tabela-fontes-radar"/);
  assert.match(html, /id="corpo-tabela-fontes"/);
  assert.match(html, /data-fecha="modal-fontes-cobertura"/);

  // Modal 3: Perfil do LinkedIn
  assert.match(html, /id="modal-perfil-linkedin"/);
  assert.match(html, /id="modal-perfil-linkedin"[^>]*role="dialog"|role="dialog"[^>]*id="modal-perfil-linkedin"/);
  assert.match(html, /id="modal-perfil-linkedin"[^>]*aria-modal="true"|aria-modal="true"[^>]*id="modal-perfil-linkedin"/);
  assert.match(html, /id="tit-modal-linkedin"/);
  assert.match(html, /O painel não acessa nem altera seu LinkedIn/);
  assert.match(html, /1\. Título Profissional/);
  assert.match(html, /2\. Sobre \(Resumo\)/);
  assert.match(html, /3\. Experiência Profissional/);
  assert.match(html, /4\. Competências e Palavras-chave/);
  assert.match(html, /data-fecha="modal-perfil-linkedin"/);
});

test('template.html respeita regras de estilo, responsividade e zero tags <img>', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Zero tags <img>
  assert.equal(html.match(/<img\b[^>]*>/gi), null, 'template.html não pode conter tags <img>');

  // Media query ocultando .pet / #btn-coruja em <= 600px
  assert.match(html, /@media\s*\(\s*max-width:\s*600px\s*\)[^{]*\{[\s\S]*?#btn-coruja/);

  // Chave localStorage cb-animacao-pausada
  assert.match(html, /cb-animacao-pausada/);
});
