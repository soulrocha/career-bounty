# Guia de Prontidão e Primeira Execução (Modo Ativo)

Este documento estabelece o roteiro determinístico para transicionar o CareerBounty do modo sombra para o **modo ativo**, configurando os artefatos necessários para o uso pessoal real.

---

## 1. Pré-requisitos e Diagnóstico

Antes de qualquer ação, execute o diagnóstico completo do ambiente:

```bash
node bin/career-bounty.mjs doctor
```

Critério de prontidão técnica:
- `node`: Node 20 ou superior;
- `data_root`: Diretório `DATA_ROOT` inicializado;
- `identidade`: `identity.yml` preenchido;
- `hooks`: `core.hooksPath` apontando para `.githooks`;
- `migracao`: Estado da migração identificado (`sombra` ou `ativo`);
- `cv_perfil`: Perfil base de currículo validado.

---

## 2. Passo a Passo para o Uso Real

### Passo 1 (B1): Perfil de CV e Foto Pessoal
1. Crie o arquivo `DATA_ROOT/cv/perfil.json` conforme as especificações em [CV.md](CV.md).
2. Adicione sua foto em `DATA_ROOT/cv/foto.jpg` (ou `.png`).
3. Verifique com `node bin/career-bounty.mjs doctor`:
   - A linha `cv_perfil` deve exibir `[ok] Perfil de CV preenchido`.

### Passo 2 (B2): Validação de Geração de CVs
Gere e valide currículos para pelo menos 5 vagas de alta aderência:
```bash
node bin/career-bounty.mjs cv gerar --vaga <vaga-id>
```
1. Verifique se o gate de aprovação está verde:
   ```bash
   node bin/career-bounty.mjs cv gate --vaga <vaga-id>
   ```
2. Abra o painel e inspecione visualmente o PDF renderizado e a versão ATS:
   ```bash
   node bin/career-bounty.mjs panel --port 8880
   ```

### Passo 3 (B3): Verificação de Paridade e Corte Seguro
1. Execute a verificação estrita de paridade contra a origem legada:
   ```bash
   node bin/career-bounty.mjs verify --json
   ```
   *Exigência bloqueante:* O resultado deve apontar `equal: true` (zero diffs entre projeção e log).
2. Efetue a transição definitiva para o modo ativo:
   ```bash
   node bin/career-bounty.mjs migrate --corte --confirmar-corte
   ```
3. Valide o novo estado no diagnóstico:
   ```bash
   node bin/career-bounty.mjs doctor
   ```
   - A linha `migracao` deve exibir `[ok] Modo ativo: migração concluída (corte realizado)`.

### Passo 4 (B4): Radar Diário e Agendamento
1. Execute uma rodada manual do radar em modo de teste:
   ```bash
   node bin/career-bounty.mjs daily-run --dry-run
   ```
2. Configure a tarefa agendada no Agendador de Tarefas do Windows (Task Scheduler) ou cron, apontando para o script diário.

---

## 3. Operação de Candidaturas

- **Candidatura Assistida:** Realizada via comandos `apply` e protegida pelos hooks de segurança.
- **Fluxo Gupy:** Requer aceitação explícita dos termos (`gupy.aceite_termos: true` em `config.yml`) e opera via `gupy perfil` e `gupy candidatar`.
- **Envio Automático (ATS Públicos):** Desligado por padrão (`regras: []`). Caso ativado, é estritamente monitorado por limites diários e protegido pelo kill switch:
  ```bash
  node bin/career-bounty.mjs envio pausar --motivo "Pausa de segurança"
  node bin/career-bounty.mjs envio retomar
  node bin/career-bounty.mjs envio audit --dia YYYY-MM-DD
  ```
