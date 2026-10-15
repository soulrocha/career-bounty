---
name: email
description: Lê e-mails de processo seletivo pelo conector Gmail (somente leitura) e atualiza o tracker por regra e ID de requisição.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
# E-mail para o tracker

Use quando a rotina diária não conseguiu ler o e-mail ou a pessoa pedir `/email`.

## Regras

1. Só leitura. Esta skill não libera nenhuma ferramenta de escrita do Gmail (enviar, responder, encaminhar, apagar,
   rotular, rascunho, spam). Quem lê é o subagente `leitor-email`, chamado pelo CLI.
2. Fluxo: um único passe, `node bin/career-bounty.mjs mail sync --live --json`; não rode o leitor duas vezes (cada passe é chamada cobrada). `--dry-run` só se a pessoa pedir a simulação, e então sem repetir o passe real. Confirmação da pessoa só para criar evento no Calendar.
3. Vínculo só por ID de requisição. Sem ID, o e-mail fica "pendente de conferência"; nunca ligue por semelhança de
   cargo ou empresa.
4. Entrevista agendada gera proposta de evento; criar no Calendar exige confirmação da pessoa.
5. Sem conector Gmail disponível: diga como ativar (claude.ai, Configurações, Conectores) e não tente outra via.
6. Nunca copie assunto, remetente ou trecho de e-mail para a conversa, para commits ou para arquivos versionados.
