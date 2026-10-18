import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PUBLIC_TEMPLATE } from '../../panel/template.mjs';

test('template.html contém todos os elementos estruturais da aba Currículo e Provas (F10.4)', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Aba na placa superior
  assert.match(html, /data-aba="curriculo"/);
  assert.match(html, /id="badge-curriculo"/);

  // Painel principal oculto inicialmente
  assert.match(html, /<main[^>]+id="painel-curriculo"[^>]*hidden/);
  assert.match(html, /class="[^"]*\bpainel-curriculo\b/);

  // Subtítulo factual estrito exigido pelo produto
  assert.match(
    html,
    /Compara o que está no seu currículo com o que a sua base consegue provar\. Ajuste os itens aqui; a mudança vale para os próximos CVs\./
  );

  // Matriz 2x2 com os eixos ortogonais e as 4 células
  assert.match(html, /id="matriz-curriculo"/);
  assert.match(html, /Tem dado que prova/);
  assert.match(html, /Não tem dado/);
  assert.match(html, /Está no CV/);
  assert.match(html, /Fora do CV/);

  // 4 células com atributos data-q e IDs
  assert.match(html, /class="[^"]*\bcelula\b[^"]*"[^>]+data-q="confere"[^>]+id="cel-confere"/);
  assert.match(html, /class="[^"]*\bcelula\b[^"]*"[^>]+data-q="sem_prova"[^>]+id="cel-sem_prova"/);
  assert.match(html, /class="[^"]*\bcelula\b[^"]*"[^>]+data-q="fora_do_cv"[^>]+id="cel-fora_do_cv"/);
  assert.match(html, /class="[^"]*\bcelula\b[^"]*"[^>]+data-q="lacunas"[^>]+id="cel-lacunas"/);

  // Contadores numéricos individuais
  assert.match(html, /id="n-confere"/);
  assert.match(html, /id="n-sem_prova"/);
  assert.match(html, /id="n-fora_do_cv"/);
  assert.match(html, /id="n-lacunas"/);

  // Bloco detalhado da situação ativa
  assert.match(html, /id="bloco-itens-curriculo"/);
  assert.match(html, /id="cab-quadrante-ativo"/);
  assert.match(html, /id="tit-quadrante-ativo"/);
  assert.match(html, /id="desc-quadrante-ativo"/);
  assert.match(html, /id="cont-quadrante-ativo"/);
  assert.match(html, /id="filtro-busca-curriculo"/);
  assert.match(html, /id="lista-itens-curriculo"/);
  assert.match(html, /id="curriculo-estado"/);

  // Zero tags <img> em todo o arquivo
  assert.ok(!/<img\b/i.test(html), 'template.html não pode conter tags <img> (todos ícones e logos são SVG inline)');
});

test('template.html implementa tokens de design, Pixelify Sans e feedback visual "pisca uma vez"', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Tipografia Pixelify Sans nos contadores da matriz
  assert.match(html, /\.celula\s+\.q-n\s*\{[^}]*font-family:\s*var\(--pixel\)/);

  // Tokens semânticos de situação nas células (não de raridade)
  assert.match(html, /\.celula\[data-q="confere"\]\s*\{[^}]*--cor:\s*var\(--ok\)/);
  assert.match(html, /\.celula\[data-q="sem_prova"\]\s*\{[^}]*--cor:\s*var\(--atencao\)/);
  assert.match(html, /\.celula\[data-q="fora_do_cv"\]\s*\{[^}]*--cor:\s*var\(--info\)/);
  assert.match(html, /\.celula\[data-q="lacunas"\]\s*\{[^}]*--cor:\s*var\(--perigo\)/);

  // Animação de feedback "pisca uma vez" na célula de destino
  assert.match(html, /\.celula\.chegou\s*\{[^}]*animation:\s*piscar-celula/);
  assert.match(html, /@keyframes\s+piscar-celula/);

  // Badges de prova e peso
  assert.match(html, /\.id\.nivel-verificado/);
  assert.match(html, /\.id\.nivel-entregue/);
  assert.match(html, /\.id\.nivel-relato/);
  assert.match(html, /\.id\.peso/);
});

test('template.html é responsivo para mobile 375px sem rolagem horizontal', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Matriz colapsa para 1 coluna em telas estreitas
  assert.match(html, /@media\s*\([^)]*max-width:\s*600px\)[^{]*\{[\s\S]*?\.matriz\s*\{[^}]*grid-template-columns:\s*1fr;/);
});

test('template.html integra o script de controle da aba Currículo e Provas', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Inclusão no mapa de telas
  assert.match(html, /curriculo:\s*document\.getElementById\(['"]painel-curriculo['"]\)/);

  // Chamada no alternarAba
  assert.match(html, /if\s*\(\s*nomeAba\s*===\s*['"]curriculo['"]\s*\)\s*\{?\s*carregarCurriculo\(\)/);

  // Funções client-side
  assert.match(html, /\bfunction carregarCurriculo\b/);
  assert.match(html, /\bfunction renderizarCurriculo\b/);
  assert.match(html, /\bfunction acionarFeedbackDestino\b/);

  // Rotas da API da F9.5 / F10.4
  assert.match(html, /\/api\/analise-curriculo/);
  assert.match(html, /\/api\/analise-curriculo\/incluir/);
  assert.match(html, /\/api\/analise-curriculo\/marcar/);
  assert.match(html, /\/api\/analise-curriculo\/entrevista/);
});

test('template.html aplica higienização e mascaramento de PII em itens do currículo', async () => {
  const html = await readFile(PUBLIC_TEMPLATE, 'utf8');

  // Garante que mascararDadoSensivel é invocado para texto, motivo e pergunta
  assert.match(html, /mascararDadoSensivel\(\s*item\.texto\s*\)/);
  assert.match(html, /mascararDadoSensivel\(\s*item\.motivo\s*\)/);
  assert.match(html, /mascararDadoSensivel\(\s*item\.pergunta\s*\)/);
});

