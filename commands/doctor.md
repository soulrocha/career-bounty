---
description: Diagnostica o ambiente do CareerBounty e diz o que falta, sem alterar nada
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" doctor --json` e resuma o resultado
em português: o que está ok, o que é aviso e o que falha, com a próxima ação para cada falha.
