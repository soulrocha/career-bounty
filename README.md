# CareerBounty <!-- sec:titulo -->

Plugin para Claude Code que organiza a busca de vagas e as candidaturas. Leia antes o
[aviso legal](LEGAL_DISCLAIMER.md): você responde pelos termos de cada site e o envio
automático vem desligado. English: [README.en.md](README.en.md).

## O que é <!-- sec:o-que-e -->

Uma CLI em Node e um conjunto de comandos e agentes do Claude Code. Seus dados ficam numa
pasta privada fora do repositório (`DATA_ROOT`); o repositório traz só código, documentação
e uma persona fictícia de exemplo.

## Instalação <!-- sec:instalacao -->

Requer Node 20 ou superior. Sem dependências npm.

```sh
git clone <endereço deste repositório>
cd career-bounty
npm install
npm test
```

No Claude Code: `/plugin install career-bounty --marketplace soulrocha/career-bounty`.

## Início rápido <!-- sec:inicio-rapido -->

```sh
node bin/career-bounty.mjs setup
node bin/career-bounty.mjs doctor
```

`setup` cria o esqueleto da pasta privada; `doctor` diz o que falta, sem alterar nada.

## Configuração <!-- sec:configuracao -->

`DATA_ROOT` aponta a pasta privada (padrão `~/.career-bounty`). A configuração pessoal vive só
em `DATA_ROOT/config.yml` (JSON válido). Veja `config.example.yml`. Padrões seguros: envio
manual e coletor guest do LinkedIn desligado.

## Privacidade <!-- sec:privacidade -->

Nada pessoal entra no git. Veja [PRIVACY.md](PRIVACY.md). Um pre-commit bloqueia CPF,
telefone, caminho de usuário, valores da sua identidade e empresas da sua denylist.

## Desenvolvimento <!-- sec:desenvolvimento -->

`npm test` roda a suíte (`node --test`). Veja [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licença <!-- sec:licenca -->

MIT. Veja [LICENSE](LICENSE) e [NOTICE](NOTICE).
