# ADR-5: Gupy por fluxos assistidos no Chrome, sem driver de envio; aceite de risco pertence à configuração do usuário

## Contexto

A Gupy exige sessão logada e seus termos restringem automação. Um driver de envio no código público
tornaria o projeto um instrumento de violação de termos e de candidatura em massa.

## Decisão

Não há driver de envio nem currículo por vaga para a Gupy. Dois fluxos rodam pelo Claude in Chrome na
sessão já logada da pessoa: otimizar o perfil (o agente propõe, a pessoa aprova item a item) e
candidatar (o agente lê as perguntas, responde a partir do banco de respostas e das afirmações, e a
pessoa confirma o lote antes do clique). Quem aceita o risco de automação é o usuário, na própria
configuração; o código público não carrega esse aceite.

## Consequências

- O repositório permanece defensável e sem credenciais da Gupy.
- A vazão depende da confirmação humana, com limite diário.
- Pergunta nova de formulário vira pergunta pendente e entra no banco de respostas depois de aprovada.
