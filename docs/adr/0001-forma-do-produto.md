# ADR-1: Forma do produto

## Contexto

O projeto precisa de motor de coleta e de superfície de uso dentro do Claude Code. Fazer fork do
motor existente diverge rápido do upstream; embutir o produto como plugin dele não oferece hook de
envio nem espaço para base de conhecimento, adaptadores e painel.

## Decisão

Repositório próprio, empacotado como plugin de Claude Code (`.claude-plugin/`, comandos, agentes,
hooks), com núcleo determinístico em Node e o career-ops como motor externo de versão fixada
(v1.36.0), instalado pelo usuário em `DATA_ROOT/engines/career-ops`. A chamada é sempre pela CLI
ou por import, nunca pelo contexto do modelo.

## Consequências

- Não há fork para manter; a atualização do motor é uma troca de tag validada pelo `doctor`.
- O repositório não distribui código do motor; o `NOTICE` registra a dependência.
- Melhorias genéricas podem voltar ao upstream sem acoplar o produto.
