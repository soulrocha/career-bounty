# Privacidade

## Onde ficam os dados

Tudo que é seu vive na pasta privada `DATA_ROOT` (padrão `~/.career-bounty`), fora de
qualquer repositório git:

- `config.yml`: sua configuração pessoal (caminhos, regras de envio, fontes ligadas).
- `identity.yml`: seus dados de identificação, usados só para o pre-commit bloquear vazamento.
- `privacy/denylist.txt`: nomes de empresas reais que não podem aparecer em commits.
- `secrets/`: credenciais e tokens.
- `kb/`: sua base de afirmações e evidências.
- `events/`, `state/`, `projections/`: histórico e estado das candidaturas.
- `artifacts/`, `cache/`, `outbox/`, `templates/`: arquivos gerados.

## O que nunca entra no repositório

Nunca entra no git: `config.yml`, `identity.yml`, `denylist.txt`, `secrets/`, dados de
candidaturas, currículos reais, e-mails, CPF, telefone, caminho absoluto de usuário e
nome de empresa real. O `.gitignore` cobre os arquivos acima e o pre-commit (`.githooks/`)
bloqueia o restante antes do commit. Exemplos e testes usam somente a persona fictícia
em `examples/persona-ficticia/` e empresas fictícias.

## Execução local

O projeto roda na sua máquina. O painel aceita apenas acesso local (loopback) e exige token.
Se você ligar fontes externas ou o conector de e-mail do Claude, os dados trafegam conforme
os termos desses serviços.
