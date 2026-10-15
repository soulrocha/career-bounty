# CareerBounty <!-- sec:titulo -->

Claude Code plugin that organizes job search and applications. Read the
[legal disclaimer](LEGAL_DISCLAIMER.md) first: you answer for each site's terms of use and
automatic sending ships turned off. Portugues: [README.md](README.md).

## What it is <!-- sec:o-que-e -->

A Node CLI plus a set of Claude Code commands and agents. Your data lives in a private folder
outside the repository (`DATA_ROOT`); the repository only carries code, documentation and a
fictional example persona.

## Installation <!-- sec:instalacao -->

Requires Node 20 or newer. No npm dependencies.

```sh
git clone <this repository's address>
cd career-bounty
npm install
npm test
```

In Claude Code: `/plugin install career-bounty --marketplace soulrocha/career-bounty`.

## Quick start <!-- sec:inicio-rapido -->

```sh
node bin/career-bounty.mjs setup
node bin/career-bounty.mjs doctor
```

`setup` creates the private folder skeleton; `doctor` reports what is missing without changing anything.

## Configuration <!-- sec:configuracao -->

`DATA_ROOT` points to the private folder (default `~/.career-bounty`). Personal configuration
lives only in `DATA_ROOT/config.yml` (valid JSON). See `config.example.yml`. Safe defaults:
manual sending and the LinkedIn guest collector turned off.

## Privacy <!-- sec:privacidade -->

Nothing personal enters git. See [PRIVACY.md](PRIVACY.md). A pre-commit hook blocks CPF numbers,
phone numbers, user paths, your identity values and companies on your denylist.

## Development <!-- sec:desenvolvimento -->

`npm test` runs the suite (`node --test`). See [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License <!-- sec:licenca -->

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
