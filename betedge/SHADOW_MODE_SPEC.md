# SHADOW_MODE_SPEC.md — Arquitetura e Regras do Shadow Mode v1

> **Versão:** 1.0.0  
> **Data:** 2026-08-29  
> **Status:** Ativo — operação de validação prospectiva  
> **Pipeline:** PREDIQ v1.0.0 (conforme PIPELINE_CONTRACT.md)

---

## 1. Objetivo

O Shadow Mode v1 é uma operação automatizada de **validação prospectiva** do pipeline
PREDIQ. Executa o pipeline diariamente contra dados reais de mercado, gera previsões,
calcula métricas e avalia a qualidade do sistema — **sem utilizar dinheiro real**.

O objetivo é medir, com dados prospectivos (nunca retrospectivos), se:

1. O Índice PREDIQ realmente ordena oportunidades por qualidade.
2. Os modelos estão calibrados (ECE < 0.05).
3. O CLV médio é positivo (edge real confirmado pelo mercado).
4. O ROI teórico sustenta-se ao longo do tempo.
5. Não há data leakage ou inconsistência nos cálculos.

---

## 2. Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SHADOW MODE v1                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐               │
│  │ Ingestão │──▶│  Pipeline    │──▶│ Persistência │               │
│  │ de Odds  │   │  PREDIQ      │   │ shadow_pred  │               │
│  └──────────┘   └──────────────┘   └──────┬───────┘               │
│                                           │                        │
│  ┌──────────────┐   ┌─────────────┐       │                        │
│  │ Closing Odds │◀──│ Pre-Kickoff │◀──────┘                        │
│  │ Capture      │   │ Snapshot    │                                │
│  └──────┬───────┘   └─────────────┘                                │
│         │                                                           │
│  ┌──────▼───────┐   ┌─────────────┐   ┌──────────────┐            │
│  │   Grading    │──▶│ Métricas &  │──▶│  SHADOW LAB  │            │
│  │ Automático   │   │ Agregações  │   │  Dashboard   │            │
│  └──────────────┘   └──────┬──────┘   └──────────────┘            │
│                            │                                       │
│                     ┌──────▼──────┐                                │
│                     │ Relatório   │                                │
│                     │ Diário      │                                │
│                     └─────────────┘                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1. Componentes

| Componente | Localização | Responsabilidade |
|------------|------------|------------------|
| Shadow Engine | `services/engine/app/shadow/engine.py` | Ciclo diário: ingestão → pipeline → persistência |
| Schema | `services/engine/app/shadow/schema.py` | DDL da tabela `shadow_predictions` |
| Aggregations | `services/engine/app/shadow/aggregations.py` | Métricas agregadas por dimensão |
| Report | `services/engine/app/shadow/report.py` | Relatório diário em Markdown |
| API Shadow | `services/engine/app/api/shadow.py` | Endpoints REST do shadow mode |
| SHADOW LAB | `apps/web/src/app/(app)/shadow-lab/` | Dashboard administrativo |
| API Route | `apps/web/src/app/api/shadow-lab/route.ts` | BFF proxy para o engine |

### 2.2. Tabela `shadow_predictions`

Tabela append-only dedicada ao shadow mode. Cada registro contém todos os dados
necessários para análise, sem necessidade de JOINs complexos.

```sql
CREATE TABLE IF NOT EXISTS shadow_predictions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id                UUID NOT NULL,
    league                  TEXT NOT NULL,
    sport                   TEXT NOT NULL DEFAULT 'football',
    market                  TEXT NOT NULL,
    outcome                 TEXT NOT NULL,
    generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kickoff_at              TIMESTAMPTZ NOT NULL,
    bookmaker               TEXT NOT NULL,
    best_odds               NUMERIC(8,4) NOT NULL,
    closing_odds            NUMERIC(8,4),
    fair_market_probability NUMERIC(8,6) NOT NULL,
    model_probability       NUMERIC(8,6) NOT NULL,
    edge                    NUMERIC(8,6) NOT NULL,
    ev                      NUMERIC(8,6) NOT NULL,
    prediq_score            NUMERIC(6,2) NOT NULL,
    kelly_fraction          NUMERIC(8,6) NOT NULL,
    model_version           TEXT NOT NULL,
    features_version        TEXT NOT NULL,
    result                  TEXT CHECK (result IN ('won', 'lost', 'void')),
    theoretical_return      NUMERIC(10,4),
    clv                     NUMERIC(8,6),
    graded_at               TIMESTAMPTZ,
    status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'graded', 'void')),
    individual_model_probs  JSONB,
    snapshot_odds           JSONB,
    ensemble_variance       NUMERIC(8,6),
    market_overround        NUMERIC(8,6),
    home_team               TEXT,
    away_team               TEXT,

    CONSTRAINT uq_shadow_pred
        UNIQUE (event_id, market, outcome, model_version)
);
```

---

## 3. Ciclo Diário

### 3.1. Execução (`run_shadow_cycle`)

Disparado diariamente (ou sob demanda via `POST /api/shadow/run`).

1. **Ingestão de odds**: Consulta eventos `scheduled` com odds na tabela `odds`.
2. **Fair probability**: Calcula via `compute_fair_probs_for_event()` — Shin para ≥3
   outcomes, multiplicative como fallback.
3. **Modelo de ensemble**: Busca `model_predictions` existentes ou gera via pipeline
   completo (treino + predição).
4. **Cálculos de valor**:
   - `edge = model_probability - fair_market_probability`
   - `ev = model_probability × best_decimal_odds - 1`
   - `prediq_score` = Edge Score com 7 componentes
   - `kelly_fraction` = quarter-Kelly (κ = 0.25)
5. **Persistência**: INSERT em `shadow_predictions` com `ON CONFLICT DO NOTHING`.
6. **Idempotência**: A constraint UNIQUE garante que o mesmo evento/mercado/outcome/modelo
   não gera duplicatas.

### 3.2. Captura de Closing Odds (`capture_closing_odds`)

Disparado periodicamente (a cada hora) ou antes dos kickoffs.

- Para previsões com `status = 'open'` cujo `kickoff_at` está dentro das próximas 2 horas:
  - Busca a última odd disponível por bookmaker
  - Atualiza `closing_odds` com a melhor odd atual
  - Persiste `snapshot_odds` (JSONB com todas as odds de todas as casas)
- **Imutabilidade**: Só atualiza se `closing_odds IS NULL`.

### 3.3. Snapshot Pré-Jogo

O campo `snapshot_odds` (JSONB) captura o estado completo do mercado no momento da
closing odds. Formato:

```json
{
  "bet365": {"home": 2.10, "draw": 3.40, "away": 3.20},
  "pinnacle": {"home": 2.15, "draw": 3.45, "away": 3.25}
}
```

### 3.4. Grading Automático (`grade_shadow_predictions`)

Disparado após os eventos finalizarem.

1. Consulta `events` WHERE `status = 'finished'` com placar disponível.
2. Para cada `shadow_predictions` com `status = 'open'` e `kickoff_at < NOW()`:
   - Determina `result` baseado no mercado:
     - **1x2**: `home` ganha se home_score > away_score, `draw` se empate, `away` caso contrário
     - **Outros mercados**: lógica específica por tipo
   - Calcula `theoretical_return`:
     - `won` → `best_odds - 1` (lucro)
     - `lost` → `-1` (perda do stake)
     - `void` → `0`
   - Calcula `clv`:
     - Se `closing_odds` disponível: `model_probability - (1 / closing_odds)`
     - Caso contrário: `NULL`
   - Atualiza `status = 'graded'`, `graded_at = NOW()`

3. **Regra fundamental**: Nenhuma previsão é modificada após o grading. O UPDATE
   só opera sobre registros com `status = 'open'`.

---

## 4. Imutabilidade e Anti-Leakage

### 4.1. Regras de Imutabilidade

| Campo | Pode ser atualizado? | Quando |
|-------|---------------------|--------|
| `fair_market_probability` | ❌ Nunca | — |
| `model_probability` | ❌ Nunca | — |
| `edge` | ❌ Nunca | — |
| `ev` | ❌ Nunca | — |
| `prediq_score` | ❌ Nunca | — |
| `kelly_fraction` | ❌ Nunca | — |
| `generated_at` | ❌ Nunca | — |
| `closing_odds` | ✅ Uma vez | Antes do kickoff, se NULL |
| `snapshot_odds` | ✅ Uma vez | Antes do kickoff, se NULL |
| `result` | ✅ Uma vez | Após kickoff, se status='open' |
| `theoretical_return` | ✅ Uma vez | Junto com result |
| `clv` | ✅ Uma vez | Junto com result |
| `graded_at` | ✅ Uma vez | Junto com result |
| `status` | ✅ Uma vez | 'open' → 'graded' ou 'void' |

### 4.2. Prevenção de Data Leakage

- `generated_at` é registrado no INSERT — nunca alterado.
- Nenhum dado pós-kickoff influencia os campos de predição.
- O grading usa apenas o placar final (`home_score`, `away_score`) — dados disponíveis
  publicamente após o apito final.
- Walk-forward validation usa expanding window com `cutoff_date` estrito.

---

## 5. Agregações

O sistema calcula métricas agregadas nas seguintes dimensões:

| Dimensão | Agrupamento | Exemplo |
|----------|-------------|---------|
| **Liga** | `league` | "Brasileirão Série A", "Premier League" |
| **Mercado** | `market` | "1x2", "over/under 2.5" |
| **Faixa de Odds** | `CASE WHEN best_odds ...` | <1.50, 1.50-2.00, 2.00-3.00, 3.00-5.00, >5.00 |
| **Faixa de Edge** | `CASE WHEN edge ...` | 2-3%, 3-5%, 5-8%, 8-12%, >12% |
| **Faixa de EV** | `CASE WHEN ev ...` | <2%, 2-5%, 5-10%, >10% |
| **Faixa de PREDIQ** | `CASE WHEN prediq_score ...` | 0-30, 30-50, 50-70, 70-85, 85-100 |
| **Modelo** | `model_version` | "ensemble_1.0.0", "poisson_1.0.0" |
| **Período** | `date_trunc('week', ...)` | Semana a semana |

### 5.1. Métricas por Grupo

| Métrica | Fórmula | Tamanho Mínimo |
|---------|---------|----------------|
| **Sample Size** | COUNT(*) WHERE graded | — |
| **Hit Rate** | won / (won + lost) | 30 |
| **Brier Score** | AVG((p - y)²) | 200 |
| **Log Loss** | -AVG(y·log(p) + (1-y)·log(1-p)) | 200 |
| **ECE** | Σ(nₖ/N)·|ȳₖ - p̄ₖ| | 200 |
| **CLV Médio** | AVG(clv) WHERE clv IS NOT NULL | 100 |
| **ROI Teórico** | SUM(theoretical_return) / COUNT(graded) | 500 |
| **Max Drawdown** | max peak-to-trough no equity curve | 100 |

---

## 6. SHADOW LAB — Dashboard Administrativo

### 6.1. Abas

| Aba | Conteúdo |
|-----|----------|
| **Visão Geral** | KPIs, critérios de graduação, equity curve, métricas resumo |
| **Previsões** | Tabela de previsões (abertas + concluídas) com filtros |
| **Performance** | Agregações por dimensão (liga, mercado, odds, edge, etc.) |
| **Calibração** | Reliability curve, ECE por liga, estatísticas de calibração |

### 6.2. Fluxo de Dados

```
SHADOW LAB (Next.js)
    │
    ▼
/api/shadow-lab/route.ts (BFF)
    │
    ├── Tenta: Engine API /api/shadow/*
    │
    └── Fallback: Supabase direto (shadow_predictions table)
```

### 6.3. Visualizações

- **Equity Curve**: Evolução do bankroll simulado (flat staking 1% do bankroll).
- **Reliability Curve**: Probabilidade prevista vs frequência observada (10 bins).
- **Tabela de Previsões**: Todas as colunas da shadow_predictions, com filtros e paginação.
- **Tabela de Performance**: Métricas por grupo, com color-coding por qualidade.

---

## 7. Relatório Diário

Gerado automaticamente em formato Markdown via `generate_daily_report()`.

### 7.1. Seções

1. **Cabeçalho**: Data, versão do pipeline, status do shadow mode.
2. **Previsões Geradas**: Quantidade, ligas cobertas, faixa de PREDIQ.
3. **Oportunidades Selecionadas**: Previsões com edge > threshold, por liga.
4. **Resultados Finalizados**: Won/Lost/Void do dia, ROI do dia.
5. **Métricas Acumuladas**: Brier, Log Loss, ECE, CLV, ROI total, drawdown.
6. **Alertas de Inconsistência**:
   - Previsões geradas após o kickoff (CRÍTICO)
   - Registros modificados após grading (CRÍTICO)
   - Divergência Python/TypeScript em fair prob (ALERTA)
   - ECE > 0.10 em qualquer liga (ALERTA)
   - CLV negativo acumulado (ALERTA)
   - Drawdown > 20% (ALERTA)
7. **Critérios de Graduação**: Progresso em cada critério.

---

## 8. Critérios de Graduação

O shadow mode será considerado apto para avançar à próxima fase quando
**TODOS** os critérios abaixo forem atendidos simultaneamente:

| # | Critério | Threshold | Justificativa |
|---|----------|-----------|---------------|
| 1 | Eventos avaliados | ≥ 200 | Significância estatística para Brier Score |
| 2 | Apostas simuladas | ≥ 500 | Significância para ROI (Wilson CI < ±3%) |
| 3 | ECE por liga | < 0.05 em ≥ 3 ligas | Calibração estável em múltiplos mercados |
| 4 | CLV médio | > 0 | Edge real confirmado pelo closing line |
| 5 | Data leakage | Ausente | Zero previsões com `generated_at > kickoff_at` |
| 6 | Convergência Py/TS | Verificada | Fair probs idênticas entre engine e Model Audit |

### 8.1. Verificação Automática

A função `get_graduation_status()` verifica todos os critérios e retorna:

```json
{
  "ready": false,
  "criteria": {
    "events_200": {"current": 105, "target": 200, "met": false},
    "bets_500": {"current": 105, "target": 500, "met": false},
    "ece_3_leagues": {"leagues_passing": ["Brasileirão"], "target": 3, "met": false},
    "clv_positive": {"value": 0.012, "met": true},
    "no_leakage": {"violations": 0, "met": true},
    "python_ts_convergence": {"met": false, "note": "Verificação manual pendente"}
  }
}
```

### 8.2. O que Acontece Após a Graduação

Ao atingir todos os critérios:

1. **NÃO alterar os pesos do Índice PREDIQ** nesta fase.
2. Gerar relatório final de graduação com todas as métricas.
3. O pipeline pode avançar para paper trading (Fase 2), onde:
   - Apostas são registradas mas não executadas
   - Odds reais de execução são capturadas
   - Slippage e liquidez são medidos
4. Decisão humana explícita é necessária para avançar.

---

## 9. Restrições de Segurança

Todas as restrições do PIPELINE_CONTRACT.md permanecem em vigor:

1. ❌ **Nenhuma previsão inventada por LLM**. Todas vêm de modelos estatísticos.
2. ❌ **Nenhuma expressão proibida**: "aposta garantida", "dinheiro certo", etc.
3. ✅ **odds_history append-only**: Nunca substituir registros históricos.
4. ✅ **Imutabilidade temporal**: Nenhuma previsão alterada após kickoff.
5. ✅ **Anti-data-leakage**: cutoff_date, as_of, validate_no_leakage.
6. ❌ **Nenhuma tela comercial nova** nesta fase.
7. ❌ **Nenhum dinheiro real** durante o shadow mode.

---

## 10. Endpoints da API

### Engine (FastAPI) — prefixo `/api/shadow`

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/run` | Executa ciclo shadow (ingestão + pipeline + persistência) |
| `POST` | `/grade` | Faz grading de previsões finalizadas |
| `POST` | `/closing-odds` | Captura closing odds pré-kickoff |
| `GET` | `/overview` | Resumo do dashboard com critérios de graduação |
| `GET` | `/predictions` | Lista previsões com filtros (status, league, limit, offset) |
| `GET` | `/metrics` | Métricas agregadas por dimensão (group_by) |
| `GET` | `/calibration` | Dados da reliability curve |
| `GET` | `/equity-curve` | Simulação do equity curve |
| `GET` | `/report/{date}` | Relatório diário em Markdown |
| `GET` | `/graduation` | Status dos critérios de graduação |

### BFF (Next.js) — rota `/api/shadow-lab`

| Parâmetro | Valores | Descrição |
|-----------|---------|-----------|
| `view` | `overview`, `predictions`, `metrics`, `calibration`, `equity-curve` | Seleciona a view |
| `status` | `open`, `graded`, `all` | Filtro de status (predictions) |
| `league` | texto | Filtro de liga (predictions) |
| `group_by` | `league`, `market`, `odds_range`, `edge_range`, `ev_range`, `prediq_range`, `model`, `period` | Dimensão de agrupamento (metrics) |
| `limit` | inteiro | Paginação |
| `offset` | inteiro | Paginação |

---

## 11. Estimativa de Timeline

| Marco | Quando | Condição |
|-------|--------|----------|
| Shadow Mode ativo | Agora | Pipeline validado, tabela criada |
| 200 eventos | ~4-8 semanas | Depende do volume de jogos |
| 500 apostas simuladas | ~8-16 semanas | Depende do volume e do threshold de edge |
| ECE < 0.05 em 3 ligas | ~6-12 semanas | Depende da calibração dos modelos |
| Graduação completa | ~12-20 semanas | Todos os critérios atendidos |

---

## 12. Diagrama de Fluxo de Dados

```
Odds API (SportsGameOdds)
        │
        ▼
┌───────────────┐
│   odds table  │ (append-only)
└───────┬───────┘
        │
        ▼
┌───────────────┐     ┌──────────────────┐
│ Shadow Engine │────▶│ shadow_predictions│ (append-only)
│  run_cycle()  │     │                  │
└───────────────┘     └────────┬─────────┘
        │                      │
        │              ┌───────▼────────┐
        │              │ capture_closing │
        │              │ _odds()        │
        │              └───────┬────────┘
        │                      │
        │              ┌───────▼────────┐
        │              │ grade_shadow   │
        │              │ _predictions() │
        │              └───────┬────────┘
        │                      │
        ▼                      ▼
┌───────────────┐     ┌────────────────┐
│ model_        │     │ Aggregations & │
│ predictions   │     │ Daily Report   │
│ (existente)   │     └────────┬───────┘
└───────────────┘              │
                               ▼
                      ┌────────────────┐
                      │  SHADOW LAB    │
                      │  Dashboard     │
                      └────────────────┘
```

---

*Documento gerado como parte da implementação do Shadow Mode v1 do pipeline PREDIQ.*  
*Referências: PIPELINE_CONTRACT.md v1.0.0, PIPELINE_VALIDATION_REPORT.md.*
