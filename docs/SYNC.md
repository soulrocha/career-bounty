# Base central (sincronização entre computadores)

O CareerBounty roda em cada computador, com uma cópia local do `DATA_ROOT`. Um servidor seu, acessível por SSH,
guarda a base central. `career-bounty sync` troca só o que mudou desde a última rodada, e o painel de cada
computador mostra o mesmo estado.

Requer Node >=20 no servidor e acesso por chave SSH sem senha (o comando roda com `BatchMode=yes`).

## Como funciona

- O log de eventos tem um arquivo por dia e por host (ADR-2). Por isso, os dois computadores nunca escrevem
  no mesmo arquivo. O nome do computador (hostname) precisa ser diferente em cada um. Se um log de eventos
  aparecer em conflito (base perdida ou hostname repetido), as linhas dos dois lados são unidas e nenhum evento
  se perde.
- A rodada usa um plano de três vias: compara a cópia local, o servidor e a base (o hash de cada arquivo na
  última rodada). Quem mudou desde a base envia ou recebe.
- Nos outros arquivos, quando os dois lados mudaram o mesmo arquivo, a versão do servidor vence. A versão local
  fica ao lado, como `<arquivo>.conflito-<host>-<carimbo>`. O aviso aparece em `sync status`, nos hooks e no
  rodapé do painel até você resolver e apagar a cópia.
- Um arquivo apagado de um lado só é apagado do outro se lá ele continuar igual à base. Nada some de verdade:
  o arquivo vai para `.sync/lixeira/<carimbo>/`. A rodada recusa apagar mais de 10 arquivos e mais de 1/4 do
  total sem `--permitir-apagar`.
- O servidor grava com compare-and-swap: só sobrescreve se o arquivo ainda tem o hash esperado.
- Arquivos que não sincronizam: `projections/` (refeita depois de receber eventos), `cache/`, `logs/`,
  `secrets/`, `rollback-backups/`, locks, temporários, cópias `.bak`, o lançador do painel, a configuração do
  leitor de e-mail, o estado de cada máquina (`state/sessao-candidatura.json`, `state/aprovacoes.json` e
  `state/orcamento-*.json`) e os snapshots em `backups/`, exceto o do estado atual (o painel serve os currículos antigos
  a partir dele). Também ficam de fora pastas e arquivos ocultos, inclusive `.sync/`.

O `identity.yml` (os seus dados reais usados pela guarda de privacidade) e a base de conhecimento sincronizam:
o servidor guarda dado pessoal. Use um servidor só seu, com acesso por chave.

## Instalação

No servidor: instale o Node, copie o aplicativo e crie a pasta de dados, fora de repositórios e com permissão
só para o seu usuário (por exemplo, `chmod 700`).

Em cada computador (no PowerShell 5.1, escape as aspas do JSON com `\"`; no Git Bash, use `MSYS_NO_PATHCONV=1`
para a raiz não virar caminho do Windows). O comando aceito é só o `ssh`, com as opções `-o` BatchMode,
ConnectTimeout e ServerAlive*, o destino `usuario@host` e o node e o CLI remotos. Os hooks e o painel executam esse
comando sem pedir permissão, e por isso a validação é estrita.

```
career-bounty sync configurar --comando-json '["ssh","-o","BatchMode=yes","usuario@servidor","/caminho/node","/caminho/app/bin/career-bounty.mjs"]' --raiz /caminho/dados
career-bounty sync
```

O primeiro computador envia tudo. Os seguintes recebem tudo e refazem a projeção. Se um computador novo já tem
um esqueleto (`config.yml` vazio do `setup`), a versão do servidor vence, e o esqueleto fica como cópia de conflito.

## Quando sincroniza

- O painel faz uma rodada ao abrir; espera por ela só quando falta o estado ou a projeção, como num computador
  novo. Faz outra a cada `intervalo_s` (padrão 120 s) e outra 3 s depois de cada gravação.
- Os hooks `SessionStart` e `SessionEnd` do plugin fazem uma rodada com prazo de 25 s.
- `career-bounty sync` roda uma rodada à mão. `career-bounty sync status` mostra a última.

Falha de rede nunca derruba o painel nem a sessão. O que você grava fica no computador e sobe na rodada seguinte.
Um arquivo que não sincroniza (travado por outro programa, recusado pelo servidor) vira pendente, com o motivo, em
`sync status`, nos hooks e no rodapé; o resto da rodada segue.

## Lado do servidor

`career-bounty sync-remote <manifest|get|put|del> --raiz <pasta>` é chamado pelo ssh. O fluxo de arquivos usa
quadros: uma linha JSON de cabeçalho seguida dos bytes, e termina com `{"fim":true}`. O servidor mantém um cache
de hashes e a lixeira em `<raiz>/.sync/`, cria tudo com umask 077 e não segue links.
