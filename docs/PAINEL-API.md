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
