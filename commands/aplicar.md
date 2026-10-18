---
description: Candidatura assistida nas vagas elegíveis da fila (preenche no Chrome, para antes de enviar e envia só o lote aprovado)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" apply plan --json` e mostre a fila: rota, empresa, cargo e aderência,
e um resumo das vagas fora da fila com o motivo de cada uma.

Pergunte quais vagas a pessoa quer preparar agora. Depois siga a skill `aplicar` para cada uma. Rotas:
- `assistido`: preenchimento no Chrome logado pela skill `aplicar`.
- `gupy`: fluxo próprio da Gupy (skill `gupy-candidatar`).
- `driver`: formulário público (Greenhouse, Lever, Ashby). Sem regra de envio ativa no `config.yml`, é tratado como `assistido`.

Antes de enviar, monte o lote com `apply lote --vagas <ids>` e mostre a frase exata. A pessoa digita a frase para aprovar.
Em modo sombra (migração não cortada), avise que a candidatura não aparece no painel antigo e que o corte resolve isso.
