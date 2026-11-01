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
| S12 | Base central: `sync-remote <op> --raiz` (quadros no stdin/stdout) e `planejar({local, remoto, base})` |

Estado atual: S1, S5 e S6 (em modo sombra) têm implementação desde a F1. A F2 acrescentou S3 (fontes de vagas em `core/sources/`), S4 (`core/llm/runner.mjs` com fake, replay e live), S9 (`hooks/`) e S11 (`core/schedule/`). A F3 trouxe S10 (`core/mail/contract.mjs`). A F7 trouxe S7 (`core/apply/policy/evaluate.mjs`, função pura `avaliarPolitica`) e S8 (`core/apply/drivers/`, `executarDriver` com navegador efêmero e sem modelo). A F11 trouxe S12 (`core/sync/`, base central por SSH; ver `docs/SYNC.md`).

## Painel: desvio deliberado do contrato

O painel mantém `/api/candidaturas` (GET e POST) com o formato do cliente legado, em vez de um nome novo
por recurso. Motivo: o HTML do legado e o template público já chamam essa rota; renomear quebraria o
painel antigo durante a sombra. A rota continua protegida por Host local, Origin, token efêmero e limite de
tamanho. `/api/status` informa o modo real (`shadow` ou `ativo`). Toda resposta leva CSP restritiva
(sem origem externa), `Referrer-Policy: no-referrer`, `X-Frame-Options` e `nosniff`.

## Migração: regras de segurança

- Em modo `ativo` o painel grava marcações como evento; por isso `migrate` (com ou sem `--shadow`) e
  `migrate --from` recusam reimportar, e nunca devolvem o modo para `shadow`. Para voltar à sombra, faça o
  rollback antes. Estado ilegível também bloqueia (falha fechada).
- Snapshots em `backups/`: só os `backups_retidos` mais recentes ficam (padrão 3; o do estado atual nunca
  é apagado). Se nada mudou, o snapshot existente é reaproveitado e nada é copiado.
- Vaga que sumiu do legado nunca é apagada. Por padrão a importação recusa; `--aceitar-ausentes` aceita a
  diferença e lista os IDs em `ausentes_aceitas`.
- `migrate --rollback --out <legado> --confirmo-vault` copia o legado atual para `rollback-backups/`, respeita o
  lock do legado e recusa se o legado mudou depois da última importação.
- Locks de arquivo: arquivo vazio ou JSON inválido (após 2 s), dono morto, lock com mais de 30 min ou PID
  reaproveitado (processo que começou depois do lock) são recuperados.
- `perfil.pdfs_base[].href` deve ser `curriculos/<arquivo>.pdf` e o arquivo precisa estar em `panel.base_files`.
  Portais privados de recrutamento entram em `portais_extras` no `config.yml`, nunca no código.

## Isolamento de modelo

O modelo e o conector de e-mail nunca rodam em `npm test`. O contrato é JSON validado por schema;
os testes usam saídas fabricadas, o fluxo com fake e gravações reproduzíveis.

## Privacidade por construção

Nada pessoal no git: `.gitignore` restritivo, pre-commit (`core/privacy`), persona fictícia em
`examples/persona-ficticia/`, e testes que falham se aparecer caminho de usuário, IP privado ou
empresa fora da lista fictícia.
