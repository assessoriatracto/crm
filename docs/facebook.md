# Conexão com o Facebook (backoffice)

No CRM, o admin só clica em **Continuar com o Facebook** (Financeiro > Contas de anúncio) e escolhe as contas.
Por trás disso existe um app da Meta, criado uma única vez pela Tracto. Ninguém da equipe precisa mexer nele.

## Configuração única

1. developers.facebook.com/apps > Criar app > caso de uso "Outro" > tipo "Empresa", vinculado ao portfólio da Tracto.
2. Adicionar o produto **Login do Facebook para Empresas**. Domínios permitidos do SDK JS e URIs OAuth válidos: `https://crm.assessoriatracto.com.br`.
3. Configurações > Básico: domínio `crm.assessoriatracto.com.br`, política de privacidade `https://assessoriatracto.com.br/privacidade/`.
4. Permissões: `ads_read` e `business_management`. Em modo desenvolvimento, só administradores do app conseguem conectar (suficiente pra uso interno).
5. ID do app (CRM Tracto: 1085198290966077): em `assets/js/tracto-config.js` do repositório `tracto` (`metaAppId`) e na tabela `app_settings.meta_app_id` do Supabase. Se o app for do tipo Empresa, crie uma configuração em Login do Facebook para Empresas > Configurações (token de acesso do usuário, permissões ads_read e business_management) e coloque o ID dela em `metaLoginConfigId`.
6. Chave secreta do app: colar só no Supabase (Table Editor > app_settings > meta_app_secret). Ela nunca vai pro navegador.

O login devolve um acesso de curta duração; o banco troca por um de 60 dias usando a chave secreta e guarda só nas contas ativadas.
