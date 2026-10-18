# Primeira execução e migração

Este guia leva uma pasta recém-criada ao uso real. Há dois caminhos, conforme você tenha ou não um pipeline de vagas
antigo para trazer.

## Diagnóstico

Em qualquer ponto, `node bin/career-bounty.mjs doctor` diz o que falta, sem alterar nada. Linhas que importam:

- `data_root`: a pasta privada existe.
- `identidade`: `identity.yml` preenchido, para o pre-commit proteger os seus dados.
- `migracao`: estado da gravação (`ativo` é o normal; `shadow` aguarda o corte).
- `cv_perfil`: `cv/perfil.json` preenchido (necessário para `cv gerar`).
- `envio`, `kill_switch`: envio automático desligado e kill switch fora do ar, a menos que você tenha mudado isso.

## Caminho A: instalação nova

1. `node bin/career-bounty.mjs setup` cria `DATA_ROOT` já em modo ativo, com projeção vazia.
2. Preencha `identity.yml` e `config.yml` (veja o [README](../README.md#primeiros-passos)).
3. Alimente `kb/` e rode `kb sync`.
4. Crie `cv/perfil.json` (e a foto, `cv/foto.jpg` ou `.png`, se quiser) conforme [CV.md](CV.md).
5. `collect --dry-run` para ver o que a coleta traria; depois `collect`, e abra o `panel`.
6. `cv gerar --vaga <id>` para uma vaga de alta aderência, e confira o PDF visual e o ATS no painel.

Não há nada a migrar nem corte a fazer.

## Caminho B: trazer um pipeline antigo

Use este caminho se você já tinha um `pipeline-vagas.json` de uma ferramenta anterior.

1. `node bin/career-bounty.mjs setup --com-legado` cria a pasta sem iniciar o estado, e você aponta `legado_path`,
   `legacy_assets` e `legacy_materials` no `config.yml` (veja [SETUP.md](SETUP.md)).
2. `migrate --dry-run --diff` inventaria sem escrever; `migrate` importa em **modo sombra** (o legado continua o dono
   dos dados e o painel só consulta).
3. Use por alguns dias e confira: `verify --json` precisa dar `equal: true`.
4. Quando estiver seguro, `migrate --corte --confirmar-corte` passa para o modo ativo. O corte só acontece se a
   projeção bate com o log **e** o legado em disco ainda é exatamente o que foi importado (se mudou, rode
   `migrate --shadow` de novo). Depois do corte, o CareerBounty é o escritor oficial.
5. Confirme com `doctor`: `migracao` deve mostrar `Modo ativo`.

Atenção: depois do corte, reimportar o legado apagaria marcações feitas no painel, então o programa recusa; o caminho
de volta é `migrate --rollback`.

## Operação

- **Radar diário:** `daily-run --dry-run` mostra se rodaria agora; `schedule` gera a tarefa agendada do Windows.
- **Candidatura assistida:** comandos `apply`, protegidos pelos hooks. Nada é enviado sem a frase do lote.
- **Gupy:** exige `"gupy": { "aceite_termos": true }` no `config.yml` e opera por `gupy perfil` e a skill
  `gupy-candidatar`.
- **Envio automático (ATS públicos):** desligado por padrão (`envio.regras: []`). Quando houver um comando que o
  dispare, ele só atua dentro dos limites das regras que você escrever. O kill switch vale desde já:

  ```sh
  node bin/career-bounty.mjs envio pausar --motivo "pausa de segurança"
  node bin/career-bounty.mjs envio retomar
  node bin/career-bounty.mjs envio audit --dia 2026-10-18
  ```
