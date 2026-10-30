# Ponte do WhatsApp (Atendimento)

Serviço `gateway` no projeto **tracto-whatsapp** do Railway, ao lado da Evolution API.
O CRM fala só com esta ponte (com o login do Supabase); a chave da Evolution fica nas variáveis do Railway.

Deploy: `railway up tools/whatsapp-gateway --path-as-root --service gateway` (com o projeto linkado).
Variáveis: EVOLUTION_URL, EVOLUTION_API_KEY (referência à da Evolution), SUPABASE_URL, SUPABASE_ANON_KEY,
WEBHOOK_SECRET (o hash dela fica em `wa_event` no schema), PUBLIC_URL, INSTANCE_NAME, ALLOWED_ORIGINS, PORT.
