# Protótipos do painel: avaliação

Protótipo descartável. Dados 100% sintéticos (`dados.js`); nada grava nem chama rota real.

**Escolha (18/10/2026): mundo Misto + organização A, com os atalhos da C, e a nota em estrelas identificada como "Glassdoor".** Especificação em [DESIGN.md](DESIGN.md).

## Como abrir

```bash
node panel/prototipos/servir.mjs 8892
```

Abra `http://127.0.0.1:8892/?mundo=misto&variante=A`. A barra preta no rodapé troca a variação (‹ ›, ou as setas do teclado), o mundo e o tema. Parâmetros: `mundo=misto|guilda|linha`, `variante=A|B|C`, `tema=claro|escuro`, `aba=vagas|processos|curriculo|historico|respostas|fontes|linkedin`.

## O que se decide aqui

1. O **mundo visual**: tipografia, paleta, densidade e um gesto próprio.
2. A **organização** da aba Vagas: A Plataforma, B Painel lateral ou C Triagem.

As abas Processos, Currículo e provas e Histórico são as mesmas nas três organizações (a B só troca a barra de cima por um menu lateral).

## Retorno do Google Stitch

| Critério | Resultado |
|---|---|
| Leitura da aderência em 3 segundos | Parcial. Usa porcentagem (94%, 89%) que o sistema não calcula: a aderência é uma categoria. |
| Densidade | Boa no Radar (6 vagas e o detalhe lado a lado). Em Saúde do Currículo, 4 cartões grandes de números no topo empurram o conteúdo. |
| Contraste e tipografia | Fontes quebradas: metade do texto caiu em serifa padrão (Times). Rótulos em verde sobre verde. |
| Termos | Jargão inventado: "RADAR_STREAM: ONLINE", "Cockpit Pro", "Kernel 2.4.0", "Latency 14ms", "Zero Cloud Leak", "Grounding 100% verídico". |
| Dados inventados | "92% recomendam", "8.000+ engenheiros", "ATS Score 96%", sincronização com GitHub, empresas reais. |
| Tema claro | Não entregue. |
| Fundo animado | Não entregue. |
| Ações | "Enviar via Gmail" contradiz a regra do painel (ele não envia nada). |

O que aproveitamos: a lista com detalhe lado a lado, os filtros de aderência com contador, o bloco de currículo condicional (CV visual e ATS lado a lado, perfil Gupy quando o portal é Gupy), o aviso de acompanhamento com ações e a matriz de quatro situações com uma ação por item.

## Primeira rodada, descartada

Três variações com marcador de "barras de sinal". O Saulo vetou o marcador. A revisão pelas regras do Impeccable também mostrou que as três caíam nos visuais típicos de IA que ele lista: papel creme com serifa editorial, preto com um verde-limão fluorescente e grafite com um laranja. Foram descartadas inteiras.

## Mundos visuais

As regras seguidas, do Impeccable para telas de trabalho (modo "Operate"):

- O mundo contribui só com tipografia, paleta, densidade e um gesto próprio.
- Navegação e controles são os padrões da web.
- Sem rótulo pequeno acima de título, sem cartões de números no topo, sem borda colorida grossa na lateral e sem monoespaçada usada como fantasia.
- Cor só com função.
- Algarismos de largura fixa só onde há número em coluna.

### Misto (padrão, recomendado depois da conversa com o Saulo)

A forma do Linha com a personalidade da Guilda. O Saulo achou a forma do Linha mais profissional e agradável: marcadores redondos, plaquetas cheias, barra azul-marinho e chão concreto. Da Guilda ele gostou da personalidade.

- **Do Linha:** barra de placa azul-marinho (#0E2240), chão cinza-concreto, estações redondas ligadas por traço contínuo, plaquetas de cor cheia e o mesmo desenho de controles.
- **Da Guilda:**
  - aderência como raridade: Alta laranja lendário, Boa roxo épico, Condicional azul raro, Baixa comum e Incompatível pobre;
  - ouro (#D9A441) na ação principal, na aba ativa e nas etapas cumpridas de cada processo;
  - a coruja com o recado de cada aba;
  - números de painel em pixel;
  - o céu em pixel sobre a serra, com a serra tingida pelos tokens do tema.
- **Ícone:** `icone.svg`. Ladrilho azul-marinho, moeda de recompensa em ouro e a coruja batedora cunhada em pixel, com o bico laranja de item lendário e um brilho em pixel. É usado na barra e como favicon.

### Guilda

Referência: o Hero Journey do Saulo e o código de raridade do WoW.

- **Aderência como raridade**, uma escala ordenada que se lê sem pensar:

  | Aderência | Raridade | Cor |
  |---|---|---|
  | Alta | lendária | laranja |
  | Boa | épica | roxo |
  | Condicional | rara | azul |
  | Baixa | comum | branco no escuro, grafite no claro |
  | Incompatível | pobre | cinza |

  A cor marca uma gema em pixel ao lado do rótulo, que continua em texto ("Alta aderência").
- **Coruja batedora** em pixel, desenho próprio (o Clawd é mascote da Anthropic e não entra). Fica na barra superior, ou no pé do menu lateral na variação B. Ao abrir cada aba, dá um recado factual por 6 segundos e some ("Selo Bank está há 7 dias sem resposta"). Clicar nela mostra de novo.
- **Processos como cadeia de missão:** etapas cumpridas em ouro e a espera em pontilhado, com os dias contados.
- **Números de painel em fonte pixel** (Pixelify Sans), só nos contadores grandes. Texto corrido e rótulos continuam na Schibsted Grotesk.
- **Fundo:** céu em pixel sobre uma serra, com estrelas que piscam devagar no escuro e nuvens no claro.
- **Ouro** (#D9A441) para a ação principal, a aba ativa e os ornamentos de seção.

### Linha (alternativa)

Referência: a sinalização do Metrô de São Paulo.

- Faixa azul-marinho de placa e chão cinza-concreto.
- Cor de linha por aderência: verde, azul, amarela, prata e vermelha.
- Gesto próprio: o diagrama de linha. As vagas são estações ligadas por um traço na cor da linha, e cada processo é uma linha com quatro estações.
- Fundo: mapa de linhas apagado com trens passando.

Ressalva: no tema claro, o traço amarelo fica abaixo de 3:1 contra o branco. A informação não se perde porque o rótulo em texto acompanha sempre.

## As três organizações da aba Vagas

Medido no navegador do app em 1024×768, mundo Guilda, tema escuro.

| Critério | A Plataforma | B Painel lateral | C Triagem |
|---|---|---|---|
| Leitura da aderência em 3 s | Boa: grupos por aderência com título colorido e gema | Média: gema e rótulo por linha, mas a tabela pode ser reordenada e perder o agrupamento | Boa na fila; o palco mostra uma vaga por vez |
| Densidade | 8 vagas visíveis com o detalhe aberto ao lado | 9 linhas e 6 colunas; com o detalhe aberto, ficam 2 colunas | 1 vaga inteira e 8 na fila |
| Tarefa diária (ler, decidir, abrir CV) | Clique na lista e o detalhe aparece ao lado, sem perder a lista | Melhor para comparar salário, nota e modalidade lado a lado | Mais rápida para zerar a fila: J/K andam, A marca candidatura, D descarta, O abre |
| Contraste WCAG AA | Todo texto passa de 4,5:1 nos dois temas dos dois mundos (script de verificação sobre os tokens) | igual | igual |
| Tela estreita (375 px) | Lista e, ao tocar, o detalhe em tela cheia com "Voltar"; sem rolagem lateral | O menu vira barra no topo e a tabela vira lista | A fila some e fica só o palco |
| Fundo animado | Céu ou mapa: 0,2 ms por quadro (p95), 30 quadros por segundo; para com a aba oculta e fica parado com `prefers-reduced-motion` ou pelo menu ⋯ | igual | igual |

### Recomendação

**Misto + A (Plataforma), com os atalhos de teclado da C.**

- A A é a única que deixa a lista e o detalhe visíveis juntos sem sacrificar colunas, e o agrupamento por aderência responde "o que vale meu tempo hoje" antes de qualquer leitura.
- Os atalhos da C (J/K, A, D, O) cabem nela sem custo.
- A tabela ordenável da B pode virar uma opção "ver como tabela" depois, se fizer falta.

## Textos das abas

| Aba | Nome | Subtítulo |
|---|---|---|
| Vagas | Vagas | (sem subtítulo; o contador da aba mostra alta e boa ainda não tratadas) |
| Processos | Processos | Candidaturas em andamento, contatos com recrutadores e o próximo passo de cada uma. O Gmail alimenta a linha do tempo; WhatsApp e LinkedIn você registra aqui. |
| Quadrantes | **Currículo e provas** | Compara o que está no seu currículo com o que a sua base consegue provar. Ajuste os itens aqui; a mudança vale para os próximos CVs. |
| Fila | **Histórico** | Todas as candidaturas e como terminaram. |
| Perguntas | **Respostas de formulário** (menu ⋯ e fim de Processos) | Perguntas dos formulários de candidatura que o banco de respostas ainda não cobre. A candidatura assistida usa o que você salvar aqui. |
| — | Fontes e cobertura (menu ⋯) | De onde vieram as vagas da rodada. |
| — | Perfil do LinkedIn (menu ⋯) | Ferramenta secundária, fora das abas principais. |

As quatro situações de Currículo e provas formam uma matriz "está no CV × tem dado":

| | Tem dado que prova | Não tem dado |
|---|---|---|
| **Está no CV** | Confere | Sem prova |
| **Fora do CV** | Fora do CV | Lacunas |

Cada item tem ações que o movem de célula:

- Sem prova: "Salvar prova" ou "Tirar do CV".
- Fora do CV: "Incluir no CV" ou "Não usar".
- Lacunas: "Tenho essa experiência" ou "Não tenho".

## Dados que a interface usa

Sobre os nomes combinados com a sessão principal (`empresa_avaliacao` e as rotas `/api/processos`, `/api/contatos`, `/api/acompanhamento`, `/api/historico` e `/api/analise-curriculo`), a interface ainda pede estes campos fora da lista:

- **Recência da vaga** (`vista_ha` no protótipo): hoje só existe `consultado_em`. Uma data de publicação, quando o portal der, seria melhor.
- **`perfil_gupy`** na vaga (`campos`, `resumo`), para mostrar a proposta de perfil no lugar dos PDFs quando o portal é Gupy.
- **Processo:** `etapa` (aguardando, em_conversa, entrevista, devolutiva, encerrado), `ultima_interacao`, `proxima_etapa {tipo, data}`, `devolutiva`, e `eventos[] {data, canal, origem: gmail|manual, resumo}`.
- **Contato:** `nome`, `papel`, `canal` (email, whatsapp, linkedin), `endereco` e `ultimo_contato`. O número de WhatsApp não aparece na tela.
- **Análise do currículo:** cada item com `texto`, `afirmacoes[]`, `evidencias[]`, `nivel_prova`, `motivo`, `pergunta` e `peso`.
- **Estado do radar** na barra: hora da rodada e quantidade de anúncios na fila de leitura.

## Pendente

- Escolha do Saulo (mundo e organização).
- Fontes locais no painel real: o protótipo usa Google Fonts; o painel roda local e deve servir os arquivos de Schibsted Grotesk e Pixelify Sans.
- Após a escolha: documento final de tokens e componentes, e retirada das variações perdedoras.
