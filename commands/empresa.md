---
description: Avalia a reputação de uma empresa a partir da pesquisa na web e grava a nota com fonte e data
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Avalie a empresa que a pessoa indicar (argumento: `$ARGUMENTS`).

1. Faça a pesquisa na web pela avaliação de funcionários da empresa (ex.: `"<empresa>" avaliações Glassdoor`, e Indeed se
   o Glassdoor não aparecer). Não abra nem raspe as páginas do Glassdoor: use só o que a pesquisa mostra (título, URL e
   trecho).
2. Grave os resultados relevantes, até 8, num arquivo JSON temporário fora do repositório, no formato
   `[{ "titulo": "...", "url": "https://...", "trecho": "..." }]`, copiando título, URL e trecho como vieram.
3. Rode uma vez
   `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" empresa avaliar --empresa "<empresa>" --resultados <arquivo> --live --json`.
4. Se a avaliação for recusada (sem nota ou sem URL de fonte), diga isso e não invente nota. A pessoa pode registrar à mão
   com `empresa registrar --empresa --nota --quantidade --fonte <url>` se tiver a informação.
5. Responda em uma linha: plataforma, nota, quantidade de avaliações, data e fonte. A nota é um retrato datado.
