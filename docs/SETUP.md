# Preparação e retomada

## Contrato

Pedido: preparar o CareerBounty, executar a migração para sua estrutura própria
e registrar uma retomada para o Claude.
Entrega: CLI inicial, CI mínima, importador idempotente, backup verificado,
log por host, projeção integral, exportação reversível e painel em modo sombra.
Fora de escopo: corte definitivo, alteração da rotina de origem, porte completo
do processamento/renderização, conectores, envio de candidaturas e publicação.

## Estado desta preparação

As fatias F0 a F7 estão implementadas: fundação e pacote público, instalação nova e demonstração, migração em modo sombra
com ferramenta segura de corte (`migrate --corte`), radar e fontes, leitura de e-mail, base de carreira, currículos com
gates, candidatura assistida (inclusive perfil e candidatura na Gupy) e o motor de envio automático por política com
drivers (Greenhouse, Lever, Ashby), kill switch e auditoria de decisões. O motor ainda não tem comando que o dispare.

Execute `npm test` com Node >=20 para verificar a base. A CI roda Node 20 em Windows e Ubuntu.

O roteiro de primeira execução, para instalação nova ou para quem traz um pipeline antigo, está em
[PRONTIDAO.md](PRONTIDAO.md).

## Configuração e uso

`DATA_ROOT` seleciona a pasta privada; sem a variável, usa `.career-bounty` no
diretório inicial do usuário. Ela deve ficar fora de repositórios e das origens.
O programa exige `config.yml` nessa pasta, escrito como JSON válido (subconjunto
de YAML); outras sintaxes YAML são recusadas com mensagem explícita.

Campos necessários: `legado_path` aponta para `pipeline-vagas.json`,
`legacy_assets` para a pasta vizinha `busca-vagas` e `legacy_materials` para a
raiz de currículos. Os três caminhos são absolutos e privados.
`panel.port` é opcional (8880). `panel.base_files` lista PDFs relativos à raiz
de currículos autorizados no painel; por padrão, a lista é vazia.

1. `node bin/career-bounty.mjs migrate --dry-run --diff --json` inventaria sem escrita.
2. `node bin/career-bounty.mjs migrate --json` cria o snapshot e publica log,
   projeção e estado de sombra, nessa ordem.
3. `node bin/career-bounty.mjs verify --json` compara a projeção com o log.
4. `node bin/career-bounty.mjs project --json` reconstrói a projeção pelo log.
5. `node bin/career-bounty.mjs migrate --rollback --out <arquivo-novo-privado> --json`
   exporta o documento integral sem sobrescrever arquivo existente ou origem.
6. `node bin/career-bounty.mjs migrate --corte --confirmar-corte` conclui o corte
   e passa a gravação de candidaturas para o modo ativo (exige paridade estrita).
7. `node bin/career-bounty.mjs panel --port 8880` inicia o painel local de consulta.

O snapshot preserva os arquivos privados em `backups/`, com manifesto de tamanhos
e SHA-256. O log fica em `events/`; a projeção, em `projections/`.
O importador recusa links simbólicos/junctions, redução de IDs e origens alteradas
durante a cópia. Uma importação idêntica não acrescenta evento; materiais alterados
podem criar outro snapshot sem duplicar o evento do documento.

Erros CLI terminam com código 2. Em `--json`, a saída, inclusive erro, vai como JSON
no stdout; comparação divergente retorna código 1. O painel aceita apenas loopback,
exige token nas APIs protegidas e responde 409 às gravações autenticadas em sombra.

Base de conhecimento (afirmações, quadrantes, entrevista e mentor): `kb sync`, `quadrantes`,
`kb suggest`, `entrevista`, `mentor contexto` e `vault plan`. As fontes vêm de `DATA_ROOT/fontes.yml`
e a descrição completa está em [KNOWLEDGE.md](KNOWLEDGE.md).

Currículos (dois PDFs com gates e proposta de perfil de portal): `cv gerar --vaga <id>` e `cv gate --vaga <id>`.
O perfil de CV fica em `DATA_ROOT/cv/perfil.json`, os PDFs saem do Chrome ou Edge instalados e a descrição completa
está em [CV.md](CV.md).

Candidaturas: `apply plan`, `apply iniciar`, `apply preparar`, `apply lote`, `apply envio`, `apply comprovante` e
`apply desfecho`, conduzidos pela skill `aplicar` e protegidos pelos hooks. Perfil da Gupy: `gupy perfil iniciar|propor|confirmar|encerrar`,
descrito em [GUPY-PERFIL.md](GUPY-PERFIL.md).

Envio por política e Kill Switch: `envio pausar [--motivo "..."]`, `envio retomar` e `envio audit [--dia YYYY-MM-DD]`.
O kill switch cria `DATA_ROOT/envio.pausado` e bloqueia instantaneamente qualquer envio no driver e no hook PreToolUse.
Diagnóstico completo: `node bin/career-bounty.mjs doctor`.

## Retomar

1. Confira a branch e o estado do Git; preserve alterações existentes.
2. Leia o handoff do projeto e localize o plano de implementação existente.
3. Confira as decisões pendentes antes de implementar o teste da primeira fatia.
4. Atualize o handoff com arquivos alterados, comandos, resultados e próximo passo.

## Limites de validação

- O manifesto do plugin passa em `plugin validate` e em `claude plugin validate .`; a instalação
  local pelo marketplace ainda não foi exercitada.
- O processamento/renderização equivalente e eventos granulares continuam pendentes.
- A sincronização da pasta privada entre máquinas não está configurada por este setup.
- O corte definitivo exige cinco dias úteis reais com diff zero, teste de escrita
  em dados sintéticos e decisão explícita de congelar o escritor anterior.
- A publicação do repositório e a primeira versão (0.2.0) são manuais e ficam a cargo de quem mantém o projeto.
- O setup global de skills não foi executado; o comando citado nas regras não
  está disponível no catálogo desta sessão.
