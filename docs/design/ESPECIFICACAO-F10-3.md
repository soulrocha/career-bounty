# Arquitetura e Especificação Técnica: Fatia F10.3 — Aba Processos

> **Status:** Especificação técnica aprovada para implementação imediata via TDD.  
> **Dependências:** Fatia F9.1 (Contatos com recrutadores), F9.2 (Etapas e encerramento de processos) e contratos em `docs/PAINEL-API.md`.  
> **Visual escolhido:** Mundo **Misto**, Organização **A (Plataforma)** com linha de quatro estações inspirada no Metrô e paleta da Guilda.  
> **Referências de Design:** [PAINEL.md](file:///c:/Projetos/career-bounty/docs/design/PAINEL.md), `docs/PAINEL-API.md` e protótipo de referência.

---

## 1. Visão Geral da Fatia F10.3

A fatia **F10.3** implementa a aba **Processos** na interface web do CareerBounty (`panel/template.html`), oferecendo uma estação central para acompanhamento proativo de processos seletivos em andamento, monitoramento de inatividade, histórico de interações com recrutadores e suporte à preparação para entrevistas.

### 1.1 Objetivos Centrais
1. **Quatro Estações Canônicas de Processo:** Mapear a jornada do candidato em uma linha elegante e limpa de quatro estações sequenciais: **Candidatura -> Contato -> Entrevista -> Devolutiva**. Conforme o processo avança, as etapas cumpridas e ativas recebem destaque em ouro (`#D9A441`), com traço pontilhado indicando os dias em espera.
2. **Seção de Destaque "Pedem acompanhamento":** Cartões de alerta na parte superior listando processos parados há 5 dias ou mais. Os dias sem retorno são expressos na fonte **Pixelify Sans** com transição de cor semântica:
   - **Âmbar** (`var(--atencao)` / `var(--atencao-fundo)`): a partir de 5 dias de inatividade.
   - **Vermelho** (`var(--perigo)` / `var(--perigo-fundo)`): a partir de 7 dias de inatividade.
3. **Detalhe Lateral Rico e Conectado:** Painel lateral contendo:
   - Contatos vinculados com canal de comunicação (WhatsApp, LinkedIn, E-mail, Portal);
   - Linha do tempo cronológica com identificação clara de origem (**Gmail** ou **Registro** manual);
   - Bloco interativo "Registrar contato" (canal, resumo e data);
   - Rascunho contextual de mensagem de cobrança cordial com ações **Copiar** e **Abrir rascunho no Gmail**;
   - Preparação de entrevista com pontos fortes e pontos de atenção/lacunas;
   - Alerta estrito e factual: *"O painel não envia mensagens"*.
4. **Privacidade Absoluta por Construção:** Números de telefone/WhatsApp e endereços de e-mail crus **NUNCA** são renderizados na interface. Todo dado sensível passa por mascaramento estrito antes da pintura no DOM.
5. **Zero Dependências Externas e Zero Tags `<img>`:** 100% dos ícones são SVGs embutidos inline, fontes servidas localmente em arquivos WOFF2 pelo servidor local (`127.0.0.1`), operando sem internet.
6. **Desacoplamento e Testabilidade Rigorosa:** Lógica pura isolada em `panel/processosLogic.mjs` coberta por suíte de testes unitários em `tests/unit/panel-processos-logic.test.mjs`.

---

## 2. Contratos de Dados da API Local

A interface consome as rotas já existentes no servidor local (`panel/server.mjs`) documentadas em `docs/PAINEL-API.md`:

### 2.1 `GET /api/processos`
Retorna a listagem agregada dos processos seletivos e totais do funil.
- **Cabeçalhos:** `X-Painel-Token: <token-de-64-caracteres>`
- **Query Parameters (opcionais):**
  - `situacao`: `ativo`, `aguardando_retorno`, `aguardando_voce`, `encerrado`.
  - `alerta`: `normal`, `atencao`, `lembrar`.
- **Formato da Resposta (`200 OK`):**
```json
{
  "processos": [
    {
      "vaga_id": "vaga-corp-tech-01",
      "empresa": "Empresa Alfa",
      "cargo": "Arquiteto de Software",
      "etapa_atual": "entrevista_rh",
      "situacao": "aguardando_retorno",
      "desfecho": null,
      "alerta": "atencao",
      "quem_falou_por_ultimo": "candidato",
      "ultima_interacao_data": "2026-10-13",
      "dias_inatividade": 5,
      "eventos": [
        {
          "tipo": "candidatura.marcada",
          "data": "2026-10-10",
          "ts": "2026-10-10T14:30:00.000Z",
          "detalhe": "Candidatura registrada"
        },
        {
          "tipo": "processo.etapa",
          "data": "2026-10-13",
          "ts": "2026-10-13T16:00:00.000Z",
          "etapa": "entrevista_rh",
          "detalhe": "Entrevista inicial com recrutador (contato: r***@corptech.test)"
        }
      ]
    }
  ],
  "totais": {
    "total": 1,
    "ativos": 1,
    "aguardando_retorno": 1,
    "aguardando_voce": 0,
    "encerrados": 0,
    "atencao": 1,
    "lembrar": 0
  },
  "total": 1
}
```

### 2.2 `GET /api/acompanhamento`
Retorna exclusivamente processos não encerrados que estão em estado de alerta (`atencao` ou `lembrar`), ordenados por maior tempo de inatividade.
- **Cabeçalhos:** `X-Painel-Token: <token-de-64-caracteres>`
- **Formato da Resposta (`200 OK`):**
```json
{
  "pendentes": [
    {
      "vaga_id": "vaga-corp-tech-01",
      "empresa": "Empresa Alfa",
      "cargo": "Arquiteto de Software",
      "etapa_atual": "entrevista_rh",
      "situacao": "aguardando_retorno",
      "desfecho": null,
      "alerta": "atencao",
      "quem_falou_por_ultimo": "candidato",
      "ultima_interacao_data": "2026-10-13",
      "dias_inatividade": 5,
      "eventos": [ ... ]
    }
  ],
  "totais": { ... },
  "total": 1
}
```

### 2.3 `GET /api/contatos?vaga=<vaga_id>`
Retorna contatos cadastrados e vinculados à vaga do processo selecionado.
- **Formato da Resposta (`200 OK`):**
```json
{
  "contatos": [
    {
      "id": "con-7f1a9b2c",
      "vaga_id": "vaga-corp-tech-01",
      "canal": "linkedin",
      "direcao": "recebido",
      "nome": "Camila Silva",
      "papel": "Tech Recruiter",
      "resumo": "Abordagem no LinkedIn para vaga sênior.",
      "pergunta": "Qual sua disponibilidade para início?",
      "proxima_etapa": {
        "texto": "Entrevista técnica com liderança",
        "data": "2026-10-24"
      },
      "data": "2026-10-18",
      "endereco": "linkedin.com/in/camila-recruiter-test",
      "ultimo_contato": "2026-10-18",
      "dias_desde_ultimo_contato": 0,
      "quem_falou_por_ultimo": "recrutador"
    }
  ]
}
```

---

## 3. Mapeamento das Quatro Estações Canônicas

O backend possui etapas detalhadas (`aplicada`, `triagem`, `teste`, `entrevista_rh`, `entrevista_tecnica`, `entrevista_gestor`, `proposta`, `aprovado`, `encerrado`, etc.). Para garantir clareza imediata e densidade visual inspirada na linha de metrô, essas etapas são sintetizadas em **quatro estações canônicas**:

```
[ 0. Candidatura ] ─────> [ 1. Contato ] ─────> [ 2. Entrevista ] ─────> [ 3. Devolutiva ]
```

### 3.1 Tabela de Mapeamento
| Estação Canônica | Índice | Etapas do Backend Correspondentes | Indicador de Conclusão / Espera |
|---|:---:|---|---|
| **Candidatura** | `0` | `aplicada` | Cumprida logo que a vaga tem candidatura registrada. Se nenhuma outra etapa ocorreu, a espera de retorno fica pontilhada entre Candidatura e Contato. |
| **Contato** | `1` | `triagem` ou existência de `contato.registrado` / e-mails recebidos | Ativa quando há abordagem do recrutador ou triagem em andamento. Espera pontilhada até a marcação de entrevista. |
| **Entrevista** | `2` | `teste`, `entrevista_rh`, `entrevista_tecnica`, `entrevista_gestor` | Ativa durante testes práticos e conversas com equipe técnica ou gestores. |
| **Devolutiva** | `3` | `proposta`, `aprovado`, `encerrado`, `desfecho !== null` | Estação final do processo (oferta, aprovação, reprovação ou encerramento). |

### 3.2 Representação Visual do Trilho
- **Estações Cumpridas (`.seg.feito`):** Anel preenchido em ouro (`background: var(--ouro); border-color: var(--ouro);`) e linha sólida dourada anterior.
- **Estação Atual (`.seg.atual`):** Anel com borda em ouro (`border-color: var(--ouro);`) e centro com cor de realce.
- **Em Espera (`.seg.espera`):** Traço pontilhado (`repeating-linear-gradient(...)`) e pílula `.espera-n` indicando `X dias` em fonte Pixelify Sans:
  - `< 5 dias`: neutro (`var(--tx2)`);
  - `5 a 6 dias`: atenção (`var(--atencao)`, âmbar);
  - `7+ dias`: perigo (`var(--perigo)`, vermelho).

---

## 4. Arquitetura da Interface Web (`panel/template.html`)

### 4.1 Placa Superior (Navegação e Contador)
Na barra superior fixa (`.placa`):
```html
<button type="button" class="aba-btn" data-aba="processos">
  Processos <span class="cont" id="badge-processos">0</span>
</button>
```
- **Comportamento do `#badge-processos`:**
  - Exibe o número de processos que pedem acompanhamento (inativos há 5 dias ou mais).
  - Quando há pendências (`pendentes > 0`), ganha a classe `.atencao` (`background: var(--ouro); color: #231804;`), tornando o badge dourado como definido no Design System.

### 4.2 Container Principal `#painel-processos`
O container principal da aba é inserido logo após `#painel-historico`, mantendo a alternância acessível via atributo `hidden`:

```html
<main class="A-tela painel-processos" id="painel-processos" hidden>
  <div class="pagina">
    <header class="processos-cabecalho">
      <h1>Processos</h1>
      <p class="sub">
        Candidaturas em andamento, contatos com recrutadores e o próximo passo de cada uma.
        O Gmail alimenta a linha do tempo; WhatsApp e LinkedIn você registra aqui.
      </p>
    </header>

    <!-- Bloco 1: Pedem Acompanhamento (inativos >= 5 dias) -->
    <section class="secao-cobrar" id="secao-cobrar" aria-label="Processos que pedem acompanhamento" hidden>
      <h2>Pedem acompanhamento</h2>
      <div class="painel cobrar" id="lista-cobrar" role="feed"></div>
    </section>

    <!-- Bloco 2: Filtros por Etapa (Chips) -->
    <div class="filtro-etapas" id="filtro-etapas-processos" role="group" aria-label="Filtrar por etapa">
      <button type="button" class="chip" data-etapa="" aria-pressed="true">
        Todas <span class="n" id="total-etapa-todas">0</span>
      </button>
      <button type="button" class="chip" data-etapa="candidatura" aria-pressed="false">
        Candidatura <span class="n" id="total-etapa-candidatura">0</span>
      </button>
      <button type="button" class="chip" data-etapa="contato" aria-pressed="false">
        Contato <span class="n" id="total-etapa-contato">0</span>
      </button>
      <button type="button" class="chip" data-etapa="entrevista" aria-pressed="false">
        Entrevista <span class="n" id="total-etapa-entrevista">0</span>
      </button>
      <button type="button" class="chip" data-etapa="devolutiva" aria-pressed="false">
        Devolutiva <span class="n" id="total-etapa-devolutiva">0</span>
      </button>
    </div>

    <!-- Bloco 3: Grade de Processos (Lista e Detalhe) -->
    <div class="proc-grade" id="proc-grade">
      <!-- Lado Esquerdo: Lista de Processos -->
      <div class="painel proc-lista" id="proc-lista" role="region" aria-label="Lista de processos seletivos">
        <!-- Renderizado dinamicamente -->
      </div>

      <!-- Lado Direito: Detalhe do Processo Selecionado -->
      <div class="painel proc-det" id="proc-det" role="region" aria-label="Detalhe do processo selecionado">
        <!-- Renderizado dinamicamente -->
      </div>
    </div>
  </div>
</main>
```

### 4.3 Seção "Pedem acompanhamento" (`.cobrar .item`)
Cada cartão de processo que requer acompanhamento renderiza:
```html
<article class="item" data-vaga-id="${esc(p.vaga_id)}">
  <div class="dias ${diasInatividade >= 7 ? 'perigo' : 'atencao'}">
    ${diasInatividade}
    <small>dias</small>
  </div>
  <div class="item-info">
    <strong>${esc(p.empresa)}</strong> · <span>${esc(p.cargo)}</span>
    <div class="meta">
      Último contato ${contatoInfo} em ${formatarDataPtBr(p.ultima_interacao_data)}.
      ${p.proxima_etapa ? `Próxima etapa: ${esc(p.proxima_etapa.texto)}.` : 'Nenhuma próxima etapa marcada.'}
    </div>
  </div>
  <div class="acoes-l">
    <button type="button" class="btn prim peq" data-acao="escrever-acompanhamento" data-id="${esc(p.vaga_id)}">
      Escrever acompanhamento
    </button>
    <button type="button" class="btn peq" data-acao="adiar-acompanhamento" data-id="${esc(p.vaga_id)}">
      Ainda em andamento
    </button>
    <button type="button" class="btn discreto peq" data-acao="encerrar-processo" data-id="${esc(p.vaga_id)}">
      Encerrar
    </button>
  </div>
</article>
```

### 4.4 Detalhe do Processo Selecionado (`.proc-det`)
O painel de detalhe do processo selecionado é estruturado com as seguintes seções funcionais:

1. **Topo:** Plaqueta de raridade da vaga, nome da empresa em negrito, rótulo textual da etapa corrente.
2. **Título:** Cargo da oportunidade (`h2`).
3. **Trilho Canônico Expandido:** As 4 estações com status em ouro e contagem pontilhada.
4. **Alerta de Próxima Etapa:** Se houver data marcada, exibe box com ícone SVG de relógio/calendário e o texto da etapa agendada.
5. **Seção "Contatos vinculados":**
   - Lista os recrutadores vinculados à vaga.
   - Ícone do canal (SVG puro de WhatsApp, LinkedIn, E-mail ou Portal).
   - Nome e papel profissional.
   - Endereço/telefone **estritamente mascarado** (ex: `(11) 9****-**34` ou `c***@corptech.test`).
   - Recência textual ("há X dias").
   - Caso nenhum contato exista: `Nenhum contato registrado.`
6. **Seção "Linha do tempo":**
   - Lista cronológica (`<ol class="tempo">`).
   - Data no formato `DD/MM` ou `DD/MM/AAAA`.
   - Resumo da interação/evento.
   - Pílula de origem: **Gmail** (em eventos originados de e-mails recebidos) ou **Registro** (em interações registradas pelo candidato).
7. **Formulário "Registrar contato":**
   - Campo Canal: `<select id="rc-canal">` com WhatsApp, LinkedIn, E-mail e Portal.
   - Campo Resumo: `<input class="campo" id="rc-resumo" placeholder="Ex.: recrutadora pediu pretensão salarial">`.
   - Campo Data: `<input class="campo" type="date" id="rc-data" value="${hoje}">`.
   - Botão Ação: `<button type="button" class="btn" id="btn-registrar-contato">` com SVG de adição e texto *"Registrar contato"*.
8. **Seção "Mensagem de acompanhamento":**
   - Renderizada quando o processo está aguardando retorno (`aguardando_retorno` ou `ativo` com inatividade >= 5 dias).
   - Mostra aviso `· X dias sem retorno` em âmbar ou vermelho.
   - `<textarea class="campo" id="rascunho" rows="4">` com sugestão inteligente de texto cordial.
   - Ações:
     - Botão **Copiar** (com feedback visual *"Mensagem copiada."*).
     - Botão **Abrir rascunho no Gmail** (abre link seguro de composição do Gmail com parâmetros `su` e `body` pré-preenchidos).
     - Aviso estrito ao lado: `<span class="meta">O painel não envia mensagens.</span>`.
9. **Seção "Preparação para a entrevista"** (quando na etapa de entrevista):
   - Grid com **Pontos fortes** em verde (`var(--ok)`) contendo os motivos e atrativos do currículo.
   - **Pontos de atenção** em âmbar (`var(--atencao)`) contendo lacunas da vaga a esclarecer.
   - Recomendações práticas de perguntas para levar à entrevista técnica.
10. **Seção "Devolutiva"** (quando encerrado ou desfecho negativo):
    - Alerta explicativo do desfecho recebido com botão/link *"Ver a lacuna em Currículo e provas"*.

---

## 5. Módulo Lógico Puro: `panel/processosLogic.mjs`

Todas as funções puras de manipulação de dados, mapeamento de estações, filtragem, ordenação, geração de textos e regras de segurança devem residir desacopladas em `panel/processosLogic.mjs`:

```javascript
// panel/processosLogic.mjs
// Lógica pura desacoplada para a Aba Processos (F10.3).

export const ESTAPAS_CANONICAS = ['Candidatura', 'Contato', 'Entrevista', 'Devolutiva'];

export const ROTULOS_ESTACAO = {
  candidatura: 'Candidatura',
  contato: 'Contato',
  entrevista: 'Entrevista',
  devolutiva: 'Devolutiva',
};

export const ROTULOS_ETAPA_BACKEND = {
  aplicada: 'Candidatura enviada',
  triagem: 'Em triagem',
  teste: 'Desafio prático',
  entrevista_rh: 'Alinhamento com RH',
  entrevista_tecnica: 'Entrevista técnica',
  entrevista_gestor: 'Entrevista com gestor',
  proposta: 'Proposta recebida',
  aprovado: 'Aprovado',
  encerrado: 'Encerrado',
  negativa: 'Processo encerrado',
};

export const CANAIS_ICONES = {
  email: 'mail',
  whatsapp: 'msg',
  linkedin: 'in',
  portal: 'doc',
  outro: 'doc',
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Formata data no formato brasileiro DD/MM/AAAA.
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
 * Calcula o nível de alerta e cor de acordo com dias de inatividade:
 * - < 5 dias: 'normal'
 * - 5 a 6 dias: 'atencao' (âmbar)
 * - >= 7 dias: 'perigo' (vermelho)
 */
export function calcularNivelInatividade(dias) {
  const d = Number(dias) || 0;
  if (d >= 7) return 'perigo';
  if (d >= 5) return 'atencao';
  return 'normal';
}

/**
 * Mapeia a etapa detalhada do backend para uma das 4 estações canônicas.
 * Retorna o índice (0..3), nome, booleano de espera e alerta.
 */
export function mapearEstacaoCanonica(processo = {}) {
  const etapa = processo.etapa_atual || 'aplicada';
  const situacao = processo.situacao || 'ativo';
  const desfecho = processo.desfecho || null;
  const dias = Number(processo.dias_inatividade) || 0;

  // Se o processo está encerrado ou tem desfecho, atingiu a estação final (Devolutiva)
  if (situacao === 'encerrado' || desfecho !== null || ['proposta', 'aprovado', 'negativa', 'encerrado'].includes(etapa)) {
    return {
      indice: 3,
      nome: 'Devolutiva',
      chave: 'devolutiva',
      esperando: false,
      diasInatividade: dias,
      alerta: 'normal',
    };
  }

  // Se está em testes ou entrevistas
  if (['teste', 'entrevista_rh', 'entrevista_tecnica', 'entrevista_gestor'].includes(etapa)) {
    const esperando = (situacao === 'aguardando_retorno');
    return {
      indice: 2,
      nome: 'Entrevista',
      chave: 'entrevista',
      esperando,
      diasInatividade: dias,
      alerta: esperando ? calcularNivelInatividade(dias) : 'normal',
    };
  }

  // Se está em triagem ou se há contatos registrados de recrutadores
  const temContato = Array.isArray(processo.eventos) && processo.eventos.some(e => e.tipo === 'contato.registrado' || e.tipo === 'email.recebido');
  if (etapa === 'triagem' || temContato) {
    const esperando = (situacao === 'aguardando_retorno');
    return {
      indice: 1,
      nome: 'Contato',
      chave: 'contato',
      esperando,
      diasInatividade: dias,
      alerta: esperando ? calcularNivelInatividade(dias) : 'normal',
    };
  }

  // Candidatura inicial
  const esperando = (situacao === 'aguardando_retorno' || situacao === 'ativo');
  return {
    indice: 0,
    nome: 'Candidatura',
    chave: 'candidatura',
    esperando,
    diasInatividade: dias,
    alerta: esperando ? calcularNivelInatividade(dias) : 'normal',
  };
}

/**
 * Identifica e ordena os processos que pedem acompanhamento:
 * Não encerrados e com inatividade >= 5 dias (ou alerta 'atencao' / 'lembrar').
 */
export function identificarProcessosPedemAcompanhamento(processos = []) {
  if (!Array.isArray(processos)) return [];
  return processos
    .filter(p => p.situacao !== 'encerrado' && (Number(p.dias_inatividade) >= 5 || p.alerta === 'atencao' || p.alerta === 'lembrar'))
    .sort((a, b) => (Number(b.dias_inatividade) || 0) - (Number(a.dias_inatividade) || 0));
}

/**
 * Filtra processos por estação canônica, situação, alerta e busca textual.
 */
export function filtrarProcessos(processos = [], filtros = {}) {
  if (!Array.isArray(processos)) return [];
  const b = norm(filtros.busca);
  const estacaoFiltro = filtros.estacao ? norm(filtros.estacao) : null;

  return processos.filter(p => {
    if (filtros.situacao && p.situacao !== filtros.situacao) return false;
    if (filtros.alerta && p.alerta !== filtros.alerta) return false;

    if (estacaoFiltro) {
      const canonica = mapearEstacaoCanonica(p);
      if (norm(canonica.nome) !== estacaoFiltro && norm(canonica.chave) !== estacaoFiltro) {
        return false;
      }
    }

    if (b) {
      const eventosTexto = (p.eventos || []).flatMap(e => [e.detalhe, e.resumo, e.assunto, e.etapa]);
      const textoGeral = norm([
        p.empresa,
        p.cargo,
        p.etapa_atual,
        p.situacao,
        p.desfecho,
        ...eventosTexto,
      ].join(' '));
      if (!textoGeral.includes(b)) return false;
    }

    return true;
  });
}

/**
 * Ordena processos: ativos com maior inatividade primeiro, depois encerrados.
 */
export function ordenarProcessos(processos = []) {
  if (!Array.isArray(processos)) return [];
  return [...processos].sort((a, b) => {
    const aEnc = a.situacao === 'encerrado';
    const bEnc = b.situacao === 'encerrado';
    if (aEnc && !bEnc) return 1;
    if (!aEnc && bEnc) return -1;
    return (Number(b.dias_inatividade) || 0) - (Number(a.dias_inatividade) || 0);
  });
}

/**
 * Gera rascunho amigável e profissional para mensagem de acompanhamento.
 */
export function gerarRascunhoAcompanhamento(processo = {}, contato = null) {
  const primeiroNome = contato?.nome ? contato.nome.trim().split(' ')[0] : '';
  const saudacao = primeiroNome ? `Olá ${primeiroNome}, tudo bem?` : 'Olá, tudo bem?';
  const cargo = processo.cargo || 'oportunidade';
  const empresa = processo.empresa ? ` na ${processo.empresa}` : '';
  const dataRef = processo.eventos?.[0]?.data ? formatarDataPtBr(processo.eventos[0].data) : '';
  const mencaoData = dataRef ? ` em ${dataRef}` : '';

  return `${saudacao} Me candidatei à vaga de ${cargo}${empresa}${mencaoData} e sigo com muito interesse na oportunidade. Gostaria de saber se há novidades sobre os próximos passos do processo seletivo. Fico à disposição para conversar.`;
}

/**
 * Gera URL de rascunho no Gmail (apenas abre o compositor; nunca envia).
 */
export function gerarUrlGmailDraft(destinatario = '', assunto = '', corpo = '') {
  const base = 'https://mail.google.com/mail/?view=cm&fs=1';
  const params = new URLSearchParams();
  if (destinatario) params.set('to', destinatario);
  if (assunto) params.set('su', assunto);
  if (corpo) params.set('body', corpo);
  return `${base}&${params.toString()}`;
}

/**
 * Regra de privacidade estrita: mascara qualquer telefone (+55, celulares, fixos) e e-mails.
 */
export function mascararDadoSensivel(texto) {
  if (typeof texto !== 'string') return texto;
  // 1. E-mails
  let res = texto.replace(/([A-Za-z0-9_%+.-])[A-Za-z0-9_%+.-]*(@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, '$1***$2');
  // 2. Telefones com DDD em parênteses ou separador
  res = res.replace(/(?<!\d)(?:\+?55[\s-]?)?\(?([1-9][1-9])\)?[\s-]*(?:9\s*)?(\d{4,5})[-.\s]?(\d{2})(\d{2})(?!\d)/g, '($1) 9****-**$4');
  // 3. Telefones sem DDD
  res = res.replace(/(?<!\d)(?:9\s*)?(\d{4,5})[-.](\d{2})(\d{2})(?!\d)/g, '9****-**$3');
  return res;
}

/**
 * Retorna catálogo de ícones SVG limpos e vetoriais (zero <img>).
 */
export function obterIconeSvgProcesso(tipo) {
  switch (tipo) {
    case 'mail':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
    case 'msg':
    case 'whatsapp':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>';
    case 'in':
    case 'linkedin':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/></svg>';
    case 'doc':
    case 'portal':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>';
    case 'copiar':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    case 'mais':
    case 'adicionar':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    case 'alerta':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    case 'check':
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    default:
      return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
  }
}

/**
 * Calcula totais por etapa canônica e situação.
 */
export function calcularTotaisProcessos(processos = []) {
  const lista = Array.isArray(processos) ? processos : [];
  const ativos = lista.filter(p => p.situacao !== 'encerrado');
  const pedem = identificarProcessosPedemAcompanhamento(lista);

  const porEstacao = {
    candidatura: 0,
    contato: 0,
    entrevista: 0,
    devolutiva: 0,
  };

  for (const p of ativos) {
    const st = mapearEstacaoCanonica(p);
    if (porEstacao[st.chave] !== undefined) {
      porEstacao[st.chave] += 1;
    }
  }

  return {
    total: lista.length,
    ativos: ativos.length,
    pedemAcompanhamento: pedem.length,
    encerrados: lista.filter(p => p.situacao === 'encerrado').length,
    porEstacao,
  };
}
```

---

## 6. Roteiro TDD Passo a Passo

O engenheiro de software (`dev-engineer`) deve implementar a fatia F10.3 seguindo o ciclo estrito de TDD:

### Fase 1: Suíte de Testes Unitários (`tests/unit/panel-processos-logic.test.mjs`)
Escrever antes do código a suíte completa de testes unitários para testar cada função de `panel/processosLogic.mjs`:

1. **Teste 1: Mapeamento de Estações Canônicas (`mapearEstacaoCanonica`)**
   - Processo inicial com `etapa_atual: 'aplicada'` -> Estação `Candidatura` (índice 0), `esperando: true`.
   - Processo em `triagem` ou com evento de contato -> Estação `Contato` (índice 1).
   - Processo em `teste`, `entrevista_rh` ou `entrevista_tecnica` -> Estação `Entrevista` (índice 2).
   - Processo com `desfecho: 'reprovado'`, `situacao: 'encerrado'` ou `etapa_atual: 'proposta'` -> Estação `Devolutiva` (índice 3), `esperando: false`.
2. **Teste 2: Cálculo de Nível de Inatividade e Alertas (`calcularNivelInatividade`)**
   - 0 a 4 dias -> `'normal'`.
   - 5 e 6 dias -> `'atencao'` (âmbar).
   - 7 dias ou mais -> `'perigo'` (vermelho).
3. **Teste 3: Identificação de Processos que Pedem Acompanhamento (`identificarProcessosPedemAcompanhamento`)**
   - Retorna apenas processos não encerrados com `dias_inatividade >= 5` ou alertas ativos.
   - Ordena por maior inatividade decrescente (ex: 9 dias antes de 5 dias).
4. **Teste 4: Filtragem e Ordenação (`filtrarProcessos`, `ordenarProcessos`)**
   - Filtra por estação canônica (`candidatura`, `contato`, `entrevista`, `devolutiva`).
   - Filtra por situação (`ativo`, `aguardando_retorno`, `encerrado`).
   - Filtra por busca textual em empresa, cargo ou eventos.
   - Ordena processos ativos por inatividade decrescente e coloca encerrados no final.
5. **Teste 5: Geração de Rascunho e Link do Gmail (`gerarRascunhoAcompanhamento`, `gerarUrlGmailDraft`)**
   - Gera saudação personalizada se houver contato com nome.
   - Inclui cargo, empresa e data de aplicação.
   - Gera URL do Gmail com `su` e `body` codificados, mantendo comportamento estrito de apenas abrir o compositor sem disparo automático.
6. **Teste 6: Regra de Privacidade Estrita (`mascararDadoSensivel`)**
   - Mascara telefones celulares (+55, com DDD, sem DDD) no formato `(11) 9****-**34`.
   - Mascara e-mails no formato `r***@corptech.test`.
   - Garante que nenhum telefone ou e-mail cru seja exibido.
7. **Teste 7: Integridade de Ícones SVG (`obterIconeSvgProcesso`)**
   - Retorna SVG inline válido para todos os canais e ações.
   - Garante que nenhuma tag `<img>` é retornada.
8. **Teste 8: Cálculo de Totais (`calcularTotaisProcessos`)**
   - Contabiliza processos ativos, pendentes de acompanhamento e contagem por estação canônica.

### Fase 2: Implementação de `panel/processosLogic.mjs`
- Implementar as funções em `panel/processosLogic.mjs` até atingir 100% de aprovação na suíte de testes unitários.

### Fase 3: Integração no `panel/template.html`
1. **Adicionar CSS da Aba Processos:**
   - Estilos para `.trilho`, `.seg`, `.bola`, `.espera-n`, `.cobrar`, `.dias`, `.proc-grade`, `.proc-lista`, `.proc-det`, `.contato`, `.tempo`, `.registro`, `.prep`.
   - Configurar fonte `Pixelify Sans` para `.cobrar .dias` e `.espera-n`.
2. **Adicionar o container HTML `#painel-processos`:**
   - Cabeçalho, seção `#secao-cobrar`, chips `#filtro-etapas-processos`, lista `#proc-lista` e detalhe `#proc-det`.
3. **Adicionar a Lógica no `<script>` do template:**
   - Adicionar `processos` no objeto `telas` de alternância de abas da Placa.
   - Carregar dados de `GET /api/processos` e `GET /api/acompanhamento`.
   - Renderizar o badge `#badge-processos` com classe `.atencao` quando houver itens que pedem acompanhamento.
   - Adicionar renderizadores `renderizarProcessos()`, `renderizarCobrar()` e `renderizarDetalheProcesso()`.
   - Implementar interações: clique na lista seleciona o processo, ação "Escrever acompanhamento" rola até o rascunho, ação "Copiar" copia o texto para a área de transferência com feedback, "Registrar contato" adiciona evento e atualiza a linha do tempo.

### Fase 4: Verificação de Qualidade e Segurança
1. Executar testes unitários:
   ```bash
   node --test tests/unit/panel-processos-logic.test.mjs
   ```
2. Executar teste de auditoria do painel:
   ```bash
   node --test tests/unit/panel-server-f10.test.mjs
   ```
3. Executar auditoria de privacidade e validação do plugin:
   ```bash
   node bin/career-bounty.mjs privacy scan --all
   node bin/career-bounty.mjs plugin validate
   ```
4. Executar toda a suíte de testes do projeto:
   ```bash
   npm test -- --test-concurrency=4
   ```

---

## 7. Critérios de Aceite e Garantias de Qualidade

| Item | Critério de Aceite |
|---|---|
| **Estações Canônicas** | 4 estações sequenciais (Candidatura, Contato, Entrevista, Devolutiva) com anéis redondos e traço contínuo em ouro para etapas concluídas. |
| **Acompanhamento** | Processos inativos há 5+ dias em destaque na seção superior; número de dias em fonte **Pixelify Sans** (âmbar para 5-6 dias, vermelho para 7+ dias). |
| **Badge na Placa** | `#badge-processos` exibe contagem de processos a cobrar e ganha fundo dourado (`.atencao`) quando há pendências. |
| **Rascunho de E-mail** | Ação "Abrir rascunho no Gmail" apenas abre compositor com texto e assunto pré-configurados; nenhuma mensagem é enviada automaticamente. |
| **Aviso Legal Factual** | Texto visível e permanente no detalhe: *"O painel não envia mensagens."* |
| **Privacidade** | Telefones (inclusive WhatsApp) e e-mails de recrutadores **sempre mascarados** na tela. Zero PII crua. |
| **Zero Tags `<img>`** | Todos os ícones são SVGs embutidos inline; nenhum `<img>` presente no HTML compilado. |
| **Responsividade** | Layout adaptável em 375 px (coluna única para a lista e detalhe) sem quebra ou rolagem horizontal. |
| **Acessibilidade** | Contraste WCAG AA verificado sobre os tokens do Design System Misto; foco visível em todos os elementos clicáveis; respeita `prefers-reduced-motion`. |
