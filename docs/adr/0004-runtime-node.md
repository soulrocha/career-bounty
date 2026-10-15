# ADR-4: Runtime único em Node 20+

## Contexto

O motor externo e a CLI do plugin são Node; a rotina anterior mistura Python com scripts soltos.
Manter dois runtimes dobra o ambiente a validar e a superfície de teste.

## Decisão

Runtime único em Node 20 ou superior, módulos ESM (`.mjs`), testes com `node --test` e sem
dependências npm por padrão. A lógica antes escrita em Python é portada por caracterização:
saídas gravadas do original viram golden e o teste compara a versão em Node com elas.

## Consequências

- A CI testa em Windows e Linux com o mesmo comando (`npm test`).
- Cada dependência nova exige justificativa e licença permitida.
- Ferramentas externas em outra linguagem entram apenas como fonte opcional, nunca no caminho crítico.
