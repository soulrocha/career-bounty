# Arquitetura

CareerBounty é um plugin de Claude Code com núcleo determinístico em Node. Decisões em `docs/adr/`;
vocabulário em `docs/GLOSSARY.md`.

## Camadas

### Interface

Comandos (`commands/`), skills, painel local (`panel/`) e hooks (`hooks/`). Entradas finas: chamam
a CLI `bin/career-bounty.mjs` ou delegam a subagentes.

### Subagentes

`agents/`, cada um com `model:` e lista explícita de ferramentas. Agentes de leitura (triador,
classificador de e-mail) não têm ferramenta de escrita. O modelo escolhe identificadores de
afirmações e devolve JSON validado; não escreve fatos.

### Núcleo determinístico

`core/`: `store` (event log, lock, projeções), `kb` (fontes de conhecimento), `privacy` (pre-commit,
varredura), `plugin` (validação do pacote), `doctor`, `apply`, `migration`. Tudo testável sem rede e sem
modelo.

### Dados

`DATA_ROOT` (padrão `~/.career-bounty`), fora do git: `config.yml`, `identity.yml`, `secrets/`, `kb/`,
`events/`, `state/`, `projections/`, `artifacts/`, `cache/`, `outbox/`, `templates/`.

## Seams de teste

Testes vivem nestas fronteiras públicas, nunca em detalhes internos.

| Seam | Interface pública testada |
|---|---|
| S1 | CLI: `bin/career-bounty.mjs <subcomando> --json` (JSON no stdout e código de saída) |
| S2 | Store: `appendEvent`, `readEvents`, `project()` |
| S3 | Source: `Source.collect({janela, config})` devolve vagas |
| S4 | LlmRunner: `run({agente, modelo, versaoPrompt, entrada})`, modos fake, replay e live |
| S5 | KnowledgeSource: `claims()`, `evidence()`, `identity()` |
| S6 | Painel HTTP: `GET/POST /api/*` |
| S7 | PolicyEngine: `evaluate(candidatura, regras, estadoDoDia)` |
| S8 | Driver: `submit(alvo, payload)` |
| S9 | Hook: CLI que lê JSON do hook no stdin e devolve decisão |
| S10 | Contrato do leitor de e-mail: JSON `MailDigest` e `MailFull` |
| S11 | Rotina diária: `shouldRun({now, ultimaExecucao, calendario, host})` |

Estado atual: S1, S5 e S6 (em modo sombra) têm implementação; os demais entram nas fatias seguintes.

## Isolamento de modelo

O modelo e o conector de e-mail nunca rodam em `npm test`. O contrato é JSON validado por schema;
os testes usam saídas fabricadas, o fluxo com fake e gravações reproduzíveis.

## Privacidade por construção

Nada pessoal no git: `.gitignore` restritivo, pre-commit (`core/privacy`), persona fictícia em
`examples/persona-ficticia/`, e testes que falham se aparecer caminho de usuário, IP privado ou
empresa fora da lista fictícia.
