# PYTHON/TS CONVERGENCE REPORT

**Data:** 2026-08-29
**Status:** ✅ PASS — Python é a única fonte quantitativa
**Branch:** `claude/sports-betting-stats-platform-qrp7y8`

---

## Resumo Executivo

Todos os cálculos quantitativos foram **removidos do TypeScript** e migrados
para o Python Engine como fonte canônica. O TypeScript agora:
- Consome valores prontos via API/banco
- Faz DTO mapping (conversão de tipos, formatação)
- NÃO recalcula nenhum valor quantitativo

---

## Métricas por Componente

### 1. `packages/utils/src/odds.ts`

| Função | Status | Ação |
|--------|--------|------|
| `calculateOverround` | ✅ REMOVIDA | Era cálculo quantitativo |
| `removVig` | ✅ REMOVIDA | Remoção de vig multiplicativa |
| `removeVigMultiplicative` | ✅ REMOVIDA | Remoção de vig multiplicativa |
| `removeVigPower` | ✅ REMOVIDA | Remoção de vig power method |
| `removeVigShin` | ✅ REMOVIDA | Remoção de vig Shin (1992) |
| `removeVig` (dispatcher) | ✅ REMOVIDA | Dispatcher de métodos |
| `fairProbabilities` | ✅ REMOVIDA | Probabilidade justa |
| `fairOdds` | ✅ REMOVIDA | Odds justas |
| `VigRemovalMethod` (type) | ✅ REMOVIDA | Tipo auxiliar |
| `decimalToImplied` | ✅ MANTIDA | Conversão de formato |
| `impliedToDecimal` | ✅ MANTIDA | Conversão de formato |
| `decimalToAmerican` | ✅ MANTIDA | Conversão de formato |
| `americanToDecimal` | ✅ MANTIDA | Conversão de formato |
| `decimalToFractional` | ✅ MANTIDA | Conversão de formato |

### 2. `apps/web/src/app/api/model-audit/route.ts`

| Cálculo | Status | Ação |
|---------|--------|------|
| `removeVigShin` (inline) | ✅ REMOVIDA | Função Shin embutida (~35 linhas) |
| Fair probability (fallback) | ✅ REMOVIDA | `usedMV` flag + recálculo Shin |
| Edge inline `(model - fair) / fair` | ✅ REMOVIDA | Era fórmula relativa (divergente) |
| EV inline `prob × odds - 1` | ✅ REMOVIDA | Fórmula de EV |
| Fair prob fonte | ✅ `mv_fair_probabilities` | Materialized view (Python canônico) |
| Edge fonte | ✅ `value_opportunities.edge` | Tabela Python (canônico) |
| EV fonte | ✅ `value_opportunities.ev` | Tabela Python (canônico) |
| PREDIQ Score fonte | ✅ `value_opportunities.edge_score` | Tabela Python (canônico) |

### 3. `apps/web/src/app/api/odds/comparison/[eventId]/route.ts`

| Cálculo | Status | Ação |
|---------|--------|------|
| `removeVigMultiplicative` (inline) | ✅ REMOVIDA | ~15 linhas de código |
| `removeVigPower` (inline) | ✅ REMOVIDA | ~20 linhas + solver numérico |
| `removeVigShin` (inline) | ✅ REMOVIDA | ~25 linhas + busca binária |
| `removeVig` (dispatcher) | ✅ REMOVIDA | Dispatcher 3 métodos |
| Fair probs fonte | ✅ Python Engine | `GET /api/odds/comparison/{event_id}/{market}` |
| Overround fonte | ✅ Python Engine | Mesmo endpoint, `overround_pct` |
| Fallback engine off | ✅ `null` | Sem recálculo — null quando engine indisponível |

### 4. `apps/web/src/app/api/shadow-lab/route.ts`

| Cálculo | Status | Ação |
|---------|--------|------|
| Brier Score | ✅ REMOVIDA | ~8 linhas de fórmula |
| Log Loss | ✅ REMOVIDA | ~8 linhas de fórmula |
| ECE com binning | ✅ REMOVIDA | ~25 linhas de binning |
| Max Drawdown | ✅ REMOVIDA | ~20 linhas de simulação |
| CLV mean | ✅ REMOVIDA | Cálculo de média |
| ROI teórico | ✅ REMOVIDA | Fórmula de ROI |
| League ECE | ✅ REMOVIDA | ECE por liga |
| Curva de calibração | ✅ REMOVIDA | Bins + reliability |
| Curva de equidade | ✅ REMOVIDA | Simulação de bankroll |
| Overview fonte | ✅ Python Engine | `GET /api/shadow/overview` |
| Metrics fonte | ✅ Python Engine | `GET /api/shadow/metrics` |
| Calibration fonte | ✅ Python Engine | `GET /api/shadow/calibration` |
| Equity curve fonte | ✅ Python Engine | `GET /api/shadow/equity-curve` |
| Predictions fallback | ✅ Supabase | Leitura + DTO (sem cálculo) |

---

## Endpoint Python Criado

### `GET /api/odds/comparison/{event_id}/{market}`

Endpoint novo no Python Engine para fornecer fair probabilities ao
componente de comparação de odds do frontend.

**Resposta:**
```json
{
  "event_id": "uuid",
  "market": "1x2",
  "by_bookmaker": [
    {
      "bookmaker": "Bet365",
      "outcomes": ["home", "draw", "away"],
      "decimal_odds": [2.10, 3.40, 3.50],
      "implied_probabilities": [0.4762, 0.2941, 0.2857],
      "overround_pct": 5.60,
      "fair_probs": {
        "multiplicative": {"home": 0.4510, "draw": 0.2785, "away": 0.2705},
        "power": {"home": 0.4508, "draw": 0.2783, "away": 0.2709},
        "shin": {"home": 0.4505, "draw": 0.2788, "away": 0.2707}
      }
    }
  ],
  "best_odds": {"home": 2.10, "draw": 3.40, "away": 3.60},
  "computed_at": "2026-08-29T12:00:00Z"
}
```

---

## Testes de Guardrail

### `test_convergence_py_ts.py`

| Teste | Status | Descrição |
|-------|--------|-----------|
| `test_ts_files_exist` | ✅ PASS | Diretórios TS auditáveis |
| `test_zero_forbidden_quantitative_implementations` | ✅ PASS | 0 findings |
| `test_no_vig_removal_in_any_ts_file` | ✅ PASS | 0 funções de vig |
| `test_no_shin_implementation_in_tsx` | ✅ PASS | 0 Shin em .tsx |
| `test_no_metric_calculations_in_api_routes` | ✅ PASS | 0 métricas em routes |
| `test_odds_ts_no_quantitative_exports` | ✅ PASS | Apenas conversões |
| `test_convergence_summary` | ✅ PASS | Sumário limpo |

### `test_contract_py_ts.py`

| Teste | Status | Descrição |
|-------|--------|-----------|
| `test_fair_market_probability_contract` (×8) | ✅ PASS | Python = TS BFF |
| `test_model_probability_contract` (×8) | ✅ PASS | Python = TS BFF |
| `test_edge_contract` (×8) | ✅ PASS | Python = TS BFF |
| `test_ev_contract` (×8) | ✅ PASS | Python = TS BFF |
| `test_prediq_score_contract` (×8) | ✅ PASS | Python = TS BFF |
| `test_kelly_contract` (×8) | ✅ PASS | Python = TS BFF |
| `test_clv_contract` (×8) | ✅ PASS | Python = TS BFF |
| `test_brier_score_python_only` | ✅ PASS | Brier no Python |
| `test_log_loss_python_only` | ✅ PASS | Log Loss no Python |
| `test_ece_python_only` | ✅ PASS | ECE no Python |
| `test_drawdown_python_only` | ✅ PASS | Drawdown no Python |
| `test_minimum_predictions_covered` | ✅ PASS | ≥5 previsões |
| `test_multiple_markets_covered` | ✅ PASS | ≥2 mercados |
| `test_multiple_leagues_covered` | ✅ PASS | ≥3 ligas |
| `test_both_results_covered` | ✅ PASS | won + lost |
| `test_edge_equals_model_minus_fair` (×8) | ✅ PASS | Consistência |
| `test_ev_equals_prob_times_odds_minus_one` (×8) | ✅ PASS | Consistência |
| `test_fair_prob_in_valid_range` (×8) | ✅ PASS | (0, 1) |
| `test_prediq_score_nonnegative` (×8) | ✅ PASS | ≥ 0 |
| `test_grading_correct` (×8) | ✅ PASS | Resultado correto |

---

## Padrões de Detecção (Guardrail)

O teste de convergência detecta **implementações** de cálculos, não variáveis:

| Padrão | O que detecta | Falsos positivos evitados |
|--------|---------------|--------------------------|
| `vig_removal_function` | `function removeVigShin(` | `fairProb` como variável = OK |
| `shin_implementation` | `shinMethod`, `computeShin` | Referência em comentário = OK |
| `shin_formula_body` | `Math.sqrt(z*z+...)` | — |
| `power_method_solver` | `totalAt(k) > 1.0` | — |
| `brier_formula` | `(p - outcome) ** 2` | — |
| `log_loss_formula` | `Math.log(p)...Math.log(1-p)` | — |
| `ece_binning` | `Math.floor(p * NUM_BINS)` | — |
| `drawdown_simulation` | `bankroll/peak...drawdown=` | — |
| `ev_formula_inline` | `probability * odds - 1` | — |
| `edge_formula_inline` | `(prob - fairProb) / fairProb` | — |

Comentários (`//`, `/* */`) são excluídos automaticamente da varredura.

---

## Princípio Arquitetural

```
┌─────────────┐     SQL/API      ┌──────────────┐    JSON     ┌──────────┐
│   Python     │ ──────────────→ │  Next.js BFF │ ─────────→ │ Frontend │
│   Engine     │   fair_prob,    │  (DTO only)  │  repassa   │  (React) │
│              │   edge, ev,     │              │  valores   │          │
│  COMPUTA     │   prediq_score, │  NÃO calcula │  prontos   │ EXIBE    │
│  tudo        │   kelly, clv,   │              │            │          │
│              │   brier, etc.   │              │            │          │
└─────────────┘                  └──────────────┘            └──────────┘
```

**Regra:** Seta vai APENAS da esquerda para a direita.
O TypeScript **nunca** computa valores quantitativos.

---

## Código Removido (Resumo)

| Arquivo | Linhas removidas | Tipo |
|---------|-----------------|------|
| `odds.ts` | ~260 | Funções de vig removal, overround, fair probs |
| `model-audit/route.ts` | ~50 | Shin inline, Edge/EV formulas |
| `odds-comparison/route.ts` | ~80 | 3 métodos de vig removal + dispatcher |
| `shadow-lab/route.ts` | ~500 | Brier, Log Loss, ECE, Drawdown, calibração |
| `odds.test.ts` | ~380 | Testes das funções removidas |
| **TOTAL** | **~1.270** | **linhas de cálculo quantitativo removidas do TS** |

---

## Veredicto

| Critério | Status |
|----------|--------|
| Zero implementações quantitativas no TS | ✅ PASS |
| Python é fonte canônica de fair probability | ✅ PASS |
| Python é fonte canônica de Edge/EV | ✅ PASS |
| Python é fonte canônica de PREDIQ Score | ✅ PASS |
| Python é fonte canônica de Kelly | ✅ PASS |
| Python é fonte canônica de CLV | ✅ PASS |
| Python é fonte canônica de Brier/Log Loss/ECE/DD | ✅ PASS |
| Contrato Py ↔ TS (≥5 previsões) | ✅ PASS |
| Guardrail impede reintrodução | ✅ PASS |
| **PYTHON/TS CONVERGENCE** | **✅ PASS** |
