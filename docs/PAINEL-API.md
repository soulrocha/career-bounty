# Contratos da API do Painel Local (CareerBounty)

Este documento define os contratos HTTP da API interna do painel (`127.0.0.1`).
O painel é uma ferramenta de uso estritamente local e opera sem carregar dependências externas ou enviar telemetria.

---

## Regras Globais de Segurança e Privacidade

1. **Endereço e Host:** Apenas `127.0.0.1` e `localhost` na porta designada. Qualquer outro cabeçalho `Host` é rejeitado com `403 Forbidden`.
2. **Autenticação:** Toda requisição à API (exceto `/api/status`) exige o cabeçalho `X-Painel-Token` com o token efêmero de 64 caracteres hexadecimais gerado na inicialização do servidor e injetado em `window.PAINEL_API`.
3. **Somente Leitura por Padrão:** As rotas são `GET`, exceto onde expressamente previsto (`/api/candidaturas`, `/api/descarte`, `/api/perguntas`).
4. **Mascaramento Estrito de PII:** Dados de contato de recrutadores (telefones, e-mails, endereços de WhatsApp) são estritamente mascarados antes de qualquer resposta da API. Resumos de mensagens nunca expõem números completos ou endereços privados de pessoas físicas.

---

## Endpoints

### 1. `GET /api/contatos`

Retorna os contatos registrados com recrutadores e fontes de recrutamento, com visão agregada e agrupada por vaga e por pessoa.

#### Requisição
- **Método:** `GET`
- **Caminho:** `/api/contatos`
- **Cabeçalhos:**
  - `X-Painel-Token: <token-de-64-caracteres>`
- **Parâmetros de Consulta (Query Strings, opcionais):**
  - `vaga=<id>`: filtra apenas contatos vinculados à vaga informada.
  - `ativos=1`: filtra contatos de processos ainda ativos (últimos 30 dias ou vagas não descartadas).

#### Respostas

##### `200 OK`
```json
{
  "contatos": [
    {
      "id": "con-7f1a9b2c",
      "vaga_id": "vaga-corp-tech-01",
      "canal": "linkedin",
      "direcao": "recebido",
      "pessoa": {
        "nome": "Camila Silva",
        "papel": "Tech Recruiter"
      },
      "nome": "Camila Silva",
      "papel": "Tech Recruiter",
      "resumo": "Abordagem no LinkedIn para vaga sênior. Contato inicial via r***@corptech.test",
      "pergunta": "Qual a sua pretensão salarial para regime PJ e disponibilidade de início?",
      "proxima_etapa": {
        "texto": "Entrevista de alinhamento técnico com gestor",
        "data": "2026-10-24"
      },
      "data": "2026-10-18",
      "endereco": "linkedin.com/in/camila-recruiter-test",
      "ultimo_contato": "2026-10-18",
      "dias_desde_ultimo_contato": 0,
      "quem_falou_por_ultimo": "recrutador"
    },
    {
      "id": "con-3d8e5a1b",
      "vaga_id": "vaga-corp-tech-01",
      "canal": "whatsapp",
      "direcao": "enviado",
      "pessoa": {
        "nome": "Camila Silva",
        "papel": "Tech Recruiter"
      },
      "nome": "Camila Silva",
      "papel": "Tech Recruiter",
      "resumo": "Confirmação de recebimento das informações preliminares enviada pelo WhatsApp",
      "pergunta": null,
      "proxima_etapa": {
        "texto": "Aguardando envio do link da reunião",
        "data": "2026-10-20"
      },
      "data": "2026-10-19",
      "endereco": "(11) 9****-**34",
      "ultimo_contato": "2026-10-19",
      "dias_desde_ultimo_contato": 0,
      "quem_falou_por_ultimo": "candidato"
    },
    {
      "id": "con-0f9c2d7e",
      "vaga_id": null,
      "canal": "email",
      "direcao": "recebido",
      "pessoa": {
        "nome": "Rodrigo Santos",
        "papel": "Headhunter Partner"
      },
      "nome": "Rodrigo Santos",
      "papel": "Headhunter Partner",
      "resumo": "Sondagem de perfil para oportunidade reservada no setor financeiro",
      "pergunta": "Poderia compartilhar um resumo dos seus projetos recentes com microsserviços?",
      "proxima_etapa": null,
      "data": "2026-10-15",
      "endereco": "r***@consultoria.test",
      "ultimo_contato": "2026-10-15",
      "dias_desde_ultimo_contato": 3,
      "quem_falou_por_ultimo": "recrutador"
    }
  ],
  "por_vaga": {
    "vaga-corp-tech-01": {
      "vaga_id": "vaga-corp-tech-01",
      "total": 2,
      "ultimo_contato": "2026-10-19",
      "dias_desde_ultimo_contato": 0,
      "quem_falou_por_ultimo": "candidato",
      "contatos": [
        {
          "id": "con-7f1a9b2c",
          "data": "2026-10-18",
          "canal": "linkedin",
          "direcao": "recebido",
          "nome": "Camila Silva",
          "papel": "Tech Recruiter",
          "resumo": "Abordagem no LinkedIn para vaga sênior. Contato inicial via r***@corptech.test",
          "proxima_etapa": {
            "texto": "Entrevista de alinhamento técnico com gestor",
            "data": "2026-10-24"
          }
        },
        {
          "id": "con-3d8e5a1b",
          "data": "2026-10-19",
          "canal": "whatsapp",
          "direcao": "enviado",
          "nome": "Camila Silva",
          "papel": "Tech Recruiter",
          "resumo": "Confirmação de recebimento das informações preliminares enviada pelo WhatsApp",
          "proxima_etapa": {
            "texto": "Aguardando envio do link da reunião",
            "data": "2026-10-20"
          }
        }
      ]
    }
  },
  "por_pessoa": {
    "camila-silva": {
      "nome": "Camila Silva",
      "papel": "Tech Recruiter",
      "total": 2,
      "ultimo_contato": "2026-10-19",
      "dias_desde_ultimo_contato": 0,
      "quem_falou_por_ultimo": "candidato",
      "contatos_ids": ["con-7f1a9b2c", "con-3d8e5a1b"]
    },
    "rodrigo-santos": {
      "nome": "Rodrigo Santos",
      "papel": "Headhunter Partner",
      "total": 1,
      "ultimo_contato": "2026-10-15",
      "dias_desde_ultimo_contato": 3,
      "quem_falou_por_ultimo": "recrutador",
      "contatos_ids": ["con-0f9c2d7e"]
    }
  },
  "total": 3
}
```

##### `403 Forbidden`
Token ausente, inválido ou cabeçalho Host não local.
```json
{
  "erro": "Acesso inválido."
}
```

---

### 3. Listagem de Processos Seletivos (`/api/processos`)

Retorna a projeção agregada dos processos seletivos em andamento e encerrados, com dados de etapas, situações, alertas de inatividade e histórico cronológico de interações. Toda resposta tem mascaramento recursivo de PII.

- **Método:** `GET`
- **Caminho:** `/api/processos`
- **Cabeçalhos:**
  - `x-painel-token: <token>`
- **Query Parameters (opcionais):**
  - `situacao`: Filtra por situação (`ativo`, `aguardando_retorno`, `aguardando_voce`, `encerrado`).
  - `alerta`: Filtra por nível de inatividade (`normal`, `atencao`, `lembrar`).

#### Respostas

##### `200 OK`
```json
{
  "processos": [
    {
      "vaga_id": "vaga-ficticia-101",
      "empresa": "Empresa Alfa",
      "cargo": "Arquiteto de Software",
      "etapa_atual": "entrevista_rh",
      "situacao": "aguardando_retorno",
      "desfecho": null,
      "alerta": "atencao",
      "quem_falou_por_ultimo": "candidato",
      "ultima_interacao_data": "2026-10-13",
      "dias_inatividade": 5,
      "eventos": [
        {
          "tipo": "candidatura.marcada",
          "data": "2026-10-10",
          "ts": "2026-10-10T14:30:00.000Z",
          "detalhe": "Candidatura registrada"
        },
        {
          "tipo": "processo.etapa",
          "data": "2026-10-13",
          "ts": "2026-10-13T16:00:00.000Z",
          "etapa": "entrevista_rh",
          "detalhe": "Entrevista inicial realizada com recruiter (contato: r***@empresa.test)"
        }
      ]
    }
  ],
  "totais": {
    "total": 1,
    "ativos": 1,
    "aguardando_retorno": 1,
    "aguardando_voce": 0,
    "encerrados": 0,
    "atencao": 1,
    "lembrar": 0
  },
  "total": 1
}
```

##### `403 Forbidden`
Token ausente, inválido ou cabeçalho Host não local.

---

### 4. Lembretes e Acompanhamento Pendente (`/api/acompanhamento`)

Retorna exclusivamente os processos seletivos não-encerrados que estão em estado de alerta (`atencao` ou `lembrar`), ordenados por maior inatividade para priorização no acompanhamento.

- **Método:** `GET`
- **Caminho:** `/api/acompanhamento`
- **Cabeçalhos:**
  - `x-painel-token: <token>`

#### Respostas

##### `200 OK`
```json
{
  "pendentes": [
    {
      "vaga_id": "vaga-ficticia-202",
      "empresa": "Empresa Beta",
      "cargo": "Tech Lead",
      "etapa_atual": "teste",
      "situacao": "aguardando_voce",
      "desfecho": null,
      "alerta": "lembrar",
      "quem_falou_por_ultimo": "empresa",
      "ultima_interacao_data": "2026-10-10",
      "dias_inatividade": 8,
      "eventos": [
        {
          "tipo": "contato.registrado",
          "data": "2026-10-10",
          "ts": "2026-10-10T10:00:00.000Z",
          "canal": "email",
          "direcao": "recebido",
          "resumo": "Envio do desafio prático. Dúvidas via (11) 9****-**42",
          "detalhe": "Envio do desafio prático. Dúvidas via (11) 9****-**42"
        }
      ]
    }
  ],
  "totais": {
    "total": 1,
    "ativos": 1,
    "aguardando_retorno": 0,
    "aguardando_voce": 1,
    "encerrados": 0,
    "atencao": 0,
    "lembrar": 1
  },
  "total": 1
}
```

##### `403 Forbidden`
Token ausente, inválido ou cabeçalho Host não local.

---

### 5. Histórico e Linha do Tempo por Vaga (`/api/historico`)

Retorna o histórico completo e a linha do tempo cronológica agregada por vaga, reunindo eventos de descoberta no radar, registros de candidatura, contatos e mensagens trocadas com recrutadores, avanço de etapas de entrevista, desfechos e descartes. Dados confidenciais (telefones e e-mails) são estritamente mascarados antes de serem expostos.

- **Método:** `GET`
- **Caminho:** `/api/historico`
- **Cabeçalhos:**
  - `x-painel-token: <token>`
- **Parâmetros de Consulta (Query Strings, opcionais):**
  - `inicio=AAAA-MM-DD`: filtra oportunidades cujo último movimento ocorreu a partir desta data.
  - `fim=AAAA-MM-DD`: filtra oportunidades cujo último movimento ocorreu até esta data.
  - `situacao=<situacao>`: filtra pela situação corrente do processo (`ativo`, `aguardando_retorno`, `aguardando_voce`, `encerrado`).
  - `portal=<portal>`: filtra pelo portal de origem da vaga (`gupy`, `greenhouse`, `linkedin`, etc.).

#### Respostas

##### `200 OK`
```json
{
  "historico": [
    {
      "vaga_id": "vaga-ficticia-101",
      "empresa": "Empresa Alfa",
      "cargo": "Arquiteto de Software",
      "portal": "gupy",
      "situacao_processo": "aguardando_voce",
      "desfecho": null,
      "ultimo_movimento": "2026-10-18",
      "linha_do_tempo": [
        {
          "id": "e-desc-01",
          "tipo": "descoberta",
          "origem": "radar",
          "data": "2026-10-10",
          "ts": "2026-10-10T09:30:00.000Z",
          "titulo": "Vaga descoberta: Arquiteto de Software",
          "detalhe": "https://empresa-alfa.test/vagas/101"
        },
        {
          "id": "e-cand-01",
          "tipo": "candidatura",
          "origem": "painel",
          "data": "2026-10-12",
          "ts": "2026-10-12T14:00:00.000Z",
          "titulo": "Candidatura registrada",
          "detalhe": "Candidatura enviada/marcada"
        },
        {
          "id": "e-etapa-01",
          "tipo": "etapa",
          "origem": "cli",
          "etapa": "entrevista_rh",
          "data": "2026-10-15",
          "ts": "2026-10-15T11:00:00.000Z",
          "titulo": "Etapa: entrevista_rh",
          "detalhe": "Alinhamento cultural inicial realizado"
        },
        {
          "id": "c-contato-01",
          "tipo": "contato",
          "origem": "recrutador",
          "canal": "email",
          "direcao": "recebido",
          "data": "2026-10-18",
          "ts": "2026-10-18T16:20:00.000Z",
          "titulo": "Contato com Camila Recruiter",
          "resumo": "Envio do teste de arquitetura. Dúvidas via (11) 9****-**42 ou c***@empresa-alfa.test",
          "detalhe": "Envio do teste de arquitetura. Dúvidas via (11) 9****-**42 ou c***@empresa-alfa.test",
          "pergunta": "Você consegue entregar o diagrama de blocos até quinta-feira?",
          "proxima_etapa": {
            "texto": "Apresentação técnica com equipe de engenharia",
            "data": "2026-10-24"
          },
          "pessoa": {
            "nome": "Camila Recruiter",
            "papel": "Tech Recruiter"
          },
          "endereco": "c***@empresa-alfa.test"
        }
      ]
    }
  ],
  "totais": {
    "total": 1,
    "ativos": 0,
    "aguardando_retorno": 0,
    "aguardando_voce": 1,
    "encerrados": 0
  },
  "total": 1
}
```

##### `403 Forbidden`
Token ausente, inválido ou cabeçalho Host não local.


