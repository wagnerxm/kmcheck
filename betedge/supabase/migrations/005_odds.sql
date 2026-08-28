-- =============================================================================
-- 005_odds.sql
-- Odds: tabela "atual" (odds, mutável, 1 linha viva por combinação) e
-- odds_history (série temporal IMUTÁVEL, append-only, particionada por mês).
--
-- odds_history é a fonte única de verdade para reconstrução de mercado em
-- qualquer instante do passado e para o cálculo de Closing Line Value (CLV).
-- odds é apenas uma materialização do último estado, mantida por trigger a
-- partir dos INSERTs em odds_history — nunca escrita diretamente pela
-- aplicação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- odds — fotografia atual (mutável) de cada combinação
-- evento × casa de apostas × mercado × resultado.
-- -----------------------------------------------------------------------------
create table if not exists public.odds (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.events (id) on delete cascade,
  bookmaker_id           uuid not null references public.bookmakers (id) on delete cascade,
  market_id              uuid not null references public.markets (id) on delete cascade,
  outcome_id             uuid not null references public.outcomes (id) on delete cascade,
  decimal_odds           numeric(10,4) not null check (decimal_odds >= 1.0000),
  implied_probability    numeric(8,6) not null check (implied_probability > 0 and implied_probability <= 1),
  line                   numeric(6,2),        -- redundante com outcomes.line; útil quando a linha muda ao vivo
  is_live                boolean not null default false,
  is_suspended           boolean not null default false,
  previous_odds          numeric(10,4),       -- valor anterior, para seta de subida/descida na UI sem query extra
  change_count           integer not null default 0,
  first_seen_at          timestamptz not null default now(),
  last_updated_at        timestamptz not null default now(),  -- timestamp da última mudança
  source                 text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (event_id, bookmaker_id, market_id, outcome_id)
);

comment on table public.odds is
  'Fotografia "atual" de cada combinação evento×casa×mercado×resultado — 1 linha viva, mantida por trigger a partir de INSERTs em odds_history. Nunca escrita diretamente pela aplicação.';

create index if not exists odds_event_market_idx on public.odds (event_id, market_id);
create index if not exists odds_bookmaker_idx on public.odds (bookmaker_id);
create index if not exists odds_live_idx on public.odds (event_id) where is_live and not is_suspended;

-- -----------------------------------------------------------------------------
-- odds_history — log histórico IMUTÁVEL de todas as odds já vistas.
-- Particionada por RANGE mensal sobre recorded_at. PK composta (id,
-- recorded_at) — exigência do Postgres para tabelas particionadas por RANGE.
-- -----------------------------------------------------------------------------
create table if not exists public.odds_history (
  id                     uuid not null default gen_random_uuid(),
  event_id               uuid not null references public.events (id) on delete cascade,
  bookmaker_id           uuid not null references public.bookmakers (id) on delete cascade,
  market_id              uuid not null references public.markets (id) on delete cascade,
  outcome_id             uuid not null references public.outcomes (id) on delete cascade,
  decimal_odds           numeric(10,4) not null check (decimal_odds >= 1.0000),
  implied_probability    numeric(8,6) not null check (implied_probability > 0 and implied_probability <= 1),
  line                   numeric(6,2),
  is_live                boolean not null default false,
  is_suspended           boolean not null default false,
  recorded_at            timestamptz not null default now(),
  source                 text not null,       -- 'scraper-v3','odds-api-feed','manual','backfill'
  previous_odds          numeric(10,4),       -- valor da odd imediatamente anterior, se houver
  ingestion_batch_id     uuid,                -- id do job/lote de coleta — permite auditar/isolar uma coleta problemática
  raw_payload            jsonb,               -- payload cru opcional da fonte, para auditoria total
  primary key (id, recorded_at)
) partition by range (recorded_at);

comment on table public.odds_history is
  'Log histórico IMUTÁVEL de todas as odds já vistas. Nunca sofre UPDATE nem DELETE (ver trigger de bloqueio abaixo e REVOKE de privilégios em 009_rls_policies.sql). Fonte única de verdade para CLV e reconstrução de mercado em qualquer instante.';
comment on column public.odds_history.raw_payload is
  'Payload bruto (JSON) recebido do provedor no momento da coleta, preservado para auditoria/reprocessamento caso a lógica de parsing mude no futuro.';

-- Índices no pai propagam automaticamente para partições existentes E futuras
-- (Postgres 11+) — não é necessário recriá-los a cada nova partição mensal.
create index if not exists odds_history_event_market_time_idx
  on public.odds_history (event_id, market_id, outcome_id, recorded_at desc);
create index if not exists odds_history_bookmaker_time_idx
  on public.odds_history (bookmaker_id, recorded_at desc);
create index if not exists odds_history_batch_idx
  on public.odds_history (ingestion_batch_id) where ingestion_batch_id is not null;

-- -----------------------------------------------------------------------------
-- Partições de odds_history: uma partição "default" (rede de segurança para
-- qualquer INSERT com recorded_at fora do range coberto — nunca deveria
-- acontecer em operação normal, mas evita erro de "no partition found") mais
-- partições mensais cobrindo o mês corrente e os 2 meses seguintes. Meses
-- adicionais são criados em produção pelo job de manutenção
-- (fn_ensure_monthly_partition, ver 011_functions.sql).
-- -----------------------------------------------------------------------------
create table if not exists public.odds_history_default
  partition of public.odds_history default;

do $$
declare
  target_month date;
  partition_start date;
  partition_end date;
  partition_name text;
begin
  for i in 0..2 loop
    target_month := date_trunc('month', now() + (i || ' months')::interval)::date;
    partition_start := target_month;
    partition_end := (target_month + interval '1 month')::date;
    partition_name := 'odds_history_' || to_char(target_month, 'YYYY_MM');

    if not exists (select 1 from pg_class where relname = partition_name) then
      execute format(
        'create table public.%I partition of public.odds_history for values from (%L) to (%L)',
        partition_name, partition_start, partition_end
      );
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Proteção append-only: bloqueia qualquer UPDATE/DELETE em odds_history,
-- inclusive vindo de service_role/superusuário (segunda camada de defesa,
-- além do REVOKE aplicado em 009_rls_policies.sql).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_protect_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é append-only: operações UPDATE e DELETE não são permitidas.', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

comment on function public.fn_protect_append_only is
  'Função de trigger genérica: bloqueia UPDATE/DELETE em tabelas append-only (odds_history, model_predictions), forçando a aplicação a sempre inserir uma nova linha em vez de alterar/apagar a existente.';

DROP TRIGGER IF EXISTS trg_odds_history_append_only ON odds_history;
CREATE TRIGGER trg_odds_history_append_only
  BEFORE UPDATE OR DELETE ON odds_history
  FOR EACH ROW EXECUTE FUNCTION fn_protect_append_only();

-- -----------------------------------------------------------------------------
-- Sincronização: todo INSERT em odds_history propaga (via UPSERT) para a
-- fotografia mutável odds, atualizando o estado "atual" do mercado.
-- -----------------------------------------------------------------------------
-- Ao inserir em odds_history, atualiza a tabela odds (snapshot do estado atual)
CREATE OR REPLACE FUNCTION fn_sync_odds_from_history()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO odds (event_id, bookmaker_id, market_id, outcome_id, decimal_odds, implied_probability, last_updated_at, source, line, is_live, is_suspended, previous_odds, change_count, first_seen_at)
  VALUES (NEW.event_id, NEW.bookmaker_id, NEW.market_id, NEW.outcome_id, NEW.decimal_odds, NEW.implied_probability, NEW.recorded_at, NEW.source, NEW.line, NEW.is_live, NEW.is_suspended, NEW.previous_odds, 1, NEW.recorded_at)
  ON CONFLICT (event_id, bookmaker_id, market_id, outcome_id)
  DO UPDATE SET
    previous_odds = odds.decimal_odds,
    decimal_odds = EXCLUDED.decimal_odds,
    implied_probability = EXCLUDED.implied_probability,
    last_updated_at = EXCLUDED.last_updated_at,
    source = EXCLUDED.source,
    line = EXCLUDED.line,
    is_live = EXCLUDED.is_live,
    is_suspended = EXCLUDED.is_suspended,
    change_count = odds.change_count + 1,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

comment on function public.fn_sync_odds_from_history is
  'Mantém public.odds como uma materialização do último estado conhecido, a partir de cada linha inserida em odds_history (append-only).';

DROP TRIGGER IF EXISTS trg_sync_odds_from_history ON odds_history;
CREATE TRIGGER trg_sync_odds_from_history
  AFTER INSERT ON odds_history
  FOR EACH ROW EXECUTE FUNCTION fn_sync_odds_from_history();
