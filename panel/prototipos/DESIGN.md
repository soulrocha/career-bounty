# Painel CareerBounty: visual escolhido

Escolhido pelo Saulo em 18/10/2026: **mundo Misto, organização A (Plataforma), com os atalhos de teclado da C**. Referência viva: `?mundo=misto&variante=A` no protótipo (`node panel/prototipos/servir.mjs 8892`). Como se chegou aqui: [AVALIACAO.md](AVALIACAO.md).

## Ideia

Tela de trabalho, não vitrine. A navegação e os controles são os padrões da web. O mundo visual contribui com quatro coisas:

- **Forma:** a do metrô paulistano. Placa azul-marinho, estações redondas ligadas por um traço e plaquetas de cor cheia.
- **Personalidade:** a do RPG que o Saulo usa nos projetos dele. Aderência como raridade, ouro na ação, uma coruja batedora em pixel e números de painel em pixel.
- **Densidade:** lista e detalhe visíveis juntos.
- **Gesto próprio:** a vaga é uma estação na linha da sua raridade, e o processo seletivo é uma linha de quatro estações que fica dourada conforme avança.

## Tokens

Fonte da verdade: `estilo.css` (blocos `:root`, `[data-tema=…]` e `[data-mundo=misto]…`). Valores do Misto:

| Papel | Claro | Escuro |
|---|---|---|
| Placa (barra superior), igual nos dois temas | `#0E2240`; texto `#FFFFFF` e `#BAC8DC`; realce `#152C50`; borda `#2A4470` | igual |
| Chão | `#E7EBF0` | `#0A111C` |
| Superfícies `sup` / `sup2` / `sup3` | `#FFFFFF` / `#F5F7FA` / `#EBEFF4` | `#111C2C` / `#152236` / `#1B2B42` |
| Bordas | `#D3DAE2`, `#B5C0CC` | `#24354F`, `#34496A` |
| Texto `tx` / `tx2` / `tx3` | `#0E1A27` / `#3F4C5A` / `#556270` | `#E9EEF5` / `#AEBBCC` / `#93A2B6` |
| Ação principal (ouro) | `#D9A441`, texto `#231804` | igual; hover `#E8B758` |
| Foco | `#0455A1` | `#6AA6FF` |
| Situação: ok, atenção, perigo, informação | `#00754E`, `#7A5800`, `#B3261E`, `#145DB8` | `#4FD3A0`, `#F5C518`, `#FF8A7F`, `#72B5FF` |

Aderência como raridade. O traço colore estação, linha e plaqueta; o texto colore rótulos.

| Aderência | Raridade | Traço claro | Texto claro | Traço escuro | Texto escuro | Texto sobre a plaqueta |
|---|---|---|---|---|---|---|
| Alta | lendária | `#E07000` | `#A34C00` | `#FF8A1F` | `#FF9D45` | escuro |
| Boa | épica | `#8A3FD1` | `#7230B3` | `#B26BF5` | `#C493F8` | branco no claro, escuro no escuro |
| Condicional | rara | `#1C6FD6` | `#145DB8` | `#3D9BFF` | `#72B5FF` | branco no claro, escuro no escuro |
| Baixa | comum | `#5E6873` | `#4A5560` | `#D3D9E1` | `#D3D9E1` | branco no claro, escuro no escuro |
| Incompatível | pobre | `#87909A` | `#5F6873` | `#66727F` | `#A3AEBD` | escuro no claro, branco no escuro |

A cor nunca anda sozinha: a plaqueta sempre traz o texto ("Alta aderência").

Contraste verificado sobre os tokens:

- Texto: 4,5:1 ou mais em todas as superfícies, nos dois temas.
- Marcadores gráficos: 3:1 ou mais.

Forma: raios de 4, 6 e 10 px. Sombra só em sobreposições (menu e balão).

## Tipografia

- **Schibsted Grotesk** (400, 500, 600 e 700) para tudo: corpo, rótulos, títulos e números de lista.
  - Escala: 12, 13, 14, 16, 19, 24 e 30 px.
  - Títulos com `text-wrap: balance` e prosa com `pretty`, até 70ch.
- **Pixelify Sans** (500), só nos números de painel: o contador de cada situação em Currículo e provas, os dias sem retorno em Processos e a nota grande da empresa. Nunca em texto corrido, rótulo ou botão.
- **Algarismos de largura fixa** (`tabular-nums`) só onde há número em coluna. No corpo do texto eles deformam ponto e vírgula.
- No painel real, servir as fontes como arquivos locais, porque o painel roda sem depender da internet.

## Componentes

- **Placa:**
  - Ícone, nome e abas com contador. O contador de Processos fica dourado quando há algo a cobrar.
  - Aba ativa sublinhada em ouro.
  - À direita: a coruja, o estado do radar ("Radar das 07:12 · 7 anúncios na fila de leitura"), o botão de tema e o menu ⋯.
- **Ferramentas de vagas:**
  - Fichas de aderência com estação colorida e contador, que ligam e desligam.
  - Busca, modalidade, regime, portal, candidatura, descartadas, "Limpar filtros" e o total.
- **Lista em ramais:**
  - Um ramal por aderência: plaqueta, contador e uma frase do que significa.
  - Cada vaga é uma estação (anel na cor da raridade, cheio quando selecionada ou já candidatada) com cargo em até duas linhas, empresa, modalidade, portal, nota "★ 4,4 Glassdoor" e "há 2 h" ou "✓ candidatada".
  - Descartada: riscada e com estação cinza.
- **Detalhe da vaga:**
  - Plaqueta, empresa e nota do Glassdoor; cargo; alerta de condições quando não batem.
  - Fatos em grade: modalidade, local, regime, salário, portal e quando foi vista.
  - Descrição, por que considerar, lacunas e pendências, e requisitos (atende, em parte, não atende).
  - Currículos desta vaga:
    - CV visual e CV para ATS lado a lado;
    - se o portal é Gupy, a proposta de perfil Gupy no lugar dos PDFs;
    - se o CV está bloqueado, o motivo e um link para Currículo e provas.
  - "A empresa no Glassdoor": nota grande, quantidade de avaliações de funcionários, data da coleta e resumo.
  - Ações: Abrir vaga (ouro), "Já me candidatei" com data, e Descartar.
- **Atalhos na aba Vagas:**

  | Tecla | Ação |
  |---|---|
  | J / K | próxima / anterior |
  | A | marca candidatura |
  | D | descarta |
  | O | abre a vaga |

  Nenhum atalho age dentro de campos de texto.
- **Processo como linha:**
  - Estações Candidatura, Contato, Entrevista e Devolutiva.
  - As cumpridas ficam em ouro; a espera fica pontilhada, com "7 dias" (âmbar a partir de 5 dias, vermelho a partir de 7).
- **Pedem acompanhamento:** contagem de dias, contato e canal, e as ações "Escrever acompanhamento", "Ainda em andamento" e "Encerrar".
- **Detalhe do processo:**
  - Contatos (e-mail, WhatsApp, LinkedIn) e linha do tempo com a origem (Gmail ou Registro).
  - "Registrar contato".
  - Rascunho de acompanhamento com "Copiar" e "Abrir rascunho no Gmail", e o aviso "O painel não envia mensagens".
  - Preparação para entrevista (pontos fortes, pontos de atenção) e devolutiva com link para a lacuna.
- **Matriz de Currículo e provas:**
  - Eixos "Está no CV / Fora do CV" × "Tem dado que prova / Não tem dado".
  - Cores de situação, não de raridade: Confere verde, Sem prova âmbar, Fora do CV azul, Lacunas vermelho.
  - Cada item tem ações que o movem de célula, e a célula de destino pisca uma vez.
- **Coruja batedora:**
  - Pixel 12×12, desenho próprio (não é o Clawd).
  - Ao abrir cada aba, mostra por 6 segundos um recado factual e some. Um losango dourado indica que há recado; clicar mostra de novo.
  - Some em tela estreita, onde o ícone já a representa.
- **Ícone** (`icone.svg`): ladrilho azul-marinho, moeda de recompensa em ouro e a coruja cunhada em pixel com o bico laranja de item lendário. Usado na placa e como favicon.

## Movimento e fundo

- Transições de 180 ms com saída exponencial. Nada de animação de entrada em página.
- **Fundo:**
  - Céu em pixel sobre uma serra tingida pelos tokens: estrelas que piscam devagar no escuro e nuvens no claro.
  - Fica atrás das superfícies opacas, então só aparece nas margens.
  - Desempenho: 30 quadros por segundo, 0,2 ms por quadro no p95. Pausa com a aba oculta.
  - Fica parado com `prefers-reduced-motion` e pelo menu ⋯ ("Parar a animação do fundo").

## Textos das abas

| Aba | Nome | Subtítulo |
|---|---|---|
| Vagas | Vagas | (sem subtítulo) |
| Processos | Processos | Candidaturas em andamento, contatos com recrutadores e o próximo passo de cada uma. O Gmail alimenta a linha do tempo; WhatsApp e LinkedIn você registra aqui. |
| ex-Quadrantes | Currículo e provas | Compara o que está no seu currículo com o que a sua base consegue provar. Ajuste os itens aqui; a mudança vale para os próximos CVs. |
| ex-Fila | Histórico | Todas as candidaturas e como terminaram. |
| ex-Perguntas | Respostas de formulário (menu ⋯ e fim de Processos) | Perguntas dos formulários de candidatura que o banco de respostas ainda não cobre. A candidatura assistida usa o que você salvar aqui. |
| — | Fontes e cobertura (menu ⋯) | De onde vieram as vagas da rodada. |
| — | Perfil do LinkedIn (menu ⋯) | Ferramenta secundária, fora das abas principais. |

## Tela estreita (até 900 px)

- A placa mostra só o ícone, as abas (com rolagem lateral própria), o tema e o menu.
- Vagas: a lista ocupa a tela, e tocar numa vaga abre o detalhe com "Voltar à lista".
- Processos e Currículo e provas: uma coluna.
- Nenhuma rolagem lateral da página em 375 px.

## Dados que a interface pede além do combinado

Lista completa em [AVALIACAO.md](AVALIACAO.md#dados-que-a-interface-usa). Em resumo:

- recência ou data de publicação da vaga;
- `perfil_gupy`;
- campos de processo e de contato;
- `pergunta` e `peso` nos itens da análise;
- estado do radar.
