-- =============================================================================
-- 007_models_predictions.sql
-- Modelos estatísticos/ML e previsões: model_versions, model_predictions
-- (append-only, particionada), consensus_predictions e model_performance.
--
-- Decisão central de design: o resultado de uma previsão NUNCA é escrito de
-- volta na linha de model_predictions. Não existem colunas
-- outcome_result/settled_at aqui — o acerto/erro é sempre DERIVADO cruzando
-- event_id com o placar final de events, através de fn_grade_prediction e da
-- view v_prediction_results (ver 010_views.sql). Isso torna fisicamente
-- impossível "consertar" uma previsão depois do resultado ser conhecido
-- (vazamento de dados / data leakage).
--
-- market_id/outcome_id referenciam o catálogo normalizado (markets/outcomes)
-- em vez de texto livre, mantendo consistência referencial com odds/odds_history
-- e permitindo liquidar (grade) qualquer previsão sem ambiguidade de nomes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- model_versions — registro de versões de modelo.
-- -----------------------------------------------------------------------------
create table if not exists public.model_versions (
  id                     uuid primary key default gen_random_uuid(),
  model_name             text not null,       -- 'xg-poisson', 'gbm-1x2', 'ensemble-v3'
  version                text not null,       -- semver ou hash de commit: 'v1.4.2'
  sport_id               uuid not null references public.sports (id) on delete restrict,
  market_id              uuid references public.markets (id) on delete set null,  -- null = modelo multi-mercado
  description            text,
  algorithm              text,                -- 'xgboost','poisson','elo','neural-net','ensemble'
  trained_at             timestamptz,
  training_data_cutoff   timestamptz not null,  -- garante ausência de vazamento: nenhum dado após este instante entrou no treino
  training_data_start    timestamptz,
  feature_set_version    text,
  features_version       text,                -- alias de compatibilidade com model_predictions.features_version
  hyperparameters        jsonb not null default '{}'::jsonb,
  metrics                jsonb not null default '{}'::jsonb,        -- alias de training_metrics: métricas de validação em holdout no momento do treino
  training_metrics       jsonb not null default '{}'::jsonb,
  artifact_uri           text,                -- localização do binário do modelo (Supabase Storage / S3)
  status                 text not null default 'training'
                           check (status in ('training','staging','shadow','production','active','deprecated','archived','failed')),
  promoted_at            timestamptz,
  deprecated_at          timestamptz,
  created_by             uuid references public.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (model_name, version)
);

comment on table public.model_versions is
  'Registro de versões de modelo. training_data_cutoff é o campo mais crítico para auditoria de walk-forward: nenhuma model_predictions deste model_version_id deve ter event.kickoff_at anterior a este cutoff sem ser explicitamente marcada como backtest.';
comment on column public.model_versions.status is
  'training = em treinamento; staging/shadow = validação paralela sem impacto no produto; production/active = servindo previsões reais; deprecated/archived/failed = fora de operação.';

create index if not exists model_versions_status_idx on public.model_versions (status) where status in ('production','active','shadow');
create index if not exists model_versions_hyperparams_gin on public.model_versions using gin (hyperparameters);
create index if not exists model_versions_metrics_gin on public.model_versions using gin (metrics);

-- -----------------------------------------------------------------------------
-- model_predictions — append-only, particionada por mês em generated_at.
-- -----------------------------------------------------------------------------
create table if not exists public.model_predictions (
  id                        uuid not null default gen_random_uuid(),
  model_version_id          uuid not null references public.model_versions (id) on delete restrict,
  event_id                  uuid not null references public.events (id) on delete restrict,
  market_id                 uuid not null references public.markets (id) on delete restrict,
  outcome_id                uuid not null references public.outcomes (id) on delete restrict,
  probability               numeric(8,6) not null check (probability > 0 and probability <= 1),
  fair_odds                 numeric(10,4)
                               generated always as (round(1 / nullif(probability, 0), 4)) stored,
  best_market_odds          numeric(10,4),     -- melhor odd disponível no instante da geração (fotografia, não referência viva)
  best_bookmaker_id         uuid references public.bookmakers (id) on delete set null,
  edge                      numeric(8,6),      -- probability - implied_probability do mercado no instante
  ev                        numeric(8,6),      -- valor esperado = probability * best_market_odds - 1
  edge_score                numeric(5,2) check (edge_score is null or (edge_score >= 0 and edge_score <= 100)),  -- score composto (edge ponderado por confiança/liquidez), 0–100
  confidence                numeric(5,4),
  features_version          text not null,     -- versão do pipeline de features usado — reprodutibilidade
  features_snapshot         jsonb,              -- valores das features de entrada, para auditoria total
  is_pre_match              boolean not null default true,
  minute_generated          smallint,           -- minuto do jogo, quando is_pre_match = false
  generated_at              timestamptz not null default now(),
  primary key (id, generated_at)
) partition by range (generated_at);

comment on table public.model_predictions is
  'Log IMUTÁVEL de previsões de modelo. Nunca sofre UPDATE/DELETE (bloqueado por trg_protect_append_only). O acerto/erro é sempre calculado por JOIN com events no momento da consulta (fn_grade_prediction/v_prediction_results), nunca armazenado nesta tabela.';
comment on column public.model_predictions.features_snapshot is
  'Cópia dos valores de entrada do modelo no instante da geração — permite reproduzir exatamente a previsão e auditar se o modelo usou apenas dados anteriores ao kickoff (checagem anti-vazamento).';

create index if not exists model_predictions_event_idx
  on public.model_predictions (event_id, market_id, generated_at desc);
create index if not exists model_predictions_model_time_idx
  on public.model_predictions (model_version_id, generated_at desc);
create index if not exists model_predictions_features_gin
  on public.model_predictions using gin (features_snapshot);

-- Partições: default + mês corrente + 2 meses seguintes (mesma estratégia de odds_history).
create table if not exists public.model_predictions_default
  partition of public.model_predictions default;

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
    partition_name := 'model_predictions_' || to_char(target_month, 'YYYY_MM');

    if not exists (select 1 from pg_class where relname = partition_name) then
      execute format(
        'create table public.%I partition of public.model_predictions for values from (%L) to (%L)',
        partition_name, partition_start, partition_end
      );
    end if;
  end loop;
end;
$$;

-- Proteção append-only (reutiliza fn_protect_append_only, definida em 005_odds.sql).
drop trigger if exists trg_model_predictions_append_only on public.model_predictions;
create trigger trg_model_predictions_append_only
  before update or delete on public.model_predictions
  for each row execute function public.fn_protect_append_only();

-- -----------------------------------------------------------------------------
-- consensus_predictions — previsão de ensemble combinando N model_versions.
-- Tratada como append-only por convenção de aplicação (mesma lógica de
-- model_predictions): recalcular gera uma nova linha com generated_at mais
-- recente, nunca sobrescrevendo a antiga.
-- -----------------------------------------------------------------------------
create table if not exists public.consensus_predictions (
  id                              uuid primary key default gen_random_uuid(),
  event_id                        uuid not null references public.events (id) on delete cascade,
  market_id                       uuid not null references public.markets (id) on delete cascade,
  outcome_id                      uuid not null references public.outcomes (id) on delete cascade,
  method                          text not null default 'weighted_average'
                                    check (method in ('simple_average','weighted_average','median','stacking','bayesian')),
  probability                     numeric(8,6) not null check (probability > 0 and probability <= 1),
  weighted_probability             numeric(8,6),   -- probabilidade combinada explicitamente pelo método weighted_average, quando distinto de probability
  fair_odds                       numeric(10,4)
                                     generated always as (round(1 / nullif(probability, 0), 4)) stored,
  model_count                     smallint not null check (model_count >= 1),
  contributing_model_version_ids  uuid[] not null,
  weights                         jsonb,       -- {"<model_version_id>": peso}
  model_agreement                 numeric(5,4),  -- 1 - dispersão normalizada entre modelos (concordância)
  edge                            numeric(8,6),      -- calculado contra a melhor odd de mercado no instante (mv_fair_probabilities/mv_current_best_odds)
  ev                              numeric(8,6),
  edge_score                      numeric(5,2) check (edge_score is null or (edge_score >= 0 and edge_score <= 100)),
  is_pre_match                    boolean not null default true,
  generated_at                    timestamptz not null default now(),
  created_at                      timestamptz not null default now(),
  unique (event_id, market_id, outcome_id, method, generated_at)
);

comment on table public.consensus_predictions is
  'Previsão de ensemble combinando N model_versions. Tratada como append-only por convenção de aplicação, embora sem trigger de bloqueio dedicado — pode ser recalculada gerando uma nova linha com generated_at mais recente, nunca sobrescrevendo a antiga.';

create index if not exists consensus_event_market_idx on public.consensus_predictions (event_id, market_id, generated_at desc);
create index if not exists consensus_model_ids_gin on public.consensus_predictions using gin (contributing_model_version_ids);

-- -----------------------------------------------------------------------------
-- model_performance — métricas de performance agregadas por janela temporal.
-- -----------------------------------------------------------------------------
create table if not exists public.model_performance (
  id                    uuid primary key default gen_random_uuid(),
  model_version_id      uuid not null references public.model_versions (id) on delete cascade,
  market_id             uuid references public.markets (id) on delete set null,
  period_start          timestamptz not null,
  period_end            timestamptz not null,
  sample_size           integer not null check (sample_size >= 0),
  brier_score           numeric(8,6),
  log_loss              numeric(8,6),
  calibration_error     numeric(8,6),   -- ECE (Expected Calibration Error)
  clv                   numeric(8,6),   -- Closing Line Value médio
  clv_positive_pct      numeric(5,4),
  roi                   numeric(8,6),
  roi_method            text not null default 'flat_stake'
                           check (roi_method in ('flat_stake','kelly','fractional_kelly')),
  hit_rate              numeric(5,4),
  avg_odds              numeric(10,4),
  avg_edge              numeric(8,6),
  sharpe_ratio          numeric(8,4),
  max_drawdown          numeric(8,6),
  is_walk_forward        boolean not null default true,  -- true = janela respeitou estritamente treino→teste, sem sobreposição
  computed_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  unique (model_version_id, market_id, period_start, period_end, roi_method)
);

comment on table public.model_performance is
  'Métricas de performance agregadas por janela temporal. Recalculada periodicamente (job noturno) — cada recálculo INSERE uma nova linha com computed_at atualizado em vez de sobrescrever (append-preferred), preservando o histórico de como a avaliação evoluiu.';
comment on column public.model_performance.is_walk_forward is
  'false apenas para análises exploratórias in-sample explicitamente marcadas como tal; toda métrica usada para decisão de produção deve ter is_walk_forward = true.';

create index if not exists model_performance_model_idx on public.model_performance (model_version_id, period_end desc);
create index if not exists model_performance_walk_forward_idx on public.model_performance (model_version_id) where is_walk_forward;

-- -----------------------------------------------------------------------------
-- Liquidação de previsões (grading), derivada — NUNCA persistida em
-- model_predictions. Usada por v_prediction_results e pelas views
-- materializadas de performance (ver 010_views.sql).
-- -----------------------------------------------------------------------------

-- Determina se um outcome específico "ganhou" dado o placar final, cobrindo os
-- mercados do catálogo inicial (1X2, chance dupla, DNB, handicap asiático,
-- over/under, ambas marcam, total de gols por equipe).
create or replace function public.fn_outcome_won(
  p_market_code  text,
  p_outcome_code text,
  p_line         numeric,
  p_home_score   int,
  p_away_score   int
) returns boolean
language plpgsql immutable as $$
declare
  diff  int := p_home_score - p_away_score;
  total int := p_home_score + p_away_score;
begin
  if p_home_score is null or p_away_score is null then
    return null;
  end if;

  return case p_market_code
    when '1x2' then
      (p_outcome_code = 'home' and diff > 0) or
      (p_outcome_code = 'draw' and diff = 0) or
      (p_outcome_code = 'away' and diff < 0)
    when 'double_chance' then
      (p_outcome_code = 'home_or_draw' and diff >= 0) or
      (p_outcome_code = 'away_or_draw' and diff <= 0) or
      (p_outcome_code = 'home_or_away' and diff <> 0)
    when 'dnb' then  -- draw no bet: empate é anulado (push) — tratado como null (nem ganhou, nem perdeu)
      case when diff = 0 then null
        else (p_outcome_code = 'home' and diff > 0) or (p_outcome_code = 'away' and diff < 0)
      end
    when 'ah' then    -- asian handicap: a linha já embute o sinal do lado
      (p_outcome_code = 'home' and (diff + p_line) > 0) or
      (p_outcome_code = 'away' and (diff * -1 + p_line) > 0)
    when 'ou' then
      case when total = p_line then null  -- push exato na linha
        when p_outcome_code = 'over'  then total > p_line
        when p_outcome_code = 'under' then total < p_line
        else null
      end
    when 'btts' then
      (p_outcome_code = 'yes' and p_home_score > 0 and p_away_score > 0) or
      (p_outcome_code = 'no'  and (p_home_score = 0 or p_away_score = 0))
    when 'team_totals' then
      (p_outcome_code = 'home_over'  and p_home_score > p_line) or
      (p_outcome_code = 'home_under' and p_home_score < p_line) or
      (p_outcome_code = 'away_over'  and p_away_score > p_line) or
      (p_outcome_code = 'away_under' and p_away_score < p_line)
    else null
  end;
end;
$$;

comment on function public.fn_outcome_won is
  'Lógica de liquidação por mercado. Casos de "push"/void (linha exata em AH/OU, empate em DNB) retornam null propositalmente — não contam como acerto nem erro.';

-- Função "de alto nível" usada pelas views: recebe o id composto de uma
-- previsão (id, generated_at) e devolve (won, brier_component). Só retorna
-- linha quando o evento já está finalizado — caso contrário o resultado ainda
-- não é conhecido.
create or replace function public.fn_grade_prediction(
  p_prediction_id uuid,
  p_generated_at  timestamptz
) returns table (won boolean, brier_component numeric)
language sql stable as $$
  select
    public.fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) as won,
    case
      when e.status = 'finished' then
        power(
          mp.probability - (case when public.fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) then 1 else 0 end),
          2
        )
      else null
    end as brier_component
  from public.model_predictions mp
  join public.events   e on e.id = mp.event_id
  join public.markets  m on m.id = mp.market_id
  join public.outcomes o on o.id = mp.outcome_id
  where mp.id = p_prediction_id and mp.generated_at = p_generated_at
    and e.status = 'finished';
$$;

comment on function public.fn_grade_prediction is
  'Deriva o resultado (acerto/erro) de uma previsão cruzando com o placar final de events, SEM jamais gravar esse resultado de volta em model_predictions. Base de v_prediction_results e das views materializadas de performance diária.';
