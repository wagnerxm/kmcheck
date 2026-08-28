-- =============================================================================
-- 002_core_entities.sql
-- Entidades centrais do catálogo: sports, leagues, seasons, teams, players e
-- users (perfil de aplicação que estende auth.users do Supabase).
--
-- Ordem de criação importa por causa de FKs: sports -> leagues -> seasons ->
-- teams -> players -> users (users referencia sports via favorite_sport_id).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sports — catálogo de esportes suportados.
-- -----------------------------------------------------------------------------
create table if not exists public.sports (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,          -- 'football'
  name           text not null,                 -- 'Football / Soccer'
  name_pt        text not null,                 -- 'Futebol'
  icon           text,                          -- nome do ícone (lucide/heroicons) ou emoji
  active         boolean not null default true,
  display_order  smallint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.sports is
  'Catálogo de esportes suportados. Inicialmente apenas futebol; schema já preparado para expansão (basquete, tênis etc.).';

create index if not exists sports_active_idx on public.sports (display_order) where active;

-- -----------------------------------------------------------------------------
-- leagues — catálogo de competições/ligas.
-- -----------------------------------------------------------------------------
create table if not exists public.leagues (
  id                     uuid primary key default gen_random_uuid(),
  sport_id               uuid not null references public.sports (id) on delete restrict,
  name                   text not null,
  short_name             text,
  country_code           char(2),                 -- ISO 3166-1 alpha-2; null = competição internacional
  country_name           text,
  confederation          text
                           check (confederation in ('UEFA','CONMEBOL','CONCACAF','AFC','CAF','OFC', null)),
  tier                   smallint not null default 1,   -- 1 = elite nacional (ex.: Série A), 2 = Série B...
  gender                 text not null default 'male'
                           check (gender in ('male','female','mixed')),
  logo_url               text,
  provider               text not null,           -- fonte primária de dados, ex.: 'api-football'
  provider_league_id     text not null,
  external_ids           jsonb not null default '{}'::jsonb,  -- mapeamento multiprovedor: {"sportmonks":"8","opta":"..."}
  active                 boolean not null default true,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (sport_id, provider, provider_league_id)
);

comment on table public.leagues is
  'Catálogo de competições/ligas. tier distingue divisões dentro de um país (1=principal).';
comment on column public.leagues.external_ids is
  'Mapeamento para IDs de outros provedores de dados além do provider primário, permitindo casamento (matching) cruzado sem duplicar linhas.';

create index if not exists leagues_sport_active_idx on public.leagues (sport_id) where active and deleted_at is null;
create index if not exists leagues_country_idx on public.leagues (country_code);
create index if not exists leagues_external_ids_gin on public.leagues using gin (external_ids);
create index if not exists leagues_name_trgm on public.leagues using gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- seasons — temporadas de cada liga.
-- -----------------------------------------------------------------------------
create table if not exists public.seasons (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references public.leagues (id) on delete cascade,
  name           text not null,               -- '2025/2026' ou '2026'
  start_date     date not null,
  end_date       date,
  is_current     boolean not null default false,
  external_ids   jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (league_id, name),
  check (end_date is null or end_date >= start_date)
);

comment on table public.seasons is
  'Temporadas de cada liga. is_current identifica a temporada vigente para consultas default da UI.';

-- Garante no máximo UMA temporada corrente por liga (índice único parcial).
create unique index if not exists seasons_one_current_per_league
  on public.seasons (league_id) where is_current;

create index if not exists seasons_league_dates_idx on public.seasons (league_id, start_date desc);

-- -----------------------------------------------------------------------------
-- teams — catálogo de times.
-- -----------------------------------------------------------------------------
create table if not exists public.teams (
  id                 uuid primary key default gen_random_uuid(),
  sport_id           uuid not null references public.sports (id) on delete restrict,
  league_id          uuid references public.leagues (id) on delete set null,  -- liga principal/mais recente
  name               text not null,
  short_name         text,
  code               text,                     -- sigla de 3 letras, ex.: 'FLA'
  country_code       char(2),
  founded_year       smallint,
  logo_url           text,
  venue_name         text,
  venue_city         text,
  provider           text not null,
  provider_team_id   text not null,
  external_ids       jsonb not null default '{}'::jsonb,
  active             boolean not null default true,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (provider, provider_team_id)
);

comment on table public.teams is
  'Catálogo de times. league_id é apenas a liga mais recente para exibição rápida — a filiação real por temporada é derivada de events.';

create index if not exists teams_sport_active_idx on public.teams (sport_id) where active and deleted_at is null;
create index if not exists teams_league_idx on public.teams (league_id);
create index if not exists teams_external_ids_gin on public.teams using gin (external_ids);
create index if not exists teams_name_trgm on public.teams using gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- players — elenco.
-- -----------------------------------------------------------------------------
create table if not exists public.players (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid references public.teams (id) on delete set null,
  full_name            text not null,
  common_name          text,                    -- nome de exibição, ex.: 'Vinícius Jr.'
  birth_date           date,
  nationality_code     char(2),
  position             text
                         check (position in ('goalkeeper','defender','midfielder','forward')),
  shirt_number         smallint,
  height_cm            smallint,
  preferred_foot       text check (preferred_foot in ('left','right','both')),
  photo_url            text,
  provider             text not null,
  provider_player_id   text not null,
  external_ids         jsonb not null default '{}'::jsonb,
  active               boolean not null default true,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider, provider_player_id)
);

comment on table public.players is
  'Catálogo de jogadores. team_id nulo representa jogador sem clube no momento.';

create index if not exists players_team_idx on public.players (team_id) where active and deleted_at is null;
create index if not exists players_name_trgm on public.players using gin (full_name gin_trgm_ops);
create index if not exists players_external_ids_gin on public.players using gin (external_ids);

-- -----------------------------------------------------------------------------
-- users — perfil de aplicação, estende auth.users (1:1). Não duplica
-- e-mail/senha (responsabilidade do GoTrue) além do e-mail de conveniência.
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    text not null,
  display_name             text,
  full_name                text,
  avatar_url               text,
  subscription_tier        text not null default 'free'
                             check (subscription_tier in ('free','basic','pro','enterprise')),
  subscription_status      text not null default 'active'
                             check (subscription_status in ('active','trialing','past_due','canceled','paused')),
  subscription_renews_at   timestamptz,
  stripe_customer_id       text unique,
  stripe_subscription_id   text unique,
  timezone                 text not null default 'America/Sao_Paulo',
  locale                   text not null default 'pt-BR',
  favorite_sport_id        uuid references public.sports (id) on delete set null,
  preferences              jsonb not null default '{}'::jsonb,
  role                     text not null default 'user'
                             check (role in ('user','analyst','admin','service')),
  onboarded_at             timestamptz,
  last_seen_at             timestamptz,
  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.users is
  'Perfil de aplicação por usuário autenticado. 1:1 com auth.users. Tenant raiz do modelo multi-tenant do BetEdge.';
comment on column public.users.full_name is
  'Nome completo de exibição preenchido pelo usuário no onboarding; display_name é o apelido/nome curto usado na UI quando presente.';
comment on column public.users.preferences is
  'Ex.: {"odds_format":"decimal","followed_leagues":["..."],"theme":"dark","default_stake":100}';
comment on column public.users.role is
  'user = assinante comum; analyst = acesso de leitura estendido (dashboards internos); admin = acesso total; service = contas técnicas (workers/Edge Functions).';

create index if not exists users_subscription_tier_idx on public.users (subscription_tier) where deleted_at is null;
create index if not exists users_role_idx on public.users (role) where role <> 'user';
create index if not exists users_preferences_gin on public.users using gin (preferences);

-- -----------------------------------------------------------------------------
-- Provisionamento automático: ao criar um usuário em auth.users, cria a linha
-- correspondente em public.users automaticamente.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user is
  'Cria automaticamente o perfil de aplicação (public.users) quando um novo usuário se registra via Supabase Auth (auth.users).';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
