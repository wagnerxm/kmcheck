-- =============================================================================
-- 008_value_alerts_favorites.sql
-- Tabelas voltadas ao usuário final: value_opportunities (oportunidades de
-- valor detectadas), alerts (alertas configuráveis) e favorites.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- value_opportunities — oportunidades de valor detectadas cruzando previsão
-- (de modelo ou de consenso) com odds de mercado.
--
-- Referencia uma linha específica de model_predictions, tabela particionada
-- cuja PK é composta (id, generated_at) — por isso a FK também é composta.
-- -----------------------------------------------------------------------------
create table if not exists public.value_opportunities (
  id                                uuid primary key default gen_random_uuid(),
  event_id                          uuid not null references public.events (id) on delete cascade,
  market_id                         uuid not null references public.markets (id) on delete cascade,
  outcome_id                        uuid not null references public.outcomes (id) on delete cascade,
  bookmaker_id                      uuid not null references public.bookmakers (id) on delete cascade,
  model_version_id                  uuid references public.model_versions (id) on delete set null,
  consensus_prediction_id           uuid references public.consensus_predictions (id) on delete set null,
  model_prediction_id               uuid,             -- ver FK composta abaixo
  model_prediction_generated_at     timestamptz,       -- ver FK composta abaixo
  model_source                      text,              -- rótulo legível da origem: nome/versão do modelo ou 'consensus'
  decimal_odds                      numeric(10,4) not null check (decimal_odds >= 1.0000),
  implied_probability                numeric(8,6) not null check (implied_probability > 0 and implied_probability <= 1),
  fair_probability                  numeric(8,6) not null check (fair_probability > 0 and fair_probability <= 1),
  model_probability                 numeric(8,6) check (model_probability is null or (model_probability > 0 and model_probability <= 1)),
  fair_odds                         numeric(10,4)
                                       generated always as (round(1 / nullif(fair_probability, 0), 4)) stored,
  edge                              numeric(8,6) not null,
  ev                                numeric(8,6) not null,
  edge_score                        numeric(5,2) not null check (edge_score >= 0 and edge_score <= 100),
  confidence                        numeric(5,4),
  kelly_stake_pct                   numeric(6,4),    -- fração de Kelly recomendada
  bookmakers_analyzed               integer not null default 1 check (bookmakers_analyzed >= 1),
  status                            text not null default 'active'
                                       check (status in ('active','expired','odds_moved','result_won','result_lost','result_void','removed')),
  detected_at                       timestamptz not null default now(),
  expires_at                        timestamptz,      -- tipicamente events.kickoff_at, ou quando a odd é suspensa
  expired_at                        timestamptz,       -- alias de compatibilidade: momento em que status transicionou para 'expired'
  resolved_at                       timestamptz,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),
  foreign key (model_prediction_id, model_prediction_generated_at)
    references public.model_predictions (id, generated_at) on delete set null
);

comment on table public.value_opportunities is
  'Oportunidades de valor detectadas cruzando previsão (modelo ou consenso) com odds de mercado. status transiciona active → expired/odds_moved (pré-jogo) ou result_won/result_lost/result_void (após o evento), via job de liquidação — nunca reescreve edge/ev originais, apenas os campos de ciclo de vida (status/resolved_at/expired_at).';
comment on column public.value_opportunities.implied_probability is
  'Probabilidade implícita na decimal_odds da casa (1/decimal_odds), sem remoção de margem — comparada contra fair_probability para evidenciar o overround.';

create index if not exists value_opportunities_active_idx
  on public.value_opportunities (event_id, edge_score desc) where status = 'active';
create index if not exists value_opportunities_bookmaker_idx on public.value_opportunities (bookmaker_id);
create index if not exists value_opportunities_detected_idx on public.value_opportunities (detected_at desc);

-- Imutabilidade PARCIAL: diferente de odds_history/model_predictions,
-- value_opportunities permite UPDATE, mas restrito a colunas de ciclo de vida
-- (status, resolved_at, expires_at, expired_at, updated_at) — os campos
-- analíticos (edge, ev, fair_probability, decimal_odds, edge_score) são
-- imutáveis após a criação, preservando o valor exato detectado no momento.
create or replace function public.trg_lock_value_opportunity_fields()
returns trigger
language plpgsql as $$
begin
  if new.decimal_odds       is distinct from old.decimal_odds
     or new.fair_probability is distinct from old.fair_probability
     or new.edge             is distinct from old.edge
     or new.ev               is distinct from old.ev
     or new.edge_score       is distinct from old.edge_score
  then
    raise exception 'value_opportunities: campos analíticos são imutáveis após a criação; apenas status/resolved_at/expires_at/expired_at podem mudar.';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_analytic_fields on public.value_opportunities;
create trigger lock_analytic_fields
  before update on public.value_opportunities
  for each row execute function public.trg_lock_value_opportunity_fields();

-- -----------------------------------------------------------------------------
-- alerts — alertas configuráveis pelo usuário (value bet, movimento de odds,
-- lesão, escalação confirmada, início de evento, etc.).
-- -----------------------------------------------------------------------------
create table if not exists public.alerts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users (id) on delete cascade,
  name                  text not null,
  alert_type            text not null
                          check (alert_type in ('value_bet','odds_movement','line_movement','injury','lineup_confirmed','event_start','custom')),
  sport_id              uuid references public.sports (id) on delete cascade,
  league_id             uuid references public.leagues (id) on delete cascade,
  team_id               uuid references public.teams (id) on delete cascade,
  event_id              uuid references public.events (id) on delete cascade,
  market_id             uuid references public.markets (id) on delete cascade,
  conditions            jsonb not null default '{}'::jsonb,
  notification_channels text[] not null default array['push']::text[],
  webhook_url           text,
  is_active             boolean not null default true,
  cooldown_minutes      integer not null default 60 check (cooldown_minutes >= 0),
  last_triggered_at     timestamptz,
  trigger_count         integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (notification_channels <@ array['push','email','sms','webhook']::text[])
);

comment on table public.alerts is
  'Alertas configuráveis por usuário. user_id referencia public.users, que é 1:1 com auth.users (deleção em cascata a partir da conta).';
comment on column public.alerts.conditions is
  'Ex.: {"min_edge":0.05,"min_odds":1.80,"max_odds":3.50,"bookmakers":["<uuid>",...],"min_confidence":0.6}';

create index if not exists alerts_user_active_idx on public.alerts (user_id) where is_active;
create index if not exists alerts_type_idx on public.alerts (alert_type) where is_active;
create index if not exists alerts_conditions_gin on public.alerts using gin (conditions);

-- -----------------------------------------------------------------------------
-- favorites — itens marcados como favoritos pelo usuário (evento, time, liga,
-- jogador ou casa de apostas). Colunas por tipo de entidade (em vez de um
-- único entity_id genérico) preservam integridade referencial real via FK.
-- -----------------------------------------------------------------------------
create table if not exists public.favorites (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  entity_type    text not null check (entity_type in ('event','team','league','player','bookmaker')),
  event_id       uuid references public.events (id) on delete cascade,
  team_id        uuid references public.teams (id) on delete cascade,
  league_id      uuid references public.leagues (id) on delete cascade,
  player_id      uuid references public.players (id) on delete cascade,
  bookmaker_id   uuid references public.bookmakers (id) on delete cascade,
  created_at     timestamptz not null default now(),
  check (
    (entity_type = 'event'     and event_id     is not null) or
    (entity_type = 'team'      and team_id      is not null) or
    (entity_type = 'league'    and league_id    is not null) or
    (entity_type = 'player'    and player_id    is not null) or
    (entity_type = 'bookmaker' and bookmaker_id is not null)
  )
);

comment on table public.favorites is
  'Itens favoritados pelo usuário. Exatamente uma das colunas *_id é preenchida, de acordo com entity_type (garantido pelo CHECK acima).';

-- Unicidade por tipo de entidade via índices parciais (UNIQUE com colunas NULL não deduplica como esperado).
create unique index if not exists favorites_unique_event      on public.favorites (user_id, event_id)      where entity_type = 'event';
create unique index if not exists favorites_unique_team       on public.favorites (user_id, team_id)       where entity_type = 'team';
create unique index if not exists favorites_unique_league     on public.favorites (user_id, league_id)     where entity_type = 'league';
create unique index if not exists favorites_unique_player     on public.favorites (user_id, player_id)     where entity_type = 'player';
create unique index if not exists favorites_unique_bookmaker  on public.favorites (user_id, bookmaker_id)  where entity_type = 'bookmaker';

create index if not exists favorites_user_idx on public.favorites (user_id, entity_type);

-- -----------------------------------------------------------------------------
-- Avaliação de alertas (event-driven, via pg_notify). Em vez de sondagem
-- (polling), a avaliação roda como trigger AFTER INSERT em
-- value_opportunities, casando a nova oportunidade contra os alerts ativos do
-- usuário e publicando em um canal NOTIFY consumido por uma Edge
-- Function/worker responsável pelo envio real (push/e-mail/SMS/webhook) —
-- mantendo o Postgres livre de lógica de I/O externo.
-- -----------------------------------------------------------------------------
create or replace function public.trg_evaluate_alerts_on_value_opportunity()
returns trigger
language plpgsql as $$
declare
  a record;
  v_event record;
begin
  select sport_id, league_id into v_event from public.events where id = new.event_id;

  for a in
    select *
    from public.alerts
    where is_active
      and alert_type = 'value_bet'
      and (sport_id  is null or sport_id  = v_event.sport_id)
      and (league_id is null or league_id = v_event.league_id)
      and (event_id  is null or event_id  = new.event_id)
      and (market_id is null or market_id = new.market_id)
      and (last_triggered_at is null or last_triggered_at < now() - make_interval(mins => cooldown_minutes))
      and new.edge_score  >= coalesce((conditions->>'min_edge_score')::numeric, 0)
      and new.edge        >= coalesce((conditions->>'min_edge')::numeric, 0)
      and new.decimal_odds >= coalesce((conditions->>'min_odds')::numeric, 1.0)
      and (conditions->'bookmakers' is null
           or conditions->'bookmakers' @> to_jsonb(new.bookmaker_id::text))
  loop
    perform pg_notify(
      'betedge_alerts',
      json_build_object(
        'alert_id', a.id, 'user_id', a.user_id, 'value_opportunity_id', new.id,
        'event_id', new.event_id, 'edge_score', new.edge_score, 'channels', a.notification_channels
      )::text
    );

    update public.alerts
      set last_triggered_at = now(), trigger_count = trigger_count + 1
      where id = a.id;
  end loop;

  return new;
end;
$$;

comment on function public.trg_evaluate_alerts_on_value_opportunity is
  'Casa cada nova value_opportunity contra os alerts ativos e publica em pg_notify(''betedge_alerts'', ...) para envio assíncrono por um worker/Edge Function — nenhum I/O externo é feito dentro do Postgres.';

drop trigger if exists evaluate_alerts_on_value_opportunity on public.value_opportunities;
create trigger evaluate_alerts_on_value_opportunity
  after insert on public.value_opportunities
  for each row execute function public.trg_evaluate_alerts_on_value_opportunity();
