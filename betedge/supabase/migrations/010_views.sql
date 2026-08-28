-- =============================================================================
-- 010_views.sql
-- Views materializadas (mv_*) e views comuns (v_*) de leitura.
--
-- Views materializadas exigem REFRESH periódico (ver nota no fim do arquivo)
-- — em Supabase gerenciado, agendado via pg_cron; em ambientes sem pg_cron,
-- rode o REFRESH a partir de um job externo (worker/cron do próprio app).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- mv_best_odds (mv_current_best_odds) — melhor (maior) odd disponível por
-- evento × mercado × resultado, entre todas as casas ativas e não suspensas.
-- -----------------------------------------------------------------------------
create materialized view if not exists public.mv_best_odds as
select distinct on (o.event_id, o.market_id, o.outcome_id)
  o.event_id,
  o.market_id,
  o.outcome_id,
  o.bookmaker_id  as best_bookmaker_id,
  o.decimal_odds  as best_odds,
  o.last_updated_at,
  o.is_live
from public.odds o
join public.bookmakers b on b.id = o.bookmaker_id
where b.active and not o.is_suspended
order by o.event_id, o.market_id, o.outcome_id, o.decimal_odds desc, o.last_updated_at desc;

comment on materialized view public.mv_best_odds is
  'Melhor odd (maior valor decimal) por evento×mercado×resultado, considerando apenas casas ativas e odds não suspensas. Base de mv_fair_probabilities e da detecção de value bets.';

create unique index if not exists mv_best_odds_pk
  on public.mv_best_odds (event_id, market_id, outcome_id);

-- -----------------------------------------------------------------------------
-- mv_fair_probabilities — probabilidade justa (sem margem/overround) por
-- evento × mercado, usando o método proporcional: cada probabilidade implícita
-- é dividida pela soma das probabilidades implícitas de todos os resultados
-- do mercado (equivalente a markets.normalization = 'margin_proportional').
-- -----------------------------------------------------------------------------
create materialized view if not exists public.mv_fair_probabilities as
with implied as (
  select
    event_id, market_id, outcome_id,
    (1.0 / best_odds) as implied_probability
  from public.mv_best_odds
),
market_totals as (
  select event_id, market_id, sum(implied_probability) as overround
  from implied
  group by event_id, market_id
)
select
  i.event_id,
  i.market_id,
  i.outcome_id,
  i.implied_probability,
  t.overround,
  (i.implied_probability / nullif(t.overround, 0))::numeric(8,6) as fair_probability
from implied i
join market_totals t using (event_id, market_id);

comment on materialized view public.mv_fair_probabilities is
  'Probabilidade "justa" (vig-removed) por evento×mercado×resultado, normalizando as probabilidades implícitas da melhor odd disponível (mv_best_odds) para somarem exatamente 1.';

create unique index if not exists mv_fair_probabilities_pk
  on public.mv_fair_probabilities (event_id, market_id, outcome_id);

-- -----------------------------------------------------------------------------
-- mv_daily_model_performance (mv_model_performance_daily) — resumo diário de
-- performance por modelo, calculado por JOIN com o placar final via
-- fn_grade_prediction (nunca lê um resultado persistido em model_predictions).
-- -----------------------------------------------------------------------------
create materialized view if not exists public.mv_daily_model_performance as
select
  mv.id as model_version_id,
  mv.model_name,
  mv.version,
  date_trunc('day', mp.generated_at) as day,
  mp.market_id,
  count(*) as prediction_count,
  avg(mp.probability) as avg_predicted_probability,
  avg(mp.edge) as avg_edge,
  avg(mp.ev) as avg_ev,
  avg(g.brier_component) as brier_score,
  avg((g.won)::int)::numeric(5,4) as hit_rate
from public.model_predictions mp
join public.model_versions mv on mv.id = mp.model_version_id
cross join lateral public.fn_grade_prediction(mp.id, mp.generated_at) as g(won, brier_component)
where g.won is not null   -- apenas eventos já finalizados e outcomes não anulados (push)
group by mv.id, mv.model_name, mv.version, date_trunc('day', mp.generated_at), mp.market_id;

comment on materialized view public.mv_daily_model_performance is
  'Resumo diário de performance por modelo/mercado (contagem de previsões, probabilidade média, edge/EV médios, Brier score e hit rate), derivado via fn_grade_prediction. Alimenta dashboards de monitoramento de modelo sem tocar em model_predictions (append-only).';

create unique index if not exists mv_daily_model_performance_pk
  on public.mv_daily_model_performance (model_version_id, day, market_id);

-- -----------------------------------------------------------------------------
-- mv_league_standings — classificação calculada a partir de events finalizados
-- (extra: usada pela view "próximos jogos" e por telas de classificação sem
-- depender do agregado mutável de team_stats).
-- -----------------------------------------------------------------------------
create materialized view if not exists public.mv_league_standings as
with results as (
  select
    league_id, season_id, home_team_id as team_id,
    case when home_score > away_score then 3 when home_score = away_score then 1 else 0 end as pts,
    home_score as gf, away_score as ga,
    case when home_score > away_score then 1 else 0 end as w,
    case when home_score = away_score then 1 else 0 end as d,
    case when home_score < away_score then 1 else 0 end as l
  from public.events where status = 'finished'
  union all
  select
    league_id, season_id, away_team_id as team_id,
    case when away_score > home_score then 3 when away_score = home_score then 1 else 0 end as pts,
    away_score as gf, home_score as ga,
    case when away_score > home_score then 1 else 0 end as w,
    case when away_score = home_score then 1 else 0 end as d,
    case when away_score < home_score then 1 else 0 end as l
  from public.events where status = 'finished'
)
select
  league_id, season_id, team_id,
  count(*)          as played,
  sum(w)            as wins,
  sum(d)            as draws,
  sum(l)            as losses,
  sum(gf)           as goals_for,
  sum(ga)           as goals_against,
  sum(gf) - sum(ga) as goal_difference,
  sum(pts)          as points,
  rank() over (partition by league_id, season_id order by sum(pts) desc, sum(gf) - sum(ga) desc, sum(gf) desc) as position
from results
group by league_id, season_id, team_id;

comment on materialized view public.mv_league_standings is
  'Classificação (tabela de pontos corridos) calculada a partir de events com status=finished. Complementa team_stats para exibição rápida de classificação sem recomputar agregados completos.';

create unique index if not exists mv_league_standings_pk
  on public.mv_league_standings (league_id, season_id, team_id);

-- -----------------------------------------------------------------------------
-- v_upcoming_events — próximos jogos agendados, já com nomes de time e liga
-- resolvidos (evita repetir os mesmos JOINs em toda tela de "próximos jogos").
-- -----------------------------------------------------------------------------
create or replace view public.v_upcoming_events as
select
  e.id,
  e.sport_id,
  e.league_id,
  l.name        as league_name,
  l.country_name as league_country_name,
  e.season_id,
  e.home_team_id,
  ht.name       as home_team_name,
  ht.logo_url   as home_team_logo_url,
  e.away_team_id,
  at.name       as away_team_name,
  at.logo_url   as away_team_logo_url,
  e.round,
  e.kickoff_at,
  e.venue_name,
  e.venue_city,
  e.status
from public.events e
join public.leagues l  on l.id = e.league_id
join public.teams   ht on ht.id = e.home_team_id
join public.teams   at on at.id = e.away_team_id
where e.status = 'scheduled'
  and e.kickoff_at > now();

comment on view public.v_upcoming_events is
  'Próximos jogos (status=scheduled, kickoff_at futuro), já com liga e times resolvidos. Fonte da tela inicial "próximos jogos" e de páginas públicas de SEO/marketing.';

-- -----------------------------------------------------------------------------
-- v_prediction_results — junta model_predictions ao placar final de events em
-- tempo de consulta, derivando was_correct (won) via fn_grade_prediction. O
-- resultado NUNCA é gravado de volta na tabela append-only model_predictions.
-- -----------------------------------------------------------------------------
create or replace view public.v_prediction_results as
select
  mp.id,
  mp.generated_at,
  mp.model_version_id,
  mp.event_id,
  mp.market_id,
  mp.outcome_id,
  mp.probability,
  mp.edge,
  mp.ev,
  mp.confidence,
  g.won             as was_correct,
  g.brier_component
from public.model_predictions mp
cross join lateral public.fn_grade_prediction(mp.id, mp.generated_at) as g(won, brier_component);

comment on view public.v_prediction_results is
  'Junta model_predictions ao placar final de events em tempo de consulta (was_correct nunca é armazenado), sem jamais gravar o resultado de volta na tabela append-only. was_correct/brier_component vêm null enquanto o evento não é finalizado, e null também em outcomes anulados (push, ex.: empate em DNB ou linha exata em O/U).';

-- -----------------------------------------------------------------------------
-- Atualização (refresh) das views materializadas.
--
-- REFRESH ... CONCURRENTLY exige que cada view tenha um índice UNIQUE (já
-- criado em cada uma acima) e evita bloquear leituras durante o refresh.
--
-- Em Supabase gerenciado (pg_cron habilitado), os jobs abaixo mantêm as views
-- atualizadas automaticamente. Fora do Supabase (ex.: Postgres puro do Docker
-- Compose local, sem pg_cron pré-carregado via shared_preload_libraries), este
-- bloco falha silenciosamente sem interromper a migration — nesse caso, chame
-- REFRESH MATERIALIZED VIEW CONCURRENTLY manualmente ou via job externo
-- (worker/cron da aplicação).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('refresh-best-odds',               '*/2 * * * *',
      $sql$ refresh materialized view concurrently public.mv_best_odds; $sql$);
    perform cron.schedule('refresh-fair-probabilities',       '*/2 * * * *',
      $sql$ refresh materialized view concurrently public.mv_fair_probabilities; $sql$);
    perform cron.schedule('refresh-daily-model-performance',  '0 * * * *',
      $sql$ refresh materialized view concurrently public.mv_daily_model_performance; $sql$);
    perform cron.schedule('refresh-league-standings',         '*/15 * * * *',
      $sql$ refresh materialized view concurrently public.mv_league_standings; $sql$);
  end if;
end;
$$;
