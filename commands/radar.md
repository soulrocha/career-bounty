---
description: Roda o radar de vagas (coleta, dedup e filtros) e mostra o digest da rodada
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" collect --dry-run --json` para ver o que há de novo sem gravar nada.
Para gravar, rode o mesmo comando sem `--dry-run`. Depois rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" digest`
e mostre o resultado. Fonte com erro aparece como "não conferida", nunca como "sem vagas".
