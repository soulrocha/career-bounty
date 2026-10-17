---
name: gupy-candidatar
description: Candidatura assistida na Gupy em lote confirmado pela pessoa; responde as perguntas da vaga pelo answer bank e para antes de testes, vídeo e agendamento.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
# Candidatura na Gupy

Use só em sessão interativa, com a pessoa presente e logada na Gupy. CB é `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs"`.
Vale tudo da skill `aplicar` (lote nominal, custo baixo, dado sensível com a pessoa); abaixo, só o que é próprio da Gupy.

## Antes de começar

- A rota Gupy só funciona com `"gupy": { "aceite_termos": true }` no `config.yml` da pessoa: automatizar a conta dela é risco
  dela. Sem isso, `apply lote` e `apply preparar` recusam; avise e não contorne.
- Trava diária: no máximo `gupy.max_por_dia` envios por dia (padrão 5, dia de São Paulo). O hook nega o envio além do limite,
  mesmo com aprovação; tentativa incerta também conta. Não tente "liberar" a cota.
- Não existe "Sobre você" por vaga na Gupy: o documento é o perfil. Ajuste de perfil é a skill `gupy-perfil`, com aprovação própria.

## Por vaga

1. `tabs_context` e **aba nova** para cada vaga. Proibido captura de tela e `read_page` sem `ref_id`.
2. `CB apply iniciar --vaga <id> --aba <tabId> --json` (reserva a tentativa e marca a aba). Login, captcha e MFA: pare,
   deixe a aba aberta e registre `CB apply desfecho --vaga <id> --aba <tabId> --estado bloqueada:humano --motivo "<motivo>"`.
3. Na página de perguntas da vaga, rode o script de `CB apply etapa-gupy` com `javascript_tool` em **chamada individual**
   (nunca em `browser_batch`): o hook observa a resposta e grava a etapa; você não declara a etapa. Rode também o `extrator`
   e depois `CB apply preparar --vaga <id> --extracao <arquivo> --json`. Antes do envio, rode o script de etapa de novo:
   o hook só libera o envio se a última etapa observada for a de perguntas. Navegar, clicar ou preencher na aba apaga a
   etapa observada, e ela vence em 10 minutos: rode o script de etapa logo antes do envio, depois do último preenchimento.
4. Se a etapa for de **teste, personalidade, vídeo ou agendamento** (ou desconhecida), o `preparar` para: não inicie nada,
   avise a pessoa e siga para a próxima vaga. Palavras na descrição da vaga não contam; só a etapa da página.
5. Perguntas novas (factuais, sensíveis, eliminatórias) vão para a aba Perguntas do painel; as abertas só entram com rascunho
   aprovado lá. Preencha com o `script` devolvido e peça à pessoa os campos de `preencha_voce`.
6. Monte o lote com `CB apply lote --vagas <ids>` e mostre a frase "enviar estas N: ...". Só depois que a pessoa digitar a
   frase, rode o script de `CB apply envio --vaga <id>`. Uma vaga por vez.
7. Comprovante: script de `CB apply comprovante` e `CB apply desfecho --vaga <id> --aba <tabId> --estado enviada --comprovante <arquivo>`.
   Se a Gupy abrir em seguida uma etapa de teste ou vídeo, pare ali: ela fica para a pessoa.
