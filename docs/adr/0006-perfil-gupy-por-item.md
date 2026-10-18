# ADR 0006 — Aprovação isolada por item do perfil

Status: aceita para o recorte sintético F6.13; suporte real não verificado.

O perfil é um documento persistente compartilhado entre candidaturas. Reutilizamos a proposta F5.6 e seu validador; aplicar não pode gerar texto novo nem herdar a aprovação de envio de vaga.

Mantemos `state/perfil-gupy.json` com lock e escrita atômica separados de candidatura. Iniciar protege a aba; o primeiro extrator oficial individual vincula a sessão do envelope real do hook, sob lock. Reiniciar não remove o vínculo. A mensagem humana inteira aprova proposta e itens; cada token vincula sessão, aba, conta, proposta, seção e hash, vence e tem uso único.

PreToolUse valida todo batch antes de consumir. A autorização é consumida **antes** da execução, pois o hook não pode tornar atômicos o arquivo local e a ação remota. O script verifica novamente origem/conta/experiência/hash/alvo e formulário local de uma seção, e clica uma vez. Falha após consumo fica incerta.

A confirmação é posterior ao reload e a uma nova leitura profissional com o valor persistido. Valor anterior exige nova aprovação; valor terceiro exige humano. O evento leva hashes e seção, nunca textos, e seu ID estável impede duplicação inclusive após falha entre append e atualização do estado. Não há reducer que altere a projeção legada em sombra.

Como `--extracao` é dado fornecido pelo modelo, não serve como prova sozinho. PreToolUse registra a chamada individual do extrator; PostToolUse aceita somente resposta com o mesmo `tool_use_id`, script, sessão e aba, e persiste hash canônico e sequência. Propor/confirmar devem coincidir com essa observação. Confirmar exige leitura iniciada após o consumo e documento novo em relação ao script desse item; uma observação confirma um item. As formas de resposta suportadas são explícitas e sintéticas; formato real desconhecido bloqueia. A fronteira confiável é o envelope oficial dos hooks, não processos hostis no sistema local.

O contrato DOM é semântico e explicitamente sintético. Seletores e identidade estável reais da Gupy não foram validados; conta ou DOM desconhecido falham fechado. O aceite em conta real é manual e separado dos testes de fixture.
