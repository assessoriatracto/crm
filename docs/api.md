# API de leads

Para integrar outros sistemas (Zapier, Make, n8n, planilhas, outras landing pages) com o CRM.

Toda chamada é um `POST` para `https://<projeto>.supabase.co/rest/v1/rpc/<função>` com os headers:

```
apikey: <chave pública do projeto (anon key)>
Content-Type: application/json
```

A chave `trk_…` criada em **CRM > Integrações > Nova chave** vai no corpo e identifica quem está chamando. Revogue a chave no CRM se ela vazar.

## Criar lead: `api_create_lead`

```bash
curl -X POST 'https://<projeto>.supabase.co/rest/v1/rpc/api_create_lead' \
  -H 'apikey: <anon key>' -H 'Content-Type: application/json' \
  -d '{
    "api_key": "trk_SUA_CHAVE",
    "lead": {
      "nome": "João da Silva",
      "whatsapp": "62999998888",
      "email": "joao@loja.com",
      "instagram": "lojadojoao",
      "faturamento": "De R$30.000 a R$50.000",
      "estagio": "Em análise",
      "utm_source": "google",
      "utm_campaign": "pesquisa-ferragens",
      "respostas": [{ "label": "Como conheceu?", "value": "Indicação" }]
    }
  }'
```

Obrigatórios: `nome` e `whatsapp`. Opcionais: `email`, `instagram`, `faturamento`, `estado`, `cidade`, `cep`, `estagio` (nome do estágio), `valor`, `utm_*`, `fbclid`, `gclid`, `respostas`.
Resposta: `{ "ok": true, "id": "<uuid>" }`. O lead dispara os webhooks e os pixels como os do formulário.

## Listar leads: `api_list_leads`

```json
{ "api_key": "trk_SUA_CHAVE", "desde": "2026-09-01T00:00:00Z", "limite": 100 }
```

Até 500 por chamada, do mais novo para o mais antigo.

## Atualizar lead: `api_update_lead`

```json
{
  "api_key": "trk_SUA_CHAVE",
  "lead_id": "<uuid>",
  "dados": { "estagio": "Reunião agendada", "valor": 3500, "nota": "Agendou pelo Calendly", "responsavel_email": "sdr@assessoriatracto.com.br" }
}
```

Mudar o estágio dispara os eventos de funil configurados na aba Pixel.

## Erros

Status 4xx com mensagem, por exemplo `chave de API inválida` ou `estágio "X" não existe`.
