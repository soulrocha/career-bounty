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
