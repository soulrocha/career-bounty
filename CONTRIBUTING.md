# Como contribuir

1. Rode `npm install` (instala o hook de pre-commit) e `npm test` com Node 20 ou superior.
2. Trabalhe por teste: escreva primeiro o teste que falha, depois o mínimo para passar.
3. Faça commits pequenos, com mensagens no formato `F0.x: resumo` ou `tipo(área): resumo`.
4. Nunca use dados reais: só a persona fictícia e empresas fictícias (`.test`/`.example`).
   O pre-commit bloqueia CPF, telefone, caminho de usuário e valores de identidade.
5. Não use `--no-verify`.

## Licenças e código de terceiros

O projeto é MIT. Só entra dependência ou código com licença MIT, ISC, BSD ou Apache-2.0.
Código vendorizado vai em `vendor/` com entrada no `NOTICE` (origem e licença MIT).

**Projetos bloqueados:** não copie código do ApplyPilot (AGPL) nem do job-ops (Commons Clause).
Deles só se aproveitam ideias, descritas com as suas palavras e implementadas do zero.
Contribuições com código copiado desses projetos serão recusadas.

## Nome

O nome do projeto não contém "career-ops". Menções a esse projeto como dependência ficam
no `NOTICE`, em `docs/` e no corpo do README.
