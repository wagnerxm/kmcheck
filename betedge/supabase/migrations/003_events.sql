-- =============================================================================
-- 003_events.sql
-- Tabelas de eventos: events (partidas), lineups (escalações) e injuries
-- (lesões/suspensões), além do trigger que deriva events.winner automaticamente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- events — partidas/jogos.
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  sport_id           uuid not null references public.sports (id) on delete restrict,
  league_id          uuid not null references public.leagues (id) on delete restrict,
  season_id          uuid references public.seasons (id) on delete set null,
  home_team_id       uuid not null references public.teams (id) on delete restrict,
  away_team_id       uuid not null references public.teams (id) on delete restrict,
  round              text,                       -- 'Rodada 15', 'Quartas de final'
  kickoff_at         timestamptz not null,
  venue_name         text,
  venue_city         text,
  neutral_venue      boolean not null default false,
  status             text not null default 'scheduled'
                       check (status in ('scheduled','live','finished','postponed','cancelled','suspended','awarded')),
  status_minute      smallint,                  -- minuto corrente, quando status = 'live'
  home_score         smallint,
  away_score         smallint,
  home_score_ht      smallint,                  -- placar do intervalo
  away_score_ht      smallint,
  winner             text check (winner in ('home','away','draw')),  -- mantido por trigger, nunca setado manualmente
  provider_primary   text,
  external_ids       jsonb not null default '{}'::jsonb,   -- {"api-football":"12345","sportmonks":"..."}
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  check (status <> 'finished' or (home_score is not null and away_score is not null)),
  unique (home_team_id, away_team_id, kickoff_at)
);

comment on table public.events is
  'Partidas/jogos. winner é derivado automaticamente de home_score/away_score por trigger (nunca setado manualmente pela aplicação).';

create index if not exists events_league_season_idx on public.events (league_id, season_id);
create index if not exists events_kickoff_idx on public.events (kickoff_at);
create index if not exists events_status_live_idx on public.events (status) where status = 'live';
create index if not exists events_status_scheduled_idx on public.events (kickoff_at) where status = 'scheduled';
create index if not exists events_teams_idx on public.events (home_team_id, away_team_id);
create index if not exists events_external_ids_gin on public.events using gin (external_ids);
-- Índice adicional para "últimos jogos finalizados de uma liga" (forma recente, tabelas de classificação).
create index if not exists events_finished_recent_idx on public.events (league_id, kickoff_at desc) where status = 'finished';

-- -----------------------------------------------------------------------------
-- Cálculo automático de events.winner a partir do placar.
-- -----------------------------------------------------------------------------
create or replace function public.trg_set_event_winner()
returns trigger
language plpgsql
as $$
begin
  if new.home_score is not null and new.away_score is not null then
    new.winner := case
      when new.home_score > new.away_score then 'home'
      when new.home_score < new.away_score then 'away'
      else 'draw'
    end;
  else
    new.winner := null;
  end if;
  return new;
end;
$$;

comment on function public.trg_set_event_winner is
  'Deriva events.winner (home/away/draw) a partir de home_score/away_score. Coluna nunca deve ser escrita diretamente pela aplicação.';

drop trigger if exists set_event_winner on public.events;
create trigger set_event_winner
  before insert or update of home_score, away_score on public.events
  for each row execute function public.trg_set_event_winner();

-- -----------------------------------------------------------------------------
-- lineups — escalação confirmada por evento.
-- -----------------------------------------------------------------------------
create table if not exists public.lineups (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references public.events (id) on delete cascade,
  team_id                  uuid not null references public.teams (id) on delete cascade,
  player_id                uuid not null references public.players (id) on delete cascade,
  is_starting              boolean not null default true,
  position                 text,
  shirt_number             smallint,
  formation                text,               -- '4-3-3' repetido em cada linha do time, útil para query sem join
  is_captain               boolean not null default false,
  substituted_in_minute    smallint,
  substituted_out_minute   smallint,
  confirmed_at             timestamptz not null default now(),
  source                   text,
  created_at               timestamptz not null default now(),
  unique (event_id, player_id)
);

comment on table public.lineups is
  'Escalação confirmada por evento. Uma linha por jogador; is_starting distingue titular de reserva.';

create index if not exists lineups_event_idx on public.lineups (event_id);
create index if not exists lineups_player_idx on public.lineups (player_id);

-- -----------------------------------------------------------------------------
-- injuries — lesões, suspensões e outras indisponibilidades.
-- -----------------------------------------------------------------------------
create table if not exists public.injuries (
  id                      uuid primary key default gen_random_uuid(),
  player_id               uuid not null references public.players (id) on delete cascade,
  team_id                 uuid not null references public.teams (id) on delete cascade,
  event_id                uuid references public.events (id) on delete set null,  -- ex.: suspensão por cartão numa partida específica
  type                    text not null
                            check (type in ('injury','suspension','illness','personal','other')),
  description             text,
  severity                text check (severity in ('minor','moderate','severe','unknown')),
  status                  text not null default 'out'
                            check (status in ('out','doubtful','available','unknown')),
  reported_at             timestamptz not null default now(),
  expected_return_date    date,
  resolved_at             timestamptz,
  source                  text,
  provider                text,
  external_ids            jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.injuries is
  'Lesões, suspensões e outras indisponibilidades de jogadores, com vínculo opcional a um evento específico.';

create index if not exists injuries_player_status_idx on public.injuries (player_id) where status in ('out','doubtful');
create index if not exists injuries_team_idx on public.injuries (team_id, reported_at desc);
create index if not exists injuries_event_idx on public.injuries (event_id);
