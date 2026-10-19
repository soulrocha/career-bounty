# CareerBounty para agentes (Codex, Antigravity e outros)

O CareerBounty é um plugin do Claude Code, mas toda a lógica está numa CLI em Node que qualquer agente pode rodar:
`node bin/career-bounty.mjs <comando> [--json]`. Com `--json`, a saída (inclusive erro) sai como JSON no stdout.

## O que você pode fazer com a CLI

| Tarefa | Comandos |
|---|---|
| Diagnóstico | `doctor`, `preferencias` (sem opções mostra a preferência de modalidade) |
| Buscar vagas | `collect --dry-run` (simula), `collect` (grava), `digest` |
| Rotina diária | `daily-run --dry-run`, `daily-run` |
| Currículos | `cv gerar --vaga <id>`, `cv gate --vaga <id>`, `cv perfil-portal --portal gupy\|linkedin` |
| Processos | `contato registrar\|listar\|sugerir\|vincular\|remover`, `processo etapa\|encerrar`, `acompanhamento pendentes` |
| Empresas | `empresa registrar`, `empresa avaliar --resultados <arquivo.json>` |
| Base e entrevista | `analise listar\|incluir\|marcar\|lacuna`, `preparar-entrevista --vaga <id>`, `entrevista simular --vaga <id>` |
| Painel | `panel` (abre em `http://127.0.0.1:8880`) |

Comandos que chamam modelo aceitam `--replay <pasta>` (sem custo) ou `--live`. Rode `--live` uma vez por pedido.

## Regras de segurança (obrigatórias)

1. **Os dados da pessoa ficam em `DATA_ROOT`** (padrão `~/.career-bounty`), fora do repositório. Nunca copie nada de lá para
   o repositório, para um commit ou para fora da máquina.
2. **Teste manual nunca grava no `DATA_ROOT` real.** Use uma pasta temporária: `DATA_ROOT=<pasta temporária>` (PowerShell:
   `$env:DATA_ROOT = "$env:TEMP\cb-teste"`) ou `node bin/career-bounty.mjs demo --pasta <pasta>`.
3. **Nada é enviado em nome da pessoa.** Não envie e-mail, mensagem, candidatura nem formulário. O CareerBounty gera
   rascunhos em `DATA_ROOT/outbox/`; quem envia é a pessoa.
4. **Candidatura assistida só no Claude Code.** Ela depende de hooks que exigem a frase do lote digitada pela pessoa e
   liberam uma vaga por vez. Fora do Claude Code esses hooks não existem: não rode `apply lote` nem `apply envio`.
5. **LinkedIn:** use os alertas de vaga que chegam ao e-mail (fonte `linkedin_alertas`). O coletor guest vem desligado e
   exige `aceite_termos: true` no `config.yml`, porque pode violar os termos de uso; não o ligue por conta própria. Nunca
   automatize uma sessão logada do LinkedIn, da Gupy ou de qualquer portal em nome da pessoa.
6. **Nota de empresa só com fonte.** Faça a pesquisa na web, grave os resultados num JSON e passe com `--resultados`. Não
   raspe o Glassdoor nem invente nota.

## Se você for alterar o código

- Leia `CLAUDE.md`, `docs/SETUP.md` e `docs/ARCHITECTURE.md`. Uma mudança por PR, com teste escrito antes do código.
- Estado novo é evento no log (`core/store/events.mjs`, só acréscimo), com validação em `core/store/rules.mjs` e entrada no
  `docs/GLOSSARY.md`. Para desfazer, grave outro evento; nunca edite o log.
- Sem dependência npm nova e sem CDN. Datas pelo dia de São Paulo (`localDay`). Processo filho em teste recebe o mesmo
  `CAREER_BOUNTY_NOW`.
- Antes do PR: `npm test -- --test-concurrency=4` sem falha nem skip, `node bin/career-bounty.mjs privacy scan --all` e
  `node bin/career-bounty.mjs plugin validate`. Testes e docs só com dados fictícios.
