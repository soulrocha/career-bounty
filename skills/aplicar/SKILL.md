---
name: aplicar
description: Preenche candidaturas da fila no Chrome logado, para antes de enviar e só envia o lote que a pessoa aprovar digitando a frase do lote.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs":*)
---
# Candidatura assistida

Use só em sessão interativa, com a pessoa presente. CB é `node "${CLAUDE_PLUGIN_ROOT}/bin/career-bounty.mjs"`.

## Regras que não se negociam

1. **Nada é enviado sem aprovação nominal.** Monte o lote com `CB apply lote --vagas <ids> --json` e mostre a frase devolvida.
   A pessoa precisa digitar essa frase no chat ("enviar estas N: ..."). Você nunca digita, resume ou "confirma" por ela.
   O hook nega o envio sem essa aprovação; não tente contornar (outro script, Enter, clique por coordenada).
2. **Custo baixo.** Comece por `tabs_context_mcp` e abra uma **aba nova** para cada vaga. É **proibido** tirar captura de tela
   e ler a página inteira (`read_page` sem `ref_id`, `get_page_text` sem limite). Use `javascript_tool` com os scripts do
   CareerBounty, `find` para localizar um campo e `read_page` só com `filter: "interactive"`. Junte passos com `browser_batch`.
3. **Captcha, login ou MFA:** pare na hora, deixe a aba aberta, registre `bloqueada:humano` e siga para a próxima vaga.
   Nunca tente resolver captcha nem preencher senha ou código.
4. **Dado sensível** (salário, telefone, documento, diversidade) nunca passa por você: o script de preenchimento não o leva.
   Peça para a pessoa digitar esses campos na aba (lista `preencha_voce`).
5. **Resposta aberta** só entra se a pessoa aprovou o rascunho na aba Perguntas do painel. Não escreva resposta no formulário.
6. **Etapas depois da inscrição** (teste, personalidade, vídeo, agendamento) não são iniciadas: pare e avise.

## Por vaga

1. `CB apply plan --json` mostra a fila elegível e a rota de cada vaga (`assistido`, `gupy` ou `driver`).
2. Abra a aba da vaga e rode `CB apply iniciar --vaga <id> --aba <tabId> --json`. Isso reserva a tentativa (evita duplicidade),
   marca a aba e devolve o `extrator` e o caminho do PDF aprovado (`cv_ats`).
3. Rode o `extrator` com `javascript_tool` na aba. Salve o JSON devolvido num arquivo e rode
   `CB apply preparar --vaga <id> --extracao <arquivo> --json` (com `--live` para rascunhar respostas abertas).
4. Se vier `bloqueada`, rode `CB apply desfecho --vaga <id> --aba <tabId> --estado bloqueada:humano --motivo "<motivo>"` e siga.
5. Rode o `script` devolvido com `javascript_tool` (preenche numa chamada). Anexe o currículo com `file_upload` usando só o
   caminho `cv_ats`. Peça à pessoa os campos de `preencha_voce`.
6. Se houver perguntas criadas, avise que estão na aba Perguntas e siga para a próxima vaga; preserve a aba e a tentativa.
   Depois que a pessoa salvar as respostas, extraia novamente e retome `apply preparar` na mesma aba. Não rode `apply iniciar`
   de novo: a reserva existente protege contra duplicidade enquanto a pessoa responde.
7. Formulário em várias etapas: avance com `CB apply clique --texto "<botão>"`. Só aceita um botão visível e habilitado,
   com `type="button"` explícito e rótulo de navegação conhecido (Próximo, Avançar, Continuar, Voltar e equivalentes).
   Botão de submit, tipo omitido, rótulo desconhecido ou alvo ambíguo exige ação humana; não contorne a recusa.
8. Com a vaga pronta, inclua-a no lote. Depois da frase digitada pela pessoa, rode o script de `CB apply envio --vaga <id>`.
9. Rode `SCRIPT_COMPROVANTE` (devolvido por `CB apply comprovante`) na aba, salve o JSON e registre
   `CB apply desfecho --vaga <id> --aba <tabId> --estado enviada --comprovante <arquivo>`. Sem confirmação na página, o estado
   fica `enviada_sem_comprovante` e a pessoa confere no painel.

## Medição de tokens

Use sessão dedicada a uma candidatura. Guarde o `tentativa_id` de `apply iniciar` e registre apenas os contadores
efetivamente fornecidos pelo ambiente da sessão. Normalize manualmente num arquivo privado com o formato
`{"medicao_id":"sessao-1","tokens_in":100,"tokens_out":20,"tokens_cache_leitura":0,"tokens_cache_criacao":0}`
e rode `CB apply tokens --vaga <id> --tentativa <id> --uso <arquivo.json> --json` (também aceita após o desfecho).
Um ID representa um incremento distinto; repetir o mesmo registro é seguro, repetir um total cumulativo com outro ID duplica o consumo.
Não inclua conteúdo de página, respostas, identidade ou credenciais. Não estime tokens por caracteres ou ferramentas.
Sem contador disponível, deixe ausente e relate não verificado. Confira `CB report tokens --by application --json`:
as fontes navegador e runner ficam separadas; fake/replay ou medição incompleta não comprovam a meta de 15 mil.
