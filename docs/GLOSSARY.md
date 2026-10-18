# Glossário

Vocabulário do projeto. Nomes de teste e de interface seguem estes termos.

## Afirmação

Fato curto sobre a trajetória da pessoa, com identificador (`AF-001`) e nível de prova
(`verificado`, `entregue`, `proposto`, `relato`). No código aparece como `claims`. Currículos e
respostas só escolhem afirmações por identificador; nunca inventam fato novo.

## Evidência

Documento, link ou registro que sustenta uma ou mais afirmações (`EV-001`). Toda evidência
referencia afirmações existentes; referência a identificador inexistente é erro.

## Vaga canônica

Representação única de uma vaga depois de deduplicar republicações. A chave canônica é
portal mais requisição; semelhança de cargo e empresa só sinaliza, nunca funde.

## Requisição

Identificador da vaga no portal de origem. É a base da deduplicação e do descarte: vaga
republicada com outro endereço, mas a mesma requisição, continua sendo a mesma vaga.

## Candidatura

Registro de que a pessoa se candidatou (ou marcou que se candidatou) a uma vaga canônica,
com data, origem e histórico de marcações. Candidatura confirmada nunca é apagada por descarte.

## Resposta

Texto de resposta a uma pergunta de formulário, vinda do banco de respostas e das afirmações.
Resposta nova nasce de uma pergunta pendente aprovada pela pessoa.

## Pergunta pendente

Pergunta de formulário que o banco de respostas ainda não cobre. Vai para a pessoa, e a resposta
aprovada entra no banco.

## Regra de envio

Regra escrita pelo usuário em `config.yml` (`envio.regras`) que autoriza envio automático em
formulários públicos sem login. Exige `limite_dia`. Sem regra ativa, o padrão é parar antes de enviar.

## Evento

Fato imutável gravado no log append-only (`events/`), com id, instante, host, ator, tipo e
entidade. Estado e projeções são derivados dos eventos e podem ser reconstruídos.

## Quadrante

Uma das quatro classes que comparam a base com o currículo: (a) dado e CV conferem, (b) dado fora do CV, (c) CV sem dado e
(d) lacuna. É calculado de forma determinística por `core/kb/quadrants.mjs`.

## Item de CV

Bullet de um modelo de CV, com seção, texto, números extraídos e as afirmações a que se liga pela marca invisível
`<!-- claim:AF-001 -->`. Bullet sem marca fica `sem_marca` e vai para mapeamento.

## Lacuna

Falta de dado que enfraquece o currículo ou as candidaturas: afirmação sem evidência, resultado sem linha de base, buraco na
linha do tempo ou requisito frequente de vaga sem afirmação. Tem peso e pergunta sugerida, e a fila de lacunas ordena por peso.

## Candidato

Fato trazido de uma fonte não confirmada (por exemplo, o ai-memory). Tem nível `relato`, nunca vira afirmação sem a aprovação
explícita da pessoa e nunca vale como fato no CV.

## Medição por candidatura

Soma de eventos `llm.uso` vinculados ao `tentativa_id` de uma reserva e à `vaga_id`, separando navegador de runner.
`medicao: completa` exige preparo e contadores de navegador, sem consumo simulado ou vínculo inconsistente.
`resultado: aprovada` exige também todos os campos conhecidos e no máximo 15.000 tokens. Falta de dados é
`nao_verificada`; desconhecido em qualquer etapa permanece desconhecido para essa medição, mesmo após resposta humana.
`medicao_id` identifica um incremento de contadores da sessão informado pelo operador; não identifica a pessoa ou a vaga.

## Contato com recrutador

Registro factual e pontual de uma interação com pessoa de recrutamento por e-mail, WhatsApp, LinkedIn,
telefone ou outro canal. Pode existir de forma avulsa (antes de haver uma vaga cadastrada) ou vinculado
a uma vaga canônica. O sistema nunca envia mensagens automaticamente; no máximo gera rascunhos de resposta
em `outbox/contatos/` com base nas afirmações comprovadas da base de conhecimento.

## Evento contato.registrado

Evento no log append-only (`events/`) que registra uma interação com recrutador (`tipo: contato.registrado`).
Contém canal (`email`, `whatsapp`, `linkedin`, `telefone`, `outro`), direção (`recebido`, `enviado`), data,
resumo factual curto e, opcionalmente, pessoa de contato (`nome`, `papel`), identificador da vaga (`vaga_id`),
pergunta formulada e próxima etapa prevista. Telefones e e-mails são estritamente mascarados antes de serem
expostos na API do painel.

## Evento contato.vinculado

Evento que associa um contato previamente avulso ou existente a uma vaga canônica específica pelo seu `vaga_id`.

## Evento contato.removido

Evento que registra a remoção/descarte lógico de um contato (`tipo: contato.removido`), identificando `contato_id` e opcionalmente um `motivo`. Uma vez registrado, o contato deixa de ser exibido na projeção pura (`projectContatos`) e na API do painel.

## Processo seletivo

Visão agregada e contínua do relacionamento com uma oportunidade após a candidatura. Junta histórico de candidaturas, e-mails recebidos, contatos com recrutadores e avanços de etapas para acompanhar o ciclo de vida da vaga até sua contratação ou encerramento definitivo.

## Etapas do processo

Vocabulário progressivo e padronizado que representa os passos sucessivos da triagem e entrevistas de um processo: `aplicada`, `triagem`, `teste`, `entrevista_rh`, `entrevista_tecnica`, `entrevista_gestor`, `proposta` e `aprovado`. A progressão respeita estrita monotonicidade (avanços não retrocedem por mensagens fora de ordem).

## Desfecho do processo

Resultado conclusivo de um processo encerrado: `aprovado`, `reprovado`, `desistencia`, `cancelado` ou `proposta_recusada`. Desfechos negativos ou de desistência/cancelamento pertencem a `DESFECHOS_QUE_DESCARTAM` e acionam o descarte automático da vaga no radar.

## Situação do processo

Estado operacional corrente do processo seletivo: `ativo` (em andamento geral), `aguardando_retorno` (candidato realizou ação e aguarda resposta da empresa), `aguardando_voce` (empresa solicitou ação, teste ou agendamento pendente de resposta do candidato) ou `encerrado` (processo concluído com desfecho registrado).

## Alerta de acompanhamento

Indicador de inatividade baseado na quantidade de dias transcorridos desde a última interação com a oportunidade: `normal` (< 5 dias de inatividade), `atencao` (>= 5 dias sem contato) e `lembrar` (>= 7 dias sem contato). Processos encerrados permanecem em `normal` e não disparam alertas.

## Histórico da vaga

Visão temporal completa e unificada de todos os acontecimentos que envolveram uma vaga canônica desde sua primeira aparição. Agrega eventos de descoberta pelo radar, marcação de candidatura, trocas de mensagens e contatos com recrutadores, avanço de etapas de entrevista, desfechos e eventuais descartes, permitindo reconstruir com precisão a cronologia de interações.

## Item de histórico

Unidade elementar que compõe a linha do tempo de uma vaga (`linha_do_tempo`). Representa um marco factual (`tipo: descoberta`, `candidatura`, `contato`, `etapa`, `desfecho` ou `descarte`), contendo data, instante ISO, rótulo descritivo e detalhes contextuais, com mascaramento estrito de informações de contato de terceiros.

## Origem no histórico

Identificação do subsistema ou canal responsável pela geração de um item na linha do tempo: `radar` (varredura automatizada), `painel` (interação realizada pela interface local do usuário), `cli` (comando de terminal), `recrutador` (mensagem recebida externamente) ou `email` (notificação de e-mail identificada pelo pipeline).




