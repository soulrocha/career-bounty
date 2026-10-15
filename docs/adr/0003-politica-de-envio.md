# ADR-3: Política de envio

## Contexto

Enviar candidatura é irreversível e pode violar termos de site. Um modelo de linguagem decidindo
sozinho sobre envio é um risco de segurança (injeção de prompt) e de reputação.

## Decisão

Só um driver determinístico, sem modelo, pode enviar sozinho, sob regra escrita pelo usuário,
com limite diário, e apenas em formulários públicos sem login. Toda sessão com modelo prepara o
envio e pede confirmação nominal do lote. O padrão de fábrica é parar antes de enviar; um hook
bloqueia qualquer clique de envio sem token de aprovação.

## Consequências

- Quem clona o projeto começa com tudo desligado.
- Captcha, login automático e autenticação em dois fatores ficam fora de escopo: viram bloqueio
  que exige a pessoa.
- A política de envio é testável como função pura (tabela de verdade).
