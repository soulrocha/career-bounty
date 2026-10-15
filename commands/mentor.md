---
description: Conversa de carreira sobre quadrantes, funil e posicionamento (somente leitura)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" mentor contexto` e use o texto devolvido como base da conversa
com o agente mentor. Ele traz os quatro quadrantes, as maiores lacunas, o funil de vagas e os cargos-alvo, sem identidade.

1. Abra com um diagnóstico curto: o que está forte, o que está sem prova e as duas prioridades mais valiosas.
2. Este comando é somente leitura. Sem pedido explícito da pessoa, não grave nada em `kb/`, no Vault nem no outbox.
   Para registrar uma afirmação nova, use `/entrevista`, que pede aprovação item a item.
3. Nunca invente nem estime métrica: só use número que esteja nas afirmações ou no contexto. Sem dado, diga o que falta.
4. Afirmação `relato` ou `proposto` é pista, não fato; não a trate como resultado comprovado.
