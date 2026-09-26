# Configuração do Supabase e visão geral

- `assessoriatracto.com.br/aplicar/` formulário geral (réplica do Respondi FOD4RAan)
- `assessoriatracto.com.br/aplicar/trafego/` Tráfego Pago (réplica do KIy9LLMN)
- `assessoriatracto.com.br/aplicar/marketplace/` Marketplace (réplica do OhHOTxzG)
- `assessoriatracto.com.br/aplicar/diagnostico/` modelo com todos os recursos
- `crm.assessoriatracto.com.br` central de leads, dashboard, formulários e ajustes

Sem Supabase configurado, form e CRM rodam em modo demo só no localhost. Em produção o form mostra erro de envio e o CRM avisa que falta configurar.

## Publicar

Dois repositórios, cada um com o próprio GitHub Pages (push na `main` publica):
- `assessoriatracto/tracto`: landing pages, formulários, política de privacidade e os módulos compartilhados (`assets/js/db.js`, `forms.js`, `tracto-config.js`).
- `assessoriatracto/crm` (este): o CRM e o `supabase/schema.sql`.
Formulário novo feito no construtor já fica no ar em `/aplicar/<endereço>/`, sem publicar nada.

## Ligar o Supabase

1. Crie um projeto em supabase.com (região South America, São Paulo).
2. SQL Editor > New query > cole `supabase/schema.sql` > Run. Pode rodar de novo a cada atualização do arquivo.
3. Project Settings > API: copie a Project URL e a anon public key para `assets/js/tracto-config.js` do repositório `tracto`.
4. Authentication > Sign In / Providers > Email: deixe **Enable sign ups** e **Confirm email** ligados (o cadastro do CRM exige confirmação e aprovação de um admin).
5. Authentication > URL Configuration: Site URL `https://crm.assessoriatracto.com.br` e em Redirect URLs adicione `https://crm.assessoriatracto.com.br/**`.
6. Authentication > Multi-Factor: deixe TOTP habilitado (vem ligado) pra quem quiser ativar a verificação em duas etapas.
7. Crie sua conta em `https://crm.assessoriatracto.com.br/#/cadastro`. A primeira conta vira admin ativa automaticamente.
8. Facebook (Financeiro > Contas de anúncio): crie um app da Meta, cole o ID do app e a chave secreta no CRM e clique em Entrar com o Facebook. O passo a passo aparece na própria aba.
9. E-mails: o envio padrão do Supabase tem limite baixo por hora. Pra equipe grande, configure um SMTP próprio em Authentication > Emails > SMTP Settings.
10. Database > Extensions: confira se **pg_net** e **pg_cron** estão ativas (o schema tenta ativar sozinho).

## Integrações e Pixel (CRM)

- **Integrações**: chaves de API (`trk_…`) pra criar, listar e atualizar leads de outros sistemas, e webhooks assinados (HMAC-SHA256) para os eventos `lead.created`, `lead.stage_changed`, `lead.won`, `lead.lost`, `lead.assigned`, `lead.updated`, `note.created` e `lead.deleted`. A documentação com exemplos fica dentro da própria aba.
- **Pixel**: Meta Conversions API enviada pelo banco. Cole o token no CRM e ative. O Lead do formulário vai com o mesmo `event_id` do Pixel do navegador (deduplicação), e cada estágio do pipeline pode enviar um evento (Contact, Schedule, Purchase…) com valor estimado ou valor do contrato.
- Os envios usam a extensão `pg_net` do Supabase, que o schema ativa. Se ela não estiver disponível, os leads continuam sendo gravados normalmente e os logs mostram "pg_net indisponível".

## Segurança

- O visitante do site só consegue chamar `submit_lead` (valida e normaliza no servidor) e registrar eventos do form. Não lê nem altera nada.
- Só membros ativos da equipe (`profiles.ativo`) leem e editam leads, estágios, rótulos e histórico.
- A anon key é pública por design; a proteção está nas policies de RLS.
- O token da Meta e os segredos dos webhooks só são lidos pela equipe ativa. As chaves de API ficam salvas só como hash.

## Editar perguntas

Os formulários ficam em `assets/js/forms.js`. Cada campo tem `type`, `title`, `required`, e opcionalmente:

- `showIf: { field, op, value }` pra só mostrar a pergunta sob uma condição
- `logic: [{ if: condição, jump: 'idDoCampo' }]` pra pular pra outra pergunta ou tela final
- `map: 'nome' | 'whatsapp' | 'email' | 'instagram' | 'faturamento'` pra preencher a coluna do CRM

Operadores: `is`, `is_not`, `in`, `not_in`, `includes`, `excludes`, `gt`, `gte`, `lt`, `lte`, `filled`, `empty`, e combinações com `{ all: [...] }` / `{ any: [...] }`.
