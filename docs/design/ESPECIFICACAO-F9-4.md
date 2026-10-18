# Arquitetura e Especificação Técnica: Fatia F9.4 — Avaliação da Empresa

> **Status:** Especificação técnica aprovada para implementação imediata via TDD.  
> **Referência de Requisitos:** PLANO-F9-recursos-2026-10-18.md (seção F9.4 e regras globais).  
> **Branch de Trabalho:** `feat/F9.4-avaliacao` no repositório `C:\Projetos\career-bounty-backend`.

---

## 1. Visão Geral da Fatia F9.4

A fatia **F9.4** reintroduz e moderniza o mecanismo de avaliação da reputação de empresas contratantes no CareerBounty:

1. **Separação de Entidade:** No modelo legado, os dados de avaliação da empresa ficavam acoplados diretamente ao objeto de cada vaga individual (`empresa_avaliacao` repetido em 185 vagas). Na nova arquitetura orientada a eventos, a avaliação pertence à **empresa** (identificada por sua chave normalizada `empresa_chave`) e não à vaga.
2. **Ciclo de Vida e Validade:** Avaliações de empresas são retratos datados com validade temporal padrão de **90 dias**. A projeção de vagas anexa dinamicamente a avaliação mais recente caso ela esteja dentro do período de vigência.
3. **Conformidade Legal e Segurança Técnica (Anti-Bot):**
   - **É estritamente proibido fazer scraping direto de páginas do Glassdoor**, visto que os Termos de Uso do serviço vedam raspagem automatizada e seus sistemas anti-bot bloqueiam robôs.
   - O subagente de avaliação opera exclusivamente lendo metadados e resumos expostos na **busca pública** na web e consolidando o resultado via LLM com citação **obrigatória** de fonte com URL pública válida.
   - Se nenhuma fonte com URL for detectada, a avaliação é sumariamente **recusada**.
4. **Idempotência e Migração de Dados:** As 185 avaliações legadas existentes nas vagas importadas são migradas de forma puramente determinística para eventos `empresa.avaliada`, garantindo preservação integral de dados sem duplicações.
5. **Automação Diária Sustentável:** O comando `daily-run` seleciona automaticamente empresas de vagas com aderência `alta` ou `boa` que estejam sem avaliação válida, respeitando um teto diário configurável (`avaliacoes.teto_diario` no `config.yml`).

---

## 2. Evento `empresa.avaliada`

### 2.1 Estrutura do Envelope e Schema

O evento segue estritamente o padrão de eventos do CareerBounty (`core/store/events.mjs` e `core/store/schema.mjs`), com nomenclatura em português (`entidade.acao`):

```json
{
  "id": "avaliacao:acmecorp:2026-10-18",
  "ts": "2026-10-18T14:30:00.000Z",
  "host": "meu-host",
  "seq": 105,
  "ator": "cli",
  "tipo": "empresa.avaliada",
  "entidade": "empresa",
  "entidade_id": "acmecorp",
  "dados": {
    "empresa": "Empresa Alfa",
    "empresa_chave": "empresa-alfa",
    "nota": 4.2,
    "quantidade": 150,
    "plataforma": "Glassdoor",
    "data": "2026-10-18",
    "fontes": [
      {
        "url": "https://glassdoor.test/Overview/Working-at-Empresa-Alfa-EI_IE12345.htm",
        "plataforma": "Glassdoor"
      }
    ],
    "resumo": "Boa cultura técnica, liderança acessível e ambiente colaborativo.",
    "validade_dias": 90
  },
  "evidencia": []
}
```

### 2.2 Especificação dos Campos de `dados`

| Campo | Tipo | Obrigatório | Descrição / Restrições |
| :--- | :--- | :---: | :--- |
| `empresa` | `string` | Sim | Nome original de exibição da empresa (não vazio). |
| `empresa_chave` | `string` | Sim | Chave canônica normalizada gerada por `companyKey(empresa)` (ex.: `acmecorp`). |
| `nota` | `number` | Sim | Número de ponto flutuante entre `1.0` e `5.0`. |
| `quantidade` | `integer` | Sim | Inteiro `>= 0` representando o número de avaliações apuradas. |
| `plataforma` | `string` | Sim | Valor pertencente ao conjunto: `'Glassdoor'`, `'Indeed'`, `'Catho'`, `'Outro'`. |
| `data` | `string` | Sim | Data civil de referência da avaliação no formato `AAAA-MM-DD`. Não pode ser data futura em relação ao relógio de São Paulo (`localDay(nowTs)`). |
| `fontes` | `array` | Sim | Lista não-vazia de objetos `{ url: string, plataforma: string }`. A URL deve possuir protocolo `http:` ou `https:`. Sem URL válida, a avaliação é inválida. |
| `resumo` | `string` | Não | Texto curto sintetizando pontos fortes e desafios (máximo de 500 caracteres). Se omitido, normaliza para `null`. |
| `validade_dias` | `integer` | Não | Inteiro `>= 1` definindo a vigência temporal da avaliação. Valor padrão: `90`. |

### 2.3 Regras de Validação em `core/store/rules.mjs`

Exportar a função pura:

```javascript
export const PLATAFORMAS_AVALIACAO = new Set(['Glassdoor', 'Indeed', 'Catho', 'Outro']);

export function validarEmpresaAvaliada(dados, nowTs = new Date().toISOString()) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return 'Dados da avaliação de empresa inválidos.';
  }
  if (typeof dados.empresa !== 'string' || !dados.empresa.trim()) {
    return 'Nome da empresa é obrigatório.';
  }
  if (typeof dados.empresa_chave !== 'string' || !dados.empresa_chave.trim()) {
    return 'Chave normalizada da empresa é obrigatória.';
  }
  if (typeof dados.nota !== 'number' || !Number.isFinite(dados.nota) || dados.nota < 1.0 || dados.nota > 5.0) {
    return 'Nota deve ser um número entre 1.0 e 5.0.';
  }
  if (!Number.isInteger(dados.quantidade) || dados.quantidade < 0) {
    return 'Quantidade de avaliações deve ser um número inteiro maior ou igual a zero.';
  }
  if (!PLATAFORMAS_AVALIACAO.has(dados.plataforma)) {
    return `Plataforma inválida; use uma das seguintes: ${[...PLATAFORMAS_AVALIACAO].join(', ')}.`;
  }
  if (!isoDate(dados.data)) {
    return 'Data da avaliação inválida; use AAAA-MM-DD.';
  }
  if (dados.data > localDay(nowTs)) {
    return 'A avaliação não pode ter data futura.';
  }
  if (!Array.isArray(dados.fontes) || dados.fontes.length === 0) {
    return 'Fontes com URL são obrigatórias para registrar uma avaliação.';
  }
  for (const fonte of dados.fontes) {
    if (!fonte || typeof fonte !== 'object' || Array.isArray(fonte)) {
      return 'Item de fonte inválido.';
    }
    if (typeof fonte.url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(fonte.url.trim())) {
      return 'URL da fonte inválida ou ausente.';
    }
    if (fonte.plataforma !== undefined && !PLATAFORMAS_AVALIACAO.has(fonte.plataforma)) {
      return `Plataforma da fonte inválida: ${fonte.plataforma}.`;
    }
  }
  if (dados.resumo !== undefined && dados.resumo !== null) {
    if (typeof dados.resumo !== 'string') {
      return 'Resumo deve ser um texto.';
    }
    if (dados.resumo.length > 500) {
      return 'Resumo excede o limite de 500 caracteres.';
    }
  }
  if (dados.validade_dias !== undefined && dados.validade_dias !== null) {
    if (!Number.isInteger(dados.validade_dias) || dados.validade_dias < 1) {
      return 'Validade em dias deve ser um inteiro positivo.';
    }
  }
  return null;
}
```

---

## 3. Projeção Pura de Avaliações (`core/store/projections/avaliacoes.mjs`)

### 3.1 Responsabilidade do Módulo

O módulo `core/store/projections/avaliacoes.mjs` é uma função pura e determinística:
- Não realiza I/O de rede nem disco.
- Processa o array de eventos do log buscando `tipo === 'empresa.avaliada'`.
- Agrupa avaliações por `empresa_chave`.
- Ordena o histórico cronologicamente por `data` decrescente (desempate por `ts` decrescente).
- Determina para cada empresa se a avaliação mais recente está **ativa/válida** ou **expirada**, calculando dias decorridos e dias restantes.

### 3.2 Contrato da Função `projectAvaliacoes`

```javascript
// core/store/projections/avaliacoes.mjs
import { companyKey } from '../../dedup/keys.mjs';
import { localDay } from '../schema.mjs';

function diferencaDias(diaA, diaB) {
  if (!diaA || !diaB) return 0;
  const tA = Date.parse(`${diaA}T12:00:00Z`);
  const tB = Date.parse(`${diaB}T12:00:00Z`);
  return Math.round((tB - tA) / 86400000);
}

export function projectAvaliacoes(eventos, { now = new Date() } = {}) {
  const hoje = localDay(now);
  const porEmpresa = new Map();

  for (const evento of eventos) {
    if (evento.tipo !== 'empresa.avaliada') continue;
    const d = evento.dados;
    const chave = d.empresa_chave || companyKey(d.empresa);
    if (!chave) continue;

    const validadeDias = d.validade_dias ?? 90;
    const diasDecorridos = diferencaDias(d.data, hoje);
    const valida = diasDecorridos >= 0 && diasDecorridos <= validadeDias;
    const diasRestantes = Math.max(0, validadeDias - diasDecorridos);

    const item = {
      id: evento.id, empresa: d.empresa,
      empresa_chave: chave,
      nota: d.nota,
      quantidade: d.quantidade,
      plataforma: d.plataforma,
      data: d.data,
      fontes: d.fontes ?? [],
      resumo: d.resumo ?? null,
      validade_dias: validadeDias,
      valida,
      dias_decorridos: Math.max(0, diasDecorridos),
      dias_restantes: diasRestantes,
      expirada: !valida,
      registrado_em: evento.ts
    };

    if (!porEmpresa.has(chave)) porEmpresa.set(chave, []);
    porEmpresa.get(chave).push(item);
  }

  const mapaResultado = {};
  const listaVigentes = [];

  for (const [chave, avaliacoes] of porEmpresa.entries()) {
    // Ordena da mais recente para a mais antiga
    avaliacoes.sort((a, b) => b.data.localeCompare(a.data) || b.registrado_em.localeCompare(a.registrado_em));
    const maisRecente = avaliacoes[0];

    const consolidado = {
      ...maisRecente,
      historico: avaliacoes
    };

    mapaResultado[chave] = consolidado;
    if (maisRecente.valida) {
      listaVigentes.push(consolidado);
    }
  }

  return {
    por_empresa: mapaResultado,
    avaliacoes_vigentes: listaVigentes,
    total_empresas: Object.keys(mapaResultado).length,
    total_vigentes: listaVigentes.length
  };
}

export function obterAvaliacaoVigente(empresa, projecaoAvaliacoes, { aliases = {} } = {}) {
  if (!empresa || !projecaoAvaliacoes?.por_empresa) return null;
  const chave = companyKey(empresa, aliases);
  const entrada = projecaoAvaliacoes.por_empresa[chave];
  if (!entrada || !entrada.valida) return null;
  return {
    nota: entrada.nota,
    quantidade: entrada.quantidade,
    plataforma: entrada.plataforma,
    data: entrada.data,
    fontes: entrada.fontes,
    resumo: entrada.resumo
  };
}
```

---

## 4. Integração com a Projeção de Vagas (`core/store/project.mjs`)

Na projeção principal de vagas (`projectEvents` em `core/store/project.mjs`):
1. Invoca `projectAvaliacoes(events, { now: options?.now ?? new Date() })`.
2. Durante o enriquecimento e mapeamento final das vagas (`inherit` ou passo pós-ordenação):
   - Para cada vaga, consulta `obterAvaliacaoVigente(vaga.empresa, avaliacoes)`.
   - Se houver avaliação válida, injeta no objeto da vaga:
     ```javascript
     vaga.empresa_avaliacao = {
       nota: av.nota,
       quantidade: av.quantidade,
       plataforma: av.plataforma,
       data: av.data,
       fontes: av.fontes,
       resumo: av.resumo
     };
     ```
   - Se **não houver avaliação válida** (ou se a avaliação anterior tiver expirado por ter mais de 90 dias):
     - `delete vaga.empresa_avaliacao` ou `vaga.empresa_avaliacao = null` (garante que nenhuma vaga nova ou expirada carregue dados espúrios).
   - Isso atende diretamente a regra mandatória de `ESPECIFICACAO-F10-1.md`:
     > "Se `empresa_avaliacao` não existir nos dados da vaga, exibe 'Sem nota coletada' ou omite a nota. Sob nenhuma hipótese exibir nota 0, traço vazio ou estrelas vazias."

---

## 5. Migração de Dados Legados (`core/migration/avaliacoes.mjs`)

### 5.1 O Problema dos Dados Legados
O snapshot legado importado (`pipeline-vagas.json`) possui 185 vagas contendo o campo `empresa_avaliacao` embutido. O radar moderno não preenche mais esse campo diretamente no objeto da vaga.

### 5.2 Algoritmo de Migração
A função de migração `migrarAvaliacoesLegadas({ dataRoot, host, now })`:
1. Lê todos os eventos do `dataRoot` via `readEvents(dataRoot)`.
2. Projeta as vagas existentes (`projectEvents(eventos).vagas`).
3. Localiza todas as vagas com `vaga.empresa_avaliacao` que contenham `nota` e `empresa` válidas.
4. Agrupa por `empresa_chave = companyKey(vaga.empresa)`.
5. Para cada grupo de empresa, seleciona o registro de avaliação mais consistente (normalizando plataformas como `'glassdoor'` para `'Glassdoor'`, URLs legadas e datas).
6. Cria um evento `empresa.avaliada`:
   - `id`: `migracao:avaliacao:${empresa_chave}:${data}` (chave determinística garantindo idempotência total).
   - `ator`: `'migracao'`.
   - `entidade`: `'empresa'`.
   - `entidade_id`: `empresa_chave`.
   - `dados`:
     - `empresa`: nome da empresa
     - `empresa_chave`: chave calculada
     - `nota`: float arredondado para 1 casa decimal
     - `quantidade`: int
     - `plataforma`: normalizada para o enum
     - `data`: data da avaliação legada (ou data do pipeline se ausente)
     - `fontes`: `[{ url: vaga.url, plataforma: 'Glassdoor' }]` quando a fonte original no legado não possuía URL separada
     - `resumo`: resumo textual original
     - `validade_dias`: 90
7. Grava no log via `appendEvents(dataRoot, eventosNovos)`. Se rodado novamente, `appendEvents` descarta eventos com IDs já existentes sem erro.
8. **Teste de Não-Perda:** Um teste unitário dedicado confere que nenhuma das empresas que possuíam avaliação no legado deixa de gerar o evento e que a projeção subsequente preserva a avaliação da empresa em todas as vagas correspondentes.

---

## 6. Comandos CLI (`core/cli/empresa.mjs`)

Registrar em `core/cli/commands.mjs`:
```javascript
import { empresaCommands } from './empresa.mjs';
export const commands = { ...empresaCommands, ... };
```

### 6.1 Subcomando `empresa registrar`

Registro manual direto de uma avaliação de reputação de empresa.

#### Sintaxe
```bash
node bin/career-bounty.mjs empresa registrar \
  --empresa "Empresa Alfa" \
  --nota 4.3 \
  --quantidade 150 \
  --fonte "https://glassdoor.test/Overview/Working-at-Empresa-Alfa.htm" \
  [--plataforma Glassdoor] \
  [--resumo "Excelente ambiente para engenharia."] \
  [--data 2026-10-18] \
  [--validade 90]
```

#### Flags
- `--empresa <nome>`: Nome da empresa (obrigatório).
- `--nota <n>`: Nota de 1.0 a 5.0 (obrigatório).
- `--quantidade <q>`: Total de avaliações (obrigatório, inteiro `>= 0`).
- `--fonte <url>`: URL pública da fonte com a nota (obrigatório).
- `--plataforma <p>`: Opcional. Se omitida, infere a partir do domínio da `--fonte` (`glassdoor` -> `'Glassdoor'`, `indeed` -> `'Indeed'`, `catho` -> `'Catho'`, caso contrário `'Outro'`).
- `--resumo <txt>`: Resumo curto (opcional, até 500 caracteres).
- `--data <AAAA-MM-DD>`: Data da avaliação (opcional, padrão `localDay(now)`).
- `--validade <dias>`: Validade em dias (opcional, padrão `90`).
- `--now <ISO>`: Relógio injetável para testes.

#### Comportamento
1. Faz parse das flags e valida via `validarEmpresaAvaliada`.
2. Gera `empresa_chave = companyKey(empresa)`.
3. Monta o evento:
   - `id`: `avaliacao:${empresa_chave}:${data}:${randomUUID().slice(0, 6)}`
   - `tipo`: `'empresa.avaliada'`
   - `ator`: `'usuario'`
4. Grava via `appendEvents`.
5. Exibe confirmação amigável no terminal:
   `Avaliação registrada: [Glassdoor] Acme Corp — Nota: 4.3 (150 avaliações) | Validade: 90 dias`

---

### 6.2 Subcomando `empresa avaliar`

Coleta automatizada de reputação via subagente com busca na web pública.

#### Sintaxe
```bash
node bin/career-bounty.mjs empresa avaliar --empresa "Empresa Alfa" [--live] [--now <ISO>]
```

#### Princípio Operacional e Regras de Proteção Legal
1. **Zero Scraping de Glassdoor:** Jamais faz download direto, raspagem ou navegação na página HTML interna do Glassdoor. O subagente lê exclusivamente os **metadados e snippets públicos** fornecidos pelos resultados de busca na web.
2. **Fontes Obrigatórias com URL:** A saída do modelo deve extrair e citar a URL pública do resultado de busca (ex: página de visão geral do Glassdoor ou Indeed). Se não houver URL de fonte válida, a avaliação é **recusada** e nenhum evento é gravado.
3. **LLM Via Runner Padronizado:** A chamada de LLM passa exclusivamente por `core/llm/runner.mjs`, usando o agente `agents/avaliador-empresa.md`. Em ambiente de teste, utiliza os modos `fake` ou `replay`.

#### Definição do Agente (`agents/avaliador-empresa.md`)

```markdown
---
agente: avaliador-empresa
modelo: haiku
versaoPrompt: "1.0"
---

Você é o extrator de reputação e avaliações de empresas do CareerBounty.
Sua função é ler os resultados públicos de busca na web sobre a empresa fornecida e extrair a nota consolidada, quantidade de avaliações, plataforma e URL da fonte.

### Regras Mandatórias:
1. Responda SOMENTE com o JSON estrito conforme o contrato abaixo.
2. A URL da fonte é OBRIGATÓRIA. Se não houver link público nos resultados, retorne recusada: true.
3. A nota deve ser um número entre 1.0 e 5.0. Se for em escala diferente (ex: 10 ou 100), converta para 1.0 a 5.0.
4. Plataforma deve ser exatamente uma de: "Glassdoor", "Indeed", "Catho", "Outro".
5. Não faça suposições nem invente números que não estejam nos textos de busca.

### Schema de Resposta:
```json
{
  "sucesso": true,
  "empresa": "Empresa Alfa",
  "nota": 4.2,
  "quantidade": 120,
  "plataforma": "Glassdoor",
  "fontes": [
    {
      "url": "https://glassdoor.test/Overview/...",
      "plataforma": "Glassdoor"
    }
  ],
  "resumo": "Síntese em uma frase sobre o ambiente de trabalho e percepção dos funcionários.",
  "data": "AAAA-MM-DD"
}
```
Se não for possível encontrar nota e URL válidas:
```json
{
  "sucesso": false,
  "motivo": "Nenhuma avaliação com URL de fonte pública foi localizada para esta empresa."
}
```
```

#### Orquestração em `core/company/evaluator.mjs`
```javascript
export async function avaliarEmpresa({ empresa, dataRoot, runner, searchImpl, now = new Date() }) {
  // 1. Executa busca pública (mockável para testes unitários determinísticos)
  const query = `"${empresa}" avaliacao glassdoor OR indeed`;
  const resultadosBusca = await searchImpl(query);

  // 2. Chama runner com agente avaliador-empresa
  const resposta = await runner.chamar({
    agente: 'avaliador-empresa',
    modelo: 'haiku',
    versaoPrompt: '1.0',
    entrada: { empresa, resultados: resultadosBusca, data_atual: localDay(now) }
  });

  const parsed = JSON.parse(stripFence(resposta.texto));
  if (!parsed.sucesso) {
    throw new Error(`Avaliação recusada: ${parsed.motivo}`);
  }

  // 3. Valida contrato
  const chave = companyKey(empresa);
  const dados = {
    empresa,
    empresa_chave: chave,
    nota: parsed.nota,
    quantidade: parsed.quantidade,
    plataforma: parsed.plataforma,
    data: parsed.data ?? localDay(now),
    fontes: parsed.fontes,
    resumo: parsed.resumo,
    validade_dias: 90
  };

  const erro = validarEmpresaAvaliada(dados, now);
  if (erro) throw new Error(`Dados extraídos da avaliação inválidos: ${erro}`);

  // 4. Grava evento
  const evento = {
    id: `avaliacao:${chave}:${dados.data}:${randomUUID().slice(0, 6)}`,
    ts: new Date(now).toISOString(),
    ator: 'radar',
    tipo: 'empresa.avaliada',
    entidade: 'empresa',
    entidade_id: chave,
    dados
  };

  await appendEvents(dataRoot, [evento], { now: () => new Date(now).toISOString() });
  return dados;
}
```

---

## 7. Integração no `daily-run` e Configuração

### 7.1 Configuração em `core/config.mjs` (`config.yml`)

Adicionar nova seção em `defaultSettings()`:

```javascript
export function defaultSettings() {
  return {
    // ... configurações existentes ...
    avaliacoes: {
      teto_diario: 5,
      validade_dias: 90,
      aderencias_alvo: ['alta', 'boa'],
    },
  };
}
```

Validação em `validateSettings(raw)`:
```javascript
const avaliacoes = section(raw.avaliacoes, 'avaliacoes');
if (avaliacoes.teto_diario !== undefined) {
  if (!Number.isInteger(avaliacoes.teto_diario) || avaliacoes.teto_diario < 1) {
    throw invalid('avaliacoes.teto_diario', 'deve ser inteiro >= 1');
  }
  settings.avaliacoes.teto_diario = avaliacoes.teto_diario;
}
if (avaliacoes.validade_dias !== undefined) {
  if (!Number.isInteger(avaliacoes.validade_dias) || avaliacoes.validade_dias < 1) {
    throw invalid('avaliacoes.validade_dias', 'deve ser inteiro >= 1');
  }
  settings.avaliacoes.validade_dias = avaliacoes.validade_dias;
}
```

### 7.2 Lógica de Seleção no `daily-run`

No ciclo diário (`core/schedule/dailyRun.mjs` ou estágio sequencial subsequente em `core/cli/commands.mjs`):
1. **Filtro de Vagas Candidatas:**
   - Vagas ativas (não descartadas e com `url_status === 'aberta'`).
   - Aderência pertence a `aderencias_alvo` (`'alta'` ou `'boa'`).
2. **Identificação de Empresas sem Avaliação Válida:**
   - Agrupa as vagas por `companyKey(vaga.empresa)`.
   - Consulta a projeção de avaliações (`projectAvaliacoes`).
   - Se a empresa já possui avaliação válida (com `<= 90 dias`), ela é **ignorada**.
   - Se a empresa não tem avaliação ou a avaliação existente expirou (`> 90 dias`), ela é enfileirada.
3. **Respeito ao Teto Diário:**
   - Limita a lista de empresas a avaliar ao valor configurado em `avaliacoes.teto_diario` (padrão `5`).
4. **Execução Resiliente:**
   - Cada empresa é avaliada via subagente.
   - Falha na busca ou recusa de avaliação de uma empresa específica **não aborta** as demais nem a rotina diária; apenas gera um aviso no log.
5. **Comportamento em `--dry-run`:**
   - Reporta quais empresas seriam avaliadas sem executar chamadas de rede nem gravar eventos.
6. **Inclusão no Digest Diário (`core/score/digest.mjs`):**
   - Caso avaliações tenham sido concluídas no dia, o digest exibe a seção:
     ```markdown
     ## Avaliações de empresas da rodada (2)
     - Acme Corp: 4.2 (Glassdoor, 150 avaliações)
     - Beta Labs: 4.5 (Indeed, 80 avaliações)
     ```

---

## 8. Contratos de API (`docs/PAINEL-API.md`)

A rota `GET /api/vagas` (e a rota do painel `GET /api/candidaturas` quando devolver dados completos da vaga) expõe o campo `empresa_avaliacao` enriquecido pela projeção pura:

```json
{
  "id": "vaga-corp-tech-01",
  "empresa": "Empresa Alfa",
  "cargo": "Tech Lead",
  "aderencia": "alta",
  "empresa_avaliacao": {
    "nota": 4.2,
    "quantidade": 150,
    "plataforma": "Glassdoor",
    "data": "2026-10-18",
    "fontes": [
      {
        "url": "https://glassdoor.test/Overview/Working-at-Empresa-Alfa.htm",
        "plataforma": "Glassdoor"
      }
    ],
    "resumo": "Boa cultura técnica, liderança acessível e ambiente colaborativo."
  }
}
```

> **Atenção:** Se a empresa não tiver avaliação registrada ou a avaliação existente tiver mais de 90 dias de antiguidade, o campo `empresa_avaliacao` retorna `null` ou é omitido. A interface nunca recebe nota 0 ou campos vazios disfarçados.

---

## 9. Roteiro de Implementação TDD Passo a Passo

O engenheiro de software deverá seguir rigorosamente o ciclo Vermelho -> Verde -> Refatoração, sem pular etapas:

### Etapa 1: Regras e Validação de Schema
- **Arquivo de Teste:** `tests/unit/empresa-schema.test.mjs`
- **Arquivo de Código:** `core/store/rules.mjs`
- **Cenários a Cobrir:**
  - `validarEmpresaAvaliada`: aceita payload completo e válido.
  - Rejeita dados nulos, arrays ou tipos não-objeto.
  - Rejeita nome de empresa ausente ou vazio.
  - Rejeita chave de empresa ausente ou vazia.
  - Rejeita notas fora do intervalo [1.0, 5.0] e valores não-finitos (`NaN`, `Infinity`).
  - Rejeita quantidade de avaliações negativa ou fracionária.
  - Rejeita plataformas fora do enum permitido (`'Glassdoor'`, `'Indeed'`, `'Catho'`, `'Outro'`).
  - Rejeita data malformada ou data futura em relação ao dia corrente de São Paulo.
  - Rejeita avaliação sem array `fontes` ou com lista vazia.
  - Rejeita fontes sem URL ou com URL sem protocolo `http`/`https`.
  - Rejeita resumo com mais de 500 caracteres.
  - Valida campo opcional `validade_dias` (padrão 90 se omitido; rejeita inteiros < 1).

### Etapa 2: Projeção Pura de Avaliações
- **Arquivo de Teste:** `tests/unit/empresa-projecao.test.mjs`
- **Arquivo de Código:** `core/store/projections/avaliacoes.mjs`
- **Cenários a Cobrir:**
  - `projectAvaliacoes`: projeta corretamente eventos `empresa.avaliada`.
  - Agrupa múltiplas avaliações sob a mesma `empresa_chave` normalizada.
  - Ordena histórico de avaliações por data decrescente.
  - Calcula `valida: true` para avaliação com data recente (ex.: 10 dias atrás com validade 90).
  - Calcula `valida: false` e `expirada: true` para avaliação com mais de 90 dias.
  - Função auxiliar `obterAvaliacaoVigente`: retorna dados da avaliação quando válida e `null` quando expirada ou inexistente.
  - Desempate estável quando há duas avaliações registradas na mesma data.

### Etapa 3: Integração na Projeção de Vagas
- **Arquivo de Teste:** `tests/unit/empresa-vaga-integracao.test.mjs`
- **Arquivo de Código:** `core/store/project.mjs`
- **Cenários a Cobrir:**
  - Vaga cuja empresa possui evento `empresa.avaliada` válido recebe `empresa_avaliacao` preenchido.
  - Vaga cuja empresa possui avaliação expirada (> 90 dias) NÃO recebe `empresa_avaliacao`.
  - Diferentes grafias da mesma empresa (ex: `"Empresa Alfa"` e `"Empresa Alfa S.A."` se mapeadas pelo mesmo `companyKey`) recebem a mesma avaliação consolidada.
  - Projeção preserva imutabilidade do pipeline e não afeta outras propriedades da vaga.

### Etapa 4: Migração das Vagas Legadas
- **Arquivo de Teste:** `tests/unit/empresa-migracao.test.mjs`
- **Arquivo de Código:** `core/migration/avaliacoes.mjs`
- **Cenários a Cobrir:**
  - Converte dados de `empresa_avaliacao` embutidos em vagas para eventos `empresa.avaliada`.
  - Deduplica avaliações idênticas para a mesma empresa.
  - Normaliza plataformas legadas (minúsculas -> maiúsculas).
  - Idempotência: rodar a migração duas vezes gera os mesmos IDs de evento e o segundo passe resulta em 0 novos eventos gravados.
  - Teste de não-perda: todas as 185 vagas legadas (ou fixture sintética equivalente) mantêm suas avaliações acessíveis via projeção após a migração.

### Etapa 5: Agente e Comandos CLI
- **Arquivo de Teste:** `tests/unit/empresa-cli.test.mjs`
- **Arquivos de Código:** `core/cli/empresa.mjs`, `core/cli/commands.mjs`, `core/company/evaluator.mjs`, `agents/avaliador-empresa.md`
- **Cenários a Cobrir:**
  - `empresa registrar`:
    - Registra avaliação manual com flags `--empresa`, `--nota`, `--quantidade`, `--fonte`.
    - Detecta plataforma automaticamente a partir do domínio da URL.
    - Grava evento `empresa.avaliada` no log.
    - Rejeita e exibe erro amigável se faltar qualquer flag obrigatória.
  - `empresa avaliar`:
    - Executa busca pública simulada com runner em modo `fake`.
    - Extrai JSON validado contendo nota, quantidade, plataforma e URL da fonte.
    - **Rejeita terminantemente a avaliação se o subagente não devolver ao menos uma URL válida.**
    - Garante que nenhuma chamada HTTP direta é disparada contra domínios do Glassdoor.

### Etapa 6: Automação no `daily-run` e Configuração
- **Arquivo de Teste:** `tests/unit/empresa-daily-run.test.mjs`
- **Arquivos de Código:** `core/config.mjs`, `core/schedule/dailyRun.mjs`, `core/score/digest.mjs`
- **Cenários a Cobrir:**
  - `validateSettings`: aceita e valida `avaliacoes.teto_diario` e `avaliacoes.validade_dias`.
  - `daily-run`:
    - Seleciona apenas empresas de vagas ativas com aderência `alta` ou `boa` que não tenham avaliação válida vigente.
    - Respeita rigorosamente o teto diário (ex.: se houver 8 empresas candidatas e o teto for 3, avalia apenas as primeiras 3).
    - Não avalia empresas que já possuam avaliação recente (< 90 dias).
    - Não quebra a rotina diária se a avaliação de uma empresa falhar.
    - No modo `--dry-run`, lista as empresas selecionadas sem realizar chamadas de LLM nem gravar eventos.
    - O digest diário reflete as avaliações realizadas na rodada.

---

## 10. Atualizações Documentais Mandatórias

Ao concluir a implementação da fatia:
1. **`docs/PAINEL-API.md`:** Adicionar a descrição e payload de exemplo da chave `empresa_avaliacao` em `GET /api/vagas`.
2. **`docs/GLOSSARY.md`:** Acrescentar as entradas:
   - `Avaliação de empresa`
   - `Evento empresa.avaliada`
   - `Validade de avaliação`
3. **`CHANGELOG.md`:** Registrar entrada na versão corrente.
4. **`F9-LOG.md`:** Registrar a entrada da fatia F9.4 com commit, branch, testes executados e resultado de cobertura.
