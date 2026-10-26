# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento semântico; antes da 1.0,
mudanças de comportamento podem acontecer entre versões menores.

## [Unreleased]

## [0.3.2] - 2026-10-26

Correções do painel e do perfil da Gupy encontradas no uso real.

### Corrigido

- **Rolagem da aba Vagas.** A roda do mouse não rolava a lista nem o detalhe: os dois cresciam com o conteúdo e o
  `overscroll-behavior: contain` impedia que a rolagem passasse para a página. A tela de vagas agora ocupa a altura da
  janela, e a lista e o detalhe rolam por dentro. No celular, segue a rolagem da página.
- **Perfil da Gupy com "Salvar" desabilitado.** A página "Meu currículo" passou a mostrar o "Salvar" da seção Habilidades
  visível e desabilitado. A proteção tratava isso como alteração pendente e recusava editar a experiência. Agora só conta
  "Salvar" habilitado.

### Alterado

- **Filtro padrão "Ainda não me candidatei".** O painel abre, e "Limpar filtros" volta, mostrando só as vagas em que você
  ainda não se candidatou.
- **Nome do PDF ao salvar.** O CV chega como `Empresa-Vaga-Nome.pdf` (o visual com " (visual)"), sem caracteres que o
  Windows recusa nem emoji. O nome vem de `nome_arquivo` em `DATA_ROOT/cv/perfil.json` (ou de `cabecalho.nome`); o PDF
  continua abrindo na aba.

## [0.3.1] - 2026-10-18

Correções do painel encontradas no primeiro uso real.

### Corrigido

- **Fichas de aderência ignoravam os filtros.** Alta, Boa, Condicional, Baixa e Incompatível mostravam o total de todas as
  vagas. Agora cada ficha conta as vagas que passam nos outros filtros (candidatura, descartadas, modalidade, regime,
  portal e busca), pela mesma regra da lista. Com "Ainda não me candidatei", os números caem para o que ainda resta.
- **Currículo e provas não listava os itens.** O painel mostrava "23 sem prova, 30 fora do CV, 6 lacunas" e, ao abrir o
  grupo, caía em "Painel desconectado". A causa era um erro de JavaScript ao desenhar cada item (`badgesHtml is not
  defined`), escondido por uma mensagem de conexão. Os itens aparecem, com os selos de prova (nível, peso, afirmação e
  evidência).
- **Erro de tela e falha de rede não se confundem mais.** "Painel desconectado" aparece só quando a rede falha; um erro ao
  desenhar a lista aparece como "Erro ao exibir os itens", e o detalhe vai para o console.
- **Recado da coruja contraditório.** Na aba Currículo e provas ela dizia "Ainda não há currículo e base para comparar"
  ao lado de itens pendentes, porque lia a análise com os nomes da resposta bruta da API e não com os da tela. Agora diz
  quantas lacunas e itens sem prova existem.
## [0.3.0] - 2026-10-18

Painel novo e acompanhamento dos processos seletivos.

### Adicionado

- **Painel novo** (visual "Misto"): placa com abas e contadores, temas claro e escuro, fundo em pixel que para com
  `prefers-reduced-motion`, coruja batedora com recado factual por aba e fontes servidas localmente.
  - **Vagas:** agrupadas por aderência, com detalhe ao lado, nota da empresa, currículos da vaga e atalhos J/K/A/D/O.
  - **Histórico:** linha do tempo de cada candidatura.
  - **Processos:** quatro estações por processo, contatos, o que pede acompanhamento e preparação para entrevista.
  - **Currículo e provas:** matriz com ações que movem cada item. Substitui Quadrantes.
  - **Menu ⋯:** respostas de formulário (pendentes e salvas), fontes da rodada, perfil do LinkedIn e pausa do fundo.
- **Contatos com recrutadores:** `contato registrar|listar|vincular|remover|sugerir`. O rascunho de resposta vai para
  `outbox/` e nunca é enviado. Telefone e e-mail são mascarados antes de qualquer tela.
- **Processos e lembretes:** `processo etapa|encerrar` e `acompanhamento pendentes`, com aviso aos 5 dias e lembrete aos 7
  dias sem movimento. O resumo do dia (`digest`) inclui a lista.
- **Avaliação da empresa:** evento `empresa.avaliada` por empresa, válido por 90 dias. Comandos `empresa registrar` e
  `empresa avaliar --resultados`, e o comando `/empresa`, que pesquisa na web pelo Claude Code. Sem scraping e sem nota
  sem fonte.
- **Análise do currículo contra a base:** `analise listar|incluir|marcar|lacuna`, com as rotas do painel.
- **Preparação para entrevista:** `entrevista preparar` (ou `preparar-entrevista`) e `entrevista simular`.
- **Perfil do LinkedIn:** `cv perfil-portal --portal linkedin`, com campo título e limites do LinkedIn.
- **Preferência de modalidade:** `radar.criterios.modalidades` e `modalidade_preferida`, perguntadas no `/setup` e gravadas
  pelo comando `preferencias`.
- **Outros agentes:** `AGENTS.md` para Codex e Antigravity e capturas do README geradas por `scripts/capturas-readme.mjs`.

### Corrigido

- **Interface antiga com dados migrados:** o painel mostrava a interface antiga para quem migrou de um pipeline antigo,
  mesmo depois do corte.
- **Fonte das avaliações migradas:** a migração trocava a fonte real (URL em texto do legado) pelo link da vaga. Agora
  preserva a fonte e não migra avaliação sem ela.
- **Avaliação sem busca:** chamava o modelo sem nenhum resultado de busca. Agora recusa antes da chamada.
- **História STAR inventada:** a preparação para entrevista preenchia com texto pronto a parte da história que faltava, e
  contava requisito sem avaliação como ponto forte.
- **Recado da coruja:** "Currículo 100% comprovado" aparecia quando não havia nenhum item para comparar.
- **Filtro de região:** vaga com a cidade da região no título ("RJ, SP ou BH") era descartada.
- **Teste com relógio:** um teste do perfil Gupy passava a falhar quando o vínculo vencia pela hora real.
## [0.2.0] - 2026-10-18

Primeira versão para uso real.

### Adicionado

- `setup` agora deixa uma instalação nova pronta: estado ativo, projeção vazia, painel e coleta funcionando.
  `setup --com-legado` preserva o caminho de quem vai migrar um pipeline antigo.
- `demo`: monta uma pasta descartável com uma persona fictícia e seis vagas de exemplo para experimentar o painel sem
  tocar nos seus dados.
- Envio automático por política em formulários públicos (Greenhouse, Lever, Ashby): regras validadas, limite diário por
  regra e global, driver sem login nem cookies, kill switch (`envio pausar|retomar|audit`), aprovação amarrada ao hash do
  PDF e das respostas e desfecho incerto que trava a vaga. Desligado por padrão.
- `migrate --corte`: sai do modo sombra só se o legado em disco ainda é o que foi importado.
- README profissional (português e inglês), `docs/PRONTIDAO.md` e este changelog.

### Corrigido

- Testes do painel usavam a data em UTC e falhavam entre 21h e 24h em São Paulo.
- Envio automático (achados da revisão independente do PR #8): contexto ausente passa a negar a política; o driver só
  aceita `https` nas origens do portal e reconfere a origem antes do clique; o kill switch e o token são conferidos de
  novo logo antes do clique; o PDF é reconferido por hash na hora do clique; resultado incerto ou sem comprovante
  consome o limite e impede reenvio; o limite global passa a valer; `dryRun` é o padrão do orquestrador.
- `hooks/pre-tool-use`: espera a negação ser escrita antes de sair.
- `envio audit`: valida `--dia` e informa com clareza se o envio está pausado.
- `doctor`: instalação nova e `career-ops` ausente deixam de ser avisos.
- CI: actions fixadas por SHA de commit; `id` escapado na regex de `aprovarPendente`.

## [0.1.0] - 2026-10-17

Fatias F0 a F6: fundação e pacote público, migração em modo sombra, radar e fontes, e-mail pelo conector do Gmail,
base de carreira (quadrantes, entrevista e mentor), currículos com gates e candidatura assistida, incluindo perfil e
candidatura na Gupy.
