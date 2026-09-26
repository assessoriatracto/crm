# Webhooks

Configurados em **CRM > Integrações > Webhooks**. Dois formatos:

- **JSON** (Zapier, Make, n8n, sistemas próprios): corpo completo e assinado.
- **Pushcut** (notificação no celular): título, texto e link para o CRM.

## Eventos

| Evento | Quando |
|---|---|
| `lead.created` | lead novo (formulário, API ou manual) |
| `lead.stage_changed` | mudou de estágio no pipeline |
| `lead.won` / `lead.lost` | entrou num estágio de ganho / perda |
| `lead.assigned` | responsável alterado |
| `lead.updated` | contato, valor, faturamento ou rótulos alterados |
| `note.created` | nota adicionada |
| `lead.abandoned` | formulário parado há 30 min, com contato |
| `lead.recovered` | formulário incompleto colocado no pipeline |
| `lead.deleted` | lead excluído |

## Formato JSON

Headers: `X-Tracto-Event`, `X-Tracto-Delivery` e `X-Tracto-Signature` (`sha256=` + HMAC-SHA256 do corpo com o segredo do webhook). Responda 2xx em até 8 segundos.

```json
{
  "id": 1234,
  "evento": "lead.stage_changed",
  "enviado_em": "2026-09-26T14:02:11Z",
  "dados": {
    "lead": {
      "id": "…", "nome": "Alves Roberto", "whatsapp": "5513997974512", "email": "alves@loja.com",
      "faturamento": "De R$50.000 a R$100.000",
      "estagio": { "id": "…", "nome": "Reunião agendada", "tipo": "open" },
      "responsavel": { "nome": "Isaque", "email": "…" },
      "rotulos": ["Prioridade"], "formulario": { "id": "trafego", "nome": "Assessoria Tracto - Tráfego Pago" },
      "fonte": "pago", "utm": { "source": "facebook", "campaign": "diagnostico" },
      "respostas": [{ "label": "Qual seu número de Whatsapp?", "value": "+5513997974512" }]
    },
    "estagio_anterior": { "nome": "Qualificado" }
  }
}
```

## Verificar a assinatura (Node)

```js
import crypto from 'node:crypto';
app.post('/tracto', express.raw({ type: 'application/json' }), (req, res) => {
  const assinatura = req.get('X-Tracto-Signature');
  const esperado = 'sha256=' + crypto.createHmac('sha256', process.env.TRACTO_SECRET).update(req.body).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado))) return res.sendStatus(401);
  const { evento, dados } = JSON.parse(req.body);
  res.sendStatus(200);
});
```
