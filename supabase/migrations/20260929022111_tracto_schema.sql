-- ============================================================
-- Tracto · Formulários + CRM + Rastreamento
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- É idempotente: pode rodar de novo a cada atualização sem perder dados.
--
--  0. Extensões                    8. Integrações (API, webhooks, Pushcut)
--  1. Utilitários                  8b. Financeiro e anúncios (Meta Ads)
--  2. Equipe, papéis e times       8c. Auditoria (LGPD)
--  3. Pipeline                     9. Representações JSON
--  4. Leads                       10. Envios (HTTP, webhooks, Pushcut, Meta, Google)
--  5. Histórico                   11. Gatilhos
--  6. Formulário e recuperação    12. RPCs públicas (form, API)
--  6b. Construtor de formulários  13. RPCs da equipe
--  7. Rastreamento e ajustes      14. Permissões · 15. RLS · 16. Storage · 17. Realtime e agendamentos
--
-- Papéis: admin (tudo), gestor (todos os leads, forms, financeiro), sdr (leads dele e sem dono).
-- ============================================================


-- ============================================================
-- 0. EXTENSÕES
-- pg_net faz as chamadas HTTP (webhooks, Meta, Google) de forma assíncrona.
-- pg_cron marca formulários abandonados. Sem elas o CRM funciona, só sem esses envios.
-- ============================================================
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net indisponível: %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;


-- ============================================================
-- 1. UTILITÁRIOS
-- ============================================================

-- HMAC-SHA256 com funções nativas (assinatura dos webhooks)
create or replace function public.hmac_sha256(msg text, key text) returns text
language plpgsql immutable as $$
declare
  k bytea := convert_to(key, 'UTF8');
  ipad bytea; opad bytea; i int;
begin
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k; opad := k;
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);
    opad := set_byte(opad, i, get_byte(k, i) # 92);
  end loop;
  return encode(sha256(opad || sha256(ipad || convert_to(msg, 'UTF8'))), 'hex');
end $$;

-- SHA-256 no padrão Meta/Google: minúsculo, sem espaços nas pontas
create or replace function public.meta_hash(v text) returns text
language sql immutable as $$
  select case when nullif(btrim(v), '') is null then null
    else encode(sha256(convert_to(lower(btrim(v)), 'UTF8')), 'hex') end;
$$;

-- telefone só com dígitos e DDI 55 (aceita "(62) 99999-9999", "+55 62…", "5562…")
create or replace function public.norm_phone(v text) returns text
language sql immutable as $$
  select case
    when d is null or length(d) < 10 then null
    when length(d) in (10, 11) then '55' || d
    else d end
  from (select nullif(regexp_replace(coalesce(v, ''), '\D', '', 'g'), '') as d) x;
$$;

-- UF a partir do DDD (enriquece a correspondência quando o form não pergunta o estado)
create or replace function public.ddd_uf(phone text) returns text
language sql immutable as $$
  select case
    when ddd between 11 and 19 then 'SP'
    when ddd in (21, 22, 24) then 'RJ'
    when ddd in (27, 28) then 'ES'
    when ddd in (31, 32, 33, 34, 35, 37, 38) then 'MG'
    when ddd in (41, 42, 43, 44, 45, 46) then 'PR'
    when ddd in (47, 48, 49) then 'SC'
    when ddd in (51, 53, 54, 55) then 'RS'
    when ddd = 61 then 'DF'
    when ddd in (62, 64) then 'GO'
    when ddd = 63 then 'TO'
    when ddd in (65, 66) then 'MT'
    when ddd = 67 then 'MS'
    when ddd = 68 then 'AC'
    when ddd = 69 then 'RO'
    when ddd in (71, 73, 74, 75, 77) then 'BA'
    when ddd = 79 then 'SE'
    when ddd in (81, 87) then 'PE'
    when ddd = 82 then 'AL'
    when ddd = 83 then 'PB'
    when ddd = 84 then 'RN'
    when ddd in (85, 88) then 'CE'
    when ddd in (86, 89) then 'PI'
    when ddd in (91, 93, 94) then 'PA'
    when ddd in (92, 97) then 'AM'
    when ddd = 95 then 'RR'
    when ddd = 96 then 'AP'
    when ddd in (98, 99) then 'MA'
  end
  from (select case when public.norm_phone(phone) like '55%' then substr(public.norm_phone(phone), 3, 2)::int end as ddd) x;
$$;

-- IP do visitante a partir dos headers que o Supabase repassa
create or replace function public.request_ip() returns text
language plpgsql stable as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then return null; end;
  return nullif(left(btrim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for', ''), ',', 1)), 60), '');
end $$;

-- client_id do GA4 a partir do cookie _ga ("GA1.1.123.456" → "123.456")
create or replace function public.ga_client_id(cookie text) returns text
language sql immutable as $$
  select nullif(substring(coalesce(cookie, '') from '^GA\d\.\d\.(\d+\.\d+)$'), '');
$$;


-- ============================================================
-- 2. EQUIPE, PAPÉIS E TIMES
-- O primeiro usuário vira admin ativo. Os próximos se cadastram, confirmam o e-mail
-- e ficam inativos até um admin liberar (CRM > Ajustes > Equipe).
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  nome        text not null,
  email       text not null,
  ativo       boolean not null default false
);

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null unique check (char_length(name) between 1 and 40),
  auto_assign boolean not null default false     -- distribui leads novos em rodízio entre os membros
);

alter table public.profiles add column if not exists role text not null default 'sdr';
alter table public.profiles add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists pushcut_url text;
alter table public.profiles add column if not exists consent_at timestamptz;          -- aceite dos termos e da política (LGPD)
alter table public.profiles add column if not exists consent_version text;
alter table public.profiles add column if not exists last_assigned_at timestamptz;
alter table public.profiles add column if not exists cargo text;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'gestor', 'sdr'));
alter table public.profiles drop constraint if exists profiles_pushcut_check;
alter table public.profiles add constraint profiles_pushcut_check check (pushcut_url is null or pushcut_url ~ '^https://api\.pushcut\.io/');

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean := not exists (select 1 from public.profiles where ativo);
begin
  insert into public.profiles (id, nome, email, ativo, role, consent_at, consent_version, phone, cargo)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)), 120), new.email,
          first, case when first then 'admin' else 'sdr' end,
          case when new.raw_user_meta_data ? 'consent_at' then (new.raw_user_meta_data->>'consent_at')::timestamptz end,
          left(new.raw_user_meta_data->>'consent_version', 20),
          nullif(left(regexp_replace(coalesce(new.raw_user_meta_data->>'phone', ''), '\D', '', 'g'), 15), ''),
          nullif(left(btrim(new.raw_user_meta_data->>'cargo'), 60), ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- troca de e-mail confirmada no login: atualiza o perfil
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = new.email where id = new.id;
    perform audit('update', 'profiles', new.id::text, jsonb_build_object('email_alterado', true));
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
for each row execute function public.handle_user_email_change();

insert into public.profiles (id, nome, email, ativo)
select u.id, split_part(u.email, '@', 1), u.email, false from auth.users u
on conflict (id) do nothing;
update public.profiles set ativo = true, role = 'admin'
where id = (select id from public.profiles order by created_at limit 1)
  and not exists (select 1 from public.profiles where ativo and role = 'admin');

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and ativo;
$$;
create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null;
$$;
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'gestor'), false);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

create or replace function public.author_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nome from public.profiles where id = auth.uid()), 'Sistema');
$$;

-- só admin muda papel, time e acesso; ninguém tira o último admin
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.id <> auth.uid() then raise exception 'sem permissão'; end if;
    new.role := old.role; new.ativo := old.ativo; new.team_id := old.team_id;
  end if;
  if old.role = 'admin' and old.ativo and (new.role <> 'admin' or not new.ativo)
     and not exists (select 1 from profiles where role = 'admin' and ativo and id <> old.id) then
    raise exception 'a equipe precisa ter pelo menos um admin ativo';
  end if;
  -- e-mail do perfil só muda junto com o e-mail de login (troca confirmada)
  if new.email is distinct from (select u.email from auth.users u where u.id = new.id) then new.email := old.email; end if;
  new.consent_at := old.consent_at; new.consent_version := old.consent_version;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
for each row execute function public.profiles_guard();


-- ============================================================
-- 3. PIPELINE
-- meta_event / ga4_event: evento enviado quando o lead entra no estágio.
-- Nomes personalizados de propósito: só o formulário completo (Lead) é conversão.
-- ============================================================
create table if not exists public.stages (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (char_length(name) between 1 and 40),
  color     text not null default '#FFAD00',
  position  int  not null default 0,
  kind      text not null default 'open' check (kind in ('open', 'won', 'lost'))
);
alter table public.stages add column if not exists meta_event text;
alter table public.stages add column if not exists ga4_event text;
alter table public.stages add column if not exists meta_value text not null default 'none';
alter table public.stages drop constraint if exists stages_meta_value_check;
-- lead não tem valor: só a venda confirmada (estágio de venda) envia o valor do contrato
update public.stages set meta_value = 'none' where meta_value = 'lead' or (meta_value = 'contract' and kind <> 'won');
alter table public.stages add constraint stages_meta_value_check check (meta_value in ('none', 'contract') and (meta_value = 'none' or kind = 'won'));

insert into public.stages (name, color, position, kind, meta_event, ga4_event, meta_value)
select * from (values
  ('Novos leads',       '#6AA8FF', 0, 'open', null,              null,                   'none'),
  ('Contato realizado', '#B58CFF', 1, 'open', null,              null,                   'none'),
  ('Ligação',           '#4FD1C5', 2, 'open', null,              null,                   'none'),
  ('Qualificado',       '#FFAD00', 3, 'open', null,              null,                   'none'),
  ('Reunião agendada',  '#FF8A3D', 4, 'open', null,              null,                   'none'),
  ('Venda realizada',   '#3DDC84', 5, 'won',  'VendaRealizada',  'close_convert_lead',   'contract'),
  ('Perdido',           '#6B6B6B', 6, 'lost', null,              null,                   'none'),
  ('Descarte',          '#8A4B4B', 7, 'lost', null,              null,                   'none')
) v(name, color, position, kind, meta_event, ga4_event, meta_value)
where not exists (select 1 from public.stages);
-- só o estágio de venda manda evento pra Meta/GA4 (mover no pipeline não gera evento)
update public.stages set meta_event = null, ga4_event = null where kind <> 'won' and (meta_event is not null or ga4_event is not null);
-- estágio de descarte (leads com dados falsos) em bancos que já existiam
insert into public.stages (name, color, position, kind, meta_value)
select 'Descarte', '#8A4B4B', coalesce(max(position), 0) + 1, 'lost', 'none' from public.stages
where not exists (select 1 from public.stages where name = 'Descarte');

create table if not exists public.labels (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique check (char_length(name) between 1 and 30),
  color  text not null default '#FFAD00'
);


-- ============================================================
-- 4. LEADS
-- ============================================================
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  form_id          text not null default 'manual',
  form_name        text,
  answers          jsonb not null default '[]'::jsonb,
  nome             text not null check (char_length(nome) between 2 and 120),
  whatsapp         text check (whatsapp is null or char_length(whatsapp) between 10 and 20),
  email            text check (email is null or char_length(email) <= 160),
  instagram        text check (instagram is null or char_length(instagram) <= 60),
  faturamento      text,
  stage_id         uuid references public.stages(id) on delete set null,
  assigned_to      uuid references public.profiles(id) on delete set null,
  label_ids        uuid[] not null default '{}',
  valor            numeric(12,2),
  reminder_at      timestamptz,
  reminder_note    text,
  source           text not null default 'organico',
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  utm_term         text,
  fbclid           text,
  referrer         text,
  user_agent       text,
  session_id       text
);
-- localização e identificadores usados pela Meta e pelo Google
alter table public.leads add column if not exists estado text;
alter table public.leads add column if not exists cidade text;
alter table public.leads add column if not exists cep text;
alter table public.leads add column if not exists visitor_id text;
alter table public.leads add column if not exists fbp text;
alter table public.leads add column if not exists fbc text;
alter table public.leads add column if not exists gclid text;
alter table public.leads add column if not exists gbraid text;
alter table public.leads add column if not exists wbraid text;
alter table public.leads add column if not exists ga_client_id text;
alter table public.leads add column if not exists client_ip text;
alter table public.leads add column if not exists event_source_url text;
alter table public.leads add column if not exists lead_event_id text;
alter table public.leads add column if not exists meta_lead_id text;
alter table public.leads add column if not exists recovered_from uuid;   -- formulário incompleto que originou o lead
alter table public.leads add column if not exists utm_id text;            -- id da campanha (casa com os gastos da Meta)
alter table public.leads add column if not exists won_at timestamptz;     -- quando entrou num estágio de venda
alter table public.leads add column if not exists canceled_at date;       -- cliente cancelou o contrato (churn)
alter table public.leads add column if not exists cancel_reason text;     -- motivo do cancelamento
alter table public.leads add column if not exists contract_months int check (contract_months between 1 and 120); -- meses do contrato (vazio = padrão)
alter table public.leads add column if not exists junk_reason text;       -- por que foi pro descarte (dados falsos)
alter table public.leads add column if not exists junk_ok boolean not null default false; -- alguém confirmou que o lead é real
-- leads que vieram de fora (formulários da Meta, Respondi, planilhas): origem e id no sistema de origem (evita duplicar)
alter table public.leads add column if not exists imported_from text;
alter table public.leads add column if not exists external_id text;
create unique index if not exists leads_external_idx on public.leads (external_id) where external_id is not null;
create index if not exists leads_email_idx on public.leads (lower(email));
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check check (source in ('pago', 'organico', 'manual', 'api'));

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_stage_idx on public.leads (stage_id);
create index if not exists leads_whatsapp_idx on public.leads (whatsapp);
create index if not exists leads_session_idx on public.leads (session_id);
create index if not exists leads_won_idx on public.leads (won_at) where won_at is not null;


-- ============================================================
-- 5. HISTÓRICO
-- ============================================================
create table if not exists public.lead_activity (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  created_at  timestamptz not null default now(),
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  type        text not null,
  body        text not null check (char_length(body) between 1 and 1000)
);
alter table public.lead_activity drop constraint if exists lead_activity_type_check;
alter table public.lead_activity add constraint lead_activity_type_check
  check (type in ('created', 'note', 'stage', 'assign', 'label', 'reminder', 'edit', 'recovered'));
create index if not exists lead_activity_idx on public.lead_activity (lead_id, created_at desc);


-- ============================================================
-- 6. FORMULÁRIO E RECUPERAÇÃO
-- form_events: visitas, início e cada pergunta vista (funil de abandono).
-- partial_leads: salvamento automático de cada resposta; vira lead ao concluir
-- ou pode ser recuperado pela equipe.
-- ============================================================
create table if not exists public.form_events (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  form_id      text not null check (char_length(form_id) <= 40),
  session_id   text not null check (char_length(session_id) <= 60),
  event        text not null check (event in ('view', 'start', 'step', 'submit')),
  step_id      text check (char_length(step_id) <= 40),
  utm_source   text check (char_length(utm_source) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 150)
);
create index if not exists form_events_idx on public.form_events (form_id, created_at desc);

create table if not exists public.partial_leads (
  id               uuid primary key default gen_random_uuid(),
  session_id       text not null unique check (char_length(session_id) between 8 and 60),
  resume_token     uuid not null default gen_random_uuid() unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  form_id          text not null,
  form_name        text,
  answers          jsonb not null default '[]'::jsonb,   -- [{id, label, value}] pra exibir
  raw              jsonb not null default '{}'::jsonb,   -- {campo: valor} pra retomar o form
  nome             text,
  whatsapp         text,
  email            text,
  instagram        text,
  faturamento      text,
  estado           text,
  step_id          text,
  step_index       int,
  total_steps      int,
  status           text not null default 'em_andamento'
                   check (status in ('em_andamento', 'abandonado', 'convertido', 'recuperado', 'descartado')),
  lead_id          uuid references public.leads(id) on delete set null,
  contacted_at     timestamptz,
  contacted_by     uuid references public.profiles(id) on delete set null,
  abandoned_at     timestamptz,
  visitor_id       text,
  fbp              text,
  fbc              text,
  ga_client_id     text,
  client_ip        text,
  user_agent       text,
  event_source_url text,
  referrer         text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  utm_term         text,
  fbclid           text,
  gclid            text
);
alter table public.partial_leads add column if not exists utm_id text;
alter table public.partial_leads add column if not exists cidade text;
alter table public.partial_leads add column if not exists cep text;
create index if not exists partial_leads_status_idx on public.partial_leads (status, updated_at desc);


-- ============================================================
-- 6b. CONSTRUTOR DE FORMULÁRIOS
-- fields: mesma estrutura do assets/js/forms.js (tipos, lógica, condicionais).
-- settings: tema (cores, logo, esconder marca), redirecionamento final, GTM etc.
-- ============================================================
create table if not exists public.forms (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{0,40}$'),
  name        text not null check (char_length(name) between 1 and 120),
  fields      jsonb not null default '[]'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  check (pg_column_size(fields) < 200000)
);


-- ============================================================
-- 7. RASTREAMENTO
-- tracking_settings: valores globais (valor do lead por faixa, moeda, meses de contrato).
-- tracking_pixels: um registro por pixel (Meta, GA4, Google Ads), cada um com sua credencial.
-- events (por pixel):
--   page_view, view_content, form_start, form_step  → sinais do navegador (não são conversão)
--   lead                                            → CONVERSÃO: formulário concluído
--   funnel                                          → eventos do pipeline enviados pelo servidor
-- ============================================================
create table if not exists public.tracking_settings (
  id              int primary key default 1 check (id = 1),
  currency        text not null default 'BRL',
  contract_months int not null default 12 check (contract_months between 1 and 60),
  api_version     text not null default 'v21.0',
  lead_values     jsonb not null default '{"Menos de R$15.000": 50, "De R$15.000 a R$30.000": 100, "De R$30.000 a R$50.000": 200, "De R$50.000 a R$100.000": 400, "Acima de R$100.000": 800}',
  updated_at      timestamptz not null default now()
);
insert into public.tracking_settings (id) values (1) on conflict (id) do nothing;
-- quais ações da Meta contam como lead no financeiro (null = automático: "lead" da Meta)
alter table public.tracking_settings add column if not exists meta_lead_actions jsonb;

-- ajustes gerais do CRM
create table if not exists public.app_settings (
  id                     int primary key default 1 check (id = 1),
  crm_url                text not null default 'https://crm.assessoriatracto.com.br',
  site_url               text not null default 'https://assessoriatracto.com.br',
  privacy_version        text not null default '2026-09',
  partial_retention_days int not null default 90 check (partial_retention_days between 7 and 730),
  updated_at             timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
-- app da Meta usado no "Continuar com o Facebook" (Financeiro > Contas de anúncio)
alter table public.app_settings add column if not exists meta_app_id text;
alter table public.app_settings add column if not exists meta_app_secret text;   -- fica só no banco; troca o token curto por um de 60 dias

create table if not exists public.tracking_pixels (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  name             text not null check (char_length(name) between 1 and 80),
  platform         text not null,
  pixel_id         text not null check (char_length(pixel_id) between 4 and 40),
  access_token     text,          -- Meta: token da Conversions API · GA4: api_secret do Measurement Protocol
  conversion_label text,          -- Google Ads: rótulo da conversão (AW-XXX/rótulo)
  test_event_code  text,          -- Meta: código de teste (Gerenciador de Eventos)
  enabled          boolean not null default true,
  mode             text not null default 'recommended' check (mode in ('recommended', 'custom')),
  events           jsonb not null default '{"page_view": true, "view_content": true, "form_start": true, "form_step": false, "lead": true, "funnel": true}',
  unique (platform, pixel_id)
);

-- pixels da Tracto já instalados nas páginas (só navegador até colar o token)
insert into public.tracking_pixels (name, platform, pixel_id)
select * from (values ('Pixel Tracto 1', 'meta', '1357841419671798'), ('Pixel Tracto 2', 'meta', '2142406153298000')) v(name, platform, pixel_id)
where not exists (select 1 from public.tracking_pixels);

alter table public.tracking_pixels drop constraint if exists tracking_pixels_platform_check;
alter table public.tracking_pixels add constraint tracking_pixels_platform_check check (platform in ('meta', 'ga4', 'google_ads', 'gtm'));

create table if not exists public.tracking_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  platform    text not null,
  pixel_ref   uuid references public.tracking_pixels(id) on delete set null,
  pixel_id    text,
  lead_id     uuid references public.leads(id) on delete set null,
  event_name  text,
  event_id    text,
  test        boolean not null default false,
  request_id  bigint,
  status_code int,
  response    text,
  payload     jsonb
);
create index if not exists tracking_events_idx on public.tracking_events (created_at desc);
create index if not exists tracking_events_lead_idx on public.tracking_events (lead_id);
create index if not exists tracking_events_dedup_idx on public.tracking_events (pixel_ref, event_id);


-- ============================================================
-- 8. INTEGRAÇÕES (API e webhooks)
-- ============================================================
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null check (char_length(name) between 1 and 60),
  prefix       text not null,
  key_hash     text not null unique,        -- a chave em si nunca é guardada
  last_used_at timestamptz,
  revoked      boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null
);

create table if not exists public.webhooks (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 1 and 60),
  url        text not null check (url ~ '^https?://'),
  events     text[] not null default '{lead.created}',
  secret     text not null default 'whsec_' || replace(gen_random_uuid()::text, '-', ''),
  active     boolean not null default true
);

alter table public.webhooks add column if not exists format text not null default 'json';
alter table public.webhooks drop constraint if exists webhooks_format_check;
alter table public.webhooks add constraint webhooks_format_check check (format in ('json', 'pushcut'));

create table if not exists public.webhook_deliveries (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  webhook_id  uuid references public.webhooks(id) on delete cascade,
  event       text not null,
  lead_id     uuid,
  payload     jsonb,
  request_id  bigint,
  status_code int,
  response    text
);
create index if not exists webhook_deliveries_idx on public.webhook_deliveries (created_at desc);


-- ============================================================
-- 8b. FINANCEIRO E ANÚNCIOS
-- ad_accounts: contas da Meta Ads (token com permissão ads_read).
-- ad_insights: gasto diário por anúncio, sincronizado pelo banco (pg_net + pg_cron).
-- finance_entries: receitas e despesas lançadas à mão (ferramentas, equipe, impostos…).
-- ============================================================
create table if not exists public.ad_accounts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  platform      text not null default 'meta' check (platform in ('meta')),
  account_id    text not null check (account_id ~ '^act_\d{5,25}$'),
  name          text not null check (char_length(name) between 1 and 80),
  access_token  text,
  enabled       boolean not null default true,
  last_sync_at  timestamptz,
  last_error    text,
  unique (platform, account_id)
);

create table if not exists public.ad_insights (
  id            bigint generated always as identity primary key,
  account_ref   uuid not null references public.ad_accounts(id) on delete cascade,
  date          date not null,
  campaign_id   text,
  campaign_name text,
  adset_id      text,
  adset_name    text,
  ad_id         text not null,
  ad_name       text,
  spend         numeric(12,2) not null default 0,
  impressions   bigint not null default 0,
  clicks        bigint not null default 0,
  reach         bigint,
  meta_leads    int not null default 0,
  updated_at    timestamptz not null default now(),
  unique (account_ref, date, ad_id)
);
create index if not exists ad_insights_date_idx on public.ad_insights (date);
-- métricas extras vindas da própria Meta
alter table public.ad_insights add column if not exists link_clicks bigint not null default 0;
alter table public.ad_insights add column if not exists landing_views int not null default 0;
alter table public.ad_insights add column if not exists messages int not null default 0;
alter table public.ad_insights add column if not exists actions jsonb;
-- coluna "Resultados" do Gerenciador de Anúncios (o evento que a campanha otimiza)
alter table public.ad_insights add column if not exists results int;
alter table public.ad_insights add column if not exists result_indicator text;

alter table public.ad_accounts add column if not exists connected_via text not null default 'token';
alter table public.ad_accounts add column if not exists token_expires_at timestamptz;
alter table public.ad_accounts add column if not exists fb_user_name text;
alter table public.ad_accounts add column if not exists currency text;

-- login com o Facebook: o token curto do navegador é trocado no servidor por um de 60 dias
create table if not exists public.meta_connections (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,
  fb_user_id   text,
  fb_user_name text,
  request_id   bigint,
  status       text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  access_token text,
  expires_at   timestamptz,
  error        text
);

create table if not exists public.ad_sync_jobs (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  account_ref  uuid references public.ad_accounts(id) on delete cascade,
  request_id   bigint,
  processed_at timestamptz,
  error        text
);

create table if not exists public.finance_entries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  date        date not null default current_date,
  kind        text not null check (kind in ('receita', 'despesa')),
  category    text not null default 'Outros' check (char_length(category) between 1 and 40),
  description text check (char_length(description) <= 200),
  amount      numeric(12,2) not null check (amount >= 0),
  lead_id     uuid references public.leads(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null
);
create index if not exists finance_entries_date_idx on public.finance_entries (date);
-- venda manual: meses de contrato e mensalidade (amount = total arrecadado)
alter table public.finance_entries add column if not exists months int check (months between 1 and 120);
alter table public.finance_entries add column if not exists monthly_amount numeric(12,2) check (monthly_amount >= 0);
alter table public.finance_entries add column if not exists canceled_at date;   -- cliente cancelou (churn)
alter table public.finance_entries add column if not exists cancel_reason text;
-- origem da venda (campanha › conjunto › anúncio da Meta) e envio pra Meta
alter table public.finance_entries add column if not exists utm_campaign text;
alter table public.finance_entries add column if not exists utm_term text;
alter table public.finance_entries add column if not exists utm_content text;
alter table public.finance_entries add column if not exists utm_id text;
alter table public.finance_entries add column if not exists meta_sent_at timestamptz;



-- ============================================================
-- 8d. IMPORTAÇÃO DE LEADS (formulários da Meta e planilhas: Respondi, Typeform, Google Forms…)
-- meta_pages / meta_forms: páginas e formulários de cadastro da Meta; meta_lead_jobs: fila de pedidos à Meta.
-- ============================================================
create table if not exists public.meta_pages (
  page_id      text primary key,
  name         text,
  access_token text,                       -- token da página (vem do login do Facebook; nunca volta pro navegador)
  updated_at   timestamptz not null default now()
);
create table if not exists public.meta_forms (
  form_id      text primary key,
  page_id      text references public.meta_pages(page_id) on delete cascade,
  name         text,
  status       text,
  leads_count  int not null default 0,
  last_lead_at timestamptz,
  synced_at    timestamptz
);
create table if not exists public.meta_lead_jobs (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('pages', 'forms', 'leads')),
  ref          text,                       -- página (forms) ou formulário (leads)
  request_id   bigint,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);
create table if not exists public.meta_lead_status (
  id         int primary key default 1 check (id = 1),
  last_run   timestamptz,
  last_error text,
  imported   int not null default 0
);
insert into public.meta_lead_status (id) values (1) on conflict (id) do nothing;

-- grava um lead vindo de fora (sem duplicar por id de origem, WhatsApp ou e-mail). Devolve true se entrou.
create or replace function public.insert_external_lead(r jsonb, p_origin text, p_form_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_phone text := norm_phone(r->>'whatsapp'); v_email text := lower(nullif(btrim(r->>'email'), ''));
        v_nome text := left(btrim(coalesce(nullif(r->>'nome', ''), split_part(v_email, '@', 1), 'Sem nome')), 120);
        v_created timestamptz; v_stage uuid; v_ext text := nullif(btrim(r->>'external_id'), '');
begin
  if v_ext is not null and exists (select 1 from leads where external_id = v_ext) then return false; end if;
  if v_phone is null and v_email is null then return false; end if;
  if (v_phone is not null and exists (select 1 from leads where whatsapp = v_phone))
     or (v_email is not null and exists (select 1 from leads where lower(email) = v_email)) then
    -- já existe: só guarda o id de origem pra não tentar de novo
    if v_ext is not null then
      update leads set external_id = v_ext where external_id is null
        and ((v_phone is not null and whatsapp = v_phone) or (v_email is not null and lower(email) = v_email));
    end if;
    return false;
  end if;
  begin v_created := (r->>'created_at')::timestamptz; exception when others then v_created := null; end;
  if v_created is null or v_created > now() + interval '1 day' then v_created := now(); end if;
  if char_length(v_nome) < 2 then v_nome := 'Sem nome'; end if;
  select id into v_stage from stages where kind = 'open' order by position limit 1;
  insert into leads (created_at, last_activity_at, form_id, form_name, answers, nome, whatsapp, email, instagram, faturamento,
                     stage_id, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id,
                     estado, cidade, imported_from, external_id, meta_lead_id)
  values (v_created, v_created, left(coalesce(nullif(r->>'form_id', ''), p_origin), 60), left(coalesce(nullif(r->>'form_name', ''), p_form_name), 120),
          coalesce(r->'answers', '[]'::jsonb), v_nome,
          case when v_phone is not null and char_length(v_phone) between 10 and 20 then v_phone end,
          left(v_email, 160), left(nullif(regexp_replace(coalesce(r->>'instagram', ''), '^.*instagram\.com/|[@/\s]', '', 'g'), ''), 60),
          left(nullif(btrim(r->>'faturamento'), ''), 80), v_stage,
          case when coalesce(r->>'source', '') in ('pago', 'organico', 'manual', 'api') then r->>'source'
               when coalesce(r->>'utm_campaign', r->>'utm_source', '') <> '' then 'pago' else 'organico' end,
          left(r->>'utm_source', 100), left(r->>'utm_medium', 100), left(r->>'utm_campaign', 200), left(r->>'utm_content', 200),
          left(r->>'utm_term', 200), left(r->>'utm_id', 60),
          coalesce(left(nullif(upper(btrim(r->>'estado')), ''), 2), ddd_uf(v_phone)), left(nullif(btrim(r->>'cidade'), ''), 80),
          p_origin, v_ext, case when p_origin = 'meta_form' then v_ext end);
  return true;
end $$;

-- importação por planilha (gestor): p_rows = [{nome, whatsapp, email, instagram, faturamento, created_at, utm_*, answers, external_id}]
create or replace function public.import_leads(p_rows jsonb, p_origin text, p_form_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; ok int := 0; skip int := 0;
begin
  if not is_manager() then raise exception 'sem permissão'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'envie até 1000 linhas por vez'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if insert_external_lead(r, left(coalesce(nullif(p_origin, ''), 'planilha'), 30), left(coalesce(nullif(p_form_name, ''), 'Importação'), 120)) then ok := ok + 1; else skip := skip + 1; end if;
  end loop;
  perform audit('insert', 'leads', null, jsonb_build_object('importados', ok, 'ignorados', skip, 'origem', p_origin));
  return jsonb_build_object('importados', ok, 'ignorados', skip);
end $$;

-- formulários da Meta: pede páginas → formulários → leads (assíncrono via pg_net, processado a cada 5 minutos)
create or replace function public.meta_leads_sync() returns int
language plpgsql security definer set search_path = public as $$
declare t text; v_req bigint; n int := 0; v_ver text := (select api_version from tracking_settings where id = 1);
begin
  if auth.uid() is not null and not is_manager() then raise exception 'sem permissão'; end if;
  for t in select distinct access_token from ad_accounts where enabled and access_token is not null loop
    execute 'select net.http_get(url := $1, params := $2, timeout_milliseconds := 20000)' into v_req using
      'https://graph.facebook.com/' || v_ver || '/me/accounts', jsonb_build_object('access_token', t, 'fields', 'id,name,access_token', 'limit', '100');
    insert into meta_lead_jobs (kind, request_id) values ('pages', v_req);
    n := n + 1;
  end loop;
  update meta_lead_status set last_run = now() where id = 1;
  return n;
exception when undefined_table or invalid_schema_name then return 0;
end $$;

create or replace function public.meta_leads_process() returns int
language plpgsql security definer set search_path = public as $$
declare j record; v_body jsonb; r jsonb; f jsonb; v_req bigint; n int := 0; v_ver text := (select api_version from tracking_settings where id = 1);
        pg meta_pages; fm meta_forms; v_answers jsonb; v_nome text; v_first text; v_last text; v_lead jsonb; k text; v text; v_since bigint;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'sem permissão'; end if;
  for j in execute $q$
    select jb.id, jb.kind, jb.ref, resp.status_code, resp.content, resp.error_msg
    from public.meta_lead_jobs jb join net._http_response resp on resp.id = jb.request_id
    where jb.processed_at is null order by jb.id $q$ loop
    begin
      v_body := nullif(j.content, '')::jsonb;
      if not (coalesce(j.status_code, 0) between 200 and 299 and v_body ? 'data') then
        update meta_lead_jobs set processed_at = now(), error = left(coalesce(v_body#>>'{error,message}', j.error_msg, 'HTTP ' || j.status_code), 300) where id = j.id;
        update meta_lead_status set last_error = left(coalesce(v_body#>>'{error,message}', j.error_msg, 'HTTP ' || j.status_code), 300) where id = 1;
        continue;
      end if;
      if j.kind = 'pages' then
        for r in select * from jsonb_array_elements(v_body->'data') loop
          insert into meta_pages (page_id, name, access_token, updated_at) values (r->>'id', r->>'name', r->>'access_token', now())
          on conflict (page_id) do update set name = excluded.name, access_token = coalesce(excluded.access_token, meta_pages.access_token), updated_at = now();
          execute 'select net.http_get(url := $1, params := $2, timeout_milliseconds := 20000)' into v_req using
            'https://graph.facebook.com/' || v_ver || '/' || (r->>'id') || '/leadgen_forms',
            jsonb_build_object('access_token', r->>'access_token', 'fields', 'id,name,status,leads_count', 'limit', '100');
          insert into meta_lead_jobs (kind, ref, request_id) values ('forms', r->>'id', v_req);
        end loop;
      elsif j.kind = 'forms' then
        select * into pg from meta_pages where page_id = j.ref;
        for r in select * from jsonb_array_elements(v_body->'data') loop
          insert into meta_forms (form_id, page_id, name, status, leads_count) values (r->>'id', j.ref, r->>'name', r->>'status', coalesce((r->>'leads_count')::int, 0))
          on conflict (form_id) do update set name = excluded.name, status = excluded.status, leads_count = excluded.leads_count;
          select * into fm from meta_forms where form_id = r->>'id';
          v_since := case when fm.last_lead_at is not null then floor(extract(epoch from fm.last_lead_at - interval '1 hour'))::bigint end;
          execute 'select net.http_get(url := $1, params := $2, timeout_milliseconds := 20000)' into v_req using
            'https://graph.facebook.com/' || v_ver || '/' || (r->>'id') || '/leads',
            jsonb_strip_nulls(jsonb_build_object('access_token', pg.access_token, 'limit', '500',
              'fields', 'id,created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,is_organic,platform',
              'filtering', case when v_since is not null then jsonb_build_array(jsonb_build_object('field', 'time_created', 'operator', 'GREATER_THAN', 'value', v_since))::text end));
          insert into meta_lead_jobs (kind, ref, request_id) values ('leads', r->>'id', v_req);
        end loop;
        if v_body#>>'{paging,next}' is not null then
          execute 'select net.http_get(url := $1, timeout_milliseconds := 20000)' into v_req using v_body#>>'{paging,next}';
          insert into meta_lead_jobs (kind, ref, request_id) values ('forms', j.ref, v_req);
        end if;
      else
        select * into fm from meta_forms where form_id = j.ref;
        for r in select * from jsonb_array_elements(v_body->'data') loop
          v_answers := '[]'::jsonb; v_lead := '{}'::jsonb; v_first := null; v_last := null; v_nome := null;
          for f in select * from jsonb_array_elements(coalesce(r->'field_data', '[]'::jsonb)) loop
            k := lower(f->>'name'); v := f#>>'{values,0}';
            if v is null or v = '' then continue; end if;
            if k in ('full_name', 'nome_completo', 'nome') then v_nome := v;
            elsif k = 'first_name' then v_first := v;
            elsif k = 'last_name' then v_last := v;
            elsif k in ('phone_number', 'telefone', 'whatsapp') or k like '%whats%' or k like '%telefone%' or k like '%celular%' then v_lead := v_lead || jsonb_build_object('whatsapp', v);
            elsif k = 'email' or k like '%e_mail%' or k like '%email%' then v_lead := v_lead || jsonb_build_object('email', v);
            elsif k like '%instagram%' then v_lead := v_lead || jsonb_build_object('instagram', v);
            elsif k like '%fatura%' then v_lead := v_lead || jsonb_build_object('faturamento', replace(v, '_', ' '));
            elsif k in ('state', 'estado') then v_lead := v_lead || jsonb_build_object('estado', v);
            elsif k in ('city', 'cidade') then v_lead := v_lead || jsonb_build_object('cidade', v);
            end if;
            v_answers := v_answers || jsonb_build_array(jsonb_build_object('id', f->>'name', 'label', initcap(replace(f->>'name', '_', ' ')), 'value', replace(v, '_', ' ')));
          end loop;
          v_lead := v_lead || jsonb_build_object(
            'nome', coalesce(v_nome, nullif(btrim(concat_ws(' ', v_first, v_last)), '')),
            'external_id', 'meta:' || (r->>'id'), 'created_at', r->>'created_time', 'answers', v_answers,
            'form_id', 'meta:' || j.ref, 'form_name', 'Meta · ' || coalesce(fm.name, 'Formulário'),
            'source', case when (r->>'is_organic')::boolean then 'organico' else 'pago' end,
            'utm_source', case when r->>'platform' = 'ig' then 'instagram' else 'facebook' end, 'utm_medium', 'lead_ads',
            'utm_campaign', r->>'campaign_name', 'utm_id', r->>'campaign_id', 'utm_term', r->>'adset_name', 'utm_content', r->>'ad_name');
          if insert_external_lead(v_lead, 'meta_form', 'Meta · ' || coalesce(fm.name, 'Formulário')) then
            n := n + 1;
          end if;
          update meta_forms set last_lead_at = greatest(coalesce(last_lead_at, 'epoch'), (r->>'created_time')::timestamptz) where form_id = j.ref;
        end loop;
        update meta_forms set synced_at = now() where form_id = j.ref;
        if v_body#>>'{paging,next}' is not null then
          execute 'select net.http_get(url := $1, timeout_milliseconds := 20000)' into v_req using v_body#>>'{paging,next}';
          insert into meta_lead_jobs (kind, ref, request_id) values ('leads', j.ref, v_req);
        end if;
      end if;
      update meta_lead_jobs set processed_at = now() where id = j.id;
    exception when others then
      update meta_lead_jobs set processed_at = now(), error = left(sqlerrm, 300) where id = j.id;
    end;
  end loop;
  if n > 0 then update meta_lead_status set imported = imported + n, last_error = null where id = 1; end if;
  return n;
exception when undefined_table or invalid_schema_name then return 0;
end $$;

-- situação da importação (tela Contas de anúncio)
create or replace function public.meta_leads_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_manager() then null else jsonb_build_object(
    'last_run', (select last_run from meta_lead_status where id = 1),
    'last_error', (select last_error from meta_lead_status where id = 1),
    'imported', (select imported from meta_lead_status where id = 1),
    'pages', (select count(*) from meta_pages),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'status', status, 'leads', leads_count, 'synced_at', synced_at) order by leads_count desc), '[]') from meta_forms),
    'pending', (select count(*) from meta_lead_jobs where processed_at is null),
    'total_leads', (select count(*) from leads where imported_from = 'meta_form')) end;
$$;


-- venda lançada no Financeiro ligada a um lead: envia a venda (valor do contrato + origem) pra Meta e GA4
create or replace function public.finance_sale_track() returns trigger
language plpgsql security definer set search_path = public as $$
declare l leads; st stages; px tracking_pixels; n int := 0;
begin
  begin
    if new.kind <> 'receita' or new.category not in ('Venda (contrato)', 'Contrato') or new.lead_id is null or new.meta_sent_at is not null then return null; end if;
    select * into l from leads where id = new.lead_id;
    if l.id is null then return null; end if;
    -- a origem informada na venda completa a do lead (sem apagar o que veio do formulário)
    if coalesce(l.utm_campaign, l.utm_id) is null and coalesce(new.utm_campaign, new.utm_id) is not null then
      update leads set utm_campaign = new.utm_campaign, utm_term = new.utm_term, utm_content = new.utm_content, utm_id = new.utm_id,
                       utm_source = coalesce(utm_source, 'facebook'), source = 'pago'
      where id = l.id returning * into l;
    end if;
    select * into st from stages where kind = 'won' order by position limit 1;
    for px in select * from tracking_pixels where enabled and access_token is not null and coalesce((events->>'funnel')::boolean, true) loop
      if px.platform = 'meta' then
        n := n + meta_send(px, l, coalesce(st.meta_event, 'VendaRealizada'), 'sale:' || l.id::text, new.amount, 'system_generated')::int;
      elsif px.platform = 'ga4' and st.ga4_event is not null then
        n := n + ga4_send(px, l, st.ga4_event, 'sale:' || l.id::text, new.amount)::int;
      end if;
    end loop;
    update finance_entries set meta_sent_at = now() where id = new.id;
  exception when others then
    raise warning 'envio da venda falhou: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists finance_sale_track on public.finance_entries;
create trigger finance_sale_track after insert or update of lead_id, amount on public.finance_entries
for each row execute function public.finance_sale_track();


-- ---------- dados falsos ----------
-- devolve os motivos (texto) quando os dados parecem inventados; null quando parecem reais.
-- Descarta com 1 sinal forte (telefone impossível) ou 2 sinais fracos (nome, e-mail ou @ sem sentido).
create or replace function public.junk_reasons(p_nome text, p_phone text, p_email text, p_insta text) returns text
language plpgsql immutable as $$
declare strong text[] := '{}'; weak text[] := '{}'; d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
        loc text; n text := lower(btrim(coalesce(p_nome, ''))); letters text; em text := lower(btrim(coalesce(p_email, '')));
        ig text := lower(regexp_replace(coalesce(p_insta, ''), '[@._\s0-9]', '', 'g'));
begin
  -- telefone: DDD inexistente, número curto, repetido ou sequência
  if d <> '' then
    loc := case when d ~ '^55' and length(d) >= 12 then substr(d, 3) else d end;
    if length(loc) < 10 or length(loc) > 11 then strong := array_append(strong, 'telefone incompleto'::text);
    elsif ddd_uf(loc) is null then strong := array_append(strong, 'DDD inexistente'::text);
    elsif substr(loc, 3) ~ '^(\d)\1+$' or substr(loc, 3) in ('123456789', '987654321', '12345678', '98765432') then strong := array_append(strong, 'telefone repetido'::text);
    elsif length(loc) = 11 and substr(loc, 3, 1) <> '9' then strong := array_append(strong, 'celular inválido'::text);
    elsif length(loc) = 10 and substr(loc, 3, 1) not in ('2', '3', '4', '5') then strong := array_append(strong, 'telefone inválido'::text);
    end if;
  end if;
  -- nome: sem vogais, letras repetidas, só 1 nome curto, teclado batido
  letters := regexp_replace(translate(n, 'áàâãéêíóôõúç', 'aaaaeeiooouc'), '[^a-z]', '', 'g');
  if n <> '' and (length(letters) < 3 or letters !~ '[aeiouy]' or letters ~ '(.)\1\1' or n ~ '\d'
     or letters ~ '(asd|sdf|dfg|fgh|ghj|hjk|jkl|qwe|wer|ert|rty|zxc|xcv|cvb|vbn|bnm)'
     or (n !~ '\s' and length(letters) <= 3)) then weak := array_append(weak, 'nome sem sentido'::text); end if;
  -- e-mail: descartável, teste ou teclado batido
  if em <> '' then
    if em ~ '@(mailinator|yopmail|tempmail|temp-mail|10minutemail|guerrillamail|sharklasers|trashmail|getnada|dispostable|fakeinbox)\.'
       or split_part(em, '@', 1) ~ '^(teste?|test|asdf|qwe|abc|aaa+|xxx+|nome|email|fulano)\d*$' then strong := array_append(strong, 'e-mail de teste'::text);
    elsif split_part(em, '@', 1) ~ '(asdf|qwer|zxcv|hjkl|(.)\2\2\2)' or regexp_replace(split_part(em, '@', 1), '[^a-z]', '', 'g') !~ '[aeiou]' then weak := array_append(weak, 'e-mail sem sentido'::text);
    end if;
  end if;
  -- @ do Instagram: sem vogais ou sílabas repetidas (ex: fkdkdk)
  if length(ig) >= 4 and (ig !~ '[aeiouy]' or ig ~ '^(..)\1{2,}' or ig ~ '(.)(.)\1\2\1') then weak := array_append(weak, '@ sem sentido'::text); end if;
  if cardinality(strong) >= 1 or cardinality(weak) >= 2 then return array_to_string(strong || weak, ', '); end if;
  return null;
end $$;

-- confere os leads novos que ainda não foram tratados (botão "Verificar dados falsos")
create or replace function public.junk_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare v_stage uuid; v_first uuid; l record; r text; n int := 0;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'sem permissão'; end if;
  select id into v_stage from stages where name = 'Descarte' limit 1;
  select id into v_first from stages where kind = 'open' order by position limit 1;
  if v_stage is null then return 0; end if;
  for l in select id, nome, whatsapp, email, instagram from leads
           where not junk_ok and won_at is null and stage_id is not distinct from v_first and imported_from is null loop
    r := junk_reasons(l.nome, l.whatsapp, l.email, l.instagram);
    if r is not null then
      update leads set stage_id = v_stage, junk_reason = r where id = l.id;
      insert into lead_activity (lead_id, author_name, type, body) values (l.id, 'Sistema', 'note', 'Movido pro Descarte: ' || r);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;


-- ============================================================
-- 8e. GERENCIAR CAMPANHAS DA META (pausar, ativar, renomear, orçamento)
-- meta_objects: campanhas, conjuntos e anúncios com status e orçamento (lidos da Meta).
-- meta_object_jobs: pedidos à Meta (ler objetos ou alterar um objeto), processados via pg_net.
-- Alterar exige a permissão ads_management no login do Facebook.
-- ============================================================
create table if not exists public.meta_objects (
  id               text primary key,
  level            text not null check (level in ('campaign', 'adset', 'ad')),
  account_ref      uuid references public.ad_accounts(id) on delete cascade,
  campaign_id      text,
  adset_id         text,
  name             text,
  status           text,            -- o que a gente liga/desliga: ACTIVE ou PAUSED
  effective_status text,            -- veiculação real (ex: CAMPAIGN_PAUSED, WITH_ISSUES)
  daily_budget     numeric,         -- em centavos da moeda da conta
  lifetime_budget  numeric,
  updated_at       timestamptz not null default now()
);
create index if not exists meta_objects_level_idx on public.meta_objects (level);

create table if not exists public.meta_object_jobs (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('campaign', 'adset', 'ad', 'update')),
  account_ref  uuid references public.ad_accounts(id) on delete cascade,
  object_id    text,
  patch        jsonb,
  request_id   bigint,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  ok           boolean,
  error        text
);

-- lê campanhas, conjuntos e anúncios (status e orçamento) de todas as contas ativas
create or replace function public.meta_objects_sync(p_account uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare a ad_accounts; v_req bigint; n int := 0; v_ver text := (select api_version from tracking_settings where id = 1); lv text;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'sem permissão'; end if;
  for a in select * from ad_accounts where enabled and access_token is not null and (p_account is null or id = p_account) loop
    foreach lv in array array['campaign', 'adset', 'ad'] loop
      execute 'select net.http_get(url := $1, params := $2, timeout_milliseconds := 20000)' into v_req using
        'https://graph.facebook.com/' || v_ver || '/' || a.account_id || '/' || lv || 's',
        jsonb_build_object('access_token', a.access_token, 'limit', '500',
          'fields', case lv when 'campaign' then 'id,name,status,effective_status,daily_budget,lifetime_budget'
                            when 'adset' then 'id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id'
                            else 'id,name,status,effective_status,campaign_id,adset_id' end);
      insert into meta_object_jobs (kind, account_ref, request_id) values (lv, a.id, v_req);
      n := n + 1;
    end loop;
  end loop;
  return n;
exception when undefined_table or invalid_schema_name then return 0;
end $$;

-- pede uma alteração à Meta: {status: ACTIVE|PAUSED, name, daily_budget, lifetime_budget (reais)}
create or replace function public.meta_object_update(p_id text, p_patch jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare o meta_objects; a ad_accounts; v_params jsonb := '{}'; v_req bigint; v_job bigint; v_ver text := (select api_version from tracking_settings where id = 1);
begin
  if not is_manager() then raise exception 'sem permissão'; end if;
  select * into o from meta_objects where id = p_id;
  if o.id is null then raise exception 'campanha, conjunto ou anúncio não encontrado. Sincronize e tente de novo'; end if;
  select * into a from ad_accounts where id = o.account_ref;
  if a.access_token is null then raise exception 'conta de anúncio sem acesso. Reconecte o Facebook'; end if;
  if p_patch ? 'status' then
    if p_patch->>'status' not in ('ACTIVE', 'PAUSED') then raise exception 'status inválido'; end if;
    v_params := v_params || jsonb_build_object('status', p_patch->>'status');
  end if;
  if p_patch ? 'name' then
    if char_length(btrim(p_patch->>'name')) not between 1 and 400 then raise exception 'nome inválido'; end if;
    v_params := v_params || jsonb_build_object('name', btrim(p_patch->>'name'));
  end if;
  if p_patch ? 'daily_budget' or p_patch ? 'lifetime_budget' then
    if o.level = 'ad' then raise exception 'anúncio não tem orçamento (o orçamento fica no conjunto ou na campanha)'; end if;
    if p_patch ? 'daily_budget' then
      if (p_patch->>'daily_budget')::numeric < 1 then raise exception 'orçamento diário mínimo de R$ 1'; end if;
      v_params := v_params || jsonb_build_object('daily_budget', round((p_patch->>'daily_budget')::numeric * 100)::bigint::text);
    else
      if (p_patch->>'lifetime_budget')::numeric < 1 then raise exception 'orçamento inválido'; end if;
      v_params := v_params || jsonb_build_object('lifetime_budget', round((p_patch->>'lifetime_budget')::numeric * 100)::bigint::text);
    end if;
  end if;
  if v_params = '{}'::jsonb then raise exception 'nada pra alterar'; end if;
  execute 'select net.http_post(url := $1, body := $2, params := $3, timeout_milliseconds := 20000)' into v_req using
    'https://graph.facebook.com/' || v_ver || '/' || o.id, '{}'::jsonb, v_params || jsonb_build_object('access_token', a.access_token);
  insert into meta_object_jobs (kind, account_ref, object_id, patch, request_id, created_by)
  values ('update', a.id, o.id, v_params, v_req, auth.uid()) returning id into v_job;
  perform audit('update', 'meta_objects', o.id, jsonb_build_object('nome', o.name, 'alteracao', v_params));
  return v_job;
end $$;

-- processa as respostas da Meta (leituras e alterações)
create or replace function public.meta_objects_process() returns int
language plpgsql security definer set search_path = public as $$
declare j record; v_body jsonb; r jsonb; v_next bigint; n int := 0; v_err text;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'sem permissão'; end if;
  for j in execute $q$
    select jb.*, resp.status_code, resp.content, resp.error_msg
    from public.meta_object_jobs jb join net._http_response resp on resp.id = jb.request_id
    where jb.processed_at is null order by jb.id $q$ loop
    begin
      v_body := nullif(j.content, '')::jsonb;
      if not coalesce(j.status_code, 0) between 200 and 299 then
        v_err := coalesce(v_body#>>'{error,error_user_msg}', v_body#>>'{error,message}', j.error_msg, 'HTTP ' || j.status_code);
        update meta_object_jobs set processed_at = now(), ok = false, error = left(v_err, 400) where id = j.id;
        continue;
      end if;
      if j.kind = 'update' then
        update meta_objects set
          status = coalesce(j.patch->>'status', status),
          effective_status = case when j.patch ? 'status' then (case when j.patch->>'status' = 'PAUSED' then 'PAUSED' else coalesce(nullif(effective_status, 'PAUSED'), 'ACTIVE') end) else effective_status end,
          name = coalesce(j.patch->>'name', name),
          daily_budget = case when j.patch ? 'daily_budget' then (j.patch->>'daily_budget')::numeric when j.patch ? 'lifetime_budget' then null else daily_budget end,
          lifetime_budget = case when j.patch ? 'lifetime_budget' then (j.patch->>'lifetime_budget')::numeric when j.patch ? 'daily_budget' then null else lifetime_budget end,
          updated_at = now()
        where id = j.object_id;
        -- o nome novo também aparece nos relatórios
        if j.patch ? 'name' then
          update ad_insights set campaign_name = j.patch->>'name' where campaign_id = j.object_id;
          update ad_insights set adset_name = j.patch->>'name' where adset_id = j.object_id;
          update ad_insights set ad_name = j.patch->>'name' where ad_id = j.object_id;
        end if;
        update meta_object_jobs set processed_at = now(), ok = true where id = j.id;
        n := n + 1;
      else
        for r in select * from jsonb_array_elements(coalesce(v_body->'data', '[]'::jsonb)) loop
          insert into meta_objects (id, level, account_ref, campaign_id, adset_id, name, status, effective_status, daily_budget, lifetime_budget, updated_at)
          values (r->>'id', j.kind, j.account_ref, case when j.kind = 'campaign' then r->>'id' else r->>'campaign_id' end,
                  case when j.kind = 'adset' then r->>'id' else r->>'adset_id' end, r->>'name', r->>'status', r->>'effective_status',
                  nullif(r->>'daily_budget', '')::numeric, nullif(r->>'lifetime_budget', '')::numeric, now())
          on conflict (id) do update set name = excluded.name, status = excluded.status, effective_status = excluded.effective_status,
            daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget, campaign_id = excluded.campaign_id,
            adset_id = excluded.adset_id, account_ref = excluded.account_ref, updated_at = now();
          n := n + 1;
        end loop;
        if v_body#>>'{paging,next}' is not null then
          execute 'select net.http_get(url := $1, timeout_milliseconds := 20000)' into v_next using v_body#>>'{paging,next}';
          insert into meta_object_jobs (kind, account_ref, request_id) values (j.kind, j.account_ref, v_next);
        end if;
        update meta_object_jobs set processed_at = now(), ok = true where id = j.id;
      end if;
    exception when others then
      update meta_object_jobs set processed_at = now(), ok = false, error = left(sqlerrm, 400) where id = j.id;
    end;
  end loop;
  return n;
exception when undefined_table or invalid_schema_name then return 0;
end $$;

-- situação de uma alteração (a tela consulta até a Meta responder)
create or replace function public.meta_object_job(p_id bigint) returns jsonb
language sql security definer set search_path = public as $$
  select case when not is_manager() then null else
    (select jsonb_build_object('done', processed_at is not null, 'ok', ok, 'error', error) from meta_object_jobs where id = p_id) end;
$$;

-- ============================================================
-- 8c. AUDITORIA (LGPD: registro de quem fez o quê com dados e credenciais)
-- Tokens e senhas nunca entram no log, só o fato de terem sido alterados.
-- ============================================================
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb
);
create index if not exists audit_log_idx on public.audit_log (created_at desc);

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, actor_name, action, entity, entity_id, details)
  values (auth.uid(), author_name(), p_action, p_entity, p_entity_id, p_details);
$$;


-- ============================================================
-- 9. REPRESENTAÇÕES JSON (webhooks e API)
-- ============================================================
create or replace function public.lead_json(l public.leads) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', l.id, 'criado_em', l.created_at, 'atualizado_em', l.updated_at,
    'nome', l.nome, 'whatsapp', l.whatsapp, 'email', l.email, 'instagram', l.instagram,
    'faturamento', l.faturamento, 'estado', l.estado, 'cidade', l.cidade, 'valor', l.valor,
    'estagio', (select jsonb_build_object('id', s.id, 'nome', s.name, 'tipo', s.kind) from stages s where s.id = l.stage_id),
    'responsavel', (select jsonb_build_object('id', p.id, 'nome', p.nome, 'email', p.email) from profiles p where p.id = l.assigned_to),
    'rotulos', (select jsonb_agg(x.name) from labels x where x.id = any(l.label_ids)),
    'formulario', jsonb_build_object('id', l.form_id, 'nome', l.form_name),
    'respostas', l.answers, 'fonte', l.source, 'recuperado', l.recovered_from is not null,
    'utm', jsonb_strip_nulls(jsonb_build_object('source', l.utm_source, 'medium', l.utm_medium, 'campaign', l.utm_campaign, 'content', l.utm_content, 'term', l.utm_term)),
    'lembrete', l.reminder_at
  ));
$$;

create or replace function public.partial_json(p public.partial_leads) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'iniciado_em', p.created_at, 'atualizado_em', p.updated_at, 'status', p.status,
    'nome', p.nome, 'whatsapp', p.whatsapp, 'email', p.email, 'instagram', p.instagram, 'faturamento', p.faturamento,
    'formulario', jsonb_build_object('id', p.form_id, 'nome', p.form_name),
    'progresso', jsonb_build_object('pergunta', p.step_id, 'respondidas', p.step_index, 'total', p.total_steps),
    'respostas', p.answers,
    'utm', jsonb_strip_nulls(jsonb_build_object('source', p.utm_source, 'medium', p.utm_medium, 'campaign', p.utm_campaign))
  ));
$$;

-- valor enviado com o evento: só na venda confirmada (mensalidade × meses de contrato). Lead não tem valor.
create or replace function public.lead_value(l public.leads, p_mode text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_mode = 'contract' and l.valor > 0 and l.stage_id in (select id from stages where kind = 'won')
    then l.valor * (select contract_months from tracking_settings where id = 1) end;
$$;


-- ============================================================
-- 10. ENVIOS
-- ============================================================
create or replace function public.http_post_json(p_url text, p_body jsonb, p_headers jsonb default '{}'::jsonb, p_params jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  execute 'select net.http_post(url := $1, body := $2, params := $3, headers := $4, timeout_milliseconds := 8000)'
    into v_id using p_url, p_body, p_params, jsonb_build_object('Content-Type', 'application/json') || p_headers;
  return v_id;
exception when others then
  raise warning 'http_post_json falhou: %', sqlerrm;
  return null;
end $$;

-- ---------- webhooks ----------
-- formato 'json': payload completo assinado · 'pushcut': notificação no celular (título, texto e link pro CRM)
create or replace function public.pushcut_body(p_event text, p_data jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', case p_event
      when 'lead.created' then 'Novo lead: ' when 'lead.stage_changed' then 'Lead avançou: ' when 'lead.won' then 'Venda: '
      when 'lead.lost' then 'Lead perdido: ' when 'lead.assigned' then 'Lead atribuído: ' when 'lead.abandoned' then 'Formulário abandonado: '
      when 'lead.recovered' then 'Lead recuperado: ' when 'note.created' then 'Nova nota: ' else 'Tracto: ' end
      || coalesce(p_data#>>'{lead,nome}', p_data#>>'{formulario_incompleto,nome}', 'sem nome'),
    'text', concat_ws(' · ',
      coalesce(p_data#>>'{lead,faturamento}', p_data#>>'{formulario_incompleto,faturamento}'),
      p_data#>>'{lead,estagio,nome}',
      coalesce(p_data#>>'{lead,whatsapp}', p_data#>>'{formulario_incompleto,whatsapp}'),
      p_data#>>'{nota,texto}'),
    'defaultAction', jsonb_build_object('url', (select crm_url from app_settings where id = 1) || '/' ||
      case when p_event = 'lead.abandoned' then 'recuperacao' else 'leads' end)
  ));
$$;

create or replace function public.webhook_fire(p_event text, p_lead_id uuid, p_data jsonb, p_only uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare w record; v_body jsonb; v_del bigint; v_req bigint; n int := 0;
begin
  for w in select * from webhooks where active and (p_only is not null and id = p_only or p_only is null and p_event = any(events)) loop
    insert into webhook_deliveries (webhook_id, event, lead_id) values (w.id, p_event, p_lead_id) returning id into v_del;
    if w.format = 'pushcut' then
      v_body := pushcut_body(p_event, p_data);
      v_req := http_post_json(w.url, v_body);
    else
      v_body := jsonb_build_object('id', v_del, 'evento', p_event, 'enviado_em', now(), 'dados', p_data);
      v_req := http_post_json(w.url, v_body, jsonb_build_object(
        'X-Tracto-Event', p_event, 'X-Tracto-Delivery', v_del::text,
        'X-Tracto-Signature', 'sha256=' || hmac_sha256(v_body::text, w.secret), 'User-Agent', 'Tracto-Webhooks/1.0'));
    end if;
    update webhook_deliveries set payload = v_body, request_id = v_req,
      response = case when v_req is null then 'pg_net indisponível' end where id = v_del;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Pushcut pessoal: avisa o SDR no celular quando um lead é atribuído a ele
create or replace function public.notify_assignee(l public.leads) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select pushcut_url into v_url from profiles where id = l.assigned_to and ativo;
  if v_url is null then return; end if;
  perform http_post_json(v_url, jsonb_build_object(
    'title', 'Lead pra você: ' || l.nome,
    'text', concat_ws(' · ', l.faturamento, l.whatsapp, coalesce(l.form_name, l.form_id)),
    'defaultAction', jsonb_build_object('url', (select crm_url from app_settings where id = 1) || '/leads')));
end $$;

-- ---------- Meta Conversions API ----------
create or replace function public.meta_user_data(l public.leads) returns jsonb
language plpgsql stable as $$
declare v_first text := nullif(split_part(btrim(l.nome), ' ', 1), ''); v_last text := nullif(regexp_replace(btrim(l.nome), '^\S+\s*', ''), '');
begin
  return jsonb_strip_nulls(jsonb_build_object(
    'em', case when l.email is not null then jsonb_build_array(meta_hash(l.email)) end,
    'ph', case when l.whatsapp is not null then jsonb_build_array(meta_hash(norm_phone(l.whatsapp))) end,
    'fn', case when v_first is not null then jsonb_build_array(meta_hash(v_first)) end,
    'ln', case when v_last is not null then jsonb_build_array(meta_hash(split_part(v_last, ' ', -1))) end,
    'st', case when coalesce(l.estado, ddd_uf(l.whatsapp)) is not null then jsonb_build_array(meta_hash(coalesce(l.estado, ddd_uf(l.whatsapp)))) end,
    'ct', case when l.cidade is not null then jsonb_build_array(meta_hash(regexp_replace(translate(lower(l.cidade), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z]', '', 'g'))) end,
    'zp', case when l.cep is not null then jsonb_build_array(meta_hash(regexp_replace(l.cep, '\D', '', 'g'))) end,
    'country', jsonb_build_array(meta_hash('br')),
    'external_id', jsonb_build_array(meta_hash(coalesce(l.visitor_id, l.id::text))),
    'client_ip_address', l.client_ip,
    'client_user_agent', l.user_agent,
    'fbc', l.fbc,
    'fbp', l.fbp,
    'lead_id', case when l.meta_lead_id ~ '^\d+$' then l.meta_lead_id::numeric end
  ));
end $$;

create or replace function public.meta_send(px public.tracking_pixels, l public.leads, p_event text, p_event_id text,
  p_value numeric, p_action_source text, p_test boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
declare cfg tracking_settings; st stages; v_event jsonb; v_body jsonb; v_req bigint;
begin
  if px.access_token is null then return false; end if;
  if not p_test and exists (select 1 from tracking_events where pixel_ref = px.id and event_id = p_event_id and not test
                            and coalesce(status_code, 200) between 200 and 299) then return false; end if;
  select * into cfg from tracking_settings where id = 1;
  select * into st from stages where id = l.stage_id;
  v_event := jsonb_strip_nulls(jsonb_build_object(
    'event_name', p_event,
    'event_time', floor(extract(epoch from case when p_event = 'Lead' then l.created_at else now() end))::bigint,
    'event_id', p_event_id,
    'action_source', p_action_source,
    'event_source_url', case when p_action_source = 'website' then coalesce(l.event_source_url, 'https://assessoriatracto.com.br/aplicar/') end,
    'user_data', meta_user_data(l),
    'custom_data', jsonb_strip_nulls(jsonb_build_object(
      'currency', case when p_value is not null then cfg.currency end, 'value', p_value,
      'content_name', coalesce(l.form_name, l.form_id), 'content_category', 'lead',
      'event_source', 'crm', 'lead_event_source', 'Tracto CRM',
      'lead_stage', st.name, 'faturamento', l.faturamento, 'fonte', l.source,
      'utm_source', l.utm_source, 'utm_medium', l.utm_medium, 'utm_campaign', l.utm_campaign, 'utm_content', l.utm_content,
      'utm_term', l.utm_term, 'campaign_id', l.utm_id))
  ));
  v_body := jsonb_strip_nulls(jsonb_build_object('data', jsonb_build_array(v_event), 'test_event_code', px.test_event_code));
  v_req := http_post_json('https://graph.facebook.com/' || cfg.api_version || '/' || px.pixel_id || '/events', v_body, '{}'::jsonb,
                          jsonb_build_object('access_token', px.access_token));
  insert into tracking_events (platform, pixel_ref, pixel_id, lead_id, event_name, event_id, test, request_id, payload, response)
  values ('meta', px.id, px.pixel_id, l.id, p_event, p_event_id, p_test, v_req, v_body, case when v_req is null then 'pg_net indisponível' end);
  return true;
end $$;

-- ---------- Google Analytics 4 (Measurement Protocol) ----------
create or replace function public.ga4_send(px public.tracking_pixels, l public.leads, p_event text, p_event_id text,
  p_value numeric, p_test boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
declare cfg tracking_settings; st stages; v_body jsonb; v_req bigint;
  v_first text := nullif(split_part(btrim(l.nome), ' ', 1), ''); v_last text := nullif(regexp_replace(btrim(l.nome), '^\S+\s*', ''), '');
begin
  if px.access_token is null then return false; end if;
  if not p_test and exists (select 1 from tracking_events where pixel_ref = px.id and event_id = p_event_id and not test) then return false; end if;
  select * into cfg from tracking_settings where id = 1;
  select * into st from stages where id = l.stage_id;
  v_body := jsonb_strip_nulls(jsonb_build_object(
    'client_id', coalesce(l.ga_client_id, l.visitor_id, l.id::text),
    'user_id', l.id::text,
    'timestamp_micros', (floor(extract(epoch from now())) * 1000000)::bigint,
    'user_data', jsonb_strip_nulls(jsonb_build_object(
      'sha256_email_address', case when l.email is not null then jsonb_build_array(meta_hash(l.email)) end,
      'sha256_phone_number', case when l.whatsapp is not null then jsonb_build_array(meta_hash('+' || norm_phone(l.whatsapp))) end,
      'address', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'sha256_first_name', meta_hash(v_first), 'sha256_last_name', meta_hash(split_part(v_last, ' ', -1)),
        'city', lower(l.cidade), 'region', lower(coalesce(l.estado, ddd_uf(l.whatsapp))), 'postal_code', regexp_replace(coalesce(l.cep, ''), '\D', '', 'g'), 'country', 'BR'))))),
    'events', jsonb_build_array(jsonb_build_object('name', p_event, 'params', jsonb_strip_nulls(jsonb_build_object(
      'currency', case when p_value is not null then cfg.currency end, 'value', p_value, 'lead_source', l.source, 'form_name', coalesce(l.form_name, l.form_id),
      'lead_stage', st.name, 'faturamento', l.faturamento, 'transaction_id', p_event_id,
      'campaign', l.utm_campaign, 'source', l.utm_source, 'medium', l.utm_medium, 'engagement_time_msec', 1))))
  ));
  v_req := http_post_json('https://www.google-analytics.com/' || case when p_test then 'debug/mp/collect' else 'mp/collect' end, v_body, '{}'::jsonb,
                          jsonb_build_object('measurement_id', px.pixel_id, 'api_secret', px.access_token));
  insert into tracking_events (platform, pixel_ref, pixel_id, lead_id, event_name, event_id, test, request_id, payload, response)
  values ('ga4', px.id, px.pixel_id, l.id, p_event, p_event_id, p_test, v_req, v_body, case when v_req is null then 'pg_net indisponível' end);
  return true;
end $$;

-- ---------- despacho: decide o que vai pra cada pixel ----------
-- p_kind 'lead'  → formulário concluído (conversão)
-- p_kind 'stage' → lead entrou num estágio com evento configurado (sinal do funil)
create or replace function public.track_lead(p_lead_id uuid, p_kind text, p_stage uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare l leads; st stages; px tracking_pixels; n int := 0;
begin
  select * into l from leads where id = p_lead_id;
  if not found then return 0; end if;
  if p_kind = 'lead' and exists (select 1 from forms where id = l.form_id and (settings->>'pixels') = 'false') then return 0; end if;
  if p_stage is not null then select * into st from stages where id = p_stage; end if;

  for px in select * from tracking_pixels where enabled and access_token is not null loop
    if p_kind = 'lead' and coalesce((px.events->>'lead')::boolean, true) and l.form_id <> 'manual' and l.recovered_from is null then
      if px.platform = 'meta' then
        n := n + meta_send(px, l, 'Lead', coalesce(l.lead_event_id, l.id::text), null,
               case when l.event_source_url is not null then 'website' else 'system_generated' end)::int;
      elsif px.platform = 'ga4' and l.event_source_url is null then
        -- leads do navegador já mandam generate_lead pelo gtag; aqui só os que chegam por API
        n := n + ga4_send(px, l, 'generate_lead', coalesce(l.lead_event_id, l.id::text), null)::int;
      end if;
    elsif p_kind = 'sale' and st.kind = 'won' and coalesce((px.events->>'funnel')::boolean, true) then
      if px.platform = 'meta' then
        n := n + meta_send(px, l, coalesce(st.meta_event, 'VendaRealizada'), 'sale:' || l.id::text, lead_value(l, 'contract'), 'system_generated')::int;
      elsif px.platform = 'ga4' and st.ga4_event is not null then
        n := n + ga4_send(px, l, st.ga4_event, 'sale:' || l.id::text, lead_value(l, 'contract'))::int;
      end if;
    end if;
  end loop;
  return n;
end $$;


-- ============================================================
-- 11. GATILHOS
-- ============================================================
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists tracking_pixels_touch on public.tracking_pixels;
create trigger tracking_pixels_touch before update on public.tracking_pixels
for each row execute function public.touch_updated_at();

-- antes de gravar: rodízio de SDRs, data da venda e carimbo de atualização
create or replace function public.leads_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_team uuid; v_user uuid;
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.last_activity_at := now();
  end if;
  if tg_op = 'INSERT' and new.imported_from is null and not new.junk_ok and new.form_id <> 'manual' then
    new.junk_reason := junk_reasons(new.nome, new.whatsapp, new.email, new.instagram);
    if new.junk_reason is not null then
      new.stage_id := coalesce((select id from stages where name = 'Descarte' limit 1), new.stage_id);
    end if;
  end if;
  -- tirou do Descarte: marca como real (não volta a ser descartado)
  if tg_op = 'UPDATE' and old.junk_reason is not null and new.stage_id is distinct from old.stage_id
     and new.stage_id is distinct from (select id from stages where name = 'Descarte' limit 1) then
    new.junk_ok := true;
  end if;
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    select kind into v_kind from stages where id = new.stage_id;
    new.won_at := case when v_kind = 'won' then coalesce(case when tg_op = 'UPDATE' and old.won_at is not null then old.won_at end, now()) end;
  end if;
  if tg_op = 'INSERT' and new.assigned_to is null and new.junk_reason is null
     and (new.imported_from is null or new.created_at > now() - interval '2 hours') then
    select id into v_team from teams where auto_assign order by created_at limit 1;
    if v_team is not null then
      select id into v_user from profiles
      where ativo and team_id = v_team and role in ('sdr', 'gestor')
      order by last_assigned_at nulls first, created_at limit 1 for update skip locked;
      if v_user is not null then
        new.assigned_to := v_user;
        update profiles set last_assigned_at = now() where id = v_user;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_before_update on public.leads;
drop trigger if exists leads_before_write on public.leads;
create trigger leads_before_write before insert or update on public.leads
for each row execute function public.leads_before_write();

-- histórico automático
create or replace function public.leads_log_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := public.author_name();
begin
  if tg_op = 'INSERT' then
    insert into lead_activity (lead_id, author_id, author_name, type, body)
    values (new.id, auth.uid(), who, case when new.recovered_from is not null then 'recovered' else 'created' end,
      case when new.junk_reason is not null then 'Formulário preenchido com dados suspeitos (' || new.junk_reason || '). Foi direto pro Descarte.'
           when new.imported_from is not null then 'Importado: ' || coalesce(new.form_name, new.imported_from)
           when new.recovered_from is not null then 'Recuperado de formulário incompleto: ' || coalesce(new.form_name, new.form_id)
           when new.form_id = 'manual' then 'Lead criado manualmente'
           when new.form_id = 'api' then 'Lead criado pela API'
           else 'Formulário preenchido: ' || coalesce(new.form_name, new.form_id) end);
    return new;
  end if;
  if new.stage_id is distinct from old.stage_id then
    insert into lead_activity (lead_id, author_id, author_name, type, body)
    values (new.id, auth.uid(), who, 'stage',
      'Estágio: ' || coalesce((select name from stages where id = old.stage_id), 'sem estágio')
      || ' → ' || coalesce((select name from stages where id = new.stage_id), 'sem estágio'));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into lead_activity (lead_id, author_id, author_name, type, body)
    values (new.id, auth.uid(), who, 'assign', 'Atribuído a ' || coalesce((select nome from profiles where id = new.assigned_to), 'ninguém'));
  end if;
  if new.reminder_at is distinct from old.reminder_at then
    insert into lead_activity (lead_id, author_id, author_name, type, body)
    values (new.id, auth.uid(), who, 'reminder',
      case when new.reminder_at is null then 'Lembrete removido'
           else 'Lembrete para ' || to_char(new.reminder_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') end);
  end if;
  return new;
end $$;
drop trigger if exists leads_log_changes on public.leads;
create trigger leads_log_changes after insert or update on public.leads
for each row execute function public.leads_log_changes();

-- webhooks + pixels (nunca bloqueia a gravação do lead)
create or replace function public.leads_integrations() returns trigger
language plpgsql security definer set search_path = public as $$
declare st stages; old_st stages; v_data jsonb;
begin
  begin
    if tg_op = 'DELETE' then
      perform webhook_fire('lead.deleted', old.id, jsonb_build_object('lead', lead_json(old)));
      return null;
    end if;
    v_data := jsonb_build_object('lead', lead_json(new));
    -- dados falsos: não avisa ninguém e não ensina a Meta com lead ruim
    if tg_op = 'INSERT' and new.junk_reason is not null then return null; end if;
    if tg_op = 'INSERT' and new.imported_from is not null then
      -- importado: só avisa quando é lead novo (ex: formulário da Meta das últimas horas); nunca manda conversão
      if new.created_at > now() - interval '2 hours' then
        perform webhook_fire('lead.created', new.id, v_data);
        if new.assigned_to is not null then perform notify_assignee(new); end if;
      end if;
      return null;
    end if;
    if tg_op = 'INSERT' then
      perform webhook_fire(case when new.recovered_from is not null then 'lead.recovered' else 'lead.created' end, new.id, v_data);
      perform track_lead(new.id, 'lead');
      if new.assigned_to is not null then perform notify_assignee(new); end if;
      return null;
    end if;
    if new.stage_id is distinct from old.stage_id then
      select * into st from stages where id = new.stage_id;
      select * into old_st from stages where id = old.stage_id;
      v_data := v_data || jsonb_build_object('estagio_anterior', case when old_st.id is not null then jsonb_build_object('id', old_st.id, 'nome', old_st.name) end);
      perform webhook_fire('lead.stage_changed', new.id, v_data);
      if st.kind = 'won' then perform webhook_fire('lead.won', new.id, v_data); end if;
      if st.kind = 'lost' then perform webhook_fire('lead.lost', new.id, v_data); end if;
    end if;
    -- Meta/GA4: mover no pipeline não manda nada. Só a VENDA, uma vez por cliente, quando ele está
    -- no estágio de venda e já tem mensalidade (se a mensalidade entrar depois, manda nesse momento).
    if (new.stage_id is distinct from old.stage_id or coalesce(new.valor, 0) is distinct from coalesce(old.valor, 0))
       and coalesce(new.valor, 0) > 0 and exists (select 1 from stages where id = new.stage_id and kind = 'won') then
      perform track_lead(new.id, 'sale', new.stage_id);
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      perform webhook_fire('lead.assigned', new.id, v_data);
      if new.assigned_to is not null and new.assigned_to is distinct from auth.uid() then perform notify_assignee(new); end if;
    end if;
    if (new.nome, new.whatsapp, new.email, new.instagram, new.faturamento, new.valor, new.label_ids)
       is distinct from (old.nome, old.whatsapp, old.email, old.instagram, old.faturamento, old.valor, old.label_ids) then
      perform webhook_fire('lead.updated', new.id, v_data);
    end if;
  exception when others then
    raise warning 'integrações falharam: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists leads_integrations on public.leads;
create trigger leads_integrations after insert or update or delete on public.leads
for each row execute function public.leads_integrations();

create or replace function public.activity_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'note' then
    update leads set last_activity_at = now() where id = new.lead_id;
    begin
      perform webhook_fire('note.created', new.lead_id, jsonb_build_object(
        'nota', jsonb_build_object('texto', new.body, 'autor', new.author_name, 'criada_em', new.created_at),
        'lead', (select lead_json(l) from leads l where l.id = new.lead_id)));
    exception when others then raise warning 'webhook de nota falhou: %', sqlerrm; end;
  end if;
  return new;
end $$;
drop trigger if exists activity_touch_lead on public.lead_activity;
drop trigger if exists activity_integrations on public.lead_activity;
drop trigger if exists activity_after_insert on public.lead_activity;
create trigger activity_after_insert after insert on public.lead_activity
for each row execute function public.activity_after_insert();

-- auditoria automática (LGPD)
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', '');
  v_det jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'UPDATE' and (new.role, new.ativo, new.team_id) is not distinct from (old.role, old.ativo, old.team_id) then return null; end if;
    v_det := jsonb_build_object('email', coalesce(new.email, old.email), 'papel', new.role, 'ativo', new.ativo);
  elsif tg_table_name = 'leads' then
    v_det := jsonb_build_object('nome', old.nome);
  elsif tg_table_name in ('tracking_pixels', 'ad_accounts') then
    if tg_op = 'UPDATE' and (to_jsonb(new)->>'access_token') is not distinct from (to_jsonb(old)->>'access_token') and tg_table_name = 'ad_accounts' then return null; end if;
    v_det := jsonb_build_object('nome', coalesce(to_jsonb(new)->>'name', to_jsonb(old)->>'name'),
      'token_alterado', tg_op = 'UPDATE' and (to_jsonb(new)->>'access_token') is distinct from (to_jsonb(old)->>'access_token'));
  elsif tg_table_name in ('api_keys', 'webhooks', 'forms') then
    v_det := jsonb_build_object('nome', coalesce(to_jsonb(new)->>'name', to_jsonb(old)->>'name'));
  end if;
  perform audit(lower(tg_op), tg_table_name, v_id, v_det);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'tracking_pixels', 'ad_accounts', 'api_keys', 'webhooks', 'forms'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
  drop trigger if exists audit_leads on public.leads;
  create trigger audit_leads after delete on public.leads for each row execute function public.audit_trigger();
end $$;

create or replace function public.forms_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists forms_touch on public.forms;
create trigger forms_touch before insert or update on public.forms
for each row execute function public.forms_touch();

create or replace function public.labels_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update leads set label_ids = array_remove(label_ids, old.id) where old.id = any(label_ids);
  return old;
end $$;
drop trigger if exists labels_cleanup on public.labels;
create trigger labels_cleanup after delete on public.labels
for each row execute function public.labels_cleanup();


-- ============================================================
-- 12. RPCs PÚBLICAS (visitante do site e API)
-- ============================================================

-- envio final do formulário (vira lead no pipeline)
create or replace function public.submit_lead(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_nome   text := left(btrim(p->>'nome'), 120);
  v_wpp    text := norm_phone(p->>'whatsapp');
  v_email  text := nullif(lower(btrim(p->>'email')), '');
  v_insta  text := nullif(lower(regexp_replace(coalesce(p->>'instagram', ''), '[@\s]', '', 'g')), '');
  v_medium text := lower(coalesce(p->>'utm_medium', ''));
  v_uf     text;
  v_id     uuid;
begin
  if v_nome is null or char_length(v_nome) < 2 then raise exception 'nome obrigatório'; end if;
  if v_wpp is null or char_length(v_wpp) > 15 then raise exception 'whatsapp inválido'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then v_email := null; end if;
  if jsonb_typeof(coalesce(p->'answers', '[]'::jsonb)) <> 'array' or pg_column_size(p->'answers') > 20000 then raise exception 'respostas inválidas'; end if;
  v_uf := coalesce(nullif(left(upper(btrim(p->>'estado')), 2), ''), ddd_uf(v_wpp));

  -- reenvio do mesmo WhatsApp no mesmo form em 10 min: atualiza em vez de duplicar
  select id into v_id from leads
  where whatsapp = v_wpp and form_id = p->>'form_id' and created_at > now() - interval '10 minutes'
  order by created_at desc limit 1;

  if v_id is not null then
    update leads set answers = coalesce(p->'answers', answers), nome = v_nome, email = coalesce(v_email, email),
      instagram = coalesce(v_insta, instagram), faturamento = coalesce(p->>'faturamento', faturamento)
    where id = v_id;
  else
    insert into leads (form_id, form_name, answers, nome, whatsapp, email, instagram, faturamento, estado, cidade, cep,
      stage_id, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, fbclid, gclid, gbraid, wbraid,
      referrer, user_agent, session_id, visitor_id, fbp, fbc, ga_client_id, client_ip, event_source_url, lead_event_id, meta_lead_id)
    values (
      left(coalesce(p->>'form_id', 'desconhecido'), 40), left(p->>'form_name', 120), coalesce(p->'answers', '[]'::jsonb),
      v_nome, v_wpp, v_email, left(v_insta, 60), left(p->>'faturamento', 60), v_uf, left(p->>'cidade', 80),
      nullif(left(regexp_replace(coalesce(p->>'cep', ''), '\D', '', 'g'), 8), ''),
      (select id from stages where kind = 'open' order by position limit 1),
      case when coalesce(nullif(p->>'fbclid', ''), nullif(p->>'fbc', ''), nullif(p->>'gclid', ''), nullif(p->>'gbraid', ''), nullif(p->>'wbraid', '')) is not null
             or v_medium in ('cpc', 'ppc', 'paid', 'paid_social', 'ads', 'ad', 'pago') then 'pago' else 'organico' end,
      left(p->>'utm_source', 100), left(p->>'utm_medium', 100), left(p->>'utm_campaign', 150),
      left(p->>'utm_content', 150), left(p->>'utm_term', 150), left(p->>'utm_id', 60), left(p->>'fbclid', 300),
      left(p->>'gclid', 300), left(p->>'gbraid', 300), left(p->>'wbraid', 300),
      left(p->>'referrer', 300), left(p->>'user_agent', 300), left(p->>'session_id', 60), left(p->>'visitor_id', 60),
      left(p->>'fbp', 120), left(p->>'fbc', 400), coalesce(left(p->>'ga_client_id', 60), ga_client_id(p->>'ga_cookie')),
      request_ip(), left(p->>'event_source_url', 500),
      left(coalesce(nullif(p->>'lead_event_id', ''), gen_random_uuid()::text), 60), left(p->>'meta_lead_id', 40)
    )
    returning id into v_id;
  end if;

  -- o rascunho salvo automaticamente vira "convertido"
  if nullif(p->>'session_id', '') is not null then
    update partial_leads set status = 'convertido', lead_id = v_id, updated_at = now()
    where session_id = p->>'session_id' and status <> 'recuperado';
  end if;
  return v_id;
end $$;

-- salvamento automático: cada resposta atualiza o rascunho da sessão
create or replace function public.save_partial(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sid   text := left(btrim(p->>'session_id'), 60);
  v_email text := nullif(lower(btrim(p->>'email')), '');
begin
  if v_sid is null or char_length(v_sid) < 8 then raise exception 'sessão inválida'; end if;
  if pg_column_size(p) > 40000 then raise exception 'rascunho grande demais'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then v_email := null; end if;

  insert into partial_leads as pl (session_id, form_id, form_name, answers, raw, nome, whatsapp, email, instagram, faturamento, estado, cidade, cep,
    step_id, step_index, total_steps, visitor_id, fbp, fbc, ga_client_id, client_ip, user_agent, event_source_url, referrer,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, utm_id)
  values (v_sid, left(coalesce(p->>'form_id', 'desconhecido'), 40), left(p->>'form_name', 120),
    coalesce(p->'answers', '[]'::jsonb), coalesce(p->'raw', '{}'::jsonb),
    nullif(left(btrim(p->>'nome'), 120), ''), norm_phone(p->>'whatsapp'), v_email,
    nullif(lower(regexp_replace(coalesce(p->>'instagram', ''), '[@\s]', '', 'g')), ''), left(p->>'faturamento', 60),
    coalesce(nullif(left(upper(btrim(p->>'estado')), 2), ''), ddd_uf(p->>'whatsapp')),
    left(p->>'cidade', 80), nullif(left(regexp_replace(coalesce(p->>'cep', ''), '\D', '', 'g'), 8), ''),
    left(p->>'step_id', 40), (p->>'step_index')::int, (p->>'total_steps')::int,
    left(p->>'visitor_id', 60), left(p->>'fbp', 120), left(p->>'fbc', 400),
    coalesce(left(p->>'ga_client_id', 60), ga_client_id(p->>'ga_cookie')), request_ip(), left(p->>'user_agent', 300),
    left(p->>'event_source_url', 500), left(p->>'referrer', 300),
    left(p->>'utm_source', 100), left(p->>'utm_medium', 100), left(p->>'utm_campaign', 150), left(p->>'utm_content', 150),
    left(p->>'utm_term', 150), left(p->>'fbclid', 300), left(p->>'gclid', 300), left(p->>'utm_id', 60))
  on conflict (session_id) do update set
    answers = excluded.answers, raw = excluded.raw,
    nome = coalesce(excluded.nome, pl.nome), whatsapp = coalesce(excluded.whatsapp, pl.whatsapp),
    email = coalesce(excluded.email, pl.email), instagram = coalesce(excluded.instagram, pl.instagram),
    faturamento = coalesce(excluded.faturamento, pl.faturamento), estado = coalesce(excluded.estado, pl.estado),
    cidade = coalesce(excluded.cidade, pl.cidade), cep = coalesce(excluded.cep, pl.cep),
    step_id = excluded.step_id, step_index = excluded.step_index, total_steps = excluded.total_steps,
    fbp = coalesce(excluded.fbp, pl.fbp), fbc = coalesce(excluded.fbc, pl.fbc),
    ga_client_id = coalesce(excluded.ga_client_id, pl.ga_client_id), client_ip = coalesce(excluded.client_ip, pl.client_ip),
    updated_at = now(),
    status = case when pl.status = 'abandonado' then 'em_andamento' else pl.status end
  where pl.status in ('em_andamento', 'abandonado');
end $$;

-- link de retomada enviado na recuperação: devolve as respostas pra preencher o form
create or replace function public.get_partial(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('session_id', session_id, 'form_id', form_id, 'raw', raw, 'step_id', step_id)
  from partial_leads where resume_token = p_token and status in ('em_andamento', 'abandonado');
$$;

-- formulário publicado (construtor) por slug ou id
create or replace function public.public_form(p_slug text default null, p_id text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'fields', fields, 'settings', settings)
  from forms where published and (id = p_id or (p_id is null and slug = coalesce(p_slug, ''))) limit 1;
$$;

-- configuração pública dos pixels (sem tokens) pro formulário carregar
create or replace function public.public_tracking() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pixels', coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'id', pixel_id, 'label', conversion_label, 'events', events) order by created_at)
                        from tracking_pixels where enabled), '[]'::jsonb),
    'currency', s.currency, 'lead_values', s.lead_values)
  from tracking_settings s where s.id = 1;
$$;

-- ---------- API (chave trk_…) ----------
create or replace function public.api_key_check(p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update api_keys set last_used_at = now()
  where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex') and not revoked
  returning id into v_id;
  if v_id is null then raise exception 'chave de API inválida' using errcode = '28000'; end if;
  return v_id;
end $$;

create or replace function public.api_create_lead(api_key text, lead jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stage uuid;
begin
  perform api_key_check(api_key);
  v_id := submit_lead(lead || jsonb_build_object(
    'form_id', coalesce(lead->>'form_id', 'api'), 'form_name', coalesce(lead->>'form_name', 'API'),
    'answers', coalesce(lead->'respostas', lead->'answers', '[]'::jsonb), 'session_id', null));
  select id into v_stage from stages where lower(name) = lower(lead->>'estagio');
  update leads set source = case when source = 'organico' then 'api' else source end,
    stage_id = coalesce(v_stage, stage_id), valor = coalesce((lead->>'valor')::numeric, valor)
  where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.api_list_leads(api_key text, desde timestamptz default null, limite int default 100) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform api_key_check(api_key);
  return coalesce((select jsonb_agg(lead_json(l) order by l.created_at desc)
    from (select * from leads where desde is null or created_at >= desde order by created_at desc limit least(greatest(limite, 1), 500)) l), '[]'::jsonb);
end $$;

create or replace function public.api_update_lead(api_key text, lead_id uuid, dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_stage uuid; v_user uuid; l leads;
begin
  perform api_key_check(api_key);
  if not exists (select 1 from leads where id = lead_id) then raise exception 'lead não encontrado'; end if;
  if dados ? 'estagio' then
    select id into v_stage from stages where lower(name) = lower(dados->>'estagio');
    if v_stage is null then raise exception 'estágio "%" não existe', dados->>'estagio'; end if;
  end if;
  if dados ? 'responsavel_email' then select id into v_user from profiles where lower(email) = lower(dados->>'responsavel_email'); end if;
  update leads set
    stage_id = coalesce(v_stage, stage_id),
    assigned_to = case when dados ? 'responsavel_email' then v_user else assigned_to end,
    valor = case when dados ? 'valor' then (dados->>'valor')::numeric else valor end
  where id = lead_id
  returning * into l;
  if nullif(btrim(dados->>'nota'), '') is not null then
    insert into lead_activity (lead_id, type, body, author_name) values (lead_id, 'note', left(dados->>'nota', 1000), 'API');
  end if;
  return jsonb_build_object('ok', true, 'lead', lead_json(l));
end $$;


-- ============================================================
-- 13. RPCs DA EQUIPE
-- ============================================================
create or replace function public.create_api_key(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_key text := 'trk_' || replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  if not is_admin() then raise exception 'sem permissão'; end if;
  insert into api_keys (name, prefix, key_hash, created_by)
  values (left(btrim(p_name), 60), left(v_key, 12), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), auth.uid());
  return v_key;  -- mostrada uma única vez
end $$;

create or replace function public.webhook_test(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare l leads;
begin
  if not is_admin() then raise exception 'sem permissão'; end if;
  select * into l from leads order by created_at desc limit 1;
  return webhook_fire(case when (select format from webhooks where id = p_id) = 'pushcut' then 'lead.created' else 'webhook.test' end, l.id, jsonb_build_object('teste', true, 'lead', case when l.id is not null then lead_json(l) end), p_id);
end $$;

-- evento de teste pra um pixel (Meta exige código de teste; GA4 vai pro endpoint de validação)
create or replace function public.tracking_test(p_pixel uuid) returns int
language plpgsql security definer set search_path = public as $$
declare px tracking_pixels; l leads;
begin
  if not is_admin() then raise exception 'sem permissão'; end if;
  select * into px from tracking_pixels where id = p_pixel;
  if not found then raise exception 'pixel não encontrado'; end if;
  if px.access_token is null then raise exception 'cole o token/API secret do pixel antes de testar'; end if;
  select * into l from leads where form_id <> 'manual' order by created_at desc limit 1;
  if l.id is null then raise exception 'receba ou crie ao menos um lead pra testar'; end if;
  if px.platform = 'meta' then
    if px.test_event_code is null then raise exception 'preencha o código de evento de teste do Gerenciador de Eventos'; end if;
    return meta_send(px, l, 'Lead', 'teste-' || gen_random_uuid()::text, null, 'website', true)::int;
  elsif px.platform = 'ga4' then
    return ga4_send(px, l, 'generate_lead', 'teste-' || gen_random_uuid()::text, null, true)::int;
  end if;
  raise exception 'Google Ads é testado pelo Tag Assistant, direto no formulário';
end $$;

-- lê as respostas HTTP do pg_net e grava nos logs
create or replace function public.integrations_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'sem permissão'; end if;
  execute $q$
    update public.webhook_deliveries d set status_code = coalesce(r.status_code, 0), response = left(coalesce(r.error_msg, r.content::text), 500)
    from net._http_response r where r.id = d.request_id and d.status_code is null;
    update public.tracking_events e set status_code = coalesce(r.status_code, 0), response = left(coalesce(r.error_msg, r.content::text), 800)
    from net._http_response r where r.id = e.request_id and e.status_code is null;
  $q$;
exception when undefined_table or invalid_schema_name then null;
end $$;

-- marca como abandonados os rascunhos parados há 30 min e avisa por webhook (roda a cada 10 min)
create or replace function public.partials_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare p partial_leads; n int := 0;
begin
  if auth.uid() is not null and not is_team() then raise exception 'sem permissão'; end if;
  for p in update partial_leads set status = 'abandonado', abandoned_at = now()
           where status = 'em_andamento' and updated_at < now() - interval '30 minutes'
           returning * loop
    n := n + 1;
    if p.whatsapp is not null or p.email is not null then
      begin perform webhook_fire('lead.abandoned', null, jsonb_build_object('formulario_incompleto', partial_json(p)));
      exception when others then raise warning 'webhook de abandono falhou: %', sqlerrm; end;
    end if;
  end loop;
  -- LGPD: rascunhos não convertidos não ficam guardados pra sempre
  delete from partial_leads
  where status in ('abandonado', 'descartado', 'em_andamento') and lead_id is null
    and updated_at < now() - make_interval(days => (select partial_retention_days from app_settings where id = 1));
  return n;
end $$;

-- ---------- financeiro: sincronização da Meta Ads ----------
-- 1) ads_sync pede os insights (por anúncio e por dia) · 2) ads_sync_process lê as respostas e grava
create or replace function public.ads_sync(p_account uuid default null, p_days int default 3) returns int
language plpgsql security definer set search_path = public as $$
declare a ad_accounts; v_req bigint; n int := 0; v_ver text := (select api_version from tracking_settings where id = 1);
begin
  if auth.uid() is not null and not is_manager() then raise exception 'sem permissão'; end if;
  for a in select * from ad_accounts where enabled and access_token is not null and (p_account is null or id = p_account) loop
    begin
      execute 'select net.http_get(url := $1, params := $2, timeout_milliseconds := 20000)' into v_req using
        'https://graph.facebook.com/' || v_ver || '/' || a.account_id || '/insights',
        -- use_unified_attribution_setting: mesma janela de atribuição do Gerenciador de Anúncios (coluna Resultados)
        jsonb_build_object('access_token', a.access_token, 'level', 'ad', 'time_increment', '1', 'limit', '500', 'use_unified_attribution_setting', 'true',
          'fields', 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,reach,actions,results',
          'time_range', jsonb_build_object('since', to_char(current_date - greatest(p_days, 1) + 1, 'YYYY-MM-DD'), 'until', to_char(current_date, 'YYYY-MM-DD'))::text);
      insert into ad_sync_jobs (account_ref, request_id) values (a.id, v_req);
      n := n + 1;
    exception when others then
      update ad_accounts set last_error = 'pg_net indisponível: ' || sqlerrm where id = a.id;
    end;
  end loop;
  return n;
end $$;

-- versão do banco (diagnóstico: dá pra conferir de fora se a última atualização entrou)
create or replace function public.schema_version() returns text language sql immutable as $$ select '2026-09-29.1'::text $$;
grant execute on function public.schema_version() to anon, authenticated;

-- quantidade de uma ação no "actions" dos insights da Meta (null se não vier)
create or replace function public.action_count(p_actions jsonb, p_type text) returns int
language sql immutable as $$
  select sum((a->>'value')::numeric)::int from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) a where a->>'action_type' = p_type;
$$;

-- "Resultados" da Meta: soma dos valores e o indicador (ex: conversions:offsite_conversion.fb_pixel_custom.RespondiConversion)
create or replace function public.results_value(p_results jsonb) returns int
language sql immutable as $$
  select sum((v->>'value')::numeric)::int from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r, jsonb_array_elements(coalesce(r->'values', '[]'::jsonb)) v;
$$;
-- o resultado é um lead? (formulário, pixel, conversão personalizada, cadastro, conversa…) — visitas ao perfil, engajamento e cliques não
create or replace function public.is_lead_result(p_indicator text) returns boolean
language sql immutable as $$
  select coalesce(p_indicator ~* '(lead|conversions:|registration|application|contact|schedule|messaging_conversation_started)'
    and p_indicator !~* '(profile_visit|engagement|link_click|landing_page|video|thruplay|reach|impression|purchase)', false);
$$;

create or replace function public.ads_sync_process() returns int
language plpgsql security definer set search_path = public as $$
declare j record; v_body jsonb; r jsonb; v_next bigint; n int := 0;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'sem permissão'; end if;
  for j in execute $q$
    select jb.id, jb.account_ref, resp.status_code, resp.content, resp.error_msg
    from public.ad_sync_jobs jb join net._http_response resp on resp.id = jb.request_id
    where jb.processed_at is null order by jb.id $q$ loop
    begin
      v_body := nullif(j.content, '')::jsonb;
      if coalesce(j.status_code, 0) between 200 and 299 and v_body ? 'data' then
        for r in select * from jsonb_array_elements(v_body->'data') loop
          insert into ad_insights (account_ref, date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, clicks, reach, meta_leads,
                                   link_clicks, landing_views, messages, actions, results, result_indicator, updated_at)
          values (j.account_ref, (r->>'date_start')::date, r->>'campaign_id', r->>'campaign_name', r->>'adset_id', r->>'adset_name', r->>'ad_id', r->>'ad_name',
            coalesce((r->>'spend')::numeric, 0), coalesce((r->>'impressions')::bigint, 0), coalesce((r->>'clicks')::bigint, 0), (r->>'reach')::bigint,
            -- leads = coluna "Resultados" do Gerenciador quando a campanha otimiza por lead;
            -- sem ela, o "lead" da Meta (os tipos específicos só entram se ele não vier, pra não contar em dobro)
            case when is_lead_result(r#>>'{results,0,indicator}') then coalesce(results_value(r->'results'), 0)
                 else coalesce(action_count(r->'actions', 'lead'),
                               coalesce(action_count(r->'actions', 'onsite_conversion.lead_grouped'), 0) + coalesce(action_count(r->'actions', 'offsite_conversion.fb_pixel_lead'), 0)) end,
            coalesce((r->>'inline_link_clicks')::bigint, action_count(r->'actions', 'link_click'), 0),
            coalesce(action_count(r->'actions', 'landing_page_view'), 0),
            coalesce(action_count(r->'actions', 'onsite_conversion.messaging_conversation_started_7d'), 0),
            r->'actions', results_value(r->'results'), r#>>'{results,0,indicator}', now())
          on conflict (account_ref, date, ad_id) do update set
            campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name, adset_id = excluded.adset_id, adset_name = excluded.adset_name,
            ad_name = excluded.ad_name, spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks,
            reach = excluded.reach, meta_leads = excluded.meta_leads, link_clicks = excluded.link_clicks, landing_views = excluded.landing_views,
            messages = excluded.messages, actions = excluded.actions, results = excluded.results, result_indicator = excluded.result_indicator, updated_at = now();
          n := n + 1;
        end loop;
        -- próxima página
        if v_body#>>'{paging,next}' is not null then
          execute 'select net.http_get(url := $1, timeout_milliseconds := 20000)' into v_next using v_body#>>'{paging,next}';
          insert into ad_sync_jobs (account_ref, request_id) values (j.account_ref, v_next);
        end if;
        update ad_accounts set last_sync_at = now(), last_error = null where id = j.account_ref;
        update ad_sync_jobs set processed_at = now() where id = j.id;
      else
        update ad_accounts set last_error = left(coalesce(v_body#>>'{error,message}', j.error_msg, 'HTTP ' || j.status_code), 300) where id = j.account_ref;
        update ad_sync_jobs set processed_at = now(), error = left(coalesce(v_body#>>'{error,message}', j.error_msg), 300) where id = j.id;
      end if;
    exception when others then
      update ad_sync_jobs set processed_at = now(), error = left(sqlerrm, 300) where id = j.id;
    end;
  end loop;
  return n;
exception when undefined_table or invalid_schema_name then return 0;
end $$;

-- ---------- Facebook: login nativo e ativação das contas de anúncio ----------
create or replace function public.meta_connect(p_short_token text, p_fb_user_id text, p_fb_user_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cfg app_settings; v_req bigint; v_id uuid; v_ver text := (select api_version from tracking_settings where id = 1);
begin
  if not is_admin() then raise exception 'sem permissão'; end if;
  select * into cfg from app_settings where id = 1;
  if cfg.meta_app_id is null or cfg.meta_app_secret is null then raise exception 'configure o App ID e a chave secreta do app da Meta'; end if;
  if char_length(coalesce(p_short_token, '')) < 20 then raise exception 'token do Facebook inválido'; end if;
  execute 'select net.http_get(url := $1, params := $2, timeout_milliseconds := 15000)' into v_req using
    'https://graph.facebook.com/' || v_ver || '/oauth/access_token',
    jsonb_build_object('grant_type', 'fb_exchange_token', 'client_id', cfg.meta_app_id, 'client_secret', cfg.meta_app_secret, 'fb_exchange_token', p_short_token);
  insert into meta_connections (created_by, fb_user_id, fb_user_name, request_id)
  values (auth.uid(), left(p_fb_user_id, 40), left(p_fb_user_name, 120), v_req) returning id into v_id;
  perform audit('insert', 'meta_connections', v_id::text, jsonb_build_object('nome', p_fb_user_name));
  return v_id;
end $$;

create or replace function public.meta_connect_status(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c meta_connections; r record; v_body jsonb;
begin
  if not is_admin() then raise exception 'sem permissão'; end if;
  select * into c from meta_connections where id = p_id;
  if not found then raise exception 'conexão não encontrada'; end if;
  if c.status = 'pending' then
    execute 'select status_code, content, error_msg from net._http_response where id = $1' into r using c.request_id;
    if found then
      v_body := nullif(r.content, '')::jsonb;
      if coalesce(r.status_code, 0) between 200 and 299 and v_body ? 'access_token' then
        update meta_connections set status = 'ok', access_token = v_body->>'access_token',
          expires_at = now() + make_interval(secs => coalesce((v_body->>'expires_in')::int, 5184000)), error = null
        where id = p_id returning * into c;
      else
        update meta_connections set status = 'error', error = left(coalesce(v_body#>>'{error,message}', r.error_msg, 'HTTP ' || r.status_code), 300)
        where id = p_id returning * into c;
      end if;
    end if;
  end if;
  return jsonb_build_object('status', c.status, 'expires_at', c.expires_at, 'error', c.error, 'fb_user_name', c.fb_user_name);
end $$;

-- p_accounts: [{"id": "act_123", "name": "Conta", "currency": "BRL"}]
create or replace function public.meta_activate_accounts(p_connection uuid, p_accounts jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c meta_connections; a jsonb; v_id uuid; n int := 0;
begin
  if not is_admin() then raise exception 'sem permissão'; end if;
  select * into c from meta_connections where id = p_connection and status = 'ok';
  if not found then raise exception 'conecte o Facebook de novo'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    if (a->>'id') !~ '^act_\d{5,25}$' then continue; end if;
    insert into ad_accounts (platform, account_id, name, access_token, enabled, connected_via, token_expires_at, fb_user_name, currency, last_error)
    values ('meta', a->>'id', left(coalesce(nullif(a->>'name', ''), a->>'id'), 80), c.access_token, true, 'facebook', c.expires_at, c.fb_user_name, left(a->>'currency', 3), null)
    on conflict (platform, account_id) do update set name = excluded.name, access_token = excluded.access_token, enabled = true,
      connected_via = 'facebook', token_expires_at = excluded.token_expires_at, fb_user_name = excluded.fb_user_name,
      currency = excluded.currency, last_error = null
    returning id into v_id;
    perform ads_sync(v_id, 30);
    n := n + 1;
  end loop;
  -- o token fica só nas contas; a conexão não guarda mais cópia
  update meta_connections set access_token = null where id = p_connection;
  return n;
end $$;

-- eventos do CRM que o front registra na auditoria (ex: exportação de leads)
create or replace function public.audit_event(p_action text, p_entity text, p_details jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team() then raise exception 'sem permissão'; end if;
  if p_action not in ('export', 'view_token', 'login') then raise exception 'ação inválida'; end if;
  perform audit(p_action, left(p_entity, 40), null, p_details);
end $$;

-- recuperação: transforma um formulário incompleto em lead do pipeline
-- (não conta como conversão na Meta/Google: o formulário não foi concluído)
create or replace function public.convert_partial(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p partial_leads; v_id uuid;
begin
  if not is_team() then raise exception 'sem permissão'; end if;
  select * into p from partial_leads where id = p_id for update;
  if not found then raise exception 'rascunho não encontrado'; end if;
  if p.lead_id is not null then return p.lead_id; end if;
  if p.nome is null or char_length(p.nome) < 2 then raise exception 'o rascunho precisa ter pelo menos o nome'; end if;
  insert into leads (form_id, form_name, answers, nome, whatsapp, email, instagram, faturamento, estado, cidade, cep, stage_id, source,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, referrer, user_agent, session_id, visitor_id,
    fbp, fbc, ga_client_id, client_ip, event_source_url, recovered_from, assigned_to)
  values (p.form_id, p.form_name, p.answers, p.nome, p.whatsapp, p.email, p.instagram, p.faturamento, p.estado, p.cidade, p.cep,
    (select id from stages where kind = 'open' order by position limit 1),
    case when coalesce(p.fbclid, p.fbc, p.gclid) is not null or lower(coalesce(p.utm_medium, '')) in ('cpc', 'ppc', 'paid', 'paid_social', 'ads', 'ad', 'pago') then 'pago' else 'organico' end,
    p.utm_source, p.utm_medium, p.utm_campaign, p.utm_content, p.utm_term, p.fbclid, p.gclid, p.referrer, p.user_agent,
    p.session_id, p.visitor_id, p.fbp, p.fbc, p.ga_client_id, p.client_ip, p.event_source_url, p.id, auth.uid())
  returning id into v_id;
  update partial_leads set status = 'recuperado', lead_id = v_id, updated_at = now() where id = p.id;
  return v_id;
end $$;


-- ============================================================
-- 14. PERMISSÕES
-- Visitante (anon): só submit_lead, save_partial, get_partial, public_form, public_tracking e a API por chave.
-- ============================================================
do $$
declare f text;
begin
  -- funções internas: ninguém chama direto pela API
  foreach f in array array[
    'hmac_sha256(text, text)', 'meta_hash(text)', 'norm_phone(text)', 'ddd_uf(text)', 'request_ip()', 'ga_client_id(text)',
    'lead_json(public.leads)', 'partial_json(public.partial_leads)', 'lead_value(public.leads, text)',
    'http_post_json(text, jsonb, jsonb, jsonb)', 'webhook_fire(text, uuid, jsonb, uuid)', 'pushcut_body(text, jsonb)',
    'notify_assignee(public.leads)', 'meta_user_data(public.leads)',
    'meta_send(public.tracking_pixels, public.leads, text, text, numeric, text, boolean)',
    'ga4_send(public.tracking_pixels, public.leads, text, text, numeric, boolean)', 'track_lead(uuid, text, uuid)', 'api_key_check(text)',
    'audit(text, text, text, jsonb)', 'insert_external_lead(jsonb, text, text)', 'finance_sale_track()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- públicas
  foreach f in array array['submit_lead(jsonb)', 'save_partial(jsonb)', 'get_partial(uuid)', 'public_tracking()', 'public_form(text, text)',
    'api_create_lead(text, jsonb)', 'api_list_leads(text, timestamptz, int)', 'api_update_lead(text, uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  -- só equipe logada (cada uma confere o papel por dentro)
  foreach f in array array['create_api_key(text)', 'webhook_test(uuid)', 'tracking_test(uuid)', 'integrations_refresh()',
    'partials_sweep()', 'convert_partial(uuid)', 'ads_sync(uuid, int)', 'meta_objects_sync(uuid)', 'meta_object_update(text, jsonb)', 'meta_objects_process()', 'meta_object_job(bigint)', 'ads_sync_process()', 'audit_event(text, text, jsonb)',
    'meta_connect(text, text, text)', 'meta_connect_status(uuid)', 'meta_activate_accounts(uuid, jsonb)',
    'import_leads(jsonb, text, text)', 'meta_leads_sync()', 'meta_leads_process()', 'meta_leads_status()', 'junk_sweep()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- ============================================================
-- 15. RLS
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['profiles', 'teams', 'stages', 'labels', 'leads', 'lead_activity', 'form_events', 'partial_leads', 'forms',
    'tracking_settings', 'app_settings', 'tracking_pixels', 'tracking_events', 'api_keys', 'webhooks', 'webhook_deliveries',
    'ad_accounts', 'ad_insights', 'ad_sync_jobs', 'finance_entries', 'audit_log', 'meta_connections',
    'meta_pages', 'meta_forms', 'meta_lead_jobs', 'meta_lead_status', 'meta_objects', 'meta_object_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    -- remove políticas antigas deste schema antes de recriar
    execute format('drop policy if exists "equipe" on public.%I', t);
    execute format('drop policy if exists "leitura" on public.%I', t);
    execute format('drop policy if exists "escrita" on public.%I', t);
    execute format('drop policy if exists "admin" on public.%I', t);
    execute format('drop policy if exists "gestor" on public.%I', t);
  end loop;

  -- só admin: credenciais e integrações
  foreach t in array array['tracking_settings', 'app_settings', 'tracking_pixels', 'tracking_events', 'api_keys', 'webhooks',
                           'webhook_deliveries', 'ad_accounts', 'meta_connections', 'meta_pages', 'meta_forms', 'meta_lead_jobs', 'meta_lead_status'] loop
    execute format('create policy "admin" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- gestor e admin: financeiro
  foreach t in array array['ad_insights', 'ad_sync_jobs', 'finance_entries', 'meta_objects'] loop
    execute format('create policy "gestor" on public.%I for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
  -- equipe lê, gestor escreve
  foreach t in array array['teams', 'stages', 'forms'] loop
    execute format('create policy "leitura" on public.%I for select to authenticated using (public.is_team())', t);
    execute format('create policy "escrita" on public.%I for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;

create policy "leitura" on public.labels for select to authenticated using (public.is_team());
create policy "escrita" on public.labels for insert to authenticated with check (public.is_team());
create policy "gestor" on public.labels for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- leads: gestor/admin veem todos; SDR vê os dele e os sem dono
drop policy if exists "leads ver" on public.leads;
drop policy if exists "leads criar" on public.leads;
drop policy if exists "leads editar" on public.leads;
drop policy if exists "leads excluir" on public.leads;
create policy "leads ver" on public.leads for select to authenticated
  using (public.is_manager() or (public.is_team() and (assigned_to = auth.uid() or assigned_to is null)));
create policy "leads criar" on public.leads for insert to authenticated with check (public.is_team());
create policy "leads editar" on public.leads for update to authenticated
  using (public.is_manager() or (public.is_team() and (assigned_to = auth.uid() or assigned_to is null)))
  with check (public.is_team());
create policy "leads excluir" on public.leads for delete to authenticated using (public.is_manager());

-- histórico segue a visibilidade do lead
drop policy if exists "atividade ver" on public.lead_activity;
drop policy if exists "atividade criar" on public.lead_activity;
create policy "atividade ver" on public.lead_activity for select to authenticated
  using (public.is_team() and exists (select 1 from public.leads l where l.id = lead_id));
create policy "atividade criar" on public.lead_activity for insert to authenticated
  with check (public.is_team() and exists (select 1 from public.leads l where l.id = lead_id));

-- recuperação: toda a equipe trabalha; só gestor exclui
create policy "leitura" on public.partial_leads for select to authenticated using (public.is_team());
create policy "escrita" on public.partial_leads for update to authenticated using (public.is_team()) with check (public.is_team());
create policy "gestor" on public.partial_leads for delete to authenticated using (public.is_manager());

-- perfis: equipe vê a equipe; cada um edita o próprio (papel/acesso só admin, pelo gatilho)
drop policy if exists "equipe le perfis" on public.profiles;
drop policy if exists "equipe edita perfis" on public.profiles;
create policy "leitura" on public.profiles for select to authenticated using (public.is_team() or id = auth.uid());
create policy "escrita" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- eventos do form: visitante registra, equipe lê
drop policy if exists "anon registra evento" on public.form_events;
drop policy if exists "equipe le eventos" on public.form_events;
create policy "escrita" on public.form_events for insert to anon, authenticated with check (true);
create policy "leitura" on public.form_events for select to authenticated using (public.is_team());

-- auditoria: só admin lê; ninguém edita
create policy "admin" on public.audit_log for select to authenticated using (public.is_admin());


-- ============================================================
-- 16. STORAGE: arquivos enviados nos formulários (bucket privado)
-- ============================================================
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('form-uploads', 'form-uploads', false, 52428800)  -- 50 MB por arquivo (limite do plano grátis)
  on conflict (id) do nothing;
  execute 'drop policy if exists "tracto: visitante envia arquivo" on storage.objects';
  execute 'drop policy if exists "tracto: equipe baixa arquivo" on storage.objects';
  execute $p$create policy "tracto: visitante envia arquivo" on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'form-uploads' and (storage.foldername(name))[1] = 'respostas')$p$;
  execute $p$create policy "tracto: equipe baixa arquivo" on storage.objects for select to authenticated
    using (bucket_id = 'form-uploads' and public.is_team())$p$;
  -- imagens usadas nos formulários (construtor): leitura pública, envio só por gestor/admin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('form-media', 'form-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
  on conflict (id) do nothing;
  execute 'drop policy if exists "tracto: gestor envia imagem" on storage.objects';
  execute $p$create policy "tracto: gestor envia imagem" on storage.objects for insert to authenticated
    with check (bucket_id = 'form-media' and public.is_manager())$p$;
exception when others then raise notice 'storage indisponível: %', sqlerrm;
end $$;


-- ============================================================
-- 17. REALTIME E AGENDAMENTOS
-- ============================================================
do $$ begin alter publication supabase_realtime add table public.leads; exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.partial_leads; exception when duplicate_object or undefined_object then null; end $$;

do $$
begin
  perform cron.schedule('tracto-partials-sweep', '*/10 * * * *', 'select public.partials_sweep()');
  perform cron.schedule('tracto-ads-sync', '15 */3 * * *', 'select public.ads_sync(null, 3)');
  -- a Meta ajusta resultados de dias anteriores (atribuição de até 28 dias): uma vez por dia refaz os últimos 30
  perform cron.schedule('tracto-ads-sync-30d', '30 7 * * *', 'select public.ads_sync(null, 30)');
  perform cron.schedule('tracto-ads-process', '*/5 * * * *', 'select public.ads_sync_process()');
  -- status e orçamento das campanhas, conjuntos e anúncios: lê a cada 3 horas e processa a cada 5 minutos
  perform cron.schedule('tracto-meta-objects', '20 */3 * * *', 'select public.meta_objects_sync()');
  perform cron.schedule('tracto-meta-objects-process', '*/5 * * * *', 'select public.meta_objects_process()');
  -- leads dos formulários da Meta: pede a cada 15 minutos e processa a cada 5
  perform cron.schedule('tracto-meta-leads', '*/15 * * * *', 'select public.meta_leads_sync()');
  perform cron.schedule('tracto-meta-leads-process', '2-59/5 * * * *', 'select public.meta_leads_process()');
exception when others then raise notice 'agendamento indisponível (%); o CRM sincroniza ao abrir as abas', sqlerrm;
end $$;

-- limpeza de versões antigas deste schema
drop table if exists public.capi_events;
drop function if exists public.capi_send(uuid, text, text, numeric, text, boolean);
drop function if exists public.capi_test();
drop function if exists public.activity_touch_lead();
drop function if exists public.activity_integrations();
drop function if exists public.leads_before_update();

-- execução única: lê status e orçamento das campanhas
select public.meta_objects_sync();
