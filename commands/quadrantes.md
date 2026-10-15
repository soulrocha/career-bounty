---
description: Calcula os quadrantes dado x currículo e grava o relatório em DATA_ROOT/reports
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" quadrantes --json` e resuma para a pessoa só os números:
(a) dado e CV conferem, (b) dado fora do CV, (c) CV sem dado e (d) lacunas, mais o caminho do relatório gravado em
`DATA_ROOT/reports`. O relatório é privado: não copie o conteúdo dele para arquivos do repositório nem para o Vault.

Para os bullets de CV sem marca `<!-- claim:ID -->`, ofereça `kb suggest --live` (uma chamada ao Claude, cobrada; peça o ok
antes). A sugestão só gera proposta em `DATA_ROOT/outbox/marcas`; ela nunca altera o currículo. Para fechar lacunas, use `/entrevista`.
