# CareerBounty <!-- sec:titulo -->

Claude Code plugin that runs a job search end to end: it finds openings, scores the fit, builds tailored resumes,
prepares applications and tracks each hiring process through your e-mail, with you approving whatever goes out in
your name.

Read the [legal disclaimer](LEGAL_DISCLAIMER.md) first: you answer for each site's terms of use, and automatic
sending ships turned off. Português: [README.md](README.md).

## What it is <!-- sec:o-que-e -->

CareerBounty combines three pieces:

- **A Node CLI** (`bin/career-bounty.mjs`) holding all deterministic logic: collection, deduplication, scoring,
  resumes, sending policy and audit trail. It works and is tested without network or model.
- **Claude Code commands, skills and subagents** that do the language work (triage, answer drafting, e-mail
  classification) and call the CLI for everything that must be exact.
- **A local panel** in the browser, showing openings, the application queue, pending questions and career quadrants.

Your data lives in a private folder outside the repository (`DATA_ROOT`). The repository only carries code,
documentation and a fictional example persona.

## How it works <!-- sec:como-funciona -->

```text
 job sources ──► radar ──► triage and score ──► panel (Vagas)
                                │
 career base (kb) ──────────────┼──► resume per opening (2 PDFs + gates)
                                │
                                ▼
                     application queue ──► prepare in the browser ──► you approve the batch ──► send
                                                  │                                              │
                                new questions ──► panel (Perguntas)                         receipt
                                                                                                 │
 Gmail (read only) ──► e-mail classification ──► hiring stage ◄─────────────────────────────────┘
```

1. **Radar.** Collects openings from public job boards and alerts, removes duplicates and applies hard filters
   (location, work model, seniority). A failing source shows as "not checked", never as "no openings".
2. **Triage.** A subagent compares the opening with your claim base and returns a score and reasons as validated
   JSON. The model picks among existing claims; it does not invent facts.
3. **Resume.** For each opening it builds a visual PDF and an ATS PDF from your claims, with gates that block
   numbers without evidence, facts outside the base and text over the limit.
4. **Application.** Opens the opening in a new Chrome tab, fills the form from the answer bank and stops before
   sending. Questions without an answer go to the panel. Sending only happens after you type the exact batch phrase
   in the chat ("enviar estas N: ...").
5. **Tracking.** Reads hiring e-mails through the Gmail connector, with no write permission, and updates each
   application's stage.

Everything becomes an event in an append-only log (`DATA_ROOT/events`). Panel and reports are projections of that
log, so any state can be rebuilt and audited.

## Requirements <!-- sec:requisitos -->

- Node 20 or newer. No npm dependencies.
- Claude Code, with the Claude in Chrome extension for applications and portal profiles.
- Google Chrome or Microsoft Edge installed: PDFs come from the browser's own headless mode.
- Optional: the Gmail connector in Claude Code, for e-mail tracking.

## Installation <!-- sec:instalacao -->

```sh
git clone <this repository's address>
cd career-bounty
npm test
```

In Claude Code, install the plugin from the marketplace:

```text
/plugin install career-bounty --marketplace soulrocha/career-bounty
```

## First steps <!-- sec:primeiros-passos -->

1. **Create the private folder.** `node bin/career-bounty.mjs setup` builds the `DATA_ROOT` skeleton
   (default `~/.career-bounty`).
2. **Configure.** Copy `config.example.yml` to `DATA_ROOT/config.yml` and adjust it. The file is written as JSON
   (a YAML subset).
3. **Feed the career base.** Put your notes in `DATA_ROOT/kb` or list other sources in `DATA_ROOT/fontes.yml`, then
   run `kb sync`. Gaps become questions with `/entrevista`. Details in [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md).
4. **Build the resume profile.** Create `DATA_ROOT/cv/perfil.json` (contact, header, optional photo and section
   order). The format is in [docs/CV.md](docs/CV.md).
5. **Check.** `node bin/career-bounty.mjs doctor` lists what is missing, without changing anything.

## Daily use <!-- sec:uso -->

### Job radar <!-- sec:uso-radar -->

`/radar` runs collection, deduplication and filters and shows the round summary. From the CLI: `collect --dry-run`
shows what is new without writing, `collect` writes and `digest` summarizes. `schedule` generates the Windows
scheduled task that runs the radar once a day. Sources are listed in [docs/SOURCES.md](docs/SOURCES.md).

### Panel <!-- sec:uso-painel -->

`/painel` (or `panel`) opens the panel at `http://127.0.0.1:8880`. It only accepts access from the same machine and
requires a token for writes. Tabs:

| Tab | Purpose |
|---|---|
| Vagas | List, score, reasons, generated resumes and status marks |
| Fila | Openings eligible for application, with route (ATS driver, Gupy or assisted) and attempt state |
| Perguntas | New questions from applications: you answer or approve the draft, and the answer joins the bank |
| Quadrantes | Fit between what the market asks for and what your resume proves |

### Resumes <!-- sec:uso-cv -->

`cv gerar --vaga <id>` produces the opening's two PDFs in `DATA_ROOT/artifacts/cv/<vaga>/<hash>/` and runs the
gates. `cv gate --vaga <id>` re-evaluates an existing version. A blocked version is never offered for upload. For
portals that use the profile as the resume, `cv perfil-portal` proposes the profile text.

### Applications <!-- sec:uso-candidaturas -->

`/aplicar` works the queue in short batches:

1. `apply plan` picks the eligible openings and each one's route.
2. For each opening, the agent opens a new tab, runs the field extractor and `apply preparar`, which matches every
   field against the answer bank. Sensitive data (salary, documents, disability) is left for you to fill.
3. `apply lote` builds the batch phrase. Only when you type it in the chat does the hook allow the send click, one
   opening at a time, with an approval that expires in 2 hours and works once.
4. `apply comprovante` and `apply desfecho` record the outcome and the receipt.

Login, captcha and two-step verification stop the opening and hand the tab back to you.

### Gupy <!-- sec:uso-gupy -->

On Gupy the profile is the resume. Two skills handle it:

- **`gupy-perfil`** reads your profile, proposes changes item by item and only saves the item you approve with
  "aprovar perfil <hash>". See [docs/GUPY-PERFIL.md](docs/GUPY-PERFIL.md).
- **`gupy-candidatar`** answers the opening's questions and stops before tests, videos and scheduling.

The Gupy route requires `"gupy": { "aceite_termos": true }` in `config.yml` and respects the daily cap
`gupy.max_por_dia` (default 5).

### E-mail and tracking <!-- sec:uso-email -->

`/email` reads hiring messages through the Gmail connector and updates each application's stage (applied, new stage,
interview, offer or closed). A hook denies every Gmail write tool.

### Career: quadrants, interview and mentor <!-- sec:uso-carreira -->

- `/quadrantes` computes the fit between what openings ask for and what you prove, and saves the report.
- `/entrevista` asks about the gaps in your base. Each answer becomes a claim you approve.
- `/mentor` talks about funnel, positioning and next steps, read only.

## Commands <!-- sec:comandos -->

Claude Code commands:

| Command | What it does |
|---|---|
| `/setup` | Creates the `DATA_ROOT` skeleton |
| `/doctor` | Diagnoses the environment without changing anything |
| `/radar` | Collects, deduplicates, filters and summarizes openings |
| `/painel` | Opens the local panel |
| `/aplicar` | Assisted application on the eligible queue |
| `/email` | Tracks hiring processes through Gmail |
| `/quadrantes` | Fit report |
| `/entrevista` | Gap interview for the career base |
| `/mentor` | Career conversation |

CLI subcommands (`node bin/career-bounty.mjs <command> [--json]`):

| Group | Subcommands |
|---|---|
| Environment | `setup`, `doctor`, `help`, `plugin validate`, `privacy scan` |
| Openings | `collect`, `digest`, `daily-run`, `schedule`, `destinos`, `compare-radar` |
| Career base | `kb`, `quadrantes`, `entrevista`, `mentor`, `report` |
| Resumes | `cv gerar`, `cv gate`, `cv perfil-portal` |
| Applications | `apply plan`, `apply preparar`, `apply lote`, `apply envio`, `apply comprovante`, `apply desfecho` |
| Gupy | `gupy perfil iniciar`, `propor`, `confirmar`, `encerrar` |
| E-mail | `mail` |
| Data | `migrate`, `project`, `verify`, `panel`, `eval` |

With `--json`, output, errors included, goes to stdout as JSON. Usage errors exit with code 2.

## Configuration <!-- sec:configuracao -->

Personal configuration lives only in `DATA_ROOT/config.yml`. See `config.example.yml`. Defaults are safe:

| Key | Default | Effect |
|---|---|---|
| `envio.padrao` | `parar_antes_de_enviar` | Every application stops before the final click |
| `envio.regras` | `[]` | Per-portal automatic sending rules (in development) |
| `gupy.aceite_termos` | `false` | Without acceptance, the Gupy route refuses |
| `gupy.max_por_dia` | `5` | Daily cap of Gupy sends |
| `cv_skip_portals` | `["gupy"]` | Portals that get no attached PDF |
| `fontes.linkedin_guest.ativo` | `false` | LinkedIn guest collector turned off |
| `panel.port` | `8880` | Local panel port |

## Architecture <!-- sec:arquitetura -->

| Layer | Where | Role |
|---|---|---|
| Interface | `commands/`, `skills/`, `panel/`, `hooks/` | Thin entry points: call the CLI or delegate to subagents |
| Subagents | `agents/` | Language work with explicit model and tools; return validated JSON |
| Core | `core/` | Deterministic logic, testable without network or model |
| Data | `DATA_ROOT` | Configuration, base, events, projections and artifacts, outside git |

Core modules:

| Module | Responsibility |
|---|---|
| `store` | Event log, locks and projections |
| `sources`, `radar`, `dedup`, `score` | Collection, deduplication, filters and scoring |
| `kb` | Knowledge sources and claims |
| `cv` | Claim selection, rendering, PDFs and gates |
| `apply` | Queue, answer bank, filling, approval, policy and drivers |
| `browser` | Minimal CDP client for Chrome or Edge, without Playwright |
| `mail` | E-mail contract, classification and effects |
| `llm` | Subagent runs in fake, replay and live modes |
| `hooks` | Claude Code hook decisions |
| `privacy`, `plugin`, `doctor` | Privacy scan, package validation and diagnostics |
| `migration`, `schedule`, `eval` | Legacy import, daily routine and agent evaluation |

Hooks are the safety barrier. They do not rely on the model obeying:

- **PreToolUse:** denies Gmail writes. On an application tab it denies coordinate clicks, Enter and any script that
  is not CareerBounty's, and allows sending only with an unexpired approval. On a profile tab it allows only the approved
  item.
- **PostToolUse:** records what the page actually showed (Gupy stage, profile read). The model does not declare
  these states.
- **UserPromptSubmit:** recognizes the batch phrase and the profile approval, typed by you.
- **SessionStart:** summarizes pending items when a session opens.

Design decisions are in [docs/adr/](docs/adr/), and the layers and test seams are detailed in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Safety and limits <!-- sec:seguranca -->

- Sending never happens without the batch phrase typed by you. An approval covers one opening, for 2 hours, once.
- An attempt with an uncertain result is not retried: it stays pending until e-mail or you confirm it.
- Tests, videos and scheduling always stay with you.
- The panel only listens on loopback, with a strict CSP and an ephemeral token.
- The model never runs in `npm test`; tests use fabricated outputs and reproducible recordings.

## Privacy <!-- sec:privacidade -->

Nothing personal goes into git. A pre-commit hook blocks CPF, phone numbers, user paths, values from your identity
and companies on your denylist, and `privacy scan --all` scans the whole repository. See [PRIVACY.md](PRIVACY.md).

## Project status <!-- sec:estado -->

| Part | Status |
|---|---|
| Foundation, shadow-mode migration, radar, career base and e-mail | Implemented |
| Resumes with gates | Implemented |
| Assisted application, panel questions, and Gupy profile and application | Implemented |
| Policy-based automatic sending (ATS forms) | In development |
| Migration cutover (CareerBounty becomes the official writer) | Pending |

While the migration is in shadow mode, real collection and the daily routine only run with `--dry-run`, and the
panel refuses writes.

## Development <!-- sec:desenvolvimento -->

`npm test` runs the suite with `node --test`. Each slice starts with the test that proves its acceptance criterion.
See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [docs/SETUP.md](docs/SETUP.md).

## License <!-- sec:licenca -->

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
