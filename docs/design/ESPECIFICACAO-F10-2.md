# Arquitetura e Especificação Técnica: Fatia F10.2 — Aba Histórico

> **Status:** Especificação técnica aprovada para implementação imediata via TDD.  
> **Dependência:** Fatia F9.3 (Projeção e API de Histórico: `core/store/projections/historico.mjs` e `GET /api/historico`).  
> **Visual escolhido:** Mundo **Misto**, Organização **A (Plataforma)** com linha do tempo inspirada no Metrô de São Paulo.  
> **Referência de Design:** [PAINEL.md](file:///c:/Projetos/career-bounty/docs/design/PAINEL.md), `PLANO-F10-interface-2026-10-18.md` e [PAINEL-API.md](file:///c:/Projetos/career-bounty/docs/PAINEL-API.md).

---

## 1. Visão Geral da Fatia F10.2

A fatia **F10.2** implementa a aba **Histórico** no painel do CareerBounty, substituindo a antiga aba Fila na interface do usuário (a rota legada `/api/fila` e o módulo `core/apply/plan.mjs` permanecem preservados e intocados para uso dos fluxos automatizados da CLI e da skill `aplicar`).

### 1.1 Objetivos Centrais
1. **Linha do Tempo Cronológica Unificada por Vaga:** Apresentar a trajetória completa de cada vaga no funil (descoberta no radar, registro de candidatura, avanço de etapas de processo, interações/mensagens com recrutadores, descartes e desfecho final).
2. **Design Misto e Metrô:** Estações circulares conectadas por um traço vertical contínuo, com marcadores coloridos por tipo de evento e plaquetas/pills de identificação de origem (`radar`, `painel`, `email`, `cli`, `recrutador`, `candidato`).
3. **Filtros Reativos e Precisos:** Período (`inicio` e `fim`), Situação (`todas`, `ativo`, `aguardando_retorno`, `aguardando_voce`, `encerrado`), Portal (dinâmico baseado nas vagas encontradas) e busca textual por termos (empresa, cargo, detalhes).
4. **Desacoplamento e Testabilidade Rígida (TDD):** Funções puras de formatação, filtragem, extração de metadados e ícones isoladas em `panel/historicoLogic.mjs`, com suíte dedicada em `tests/unit/panel-historico-logic.test.mjs`.
5. **Zero Degradação e Conformidade de Privacidade:** 100% offline, zero dependências npm, zero tags `<img>` (SVGs vetoriais puros embutidos inline), mascaramento de PII mantido na API e responsividade estrita em 375 px sem rolagem horizontal.

---

## 2. Contrato de Dados da API (`GET /api/historico`)

A interface consumirá o endpoint já implementado na F9.3 em `panel/server.mjs`:

### 2.1 Requisição
- **Método:** `GET`
- **Caminho:** `/api/historico`
- **Cabeçalho:** `X-Painel-Token: <token>`
- **Query Parameters (opcionais):**
  - `inicio=AAAA-MM-DD`
  - `fim=AAAA-MM-DD`
  - `situacao=ativo|aguardando_retorno|aguardando_voce|encerrado`
  - `portal=<portal>`

### 2.2 Estrutura do Payload de Resposta (`200 OK`)
```json
{
  "historico": [
    {
      "vaga_id": "vaga-corp-tech-01",
      "empresa": "Empresa Alfa",
      "cargo": "Arquiteto de Software",
      "portal": "gupy",
      "situacao_processo": "aguardando_retorno",
      "desfecho": null,
      "ultimo_movimento": "2026-10-18",
      "linha_do_tempo": [
        {
          "id": "e-desc-01",
          "tipo": "descoberta",
          "origem": "radar",
          "data": "2026-10-10",
          "ts": "2026-10-10T09:30:00.000Z",
          "titulo": "Vaga descoberta: Arquiteto de Software",
          "detalhe": "https://corptech.test/vagas/01"
        },
        {
          "id": "e-cand-01",
          "tipo": "candidatura",
          "origem": "painel",
          "data": "2026-10-12",
          "ts": "2026-10-12T14:00:00.000Z",
          "titulo": "Candidatura registrada",
          "detalhe": "Candidatura enviada/marcada"
        },
        {
          "id": "e-etapa-01",
          "tipo": "etapa",
          "origem": "cli",
          "etapa": "entrevista_rh",
          "data": "2026-10-15",
          "ts": "2026-10-15T11:00:00.000Z",
          "titulo": "Etapa: entrevista_rh",
          "detalhe": "Alinhamento cultural inicial realizado"
        },
        {
          "id": "c-contato-01",
          "tipo": "contato",
          "origem": "recrutador",
          "canal": "email",
          "direcao": "recebido",
          "data": "2026-10-18",
          "ts": "2026-10-18T16:20:00.000Z",
          "titulo": "Contato com Camila Silva",
          "resumo": "Envio do desafio prático. Contato via c***@corptech.test",
          "detalhe": "Envio do desafio prático. Contato via c***@corptech.test",
          "pergunta": "Você tem disponibilidade para entrevista técnica nesta quinta?",
          "proxima_etapa": {
            "texto": "Entrevista com líder técnico",
            "data": "2026-10-22"
          },
          "pessoa": {
            "nome": "Camila Silva",
            "papel": "Tech Recruiter"
          },
          "endereco": "c***@corptech.test"
        }
      ]
    }
  ],
  "totais": {
    "total": 1,
    "ativos": 0,
    "aguardando_retorno": 1,
    "aguardando_voce": 0,
    "encerrados": 0
  },
  "total": 1
}
```

---

## 3. Módulo Lógico Puro: `panel/historicoLogic.mjs`

Este módulo conterá toda a lógica determinística de apresentação, ordenação, filtragem e categorização de eventos, sem acoplamento com o DOM ou requisições HTTP.

```javascript
// panel/historicoLogic.mjs
// Lógica pura de formatação, filtragem e ícones para a aba Histórico (F10.2).

export const TIPOS_EVENTO = ['descoberta', 'candidatura', 'etapa', 'contato', 'desfecho', 'descarte'];

export const ROTULOS_TIPO = {
  descoberta: 'Descoberta',
  candidatura: 'Candidatura',
  etapa: 'Etapa',
  contato: 'Contato',
  desfecho: 'Desfecho',
  descarte: 'Descarte',
};

export const ROTULOS_ORIGEM = {
  radar: 'Radar',
  painel: 'Painel',
  email: 'E-mail',
  cli: 'CLI',
  recrutador: 'Recrutador',
  candidato: 'Você',
};

export const ROTULOS_SITUACAO = {
  ativo: 'Ativo',
  aguardando_retorno: 'Aguardando retorno',
  aguardando_voce: 'Aguardando você',
  encerrado: 'Encerrado',
};

export const CORES_TIPO = {
  descoberta: 'var(--l-condicional)', // azul-claro
  candidatura: 'var(--ouro)',          // ouro/âmbar
  etapa: 'var(--l-boa)',              // roxo/índigo
  contato: '#008F85',                 // ciano/teal
  aprovado: 'var(--ok)',              // verde
  encerrado: 'var(--tx3)',            // cinza neutro
  descarte: 'var(--perigo)',          // vermelho suave
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Formata data no padrão brasileiro DD/MM/AAAA.
 */
export function formatarDataPtBr(dataStr) {
  if (!dataStr || typeof dataStr !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataStr);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return dataStr;
}

/**
 * Determina o identificador de cor/classe do evento.
 */
export function obterClasseCorEvento(tipo, desfecho = null) {
  if (tipo === 'desfecho') {
    return desfecho === 'aprovado' ? 'desfecho-aprovado' : 'desfecho-encerrado';
  }
  return tipo;
}

/**
 * Retorna o SVG embutido limpo para cada tipo de evento (zero <img>).
 */
export function obterIconeSvg(tipo, { desfecho = null } = {}) {
  switch (tipo) {
    case 'descoberta':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    case 'candidatura':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    case 'etapa':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/></svg>';
    case 'contato':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    case 'desfecho':
      if (desfecho === 'aprovado') {
        return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M12 2v2M12 14v8M8 22h8"/></svg>';
      }
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>';
    case 'descarte':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/></svg>';
    default:
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
  }
}

/**
 * Filtra puramente o histórico em memória.
 */
export function filtrarHistorico(historico = [], filtros = {}) {
  const b = norm(filtros.busca);
  const portalNorm = filtros.portal ? norm(filtros.portal) : null;

  return historico.filter(v => {
    if (filtros.inicio && v.ultimo_movimento < filtros.inicio) return false;
    if (filtros.fim && v.ultimo_movimento > filtros.fim) return false;
    if (filtros.situacao && v.situacao_processo !== filtros.situacao) return false;
    if (portalNorm && norm(v.portal) !== portalNorm) return false;

    if (b) {
      const textoVaga = norm([
        v.empresa,
        v.cargo,
        v.portal,
        v.situacao_processo,
        v.desfecho,
        ...(v.linha_do_tempo || []).flatMap(it => [it.titulo, it.detalhe, it.resumo, it.motivo, it.origem]),
      ].join(' '));
      if (!textoVaga.includes(b)) return false;
    }
    return true;
  }).sort((a, b) => (b.ultimo_movimento || '').localeCompare(a.ultimo_movimento || '') || (b.vaga_id || '').localeCompare(a.vaga_id || ''));
}

/**
 * Extrai lista única e ordenada de portais presentes no histórico.
 */
export function extrairPortaisHistorico(historico = []) {
  const portais = new Set();
  for (const v of historico) {
    if (v.portal && typeof v.portal === 'string' && v.portal.trim()) {
      portais.add(v.portal.trim().toLowerCase());
    }
  }
  return [...portais].sort();
}

/**
 * Recalcula totais agregados a partir de uma lista filtrada.
 */
export function calcularTotaisHistorico(historico = []) {
  return {
    total: historico.length,
    ativos: historico.filter(v => v.situacao_processo === 'ativo').length,
    aguardando_retorno: historico.filter(v => v.situacao_processo === 'aguardando_retorno').length,
    aguardando_voce: historico.filter(v => v.situacao_processo === 'aguardando_voce').length,
    encerrados: historico.filter(v => v.situacao_processo === 'encerrado').length,
  };
}
```

---

## 4. Estrutura HTML/CSS no `panel/template.html`

### 4.1 Estilos CSS Adicionados ao Bloco `<style>`

```css
/* ==========================================================================
   Aba Histórico & Linha do Tempo (Design Misto / Metrô)
   ========================================================================== */

.ferramentas-hist {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 8px;
  align-items: center;
  padding: 14px 20px;
}

.grupo-filtro-data {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--t-xs);
  color: var(--tx2);
  font-weight: 500;
}

.campo-data {
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--borda);
  border-radius: var(--r);
  background: var(--sup);
  color: var(--tx);
  font-size: var(--t-xs);
}

.busca-hist {
  flex: 1 1 240px;
  min-width: 200px;
}

.hist-conteudo {
  flex: 1;
  min-height: 0;
  padding: 0 20px 40px;
  max-width: 1080px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Card da Vaga no Histórico */
.hist-card {
  background: var(--sup);
  border: 1px solid var(--borda);
  border-radius: var(--r-lg);
  padding: 20px 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: border-color var(--dur) var(--saida);
}
.hist-card:hover {
  border-color: var(--borda2);
}

.hist-card-topo {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--borda);
  margin-bottom: 16px;
}

.hist-card-titulo {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hist-card-empresa {
  font-size: var(--t-sm);
  color: var(--tx2);
  font-weight: 500;
}
.hist-card-cargo {
  margin: 0;
  font-size: var(--t-xl);
  font-weight: 700;
  color: var(--tx);
  letter-spacing: -.01em;
}

.hist-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hist-badge-sit {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: var(--t-xs);
  font-weight: 600;
}
.hist-badge-sit[data-sit="ativo"] { background: var(--sup3); color: var(--tx); border: 1px solid var(--borda); }
.hist-badge-sit[data-sit="aguardando_retorno"] { background: var(--atencao-fundo); color: var(--atencao); }
.hist-badge-sit[data-sit="aguardando_voce"] { background: var(--perigo-fundo); color: var(--perigo); }
.hist-badge-sit[data-sit="encerrado"] { background: var(--sup3); color: var(--tx3); }

.hist-ultimo-mov {
  font-size: var(--t-xs);
  color: var(--tx3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Linha do Tempo (Metrô) */
.hist-timeline {
  position: relative;
  margin-left: 14px;
  padding: 6px 0 6px 26px;
}
.hist-timeline::before {
  content: "";
  position: absolute;
  left: 7px;
  top: 14px;
  bottom: 14px;
  width: 2px;
  background: var(--borda);
}

.hist-evento {
  position: relative;
  margin-bottom: 18px;
}
.hist-evento:last-child {
  margin-bottom: 0;
}

/* Marcador da estação */
.hist-marcador {
  position: absolute;
  left: -26px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--sup);
  border: 3px solid var(--tx3);
  z-index: 2;
  transition: transform var(--dur) var(--saida);
}
.hist-evento:hover .hist-marcador {
  transform: scale(1.15);
}

/* Cores dos Marcadores por Tipo */
.hist-evento[data-tipo="descoberta"] .hist-marcador { border-color: var(--l-condicional); }
.hist-evento[data-tipo="candidatura"] .hist-marcador { border-color: var(--ouro); background: var(--ouro); }
.hist-evento[data-tipo="etapa"] .hist-marcador { border-color: var(--l-boa); }
.hist-evento[data-tipo="contato"] .hist-marcador { border-color: #008F85; }
.hist-evento[data-cor="desfecho-aprovado"] .hist-marcador { border-color: var(--ok); background: var(--ok); }
.hist-evento[data-cor="desfecho-encerrado"] .hist-marcador { border-color: var(--tx3); }
.hist-evento[data-tipo="descarte"] .hist-marcador { border-color: var(--perigo); }

.hist-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hist-pill-origem {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--r-sm);
  background: var(--sup3);
  color: var(--tx2);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .02em;
}

.hist-item-data {
  font-size: var(--t-xs);
  color: var(--tx3);
  font-variant-numeric: tabular-nums;
}

.hist-item-titulo {
  font-size: var(--t-sm);
  font-weight: 600;
  color: var(--tx);
  margin-top: 3px;
}

.hist-item-detalhe {
  font-size: var(--t-xs);
  color: var(--tx2);
  margin-top: 2px;
  max-width: 70ch;
  text-wrap: pretty;
}

.hist-box-destaque {
  margin-top: 6px;
  padding: 8px 12px;
  background: var(--sup2);
  border-left: 3px solid var(--ouro);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  font-size: var(--t-xs);
  color: var(--tx);
}
.hist-box-destaque strong {
  display: block;
  color: var(--tx);
  margin-bottom: 2px;
}

/* Responsividade Mobile (375px) */
@media (max-width: 900px) {
  .ferramentas-hist {
    padding: 12px;
  }
  .grupo-filtro-data {
    flex: 1 1 45%;
  }
  .grupo-filtro-data input {
    width: 100%;
  }
  .ferramentas-hist select {
    flex: 1 1 45%;
  }
  .busca-hist {
    flex: 1 1 100%;
  }
  .hist-conteudo {
    padding: 0 12px 60px;
  }
  .hist-card {
    padding: 16px;
  }
  .hist-card-topo {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .hist-card-meta {
    width: 100%;
    justify-content: space-between;
  }
}
```

### 4.2 Marcação HTML do Container `#painel-historico`

Inserido logo após `</main>` do `#painel-vagas`:

```html
  <!-- Painel Histórico (F10.2) -->
  <main class="A-tela" id="painel-historico" hidden>
    <div class="ferramentas ferramentas-hist" role="region" aria-label="Filtros do histórico">
      <div class="grupo-filtro-data">
        <label for="filtro-hist-inicio">De</label>
        <input type="date" id="filtro-hist-inicio" class="campo-data" aria-label="Data inicial do histórico">
      </div>
      <div class="grupo-filtro-data">
        <label for="filtro-hist-fim">Até</label>
        <input type="date" id="filtro-hist-fim" class="campo-data" aria-label="Data final do histórico">
      </div>

      <select id="filtro-hist-situacao" class="campo" aria-label="Filtrar por situação do processo">
        <option value="">Toda situação</option>
        <option value="ativo">Ativo</option>
        <option value="aguardando_retorno">Aguardando retorno</option>
        <option value="aguardando_voce">Aguardando você</option>
        <option value="encerrado">Encerrado</option>
      </select>

      <select id="filtro-hist-portal" class="campo" aria-label="Filtrar por portal de candidatura">
        <option value="">Todo portal</option>
      </select>

      <label class="busca busca-hist">
        <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span class="sr">Pesquisar histórico</span>
        <input class="campo" id="filtro-hist-busca" aria-label="Pesquisar histórico" placeholder="Empresa, cargo, etapa, contato...">
      </label>

      <button type="button" class="btn discreto peq" id="btn-limpar-filtros-hist">Limpar filtros</button>
      <span class="total" id="total-historico" role="status">0 oportunidades</span>
    </div>

    <div class="hist-conteudo" id="hist-conteudo" role="feed" aria-label="Linha do tempo das vagas e processos">
      <div class="vazio" id="hist-estado">
        <strong>Carregando histórico...</strong>
        Consolidando eventos cronológicos.
      </div>
    </div>
  </main>
```

---

## 5. Integração com a API e Alternância de Abas

### 5.1 Alternância entre Abas na Placa Superior
No script de `panel/template.html`:
```javascript
// Gerenciamento de abas da Placa
const botoesAba = document.querySelectorAll('.nav .aba-btn');
const telas = {
  vagas: document.getElementById('painel-vagas'),
  historico: document.getElementById('painel-historico'),
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

  if (nomeAba === 'historico') {
    carregarHistorico();
  }
}

botoesAba.forEach(btn => {
  btn.addEventListener('click', () => {
    const nome = btn.dataset.aba;
    if (telas[nome]) alternarAba(nome);
  });
});
```

### 5.2 Função `carregarHistorico()`
```javascript
let cacheHistoricoBruto = [];
let portaisHistoricoCarregados = false;

const filtrosHistorico = {
  inicio: '',
  fim: '',
  situacao: '',
  portal: '',
  busca: '',
};

async function carregarHistorico() {
  const container = document.getElementById('hist-conteudo');
  const contador = document.getElementById('total-historico');

  // Montar parâmetros de consulta
  const params = new URLSearchParams();
  if (filtrosHistorico.inicio) params.set('inicio', filtrosHistorico.inicio);
  if (filtrosHistorico.fim) params.set('fim', filtrosHistorico.fim);
  if (filtrosHistorico.situacao) params.set('situacao', filtrosHistorico.situacao);
  if (filtrosHistorico.portal) params.set('portal', filtrosHistorico.portal);

  const queryStr = params.toString() ? `?${params.toString()}` : '';

  if (api && api.token) {
    container.innerHTML = '<div class="vazio"><strong>Carregando histórico...</strong>Consultando linha do tempo das oportunidades.</div>';
    try {
      const res = await fetch(`/api/historico${queryStr}`, {
        headers: { 'X-Painel-Token': api.token },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Falha ao obter dados.');
      const data = await res.json();
      cacheHistoricoBruto = data.historico || [];
      document.getElementById('badge-historico').textContent = data.totais?.total ?? cacheHistoricoBruto.length;
    } catch {
      container.innerHTML = '<div class="vazio"><strong>Não foi possível carregar o histórico.</strong>Painel local indisponível ou conexão interrompida.</div>';
      return;
    }
  } else {
    // Modo estático offline / fallback usando DATA.historico se disponível
    cacheHistoricoBruto = (DATA.historico || []).map(v => ({
      vaga_id: v.id || v.vaga_id, empresa: v.empresa, cargo: v.cargo,
      portal: v.portal_candidatura || v.portal,
      situacao_processo: v.status === 'candidatada' ? 'aguardando_retorno' : 'ativo',
      desfecho: null,
      ultimo_movimento: v.consultado_em || new Date().toISOString().slice(0, 10),
      linha_do_tempo: [
        {
          id: `desc-${v.id}`,
          tipo: 'descoberta',
          origem: 'radar',
          data: v.consultado_em || 'hoje',
          titulo: `Vaga descoberta: ${v.cargo}`,
          detalhe: v.url || null,
        }
      ],
    }));
  }

  // Preencher combo de portais dinamicamente na primeira carga
  if (!portaisHistoricoCarregados) {
    const portais = extrairPortaisHistorico(cacheHistoricoBruto);
    const selectPortalHist = document.getElementById('filtro-hist-portal');
    portais.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = PORTAL_NOMES[p] || p.toUpperCase();
      selectPortalHist.appendChild(opt);
    });
    portaisHistoricoCarregados = true;
  }

  renderizarHistorico();
}

function renderizarHistorico() {
  const container = document.getElementById('hist-conteudo');
  const contador = document.getElementById('total-historico');

  // Aplicar busca textual em memória sobre os itens trazidos
  const filtrados = filtrarHistorico(cacheHistoricoBruto, { busca: filtrosHistorico.busca });
  contador.textContent = `${filtrados.length} oportunidades`;

  if (!filtrados.length) {
    container.innerHTML = '<div class="vazio"><strong>Nenhum registro encontrado.</strong>Ajuste os filtros ou selecione "Limpar filtros".</div>';
    return;
  }

  container.innerHTML = filtrados.map(v => {
    const situacaoLabel = ROTULOS_SITUACAO[v.situacao_processo] || v.situacao_processo;
    const portalLabel = PORTAL_NOMES[v.portal] || v.portal || 'Direto';
    const ultimoMovFmt = formatarDataPtBr(v.ultimo_movimento);

    const eventosHtml = (v.linha_do_tempo || []).map(ev => {
      const corClasse = obterClasseCorEvento(ev.tipo, ev.desfecho);
      const origemLabel = ROTULOS_ORIGEM[ev.origem] || ev.origem || 'Origem';
      const dataFmt = formatarDataPtBr(ev.data);

      let boxExtra = '';
      if (ev.pergunta) {
        boxExtra += `<div class="hist-box-destaque"><strong>Pergunta do recrutador:</strong>${esc(ev.pergunta)}</div>`;
      }
      if (ev.proxima_etapa) {
        const textoProx = typeof ev.proxima_etapa === 'object' ? `${ev.proxima_etapa.texto || ''} (${formatarDataPtBr(ev.proxima_etapa.data)})` : ev.proxima_etapa;
        boxExtra += `<div class="hist-box-destaque"><strong>Próxima etapa:</strong>${esc(textoProx)}</div>`;
      }

      return `<div class="hist-evento" data-tipo="${esc(ev.tipo)}" data-cor="${esc(corClasse)}">
        <span class="hist-marcador" aria-hidden="true"></span>
        <div class="hist-item-header">
          <span class="hist-pill-origem">${esc(origemLabel)}</span>
          <span class="hist-item-data">${esc(dataFmt)}</span>
        </div>
        <div class="hist-item-titulo">${esc(ev.titulo)}</div>
        ${ev.detalhe ? `<div class="hist-item-detalhe">${esc(ev.detalhe)}</div>` : ''}
        ${boxExtra}
      </div>`;
    }).join('');

    return `<article class="hist-card" data-vaga-id="${esc(v.vaga_id)}">
      <div class="hist-card-topo">
        <div class="hist-card-titulo">
          <span class="hist-card-empresa">${esc(v.empresa || 'Empresa não informada')}</span>
          <h3 class="hist-card-cargo">${esc(v.cargo || 'Cargo')}</h3>
        </div>
        <div class="hist-card-meta">
          <span class="hist-badge-sit" data-sit="${esc(v.situacao_processo)}">${esc(situacaoLabel)}</span>
          <span class="plaqueta" data-a="condicional">${esc(portalLabel)}</span>
          <span class="hist-ultimo-mov">Último movimento: ${esc(ultimoMovFmt)}</span>
        </div>
      </div>
      <div class="hist-timeline" role="list">
        ${eventosHtml}
      </div>
    </article>`;
  }).join('');
}
```

---

## 6. Roteiro TDD Passo a Passo

O engenheiro de desenvolvimento (`dev-engineer`) deve seguir estritamente o ciclo TDD:

### Fase 1: Testes Unitários de Lógica Pura (`tests/unit/panel-historico-logic.test.mjs`)
1. **Teste 1: Formatação de Datas (`formatarDataPtBr`)**
   - Entrada `2026-10-18` -> Saída `18/10/2026`.
   - Entrada `2026-10-18T14:30:00.000Z` -> Saída `18/10/2026`.
   - Entrada vazia / nula -> Saída string vazia `''`.
2. **Teste 2: Mapeamento de Rótulos e Cores de Eventos**
   - `ROTULOS_TIPO` cobre todos os 6 tipos (`descoberta`, `candidatura`, `etapa`, `contato`, `desfecho`, `descarte`).
   - `obterClasseCorEvento` retorna `'desfecho-aprovado'` quando aprovado e `'desfecho-encerrado'` quando reprovado.
3. **Teste 3: Ícones SVG Vetoriais Embutidos (`obterIconeSvg`)**
   - Retorna marcação SVG válida para cada tipo.
   - Garante que a saída não contém `<img`.
4. **Teste 4: Filtragem Pura (`filtrarHistorico`)**
   - Filtrar por `inicio` (`ultimo_movimento >= inicio`).
   - Filtrar por `fim` (`ultimo_movimento <= fim`).
   - Filtrar por `situacao_processo`.
   - Filtrar por `portal`.
   - Filtrar por termo textual na empresa, cargo ou eventos da linha do tempo.
   - Ordenar por `ultimo_movimento` decrescente.
5. **Teste 5: Extração de Portais Únicos (`extrairPortaisHistorico`)**
   - Agrupa portais em minúsculas, remove duplicatas e nulos, retorna array ordenado.
6. **Teste 6: Cálculo de Totais (`calcularTotaisHistorico`)**
   - Retorna contagem precisa de `total`, `ativos`, `aguardando_retorno`, `aguardando_voce`, `encerrados`.

### Fase 2: Implementação do Módulo `panel/historicoLogic.mjs`
- Escrever a implementação mínima em `panel/historicoLogic.mjs` até que todos os testes da Fase 1 passem com 100% de sucesso.

### Fase 3: Integração no `panel/template.html`
1. Adicionar o CSS de Histórico e Linha do Tempo no bloco `<style>`.
2. Adicionar o container `<main class="A-tela" id="painel-historico" hidden>` com barra de filtros e área de conteúdo.
3. Implementar os event listeners dos filtros (`filtro-hist-inicio`, `filtro-hist-fim`, `filtro-hist-situacao`, `filtro-hist-portal`, `filtro-hist-busca`, `btn-limpar-filtros-hist`).
4. Implementar a alternância acessível entre abas na Placa superior.
5. Injetar a lógica de `historicoLogic.mjs` no script embutido do template ou importá-la.

### Fase 4: Teste de Integração e Servidor
1. Rodar `node --test tests/unit/panel-historico-logic.test.mjs`.
2. Verificar compatibilidade do template com auditoria: zero tags `<img>` e conformidade de CSP em `tests/unit/panel-server-f10.test.mjs`.
3. Validar privacidade com `node bin/career-bounty.mjs privacy scan --all`.
4. Validar plugins com `node bin/career-bounty.mjs plugin validate`.
5. Rodar a suíte completa com `npm test -- --test-concurrency=4`.

---

## 7. Garantias de Qualidade e Critérios de Aceite

| Requisito | Critério de Aceite |
|---|---|
| **Zero Tags `<img>`** | Todo o template HTML utiliza SVGs embutidos. O teste de regressão em `panel-server-f10.test.mjs` continua passando 100%. |
| **Rota Legada `/api/fila`** | Mantida íntegra, retornando 200 para testes legados de automação e CLI (`apply-fila-panel.test.mjs`). |
| **Responsividade 375 px** | Layout flexível em coluna única, sem quebra de tela ou rolagem horizontal em 375 px de largura. |
| **Privacidade** | Nenhum dado de PII real vazado; mascaramento preservado em todas as saídas da API. |
| **Desempenho e Contraste** | Contraste de cores superior a 4,5:1 para textos e 3:1 para marcadores gráficos nos dois temas (claro e escuro). |
