# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento semântico; antes da 1.0,
mudanças de comportamento podem acontecer entre versões menores.

## [Unreleased]

### Adicionado

- **F9.1 — Contatos com Recrutadores:**
  - Registro de interações e contatos avulsos (`contato registrar`).
  - Projeção pura com ordenação cronológica e agrupamento por vaga e pessoa (`projectContatos`).
  - Associação de contatos avulsos a vagas (`contato vincular`).
  - Listagem com filtros por vaga e por contatos ativos (`contato listar`).
  - Sugestão de respostas seguras via LLM gravando rascunho em outbox sem envio automático (`contato sugerir`).
  - Motor de mascaramento estrito de PII para telefones e e-mails (`core/privacy/mask.mjs`).
  - Endpoint HTTP local autenticado: `GET /api/contatos` com mascaramento anti-vazamento.

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
