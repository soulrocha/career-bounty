import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PUBLIC_TEMPLATE } from '../../panel/template.mjs';

test('template.html contém todos os elementos estruturais da aba Processos (F10.3)', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Aba na placa superior com badge
  assert.match(html, /data-aba="processos"/);
  assert.match(html, /id="badge-processos"/);

  // Container principal da aba Processos
  assert.match(html, /<main[^>]+id="painel-processos"[^>]*hidden/);
  assert.match(html, /class="[^"]*\bpainel-processos\b/);

  // Bloco 1: Pedem acompanhamento
  assert.match(html, /id="secao-cobrar"/);
  assert.match(html, /id="lista-cobrar"/);

  // Bloco 2: Filtros por Etapa (Chips)
  assert.match(html, /id="filtro-etapas-processos"/);
  assert.match(html, /data-etapa=""/);
  assert.match(html, /data-etapa="candidatura"/);
  assert.match(html, /data-etapa="contato"/);
  assert.match(html, /data-etapa="entrevista"/);
  assert.match(html, /data-etapa="devolutiva"/);
  assert.match(html, /id="total-etapa-todas"/);

  // Bloco 3: Grade de Processos (Lista e Detalhe)
  assert.match(html, /id="proc-grade"/);
  assert.match(html, /id="proc-lista"/);
  assert.match(html, /id="proc-det"/);

  // Zero tags <img>
  assert.ok(!/<img\b/i.test(html), 'template.html não pode conter tags <img>');

  // Aviso factual estrito
  assert.match(html, /O painel não envia mensagens/);

  // Funções no script da aba Processos
  assert.match(html, /\bfunction carregarProcessos\b/);
  assert.match(html, /\bfunction renderizarProcessos\b/);
});

test('template.html contém os estilos CSS do Design System Misto para Processos', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Trilho de estações e marcadores
  assert.match(html, /\.trilho\b/);
  assert.match(html, /\.seg\b/);
  assert.match(html, /\.bola\b/);
  assert.match(html, /\.espera-n\b/);

  // Seção de cobrança / inatividade
  assert.match(html, /\.secao-cobrar\b/);
  assert.match(html, /\.cobrar\b/);
  assert.match(html, /\.cobrar\s+\.dias\b/);

  // Grade, lista e detalhe
  assert.match(html, /\.proc-grade\b/);
  assert.match(html, /\.proc-lista\b/);
  assert.match(html, /\.proc-det\b/);

  // Uso da fonte Pixelify Sans para números de dias
  assert.match(html, /var\(--pixel\)/);
});

test('template.html garante responsividade mobile 375px para a grade de processos', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  const mediaStart = html.indexOf('@media (max-width: 900px)');
  assert.ok(mediaStart !== -1, 'Bloco @media (max-width: 900px) deve existir');
  const mediaEnd = html.indexOf('@media (prefers-reduced-motion', mediaStart);
  const mediaCss = html.slice(mediaStart, mediaEnd);

  // Em mobile, a grade se adapta a coluna única sem rolagem horizontal
  assert.match(mediaCss, /\.proc-grade/);
});

test('template.html registra a aba processos no alternador e atualiza badge com .atencao', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Telas inclui processos
  assert.match(html, /processos:\s*document\.getElementById\(['"]painel-processos['"]\)/);

  // Chamada de carregarProcessos ao alternar para processos
  assert.match(html, /if\s*\(\s*nomeAba\s*===\s*['"]processos['"]\s*\)\s*\{\s*carregarProcessos\(\);\s*\}/);

  // Chamadas de fetch para a API de processos com token
  assert.match(html, /\/api\/processos/);
  assert.match(html, /\/api\/acompanhamento/);
});
