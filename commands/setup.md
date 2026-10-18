---
description: Prepara a pasta privada de dados (DATA_ROOT) e pergunta a preferência de vaga
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" setup --json`. Não apague nada.

Depois confira a preferência de vaga com `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" preferencias --json`.
Se `definidas` for `false`, ou se a pessoa pedir para mudar, pergunte (uma pergunta por vez, com AskUserQuestion):

1. Quais modalidades ela aceita: remoto, híbrido, presencial (pode ser mais de uma).
2. Qual delas é a preferida, se houver (entre as aceitas).
3. Se aceitar híbrido ou presencial: em quais cidades isso serve (a região onde ela pode ir ao escritório).

Grave a resposta com
`node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" preferencias --modalidades <lista> [--preferida <modalidade>] [--regiao "cidade, cidade"]`,
usando `remoto`, `hibrido` e `presencial` separados por vírgula. Nunca escreva a preferência no `config.yml` à mão.

Por fim rode o doctor e informe o que ainda precisa ser configurado em `DATA_ROOT/config.yml`.
