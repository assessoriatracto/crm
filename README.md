# CRM Tracto

Painel comercial da Tracto em **https://crm.assessoriatracto.com.br** (GitHub Pages + Supabase).

As landing pages, os formulários (`assessoriatracto.com.br/aplicar/...`) e a política de privacidade
ficam no repositório **assessoriatracto/tracto**. Este repositório é só o CRM e o backend.

## Estrutura

```
index.html            página única do CRM (rotas por #/…)
assets/css/crm.css    estilos (tema claro/escuro, animações)
assets/js/
  app.js              inicialização, rotas, central de leads (pipeline e tabela), permissões
  auth.js             entrar, criar conta, 2 etapas (TOTP), recuperar senha, LGPD
  util.js             ícones, popovers, modais, toasts, filtros de data
  dashboard.js        dashboard de leads e funil
  recovery.js         recuperação de formulários incompletos
  builder.js          construtor de formulários
  integrations.js     API, webhooks, Pushcut e pixels (Meta, GA4, Google Ads, GTM)
  finance.js          financeiro (receitas, gastos, ROAS) e conexão com o Facebook
  admin.js            equipe, times, papéis, etapas e etiquetas
  profile.js          meu perfil e notificações
supabase/schema.sql   banco completo (tabelas, RLS, funções, gatilhos, agendamentos) · idempotente
docs/                 supabase.md (configuração), api.md, webhooks.md
tools/versao.sh       atualiza o ?v= dos arquivos (cache do navegador)
```

## Módulos compartilhados com o site

O CRM usa três arquivos do site principal, carregados de `https://assessoriatracto.com.br/assets/js/`:

- `tracto-config.js`: URL e chave pública do Supabase
- `db.js`: acesso ao banco (o mesmo usado pelos formulários)
- `forms.js`: formulários padrão

Quando algum deles mudar no repositório `tracto`, rode `tools/versao.sh` aqui e publique.

## Publicar

Commit e push na branch `main`. O GitHub Pages publica em cerca de 1 minuto.

```bash
tools/versao.sh && git add -A && git commit -m "…" && git push
```

## Banco

`supabase/schema.sql` pode ser executado de novo a qualquer momento no SQL Editor do Supabase
(não apaga dados). Passo a passo em `docs/supabase.md`.
