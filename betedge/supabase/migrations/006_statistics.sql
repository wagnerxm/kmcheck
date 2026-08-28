-- =============================================================================
-- 006_statistics.sql
-- Estatísticas agregadas: team_stats e player_stats.
--
-- team_stats suporta walk-forward validation via as_of_event_id: cada linha
-- pode representar o agregado do time até um determinado evento (exclusive),
-- nunca incluindo dados futuros em relação ao ponto de corte — essencial para
-- gerar features de treino/inferência sem vazamento de dados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- team_stats
-- -----------------------------------------------------------------------------
create table if not exists public.team_stats (
  id                     uuid primary key default gen_random_uuid(),
  team_id                uuid not null references public.teams (id) on delete cascade,
  league_id              uuid not null references public.leagues (id) on delete cascade,
  season_id              uuid not null references public.seasons (id) on delete cascade,
  as_of_event_id         uuid references public.events (id) on delete set null,
  matches_played         integer not null default 0,
  wins                   integer not null default 0,
  draws                  integer not null default 0,
  losses                 integer not null default 0,
  goals_for              integer not null default 0,
  goals_against          integer not null default 0,
  goals_for_home         integer not null default 0,
  goals_against_home     integer not null default 0,
  goals_for_away         integer not null default 0,
  goals_against_away     integer not null default 0,
  goal_difference        integer generated always as (goals_for - goals_against) stored,
  clean_sheets           integer not null default 0,
  failed_to_score        integer not null default 0,
  xg_for                 numeric(6,3),
  xg_against             numeric(6,3),
  xg_diff                numeric(6,3) generated always as (xg_for - xg_against) stored,
  possession_avg         numeric(5,2),
  shots_avg              numeric(5,2),
  shots_on_target_avg    numeric(5,2),
  corners_avg            numeric(5,2),
  fouls_avg              numeric(5,2),
  yellow_cards           integer not null default 0,
  red_cards              integer not null default 0,
  points                 integer generated always as (wins * 3 + draws) stored,
  form_last5             text,          -- ex.: 'WWDLW'
  form                   jsonb not null default '[]'::jsonb,   -- histórico estruturado dos últimos resultados
  home_record            jsonb not null default '{}'::jsonb,   -- {"wins":x,"draws":y,"losses":z,"goals_for":..,"goals_against":..}
  away_record            jsonb not null default '{}'::jsonb,
  computed_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (team_id, season_id, as_of_event_id)
);

comment on table public.team_stats is
  'Estatísticas agregadas do time por temporada. as_of_event_id (nullable) marca o corte temporal: quando preenchido, o agregado reflete somente jogos anteriores àquele evento — usado para gerar features de treino/inferência sem vazamento de dados futuros (walk-forward). Quando null, representa o agregado corrente/total da temporada.';
comment on column public.team_stats.form is
  'Histórico estruturado dos últimos resultados, ex.: [{"event_id":"...","result":"W","goals_for":2,"goals_against":0}, ...], complementar a form_last5.';

create index if not exists team_stats_team_season_idx on public.team_stats (team_id, season_id);
create index if not exists team_stats_as_of_idx on public.team_stats (as_of_event_id) where as_of_event_id is not null;
create index if not exists team_stats_league_points_idx on public.team_stats (league_id, season_id, points desc)
  where as_of_event_id is null;

-- -----------------------------------------------------------------------------
-- player_stats
-- -----------------------------------------------------------------------------
create table if not exists public.player_stats (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references public.players (id) on delete cascade,
  team_id             uuid not null references public.teams (id) on delete cascade,
  season_id           uuid not null references public.seasons (id) on delete cascade,
  event_id            uuid references public.events (id) on delete cascade,  -- null = agregado de temporada
  appearances         integer not null default 0,
  minutes_played      integer,
  goals               integer not null default 0,
  assists             integer not null default 0,
  shots               integer,
  shots_on_target     integer,
  xg                  numeric(6,3),
  xa                  numeric(6,3),
  passes_completed    integer,
  passes_attempted    integer,
  key_passes          integer,
  tackles             integer,
  interceptions       integer,
  yellow_cards        integer not null default 0,
  red_cards           integer not null default 0,
  rating              numeric(4,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (player_id, season_id, event_id)
);

comment on table public.player_stats is
  'Estatísticas de jogador. event_id nulo = agregado de temporada; preenchido = estatísticas de uma partida específica.';

create index if not exists player_stats_player_season_idx on public.player_stats (player_id, season_id);
create index if not exists player_stats_event_idx on public.player_stats (event_id) where event_id is not null;

-- Como `unique (player_id, season_id, event_id)` trata múltiplos event_id NULL
-- como valores distintos (semântica padrão do Postgres para NULL em UNIQUE),
-- o agregado de temporada por jogador é garantido único por um índice único
-- parcial adicional.
create unique index if not exists player_stats_one_season_agg
  on public.player_stats (player_id, season_id) where event_id is null;
