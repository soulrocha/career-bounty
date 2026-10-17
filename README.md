# CareerBounty <!-- sec:titulo -->

Plugin para Claude Code que conduz a busca de emprego de ponta a ponta: encontra vagas, avalia o encaixe, gera
currículos sob medida, prepara candidaturas e acompanha o processo seletivo pelo e-mail, sempre com você aprovando
o que sai em seu nome.

Leia antes o [aviso legal](LEGAL_DISCLAIMER.md): você responde pelos termos de uso de cada site, e o envio
automático vem desligado. English: [README.en.md](README.en.md).

## O que é <!-- sec:o-que-e -->

O CareerBounty junta três peças:

- **Uma CLI em Node** (`bin/career-bounty.mjs`), com toda a lógica determinística: coleta, deduplicação, notas,
  currículos, política de envio e trilha de auditoria. Funciona e é testada sem rede e sem modelo.
- **Comandos, skills e subagentes do Claude Code**, que fazem o trabalho de linguagem (triagem, redação de
  respostas, classificação de e-mail) e chamam a CLI para tudo o que precisa ser exato.
- **Um painel local** no navegador, para ver vagas, a fila de candidaturas, as perguntas pendentes e os quadrantes
  de carreira.

Seus dados ficam numa pasta privada fora do repositório (`DATA_ROOT`). O repositório traz só código, documentação e
uma persona fictícia de exemplo.

## Como funciona <!-- sec:como-funciona -->

```text
 fontes de vagas ──► radar ──► triagem e nota ──► painel (Vagas)
                                    │
 base de carreira (kb) ─────────────┼──► currículo por vaga (2 PDFs + gates)
                                    │
                                    ▼
                         fila de candidatura ──► preparar no navegador ──► você aprova o lote ──► envio
                                                       │                                           │
                                     perguntas novas ──► painel (Perguntas)                comprovante
                                                                                                   │
 Gmail (só leitura) ──► classificação de e-mail ──► etapa do processo ◄─────────────────────────────┘
```

1. **Radar.** Coleta vagas de portais públicos e alertas, remove duplicatas e aplica filtros eliminatórios
   (local, modelo de trabalho, senioridade). Fonte com erro aparece como "não conferida", nunca como "sem vagas".
2. **Triagem.** Um subagente compara a vaga com a sua base de afirmações e devolve nota e motivos em JSON validado.
   O modelo escolhe entre afirmações existentes; não inventa fatos.
3. **Currículo.** Para cada vaga, gera um PDF visual e um PDF para ATS a partir das suas afirmações, com gates que
   bloqueiam número sem evidência, fato fora da base e texto fora do limite.
4. **Candidatura.** Abre a vaga numa aba nova do Chrome, preenche o formulário com o banco de respostas e para
   antes de enviar. Perguntas que ainda não têm resposta vão para o painel. O envio só acontece depois que você
   digita no chat a frase exata do lote ("enviar estas N: ...").
5. **Acompanhamento.** Lê os e-mails de processo seletivo pelo conector do Gmail, sem permissão de escrita, e
   atualiza a etapa de cada candidatura.

Tudo vira evento num log só de acréscimo (`DATA_ROOT/events`). Painel e relatórios são projeções desse log, então
qualquer estado pode ser reconstruído e auditado.

## Requisitos <!-- sec:requisitos -->

- Node 20 ou superior. Não há dependências npm.
- Claude Code, com a extensão Claude in Chrome para candidaturas e perfil de portal.
- Google Chrome ou Microsoft Edge instalado: os PDFs saem do modo headless do próprio navegador.
- Opcional: conector do Gmail no Claude Code, para o acompanhamento por e-mail.

## Instalação <!-- sec:instalacao -->

```sh
git clone <endereço deste repositório>
cd career-bounty
npm test
```

No Claude Code, instale o plugin pelo marketplace:

```text
/plugin install career-bounty --marketplace soulrocha/career-bounty
```

## Primeiros passos <!-- sec:primeiros-passos -->

1. **Crie a pasta privada.** `node bin/career-bounty.mjs setup` monta o esqueleto de `DATA_ROOT`
   (padrão `~/.career-bounty`).
2. **Configure.** Copie `config.example.yml` para `DATA_ROOT/config.yml` e ajuste. O arquivo é JSON válido
   (subconjunto de YAML).
3. **Alimente a base de carreira.** Coloque suas notas em `DATA_ROOT/kb` ou aponte outras fontes em
   `DATA_ROOT/fontes.yml`, e rode `kb sync`. Lacunas viram perguntas com `/entrevista`. Detalhes em
   [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md).
4. **Monte o perfil de currículo.** Crie `DATA_ROOT/cv/perfil.json` (contato, cabeçalho, foto opcional e ordem das
   seções). O formato está em [docs/CV.md](docs/CV.md).
5. **Confira.** `node bin/career-bounty.mjs doctor` lista o que falta, sem alterar nada.

## Uso no dia a dia <!-- sec:uso -->

### Radar de vagas <!-- sec:uso-radar -->

`/radar` roda a coleta, a deduplicação e os filtros e mostra o resumo da rodada. Pela CLI:
`collect --dry-run` mostra o que há de novo sem gravar, `collect` grava e `digest` resume. `schedule` gera a
tarefa agendada do Windows que roda o radar uma vez por dia. As fontes estão em
[docs/SOURCES.md](docs/SOURCES.md).

### Painel <!-- sec:uso-painel -->

`/painel` (ou `panel`) abre o painel em `http://127.0.0.1:8880`. Ele só aceita acesso pela própria máquina e
exige token nas gravações. Abas:

| Aba | Para quê |
|---|---|
| Vagas | Lista, nota, motivos, currículos gerados e marcações de status |
| Fila | Vagas elegíveis para candidatura, com rota (driver de ATS, Gupy ou assistida) e estado da tentativa |
| Perguntas | Perguntas novas das candidaturas: você responde ou aprova o rascunho, e a resposta entra no banco |
| Quadrantes | Encaixe entre o que o mercado pede e o que o seu currículo prova |

### Currículos <!-- sec:uso-cv -->

`cv gerar --vaga <id>` produz os dois PDFs da vaga em `DATA_ROOT/artifacts/cv/<vaga>/<hash>/` e roda os gates.
`cv gate --vaga <id>` reavalia uma versão existente. Versão bloqueada nunca é oferecida para anexo. Para portais
que usam o perfil como currículo, `cv perfil-portal` propõe o texto do perfil.

### Candidaturas <!-- sec:uso-candidaturas -->

`/aplicar` trabalha a fila em lotes curtos:

1. `apply plan` escolhe as vagas elegíveis e a rota de cada uma.
2. Para cada vaga, o agente abre uma aba nova, roda o extrator de campos e `apply preparar`, que casa cada campo com
   o banco de respostas. Dado sensível (salário, documentos, deficiência) fica para você preencher.
3. `apply lote` monta a frase do lote. Só quando você a digita no chat o hook libera o clique de envio, uma vaga
   por vez, com aprovação válida por 2 horas e de uso único.
4. `apply comprovante` e `apply desfecho` registram o resultado e o comprovante.

Login, captcha e verificação em duas etapas param a vaga e devolvem a aba para você.

### Gupy <!-- sec:uso-gupy -->

Na Gupy o perfil é o currículo. Duas skills cuidam disso:

- **`gupy-perfil`** lê o seu perfil, propõe mudanças item a item e só grava o item que você aprovar com
  "aprovar perfil <hash>". Veja [docs/GUPY-PERFIL.md](docs/GUPY-PERFIL.md).
- **`gupy-candidatar`** responde as perguntas da vaga e para antes de testes, vídeos e agendamentos.

A rota Gupy exige `"gupy": { "aceite_termos": true }` no `config.yml` e respeita o limite diário
`gupy.max_por_dia` (padrão 5).

### E-mail e acompanhamento <!-- sec:uso-email -->

`/email` lê as mensagens de processo seletivo pelo conector do Gmail e atualiza a etapa de cada candidatura
(inscrita, nova etapa, entrevista, oferta ou encerramento). Um hook nega qualquer ferramenta de escrita do Gmail.

### Carreira: quadrantes, entrevista e mentor <!-- sec:uso-carreira -->

- `/quadrantes` calcula o encaixe entre o que as vagas pedem e o que você prova, e grava o relatório.
- `/entrevista` pergunta sobre as lacunas da sua base. Cada resposta vira uma afirmação que você aprova.
- `/mentor` conversa sobre funil, posicionamento e próximos passos, só com leitura.

## Comandos <!-- sec:comandos -->

Comandos do Claude Code:

| Comando | O que faz |
|---|---|
| `/setup` | Cria o esqueleto de `DATA_ROOT` |
| `/doctor` | Diagnostica o ambiente sem alterar nada |
| `/radar` | Coleta, deduplica, filtra e resume as vagas |
| `/painel` | Abre o painel local |
| `/aplicar` | Candidatura assistida na fila elegível |
| `/email` | Acompanha o processo seletivo pelo Gmail |
| `/quadrantes` | Relatório de encaixe |
| `/entrevista` | Entrevista de lacunas da base de carreira |
| `/mentor` | Conversa de carreira |

Subcomandos da CLI (`node bin/career-bounty.mjs <comando> [--json]`):

| Grupo | Subcomandos |
|---|---|
| Ambiente | `setup`, `doctor`, `help`, `plugin validate`, `privacy scan` |
| Vagas | `collect`, `digest`, `daily-run`, `schedule`, `destinos`, `compare-radar` |
| Base de carreira | `kb`, `quadrantes`, `entrevista`, `mentor`, `report` |
| Currículos | `cv gerar`, `cv gate`, `cv perfil-portal` |
| Candidaturas | `apply plan`, `apply preparar`, `apply lote`, `apply envio`, `apply comprovante`, `apply desfecho` |
| Gupy | `gupy perfil iniciar`, `propor`, `confirmar`, `encerrar` |
| E-mail | `mail` |
| Dados | `migrate`, `project`, `verify`, `panel`, `eval` |

Com `--json`, a saída, inclusive erro, sai como JSON no stdout. Erro de uso termina com código 2.

## Configuração <!-- sec:configuracao -->

A configuração pessoal vive só em `DATA_ROOT/config.yml`. Veja `config.example.yml`. Os padrões são seguros:

| Chave | Padrão | Efeito |
|---|---|---|
| `envio.padrao` | `parar_antes_de_enviar` | Toda candidatura para antes do clique final |
| `envio.regras` | `[]` | Regras de envio automático por portal (em desenvolvimento) |
| `gupy.aceite_termos` | `false` | Sem aceite, a rota Gupy recusa |
| `gupy.max_por_dia` | `5` | Teto diário de envios na Gupy |
| `cv_skip_portals` | `["gupy"]` | Portais que não recebem PDF anexado |
| `fontes.linkedin_guest.ativo` | `false` | Coletor guest do LinkedIn desligado |
| `panel.port` | `8880` | Porta do painel local |

## Arquitetura <!-- sec:arquitetura -->

| Camada | Onde | Papel |
|---|---|---|
| Interface | `commands/`, `skills/`, `panel/`, `hooks/` | Entradas finas: chamam a CLI ou delegam a subagentes |
| Subagentes | `agents/` | Trabalho de linguagem com modelo e ferramentas explícitos; devolvem JSON validado |
| Núcleo | `core/` | Lógica determinística, testável sem rede e sem modelo |
| Dados | `DATA_ROOT` | Configuração, base, eventos, projeções e artefatos, fora do git |

Módulos do núcleo:

| Módulo | Responsabilidade |
|---|---|
| `store` | Log de eventos, locks e projeções |
| `sources`, `radar`, `dedup`, `score` | Coleta, deduplicação, filtros e nota |
| `kb` | Fontes de conhecimento e afirmações |
| `cv` | Seleção de afirmações, renderização, PDFs e gates |
| `apply` | Fila, banco de respostas, preenchimento, aprovação, política e drivers |
| `browser` | Cliente CDP mínimo para o Chrome ou o Edge, sem Playwright |
| `mail` | Contrato, classificação e efeitos do e-mail |
| `llm` | Execução de subagentes nos modos fake, replay e live |
| `hooks` | Decisões dos hooks do Claude Code |
| `privacy`, `plugin`, `doctor` | Varredura de privacidade, validação do pacote e diagnóstico |
| `migration`, `schedule`, `eval` | Importação do legado, rotina diária e avaliação dos agentes |

Os hooks são a barreira de segurança. Eles não dependem do modelo obedecer:

- **PreToolUse:** nega escrita no Gmail. Na aba de candidatura, nega clique por coordenada, Enter e script que não
  seja do CareerBounty, e libera o envio só com aprovação válida. Na aba de perfil, libera só o item aprovado.
- **PostToolUse:** registra o que a página realmente mostrou (etapa da Gupy, leitura do perfil). O modelo não
  declara esses estados.
- **UserPromptSubmit:** reconhece a frase do lote e a aprovação de perfil, digitadas por você.
- **SessionStart:** resume as pendências ao abrir a sessão.

Decisões de desenho estão em [docs/adr/](docs/adr/), e o detalhe das camadas e das fronteiras de teste está em
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Segurança e limites <!-- sec:seguranca -->

- O envio nunca acontece sem a frase do lote digitada por você. A aprovação vale para uma vaga, por 2 horas, uma vez.
- Tentativa com resultado incerto não é repetida: fica pendente até o e-mail ou você confirmar.
- Testes, vídeos e agendamentos ficam sempre com você.
- O painel só escuta em loopback, com CSP restritiva e token efêmero.
- O modelo nunca roda em `npm test`; os testes usam saídas fabricadas e gravações reproduzíveis.

## Privacidade <!-- sec:privacidade -->

Nada pessoal entra no git. Um pre-commit bloqueia CPF, telefone, caminho de usuário, valores da sua identidade e
empresas da sua denylist, e `privacy scan --all` varre o repositório inteiro. Veja [PRIVACY.md](PRIVACY.md).

## Estado do projeto <!-- sec:estado -->

| Parte | Estado |
|---|---|
| Fundação, migração em modo sombra, radar, base de carreira e e-mail | Implementados |
| Currículos com gates | Implementados |
| Candidatura assistida, perguntas no painel e perfil e candidatura na Gupy | Implementados |
| Envio automático por política (formulários de ATS) | Em desenvolvimento |
| Corte da migração (o CareerBounty passa a ser o escritor oficial) | Pendente |

Enquanto a migração está em modo sombra, a coleta real e a rotina diária só rodam com `--dry-run`, e o painel recusa
gravações.

## Desenvolvimento <!-- sec:desenvolvimento -->

`npm test` roda a suíte com `node --test`. Cada fatia começa pelo teste que prova o critério de aceite. Veja
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) e [docs/SETUP.md](docs/SETUP.md).

## Licença <!-- sec:licenca -->

MIT. Veja [LICENSE](LICENSE) e [NOTICE](NOTICE).
