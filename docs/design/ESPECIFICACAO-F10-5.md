# Especificação Técnica: Fatia F10.5 — Menu ⋯ e Coruja Batedora

**Versão:** 1.0  
**Data:** 18/10/2026  
**Status:** Aprovado para Implementação  
**Branch de Trabalho:** `feat/F10.5-menu-coruja`  
**Referência de Design:** `docs/design/PAINEL.md`, `PLANO-F10-interface-2026-10-18.md` (seção F10.5)

---

## 1. Visão Geral e Objetivos da Fatia

A fatia **F10.5** consolida duas funcionalidades vitais de usabilidade, transparência e navegação na placa superior (cabeçalho) do painel web do CareerBounty:

1. **Menu ⋯ (Dropdown/Popover de Utilidades na Placa):**
   - Agrupa utilidades operacionais secundárias sem poluir a navegação primária por abas.
   - Fornece acesso a três modais modulares e acessíveis:
     - **Respostas de formulário:** consulta e busca no banco de respostas reutilizáveis de formulário (`answers.yml` / answer bank) e visualização de perguntas pendentes.
     - **Fontes e cobertura:** transparência sobre os portais de onde vieram as vagas da rodada, status do radar e recência da varredura.
     - **Perfil do LinkedIn:** interface de apoio educativo para otimização campo a campo, com aviso explícito de não envio direto.
   - Controle de acessibilidade para alternar (pausar ou retomar) a animação do céu em pixel art no canvas de fundo, persistindo a preferência em `localStorage.getItem('cb-animacao-pausada')` e respeitando estritamente a diretiva do sistema operacional (`prefers-reduced-motion: reduce`).

2. **Coruja Batedora (Mascote e Notificações Factuais):**
   - Mascote visual desenhado em **pixel art 12×12** cunhado em ladrilho com bico laranja de item lendário, renderizado exclusivamente via SVG inline puro (zero tags `<img>`).
   - Indicador visual de novidade: **losango dourado** (`.losango-recado`) que surge junto à coruja quando há recados factuais pendentes ou não lidos.
   - Balão factual (`#balao-coruja`) que se abre por **6 segundos** ao entrar no painel ou alternar entre as abas (`vagas`, `processos`, `curriculo`, `historico`), ou mediante clique na coruja/losango.
   - **Regra Factual Estrita:** O recado é calculado em tempo de execução a partir de dados reais já carregados em memória, sem frases genéricas ou slogans motivacionais de IA.
   - **Responsividade:** O botão da coruja e seu balão desaparecem automaticamente em telas estreitas (`<= 600px` e `375px`), onde o ícone principal na placa já a representa graficamente.

---

## 2. Arquitetura de Componentes e Fluxo de Dados

```
+----------------------------------------------------------------------------------------------------+
|                                           PLACA SUPERIOR                                           |
|  [Logo SVG] CareerBounty   [Vagas (X)] [Processos (Y)] [Currículo (Z)] [Histórico (W)]             |
|                                                    [Coruja SVG] [Losango]  [Tema]  [Menu ⋯]        |
+---------------------------------------------------------+------------------------------+-----------+
                                                          |                              |
                                         (alternarAba / clique)                   (clique menu)
                                                          v                              v
                                           +--------------+-------------+   +------------+------------+
                                           |      #balao-coruja         |   |     #menu-suspenso      |
                                           | Recado Factual (6s auto)   |   | - Respostas Formulário  |
                                           |   via menuCorujaLogic.mjs  |   | - Fontes e Cobertura    |
                                           +----------------------------+   | - Perfil do LinkedIn    |
                                                                            | - Parar/Retomar Fundo   |
                                                                            +------------+------------+
                                                                                         |
                                      +--------------------------------------------------+
                                      | (clique item 1, 2 ou 3)
                                      v
                      +---------------+-----------------------------------------------+
                      |                        MODAIS ACESSÍVEIS                      |
                      |  #modal-respostas-formulario  #modal-fontes-cobertura  #modal-perfil-linkedin  |
                      |  (dialog / aria-modal=true)   (dialog / aria-modal)    (dialog / apoio)        |
                      +---------------------------------------------------------------+
```

### 2.1 Separação de Responsabilidades

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| **Lógica Pura** | `panel/menuCorujaLogic.mjs` | Cálculo de recados factuais, filtragem de respostas, agregação de cobertura e alternância de estado de animação. Módulo puramente funcional, sem efeitos colaterais nem dependência de DOM. |
| **Interface / Template** | `panel/template.html` | Estrutura semântica HTML, estilização via tokens CSS do Design System Misto, SVGs inline e orquestração de eventos DOM. |
| **API do Painel** | `panel/server.mjs` | Rota `GET /api/respostas` que expõe de forma segura as respostas salvas do Answer Bank (`answers.yml`), complementando `GET /api/perguntas`. |
| **Testes Unitários** | `tests/unit/panel-menu-coruja-logic.test.mjs` | Testes automatizados TDD da lógica funcional pura. |
| **Testes Estruturais** | `tests/unit/panel-menu-coruja-template.test.mjs` | Asserções de conformidade de acessibilidade, responsividade, seletores, tokens e ausência de tags `<img>`. |

---

## 3. Contratos de Dados e Endpoints

### 3.1 Endpoint de Respostas Salvas: `GET /api/respostas`

Permite ao modal `#modal-respostas-formulario` carregar as respostas cadastradas no banco de respostas reutilizáveis (`answers.yml`).

#### Requisição
- **Método:** `GET`
- **Caminho:** `/api/respostas`
- **Cabeçalhos:**
  - `X-Painel-Token: <token-de-64-caracteres>`

#### Resposta `200 OK`
```json
{
  "respostas": [
    {
      "id": "pq-pretensao-salarial-global",
      "variantes_label": [
        "Pretensão salarial",
        "Qual sua pretensão salarial?",
        "Expectativa de remuneração"
      ],
      "resposta": "R$ 18.000 PJ",
      "escopo": {
        "tipo": "global"
      },
      "sensivel": true,
      "proveniencia": {
        "origem": "usuario",
        "registrado_em": "2026-10-18T14:30:00.000Z"
      },
      "validade": "2027-04-16"
    },
    {
      "id": "pq-disponibilidade-gupy",
      "variantes_label": [
        "Disponibilidade para início",
        "Quando você pode começar?"
      ],
      "resposta": "Imediata (até 15 dias)",
      "escopo": {
        "tipo": "portal",
        "valor": "gupy"
      },
      "sensivel": false,
      "proveniencia": {
        "origem": "usuario",
        "registrado_em": "2026-10-17T09:00:00.000Z"
      },
      "validade": null
    }
  ],
  "total": 2
}
```

#### Respostas de Erro
- `403 Forbidden`: Token ausente, inválido ou requisição com cabeçalho `Host` não local.

---

## 4. Módulo de Lógica Pura: `panel/menuCorujaLogic.mjs`

Este módulo exporta 4 funções puras determinísticas:

```javascript
// panel/menuCorujaLogic.mjs

/**
 * Normaliza string para busca (minúsculas, sem acentos nem caracteres especiais).
 */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 1. Calcula o recado factual estrito e status da coruja com base na aba ativa e dados em memória.
 * 
 * @param {Object} params
 * @param {'vagas'|'processos'|'curriculo'|'historico'} params.aba - Aba atualmente ativa
 * @param {Array<Object>} [params.vagas=[]] - Lista de vagas da rodada
 * @param {Array<Object>} [params.processos=[]] - Lista de processos seletivos
 * @param {Object} [params.analiseCurriculo=null] - Dados da matriz de currículo e provas
 * @param {Array<Object>} [params.historico=[]] - Lista de candidaturas do histórico
 * @returns {{ texto: string, temNovidade: boolean, contagem: number, aba: string }}
 */
export function calcularRecadoCoruja({
  aba = 'vagas',
  vagas = [],
  processos = [],
  analiseCurriculo = null,
  historico = [],
} = {}) {
  // Aba Vagas: avalia vagas ativas e de alta aderência
  if (aba === 'vagas') {
    const ativas = (vagas || []).filter(v => 
      !v.descarte_usuario?.descartada && 
      !v.candidatura_usuario?.aplicada && 
      v.url_status !== 'encerrada'
    );
    const altas = ativas.filter(v => v.aderencia === 'alta');
    
    if (ativas.length === 0) {
      return {
        texto: 'Nenhuma vaga ativa na rodada atual.',
        temNovidade: false,
        contagem: 0,
        aba: 'vagas',
      };
    }
    
    if (altas.length === 0) {
      return {
        texto: `${ativas.length} vaga${ativas.length > 1 ? 's' : ''} na rodada. Nenhuma de alta aderência pendente.`,
        temNovidade: false,
        contagem: 0,
        aba: 'vagas',
      };
    }
    
    return {
      texto: `${ativas.length} vaga${ativas.length > 1 ? 's' : ''} nova${ativas.length > 1 ? 's' : ''} na rodada, ${altas.length} de alta aderência.`,
      temNovidade: true,
      contagem: altas.length,
      aba: 'vagas',
    };
  }

  // Aba Processos: avalia processos sem retorno há mais de 5 dias
  if (aba === 'processos') {
    const ativos = (processos || []).filter(p => p.situacao !== 'encerrado');
    const parados = ativos.filter(p => {
      const dias = p.dias_inatividade ?? p.dias_sem_contato ?? 0;
      return dias >= 5 || p.alerta === 'atencao' || p.alerta === 'lembrar';
    });

    if (processos.length === 0) {
      return {
        texto: 'Nenhum processo seletivo em andamento.',
        temNovidade: false,
        contagem: 0,
        aba: 'processos',
      };
    }

    if (parados.length === 0) {
      return {
        texto: 'Todos os processos estão com contato recente.',
        temNovidade: false,
        contagem: 0,
        aba: 'processos',
      };
    }

    return {
      texto: `${parados.length} processo${parados.length > 1 ? 's' : ''} sem retorno há mais de 5 dias.`,
      temNovidade: true,
      contagem: parados.length,
      aba: 'processos',
    };
  }

  // Aba Currículo e provas: avalia lacunas e itens sem prova
  if (aba === 'curriculo') {
    const contadores = analiseCurriculo?.contadores || {};
    const grupos = analiseCurriculo?.grupos || {};
    
    const lacunas = contadores.lacuna ?? contadores.lacunas ?? grupos.lacuna?.length ?? grupos.lacunas?.length ?? 0;
    const semProva = contadores.sem_prova ?? grupos.sem_prova?.length ?? 0;

    if (lacunas === 0 && semProva === 0) {
      return {
        texto: 'Currículo 100% comprovado pela base de dados.',
        temNovidade: false,
        contagem: 0,
        aba: 'curriculo',
      };
    }

    return {
      texto: `${lacunas} lacuna${lacunas > 1 ? 's' : ''} e ${semProva} ite${semProva > 1 ? 'ns' : 'm'} sem prova identificados.`,
      temNovidade: true,
      contagem: lacunas + semProva,
      aba: 'curriculo',
    };
  }

  // Aba Histórico: avalia total de candidaturas registradas
  if (aba === 'historico') {
    const total = (historico || []).length;
    if (total === 0) {
      return {
        texto: 'Nenhuma candidatura registrada no histórico.',
        temNovidade: false,
        contagem: 0,
        aba: 'historico',
      };
    }
    return {
      texto: `${total} candidatura${total > 1 ? 's' : ''} registrada${total > 1 ? 's' : ''} no histórico.`,
      temNovidade: false,
      contagem: total,
      aba: 'historico',
    };
  }

  // Fallback seguro para aba desconhecida
  return {
    texto: 'Radar ativo e pronto para novas consultas.',
    temNovidade: false,
    contagem: 0,
    aba,
  };
}

/**
 * 2. Alterna o estado da animação do fundo de pixel art e gera rótulos acessíveis.
 * 
 * @param {Object} params
 * @param {boolean} params.pausadoAtual - Estado booleano atual de pausa
 * @param {string|null} [params.preferenciaStorage=null] - Valor salvo em localStorage ('1' ou '0')
 * @param {boolean} [params.prefersReducedMotion=false] - Respeito à preferência do sistema operacional
 * @returns {{ pausado: boolean, valorStorage: '1'|'0', rotuloBotao: string, rotuloDescricao: string, fundoAtivo: boolean }}
 */
export function alternarEstadoAnimacao({
  pausadoAtual = false,
  preferenciaStorage = null,
  prefersReducedMotion = false,
} = {}) {
  const novoPausado = !pausadoAtual;
  const valorStorage = novoPausado ? '1' : '0';
  const rotuloBotao = novoPausado ? 'Retomar a animação do fundo' : 'Parar a animação do fundo';
  const rotuloDescricao = novoPausado
    ? 'Ativa o céu animado em pixel art'
    : 'Pausa o céu em pixel art se preferir tela estática';
  const fundoAtivo = !novoPausado && !prefersReducedMotion;

  return {
    pausado: novoPausado,
    valorStorage,
    rotuloBotao,
    rotuloDescricao,
    fundoAtivo,
  };
}

/**
 * 3. Filtra e ordena as respostas de formulário do Answer Bank.
 * 
 * @param {Array<Object>} [respostas=[]] - Lista bruta de respostas salvas
 * @param {Object} [filtros={}]
 * @param {string} [filtros.termo=''] - Termo de busca textual
 * @param {string} [filtros.escopo=''] - Tipo de escopo ('global', 'portal', 'empresa')
 * @param {boolean} [filtros.apenasSensiveis=false] - Se deve filtrar apenas itens sensíveis
 * @returns {Array<Object>} Lista filtrada de respostas
 */
export function filtrarRespostasFormulario(
  respostas = [],
  { termo = '', escopo = '', apenasSensiveis = false } = {}
) {
  const t = normalizarTexto(termo);
  const escFiltro = String(escopo ?? '').trim().toLowerCase();

  return (respostas || []).filter(r => {
    if (!r) return false;

    if (apenasSensiveis && !r.sensivel) {
      return false;
    }

    if (escFiltro && r.escopo?.tipo !== escFiltro) {
      return false;
    }

    if (t) {
      const variantes = Array.isArray(r.variantes_label) ? r.variantes_label.join(' ') : '';
      const respostaStr = typeof r.resposta === 'object' ? JSON.stringify(r.resposta) : String(r.resposta ?? '');
      const escopoValor = String(r.escopo?.valor ?? '');
      const id = String(r.id ?? '');

      const buscaCompleta = normalizarTexto(`${id} ${variantes} ${respostaStr} ${escopoValor}`);
      if (!buscaCompleta.includes(t)) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => {
    const labelA = normalizarTexto(a.variantes_label?.[0] || a.id);
    const labelB = normalizarTexto(b.variantes_label?.[0] || b.id);
    return labelA.localeCompare(labelB);
  });
}

/**
 * 4. Agrega e formata a cobertura de fontes e portais da rodada.
 * 
 * @param {Object} params
 * @param {Array<Object>} [params.vagas=[]] - Vagas encontradas na rodada
 * @param {Array<Object>} [params.coverage=[]] - Entradas configuradas do radar
 * @param {string} [params.atualizado=''] - Carimbo de data da última varredura
 * @param {number} [params.fila=0] - Quantidade de itens na fila de leitura
 * @returns {Object} Dados estruturados para exibição no modal
 */
export function formatarCoberturaFontes({
  vagas = [],
  coverage = [],
  atualizado = '',
  fila = 0,
} = {}) {
  const contagemPorPortal = new Map();
  const recenciaPorPortal = new Map();

  for (const v of (vagas || [])) {
    const p = v.portal_candidatura || (v.url ? extrairNomePortal(v.url) : 'outro') || 'outro';
    contagemPorPortal.set(p, (contagemPorPortal.get(p) || 0) + 1);

    const dataVaga = v.consultado_em || v.data_publicacao || atualizado;
    if (dataVaga) {
      const atual = recenciaPorPortal.get(p) || '';
      if (dataVaga > atual) recenciaPorPortal.set(p, dataVaga);
    }
  }

  const portais = Array.from(contagemPorPortal.entries()).map(([portal, total]) => ({
    portal,
    total,
    recencia: recenciaPorPortal.get(portal) || atualizado || 'Hoje',
    status: 'Ativo na rodada',
  })).sort((a, b) => b.total - a.total);

  const fontesConfiguradas = (coverage || []).map(c => ({
    fonte: c.fonte || 'Desconhecida',
    consulta: c.consulta || '—',
    resultados: c.resultados ?? '—',
    status: c.status || c.limite || 'Monitoramento regular',
  }));

  return {
    resumo: {
      atualizado: atualizado || 'Não informado',
      totalVagas: (vagas || []).length,
      filaLeitura: fila || 0,
    },
    portais,
    fontesConfiguradas,
  };
}

function extrairNomePortal(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    if (host.includes('gupy.io')) return 'gupy';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('linkedin.com')) return 'linkedin';
    return host.replace(/^www\./, '');
  } catch {
    return 'outro';
  }
}
```

---

## 5. Especificação do Menu ⋯ e Modais no `panel/template.html`

### 5.1 O Botão e o Popover na Placa Superior

Substituir o elemento `<div class="menu">` atual pelas especificações exatas:

```html
<div class="menu">
  <button type="button" class="btn-ic" id="btn-menu" aria-label="Mais opções" aria-haspopup="menu" aria-expanded="false" title="Mais opções">
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <circle cx="5" cy="12" r="1.75" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.75" fill="currentColor"/>
      <circle cx="19" cy="12" r="1.75" fill="currentColor"/>
    </svg>
  </button>
  
  <div class="menu-suspenso" id="menu-suspenso" role="menu" hidden>
    <button type="button" role="menuitem" id="opt-menu-respostas" class="menu-item">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="2"/>
        <polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="2"/>
        <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="2"/>
        <polyline points="10 9 9 9 8 9" stroke="currentColor" stroke-width="2"/>
      </svg>
      <div>
        <strong class="item-tit">Respostas de formulário</strong>
        <small class="item-desc">Banco de perguntas e respostas reutilizáveis</small>
      </div>
    </button>

    <button type="button" role="menuitem" id="opt-menu-fontes" class="menu-item">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
      <div>
        <strong class="item-tit">Fontes e cobertura</strong>
        <small class="item-desc">Portais da rodada, status e recência</small>
      </div>
    </button>

    <button type="button" role="menuitem" id="opt-menu-linkedin" class="menu-item">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="7" y1="10" x2="7" y2="17" stroke="currentColor" stroke-width="2"/>
        <circle cx="7" cy="7" r="1" fill="currentColor"/>
        <path d="M11 17v-4.5a2.5 2.5 0 0 1 5 0V17M11 10v7" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
      <div>
        <strong class="item-tit">Perfil do LinkedIn</strong>
        <small class="item-desc">Otimização campo a campo sem envio direto</small>
      </div>
    </button>

    <div class="menu-divisor" role="separator"></div>

    <button type="button" role="menuitem" id="opt-menu-fundo" class="menu-item">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" id="ic-menu-fundo">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="10" y1="9" x2="10" y2="15" stroke="currentColor" stroke-width="2"/>
        <line x1="14" y1="9" x2="14" y2="15" stroke="currentColor" stroke-width="2"/>
      </svg>
      <div>
        <strong class="item-tit" id="rotulo-fundo-animacao">Parar a animação do fundo</strong>
        <small class="item-desc" id="desc-fundo-animacao">Pausa o céu em pixel art se preferir tela estática</small>
      </div>
    </button>
  </div>
</div>
```

### 5.2 Estrutura dos Três Modais de Utilidade

Inseridos antes do fechamento de `</body>`:

```html
<!-- Modal 1: Respostas de Formulário -->
<div class="modal-backdrop" id="modal-respostas-formulario" role="dialog" aria-modal="true" aria-labelledby="tit-modal-respostas" hidden>
  <div class="modal-dialogo modal-largo">
    <header class="modal-cabecalho">
      <div>
        <h2 id="tit-modal-respostas" class="modal-titulo">Respostas de formulário</h2>
        <p class="modal-subtitulo">Perguntas dos formulários de candidatura que o banco de respostas já cobre ou ainda não cobre. A candidatura assistida usa o que você salvar aqui.</p>
      </div>
      <button type="button" class="btn-fechar-modal" data-fecha="modal-respostas-formulario" aria-label="Fechar modal">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
      </button>
    </header>

    <div class="modal-corpo">
      <div class="barra-filtros-modal">
        <input type="search" id="busca-respostas-form" class="campo campo-busca" placeholder="Buscar por pergunta, escopo ou resposta..." aria-label="Buscar respostas salvas">
        <div class="filtros-escopo-respostas">
          <button type="button" class="chip-filtro ativo" data-escopo="">Todas</button>
          <button type="button" class="chip-filtro" data-escopo="global">Global</button>
          <button type="button" class="chip-filtro" data-escopo="portal">Por portal</button>
          <button type="button" class="chip-filtro" data-escopo="empresa">Por empresa</button>
        </div>
      </div>

      <div id="lista-respostas-form" class="lista-cards-respostas" role="region" aria-live="polite">
        <!-- Renderizado dinamicamente via JS -->
      </div>
    </div>
  </div>
</div>

<!-- Modal 2: Fontes e Cobertura -->
<div class="modal-backdrop" id="modal-fontes-cobertura" role="dialog" aria-modal="true" aria-labelledby="tit-modal-fontes" hidden>
  <div class="modal-dialogo">
    <header class="modal-cabecalho">
      <div>
        <h2 id="tit-modal-fontes" class="modal-titulo">Fontes e cobertura</h2>
        <p class="modal-subtitulo">De onde vieram as vagas da rodada, status do radar e recência da última varredura.</p>
      </div>
      <button type="button" class="btn-fechar-modal" data-fecha="modal-fontes-cobertura" aria-label="Fechar modal">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
      </button>
    </header>

    <div class="modal-corpo">
      <div class="grade-status-radar" id="status-resumo-radar">
        <!-- Resumo da rodada: Atualizado em, Vagas ativas, Fila -->
      </div>

      <h3 class="secao-subtitulo">Portais das Vagas da Rodada</h3>
      <table class="tabela-cobertura" id="tabela-portais-vagas">
        <thead>
          <tr>
            <th>Portal</th>
            <th>Vagas</th>
            <th>Recência</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody id="corpo-tabela-portais"></tbody>
      </table>

      <h3 class="secao-subtitulo" style="margin-top: 20px;">Fontes Configuradas do Radar</h3>
      <table class="tabela-cobertura" id="tabela-fontes-radar">
        <thead>
          <tr>
            <th>Fonte</th>
            <th>Consulta</th>
            <th>Resultados</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="corpo-tabela-fontes"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- Modal 3: Perfil do LinkedIn -->
<div class="modal-backdrop" id="modal-perfil-linkedin" role="dialog" aria-modal="true" aria-labelledby="tit-modal-linkedin" hidden>
  <div class="modal-dialogo">
    <header class="modal-cabecalho">
      <div>
        <h2 id="tit-modal-linkedin" class="modal-titulo">Perfil do LinkedIn</h2>
        <p class="modal-subtitulo">Ferramenta secundária de apoio para otimização campo a campo.</p>
      </div>
      <button type="button" class="btn-fechar-modal" data-fecha="modal-perfil-linkedin" aria-label="Fechar modal">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>
      </button>
    </header>

    <div class="modal-corpo">
      <div class="alerta alerta-info">
        <svg class="ic-alerta" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2"/></svg>
        <div>
          <strong>O painel não acessa nem altera seu LinkedIn.</strong>
          <p>Nenhuma integração externa ou envio de credenciais é realizado. Utilize as recomendações estruturadas abaixo para atualizar manualmente o seu perfil na plataforma.</p>
        </div>
      </div>

      <div class="bloco-guia-campo">
        <h4>1. Título Profissional</h4>
        <p>Alinhe o título aos cargos de alta aderência encontrados no radar. Dê ênfase a papéis de liderança técnica ou arquitetura comprovados no seu currículo.</p>
      </div>

      <div class="bloco-guia-campo">
        <h4>2. Sobre (Resumo)</h4>
        <p>Estruture sua narrativa em 3 parágrafos concisos: síntese de senioridade, conquistas de negócio quantificadas e especialidades técnicas com base nas afirmações verificadas da sua base de dados.</p>
      </div>

      <div class="bloco-guia-campo">
        <h4>3. Experiência Profissional</h4>
        <p>Adote a fórmula bullet point: <em>[Verbo de ação] + [Projeto/Escopo] + [Resultado quantificado sustentado por evidência]</em>.</p>
      </div>

      <div class="bloco-guia-campo">
        <h4>4. Competências e Palavras-chave</h4>
        <p>Mapeie no topo as competências que mais pontuaram nas vagas analisadas nesta rodada, eliminando termos obsoletos.</p>
      </div>
    </div>
  </div>
</div>
```

---

## 6. Especificação da Coruja Batedora e Balão Factual

### 6.1 Marcação HTML na Placa Superior

```html
<button type="button" class="pet" id="btn-coruja" aria-label="Recado da coruja batedora" aria-expanded="false" title="Recado da coruja batedora">
  <!-- Pixel art 12x12 cunhado em ladrilho com bico laranja -->
  <svg viewBox="0 0 12 12" class="ic-coruja" aria-hidden="true" width="22" height="22">
    <g fill="#2A2140">
      <rect x="2" y="0" width="1" height="1"/><rect x="9" y="0" width="1" height="1"/>
      <rect x="1" y="1" width="1" height="1"/><rect x="3" y="1" width="1" height="1"/>
      <rect x="8" y="1" width="1" height="1"/><rect x="10" y="1" width="1" height="1"/>
      <rect x="1" y="2" width="1" height="1"/><rect x="10" y="2" width="1" height="1"/>
      <rect x="0" y="3" width="1" height="4"/><rect x="11" y="3" width="1" height="4"/>
      <rect x="1" y="7" width="1" height="1"/><rect x="10" y="7" width="1" height="1"/>
      <rect x="2" y="8" width="8" height="1"/>
    </g>
    <g fill="#7C6BC4">
      <rect x="2" y="1" width="1" height="1"/><rect x="9" y="1" width="1" height="1"/>
      <rect x="2" y="2" width="8" height="1"/><rect x="1" y="3" width="1" height="4"/>
      <rect x="10" y="3" width="1" height="4"/><rect x="5" y="3" width="2" height="2"/>
      <rect x="2" y="6" width="3" height="1"/><rect x="7" y="6" width="3" height="1"/>
      <rect x="2" y="7" width="8" height="1"/>
    </g>
    <g fill="#FFFFFF">
      <rect x="2" y="3" width="3" height="3"/><rect x="7" y="3" width="3" height="3"/>
    </g>
    <g fill="#1B1530">
      <rect x="3" y="4" width="1" height="1"/><rect x="8" y="4" width="1" height="1"/>
    </g>
    <g fill="#E07000">
      <rect x="5" y="5" width="2" height="2"/>
    </g>
  </svg>

  <!-- Indicador visual de novidade (losango dourado) -->
  <span class="losango-recado" id="losango-coruja" aria-hidden="true" hidden></span>

  <!-- Balão de recado factual da coruja -->
  <span class="balao" id="balao-coruja" role="status" aria-live="polite" hidden></span>
</button>
```

### 6.2 Comportamento Temporal e Interativo do Balão
1. **Temporizador de 6 Segundos:**
   - Ao carregar a página inicial e ao disparar a função `alternarAba(nomeAba)`, chama-se `exibirRecadoCoruja(nomeAba)`.
   - O balão `#balao-coruja` tem seu texto atualizado com o retorno de `calcularRecadoCoruja(...)`, remove o atributo `hidden`, seta `aria-expanded="true"` no botão `#btn-coruja`.
   - Um `setTimeout` de 6000 ms esconde automaticamente o balão (`hidden = true`, `aria-expanded = "false"`).
2. **Reabertura por Clique:**
   - Clicar no botão `#btn-coruja` reabre o balão com o recado correspondente à aba ativa no momento.
   - O clique também oculta o indicador `.losango-recado`, sinalizando que a novidade foi visualizada pelo usuário.
3. **Persistência de Fundo em `localStorage`:**
   - Chave: `cb-animacao-pausada`.
   - Valores suportados: `'1'` (pausada) e `'0'` (ativa).
   - Ao iniciar a página, o estado é carregado com `localStorage.getItem('cb-animacao-pausada') === '1'`.

---

## 7. Estilização CSS, Tokens, Acessibilidade e Responsividade

```css
/* Placa - Menu suspenso */
.menu { position: relative; }
.menu-suspenso {
  position: absolute; right: 0; top: 42px; min-width: 280px; padding: 6px;
  background: var(--sup); color: var(--tx); border: 1px solid var(--borda);
  border-radius: var(--r-lg); box-shadow: 0 12px 32px rgba(5,15,30,.25); z-index: 100;
}
.menu-suspenso .menu-item {
  display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left;
  padding: 9px 10px; border: 0; background: none; border-radius: var(--r);
  cursor: pointer; color: var(--tx); font-family: inherit; font-size: var(--t-sm);
  transition: background var(--dur) var(--saida);
}
.menu-suspenso .menu-item:hover,
.menu-suspenso .menu-item:focus-visible {
  background: var(--sup3);
  outline: 2px solid var(--foco);
  outline-offset: -2px;
}
.menu-suspenso .menu-item svg {
  flex-shrink: 0; width: 18px; height: 18px; margin-top: 2px; color: var(--tx2);
}
.menu-suspenso .menu-item .item-tit { display: block; font-weight: 600; color: var(--tx); }
.menu-suspenso .menu-item .item-desc { display: block; color: var(--tx3); font-size: var(--t-xs); margin-top: 2px; }
.menu-divisor { height: 1px; background: var(--borda); margin: 6px 0; }

/* Coruja Mascote e Losango Dourado */
.pet {
  position: relative; width: 34px; height: 34px; padding: 0;
  display: inline-grid; place-items: center;
  border: 1px solid var(--placa-linha); border-radius: var(--r);
  background: transparent; color: var(--placa-tx2); cursor: pointer;
  transition: background var(--dur) var(--saida), border-color var(--dur) var(--saida);
}
.pet:hover { color: var(--placa-tx); background: var(--placa-2); border-color: var(--placa-tx); }
.pet:focus-visible { outline: 2px solid var(--foco); outline-offset: 2px; }
.pet .ic-coruja { width: 22px; height: 22px; }

/* Losango dourado de novidade */
.pet .losango-recado {
  position: absolute; top: 2px; right: 2px; width: 8px; height: 8px;
  background: var(--ouro);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  box-shadow: 0 0 6px rgba(217, 164, 65, 0.6);
}

/* Balão da Coruja */
.pet .balao {
  position: absolute; right: 0; top: 48px; width: 280px; padding: 10px 12px;
  background: var(--sup); color: var(--tx); border: 1px solid var(--borda);
  border-radius: var(--r); box-shadow: 0 10px 25px rgba(0,0,0,.2);
  font-size: var(--t-xs); line-height: 1.4; text-align: left; white-space: normal; z-index: 100;
}
.pet .balao::after {
  content: ""; position: absolute; right: 14px; top: -8px;
  width: 10px; height: 8px; clip-path: polygon(50% 0, 100% 100%, 0 100%);
  background: var(--sup); border-bottom: 1px solid var(--borda);
}

/* Modais e Caixas de Diálogo */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(10, 17, 28, 0.7);
  backdrop-filter: blur(2px); display: grid; place-items: center;
  z-index: 200; padding: 16px;
}
.modal-dialogo {
  background: var(--sup); border: 1px solid var(--borda);
  border-radius: var(--r-lg); width: 100%; max-width: 680px; max-height: 85vh;
  box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;
  overflow: hidden;
}
.modal-dialogo.modal-largo { max-width: 840px; }
.modal-cabecalho {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 18px 22px; border-bottom: 1px solid var(--borda);
  background: var(--sup2);
}
.modal-titulo { font-size: var(--t-lg); font-weight: 700; color: var(--tx); margin: 0; }
.modal-subtitulo { font-size: var(--t-sm); color: var(--tx2); margin: 4px 0 0; }
.btn-fechar-modal {
  width: 32px; height: 32px; display: inline-grid; place-items: center;
  border: 1px solid var(--borda); border-radius: var(--r);
  background: var(--sup); color: var(--tx2); cursor: pointer;
}
.btn-fechar-modal:hover { background: var(--sup3); color: var(--tx); }
.modal-corpo { padding: 20px 22px; overflow-y: auto; flex: 1; }

/* Responsividade Mobile (375px e <= 600px) */
@media (max-width: 600px) {
  .placa .pet,
  #btn-coruja,
  #balao-coruja {
    display: none !important;
  }
  .modal-dialogo {
    max-height: 95vh;
  }
}
```

---

## 8. Roteiro Passo a Passo de Implementação via TDD

O engenheiro de software frontend deve executar rigorosamente este ciclo Red-Green-Refactor:

### Passo 1: Testes de Lógica Pura (RED)
- Criar o arquivo `tests/unit/panel-menu-coruja-logic.test.mjs`.
- Escrever os casos de teste para:
  1. `calcularRecadoCoruja`:
     - Cenários da aba Vagas: com altas pendentes, sem altas, lista vazia.
     - Cenários da aba Processos: com inatividade >= 5 dias, processos todos recentes, sem processos.
     - Cenários da aba Currículo: com lacunas e sem prova, currículo 100% comprovado.
     - Cenários da aba Histórico: contagem de candidaturas registradas, histórico vazio.
     - Fallback para abas não previstas.
  2. `alternarEstadoAnimacao`:
     - Transição de ligado para pausado (`valorStorage: '1'`, rótulo `'Retomar a animação do fundo'`).
     - Transição de pausado para ligado (`valorStorage: '0'`, rótulo `'Parar a animação do fundo'`).
     - Respeito mandatório a `prefersReducedMotion: true` (fundo desativado).
  3. `filtrarRespostasFormulario`:
     - Filtragem textual por pergunta/rótulo insensível a maiúsculas e acentos.
     - Filtragem por escopo (`global`, `portal`, `empresa`).
     - Filtragem por sensibilidade (`apenasSensiveis: true`).
     - Ordenação determinística.
  4. `formatarCoberturaFontes`:
     - Agrupamento de portais a partir das vagas.
     - Mapeamento com fontes de radar de `coverage`.
     - Resumo de rodada e recência.
- Executar `npm test tests/unit/panel-menu-coruja-logic.test.mjs` e garantir que falha (RED).

### Passo 2: Implementação da Lógica Pura (GREEN)
- Criar `panel/menuCorujaLogic.mjs` implementando exatamente as 4 funções puras especificadas na Seção 4.
- Rodar o teste e validar que passa 100% (GREEN).

### Passo 3: Testes Estruturais e de Acessibilidade do Template (RED)
- Criar o arquivo `tests/unit/panel-menu-coruja-template.test.mjs`.
- Cobrir as regras:
  - Botão `#btn-menu` com `aria-haspopup="menu"`, `aria-expanded="false"`.
  - `#menu-suspenso` com os 4 itens esperados (`#opt-menu-respostas`, `#opt-menu-fontes`, `#opt-menu-linkedin`, `#opt-menu-fundo`).
  - Rótulos dos itens no menu.
  - Modais `#modal-respostas-formulario`, `#modal-fontes-cobertura`, `#modal-perfil-linkedin` com `role="dialog"` e `aria-modal="true"`.
  - Botão da coruja `#btn-coruja`, SVG com bico laranja `#E07000`, losango `.losango-recado` e balão `#balao-coruja`.
  - Media query `@media (max-width: 600px)` ocultando `.pet` / `#btn-coruja`.
  - Ausência total de tags `<img>` em `panel/template.html`.
  - Uso da chave `cb-animacao-pausada` no script do template.
- Rodar `npm test tests/unit/panel-menu-coruja-template.test.mjs` e constatar as falhas (RED).

### Passo 4: Atualização do `panel/template.html` (GREEN)
- Inserir a nova marcação do `#btn-menu` e `#menu-suspenso`.
- Inserir os 3 modais (`#modal-respostas-formulario`, `#modal-fontes-cobertura`, `#modal-perfil-linkedin`).
- Inserir a marcação e SVG da coruja com `#losango-coruja` e `#balao-coruja`.
- Adicionar o CSS de popover, losango, balão e modais.
- Adicionar a lógica client-side correspondente:
  - Temporizador de 6s integrado à função `alternarAba`.
  - Funções de abertura/fechamento do menu e dos modais (com suporte à tecla `Escape`).
  - Toggle de animação com `localStorage.getItem('cb-animacao-pausada')`.
  - Carregamento assíncrono de respostas de formulário via `GET /api/respostas` ou `GET /api/perguntas`.
- Rodar `npm test tests/unit/panel-menu-coruja-template.test.mjs` e garantir que passa (GREEN).

### Passo 5: Suporte no Servidor (`panel/server.mjs`)
- Adicionar o endpoint `GET /api/respostas` em `panel/server.mjs` consumindo `lerRespostas(dataRoot)` com autenticação `X-Painel-Token`.
- Executar a suíte de testes de servidor e API (`npm test tests/unit/panel-server-f10.test.mjs` ou similar).

### Passo 6: Validação Geral
- Executar `npm test -- --test-concurrency=4` garantindo 0 falhas e 0 skips.
- Executar verificação de privacidade e regras do repositório.

---

## 9. Matriz de Rastreabilidade de Requisitos

| Requisito do Produto | Componente / Elemento | Teste Automatizado |
|---|---|---|
| Botão ⋯ com `aria-haspopup` e `aria-expanded` | `#btn-menu` na `.placa` | `panel-menu-coruja-template.test.mjs` |
| Menu suspenso com 4 itens no DS Misto | `#menu-suspenso`, `#opt-menu-*` | `panel-menu-coruja-template.test.mjs` |
| Modal de Respostas de Formulário com busca | `#modal-respostas-formulario`, `#busca-respostas-form` | `panel-menu-coruja-template.test.mjs` |
| Modal de Fontes e Cobertura | `#modal-fontes-cobertura`, `#status-resumo-radar` | `panel-menu-coruja-template.test.mjs` |
| Modal de Perfil do LinkedIn sem envio direto | `#modal-perfil-linkedin`, `.alerta-info` | `panel-menu-coruja-template.test.mjs` |
| Toggle de pausa da animação com localStorage | Chave `cb-animacao-pausada`, `#opt-menu-fundo` | `panel-menu-coruja-logic.test.mjs` |
| Coruja 12×12 cunhada em ladrilho com bico laranja | `#btn-coruja`, SVG `viewBox="0 0 12 12"`, fill `#E07000` | `panel-menu-coruja-template.test.mjs` |
| Losango dourado de novidade factual | `.losango-recado`, `#losango-coruja` | `panel-menu-coruja-template.test.mjs` |
| Balão factual de 6 segundos ao trocar aba | `#balao-coruja`, `exibirRecadoCoruja()` | `panel-menu-coruja-template.test.mjs` |
| Recados factuais calculados estritamente dos dados | `calcularRecadoCoruja(...)` | `panel-menu-coruja-logic.test.mjs` |
| Coruja oculta em telas estreitas (<= 600px / 375px) | CSS `@media (max-width: 600px)` | `panel-menu-coruja-template.test.mjs` |
| Zero tags `<img>` em todo o painel | SVG inline para todos os gráficos | `panel-menu-coruja-template.test.mjs` |
