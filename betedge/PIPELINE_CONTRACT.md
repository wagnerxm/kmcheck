# PIPELINE_CONTRACT.md — Contrato End-to-End do Pipeline PREDIQ

> **Status:** CONGELADO — v1.0.0 — 2026-08-29
>
> Qualquer alteração neste documento exige bump de versão e revisão explícita.
> Toda implementação do pipeline DEVE respeitar este contrato à risca.

---

## Visão Geral

```
odds_history → feature_builder → modelos → ensemble → model_predictions
     → value_engine → value_opportunities → grading → model_performance
```

O pipeline recebe odds reais da API SportsGameOdds, gera previsões
estatísticas com modelos reproduzíveis, detecta oportunidades de valor
cruzando previsões com o mercado, e avalia a qualidade dos modelos após
o resultado ser conhecido.

### Princípios Invioláveis

1. **Append-only**: `odds_history` e `model_predictions` NUNCA sofrem
   UPDATE/DELETE (trigger `fn_protect_append_only` + REVOKE).
2. **Grading derivado**: O acerto/erro NUNCA é armazenado em
   `model_predictions`; é sempre calculado por JOIN com `events` via
   `fn_grade_prediction` / `fn_outcome_won`.
3. **Sem data leakage**: Todo modelo recebe `cutoff_date` no treino e
   `as_of` na predição. Nenhum dado posterior a essas datas é acessível.
4. **Reprodutibilidade**: `prediction = f(model_version, features_version,
   training_data_cutoff)` — as 3 coordenadas são persistidas.
5. **Sem números inventados**: Probabilidades vêm de dados estruturados e
   modelos estatísticos reproduzíveis, nunca de LLM.
6. **Imutabilidade analítica**: Em `value_opportunities`, os campos
   `edge`, `ev`, `fair_probability`, `decimal_odds`, `edge_score` são
   imutáveis após criação (trigger `trg_lock_value_opportunity_fields`).

---

## Etapa 1 — Ingestão de Odds (`odds_history`)

### Fluxo

```
SportsGameOdds API (v2)
  → BullMQ worker (collect-all, a cada 15 min)
  → EntityResolver (mapeia IDs externos → UUIDs internos)
  → INSERT INTO odds_history (append-only)
  → trigger fn_sync_odds_from_history → UPSERT em odds (snapshot)
```

### Input

| Campo | Tipo | Fonte |
|-------|------|-------|
| Odds brutas | JSON | `GET /events?sport=football&includeOdds=true` |
| API key | string | `SPORTSGAMEODDS_API_KEY` (env var) |

### Output — Tabela `odds_history`

| Coluna | Tipo | NOT NULL | Descrição |
|--------|------|----------|-----------|
| `id` | uuid | ✓ | PK (composta com recorded_at) |
| `event_id` | uuid FK→events | ✓ | Partida |
| `bookmaker_id` | uuid FK→bookmakers | ✓ | Casa de apostas |
| `market_id` | uuid FK→markets | ✓ | Mercado (1x2, ou, btts...) |
| `outcome_id` | uuid FK→outcomes | ✓ | Resultado específico |
| `decimal_odds` | numeric(10,4) | ✓ | ≥ 1.0000 |
| `implied_probability` | numeric(8,6) | ✓ | 1/decimal_odds |
| `line` | numeric(6,2) | | Linha (AH, O/U) |
| `is_live` | boolean | ✓ | false = pré-jogo |
| `is_suspended` | boolean | ✓ | Odd suspensa |
| `recorded_at` | timestamptz | ✓ | Timestamp da coleta |
| `source` | text | ✓ | 'sportsgameodds-v2' |
| `previous_odds` | numeric(10,4) | | Odd imediatamente anterior |
| `ingestion_batch_id` | uuid | | ID do lote de coleta |
| `raw_payload` | jsonb | | Payload bruto para auditoria |

### Particionamento

- `PARTITION BY RANGE (recorded_at)` — mensal.
- Partições criadas por `fn_ensure_monthly_partition` (job diário via pg_cron).
- Partição default `odds_history_default` como rede de segurança.

### Regras de Imutabilidade

- Trigger `trg_odds_history_append_only` → `fn_protect_append_only()`:
  bloqueia qualquer UPDATE/DELETE.
- REVOKE UPDATE, DELETE em 009_rls_policies.sql.

### Efeito Colateral — Tabela `odds` (snapshot)

Trigger `trg_sync_odds_from_history` → `fn_sync_odds_from_history()`:
cada INSERT em `odds_history` faz UPSERT em `odds`, atualizando
`previous_odds`, `change_count`, `last_updated_at`.

---

## Etapa 2 — Feature Builder

### Fluxo

```
events (finalizados, com placar)
  → FeatureRegistry (14 features registradas)
  → compute_batch_features() [treino] / compute_event_features() [predição]
  → DataFrame/dict com features + metadata
```

### Input

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `match_history` | list[dict] | Jogos ordenados por `kickoff_at` desc |
| `team_id` | uuid | Time sendo avaliado |
| `as_of` | datetime | Cutoff temporal |
| `elo_ratings` | dict | Ratings Elo (opcional) |
| `market_odds` | dict | Odds de mercado (opcional) |
| `opponent_id` | uuid | Adversário (opcional) |
| `is_home` | bool | Casa ou fora |

### Output — Features (14 registradas)

| Feature | Categoria | Lookback | Tipo |
|---------|-----------|----------|------|
| `elo_diff` | rating | 0 dias | float |
| `goals_scored_avg_last5` | form | 30 dias | float |
| `goals_conceded_avg_last5` | form | 30 dias | float |
| `rest_days` | context | 0 dias | int |
| `market_implied_prob` | market | 0 dias | float |
| `goals_scored_avg_last10` | form | 60 dias | float |
| `goals_conceded_avg_last10` | form | 60 dias | float |
| `points_per_game_last5` | form | 30 dias | float |
| `win_streak` | form | 0 dias | int |
| `unbeaten_streak` | form | 0 dias | int |
| `clean_sheet_streak` | form | 0 dias | int |
| `h2h_points_avg` | h2h | 0 dias | float |
| `games_last_14_days` | context | 0 dias | int |
| `is_home` | context | 0 dias | bool |

### Versionamento

- `features_version`: string semver persistida em `model_predictions`.
- `features_snapshot`: JSONB com valores exatos usados, para auditoria.

### Proteção Anti-Leakage

- `compute_batch_features()`: filtra `kickoff_at < before` (exclusivo).
- `validate_batch_no_leakage()`: verifica que nenhuma feature usa dados
  posteriores ao corte temporal.
- `compute_event_features()`: usa as mesmas `compute_fn` do registry
  (previne training-serving skew).

---

## Etapa 3 — Modelos Individuais

### 5 Modelos Base Implementados

| # | Classe | `name` | `version` | Algoritmo | Mercados Produzidos |
|---|--------|--------|-----------|-----------|---------------------|
| 1 | `PoissonModel` | `poisson` | `1.0.0` | MLE via L-BFGS-B, Poisson independente | 1x2, ou_2.5, btts, double_chance, correct_score |
| 2 | `DixonColesModel` | `dixon_coles` | `1.0.0` | MLE com correlação tau (ρ) para placares baixos | 1x2, ou_1.5/2.5/3.5, btts, double_chance, correct_score |
| 3 | `EloModel` | `elo` | `1.0.0` | Atualização sequencial com MoV, logístico ordenado 3-way | 1x2, double_chance |
| 4 | `MarketConsensusModel` | `market_consensus` | `1.0.0` | Remoção de vig (Shin/Power/Multiplicative) + consenso ponderado | Qualquer mercado com odds disponíveis |
| 5 | `GradientBoostModel` | `gradient_boost` | `1.0.0` | XGBoost/LightGBM com features do registry | 1x2, double_chance (+ mercados binários) |

### 2 Modelos NÃO Implementados (stubs)

| # | Classe | `name` | Status |
|---|--------|--------|--------|
| 6 | `LogisticModel` | `logistic` | `raise NotImplementedError` ("Fase 1") |
| 7 | `ExpectedGoalsModel` | `xg_model` | `raise NotImplementedError` ("Fase 1/2") |

### Interface Comum (`BaseModel`)

```python
class BaseModel(ABC):
    name: str
    version: str

    @abstractmethod
    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Treina com dados até cutoff_date (inclusive)."""

    @abstractmethod
    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Gera predições usando apenas dados disponíveis até as_of."""

    @abstractmethod
    def get_params(self) -> dict:
        """Retorna hiperparâmetros/parâmetros ajustados."""

    def validate_no_leakage(self, event_data: dict, as_of: datetime) -> bool:
        """Verifica ausência de leakage em event_data."""
```

### Output — `PredictionResult`

```python
@dataclass
class PredictionResult:
    market: str          # '1x2', 'ou', 'btts', etc.
    outcome: str         # 'home', 'draw', 'away', 'over', 'under', etc.
    probability: float   # 0 < p ≤ 1
    confidence: float | None = None
    features_used: dict | None = None
```

### Input para `train()`

| Modelo | Formato Esperado |
|--------|-----------------|
| Poisson, Dixon-Coles, Elo | `Iterable[dict]` com `kickoff_at`, `home_team_id`, `away_team_id`, `home_goals`, `away_goals` |
| MarketConsensus | `dict` com `method` (shin/power/multiplicative), `bookmaker_weights` |
| GradientBoost | `Iterable[dict]` de jogos (features computadas internamente via `compute_batch_features`) |

### Input para `predict()`

| Modelo | Campos de `event_data` |
|--------|----------------------|
| Poisson, Dixon-Coles | `home_team_id`, `away_team_id` |
| Elo | `home_team_id`, `away_team_id` |
| MarketConsensus | `market`, `bookmaker_odds` (dict bookmaker→dict outcome→decimal) |
| GradientBoost | Campos necessários para `compute_event_features()` |

---

## Etapa 4 — Ensemble

### Fluxo

```
PredictionResult[] de cada modelo base
  → EnsembleModel.predict()
  → PredictionResult[] combinados (weighted average ou stacking)
```

### Estratégias

| Estratégia | Descrição | Treino |
|------------|-----------|--------|
| `simple_average` | Média aritmética, pesos iguais | Nenhum dado necessário |
| `weighted_average` | Pesos otimizados via SLSQP (log-loss) ou inverse-Brier | Validation predictions ou Brier scores |
| `stacking` | `LogisticRegression` meta-modelo | Validation predictions |

### Output

Mesmo `PredictionResult` dos modelos base, com:
- `confidence` = razão de modelos contribuintes
- `features_used.ensemble_variance` = variância ponderada

### Persistência

A predição do ensemble é persistida em `consensus_predictions`:

| Coluna | Tipo | NOT NULL | Descrição |
|--------|------|----------|-----------|
| `id` | uuid | ✓ | PK |
| `event_id` | uuid FK→events | ✓ | |
| `market_id` | uuid FK→markets | ✓ | |
| `outcome_id` | uuid FK→outcomes | ✓ | |
| `method` | text | ✓ | 'simple_average' / 'weighted_average' / 'stacking' |
| `probability` | numeric(8,6) | ✓ | Probabilidade combinada |
| `fair_odds` | numeric(10,4) | ✓ | GENERATED: 1/probability |
| `model_count` | smallint | ✓ | ≥ 1 |
| `contributing_model_version_ids` | uuid[] | ✓ | IDs dos modelos que contribuíram |
| `weights` | jsonb | | Pesos por model_version_id |
| `model_agreement` | numeric(5,4) | | 1 − dispersão normalizada |
| `edge` | numeric(8,6) | | vs. melhor odd de mercado |
| `ev` | numeric(8,6) | | |
| `edge_score` | numeric(5,2) | | 0–100 |
| `is_pre_match` | boolean | ✓ | |
| `generated_at` | timestamptz | ✓ | |

---

## Etapa 5 — Persistência de Predições (`model_predictions`)

### Tabela `model_predictions` (append-only)

| Coluna | Tipo | NOT NULL | Descrição |
|--------|------|----------|-----------|
| `id` | uuid | ✓ | PK (composta com generated_at) |
| `model_version_id` | uuid FK→model_versions | ✓ | Coordenada de reprodutibilidade #1 |
| `event_id` | uuid FK→events | ✓ | Partida |
| `market_id` | uuid FK→markets | ✓ | Mercado |
| `outcome_id` | uuid FK→outcomes | ✓ | Resultado |
| `probability` | numeric(8,6) | ✓ | 0 < p ≤ 1 |
| `fair_odds` | numeric(10,4) | ✓ | GENERATED: 1/probability |
| `best_market_odds` | numeric(10,4) | | Melhor odd no instante |
| `best_bookmaker_id` | uuid FK→bookmakers | | Casa com melhor odd |
| `edge` | numeric(8,6) | | probability − implied_probability |
| `ev` | numeric(8,6) | | probability × best_odds − 1 |
| `edge_score` | numeric(5,2) | | Score composto 0–100 |
| `confidence` | numeric(5,4) | | |
| `features_version` | text | ✓ | Coordenada de reprodutibilidade #2 |
| `features_snapshot` | jsonb | | Valores das features para auditoria |
| `is_pre_match` | boolean | ✓ | default true |
| `minute_generated` | smallint | | Para predições in-play |
| `generated_at` | timestamptz | ✓ | Timestamp da geração |

### Coordenadas de Reprodutibilidade

```
prediction = f(model_version_id, features_version, training_data_cutoff)
```

Todas as 3 coordenadas são recuperáveis:
- `model_version_id` → `model_versions.training_data_cutoff`
- `features_version` → coluna direta
- `features_snapshot` → valores exatos de entrada

### Tabela `model_versions`

| Coluna | Tipo | NOT NULL | Descrição |
|--------|------|----------|-----------|
| `id` | uuid | ✓ | PK |
| `model_name` | text | ✓ | 'poisson', 'dixon_coles', etc. |
| `version` | text | ✓ | Semver |
| `sport_id` | uuid FK→sports | ✓ | |
| `market_id` | uuid FK→markets | | null = multi-mercado |
| `algorithm` | text | | 'poisson', 'elo', etc. |
| `trained_at` | timestamptz | | |
| `training_data_cutoff` | timestamptz | ✓ | Nenhum dado após esta data no treino |
| `training_data_start` | timestamptz | | |
| `features_version` | text | | |
| `hyperparameters` | jsonb | ✓ | |
| `metrics` | jsonb | ✓ | Métricas de validação no treino |
| `training_metrics` | jsonb | ✓ | |
| `artifact_uri` | text | | Localização do binário |
| `status` | text | ✓ | training/staging/shadow/production/active/deprecated/archived/failed |
| `promoted_at` | timestamptz | | |
| `deprecated_at` | timestamptz | | |

UNIQUE: `(model_name, version)`

### Regras de Imutabilidade

- Trigger `trg_model_predictions_append_only` → `fn_protect_append_only()`.
- REVOKE UPDATE, DELETE.
- NÃO existem colunas `outcome_result`, `settled_at`, `was_correct` —
  por design, o resultado é SEMPRE derivado.

---

## Etapa 6 — Value Engine (`value_opportunities`)

### Fluxo

```
model_predictions (ou consensus_predictions)
  + odds (snapshot atual) / mv_best_odds / mv_fair_probabilities
  → calculate_edge(), calculate_ev(), calculate_edge_score()
  → fractional_kelly()
  → INSERT INTO value_opportunities
  → trigger trg_evaluate_alerts_on_value_opportunity → pg_notify
```

### Cálculos

| Métrica | Fórmula |
|---------|---------|
| **Edge** | `model_prob − fair_market_prob` |
| **Relative Edge** | `(model_prob − fair_market_prob) / fair_market_prob` |
| **EV** | `model_prob × decimal_odds − 1` |
| **Edge Score** | `100 × Σ(wᵢ × componenteᵢ)` (score composto 0–100) |
| **Kelly** | `f* = (b·p − q) / b` onde `b = odds−1`, `q = 1−p` |
| **Fractional Kelly** | `κ × f*` com `κ = 0.25` (quarter-Kelly), capped |

### Pesos do Edge Score (`DEFAULT_WEIGHTS`)

| Componente | Peso | Descrição |
|------------|------|-----------|
| E (edge) | 0.30 | Magnitude do edge (compressão logística) |
| EV | 0.20 | Valor esperado normalizado |
| C (confidence) | 0.15 | Concordância do ensemble |
| M (market_efficiency) | 0.10 | Inverso da eficiência de mercado |
| N (sample_size) | 0.05 | Volume de dados históricos |
| K (calibration) | 0.10 | ECE recente |
| L (line_movement) | 0.05 | Movimento de linha confirma modelo |
| B (bookmaker_coverage) | 0.05 | Cobertura de casas |

### Output — Tabela `value_opportunities`

| Coluna | Tipo | NOT NULL | Descrição |
|--------|------|----------|-----------|
| `id` | uuid | ✓ | PK |
| `event_id` | uuid FK→events | ✓ | |
| `market_id` | uuid FK→markets | ✓ | |
| `outcome_id` | uuid FK→outcomes | ✓ | |
| `bookmaker_id` | uuid FK→bookmakers | ✓ | |
| `model_version_id` | uuid FK→model_versions | | |
| `consensus_prediction_id` | uuid FK→consensus_predictions | | |
| `model_prediction_id` | uuid | | FK composta |
| `model_prediction_generated_at` | timestamptz | | FK composta |
| `model_source` | text | | Nome/versão do modelo ou 'consensus' |
| `decimal_odds` | numeric(10,4) | ✓ | Odd oferecida ≥ 1.0000 |
| `implied_probability` | numeric(8,6) | ✓ | 1/decimal_odds |
| `fair_probability` | numeric(8,6) | ✓ | Probabilidade justa (vig-removed) |
| `model_probability` | numeric(8,6) | | Probabilidade do modelo |
| `fair_odds` | numeric(10,4) | ✓ | GENERATED: 1/fair_probability |
| `edge` | numeric(8,6) | ✓ | **IMUTÁVEL após criação** |
| `ev` | numeric(8,6) | ✓ | **IMUTÁVEL após criação** |
| `edge_score` | numeric(5,2) | ✓ | **IMUTÁVEL após criação** (0–100) |
| `confidence` | numeric(5,4) | | |
| `kelly_stake_pct` | numeric(6,4) | | Fração de Kelly recomendada |
| `bookmakers_analyzed` | integer | ✓ | ≥ 1 |
| `status` | text | ✓ | active/expired/odds_moved/result_won/result_lost/result_void/removed |
| `detected_at` | timestamptz | ✓ | |
| `expires_at` | timestamptz | | Tipicamente kickoff_at |
| `resolved_at` | timestamptz | | |

### Ciclo de Vida do Status

```
active → expired        (kickoff_at atingido sem resolução)
active → odds_moved      (odd mudou significativamente)
active → result_won      (evento finalizado, predição correta)
active → result_lost     (evento finalizado, predição incorreta)
active → result_void     (push/anulado)
active → removed         (remoção manual)
```

### Imutabilidade Parcial

Trigger `trg_lock_value_opportunity_fields`: bloqueia UPDATE de
`decimal_odds`, `fair_probability`, `edge`, `ev`, `edge_score`.
Apenas `status`, `resolved_at`, `expires_at`, `expired_at` podem mudar.

---

## Etapa 7 — Grading (Derivado)

### Mecanismo

O grading NUNCA persiste resultado em `model_predictions`. É SEMPRE
calculado em tempo de consulta via:

1. **`fn_outcome_won(market_code, outcome_code, line, home_score, away_score)`**
   — Retorna `boolean | null` (null = push/void).

2. **`fn_grade_prediction(prediction_id, generated_at)`**
   — Retorna `(won boolean, brier_component numeric)`.
   — Só retorna linha quando `events.status = 'finished'`.

3. **`v_prediction_results`** — View que junta `model_predictions` com
   grading derivado via `fn_grade_prediction`.

### Mercados Suportados por `fn_outcome_won`

| Mercado | Lógica |
|---------|--------|
| `1x2` | home: diff > 0, draw: diff = 0, away: diff < 0 |
| `double_chance` | home_or_draw: diff ≥ 0, etc. |
| `dnb` | Empate = null (push) |
| `ah` | Aplica linha: `diff + line > 0` |
| `ou` | Total > line (over), < line (under), = line → null (push) |
| `btts` | yes: ambos > 0, no: algum = 0 |
| `team_totals` | Gols do time vs. linha |

### Transição de `value_opportunities.status`

Após o resultado ser conhecido:
- `fn_outcome_won` retorna `true` → status = `result_won`
- `fn_outcome_won` retorna `false` → status = `result_lost`
- `fn_outcome_won` retorna `null` → status = `result_void`

---

## Etapa 8 — Model Performance (`model_performance`)

### Tabela `model_performance`

| Coluna | Tipo | NOT NULL | Descrição |
|--------|------|----------|-----------|
| `id` | uuid | ✓ | PK |
| `model_version_id` | uuid FK→model_versions | ✓ | |
| `market_id` | uuid FK→markets | | null = todos |
| `period_start` | timestamptz | ✓ | Início da janela |
| `period_end` | timestamptz | ✓ | Fim da janela |
| `sample_size` | integer | ✓ | ≥ 0 |
| `brier_score` | numeric(8,6) | | Requer ≥ 200 amostras |
| `log_loss` | numeric(8,6) | | Requer ≥ 200 amostras |
| `calibration_error` | numeric(8,6) | | ECE |
| `clv` | numeric(8,6) | | CLV médio (requer ≥ 100) |
| `clv_positive_pct` | numeric(5,4) | | % de CLV positivo |
| `roi` | numeric(8,6) | | Requer ≥ 500 amostras |
| `roi_method` | text | ✓ | flat_stake/kelly/fractional_kelly |
| `hit_rate` | numeric(5,4) | | ≥ 30 por bin |
| `avg_odds` | numeric(10,4) | | |
| `avg_edge` | numeric(8,6) | | |
| `sharpe_ratio` | numeric(8,4) | | |
| `max_drawdown` | numeric(8,6) | | |
| `is_walk_forward` | boolean | ✓ | true = treino→teste sem overlap |
| `computed_at` | timestamptz | ✓ | |

UNIQUE: `(model_version_id, market_id, period_start, period_end, roi_method)`

### Tamanhos Mínimos de Amostra

| Métrica | Mínimo |
|---------|--------|
| Brier Score | 200 |
| Log Loss | 200 |
| CLV | 100 |
| ROI | 500 |
| Hit Rate (por bin) | 30 |

### View Materializada `mv_daily_model_performance`

Resumo diário derivado via `fn_grade_prediction` — nunca toca em
`model_predictions`:

```sql
SELECT mv.model_name, mv.version,
       date_trunc('day', mp.generated_at) AS day,
       count(*) AS prediction_count,
       avg(mp.probability) AS avg_predicted_probability,
       avg(mp.edge) AS avg_edge,
       avg(g.brier_component) AS brier_score,
       avg((g.won)::int)::numeric(5,4) AS hit_rate
FROM model_predictions mp
JOIN model_versions mv ON mv.id = mp.model_version_id
CROSS JOIN LATERAL fn_grade_prediction(mp.id, mp.generated_at) AS g
WHERE g.won IS NOT NULL
GROUP BY ...
```

Refresh: a cada 1 hora via pg_cron.

---

## Orquestração do Pipeline Completo

### Sequência de Execução

```
1. INGESTÃO        odds_history ← SportsGameOdds (BullMQ, 15 min)
2. TREINO          Para cada modelo base:
                     a. Consultar events finalizados + placar
                     b. model.train(matches, cutoff_date)
                     c. INSERT model_versions (status='production')
3. PREDIÇÃO        Para cada evento futuro com odds:
                     a. Consultar odds atuais de todas as casas
                     b. Para cada modelo em status 'production':
                        i.  model.predict(event_data, as_of=now())
                        ii. Consultar best_market_odds de mv_best_odds
                        iii. Calcular edge, ev, edge_score
                        iv. INSERT model_predictions
4. ENSEMBLE        Para cada evento com predições de ≥2 modelos:
                     a. ensemble.predict(event_data, as_of)
                     b. INSERT consensus_predictions
5. VALUE ENGINE    Para cada predição com edge > threshold:
                     a. Calcular edge, ev, edge_score, kelly
                     b. INSERT value_opportunities (status='active')
                     c. Trigger pg_notify → alerts
6. GRADING         Quando events.status → 'finished':
                     a. fn_outcome_won() calcula won/brier_component
                     b. UPDATE value_opportunities.status
                     c. INSERT model_performance (agregações por janela)
7. PERFORMANCE     REFRESH mv_daily_model_performance (pg_cron, 1h)
```

### Fluxo de Dados Real (End-to-End)

```
SportsGameOdds API
    │
    ├─── odds_history (append-only)
    │        │
    │        └─── odds (snapshot via trigger)
    │                │
    │                └─── mv_best_odds (MV, refresh 2 min)
    │                        │
    │                        └─── mv_fair_probabilities (MV, refresh 2 min)
    │
events (finalizados com placar)
    │
    ├─── FeatureRegistry (14 features)
    │        │
    │        ├─── compute_batch_features() → treino
    │        │
    │        └─── compute_event_features() → predição
    │
    ├─── PoissonModel.train() / .predict()
    ├─── DixonColesModel.train() / .predict()
    ├─── EloModel.train() / .predict()
    ├─── MarketConsensusModel.train() / .predict()
    ├─── GradientBoostModel.train() / .predict()
    │        │
    │        └──── model_predictions (append-only)
    │                    │
    │                    ├─── EnsembleModel.predict()
    │                    │        │
    │                    │        └─── consensus_predictions
    │                    │
    │                    ├─── value_engine
    │                    │        │
    │                    │        └─── value_opportunities
    │                    │                │
    │                    │                └─── alerts (pg_notify)
    │                    │
    │                    └─── fn_grade_prediction() [derivado]
    │                             │
    │                             ├─── v_prediction_results (view)
    │                             ├─── mv_daily_model_performance (MV)
    │                             └─── model_performance (job noturno)
```

---

## Tabelas de Referência (Catálogo)

### `markets` (seeded)

| code | name | category |
|------|------|----------|
| `1x2` | Resultado Final (1X2) | match_result |
| `double_chance` | Chance Dupla | match_result |
| `dnb` | Empate Anula a Aposta | match_result |
| `ah` | Handicap Asiático | handicap |
| `ou` | Mais/Menos Gols | totals |
| `btts` | Ambas Marcam | both_teams_to_score |
| `team_totals` | Total de Gols por Equipe | team_totals |

### `outcomes` por mercado (seeded)

| Mercado | Outcomes |
|---------|----------|
| `1x2` | home, draw, away |
| `double_chance` | home_or_draw, home_or_away, away_or_draw |
| `dnb` | home, away |
| `ah` | home (-1.5), away (+1.5) |
| `ou` | over (2.5), under (2.5) |
| `btts` | yes, no |
| `team_totals` | home_over (1.5), home_under (1.5), away_over (1.5), away_under (1.5) |

### `bookmakers` (seeded — 12 casas)

Bet365, Betano, Sportingbet, KTO, Betfair, Superbet, Novibet,
Betnacional, EstrelaBet, Parimatch, F12.Bet, Pixbet.

---

## Versionamento deste Contrato

| Versão | Data | Mudança |
|--------|------|---------|
| 1.0.0 | 2026-08-29 | Versão inicial — contrato congelado |
