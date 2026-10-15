---
description: Roda o radar de vagas (coleta, dedup e filtros) e mostra o digest da rodada
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" collect --dry-run --json` para ver o que há de novo sem gravar nada.
Para gravar, rode o mesmo comando sem `--dry-run`. Depois rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" digest`
e mostre o resultado. Fonte com erro aparece como "não conferida", nunca como "sem vagas".

Enquanto a migração estiver em modo sombra (`state/migration.json` com `mode: shadow`), a coleta real recusa gravar e o
`daily-run` não roda: avise a pessoa em vez de tentar contornar. Só `--dry-run` funciona nesse modo.
Vaga aplicada ou descartada no legado que não puder ser reconhecida por endereço aparece como "pendente de conferência", nunca como nova.
