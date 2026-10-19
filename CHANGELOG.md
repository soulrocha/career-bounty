# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento semântico; antes da 1.0,
mudanças de comportamento podem acontecer entre versões menores.

## [Unreleased]

### Adicionado

- **F9.6 — Preparação para Entrevista (`preparar-entrevista`):**
  - Implementação da infraestrutura técnica e de contratos para geração do dossiê estratégico de preparação para entrevista de emprego para vagas específicas.
  - Quatro pilares centrais: (1) Pontos Fortes comprovados com evidências documentais factuais (`verificado`, `entregue`), (2) Pontos Fracos e Lacunas com estratégias de defesa honesta e postura de transparência, (3) Perguntas Prováveis & Histórias estruturadas no padrão STAR (Situação, Tarefa, Ação, Resultado), e (4) Limites de credibilidade com alertas explícitos de "O que NÃO alegar" (relatos não comprovados, itens não publicáveis, termos confidenciais a anonimizar e lacunas críticas).
  - Evento append-only auditável `entrevista.preparada` com validação estrita em `core/store/rules.mjs` e projeção pura em `core/store/projections/entrevistas.mjs`.
  - Módulo puro `core/interview/preparation.mjs` para geração determinística, formatação em Markdown estruturado persistido em `outbox/entrevistas/` e roteiro interativo de simulação de treino com Claude (`gerarRoteiroSimulacao`).
  - Comandos CLI em `core/cli/entrevista.mjs`: `entrevista preparar --vaga <id>` (com avaliação sob demanda caso a vaga ainda não possua requisitos) e `entrevista simular --vaga <id>`, com alias de topo `preparar-entrevista` em `core/cli/commands.mjs`. Preservação integral de 100% dos subcomandos legados da entrevista investigativa de lacunas.
  - Endpoint HTTP local autenticado `GET /api/entrevistas/preparacao?vaga=<id>` em `panel/server.mjs` com proteção anti-CSRF, checagem de avaliação prévia (422) e mascaramento estrito de PII e redação de identidade.
- **F9.5 — Análise do Currículo contra a Base (`analise-curriculo`):**
  - Modernização e padronização da matriz de 2x2 com identificadores semânticos estáveis nos quatro grupos: `confere`, `sem_prova`, `fora_do_cv` e `lacuna`.
  - Modelo de dados uniforme determinístico com 9 campos (`id`, `grupo`, `tipo_origem`, `texto`, `afirmacoes`, `evidencias`, `nivel_prova`, `motivo`, `pergunta`, `peso`, `status`).
  - Projeção pura em `core/store/projections/analiseCurriculo.mjs` com mapa inverso de evidências e totalizadores determinísticos.
  - Novos eventos append-only auditáveis: `analise.afirmacao_incluida`, `analise.item_marcado` e `analise.lacuna_entrevista`.
  - Comandos de CLI em `core/cli/analise.mjs`: `analise listar`, `analise incluir`, `analise marcar` e `analise lacuna` (geração de rascunho em `outbox/lacunas/`).
  - Endpoints HTTP autenticados no servidor local do painel (`panel/server.mjs`): `GET /api/analise-curriculo` com mascaramento estrito de PII e redação de identidade, e `POST /api/analise-curriculo/incluir`, `POST /api/analise-curriculo/marcar` e `POST /api/analise-curriculo/entrevista` com estrita proteção contra CSRF e modo sombra.
- **F9.1 — Contatos com Recrutadores:**
  - Registro de interações e contatos avulsos (`contato registrar`).
  - Projeção pura com ordenação cronológica e agrupamento por vaga e pessoa (`projectContatos`).
  - Associação de contatos avulsos a vagas (`contato vincular`).
  - Listagem com filtros por vaga e por contatos ativos (`contato listar`).
  - Sugestão de respostas seguras via LLM gravando rascunho em outbox sem envio automático (`contato sugerir`).
  - Motor de mascaramento estrito de PII para telefones e e-mails (`core/privacy/mask.mjs`).
  - Endpoint HTTP local autenticado: `GET /api/contatos` com mascaramento anti-vazamento.
- **F9.4 — Avaliação da Empresa:**
  - Registro de eventos `empresa.avaliada` no log append-only com schema estrito (`empresa registrar`).
  - Projeção pura e determinística com cálculo de vigência temporal de 90 dias (`projectAvaliacoes`, `obterAvaliacaoVigente`).
  - Enriquecimento dinâmico de vagas no `projectEvents` com remoção automática de notas expiradas (nunca exibe nota 0 ou traço).
  - Migração idempotente e determinística das avaliações do snapshot legado (`core/migration/avaliacoes.mjs`).
  - Coleta automatizada via subagente LLM com leitura exclusiva de busca pública e citação obrigatória de URL pública (`agents/avaliador-empresa.md`, `core/company/evaluator.mjs`, `empresa avaliar`). Zero scraping do Glassdoor.
  - Seleção inteligente e execução diária no `daily-run` com teto configurável (`avaliacoes.teto_diario`, `avaliacoes.validade_dias`) e inclusão na seção de novidades do digest diário.
  - Documentação da API com chave `empresa_avaliacao` em `GET /api/vagas`.

## [0.2.0] - 2026-10-18

Primeira versão para uso real.

### Adicionado

- `setup` agora deixa uma instalação nova pronta: estado ativo, projeção vazia, painel e coleta funcionando.
  `setup --com-legado` preserva o caminho de quem vai migrar um pipeline antigo.
- `demo`: monta uma pasta descartável com uma persona fictícia e seis vagas de exemplo para experimentar o painel sem
  tocar nos seus dados.
- Envio automático por política em formulários públicos (Greenhouse, Lever, Ashby): regras validadas, limite diário por
  regra e global, driver sem login nem cookies, kill switch (`envio pausar|retomar|audit`), aprovação amarrada ao hash do
  PDF e das respostas e desfecho incerto que trava a vaga. Desligado por padrão.
- `migrate --corte`: sai do modo sombra só se o legado em disco ainda é o que foi importado.
- README profissional (português e inglês), `docs/PRONTIDAO.md` e este changelog.

### Corrigido

- Testes do painel usavam a data em UTC e falhavam entre 21h e 24h em São Paulo.
- Envio automático (achados da revisão independente do PR #8): contexto ausente passa a negar a política; o driver só
  aceita `https` nas origens do portal e reconfere a origem antes do clique; o kill switch e o token são conferidos de
  novo logo antes do clique; o PDF é reconferido por hash na hora do clique; resultado incerto ou sem comprovante
  consome o limite e impede reenvio; o limite global passa a valer; `dryRun` é o padrão do orquestrador.
- `hooks/pre-tool-use`: espera a negação ser escrita antes de sair.
- `envio audit`: valida `--dia` e informa com clareza se o envio está pausado.
- `doctor`: instalação nova e `career-ops` ausente deixam de ser avisos.
- CI: actions fixadas por SHA de commit; `id` escapado na regex de `aprovarPendente`.

## [0.1.0] - 2026-10-17

Fatias F0 a F6: fundação e pacote público, migração em modo sombra, radar e fontes, e-mail pelo conector do Gmail,
base de carreira (quadrantes, entrevista e mentor), currículos com gates e candidatura assistida, incluindo perfil e
candidatura na Gupy.
