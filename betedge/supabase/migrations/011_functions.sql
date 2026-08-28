-- =============================================================================
-- 011_functions.sql
-- Funções utilitárias genéricas + aplicação do trigger de updated_at em toda
-- tabela mutável do schema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fn_updated_at() — trigger genérico que mantém updated_at sincronizado a
-- cada UPDATE. Aplicado em toda tabela mutável com coluna updated_at (as
-- tabelas append-only — odds_history, model_predictions — não têm updated_at
-- e não recebem este trigger).
-- -----------------------------------------------------------------------------
create or replace function public.fn_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.fn_updated_at is
  'Trigger genérico: define updated_at = now() a cada UPDATE. Aplicado via "create trigger set_updated_at before update ... execute function public.fn_updated_at()" em toda tabela mutável.';

drop trigger if exists set_updated_at on public.users;
create trigger set_updated_at before update on public.users
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.sports;
create trigger set_updated_at before update on public.sports
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.leagues;
create trigger set_updated_at before update on public.leagues
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.seasons;
create trigger set_updated_at before update on public.seasons
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.teams;
create trigger set_updated_at before update on public.teams
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.players;
create trigger set_updated_at before update on public.players
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.events;
create trigger set_updated_at before update on public.events
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.injuries;
create trigger set_updated_at before update on public.injuries
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.bookmakers;
create trigger set_updated_at before update on public.bookmakers
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.markets;
create trigger set_updated_at before update on public.markets
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.odds;
create trigger set_updated_at before update on public.odds
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.team_stats;
create trigger set_updated_at before update on public.team_stats
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.player_stats;
create trigger set_updated_at before update on public.player_stats
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.model_versions;
create trigger set_updated_at before update on public.model_versions
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.value_opportunities;
create trigger set_updated_at before update on public.value_opportunities
  for each row execute function public.fn_updated_at();

drop trigger if exists set_updated_at on public.alerts;
create trigger set_updated_at before update on public.alerts
  for each row execute function public.fn_updated_at();

-- -----------------------------------------------------------------------------
-- fn_calculate_implied_probability(decimal_odds) — probabilidade implícita de
-- uma odd decimal (1/odds), arredondada em 6 casas (mesma precisão de
-- *_probability em todo o schema).
-- -----------------------------------------------------------------------------
create or replace function public.fn_calculate_implied_probability(decimal_odds numeric)
returns numeric
language sql immutable as $$
  select round(1.0 / nullif(decimal_odds, 0), 6);
$$;

comment on function public.fn_calculate_implied_probability is
  'Probabilidade implícita de uma odd decimal: 1/decimal_odds, arredondada em 6 casas. Retorna null se decimal_odds for 0/null.';

-- -----------------------------------------------------------------------------
-- fn_ensure_monthly_partition(table_name, target_month) — cria (se ainda não
-- existir) a partição mensal de uma tabela particionada por RANGE(mês).
-- Idempotente. Usada por odds_history e model_predictions.
-- -----------------------------------------------------------------------------
create or replace function public.fn_ensure_monthly_partition(
  table_name   text,       -- nome da tabela-pai particionada, sem schema (ex.: 'odds_history')
  target_month date        -- qualquer dia dentro do mês desejado
) returns void
language plpgsql
as $$
declare
  partition_start date := date_trunc('month', target_month)::date;
  partition_end   date := (date_trunc('month', target_month) + interval '1 month')::date;
  partition_name  text := format('%s_%s', table_name, to_char(partition_start, 'YYYY_MM'));
begin
  if not exists (
    select 1 from pg_class where relname = partition_name
  ) then
    execute format(
      'create table public.%I partition of public.%I for values from (%L) to (%L)',
      partition_name, table_name, partition_start, partition_end
    );
    raise notice 'Partição criada: %', partition_name;
  end if;
end;
$$;

comment on function public.fn_ensure_monthly_partition is
  'Cria (se ainda não existir) a partição mensal de uma tabela particionada por RANGE(mês). Idempotente — chamar repetidamente para o mesmo mês é seguro (no-op na segunda chamada em diante).';

-- Job diário: garante que o mês corrente e os 2 próximos meses já tenham
-- partição pronta (evita corrida entre o INSERT de dados novos e a criação da
-- partição). Só é registrado quando pg_cron está disponível no ambiente —
-- ver nota equivalente em 010_views.sql.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'ensure-partitions',
      '0 3 * * *',   -- 03:00 UTC diariamente
      $sql$
        select public.fn_ensure_monthly_partition('odds_history', (now())::date);
        select public.fn_ensure_monthly_partition('odds_history', (now() + interval '1 month')::date);
        select public.fn_ensure_monthly_partition('odds_history', (now() + interval '2 months')::date);
        select public.fn_ensure_monthly_partition('model_predictions', (now())::date);
        select public.fn_ensure_monthly_partition('model_predictions', (now() + interval '1 month')::date);
        select public.fn_ensure_monthly_partition('model_predictions', (now() + interval '2 months')::date);
      $sql$
    );
  end if;
end;
$$;
