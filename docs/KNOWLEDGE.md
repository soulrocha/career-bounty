# Base de conhecimento, quadrantes, entrevista e mentor

Esta página descreve a base de afirmações (F4): de onde ela lê, como compara o currículo com os dados, como fecha
lacunas e o que nunca faz. Nenhum dado pessoal e nenhuma empresa real aparece aqui; os exemplos são fictícios.

## Fluxo

1. `kb sync` lê as fontes, monta o snapshot em `DATA_ROOT/state/kb-snapshot.json` e invalida os caches que dependem dele.
2. Cada bullet do modelo de CV leva a marca invisível `<!-- claim:AF-001 -->` ao fim da linha. Bullet sem marca vai para mapeamento.
3. `quadrantes` (ou `kb quadrants`) classifica o que existe em quatro quadrantes e gera a fila de lacunas.
4. `kb suggest` propõe marcas para os bullets sem marca; `/entrevista` fecha lacunas; `/mentor` conversa sobre o resultado.

Tudo é determinístico, exceto três pontos de LLM com contrato JSON validado: `mapeador` (Sonnet), `entrevistador` (Opus)
e a conversa do `mentor` (Opus, somente leitura).

## Fontes

A lista de fontes vem de `DATA_ROOT/fontes.yml`, escrito como JSON (subconjunto de YAML). Sem o arquivo, vale só a pasta `DATA_ROOT/kb`.

```json
{
  "versao": 1,
  "markdown_folder": { "raiz": "kb" },
  "obsidian_vault": {
    "raiz": "/caminho/absoluto/do/vault",
    "contextos_permitidos": ["pessoal"],
    "notas": [
      { "caminho": "resultados/arco-exemplo.md", "papel": "arco" },
      { "caminho": "carreira/banco.md", "papel": "afirmacao" },
      { "caminho": "curriculos/base.txt", "papel": "modelo_cv", "modelo": "base" }
    ]
  },
  "ai_memory": { "workspace": "pessoal", "project": "carreira", "limite": 10 }
}
```

- **markdown-folder** (padrão): `claims/*.md`, `evidence/*.md`, `story-bank/*.md`, `profile/*.md`, `cv/*.md|txt|html` e `claims.local.md`
  (afirmações aprovadas na entrevista). Frontmatter da afirmação: `id` e `nivel_prova` obrigatórios; opcionais `empresa`, `periodo`
  (`AAAA-MM..AAAA-MM`), `uso` (`[CV, LI, Ent]`), `origem`, `publicavel` (`sim`, `com-anonimizacao`, `nao`) e `numeros`.
- **obsidian-vault**: somente leitura. Lê apenas as notas listadas, pelo frontmatter. A raiz vem de `vault_root` em `config.yml` ou
  de `raiz` em `fontes.yml`, nunca do repositório. Nota sem frontmatter, de contexto não permitido, com link simbólico ou maior que
  512 KB é ignorada com aviso. Arcos expõem só `id`, título e `afirmacoes`; o corpo nunca sai do adaptador. O adaptador não tem
  método de escrita.
- **ai-memory**: lê pela API JSON somente leitura (`/api/v1/search`) quando `ai_memory.url` está em `config.yml` e o token em
  `secrets/ai-memory.token`. O resultado é sempre `candidato` de nível `relato`, nunca afirmação. Servidor fora do ar, sem
  `--enable-web` ou sem token: `kb candidatos` degrada com mensagem clara e indica o fallback pelo MCP dentro da sessão.

Precedência em id repetido: a primeira fonte da lista vence e o aviso aparece no `kb sync`.

## Níveis de prova e uso no CV

`verificado` e `entregue` sustentam fato e número. `proposto` e `relato` são pista: nunca valem como fato no CV. Material de
trabalho só chega ao CV pela redação segura da afirmação; `publicavel: com-anonimizacao` bloqueia nome de cliente, colega e sistema
em artefatos, e `publicavel: nao` tira a afirmação de qualquer sugestão de CV.

## Quadrantes

| Quadrante | Regra |
|---|---|
| (a) dado e CV conferem | bullet marcado, todas as afirmações ligadas com prova e todo número do bullet presente nelas |
| (b) dado fora do CV | afirmação com uso `CV`, com prova e publicável que nenhum bullet cita; arco ou história sem afirmação ligada |
| (c) CV sem dado | bullet sem marca, número órfão ou divergente, afirmação `relato` ou `proposto` usada como fato |
| (d) lacuna | afirmação sem evidência, resultado sem linha de base, buraco na linha do tempo maior que 6 meses, requisito frequente de vaga alta ou média sem afirmação |

A fila de lacunas ordena por peso e desempata por tipo e id, então a ordem é estável. Cada lacuna traz uma pergunta sugerida.

## Verificador de números

`core/cv/facts.mjs` confere que todo número do texto existe numa afirmação ligada com prova. Aceita `34%`, `R$ 2,3 mi`, `R$ 12 mil`,
`1.000` e `1,5 mi`; ignora datas, anos, IDs e versões. Arredondamento (34% contra 34,2%) e número inflado falham. Números
escritos por extenso ("dez dias") não são extraídos.

## Comandos

| Comando | O que faz | Escreve em |
|---|---|---|
| `kb sync` | snapshot da base | `DATA_ROOT/state`, `cache` |
| `kb quadrants [--json]` | contagem e itens dos quadrantes | nada |
| `quadrantes` | relatório local dos quadrantes | `DATA_ROOT/reports` |
| `kb suggest --live` ou `--replay <pasta>` | propostas de marcas (uma chamada) | `DATA_ROOT/outbox/marcas` |
| `kb candidatos --consulta <tema>` | candidatos do ai-memory | nada |
| `entrevista lacunas`, `perguntar`, `registrar`, `pendentes`, `aprovar`, `rejeitar` | entrevista de lacunas | `state/entrevista.json`, `outbox/vault`, `kb/claims.local.md` (só em `aprovar`) |
| `mentor contexto` | contexto do mentor | nada |
| `vault plan` | proposta de mudanças no Vault | `DATA_ROOT/outbox/vault/proposta-f4.md` |

`--live` faz uma chamada real ao Claude, cobrada, e não roda na CI. Nos testes o LLM é fake ou replay.

## O que nunca acontece

- Nenhum comando escreve no Vault. `vault plan` só gera texto em `outbox/vault`; não existe `apply`.
- O agente da entrevista só pergunta (no máximo 3 perguntas por item). Pergunta ou texto com número que a pessoa não disse é rejeitado.
- A resposta vira afirmação `relato` pendente, com fonte `entrevista:<data>`, `publicavel: nao`. Só entra em `claims.local.md` com `entrevista aprovar`.
- A identidade fica em `identity.yml` local e é redigida do snapshot, do contexto do mentor, da API do painel e das entradas de LLM.
- O resultado do mentor e das sugestões nunca altera o CV nem a base.

## Painel

A aba **Quadrantes** do painel mostra as quatro contagens e os itens, lendo `GET /api/quadrantes` (exige o token do painel). Os
estados são carregando, sem dados, erro (com tentativa de novo), sem permissão e sucesso. A aba é injetada pelo servidor, então
aparece também em template privado e na página do modo sombra.
