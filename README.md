# CareerBounty

Projeto de plugin para Claude Code voltado à organização de candidaturas.

Estado: CLI inicial e migração de dados com backup verificado, log de eventos,
projeção, exportação de rollback e painel de consulta em modo sombra.
O pacote do plugin ainda não foi validado para instalação.

Com Node >=20, execute `npm test`. Não há dependências para instalar.

```sh
node bin/career-bounty.mjs --version
node bin/career-bounty.mjs --version --json
node bin/career-bounty.mjs migrate --dry-run --diff --json
node bin/career-bounty.mjs migrate --json
node bin/career-bounty.mjs verify --json
node bin/career-bounty.mjs panel --port 8880
```

Os comandos de migração e painel exigem configuração privada. O modo sombra
mantém o sistema de origem como fonte de verdade e bloqueia gravações pelo painel.

Consulte [docs/SETUP.md](docs/SETUP.md) para o escopo desta preparação e a retomada.
