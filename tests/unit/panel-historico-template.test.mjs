import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from '../helpers/cli.mjs';
import { PUBLIC_TEMPLATE } from '../../panel/template.mjs';

test('template.html contém todos os elementos estruturais da aba Histórico (F10.2)', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Aba na placa superior
  assert.match(html, /data-aba="historico"/);
  assert.match(html, /id="badge-historico"/);

  // Container principal do histórico
  assert.match(html, /<main[^>]+id="painel-historico"[^>]*hidden/);
  assert.match(html, /class="[^"]*\bpainel-historico\b/);

  // Barra de ferramentas e filtros
  assert.match(html, /class="[^"]*\bferramentas-hist\b/);
  assert.match(html, /id="filtro-hist-inicio"/);
  assert.match(html, /id="filtro-hist-fim"/);
  assert.match(html, /id="filtro-hist-situacao"/);
  assert.match(html, /id="filtro-hist-portal"/);
  assert.match(html, /id="filtro-hist-busca"/);
  assert.match(html, /id="btn-limpar-filtros-hist"/);
  assert.match(html, /id="total-historico"/);

  // Opções do select de situação
  assert.match(html, /value="ativo"/);
  assert.match(html, /value="aguardando_retorno"/);
  assert.match(html, /value="aguardando_voce"/);
  assert.match(html, /value="encerrado"/);

  // Container da lista de vagas e linha do tempo
  assert.match(html, /id="hist-lista-vagas"/);
  assert.match(html, /class="[^"]*\bhist-conteudo\b/);
  assert.match(html, /id="hist-estado"/);

  // Regra rígida: nenhuma tag <img>
  assert.ok(!/<img\b/i.test(html), 'template.html não pode conter tags <img>');

  // Funções no script
  assert.match(html, /\bfunction carregarHistorico\b/);
  assert.match(html, /\bfunction renderizarHistorico\b/);
  assert.match(html, /\bfunction alternarAba\b/);

  // Estilos CSS essenciais da linha do tempo metrô
  assert.match(html, /\.hist-timeline/);
  assert.match(html, /\.hist-marcador/);
  assert.match(html, /\.hist-card/);
  assert.match(html, /\.hist-box-destaque/);
});

test('template.html preserva acessibilidade inicial e regras de alternância de abas', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Estado inicial das abas na nav
  assert.match(html, /<button[^>]+data-aba="vagas"[^>]+aria-current="page"/);
  assert.match(html, /<button[^>]+data-aba="historico"[^>]*>/);
  assert.ok(!/<button[^>]+data-aba="historico"[^>]+aria-current/.test(html));

  // Estado inicial dos painéis principais
  assert.match(html, /<main[^>]+id="painel-vagas"[^>]*>/);
  assert.ok(!/<main[^>]+id="painel-vagas"[^>]*hidden/.test(html));
  assert.match(html, /<main[^>]+id="painel-historico"[^>]*hidden/);

  // Script de alternância de abas gerencia aria-current e hidden
  assert.match(html, /btn\.setAttribute\(['"]aria-current['"],\s*['"]page['"]\)/);
  assert.match(html, /btn\.removeAttribute\(['"]aria-current['"]\)/);
  assert.match(html, /el\.hidden\s*=\s*\(nome\s*!==\s*nomeAba\)/);
});

test('template.html garante responsividade mobile 375px sem overflow horizontal', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Regras de reset e quebra de linha
  assert.match(html, /overflow-wrap:\s*anywhere/);
  assert.match(html, /\*\s*\{\s*box-sizing:\s*border-box;\s*\}/);

  // Media query móvel adaptando layout do histórico
  const mediaStart = html.indexOf('@media (max-width: 900px)');
  assert.ok(mediaStart !== -1, 'Bloco @media (max-width: 900px) deve existir');
  const mediaEnd = html.indexOf('@media (prefers-reduced-motion', mediaStart);
  const mediaCss = html.slice(mediaStart, mediaEnd);

  assert.match(mediaCss, /\.ferramentas-hist\s*\{[^}]*padding:\s*12px;/);
  assert.match(mediaCss, /\.grupo-filtro-data\s*\{[^}]*flex:\s*1\s+1\s+45%;/);
  assert.match(mediaCss, /\.ferramentas-hist\s+select\s*\{[^}]*flex:\s*1\s+1\s+45%;/);
  assert.match(mediaCss, /\.busca-hist\s*\{[^}]*flex:\s*1\s+1\s+100%;/);
  assert.match(mediaCss, /\.hist-card-topo\s*\{[^}]*flex-direction:\s*column;/);
});

test('template.html blinda atalhos J/K/A/D/O contra conflitos com histórico e inputs', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Atalhos ignorados se aba vagas estiver oculta
  assert.match(html, /if\s*\(\s*document\.getElementById\(['"]painel-vagas['"]\)\?\.hidden\s*\)\s*return;/);

  // Atalhos ignorados quando foco está em campos de formulário
  assert.match(html, /\['INPUT',\s*'TEXTAREA',\s*'SELECT'\]\.includes\(tag\)/);
});

