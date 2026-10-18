# Currículos: dois PDFs com gates e proposta de perfil de portal

Esta página descreve a F5: como cada vaga recebe um CV visual e um CV para ATS, o que barra um CV antes de ele ser
oferecido e como portais que não recebem CV (Gupy) ganham uma proposta de perfil. Os exemplos são fictícios.

## Fluxo

1. `cv gerar --vaga <id>` pega a vaga da projeção, a base de afirmações e o perfil de CV.
2. A seleção determinística (`core/cv/select.mjs`) monta o payload: com os requisitos atendidos da vaga ligados a afirmações,
   os bullets sobem por peso (obrigatório antes de desejável, atendido antes de parcial); sem alvo, vale a base como está.
   Com `--live` ou `--replay <pasta>`, o redator (Sonnet) escolhe e ordena as afirmações e escreve o resumo; o validador
   recusa ID inexistente, afirmação sem prova, variante inventada e número sem afirmação.
3. O payload vira dois PDFs: visual (cabeçalho com foto, 4 cards, experiências) e ATS (coluna única, sem imagem).
4. O gate (`core/cv/gates.mjs`) confere o CV e o texto extraído do PDF ATS. O resultado vai para o artefato, para o manifesto
   e para o evento `cv.gate`.
5. O painel mostra "PDF para enviar" (ATS) e "PDF visual" do CV aprovado mais novo, o PDF já enviado e o motivo de um bloqueio.

`cv gate --vaga <id>` reavalia todas as versões da vaga contra a base atual (por exemplo, depois de uma afirmação ser
rebaixada); `cv gerar` faz o mesmo com as versões anteriores. Assim uma versão antiga nunca volta a ser oferecida com fato
que deixou de ter prova.

Em modo sombra (antes do corte da migração), `cv gerar` e `cv gate` gravam o artefato e o manifesto, mas não gravam evento:
o legado continua o escritor oficial do pipeline. A saída avisa. Depois do corte para o modo ativo, rode `cv gate --vaga <id>`
nas vagas com CV para que o resultado do gate entre na projeção.

## Quem recebe adaptação

| Situação da vaga | CV |
|---|---|
| Portal em `cv_skip_portals` (Gupy por padrão) | nenhum PDF; use a proposta de perfil |
| Alta ou boa, aberta, compatível, não descartada, com requisito atendido ligado a afirmação | adaptado |
| Qualquer outra | CV-base, identificado como tal ("PDF-base" no painel) |

Requisito "atendido" sem afirmação ligada não conta como prova de aderência: a vaga recebe o CV-base, sem texto genérico.

## Perfil de CV

`DATA_ROOT/cv/perfil.json` (JSON) guarda o que não muda entre vagas. A foto fica na mesma pasta.

```json
{
  "versao": 1,
  "cabecalho": { "nome": "Ana Exemplo", "titulo": "Analista de Produto", "contatos": ["ana@exemplo.test", "Cidade Exemplo"] },
  "foto": "foto.jpg",
  "cards": [
    { "valor": "34%", "rotulo": "menos tempo de fechamento de pedidos", "claim_ids": ["AF-201"] }
  ],
  "resumo_base": "Analista de produto com experiência em operações e indicadores.",
  "experiencias": [
    { "id": "exp-alfa", "empresa": "Empresa Alfa", "cargo": "Analista de Operações", "periodo": "jan/2018 - dez/2020",
      "inicio": "2018-01", "fim": "2020-12", "intro": null, "afirmacoes": ["AF-202", "AF-201"] }
  ],
  "formacao": [{ "curso": "Bacharelado", "instituicao": "Universidade Exemplo", "periodo": "2012 - 2016" }],
  "cursos": ["Curso | Instituto Exemplo"],
  "competencias": [{ "grupo": "Produto", "itens": "Discovery e métricas de produto." }],
  "idiomas": "Português: nativo."
}
```

- São exatamente 4 cards, cada um ligado a afirmações (`claim_ids`); número de card sem afirmação bloqueia o CV.
- Cada afirmação vai para a experiência da mesma empresa (e do período que mais se sobrepõe). A que não casa com nenhuma
  vai para "Destaques". `afirmacoes` na experiência fixa a ordem da base; o resto vem depois, por ID.
- Toda experiência do perfil aparece no CV, na ordem do perfil. A que não tem afirmação liberada sai com cargo, período e
  intro, sem bullet: o histórico não some e nenhum fato sem prova entra.
- `itens_por_experiencia` (inteiro de 1 a 10, padrão 6) limita os bullets por experiência. Com histórico longo, um valor
  menor mantém o CV em 2 páginas.
- Afirmação entra no CV só com prova (`verificado` ou `entregue`), `publicavel` diferente de `nao` e `uso` com `CV`.
  `variantes` cadastra frases alternativas; `anonimizar` lista termos que nunca podem aparecer no CV.

## Gates

O CV fica "bloqueado" quando qualquer item abaixo falha. O motivo aparece no painel e na saída de `cv gerar`.

- Afirmação inexistente, sem prova, não publicável ou sem uso de CV.
- Texto do bullet diferente do texto da afirmação e das variantes cadastradas.
- Número sem afirmação ligada que o sustente (bullet, resumo ou card), inclusive arredondado. A escala conta ("41k" é 41 mil,
  "R$ 5 bilhões" é 5 bilhões) e moeda abaixo de mil não se confunde com contagem ("R$ 41" não é "41 pessoas").
- No resumo, quantidade por extenso ("dobrou", "dez vezes", "centenas", "um milhão", "uma década") sem afirmação usada que traga
  a mesma palavra ou, para cardinais, o mesmo valor em dígitos ("cinco sistemas" com "5 sistemas" passa).

Título, intros, competências, cursos e idiomas vêm do `perfil.json` escrito pela pessoa, nunca do modelo: número ali
("Office 365", "ISO 27001", "TOEFL 100") não passa pelo conferidor de números; só a busca de termo a anonimizar vale para eles.

O resumo-base do perfil (CV sem redator) também é da pessoa e não passa pelo conferidor de extenso; o resumo do redator passa.

Limitações conhecidas: de mil para cima, moeda e contagem com o mesmo valor casam ("R$ 41 mil" sustenta "41 mil usuários");
um cardinal por extenso é liberado por qualquer afirmação usada com o mesmo valor, mesmo em outro sentido ("cinco vezes" com
"5 sistemas"); números colados a letras ("#1", "top10", "15anos") não são extraídos.
- Termo marcado para anonimizar presente em qualquer parte do CV (sem diferença de acento, caixa ou hífen).
- Resumo ou bullet ausente no texto extraído do PDF ATS.

Uma versão nova bloqueada não apaga a anterior aprovada: o painel continua oferecendo a aprovada e avisa do bloqueio.

## Artefatos

`DATA_ROOT/artifacts/cv/<vaga>/<hash>/` guarda `payload.json`, `cv-visual.html|pdf`, `cv-ats.html|pdf` e `gate.json`; o hash
é o sha256 do payload. `manifesto.json` na pasta da vaga lista data, hash, tipo e gate de cada versão e qual foi enviada.
A versão enviada fica imutável: marcar "Já me candidatei" no painel congela o CV aprovado mais novo da vaga como enviado.
O servidor do painel entrega só os PDFs listados no manifesto. A versão cobre também a foto e os templates: trocar qualquer
um gera versão nova.

## PDFs e navegador

Os PDFs saem do Chrome, Chromium ou Edge instalados, em modo headless pela linha de comando; não há dependência npm.
`CAREER_BOUNTY_BROWSER` aponta outro executável. Acima de 2 páginas a geração falha com mensagem. O texto do PDF ATS é
lido por um leitor mínimo (`core/cv/pdf.mjs`) feito para o PDF que o Chrome gera.

## Perfil de portal (Gupy)

`core/cv/perfilPortal.mjs` gera, com o agente `perfil-portal` (Sonnet), uma proposta de "Sobre você", descrição de
experiências e habilidades a partir das afirmações. Cada campo traz o texto atual, o proposto e as afirmações ligadas;
campo igual ao atual sai da proposta. Nada é aplicado no portal: a pessoa revisa e copia o que quiser.

`cv perfil-portal [--portal gupy] (--live | --replay <pasta>)` lê o perfil atual copiado do portal em
`DATA_ROOT/cv/perfil-gupy.json` (`sobre`, `experiencias` com `id`, `empresa`, `cargo` e `descricao`, e `habilidades`) e grava a
proposta em `DATA_ROOT/outbox/cv/perfil-gupy-<data>.md` e `.json`.
Os limites de caracteres por campo ficam em `LIMITES_PORTAL` e devem ser conferidos no portal.
