# Fontes de vagas

Registro dos spikes F2.1 e F2.2 (medidos em 14/10/2026, sem cookie, sem login, sem token) e das
decisões de coleta. Nenhum dado pessoal e nenhum nome de empresa real neste arquivo. Respostas de
exemplo usadas nos testes ficam em `tests/fixtures/` e são sintéticas.

Princípio comum: toda fonte devolve `Vaga[]` pelo contrato S3 (`core/sources/vaga.mjs`). Falha de
uma fonte vira `fontes[].erro` e nunca derruba as outras nem conta como "vaga encerrada". Estrutura
inesperada (campo-chave ausente) é erro nomeado, nunca lista vazia silenciosa.

## Resumo

| Fonte | Veredito | Mecanismo | Módulo |
|---|---|---|---|
| Gupy | viável | API pública de busca por palavra-chave | `core/sources/gupy.mjs` |
| career-ops (ponte) | opcional | processo externo configurado que imprime JSON | `core/sources/careerOps.mjs` |
| Freehire | viável | API REST pública, até 3 páginas por consulta | `core/sources/freehire.mjs` |
| Inhire | viável, por empresa | API pública com cabeçalho de tenant | `core/sources/inhire.mjs` |
| Solides | viável, busca por título | API pública same-origin | `core/sources/solides.mjs` |
| JobSpy (Indeed) | opcional | processo externo (Python) configurado | `core/sources/jobspy.mjs` |
| LinkedIn guest | parcial, desligado | HTML público, só descoberta, 10 req/dia | `core/sources/linkedinGuest.mjs` |
| LinkedIn por e-mail | viável | alertas lidos pelo leitor de e-mail (F3) | `core/sources/linkedinAlerts.mjs` |

## Gupy

- Endpoint: `GET https://portal.gupy.io/api/job-search/jobs`, parâmetros `jobName`, `limit` (máximo
  100), `offset`, `workplaceType`, `type`. Resposta `{ data: [...], pagination }`.
- `pagination.total` não é confiável (devolve o tamanho da página): o fim do feed é a página curta.
- Ordenação por `publishedDate` decrescente, o que permite parar pela janela de dias.
- Vaga de empregador sigiloso (o rótulo no lugar do nome da empresa) é descartada; a URL precisa ser HTTPS em `*.gupy.io`.
- Modelo de comportamento: `providers/gupy.mjs` do career-ops (MIT). O módulo daqui é uma
  implementação própria do mesmo contrato público, com atribuição no `NOTICE`.

## Inhire (F2.1)

- Base `https://api.inhire.app`, todos GET, sem autenticação, cabeçalho `X-Tenant: <tenant>`.
- O tenant é o subdomínio da página de carreira da empresa. Não existe busca entre empresas: a lista
  de tenants vem da configuração.
- `GET /tenants/public/config/resolve/{tenant}` valida o tenant. Tenant inexistente na lista devolve
  `[]` sem erro, então validar antes.
- `GET /job-posts/public/pages` devolve `{ jobsPage: [...] }` (jobId, displayName, workplaceType,
  location, status). Sem paginação. Data só no detalhe (`GET /job-posts/public/pages/{jobId}`:
  `publishedAt`, `description` em HTML).
- Sem 429 observado em chamadas espaçadas de 4 a 5 s. Uso previsto: uma lista por empresa por dia e
  detalhe só das vagas novas.
- Candidatura é POST com reCAPTCHA: o provider só lê.
- Risco: API não documentada (usada pelo próprio front). Por isso o teste de "estrutura mudou".

## Solides (F2.1)

- `GET https://vagas.solides.com.br/api/vacancies?page=<n>&take=14&title=<termo>`, sem cookie e sem
  `Authorization`. Resposta `{ totalPages, currentPage, count, data: [...] }`.
- `take` acima de 14 devolveu 500: usar 14. A busca por `title` exige todos os termos.
- Ordenação por `createdAt` decrescente: dá para parar quando a data sai da janela.
- URL pública da vaga: `https://vagas.solides.com.br/vaga/<id>`. O campo `redirectLink` vem quebrado
  e não é usado.
- Volume pequeno para cargos de liderança em tecnologia: fonte complementar.
- Risco: BFF não documentado do front.

## LinkedIn guest (F2.2)

- Veredito parcial: funciona tecnicamente sem cookie, mas o `robots.txt` do LinkedIn proíbe
  `/jobs-guest/` e os Termos de Uso proíbem coleta automatizada. Por isso o coletor vem **desligado**
  e só liga com `fontes.linkedin_guest.ativo: true` e `aceite_termos: true` no `config.yml` pessoal.
- Busca: `GET /jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=&location=&f_TPR=r86400&start=`,
  fragmento HTML com 10 cards por página. Por card: id numérico, título, empresa, local, data.
- A página da vaga é pública mas **não expõe a URL externa de candidatura**: o destino vem de outra
  fonte (casamento por empresa e título) ou do e-mail de alerta. O resultado é sempre uma aparição
  de vaga, nunca vaga canônica sozinha.
- Desafio anti-bot intermitente (HTTP 429 com página de desafio na primeira requisição fria).
  Regra: 429 ou desafio para a fonte pelo resto do dia; nunca resolver nem contornar.
- Orçamento rígido de 10 requisições por dia, persistido em `state/`, sem `Cookie` e sem
  `Authorization`. A rota principal para o LinkedIn é o alerta por e-mail (F2.19).

## Conector Gmail dentro do `claude -p` (F3.1, resultado parcial)

- Funciona sem interação em `claude -p --model haiku` com a ferramenta de busca do conector liberada
  e as de escrita bloqueadas. A saída do modelo vem dentro de uma cerca de código `json`: o parser do
  contrato remove a cerca.
- Não faz parte da F2; fica registrado porque o `daily-run` (F2.18) e os alertas (F2.19) dependem.

## Decisões da F2

- **Gupy:** implementação nativa em `gupy.mjs` (a ponte `careerOps.mjs` existe para quem preferir
  rodar o career-ops fixado; ela só exige um executável que imprima JSON). Escolha: não depender de
  um clone local do career-ops no caminho crítico do radar.
- **Freehire:** o coletor legado chamava uma CLI em Bun. Aqui o coletor fala direto com a API REST
  pública (mesmos parâmetros: país, janela de dias, limite 20, paginação por `offset`).
- **JobSpy:** mantido como fonte externa opcional; sem o executável a fonte fica `indisponivel`.

## Radar diário (F2): decisões de implementação

- **Habilitar uma fonte** é declarar o bloco dela em `fontes` no `config.yml` pessoal (`{}` basta para Gupy e Freehire,
  que usam os termos de `radar.termos`). Sem bloco, `collect` não chama a fonte. O LinkedIn guest exige
  `ativo: true` e `aceite_termos: true`.
- **Estágio 2 em processo:** triagem (Haiku) e avaliação (Sonnet) rodam pelo `LlmRunner`, cada chamada como um
  `claude -p` sem ferramentas, sem MCP, sem skills e sem sessão salva. Em vez de uma única sessão
  `claude -p "/radar --delta"`, o ganho é orquestração determinística, livro de tokens por chamada e a garantia de
  zero ferramentas diante de texto de vaga hostil. A leitura de e-mail (F3) entra como fonte (`linkedin_alertas`).
- **Rotina diária:** gatilho no logon (atraso de 2 min) e semanal às 18:00 de segunda a sexta, com início perdido
  executado assim que possível; a trava "já rodou hoje" vive em `state/daily-run.json`. `schedule install` só grava
  na máquina com `--confirmo-instalar`; `--dry-run` imprime o XML.
- **Ferramentas dos agentes:** `triador` e `avaliador` declaram `tools: none`. O Claude Code não documenta uma sintaxe
  para "nenhuma ferramenta" em subagente; a garantia real é o `--tools ""` do runner, coberto por teste.
- **Medição de custo** de uma rodada de 5 vagas sintéticas (1 triagem + 2 avaliações, tokens de cache incluídos) fica no
  relatório do `eval radar --json` (`uso`).
