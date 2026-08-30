-- =============================================================================
-- 004_bookmakers_markets.sql
-- Infraestrutura de odds: bookmakers (casas de apostas, com compliance SPA/MF),
-- markets (catálogo normalizado de mercados) e outcomes (resultados possíveis
-- de cada mercado).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- bookmakers — registro de casas de apostas monitoradas.
-- Inclui os campos exigidos para rastrear a autorização SPA/MF (regulação
-- brasileira de apostas esportivas — Lei 14.790/2023 —, vigente desde jan/2025).
-- -----------------------------------------------------------------------------
create table if not exists public.bookmakers (
  id                            uuid primary key default gen_random_uuid(),
  name                          text not null,
  slug                          text not null unique,
  domain                        text,
  logo_url                      text,
  -- --- Compliance regulatório (Brasil) ---
  spa_authorized                boolean not null default false,
  spa_company                   text,          -- razão social da pessoa jurídica autorizada
  spa_authorization             text,          -- nº da portaria/ato de autorização SPA/MF
  spa_authorization_date        date,
  spa_authorization_expires_at  date,
  spa_last_checked_at           timestamptz,   -- última verificação contra o registro oficial da SPA/MF
  -- --- Integração de dados ---
  provider                      text not null,   -- fonte de coleta de odds para esta casa
  provider_bookmaker_id         text not null,
  odds_format                   text not null default 'decimal'
                                  check (odds_format in ('decimal','fractional','american')),
  country_code                  char(2),
  active                        boolean not null default true,
  last_verified_at              timestamptz,     -- última vez que o scraper/feed confirmou a casa online
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (provider, provider_bookmaker_id)
);

comment on table public.bookmakers is
  'Registro de casas de apostas monitoradas. Campos spa_* rastreiam a autorização junto à Secretaria de Prêmios e Apostas do Ministério da Fazenda (Lei 14.790/2023).';
comment on column public.bookmakers.spa_authorized is
  'true somente após confirmação ativa contra o registro público da SPA/MF. Casas não autorizadas devem ser sinalizadas/ocultadas para usuários no Brasil conforme regras de exibição do produto.';

create index if not exists bookmakers_active_idx on public.bookmakers (active) where active;
create index if not exists bookmakers_spa_authorized_idx on public.bookmakers (spa_authorized) where spa_authorized;

-- -----------------------------------------------------------------------------
-- markets — catálogo normalizado de tipos de mercado.
-- -----------------------------------------------------------------------------
create table if not exists public.markets (
  id             uuid primary key default gen_random_uuid(),
  sport_id       uuid not null references public.sports (id) on delete restrict,
  code           text not null,     -- '1x2','double_chance','dnb','ah','ou','btts','team_totals'
  name           text not null,
  name_pt        text not null,
  category       text not null
                   check (category in ('match_result','handicap','totals','both_teams_to_score','team_totals','combo','special')),
  has_line       boolean not null default false,   -- true p/ Asian Handicap, Over/Under, Team Totals
  is_two_way     boolean not null default false,   -- mercados de 2 resultados (DNB, AH sem empate)
  normalization  text not null default 'margin_proportional'
                   check (normalization in ('none','margin_proportional','shin','power')),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sport_id, code)
);

comment on table public.markets is
  'Catálogo normalizado de tipos de mercado. normalization define o método usado para remover a margem da casa (overround) ao calcular a probabilidade justa.';

create index if not exists markets_sport_active_idx on public.markets (sport_id) where active;

-- -----------------------------------------------------------------------------
-- outcomes — resultados possíveis de cada mercado.
-- -----------------------------------------------------------------------------
create table if not exists public.outcomes (
  id             uuid primary key default gen_random_uuid(),
  market_id      uuid not null references public.markets (id) on delete cascade,
  code           text not null,   -- 'home','draw','away','over','under','yes','no','home_dc','away_dc'...
  name           text not null,
  name_pt        text not null,
  line           numeric(6,2),    -- linha numérica p/ O/U, AH, Team Totals (ex.: 2.5, -1.5); null p/ 1X2/BTTS
  display_order  smallint not null default 0,
  created_at     timestamptz not null default now(),
  unique (market_id, code, line)
);

comment on table public.outcomes is
  'Resultados possíveis dentro de um mercado (ex.: home/draw/away no 1X2; over/under numa linha de Over/Under).';
comment on column public.outcomes.line is
  'Para Asian Handicap, a linha carrega o sinal do lado (-1.5 para o favorito, +1.5 para o azarão), permitindo duas linhas de outcome distintas para a mesma partida.';

create index if not exists outcomes_market_idx on public.outcomes (market_id);
