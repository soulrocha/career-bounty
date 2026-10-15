---
description: Entrevista de lacunas da base de carreira; as respostas viram afirmações relato que você aprova uma a uma
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
Conduza uma entrevista curta para fechar lacunas da base. Nada entra na base sem a aprovação explícita da pessoa, e nada
é escrito no Vault: o que seria nota nova sai como rascunho em `DATA_ROOT/outbox/vault/`.

1. Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" entrevista lacunas --json` e mostre as 5 de maior peso.
   Deixe a pessoa escolher uma (use o campo `id`).
2. Rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" entrevista perguntar --lacuna <id> --live --json`
   (chamada real ao Claude, cobrada; avise antes). Faça as perguntas devolvidas, uma por vez, e espere a resposta.
3. Escreva a afirmação a partir do que a pessoa disse, em uma frase, e mostre a ela. Nunca invente nem estime número,
   data, empresa ou resultado: só vale o que ela falou. Com o ok dela, rode
   `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" entrevista registrar --lacuna <id> --texto "<afirmação>" --resposta "<resposta dela, literal>"`.
   Se o comando recusar por número fora da resposta, corrija o texto; não force.
4. Pergunte se aprova. Só com um sim claro, rode `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs" entrevista aprovar --id <AFL-nnn>`.
   Sem aprovação, a afirmação fica pendente (`entrevista pendentes`) ou é descartada com `entrevista rejeitar --id <AFL-nnn>`.
5. A afirmação aprovada nasce `relato`, com `publicavel: nao`: ela ainda não serve de fato no CV até ganhar prova.
   Diga isso à pessoa e sugira registrar a evidência.
