# Arquitetura e Especificação Técnica: Fatia F10.1 — Fundação Visual e Aba Vagas

> **Status:** Especificação técnica aprovada para implementação imediata via TDD.  
> **Fontes da verdade:** [PAINEL.md](file:///c:/Projetos/career-bounty/docs/design/PAINEL.md) e PLANO-F10-interface.  
> **Visual escolhido:** Mundo **Misto**, Organização **A (Plataforma)** com atalhos de teclado da C.

---

## 1. Visão Geral da Fatia F10.1

A fatia **F10.1** estabelece a nova base visual e interativa do painel CareerBounty:
1. **Totalmente local e offline:** Zero dependência de CDN, scripts externos ou chamadas de rede externas.
2. **Identidade Visual Misto:**
   - **Forma do Metrô:** Placa azul-marinho (`#0E2240`), estações redondas ligadas por traço contínuo, plaquetas com cor sólida e chão cinza-concreto.
   - **Personalidade do RPG:** Aderência tratada como raridade (Alta lendária, Boa épica, Condicional rara, Baixa comum, Incompatível pobre), ouro (`#D9A441`) na ação principal, mascote coruja batedora em pixel e números de destaque em fonte pixel.
3. **Organização A (Plataforma):** Lista em ramais verticais por raridade e detalhe completo visíveis lado a lado em desktop.
4. **Regras Mandatórias de Negócio & Design:**
   - A lista de vagas **NÃO mostra a nota da empresa** (para evitar confusão com notas de compatibilidade da vaga/candidato). A nota do Glassdoor aparece exclusivamente no detalhe.
   - Quando não houver nota de empresa disponível, o bloco no detalhe é omitido ou exibe aviso factual — **nunca exibir nota zero nem traço**.
   - Atalhos de teclado `J`, `K`, `A`, `D`, `O` com barreira rígida contra foco em campos de formulário.
   - Responsividade estrita até 375 px sem rolagem horizontal.

---

## 2. Tipografia Local e Licenças OFL

### 2.1 Arquivos e Estrutura em `panel/fontes/`

O painel deve distribuir 5 arquivos de fontes binárias `woff2` e seus respectivos arquivos de licença SIL Open Font License 1.1:

```
panel/
└── fontes/
    ├── schibsted-grotesk-400.woff2
    ├── schibsted-grotesk-500.woff2
    ├── schibsted-grotesk-600.woff2
    ├── schibsted-grotesk-700.woff2
    ├── OFL-SchibstedGrotesk.txt
    ├── pixelify-sans-500.woff2
    └── OFL-PixelifySans.txt
```

### 2.2 Rota no Servidor HTTP (`panel/server.mjs`)

As fontes são servidas sob a rota segura `/fontes/<arquivo.woff2>`.
Regras de segurança no `panel/server.mjs`:
- **Allowlist exata:** Apenas os 5 arquivos `.woff2` conhecidos são servidos.
- **Prevenção de Path Traversal:** Rejeição estrita de `..`, `%2e`, `%252e`, `/`, `\` ou NUL byte `%00`. Qualquer caminho fora da allowlist retorna `404 Not Found`.
- **Cabeçalhos de Resposta:**
  - `Content-Type: font/woff2`
  - `Cache-Control: public, max-age=31536000, immutable` (fontes locais imutáveis)
  - `X-Content-Type-Options: nosniff`
  - Headers CSP existentes: a diretiva `font-src 'self' data:` já cobre perfeitamente essa rota.

```javascript
// Exemplo de integração em panel/server.mjs
const FONTES_PERMITIDAS = new Set([
  'schibsted-grotesk-400.woff2',
  'schibsted-grotesk-500.woff2',
  'schibsted-grotesk-600.woff2',
  'schibsted-grotesk-700.woff2',
  'pixelify-sans-500.woff2'
]);

const matchFonte = /^\/fontes\/([a-z0-9-]+\.woff2)$/.exec(path);
if (matchFonte) {
  const nomeArquivo = matchFonte[1];
  if (!FONTES_PERMITIDAS.has(nomeArquivo)) return send(404, { erro: 'Fonte indisponível.' });
  const caminhoCompleto = resolve(repoRoot, 'panel/fontes', nomeArquivo);
  const bytes = await readFile(caminhoCompleto).catch(() => null);
  if (!bytes) return send(404, { erro: 'Fonte indisponível.' });
  return send(200, bytes, 'font/woff2');
}
```

### 2.3 Declaração CSS `@font-face`

Inseridas no topo de `<style>` no `panel/template.html`:

```css
@font-face {
  font-family: 'Schibsted Grotesk';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fontes/schibsted-grotesk-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Schibsted Grotesk';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fontes/schibsted-grotesk-500.woff2') format('woff2');
}
@font-face {
  font-family: 'Schibsted Grotesk';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fontes/schibsted-grotesk-600.woff2') format('woff2');
}
@font-face {
  font-family: 'Schibsted Grotesk';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fontes/schibsted-grotesk-700.woff2') format('woff2');
}
@font-face {
  font-family: 'Pixelify Sans';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fontes/pixelify-sans-500.woff2') format('woff2');
}
```

### 2.4 Registro no Arquivo `NOTICE`

Adicionar ao final de `NOTICE`:

```
Fontes tipográficas (SIL Open Font License 1.1)

- Schibsted Grotesk (pesos 400, 500, 600, 700): Copyright (c) 2023 The Schibsted Grotesk Project Authors.
  Distribuído em panel/fontes/ sob licença OFL-1.1 (ver panel/fontes/OFL-SchibstedGrotesk.txt).
- Pixelify Sans (peso 500): Copyright (c) 2023 The Pixelify Sans Project Authors.
  Distribuído em panel/fontes/ sob licença OFL-1.1 (ver panel/fontes/OFL-PixelifySans.txt).
```

---

## 3. Ícone e Favicon

### 3.1 Arquivo `panel/icone.svg`
O arquivo `icone.svg` do protótipo é copiado diretamente para `panel/icone.svg`. Ele representa:
- Ladrilho azul-marinho da placa (`#0E2240` com raio 14px).
- Moeda de recompensa em ouro (`#D9A441`).
- Coruja cunhada em pixel com bico laranja de item lendário.

### 3.2 Rota HTTP no `panel/server.mjs`
- Rotas tratadas: `/icone.svg` e `/favicon.ico`.
- Content-Type: `image/svg+xml`.
- No HTML:
  ```html
  <link rel="icon" href="/icone.svg" type="image/svg+xml">
  ```
- Na placa do metrô:
  ```html
  <img class="logo" src="/icone.svg" width="30" height="30" alt="">
  ```

---

## 4. Tokens CSS e Sistema de Temas (Misto: Claro e Escuro)

### 4.1 Definição dos Tokens no `<style>` de `panel/template.html`

O design adotado é o **Misto**. A alternância de temas é controlada por atributo `data-tema="claro"` ou `data-tema="escuro"` no elemento raiz `<html>` (ou `<body>`).

```css
:root {
  --fonte: "Schibsted Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --pixel: "Pixelify Sans", "Schibsted Grotesk", monospace;
  --ouro: #D9A441;
  --r-sm: 4px;
  --r: 6px;
  --r-lg: 10px;
  --t-xs: 12px;
  --t-sm: 13px;
  --t-md: 14px;
  --t-lg: 16px;
  --t-xl: 19px;
  --t-2xl: 24px;
  --t-3xl: 30px;
  --dur: 180ms;
  --saida: cubic-bezier(.16, 1, .3, 1);

  /* Placa superior fixa (igual em ambos os temas) */
  --placa: #0E2240;
  --placa-2: #152C50;
  --placa-linha: #2A4470;
  --placa-tx: #FFFFFF;
  --placa-tx2: #BAC8DC;
}

[data-tema="claro"] {
  color-scheme: light;
  --chao: #E7EBF0;
  --sup: #FFFFFF;
  --sup2: #F5F7FA;
  --sup3: #EBEFF4;
  --borda: #D3DAE2;
  --borda2: #B5C0CC;
  --tx: #0E1A27;
  --tx2: #3F4C5A;
  --tx3: #556270;

  /* Ação principal em ouro */
  --acao: #D9A441;
  --acao-tx: #231804;
  --acao-hover: #C9932F;
  --foco: #0455A1;
  --selecao: #CFE0F4;

  /* Raridades: traço (l-) e texto (t-) */
  --l-alta: #E07000;         --t-alta: #A34C00;
  --l-boa: #8A3FD1;          --t-boa: #7230B3;
  --l-condicional: #1C6FD6;  --t-condicional: #145DB8;
  --l-baixa: #5E6873;        --t-baixa: #4A5560;
  --l-incompativel: #87909A; --t-incompativel: #5F6873;

  /* Cores de texto sobre plaquetas */
  --sobre-cor: #FFFFFF;
  --sobre-alta: #1A1206;
  --sobre-incompativel: #1A1206;

  /* Alertas e situações */
  --ok: #00754E;
  --atencao: #7A5800;
  --atencao-fundo: #FFF4D1;
  --perigo: #B3261E;
  --perigo-fundo: #FDE8E6;
  --info: #145DB8;
  --fundo-alfa: .55;
}

[data-tema="escuro"] {
  color-scheme: dark;
  --chao: #0A111C;
  --sup: #111C2C;
  --sup2: #152236;
  --sup3: #1B2B42;
  --borda: #24354F;
  --borda2: #34496A;
  --tx: #E9EEF5;
  --tx2: #AEBBCC;
  --tx3: #93A2B6;

  /* Ação principal em ouro */
  --acao: #D9A441;
  --acao-tx: #231804;
  --acao-hover: #E8B758;
  --foco: #6AA6FF;
  --selecao: #1F3E66;

  /* Raridades no escuro */
  --l-alta: #FF8A1F;         --t-alta: #FF9D45;
  --l-boa: #B26BF5;          --t-boa: #C493F8;
  --l-condicional: #3D9BFF;  --t-condicional: #72B5FF;
  --l-baixa: #D3D9E1;        --t-baixa: #D3D9E1;
  --l-incompativel: #66727F; --t-incompativel: #A3AEBD;

  /* Cores de texto sobre plaquetas */
  --sobre-cor: #0E1320;
  --sobre-alta: #0E1320;
  --sobre-incompativel: #FFFFFF;

  /* Alertas e situações */
  --ok: #4FD3A0;
  --atencao: #F5C518;
  --atencao-fundo: #2A2410;
  --perigo: #FF8A7F;
  --perigo-fundo: #2E1716;
  --info: #72B5FF;
  --fundo-alfa: .70;
}
```

> [!CAUTION] Regra de Privacidade do Repositório
> Nunca utilizar o termo proibido de marca comercial/fintech bloqueada no privacy scan em variáveis, seletores ou comentários. Utilize termos semânticos e neutros.

### 4.2 Gerenciamento do Tema em JavaScript
1. Inicialização:
   ```javascript
   const temaSalvo = localStorage.getItem('cb_tema');
   const temaPadrao = temaSalvo || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
   document.documentElement.setAttribute('data-tema', temaPadrao);
   ```
2. Alternância pelo Botão de Tema na Placa:
   ```javascript
   function alternarTema() {
     const atual = document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro';
     const novo = atual === 'escuro' ? 'claro' : 'escuro';
     document.documentElement.setAttribute('data-tema', novo);
     localStorage.setItem('cb_tema', novo);
     fundo.cores(); // recomputa cores do canvas
     render();
   }
   ```

---

## 5. Canvas de Fundo Animado (Céu em Pixel e Serra)

O canvas `#fundo` roda em segundo plano sem interceptar interações do usuário (`pointer-events: none`).

### 5.1 Regras de Operação
- **Taxa de Quadros:** Limitado a 30 fps via threshold temporal: `if (agora - ultimo < 33) return;`.
- **Economia de Energia:**
  - Pausa imediata ao ocultar a aba: escuta evento `visibilitychange`. Se `document.hidden === true`, chama `cancelAnimationFrame`.
  - Preferência do Sistema: respeita `prefers-reduced-motion: reduce`.
  - Opção no Menu ⋯: item "Parar a animação do fundo" / "Animar o fundo", com persistência em `localStorage.getItem('cb_fundo_parado')`.
  - Em modo parado ou reduced-motion, desenha um único quadro estático representativo e não enfileira chamadas no loop.
- **Camadas Gráficas:**
  - Noite (`data-tema="escuro"`): estrelas em pixel (tamanho 2px a 4px) que cintilam devagar com `Math.sin(t * 0.9 + fase)`.
  - Dia (`data-tema="claro"`): nuvens cúbicas em blocos de pixel de 4px que transitam lentamente da esquerda para a direita.
  - Serra em degraus tingida pelos tokens `--sup`, `--sup2`, `--sup3` e `--borda`, assentada no rodapé da viewport.

```javascript
// panel/fundo.mjs (ou módulo integrado em template.html)
export function iniciarFundo(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  const reduz = matchMedia('(prefers-reduced-motion: reduce)');
  let w, h, dpr, raf, ultimo = 0;
  const t0 = performance.now();
  let estrelas = [], nuvens = [], serra = [], cores = {};

  const estaParado = () => reduz.matches || localStorage.getItem('cb_fundo_parado') === 'true';

  function atualizarTamanho() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvasEl.width = w * dpr;
    canvasEl.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gerarCenario();
    lerCores();
  }

  function lerCores() {
    const cs = getComputedStyle(document.documentElement);
    cores = {
      sup: cs.getPropertyValue('--sup').trim(),
      sup2: cs.getPropertyValue('--sup2').trim(),
      sup3: cs.getPropertyValue('--sup3').trim(),
      borda: cs.getPropertyValue('--borda').trim(),
    };
  }

  function desenharQuadro(agora) {
    const t = (agora - t0) / 1000;
    const P = 4;
    const escuro = document.documentElement.getAttribute('data-tema') === 'escuro';
    ctx.clearRect(0, 0, w, h);

    if (escuro) {
      for (const e of estrelas) {
        const b = 0.5 + 0.5 * Math.sin(t * 0.9 + e.f);
        if (b < 0.25) continue;
        ctx.globalAlpha = 0.25 + 0.6 * b;
        ctx.fillStyle = e.g ? '#E6B450' : '#CFC6EA';
        ctx.fillRect(e.x, e.y, e.g ? P : 2, e.g ? P : 2);
      }
    } else {
      for (const n of nuvens) {
        const x = ((n.x + t * n.v) % (w + 200)) - 100;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(Math.round(x / P) * P, n.y, n.l * P, P * 2);
        ctx.fillRect(Math.round(x / P) * P + P * 2, n.y - P * 2, (n.l - 4) * P, P * 2);
      }
    }

    // Serra em pixel
    ctx.globalAlpha = escuro ? 0.9 : 0.7;
    ctx.fillStyle = escuro ? cores.sup : cores.sup3;
    for (let i = 0; i < serra.length - 1; i++) {
      const [x, y] = serra[i];
      ctx.fillRect(x, y, P * 6, h - y);
    }
    ctx.globalAlpha = 1;
  }

  function loop(agora) {
    raf = requestAnimationFrame(loop);
    if (agora - ultimo < 33) return;
    ultimo = agora;
    desenharQuadro(agora);
  }

  function reiniciar() {
    cancelAnimationFrame(raf);
    if (document.hidden) return;
    if (estaParado()) {
      desenharQuadro(t0 + 20000);
    } else {
      raf = requestAnimationFrame(loop);
    }
  }

  window.addEventListener('resize', () => { atualizarTamanho(); reiniciar(); });
  document.addEventListener('visibilitychange', reiniciar);
  reduz.addEventListener?.('change', reiniciar);

  atualizarTamanho();
  reiniciar();

  return { reiniciar, lerCores };
}
```

---

## 6. Placa Superior (Metrô, Mascote e Radar)

### 6.1 Estrutura Semântica
```html
<header class="placa">
  <div class="marca">
    <img class="logo" src="/icone.svg" width="30" height="30" alt="">
    <span class="nome">CareerBounty</span>
  </div>

  <nav class="nav" aria-label="Abas do painel">
    <button type="button" role="tab" id="aba-vagas" aria-selected="true" aria-controls="painel-vagas">
      Vagas
      <span class="cont" id="cont-vagas">0</span>
    </button>
    <button type="button" role="tab" id="aba-processos" aria-selected="false" aria-controls="painel-processos">
      Processos
      <span class="cont" id="cont-processos">0</span>
    </button>
    <button type="button" role="tab" id="aba-curriculo" aria-selected="false" aria-controls="painel-curriculo">
      Currículo e provas
      <span class="cont" id="cont-curriculo">0</span>
    </button>
    <button type="button" role="tab" id="aba-historico" aria-selected="false" aria-controls="painel-historico">
      Histórico
      <span class="cont" id="cont-historico">0</span>
    </button>
  </nav>

  <div class="placa-dir">
    <button class="pet" id="btn-coruja" aria-label="Recado da coruja" aria-expanded="false">
      <!-- SVG da Coruja em Pixel 12x12 -->
      <span class="pip" id="coruja-pip"></span>
      <span class="balao" id="coruja-balao" role="status" hidden></span>
    </button>
    <span class="estado" id="radar-estado">Radar atualizado</span>
    <button class="btn-ic" id="btn-tema" aria-label="Alternar tema" title="Alternar tema"></button>
    <div class="menu">
      <button class="btn-ic" id="btn-menu" aria-expanded="false" aria-label="Mais opções">⋯</button>
      <div class="lista" id="menu-dropdown" role="menu" hidden>
        <button role="menuitem" data-acao="aba" data-v="respostas">Respostas de formulário</button>
        <button role="menuitem" data-acao="aba" data-v="fontes">Fontes e cobertura</button>
        <button role="menuitem" data-acao="aba" data-v="linkedin">Perfil do LinkedIn</button>
        <button role="menuitem" data-acao="toggle-fundo" id="btn-toggle-fundo">Parar a animação do fundo</button>
      </div>
    </div>
  </div>
</header>
```

### 6.2 Recado Factual da Coruja
- Ao carregar a página ou mudar de aba, a coruja exibe um balão por 6 segundos com um recado factual e depois o oculta, exibindo o pip dourado (`.pip`).
- O texto do recado deriva estritamente de dados reais:
  - Na aba Vagas: `"${n} vagas de alta aderência esperando você."` ou `"Nenhuma vaga nova de alta aderência nesta rodada."`
  - Jamais inventar mensagens genéricas.

---

## 7. Aba Vagas (Organização A: Plataforma)

A tela divide-se em:
1. **Barra de Ferramentas / Filtros (Topo)**
2. **Mesa Dividida (Desktop: 2 Colunas lado a lado):**
   - **Coluna Esquerda (`.A-lista`):** Ramais verticais por raridade contendo as estações.
   - **Coluna Direita (`.A-det`):** Detalhe completo da vaga selecionada.

```
+---------------------------------------------------------------------------------+
| PLACA: [Logo CareerBounty]  [Vagas (3)] [Processos] ...   [Coruja] [Radar] [Tema] [⋯] |
+---------------------------------------------------------------------------------+
| FERRAMENTAS: [Chips Aderência] [Busca] [Modalidade] [Regime] [Portal] [Limpar]  |
+---------------------------------------------------+-----------------------------+
| RAMAIS DE VAGAS (minmax(380px, 44%))              | DETALHE DA VAGA (1fr)       |
|                                                   | [Plaqueta] Empresa    [Abrir]
| [Ramal Alta Aderência (2)]                        | Cargo                       |
|   (o) Estação 1: Tech Lead - Alpha · Remoto       | [Alerta Condições se houver]|
|   (o) Estação 2: Staff Eng - Beta · Híbrido       | [Fatos: Mod | Loc | Reg...] |
|                                                   | [Requisitos]                |
| [Ramal Boa Aderência (1)]                         | [CVs da Vaga: ATS | Visual] |
|   (o) Estação 3: Arquiteto - Gama · Remoto        | [Glassdoor da Empresa]      |
|                                                   | [Ações: Candidatar | Descart]|
+---------------------------------------------------+-----------------------------+
```

### 7.1 Fichas de Aderência e Filtros
- **Fichas (Chips):** Alta, Boa, Condicional, Baixa, Incompatível. Clicar em uma ficha alterna sua ativação no conjunto `Set` de aderências filtradas.
- **Selects:**
  - `id="mode"` / `aria-label="Filtrar modalidade"`: Todas, Remoto, Híbrido, Presencial.
  - `id="contract"` / `aria-label="Filtrar regime"`: Todos, CLT, PJ, Não informado.
  - `id="portal"` / `aria-label="Filtrar portal de candidatura"`: Populado dinamicamente a partir das vagas presentes.
  - `id="applied"` / `aria-label="Filtrar candidatura"`: Todas, Já me candidatei, Ainda não me candidatei.
  - `id="discard"` / `aria-label="Filtrar descarte"`: Sem descartadas (padrão), Só descartadas, Com descartadas.
- **Input de Busca:** `id="search"` / `aria-label="Pesquisar vagas"`, com pesquisa insensível a acentos (`normalize('NFD')`) em empresa, cargo, descrição, motivos e lacunas.

### 7.2 Lista em Ramais
- **Ordenação Obrigatória das Linhas:** Alta (lendária) → Boa (épica) → Condicional (rara) → Baixa (comum) → Incompatível (pobre).
- **Sem Nota da Empresa na Lista:** Cada botão `.estacao` exibe apenas:
  - Anel/círculo `.bola` na cor da raridade.
  - Cargo (com limite de 2 linhas e `-webkit-line-clamp: 2`).
  - Empresa, modalidade e portal.
  - Recência ("há 2 h" ou data).
  - Badge `✓ candidatada` se já houver candidatura registrada.
  - Se descartada: texto tachado (`line-through`) e cor atenuada.

### 7.3 Painel de Detalhe da Vaga
- **Topo:** Plaqueta de raridade com cor cheia, empresa, indicador de recência ("vista há X") e botão ouro "Abrir vaga" (`target="_blank"`).
- **Alerta de Condições:** Exibido se `vaga.condicoes && vaga.condicoes.situacao !== 'ok'`.
- **Grade de Fatos (`<dl class="fatos">`):** 3 colunas em desktop: Modalidade, Local, Regime, Salário, Portal de candidatura e Glassdoor.
  - **Tratamento Glassdoor:** Se `empresa_avaliacao` não existir nos dados da vaga, exibe `"Sem nota coletada"` ou omite a nota. **Sob nenhuma hipótese exibir nota 0, traço vazio ou estrelas vazias.**
- **Requisitos:** Tabela com requisitos da vaga e badges de adequação (`atende`, `parcial`, `nao_atende`).
- **Currículos Desta Vaga:**
  - Se o portal for Gupy: exibe aviso de que a Gupy utiliza perfil do site, indicando a quantidade de campos e proposta.
  - Se houver bloqueio de gate: card de alerta com cadeado e motivo do bloqueio.
  - Se liberado: cartões para download do CV visual e CV para ATS.
- **Ações:**
  - Botão principal dourado "Abrir vaga" (leva ao link do anúncio).
  - Checkbox "Já me candidatei" sincronizado com campo de data da candidatura.
  - Botão "Descartar vaga" / "Restaurar vaga".
  - Comunicação assíncrona via `fetch` com `/api/candidaturas` e `/api/descarte`, enviando o token `window.PAINEL_API.token`.

---

## 8. Atalhos de Teclado J / K / A / D / O

Os atalhos tornam a triagem ultrarrápida:

| Tecla | Ação | Comportamento |
|---|---|---|
| `J` | Próxima vaga | Seleciona a próxima estação na lista filtrada visível |
| `K` | Vaga anterior | Seleciona a estação anterior na lista filtrada visível |
| `A` | Candidatura | Alterna checkbox "Já me candidatei" para a vaga atual (salva via API) |
| `D` | Descarte | Alterna o status de descarte da vaga atual (salva via API) |
| `O` | Abrir vaga | Abre o link original da vaga no navegador em nova aba (`window.open`) |

### 8.1 Proteção Contra Disparo Acidental
A função interceptadora de eventos de teclado deve validar rigorosamente:

```javascript
document.addEventListener('keydown', e => {
  // 1. Barreira estrita de foco em formulários
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;

  // 2. Ignorar combinações com teclas modificadoras
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  // 3. Apenas ativo na aba Vagas
  if (estadoAtual.aba !== 'vagas') return;

  const vagaAtual = obterVagaSelecionada();
  const k = e.key.toLowerCase();

  switch (k) {
    case 'j':
      e.preventDefault();
      moverSelecao(1);
      break;
    case 'k':
      e.preventDefault();
      moverSelecao(-1);
      break;
    case 'a':
      if (vagaAtual) {
        e.preventDefault();
        alternarCandidatura(vagaAtual.id);
      }
      break;
    case 'd':
      if (vagaAtual) {
        e.preventDefault();
        alternarDescarte(vagaAtual.id);
      }
      break;
    case 'o':
      if (vagaAtual && vagaAtual.url) {
        e.preventDefault();
        window.open(vagaAtual.url, '_blank', 'noopener,noreferrer');
      }
      break;
    case 'escape':
      fecharMenusEBalcoes();
      break;
  }
});
```

---

## 9. Responsividade em 375 px (Móvel)

Em telas estreitas (<= 900 px e até 375 px):
1. **Transição de Layout da Mesa:**
   - De grid de 2 colunas para exibição em pilha com alternância de visão:
   - Se nenhuma vaga estiver aberta no detalhe móvel (`abreDet === false`):
     - `.A-lista` ocupa 100% da largura.
     - `.A-det` recebe `display: none`.
   - Ao tocar em uma estação na lista:
     - `abreDet` torna-se `true`.
     - `.A-lista` recebe `display: none`.
     - `.A-det` ocupa 100% da largura.
     - O botão `.A-voltar` ("‹ Voltar à lista") é exibido no topo do detalhe.
2. **Garantia de Zero Rolagem Lateral:**
   - Todos os blocos com `box-sizing: border-box`, `min-width: 0` e `overflow-wrap: anywhere`.
   - `.fatos` passa de 3 colunas para 2 ou 1 coluna.
   - `.cvs` passa de 2 colunas para 1 coluna empilhada.
   - Barra da placa: oculta o texto `.nome` ("CareerBounty"), a coruja `.pet` e o status do radar `.estado`, mantendo apenas o logotipo `icone.svg`, as abas (com rolagem horizontal suave) e os botões de tema/menu.

---

## 10. Roteiro TDD e Estratégia de Testes

Os testes da fatia F10.1 devem ser implementados sem dependência de framework, utilizando a biblioteca nativa do Node (`node:test` e `node:assert/strict`).

### 10.1 Testes do Servidor (`tests/unit/panel-server-f10.test.mjs`)
- **Teste 1:** Servir fontes woff2 permitidas:
  - Requisições para `/fontes/schibsted-grotesk-400.woff2`, `500`, `600`, `700` e `/fontes/pixelify-sans-500.woff2` retornam HTTP 200, header `Content-Type: font/woff2` e bytes intactos.
- **Teste 2:** Bloqueio de Path Traversal em fontes:
  - Requisições contendo `/fontes/../secreto.txt`, `/fontes/%2e%2e/state/migration.json`, ou fontes inexistentes retornam HTTP 404 e nunca expõem arquivos fora da pasta.
- **Teste 3:** Servir `icone.svg`:
  - Requisição `/icone.svg` retorna HTTP 200, `Content-Type: image/svg+xml`.
- **Teste 4:** Favicon:
  - Requisição `/favicon.ico` serve o ícone adequadamente com HTTP 200 ou redirecionamento correto.

### 10.2 Testes Unitários de Lógica Pura (`tests/unit/panel-vagas-logic.test.mjs`)
Para garantir máxima velocidade e isolamento sem necessidade de navegador headless nos testes unitários, isolar funções puras em módulo auxiliar (ex.: `panel/vagas-logic.mjs` ou módulo equivalente):
- **Teste 5:** `filtrarVagas()`:
  - Testar busca sem distinção de maiúsculas e acentos.
  - Testar combinação de filtros (modalidade + regime + portal + descartadas).
  - Testar seleção múltipla no Set de aderências.
- **Teste 6:** `agruparPorRamais()`:
  - Verificar ordenação estrita `['alta', 'boa', 'condicional', 'baixa', 'incompativel']`.
  - Verificar cálculo correto de marcadores `ini` (primeiro item) e `fim` (último item do ramal).
- **Teste 7:** `navegarPasso()` (Lógica dos atalhos J e K):
  - Ao avançar na lista, seleciona o próximo ID; no final, para sem erro (`clamp`).
  - Ao recuar, seleciona o anterior; no início, para sem erro.
- **Teste 8:** Proteção de atalhos de teclado:
  - Função avaliadora de evento retorna `false` (ignora) se o alvo for `INPUT`, `TEXTAREA` ou `SELECT`.
  - Retorna `false` se `e.ctrlKey || e.metaKey || e.altKey`.
- **Teste 9:** Supressão da Nota Glassdoor:
  - Vaga sem `empresa_avaliacao` não produz `0` nem `—` no renderizador de nota.
- **Teste 10:** Conformidade dos Tokens do Tema Misto:
  - Verificar que o CSS do template possui os valores exatos dos tokens especificados no `PAINEL.md` para Misto (Claro e Escuro).
