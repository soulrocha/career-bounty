# Arquitetura e Especificação Técnica: Fatia F10.4 — Aba Currículo e Provas

> **Status:** Especificação técnica aprovada para implementação imediata via TDD.  
> **Dependências:** Fatia F9.5 (Análise do currículo contra a base) e contratos em `docs/PAINEL-API.md`.  
> **Visual escolhido:** Mundo **Misto**, Organização **A (Plataforma)** com Matriz 2×2, cores de situação e tipografia Pixelify Sans / Schibsted Grotesk.  
> **Referências de Design:** [PAINEL.md](PAINEL.md), `docs/PAINEL-API.md`, `core/kb/quadrants.mjs` e protótipo de referência em `panel/prototipos/`.

---

## 1. Visão Geral da Fatia F10.4

A fatia **F10.4** substitui a antiga aba técnica "Quadrantes" pela nova aba **"Currículo e provas"** na interface web do CareerBounty (`panel/template.html`). A finalidade desta tela é fornecer uma visão imediata, comparativa e acionável sobre o alinhamento entre o que está declarado no currículo e o que a base de conhecimento local (`kb/`) consegue comprovar com dados, métricas e evidências rastreáveis.

### 1.1 Objetivos Centrais

1. **Aba "Currículo e provas" na Placa Superior:**
   - Botão de navegação na placa com `data-aba="curriculo"` e contador numérico `#badge-curriculo`.
   - O contador indica os itens que exigem ação direta do candidato (**Sem prova** + **Lacunas**). Quando há itens pendentes, o badge recebe a classe visual `.atencao` (destaque dourado/âmbar).
   - Alternância com `hidden` sincronizada com as demais abas (`vagas`, `historico`, `processos`).

2. **Subtítulo Factual Estrito:**
   - Mensagem factual e orientada a produto:  
     *"Compara o que está no seu currículo com o que a sua base consegue provar. Ajuste os itens aqui; a mudança vale para os próximos CVs."*

3. **Matriz 2×2 Estruturada:**
   - Dois eixos ortogonais:
     - **Eixo Vertical:** "Está no CV" / "Fora do CV".
     - **Eixo Horizontal:** "Tem dado que prova" / "Não tem dado".
   - Quatro células de situação com cores funcionais dedicadas (tokens semânticos de situação, não de raridade):
     - **Confere:** Verde (`var(--ok)`), representando itens declarados no CV e sustentados por dados e evidências.
     - **Sem prova:** Âmbar (`var(--atencao)`), representando itens no CV que carecem de evidências, métricas ou linhas de base.
     - **Fora do CV:** Azul (`var(--info)`), representando afirmações e evidências fortes na base que ainda não entraram no CV.
     - **Lacunas:** Vermelho (`var(--perigo)`), representando competências pedidas por vagas do radar sem cobertura na base.
   - Contadores em destaque com a fonte **Pixelify Sans** (`var(--pixel)`) no topo de cada célula.

4. **Cards de Itens Detalhados:**
   - Exibição de texto do bullet/afirmação/requisito.
   - Badges de rastreabilidade: códigos de afirmações ligadas (`AF-xxx`), evidências (`EV-xxx`), badge do nível de prova (`verificado`, `entregue`, `relato`) e peso da lacuna (`peso X`).
   - Motivo descritivo ou divergência identificada pelo validador.

5. **Ações Interativas de Movimentação entre Células:**
   - **Em "Fora do CV":** botão *"Incluir no CV"* que invoca `POST /api/analise-curriculo/incluir`.
   - **Em "Sem prova":** botões *"Revisar"* e *"Ignorar"* que invocam `POST /api/analise-curriculo/marcar`.
   - **Em "Lacunas":** botão *"Gerar pergunta de entrevista"* que invoca `POST /api/analise-curriculo/entrevista`.
   - **Feedback Visual "Pisca uma vez":** quando uma ação move ou inclui um item, a célula de destino executa a animação CSS `.chegou` com transição de 180 ms exponencial (`var(--saida)`), fornecendo feedback visual táctil sem recarregar a página.

6. **Acessibilidade e Zero Imagens Externas:**
   - Zero tags `<img>`: 100% dos ícones construídos em SVG inline.
   - Contraste WCAG AA garantido nos dois temas (Misto claro e escuro).
   - Suporte completo a navegação por teclado (`Tab`, `Enter`, `Space`) com foco visível (`:focus-visible`).
   - Respeito integral a `prefers-reduced-motion: reduce`.

7. **Responsividade Estrita em 375 px:**
   - Em telas largas (> 900 px): grade 3 colunas (`auto 1fr 1fr`) com rótulos de eixos verticais e horizontais.
   - Em telas intermediárias (601 px a 900 px): matriz 2×2 sem rótulos de eixos laterais.
   - Em telas estreitas (<= 600 px e 375 px mobile): a matriz colapsa para **uma coluna vertical única**, sem overflow horizontal ou rolagem lateral na tela.

---

## 2. Contratos de Dados da API Local

A interface consome os dados expostos localmente (`127.0.0.1`) protegidos por token efêmero (`X-Painel-Token`) injetado em `window.PAINEL_API.token`.

### 2.1 Leitura: `GET /api/analise-curriculo`

Retorna as quatro categorias da análise, contagens e avisos.

- **Método:** `GET`
- **Caminho:** `/api/analise-curriculo`
- **Cabeçalhos:** `X-Painel-Token: <token-de-64-caracteres>`
- **Resposta (`200 OK`):**
```json
{
  "contagem": {
    "confere": 3,
    "sem_prova": 2,
    "fora_do_cv": 2,
    "lacunas": 3
  },
  "confere": [
    {
      "id": "c1",
      "texto": "Liderei a migração do monólito de pedidos para eventos, reduzindo o tempo de deploy de 2 dias para 3 horas.",
      "afirmacoes": ["AF-003"],
      "evidencias": ["EV-002"],
      "nivel_prova": "verificado",
      "motivo": null
    },
    {
      "id": "c2",
      "texto": "Gestão de 12 pessoas em dois times de produto financeiro.",
      "afirmacoes": ["AF-001"],
      "evidencias": ["EV-001"],
      "nivel_prova": "verificado",
      "motivo": null
    },
    {
      "id": "c3",
      "texto": "Estruturei trilha de carreira de engenharia com 4 níveis.",
      "afirmacoes": ["AF-007"],
      "evidencias": ["EV-005"],
      "nivel_prova": "entregue",
      "motivo": null
    }
  ],
  "sem_prova": [
    {
      "id": "s1",
      "texto": "Responsável pela melhoria de desempenho da API principal.",
      "afirmacoes": [],
      "evidencias": [],
      "nivel_prova": null,
      "motivo": "Sem número nem afirmação ligada.",
      "pergunta": "Qual foi o ganho (tempo de resposta, custo ou erros) e em que período?"
    },
    {
      "id": "s2",
      "texto": "Atuação na redução de incidentes em produção.",
      "afirmacoes": ["AF-011"],
      "evidencias": [],
      "nivel_prova": "relato",
      "motivo": "Afirmação só com relato, sem linha de base.",
      "pergunta": "Quantos incidentes por mês antes e depois?"
    }
  ],
  "fora_do_cv": [
    {
      "id": "f1",
      "texto": "Reduziu em 31% o custo mensal de nuvem em 2024.",
      "afirmacoes": ["AF-014"],
      "evidencias": ["EV-009"],
      "nivel_prova": "verificado",
      "motivo": "Tem prova e aparece em 5 vagas do radar."
    },
    {
      "id": "f2",
      "texto": "Palestra sobre observabilidade em evento regional.",
      "afirmacoes": ["AF-019"],
      "evidencias": ["EV-012"],
      "nivel_prova": "entregue",
      "motivo": "Reforça vagas de plataforma."
    }
  ],
  "lacunas": [
    {
      "id": "l1",
      "texto": "Orçamento de engenharia",
      "peso": 5,
      "afirmacoes": [],
      "evidencias": [],
      "motivo": "Pedido em 4 vagas boas do radar.",
      "pergunta": "Você já respondeu por orçamento de time ou de nuvem? Qual valor aproximado?"
    },
    {
      "id": "l2",
      "texto": ".NET em produção recente",
      "peso": 3,
      "afirmacoes": [],
      "evidencias": [],
      "motivo": "Motivo da devolutiva negativa da Vetor Seguros.",
      "pergunta": "Usou .NET nos últimos 3 anos? Em que projeto?"
    },
    {
      "id": "l3",
      "texto": "Linha do tempo: jan-jun 2021",
      "peso": 2,
      "afirmacoes": [],
      "evidencias": [],
      "motivo": "Buraco no histórico.",
      "pergunta": "O que você fez nesse período?"
    }
  ],
  "avisos": []
}
```

> **Adapter de Compatibilidade com `/api/quadrantes`:**  
> Caso a rota `/api/analise-curriculo` ainda não tenha sido registrada pelo servidor da F9.5, a função pura `normalizarRespostaAnalise()` realiza o mapeamento transparente a partir do payload legado de `/api/quadrantes`:
> - `a` -> `confere`
> - `c` -> `sem_prova`
> - `b` -> `fora_do_cv`
> - `d` -> `lacunas`

---

### 2.2 Escrita: `POST /api/analise-curriculo/incluir`

Move uma afirmação comprovada de "Fora do CV" para o perfil/template do CV.

- **Método:** `POST`
- **Caminho:** `/api/analise-curriculo/incluir`
- **Cabeçalhos:**
  - `Origin: http://127.0.0.1:<porta>` (ou `http://localhost:<porta>`)
  - `X-Painel-Token: <token>`
  - `Content-Type: application/json`
- **Corpo da Requisição:**
```json
{
  "item_id": "f1",
  "afirmacao_id": "AF-014"
}
```
- **Resposta (`200 OK`):**
```json
{
  "ok": true,
  "item_id": "f1",
  "afirmacao_id": "AF-014",
  "destino": "confere",
  "mensagem": "Afirmação incluída na proposta de currículo para as próximas versões."
}
```

---

### 2.3 Escrita: `POST /api/analise-curriculo/marcar`

Marca um item de "Sem prova" ou "Lacunas" como revisado ou ignorado.

- **Método:** `POST`
- **Caminho:** `/api/analise-curriculo/marcar`
- **Cabeçalhos:**
  - `Origin: http://127.0.0.1:<porta>`
  - `X-Painel-Token: <token>`
  - `Content-Type: application/json`
- **Corpo da Requisição:**
```json
{
  "item_id": "s1",
  "acao": "ignorar"
}
```
*Valores aceitos em `acao`:* `"revisar"` ou `"ignorar"`.
- **Resposta (`200 OK`):**
```json
{
  "ok": true,
  "item_id": "s1",
  "acao": "ignorar",
  "mensagem": "Item atualizado."
}
```

---

### 2.4 Escrita: `POST /api/analise-curriculo/entrevista`

Transforma uma lacuna frequente em pauta imediata para a ferramenta `/entrevista`, que gera perguntas para colher relatos do candidato.

- **Método:** `POST`
- **Caminho:** `/api/analise-curriculo/entrevista`
- **Cabeçalhos:**
  - `Origin: http://127.0.0.1:<porta>`
  - `X-Painel-Token: <token>`
  - `Content-Type: application/json`
- **Corpo da Requisição:**
```json
{
  "item_id": "l1"
}
```
- **Resposta (`200 OK`):**
```json
{
  "ok": true,
  "item_id": "l1",
  "pergunta": "Você já respondeu por orçamento de time ou de nuvem? Qual valor aproximado?",
  "mensagem": "Pergunta de entrevista formulada com sucesso."
}
```

---

## 3. Matriz 2×2: Eixos, Situações e Cores Semânticas

A matriz organiza os itens em dois eixos conceituais determinísticos:

```
                            TEM DADO QUE PROVA            NÃO TEM DADO
                   ┌─────────────────────────────┬─────────────────────────────┐
                   │           CONFERE           │          SEM PROVA          │
   ESTÁ NO CV      │       (Situação: Verde)     │       (Situação: Âmbar)     │
                   │  No CV e com dado que prova │  No CV, mas falta dado/núm  │
                   ├─────────────────────────────┼─────────────────────────────┤
                   │         FORA DO CV          │           LACUNAS           │
   FORA DO CV      │       (Situação: Azul)      │      (Situação: Vermelho)   │
                   │  Tem dado, fora do CV       │  Exigido por vagas no radar │
                   └─────────────────────────────┴─────────────────────────────┘
```

### 3.1 Tokens de Cor por Situação (Mundo Misto)

Conforme estabelecido em `docs/design/PAINEL.md`, as cores desta aba são **cores de situação funcional**, e não de raridade/aderência:

| Situação | Token CSS | Tema Claro | Tema Escuro | Semântica e Ação |
|---|---|---|---|---|
| **Confere** | `--ok` | `#00754E` | `#4FD3A0` | Comprovado. Nada a fazer ou ver evidência. |
| **Sem prova** | `--atencao` | `#7A5800` | `#F5C518` | Alerta de risco. Adicionar prova ou tirar do CV. |
| **Fora do CV** | `--info` | `#145DB8` | `#72B5FF` | Oportunidade. Incluir no CV para reforçar perfil. |
| **Lacunas** | `--perigo` | `#B3261E` | `#FF8A7F` | Faltante em vagas. Responder pergunta ou ignorar. |

### 3.2 Tipografia

- **Contador Numérico Principal (`.q-n`):** renderizado estritamente na fonte **Pixelify Sans** (`var(--pixel)`), tamanho 38–40 px, peso 500, com `font-variant-numeric: tabular-nums`.
- **Rótulos, Títulos e Descrições:** renderizados na fonte **Schibsted Grotesk** (`var(--fonte)`), tamanhos 13–18 px.

---

## 4. Estrutura HTML em `panel/template.html`

### 4.1 Aba na Placa Superior

O botão da aba e seu badge numérico na barra `.placa`:

```html
<nav class="nav" aria-label="Seções do painel">
  <button type="button" class="aba-btn" data-aba="vagas">
    Vagas <span class="cont" id="badge-vagas">0</span>
  </button>
  <button type="button" class="aba-btn" data-aba="historico">
    Histórico <span class="cont" id="badge-historico">0</span>
  </button>
  <button type="button" class="aba-btn" data-aba="processos">
    Processos <span class="cont" id="badge-processos">0</span>
  </button>
  <button type="button" class="aba-btn" data-aba="curriculo">
    Currículo e provas <span class="cont" id="badge-curriculo">0</span>
  </button>
</nav>
```

### 4.2 Painel Principal (`#painel-curriculo`)

Localizado como irmão de `#painel-vagas`, `#painel-historico` e `#painel-processos`:

```html
<!-- Painel Currículo e provas (F10.4) -->
<main class="A-tela painel-curriculo" id="painel-curriculo" hidden>
  <div class="pagina curriculo-pagina">
    <header class="curriculo-cabecalho">
      <h1>Currículo e provas</h1>
      <p class="sub">
        Compara o que está no seu currículo com o que a sua base consegue provar. Ajuste os itens aqui; a mudança vale para os próximos CVs.
      </p>
    </header>

    <!-- Matriz 2x2 CV x Dado -->
    <section class="matriz-container" aria-label="Matriz de alinhamento entre currículo e dados comprobatórios">
      <div class="matriz" id="matriz-curriculo">
        <!-- Linha 0 (Eixos horizontais superiores) -->
        <span class="eixo-vazio" aria-hidden="true"></span>
        <span class="eixo eixo-h">Tem dado que prova</span>
        <span class="eixo eixo-h">Não tem dado</span>

        <!-- Linha 1: Está no CV -->
        <span class="eixo eixo-v">Está no CV</span>
        <button type="button" class="celula" data-q="confere" id="cel-confere" aria-pressed="true">
          <span class="q-n" id="n-confere">0</span>
          <span class="q-t">Confere</span>
          <span class="q-d">No CV e com dado que prova</span>
          <span class="q-acao" id="acao-confere">Em dia</span>
        </button>
        <button type="button" class="celula" data-q="sem_prova" id="cel-sem_prova" aria-pressed="false">
          <span class="q-n" id="n-sem_prova">0</span>
          <span class="q-t">Sem prova</span>
          <span class="q-d">No CV, mas falta dado ou número</span>
          <span class="q-acao" id="acao-sem_prova">Revisar</span>
        </button>

        <!-- Linha 2: Fora do CV -->
        <span class="eixo eixo-v">Fora do CV</span>
        <button type="button" class="celula" data-q="fora_do_cv" id="cel-fora_do_cv" aria-pressed="false">
          <span class="q-n" id="n-fora_do_cv">0</span>
          <span class="q-t">Fora do CV</span>
          <span class="q-d">Tem dado, mas não está no CV</span>
          <span class="q-acao" id="acao-fora_do_cv">Incluir</span>
        </button>
        <button type="button" class="celula" data-q="lacunas" id="cel-lacunas" aria-pressed="false">
          <span class="q-n" id="n-lacunas">0</span>
          <span class="q-t">Lacunas</span>
          <span class="q-d">Pedido pelas vagas, sem dado na base</span>
          <span class="q-acao" id="acao-lacunas">Responder</span>
        </button>
      </div>
    </section>

    <!-- Bloco Detalhado de Itens da Situação Ativa -->
    <section class="painel itens-q" id="bloco-itens-curriculo" aria-labelledby="cab-quadrante-ativo">
      <header class="cab-q" id="cab-quadrante-ativo" data-q="confere">
        <span class="bola-situacao cheia" aria-hidden="true"></span>
        <strong id="tit-quadrante-ativo">Confere</strong>
        <span class="meta" id="desc-quadrante-ativo">No CV e com dado que prova</span>
        <span class="contador-q" id="cont-quadrante-ativo">(0 itens)</span>
      </header>

      <!-- Barra de ferramentas e busca rápida da situação -->
      <div class="ferramentas-q">
        <label class="busca-q">
          <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <span class="sr">Filtrar itens desta situação</span>
          <input class="campo" id="filtro-busca-curriculo" placeholder="Buscar por termo ou código..." aria-label="Filtrar itens desta situação">
        </label>
      </div>

      <!-- Feed dinâmico de cards -->
      <div class="lista-itens" id="lista-itens-curriculo" role="region" aria-live="polite">
        <div class="vazio" id="curriculo-estado">
          <strong>Carregando análise do currículo...</strong>
          Confrontando itens do CV com a base de dados.
        </div>
      </div>
    </section>
  </div>
</main>
```

---

## 5. Design System e Estilos CSS

Todos os estilos seguem rigorosamente os tokens declarados no `:root`, `[data-tema="claro"]` e `[data-tema="escuro"]`.

```css
/* =====================================================================
   Aba Currículo e Provas (F10.4)
   ===================================================================== */
.painel-curriculo {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.painel-curriculo[hidden] {
  display: none !important;
}

.curriculo-pagina {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 24px 60px;
  width: 100%;
}

.curriculo-cabecalho {
  margin-bottom: 24px;
}
.curriculo-cabecalho h1 {
  margin: 0 0 6px;
  font-size: var(--t-2xl);
  font-weight: 700;
  color: var(--tx);
}
.curriculo-cabecalho .sub {
  margin: 0;
  font-size: var(--t-sm);
  color: var(--tx2);
  max-width: 75ch;
  line-height: 1.5;
}

/* Matriz 2x2 */
.matriz-container {
  margin-bottom: 24px;
}
.matriz {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 12px;
  align-items: stretch;
}

.matriz .eixo-vazio {
  width: 90px;
}

.matriz .eixo {
  font-size: var(--t-sm);
  font-weight: 600;
  color: var(--tx2);
  display: flex;
  align-items: center;
}
.matriz .eixo-h {
  justify-content: center;
  padding: 4px 8px;
}
.matriz .eixo-v {
  justify-content: flex-end;
  padding-right: 12px;
  text-align: right;
  white-space: nowrap;
}

/* Células da Matriz */
.celula {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 14px;
  align-items: start;
  min-height: 116px;
  padding: 16px 18px;
  border: 1px solid var(--borda);
  border-radius: var(--r-lg);
  background: var(--sup);
  text-align: left;
  cursor: pointer;
  color: var(--tx);
  position: relative;
  transition: border-color var(--dur) var(--saida), box-shadow var(--dur) var(--saida), background var(--dur) var(--saida);
}
.celula:hover {
  border-color: var(--borda2);
  background: var(--sup2);
}

/* Situações e Cores Dedicadas */
.celula[data-q="confere"] {
  --cor: var(--ok);
  --tc: var(--ok);
}
.celula[data-q="sem_prova"] {
  --cor: var(--atencao);
  --tc: var(--atencao);
}
.celula[data-q="fora_do_cv"] {
  --cor: var(--info);
  --tc: var(--info);
}
.celula[data-q="lacunas"] {
  --cor: var(--perigo);
  --tc: var(--perigo);
}

.celula[aria-pressed="true"] {
  border-color: var(--cor);
  box-shadow: inset 0 0 0 1.5px var(--cor);
  background: var(--sup2);
}

.celula .q-n {
  grid-row: span 3;
  font-family: var(--pixel);
  font-size: 38px;
  line-height: 1;
  font-weight: 500;
  letter-spacing: -.02em;
  color: var(--tc);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}
.celula .q-t {
  font-weight: 700;
  font-size: var(--t-lg);
  color: var(--tx);
}
.celula .q-d {
  font-size: var(--t-xs);
  color: var(--tx2);
  line-height: 1.35;
}
.celula .q-acao {
  font-size: var(--t-xs);
  font-weight: 600;
  color: var(--tc);
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Feedback Visual Interativo ("pisca uma vez") */
.celula.chegou {
  animation: piscar-celula 700ms var(--saida);
}
@keyframes piscar-celula {
  0% {
    box-shadow: inset 0 0 0 3px var(--cor);
  }
  100% {
    box-shadow: inset 0 0 0 0 transparent;
  }
}

/* Seção de Itens da Situação */
.itens-q {
  border: 1px solid var(--borda);
  border-radius: var(--r-lg);
  background: var(--sup);
  overflow: hidden;
}
.cab-q {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--borda);
  background: var(--sup2);
}
.cab-q .bola-situacao {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.cab-q[data-q="confere"] .bola-situacao { background: var(--ok); }
.cab-q[data-q="sem_prova"] .bola-situacao { background: var(--atencao); }
.cab-q[data-q="fora_do_cv"] .bola-situacao { background: var(--info); }
.cab-q[data-q="lacunas"] .bola-situacao { background: var(--perigo); }

.cab-q strong {
  font-size: var(--t-lg);
  color: var(--tx);
}
.cab-q .meta {
  color: var(--tx2);
  font-size: var(--t-sm);
}
.cab-q .contador-q {
  margin-left: auto;
  font-size: var(--t-xs);
  font-weight: 600;
  color: var(--tx3);
  font-variant-numeric: tabular-nums;
}

.ferramentas-q {
  padding: 10px 20px;
  border-bottom: 1px solid var(--borda);
  background: var(--sup);
}
.busca-q {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tx3);
}
.busca-q .campo {
  flex: 1;
  max-width: 360px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--borda);
  border-radius: var(--r);
  background: var(--sup);
  color: var(--tx);
  font-size: var(--t-sm);
}

/* Lista e Cards de Itens */
.lista-itens {
  display: flex;
  flex-direction: column;
}

.it {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--borda);
  background: var(--sup);
  transition: background var(--dur) var(--saida);
}
.it:last-child {
  border-bottom: 0;
}
.it:hover {
  background: var(--sup2);
}

.it-texto {
  margin: 0;
  font-size: var(--t-md);
  color: var(--tx);
  line-height: 1.45;
  max-width: 80ch;
}

/* Badges e Rastreabilidade */
.ids {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.id {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 7px;
  border-radius: var(--r-sm);
  background: var(--sup3);
  color: var(--tx2);
  font-size: var(--t-xs);
  font-weight: 600;
  border: 1px solid var(--borda);
}
.id.af {
  border-color: var(--borda2);
}
.id.nivel-verificado {
  background: #00754E18;
  color: var(--ok);
  border-color: var(--ok);
}
.id.nivel-entregue {
  background: #145DB818;
  color: var(--info);
  border-color: var(--info);
}
.id.nivel-relato {
  background: #7A580018;
  color: var(--atencao);
  border-color: var(--atencao);
}
.id.peso {
  background: #B3261E18;
  color: var(--perigo);
  border-color: var(--perigo);
  font-variant-numeric: tabular-nums;
}

.it-motivo {
  margin: 0;
  font-size: var(--t-xs);
  color: var(--tx3);
  font-style: italic;
}

/* Barra de Ações do Item */
.acoes-i {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 4px;
}

.btn.peq {
  height: 30px;
  padding: 0 10px;
  font-size: var(--t-xs);
}

/* =====================================================================
   Responsividade: Telas Médias e Mobile (375 px)
   ===================================================================== */
@media (max-width: 900px) {
  .matriz {
    grid-template-columns: 1fr 1fr;
  }
  .matriz .eixo-vazio,
  .matriz .eixo {
    display: none;
  }
}

@media (max-width: 600px) {
  .curriculo-pagina {
    padding: 12px 12px 60px;
  }
  .matriz {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .celula {
    min-height: 96px;
    padding: 12px 14px;
  }
  .celula .q-n {
    font-size: 32px;
  }
  .it {
    padding: 14px 14px;
  }
  .acoes-i {
    width: 100%;
    justify-content: flex-start;
  }
  .acoes-i .btn {
    flex: 1 1 auto;
  }
  .busca-q .campo {
    max-width: 100%;
  }
}
```

---

## 6. Módulo de Lógica Pura: `panel/curriculoLogic.mjs`

Todo cálculo de agrupamento, filtros, ordenação determinística e payloads HTTP fica isolado no módulo puro `panel/curriculoLogic.mjs`, livre de APIs do browser e 100% testável via Node.js test runner.

### 6.1 Constantes Exportadas

```javascript
export const SITUACOES = ['confere', 'sem_prova', 'fora_do_cv', 'lacunas'];

export const METADADOS_SITUACAO = {
  confere: {
    nome: 'Confere',
    descricao: 'No CV e com dado que prova',
    acaoPadrao: 'Em dia',
    corClasse: 'ok',
    eixoVertical: 'Está no CV',
    eixoHorizontal: 'Tem dado que prova',
  },
  sem_prova: {
    nome: 'Sem prova',
    descricao: 'No CV, mas falta dado ou número',
    acaoPadrao: 'Revisar',
    corClasse: 'atencao',
    eixoVertical: 'Está no CV',
    eixoHorizontal: 'Não tem dado',
  },
  fora_do_cv: {
    nome: 'Fora do CV',
    descricao: 'Tem dado, mas não está no CV',
    acaoPadrao: 'Incluir',
    corClasse: 'info',
    eixoVertical: 'Fora do CV',
    eixoHorizontal: 'Tem dado que prova',
  },
  lacunas: {
    nome: 'Lacunas',
    descricao: 'Pedido pelas vagas, sem dado na base',
    acaoPadrao: 'Responder',
    corClasse: 'perigo',
    eixoVertical: 'Fora do CV',
    eixoHorizontal: 'Não tem dado',
  },
};

export const FORCA_PROVA = {
  verificado: 3,
  entregue: 2,
  proposto: 1,
  relato: 0,
};
```

### 6.2 Normalização de Respostas e Tolerância

```javascript
/**
 * Normaliza resposta da API, suportando tanto o contrato novo (/api/analise-curriculo)
 * quanto o legado de transição (/api/quadrantes com a, b, c, d).
 */
export function normalizarRespostaAnalise(dadosApi = {}) {
  if (!dadosApi || typeof dadosApi !== 'object') {
    return {
      confere: [],
      sem_prova: [],
      fora_do_cv: [],
      lacunas: [],
      contagem: { confere: 0, sem_prova: 0, fora_do_cv: 0, lacunas: 0 },
      avisos: [],
    };
  }

  // Se já estiver no formato novo com as 4 chaves
  if (Array.isArray(dadosApi.confere) || Array.isArray(dadosApi.sem_prova)) {
    const confere = (dadosApi.confere || []).map(i => normalizarItem(i, 'confere'));
    const sem_prova = (dadosApi.sem_prova || []).map(i => normalizarItem(i, 'sem_prova'));
    const fora_do_cv = (dadosApi.fora_do_cv || []).map(i => normalizarItem(i, 'fora_do_cv'));
    const lacunas = (dadosApi.lacunas || []).map(i => normalizarItem(i, 'lacunas'));

    return {
      confere,
      sem_prova,
      fora_do_cv,
      lacunas,
      contagem: {
        confere: confere.length,
        sem_prova: sem_prova.length,
        fora_do_cv: fora_do_cv.length,
        lacunas: lacunas.length,
      },
      avisos: Array.isArray(dadosApi.avisos) ? dadosApi.avisos : [],
    };
  }

  // Mapeamento de fallback do formato legado de quadrantes (a, b, c, d)
  const confere = (dadosApi.a || []).map(i => normalizarItem(i, 'confere'));
  const fora_do_cv = (dadosApi.b || []).map(i => normalizarItem(i, 'fora_do_cv'));
  const sem_prova = (dadosApi.c || []).map(i => normalizarItem(i, 'sem_prova'));
  const lacunas = (dadosApi.d || []).map(i => normalizarItem(i, 'lacunas'));

  return {
    confere,
    sem_prova,
    fora_do_cv,
    lacunas,
    contagem: {
      confere: confere.length,
      sem_prova: sem_prova.length,
      fora_do_cv: fora_do_cv.length,
      lacunas: lacunas.length,
    },
    avisos: Array.isArray(dadosApi.avisos) ? dadosApi.avisos : [],
  };
}

/**
 * Normaliza um item individual garantindo campos obrigatórios para renderização.
 */
export function normalizarItem(item = {}, situacao = 'confere') {
  const id = String(item.id || item.codigo || item.alvo || Math.random().toString(36).slice(2));
  const texto = String(item.texto || item.descricao || item.motivo || '');
  const afirmacoes = Array.isArray(item.afirmacoes)
    ? item.afirmacoes.map(a => (typeof a === 'object' ? a.id : String(a)))
    : Array.isArray(item.claim_ids)
    ? item.claim_ids
    : [];
  const evidencias = Array.isArray(item.evidencias) ? item.evidencias.map(String) : [];
  const nivel_prova = item.nivel_prova || (item.afirmacoes?.[0]?.nivel_prova ?? null);
  const peso = typeof item.peso === 'number' ? item.peso : null;
  const motivo = item.motivo || null;
  const pergunta = item.pergunta || item.pergunta_sugerida || null;

  return {
    id,
    texto,
    afirmacoes,
    evidencias,
    nivel_prova,
    peso,
    motivo,
    pergunta,
    situacao,
  };
}
```

### 6.3 Agrupamento, Filtros e Ordenação

```javascript
/**
 * Separa e filtra itens das 4 situações excluindo identificadores ignorados.
 */
export function categorizarItens(analise = {}, ignorados = new Set()) {
  const norm = normalizarRespostaAnalise(analise);
  const ign = ignorados instanceof Set ? ignorados : new Set(ignorados || []);

  return {
    confere: norm.confere.filter(i => !ign.has(i.id)),
    sem_prova: norm.sem_prova.filter(i => !ign.has(i.id)),
    fora_do_cv: norm.fora_do_cv.filter(i => !ign.has(i.id)),
    lacunas: norm.lacunas.filter(i => !ign.has(i.id)),
  };
}

/**
 * Calcula os totais de cada célula e o badge da aba.
 * O badge deve somar os itens que pedem atenção: sem_prova + lacunas.
 */
export function calcularTotaisCurriculo(analise = {}, ignorados = new Set()) {
  const cat = categorizarItens(analise, ignorados);
  const confere = cat.confere.length;
  const sem_prova = cat.sem_prova.length;
  const fora_do_cv = cat.fora_do_cv.length;
  const lacunas = cat.lacunas.length;
  const badgeCurriculo = sem_prova + lacunas;

  return {
    confere,
    sem_prova,
    fora_do_cv,
    lacunas,
    badgeCurriculo,
    temAtencao: badgeCurriculo > 0,
  };
}

/**
 * Filtra lista de itens por termo de busca textual e nível de prova.
 */
export function filtrarItens(itens = [], { busca = '', nivel = '' } = {}) {
  let resultado = [...itens];

  if (busca && typeof busca === 'string') {
    const q = busca.toLowerCase().trim();
    resultado = resultado.filter(i =>
      i.texto.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q) ||
      i.afirmacoes.some(a => a.toLowerCase().includes(q)) ||
      (i.motivo && i.motivo.toLowerCase().includes(q))
    );
  }

  if (nivel && typeof nivel === 'string') {
    resultado = resultado.filter(i => i.nivel_prova === nivel);
  }

  return resultado;
}

/**
 * Ordena itens deterministicamente de acordo com a situação:
 * - lacunas: maior peso primeiro, depois alfabético por texto.
 * - fora_do_cv: maior nível de prova (verificado > entregue), depois alfabético por id.
 * - sem_prova: itens com divergência/motivo primeiro, depois id.
 * - confere: alfabético por id.
 */
export function ordenarItens(itens = [], situacao = 'confere') {
  const copia = [...itens];

  if (situacao === 'lacunas') {
    return copia.sort((a, b) => (b.peso || 0) - (a.peso || 0) || a.texto.localeCompare(b.texto, 'pt-BR'));
  }

  if (situacao === 'fora_do_cv') {
    return copia.sort((a, b) => {
      const forcaA = FORCA_PROVA[a.nivel_prova] ?? -1;
      const forcaB = FORCA_PROVA[b.nivel_prova] ?? -1;
      return forcaB - forcaA || a.id.localeCompare(b.id, 'pt-BR', { numeric: true });
    });
  }

  if (situacao === 'sem_prova') {
    return copia.sort((a, b) => {
      const temMotivoA = Boolean(a.motivo);
      const temMotivoB = Boolean(b.motivo);
      if (temMotivoA !== temMotivoB) return temMotivoA ? -1 : 1;
      return a.id.localeCompare(b.id, 'pt-BR', { numeric: true });
    });
  }

  return copia.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }));
}
```

### 6.4 Formatação Visual e Payloads de Ação

```javascript
/**
 * Retorna classe semântica correspondente à situação para estilização CSS.
 */
export function obterClasseCorSituacao(situacao) {
  return METADADOS_SITUACAO[situacao]?.corClasse || 'normal';
}

/**
 * Formata o badge do nível de prova.
 */
export function formatarNivelProvaBadge(nivel) {
  if (!nivel) return null;
  const classe = `nivel-${nivel}`;
  return {
    label: nivel,
    classe,
    verificado: nivel === 'verificado',
  };
}

/**
 * Formata o badge de peso de lacuna.
 */
export function formatarPesoBadge(peso) {
  if (typeof peso !== 'number') return null;
  return {
    label: `peso ${peso}`,
    peso,
  };
}

/**
 * Monta payload de inclusão no currículo.
 */
export function montarPayloadIncluir(itemId, opcoes = {}) {
  if (!itemId) throw new Error('itemId é obrigatório para inclusão.');
  return {
    item_id: String(itemId),
    afirmacao_id: opcoes.afirmacao_id ? String(opcoes.afirmacao_id) : undefined,
  };
}

/**
 * Monta payload de marcação (revisar ou ignorar).
 */
export function montarPayloadMarcar(itemId, acao) {
  if (!itemId) throw new Error('itemId é obrigatório.');
  if (!['revisar', 'ignorar'].includes(acao)) {
    throw new Error(`Ação inválida: "${acao}". Esperado "revisar" ou "ignorar".`);
  }
  return {
    item_id: String(itemId),
    acao,
  };
}

/**
 * Monta payload para geração de pergunta de entrevista.
 */
export function montarPayloadEntrevista(itemId) {
  if (!itemId) throw new Error('itemId é obrigatório para geração de entrevista.');
  return {
    item_id: String(itemId),
  };
}

/**
 * Devolve ícones SVG seguros inline, sem qualquer tag <img>.
 */
export function obterIconeSvgCurriculo(tipo) {
  const map = {
    check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    atencao: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    plus: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    entrevista: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    busca: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };
  return map[tipo] || map.check;
}
```

---

## 7. Ciclo de Vida da Aba e Integração no Cliente Web

No script principal de `panel/template.html`:

### 7.1 Registro no Dicionário de Telas e Alternador de Abas

```javascript
// Registrado em 'telas'
const telas = {
  vagas: document.getElementById('painel-vagas'),
  historico: document.getElementById('painel-historico'),
  processos: document.getElementById('painel-processos'),
  curriculo: document.getElementById('painel-curriculo'),
};

function alternarAba(nomeAba) {
  botoesAba.forEach(btn => {
    if (btn.dataset.aba === nomeAba) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  Object.entries(telas).forEach(([nome, el]) => {
    if (el) el.hidden = (nome !== nomeAba);
  });

  if (nomeAba === 'historico') carregarHistorico();
  if (nomeAba === 'processos') carregarProcessos();
  if (nomeAba === 'curriculo') carregarCurriculo();
}
```

### 7.2 Estado Local da Aba Currículo

```javascript
let estadoCurriculo = {
  dados: null,
  situacaoAtiva: 'confere',
  ignorados: new Set(),
  busca: '',
  carregando: false,
};
```

### 7.3 Fluxo de Ações com Feedback Visual Interativo ("Pisca uma vez")

Quando um botão de ação for acionado (por exemplo, *"Incluir no CV"*):
1. **Chamada de API:**
   - Realiza `fetch('/api/analise-curriculo/incluir', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Painel-Token': token }, body: JSON.stringify(payload) })`.
2. **Atualização do Estado Local:**
   - O item é transferido da categoria de origem para a de destino (ou adicionado aos ignorados se a ação for `ignorar`).
3. **Disparo da Animação na Célula de Destino:**
   ```javascript
   function acionarFeedbackDestino(chaveDestino) {
     const celulaDestino = document.querySelector(`.celula[data-q="${chaveDestino}"]`);
     if (!celulaDestino) return;
     celulaDestino.classList.remove('chegou');
     void celulaDestino.offsetWidth; // Força reflow para reiniciar animação CSS
     celulaDestino.classList.add('chegou');
   }
   ```
4. **Re-renderização dos Contadores:**
   - Atualização imediata do `#badge-curriculo`, dos números `.q-n` em cada célula e da lista do quadrante aberto.

---

## 8. Roteiro TDD Passo a Passo

A implementação deve ser estritamente guiada por testes automatizados, dividida em três fases sem adivinhação.

### Fase 1: Suíte de Testes Unitários de Lógica Pura (`tests/unit/panel-curriculo-logic.test.mjs`)

Criar o arquivo de teste antes do módulo `panel/curriculoLogic.mjs`, cobrindo:

1. **`normalizarRespostaAnalise`:**
   - Valida parse de payloads estruturados no padrão novo (`confere`, `sem_prova`, `fora_do_cv`, `lacunas`).
   - Valida fallback e conversão transparente do padrão legado (`a`, `b`, `c`, `d`).
   - Resiste a entradas nulas, vazias ou malformadas sem lançar exceções não tratadas.
2. **`categorizarItens` e `calcularTotaisCurriculo`:**
   - Exclui itens marcados no conjunto `ignorados`.
   - Soma corretamente `badgeCurriculo = sem_prova + lacunas`.
   - Identifica flag `temAtencao` quando há pendências.
3. **`filtrarItens` e `ordenarItens`:**
   - Filtra por termos de busca parciais, IDs e motivos.
   - Ordena `lacunas` pelo maior peso decrescente.
   - Ordena `fora_do_cv` pela robustez da prova (`verificado` antes de `entregue`).
   - Mantém estabilidade determinística nos desempates.
4. **Montagem de Payloads (`montarPayloadIncluir`, `montarPayloadMarcar`, `montarPayloadEntrevista`):**
   - Lança erro semântico para parâmetros obrigatórios ausentes.
   - Rejeita ações desconhecidas fora de `revisar` / `ignorar`.
   - Gera corpos JSON estritos.
5. **Garantia de SVGs Inline e Zero Tags `<img>`:**
   - `obterIconeSvgCurriculo` retorna strings iniciando com `<svg` e finalizando com `</svg>`.
   - Valida que nenhuma tag `<img` é gerada.

### Fase 2: Implementação de `panel/curriculoLogic.mjs`

Implementar as funções em `panel/curriculoLogic.mjs` até que todos os testes da Fase 1 passem com sucesso:
```bash
node --test tests/unit/panel-curriculo-logic.test.mjs
```

### Fase 3: Suíte de Testes de Conformidade do Template (`tests/unit/panel-curriculo-template.test.mjs`)

Criar testes para validar estaticamente a integridade de `panel/template.html`:

1. **Presença dos Elementos Estruturais:**
   - Tag `<main id="painel-curriculo" class="A-tela painel-curriculo" hidden>` presente.
   - Botão de aba `data-aba="curriculo"` com `#badge-curriculo`.
   - Matriz 2×2 `#matriz-curriculo` com as 4 células (`#cel-confere`, `#cel-sem_prova`, `#cel-fora_do_cv`, `#cel-lacunas`).
   - Subtítulo factual exato presente.
2. **Conformidade com o Design System:**
   - Presença da classe de animação `.chegou` com `@keyframes piscar-celula`.
   - Uso de `var(--pixel)` para a contagem `.q-n`.
   - Tokens semânticos de situação configurados nas células (`var(--ok)`, `var(--atencao)`, `var(--info)`, `var(--perigo)`).
3. **Responsividade Mobile em 375 px:**
   - Regra `@media (max-width: 600px)` definindo `grid-template-columns: 1fr` para a matriz.
   - Sem propriedades de largura fixa que provoquem transbordamento lateral.
4. **Zero Tags `<img>`:**
   - Garantir que o template inteiro não possui tags `<img>`.
5. **Integração no Script do Painel:**
   - Mapeamento em `telas.curriculo`.
   - Invocação de `carregarCurriculo()` no alternador de abas.
   - Manipuladores de eventos de clique nas células e botões de ação.

---

## 9. Diretrizes de Segurança, Privacidade e Checklist de Validação

### 9.1 Regras de Privacidade e Segurança
- **Repositório Público:** Nunca versionar caminhos absolutos de máquinas de desenvolvedores nem dados reais.
- **Nenhum Envio Externo:** O painel opera exclusivamente em `127.0.0.1`. Nenhuma requisição a CDNs, analytics ou serviços na internet.
- **Lista de Bloqueio do Privacy Scan:** Atenção estrita para não usar termos restritos (ex.: nome de empresas bloqueadas em textos versionados).
- **Dados Fictícios nos Testes:** Testes unitários devem utilizar exclusivamente a persona fictícia com domínio `.test`.

### 9.2 Checklist de Conclusão da Fatia F10.4
- [ ] Módulo `panel/curriculoLogic.mjs` criado e exportando funções puras.
- [ ] Suíte `tests/unit/panel-curriculo-logic.test.mjs` rodando e passando 100%.
- [ ] Estrutura HTML/CSS implementada em `panel/template.html`.
- [ ] Suíte `tests/unit/panel-curriculo-template.test.mjs` validando estrutura, tokens e acessibilidade.
- [ ] Matriz responsiva testada em 1280 px, 900 px e 375 px sem rolagem lateral.
- [ ] Feedback visual `.chegou` animando a célula de destino após ação.
- [ ] `npm test -- --test-concurrency=4` passando sem erros nem regressões.
- [ ] `privacy scan --all` e `plugin validate` aprovados.
