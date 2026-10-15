# ADR-2: Armazenamento por event log

## Contexto

O estado de candidaturas hoje é um único JSON gravado por mais de um processo e sincronizado entre
máquinas, o que gera conflito e perde histórico. A migração precisa ser reversível.

## Decisão

Log append-only por dia e por host (`events/AAAA/MM/DD.<host>.jsonl`), com projeções reconstruíveis
(`projections/`). Escrita atômica e lock com prazo. A migração começa em modo sombra: o sistema de
origem segue como fonte de verdade até o corte, e um comando exporta o documento integral de volta.

## Consequências

- Dois hosts nunca escrevem no mesmo arquivo, o que elimina conflito de sincronização.
- O histórico é auditável e a projeção pode ser refeita do zero.
- Leitura exige tolerar linha corrompida e ordenar por instante, host e sequência.
