# Contratos da API do Painel Local (CareerBounty)

Este documento define os contratos HTTP da API interna do painel (`127.0.0.1`).
O painel é uma ferramenta de uso estritamente local e opera sem carregar dependências externas ou enviar telemetria.

---

## Regras Globais de Segurança e Privacidade

1. **Endereço e Host:** Apenas `127.0.0.1` e `localhost` na porta designada. Qualquer outro cabeçalho `Host` é rejeitado com `403 Forbidden`.
2. **Autenticação:** Toda requisição à API (exceto `/api/status`) exige o cabeçalho `X-Painel-Token` com o token efêmero de 64 caracteres hexadecimais gerado na inicialização do servidor e injetado em `window.PAINEL_API`.
3. **Somente Leitura por Padrão:** As rotas são `GET`, exceto onde expressamente previsto (`/api/candidaturas`, `/api/descarte`, `/api/perguntas`, `/api/analise-curriculo/incluir`, `/api/analise-curriculo/marcar`, `/api/analise-curriculo/entrevista`).
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

---

### 6. Avaliação da Empresa nas Vagas (`/api/vagas` e painel)

A rota `GET /api/vagas` (e as listagens de vagas no painel local) expõe o campo `empresa_avaliacao` enriquecido dinamicamente pela projeção pura a partir de eventos `empresa.avaliada`.

#### Regras de Vigência e Exibição:
1. **Validade Temporal:** Avaliações possuem validade padrão de 90 dias. Se a avaliação mais recente da empresa tiver mais de 90 dias, o campo `empresa_avaliacao` é omitido ou retorna `null`.
2. **Sem Notas Vazias ou Falsas:** Se não houver avaliação válida, o painel exibe "Sem nota coletada" ou omite a nota. Sob nenhuma hipótese é exibida nota 0, traço vazio ou estrelas vazias.

#### Exemplo de Payload (`200 OK` em item de vaga):
```json
{
  "id": "vaga-corp-tech-01",
  "empresa": "Empresa Alfa",
  "cargo": "Tech Lead",
  "aderencia": "alta",
  "empresa_avaliacao": {
    "nota": 4.2,
    "quantidade": 150,
    "plataforma": "Glassdoor",
    "data": "2026-10-18",
    "fontes": [
      {
        "url": "https://example.com/avaliacoes/empresa-alfa",
        "plataforma": "Glassdoor"
      }
    ],
    "resumo": "Boa cultura técnica, liderança acessível e ambiente colaborativo."
  }
}
```

---

### 7. Análise do Currículo contra a Base (`/api/analise-curriculo`)

Diagnóstico contínuo e determinístico entre os fatos sustentados pela base e o conteúdo do currículo, organizado nos 4 grupos (`confere`, `sem_prova`, `fora_do_cv`, `lacuna`).

#### 7.1 `GET /api/analise-curriculo`

Retorna todos os itens da matriz de análise classificados nos quatro grupos, contadores agregados e avisos, com mascaramento estrito de PII e redação de identidade.

##### Requisição
- **Método:** `GET`
- **Caminho:** `/api/analise-curriculo`
- **Cabeçalhos:** `X-Painel-Token: <token-de-64-caracteres>`

##### Respostas

###### `200 OK`
```json
{
  "grupos": {
    "confere": [
      {
        "id": "confere:claim:AF-001",
        "grupo": "confere",
        "tipo_origem": "cv_bullet",
        "texto": "Liderou time de 10 engenheiros aumentando throughput em 35%.",
        "afirmacoes": ["AF-001"],
        "evidencias": ["EV-010"],
        "nivel_prova": "verificado",
        "motivo": "Fato e números conferem com afirmações comprovadas da base.",
        "pergunta": null,
        "peso": 2,
        "status": "ativo"
      }
    ],
    "sem_prova": [
      {
        "id": "sem_prova:cv:linha:20",
        "grupo": "sem_prova",
        "tipo_origem": "cv_bullet",
        "texto": "Gerenciou orçamento de 2 milhões sem documento.",
        "afirmacoes": ["AF-099"],
        "evidencias": [],
        "nivel_prova": "relato",
        "motivo": "AF-099 (relato) usada como fato; só verificado ou entregue sustenta número e fato no CV",
        "pergunta": "Qual registro ou documento comprova a informação: \"Gerenciou orçamento de 2 milhões sem documento.\"?",
        "peso": 4,
        "status": "ativo"
      }
    ],
    "fora_do_cv": [
      {
        "id": "fora_do_cv:af:AF-034",
        "grupo": "fora_do_cv",
        "tipo_origem": "afirmacao",
        "texto": "Publicou artigo técnico sobre arquitetura event-driven.",
        "afirmacoes": ["AF-034"],
        "evidencias": ["EV-034"],
        "nivel_prova": "verificado",
        "motivo": "Afirmação com prova liberada para CV que nenhum bullet cita",
        "pergunta": "Em qual experiência do currículo esta afirmação comprovada pode ser incluída?",
        "peso": 3,
        "status": "ativo"
      }
    ],
    "lacuna": [
      {
        "id": "lacuna:sem_fonte:AF-010",
        "grupo": "lacuna",
        "tipo_origem": "lacuna_fonte",
        "texto": "AF-010 não tem evidência ligada",
        "afirmacoes": ["AF-010"],
        "evidencias": [],
        "nivel_prova": "nenhum",
        "motivo": "AF-010 não tem evidência ligada",
        "pergunta": "Onde está o registro que sustenta AF-010?",
        "peso": 5,
        "status": "ativo"
      }
    ]
  },
  "contadores": {
    "total": 4,
    "confere": 1,
    "sem_prova": 1,
    "fora_do_cv": 1,
    "lacuna": 1,
    "ativos": 4,
    "revisar": 0,
    "ignorados": 0
  },
  "avisos": []
}
```

###### `403 Forbidden`
Token ausente ou inválido.

---

#### 7.2 `POST /api/analise-curriculo/incluir`

Registra a intenção de ligar uma afirmação comprovada de `fora_do_cv` a uma experiência profissional no currículo. Grava o evento `analise.afirmacao_incluida`.

##### Requisição
- **Método:** `POST`
- **Caminho:** `/api/analise-curriculo/incluir`
- **Cabeçalhos:**
  - `X-Painel-Token: <token-de-64-caracteres>`
  - `Origin: http://127.0.0.1:<port>`
  - `Content-Type: application/json`
- **Corpo:**
```json
{
  "afirmacao_id": "AF-034",
  "experiencia_id": "exp-empresa-alfa"
}
```

##### Respostas

###### `200 OK`
```json
{
  "ok": true,
  "afirmacao_id": "AF-034",
  "experiencia_id": "exp-empresa-alfa"
}
```

###### `400 Bad Request`
Afirmação inexistente na base ou payload inválido.

###### `403 Forbidden`
Token inválido ou cabeçalho Origin externo (proteção anti-CSRF).

###### `409 Conflict`
Modo sombra ativo (`state.mode === 'shadow'`).

---

#### 7.3 `POST /api/analise-curriculo/marcar`

Anota operacionalmente um item da análise como `revisar`, `ignorado` ou `ativo`, com justificativa opcional. Grava o evento `analise.item_marcado`.

##### Requisição
- **Método:** `POST`
- **Caminho:** `/api/analise-curriculo/marcar`
- **Cabeçalhos:**
  - `X-Painel-Token: <token-de-64-caracteres>`
  - `Origin: http://127.0.0.1:<port>`
  - `Content-Type: application/json`
- **Corpo:**
```json
{
  "item_id": "sem_prova:cv:linha:20",
  "como": "revisar",
  "motivo": "Localizar documento original no arquivo"
}
```

##### Respostas

###### `200 OK`
```json
{
  "ok": true,
  "item_id": "sem_prova:cv:linha:20",
  "como": "revisar"
}
```

###### `400 Bad Request`
Status inválido ou item_id ausente.

###### `403 Forbidden` / `409 Conflict`
Token ou Origin inválidos / Modo sombra ativo.

---

#### 7.4 `POST /api/analise-curriculo/entrevista`

Dispara a criação de proposta de pergunta investigativa para resolução de uma lacuna, gravando o rascunho em `outbox/lacunas/` e o evento auditável `analise.lacuna_entrevista`.

##### Requisição
- **Método:** `POST`
- **Caminho:** `/api/analise-curriculo/entrevista`
- **Cabeçalhos:**
  - `X-Painel-Token: <token-de-64-caracteres>`
  - `Origin: http://127.0.0.1:<port>`
  - `Content-Type: application/json`
- **Corpo:**
```json
{
  "item_id": "lacuna:sem_fonte:AF-010"
}
```

##### Respostas

###### `200 OK`
```json
{
  "ok": true,
  "item_id": "lacuna:sem_fonte:AF-010",
  "pergunta": "Onde está o registro que sustenta AF-010?",
  "rascunho": "outbox/lacunas/lacuna-sem-fonte-af-010-2026-10-18.md"
}
```

###### `404 Not Found`
Item de lacuna não localizado na análise.

###### `403 Forbidden` / `409 Conflict`
Token ou Origin inválidos / Modo sombra ativo.



