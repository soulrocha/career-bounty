---
name: resolver-destino
description: Descobre o site de candidatura de vagas já classificadas como alta ou média, no Chrome logado, sem listar nada.
---
# Resolver destino da vaga

Use só em sessão interativa (`/radar --destinos`). A rotina diária apenas enfileira; ela nunca chama o Chrome.

## Regras de custo e de segurança

1. Trabalhe só com a fila devolvida por `node bin/career-bounty.mjs destinos fila --json`: no máximo 15 por dia.
2. **Proibido** captura de tela e leitura da página inteira (`read_page` sem `ref_id`, `get_page_text` sem limite).
3. Para cada vaga: abra a aba, rode o extrator JavaScript curto que devolve só `{href, texto}` do botão de
   candidatura e feche a aba. Nada além disso.
4. Página de login ou captcha: registre `bloqueada:humano`, deixe a aba aberta para a pessoa e siga para a próxima.
   Nunca tente resolver captcha nem preencher login.
5. Grave o resultado com `node bin/career-bounty.mjs destinos registrar --vaga <id> --url <destino>`.
