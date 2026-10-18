# Perfil profissional Gupy — F6.13

Duas versões de DOM são reconhecidas; qualquer outra bloqueia:

- `gupy-curriculo-v1`: a página real "Meu currículo" (`https://login.gupy.io/candidates/curriculum`), estrutura observada em
  17/10/2026 só com leitura. Experiências por `#companyName-N`, `#role-N` e `textarea#activitiesPerformed-N` (id `pN`),
  habilidades por `[data-testid="candidate-skill"]`; contato, documento e diversidade não são lidos. Não há campo "Sobre você"
  (`sobre: null`; a seção sai do diff em `ignoradas`) nem id de conta visível (a conta é `conta-<fnv1a das empresas>`).
  Os acordeões têm cabeçalho `div[role=button]`, não há `<form>` e o "Salvar" da seção fica escondido até haver alteração.
  Habilidades usam autocomplete e ficam como item manual. A **leitura** foi verificada na conta real (6 experiências, 30
  habilidades); a **gravação** foi feita sobre a estrutura observada e testada em fixture equivalente, mas não foi exercitada
  em conta real: o primeiro item aprovado é o aceite manual.
- `synthetic-v1`: contrato semântico das fixtures de teste (`data-gupy-profile`).

O MCP/guia oficial da Gupy continua não verificado.

## Comandos

1. `gupy perfil iniciar --aba <id>` protege antes de ler e devolve o extrator oficial. A primeira execução individual, pelo navegador, fixa o `session_id` real informado no envelope PreToolUse. Não é exigida variável de ambiente de sessão; ausência do campo no hook nega. Reiniciar preserva o dono da aba.
2. `gupy perfil propor --aba <id> --extracao <json> --proposta <json-F5.6>` revalida as afirmações atuais e calcula o diff contra a nova leitura. Proposta original e `cv/perfil-gupy.json` ficam preservados.
3. A pessoa digita a mensagem inteira `aprovar perfil <proposta_hash> [{"secao":"sobre","hash":"<sha256>"}]`. Não há comando de aprovação. Proposta deve ter menos de uma hora; token vale duas horas e uma execução.
4. `gupy perfil editar --aba <id> --secao <secao> --hash <sha256>` gera script exato, sem aprovar. O script só altera o item e valida a conta/hash/contexto de experiência. Na fixture `synthetic-v1`, exige formulário da seção com um único textarea e um único botão `type=button` chamado Salvar. Na página real `gupy-curriculo-v1` (sem `<form>`): recusa se já houver um "Salvar" visível antes da alteração (outra seção suja); depois da alteração, exige exatamente um "Salvar" novo, visível de verdade (tamanho, opacidade e ancestrais), dentro da seção Experiência e fora de `<form>` (aceita `button` ou `submit`); senão restaura o texto, relê a página inteira e devolve `restaurado: true` ou o erro "restauração não confirmada" (recarregar sem salvar). Um item não é autorizado enquanto outro da mesma aba estiver incerto. Nenhum retry automático.

`gupy perfil encerrar --aba <id>` libera a aba (com item incerto, só com `--forcar` depois de conferir na Gupy); a aba também vence 24 h depois de `iniciar`. `iniciar` de novo na mesma aba recomeça a proposta (conta ou experiências mudaram), salvo item incerto. A saída de `propor` traz o texto atual da página embrulhado como dado não confiável e não devolve o perfil cru.
5. Recarregue usando `SCRIPT_RECARREGAR_PERFIL`, execute o extrator oficial e use `gupy perfil confirmar --aba <id> --secao <secao> --extracao <nova-leitura.json>`. Uma leitura da mesma instância do documento ou sem navegação de reload bloqueia. O evento `perfil.atualizado` contém hashes antes/depois/proposta e seção, com ID determinístico. Não modifica a projeção legada em sombra.

Depois do consumo, uma falha ou resposta do clique não prova sucesso. Se a relitura mostrar valor proposto, confirme; valor anterior exige outra aprovação e terceiro valor exige ação humana. Não modifique o arquivo da extração para forjar persistência.

O extrator é sempre uma chamada individual: PreToolUse registra seu `tool_use_id`, aba e sessão sob lock; PostToolUse aceita só a resposta dessa chamada. São suportados explicitamente um objeto de extração normalizado ou MCP com um único bloco `text` contendo JSON estrito. Erro, prosa, múltiplos blocos ou formato desconhecido não geram observação. A forma real da resposta do navegador permanece **não verificada**: fixtures de stdin não provam integração real. Sem observação correspondente, tanto propor quanto confirmar falham. A confirmação exige observação iniciada depois do consumo e documento diferente daquele vinculado ao script desse item; `recarregada=true` herdado de reload anterior não basta. A observação é consumida e a confirmação idêntica já concluída continua idempotente.

A fronteira de confiança são os envelopes oficiais dos hooks. Não se pretende proteger contra um processo hostil local capaz de forjar o stdin do próprio hook ou modificar o estado privado. A CLI do modelo recebe somente JSON a conferir e não pode registrá-lo como observação de ferramenta.

## Verificação

`node --test tests/unit/gupy-profile*.test.mjs` cobre o serviço, CLI, hooks em subprocessos e o extrator/script em CDP. Os testes são sintéticos e usam pasta temporária; não gravam na pasta privada real. O teste do script fornece origem sintética no escopo da avaliação da fixture `file://`; o script oficial continua recusando essa origem. Conta real, seletores reais, autenticação real e aceite manual de um item persistido não foram verificados.

Consulte a [skill](../skills/gupy-perfil/SKILL.md) e a [ADR](adr/0006-perfil-gupy-por-item.md).
