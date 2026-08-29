# PREDIQ — Execução da Convergência Python/TypeScript

**Data:** 2026-08-29
**Branch:** `claude/sports-betting-stats-platform-qrp7y8`
**Commit:** `fix(web): enforce Python as single quantitative source of truth`
**Status:** ✅ READY_FOR_SHADOW_COLLECTION — ZERO WARNINGS

---

## Objetivo

Eliminar o WARNING de PYTHON/TS CONVERGENCE antes de ativar `SHADOW_DRY_RUN=false`.

**Regra:** Python é a ÚNICA fonte oficial de toda matemática quantitativa do PREDIQ.
TypeScript deve apenas consumir, transformar para DTO e formatar para apresentação.

---

## Arquivos Modificados (9 arquivos, ~1.270 linhas removidas do TS)

### 1. `packages/utils/src/odds.ts` — REMOVIDO ~260 linhas

**Removido:**
- `calculateOverround` — cálculo de overround
- `removVig` — remoção de vig multiplicativa
- `removeVigMultiplicative` — método multiplicativo
- `removeVigPower` — método power (solver numérico)
- `removeVigShin` — método Shin 1992 (busca binária)
- `removeVig` — dispatcher de 3 métodos
- `fairProbabilities` — probabilidades justas
- `fairOdds` — odds justas
- `VigRemovalMethod` — tipo auxiliar

**Mantido (conversões de formato, sem cálculo quantitativo):**
- `decimalToImplied`
- `impliedToDecimal`
- `decimalToAmerican`
- `americanToDecimal`
- `decimalToFractional`

### 2. `services/engine/app/api/odds.py` — NOVO endpoint Python

```
GET /api/odds/comparison/{event_id}/{market}
```

Retorna fair probabilities per-bookmaker com os 3 métodos (multiplicative, power, shin),
overround_pct e best_odds. Criado para substituir os cálculos que estavam inline no TS
do componente de comparação de odds.

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
        "multiplicative": {"home": 0.4510, ...},
        "power": {"home": 0.4508, ...},
        "shin": {"home": 0.4505, ...}
      }
    }
  ],
  "best_odds": {"home": 2.10, "draw": 3.40, "away": 3.60},
  "computed_at": "2026-08-29T12:00:00Z"
}
```

### 3. `apps/web/src/app/api/model-audit/route.ts` — REMOVIDO ~50 linhas

**Removido:**
- Função `removeVigShin` inline (~35 linhas de Shin embutido)
- Flag `usedMV` + fallback com recálculo Shin para fair probability
- Fórmula de Edge inline: `(model_prob - fairProb) / fairProb` (era edge relativo, divergente do canônico)
- Fórmula de EV inline: `prob × odds - 1`

**Agora:**
- Fair probability vem de `mv_fair_probabilities` (materialized view, Python canônico)
- Edge vem de `value_opportunities.edge` (tabela Python)
- EV vem de `value_opportunities.ev` (tabela Python)
- PREDIQ Score vem de `value_opportunities.edge_score` (tabela Python)

**Correção importante:** model-audit usava fórmula de edge DIVERGENTE (`(model - fair) / fair`,
edge relativo) vs Python canônico (`model - fair`, edge absoluto). Agora lê o valor canônico
direto do banco.

### 4. `apps/web/src/app/api/odds/comparison/[eventId]/route.ts` — REESCRITO, ~80 linhas removidas

**Removido:**
- `removeVigMultiplicative` inline (~15 linhas)
- `removeVigPower` inline (~20 linhas + solver numérico)
- `removeVigShin` inline (~25 linhas + busca binária)
- `removeVig` dispatcher

**Agora:**
- `tryEngine()` helper chama Python Engine: `GET /api/odds/comparison/{eventId}/{market}`
- Resposta do engine é mesclada com dados do Supabase por nome do bookmaker
- Quando engine indisponível: fair probs = `null`, overround = `null`
- Zero recálculo no TypeScript

### 5. `apps/web/src/app/api/shadow-lab/route.ts` — REESCRITO, ~500 linhas removidas

**Removido (todo o fallback Supabase com cálculos quantitativos):**
- Brier Score: `(p - outcome)²` (~8 linhas)
- Log Loss: `-[y·ln(p) + (1-y)·ln(1-p)]` (~8 linhas)
- ECE com binning: `Math.floor(p × NUM_BINS)` (~25 linhas)
- Max Drawdown: simulação bankroll/peak (~20 linhas)
- CLV mean, ROI teórico
- League ECE, curva de calibração, curva de equidade

**Agora:**
- Views quantitativas (overview, metrics, calibration, equity-curve) → Python Engine exclusivo
- Engine indisponível → dados vazios com `_engineAvailable: false`
- View predictions → fallback Supabase (leitura pura + DTO, sem cálculo)

### 6. `packages/utils/src/odds.test.ts` — REESCRITO, ~380 linhas removidas

**Removido:** Todos os testes das funções quantitativas deletadas.

**Mantido:** Testes das 5 funções de conversão de formato.

**Adicionado:** Meta-teste que verifica que as funções removidas NÃO estão exportadas:
```typescript
const forbiddenExports = ["calculateOverround", "removVig", ...];
for (const name of forbiddenExports) {
  expect(exportedNames).not.toContain(name);
}
```

### 7. `services/engine/tests/test_convergence_py_ts.py` — REESCRITO como guardrail

De WARNING → FAIL-on-any-finding.

**10 padrões de detecção** (implementações, não variáveis):

| Padrão | O que detecta |
|--------|---------------|
| `vig_removal_function` | `function removeVigShin(` |
| `shin_implementation` | `shinMethod`, `computeShin` |
| `shin_formula_body` | `Math.sqrt(z*z+...)` Shin |
| `power_method_solver` | `totalAt(k) > 1.0` solver |
| `brier_formula` | `(p - outcome) ** 2` |
| `log_loss_formula` | `Math.log(p)...Math.log(1-p)` |
| `ece_binning` | `Math.floor(p * NUM_BINS)` |
| `drawdown_simulation` | `bankroll/peak → drawdown` |
| `ev_formula_inline` | `probability * odds - 1` |
| `edge_formula_inline` | `(prob - fairProb) / fairProb` |

**Filtragem inteligente:** Comentários (`//`, `/* */`) são excluídos automaticamente.
Variáveis como `fairProb = response.data.fair_prob` NÃO disparam o guardrail.

**7 testes:**
1. `test_ts_files_exist` — diretórios TS existem
2. `test_zero_forbidden_quantitative_implementations` — guardrail principal (0 findings)
3. `test_no_vig_removal_in_any_ts_file` — 0 funções de vig
4. `test_no_shin_implementation_in_tsx` — 0 Shin em componentes
5. `test_no_metric_calculations_in_api_routes` — 0 métricas em routes
6. `test_odds_ts_no_quantitative_exports` — apenas conversões exportadas
7. `test_convergence_summary` — sumário de auditoria

### 8. `services/engine/tests/test_contract_py_ts.py` — NOVO

**Teste de contrato:** 8 previsões sintéticas × 7 métricas + 4 métricas agregadas.

**Previsões:**

| ID | Jogo | Liga | Mercado | Resultado |
|----|------|------|---------|-----------|
| pred-001 | Flamengo vs Palmeiras | Serie A | 1x2 home | won |
| pred-002 | Santos vs Corinthians | Serie A | 1x2 away | lost |
| pred-003 | Real Madrid vs Barcelona | La Liga | O/U over | won |
| pred-004 | Liverpool vs Man City | Premier League | BTTS yes | won |
| pred-005 | Juventus vs Inter | Serie A IT | 1x2 draw | won |
| pred-006 | Bayern vs Dortmund | Bundesliga | 1x2 home | lost |
| pred-007 | Atl. Madrid vs Sevilla | La Liga | O/U under | lost |
| pred-008 | PSG vs Lyon | Ligue 1 | 1x2 home | won |

**Métricas por previsão verificadas:**
- `fair_market_probability` — Python computa (Shin) → TS repassa
- `model_probability` — Python computa → TS repassa
- `edge` — Python computa (`model - fair`) → TS repassa
- `ev` — Python computa (`prob × odds - 1`) → TS repassa
- `prediq_score` — Python computa → TS repassa
- `kelly_fraction` — Python computa (fractional Kelly) → TS repassa
- `clv` — Python computa (price formula) → TS repassa

**Métricas agregadas verificadas:**
- Brier Score, Log Loss, ECE, Max Drawdown — todos computados pelo Python.

**Consistência canônica verificada:**
- `edge == model_probability - fair_market_probability`
- `ev == model_probability × best_odds - 1`
- `fair_prob ∈ (0, 1)`
- `prediq_score ≥ 0`
- Grading correto (placar → resultado)

### 9. `PYTHON_TS_CONVERGENCE_REPORT.md` — NOVO

Relatório de auditoria completo com tabelas por componente, padrões de detecção,
diagrama de arquitetura e veredicto PASS.

---

## Resultados dos Testes

```
$ python -m pytest tests/ -v
======================== 874 passed, 2 xfailed, 0 failures ========================
```

### Convergência (7/7 PASS):
```
test_ts_files_exist                              PASSED
test_zero_forbidden_quantitative_implementations PASSED  ← 0 findings
test_no_vig_removal_in_any_ts_file               PASSED
test_no_shin_implementation_in_tsx               PASSED
test_no_metric_calculations_in_api_routes        PASSED
test_odds_ts_no_quantitative_exports             PASSED
test_convergence_summary                         PASSED
```

### Contrato (105/105 PASS):
```
test_fair_market_probability_contract ×8          PASSED
test_model_probability_contract ×8                PASSED
test_edge_contract ×8                             PASSED
test_ev_contract ×8                               PASSED
test_prediq_score_contract ×8                     PASSED
test_kelly_contract ×8                            PASSED
test_clv_contract ×8                              PASSED
test_brier_score_python_only                      PASSED
test_log_loss_python_only                         PASSED
test_ece_python_only                              PASSED
test_drawdown_python_only                         PASSED
test_minimum_predictions_covered (≥5)             PASSED
test_multiple_markets_covered (≥2)                PASSED
test_multiple_leagues_covered (≥3)                PASSED
test_both_results_covered (won + lost)            PASSED
test_edge_equals_model_minus_fair ×8              PASSED
test_ev_equals_prob_times_odds_minus_one ×8       PASSED
test_fair_prob_in_valid_range ×8                  PASSED
test_prediq_score_nonnegative ×8                  PASSED
test_grading_correct ×8                           PASSED
test_contract_summary                             PASSED
```

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
| Python é fonte canônica de Brier/Log Loss/ECE/Drawdown | ✅ PASS |
| Contrato Py ↔ TS (≥5 previsões) | ✅ PASS |
| Guardrail impede reintrodução | ✅ PASS |
| Suite completa (874 testes) | ✅ PASS |
| **PYTHON/TS CONVERGENCE** | **✅ PASS** |

---

## ⏸️ Próximo Passo — AGUARDANDO AUTORIZAÇÃO HUMANA

`SHADOW_DRY_RUN=false` **NÃO foi alterado.**

Para ativar a coleta shadow real, o humano deve:
1. Revisar este relatório
2. Autorizar explicitamente a mudança de `SHADOW_DRY_RUN=false`
3. O sistema NÃO procederá sem autorização

**Restrições que permanecem em vigor:**
- Não desenvolver novos modelos
- Não recalibrar ensemble ou Índice PREDIQ
- Não adicionar live betting
- Não criar integrações com contas de bookmakers
- Não realizar apostas reais
- O sistema NÃO inventa previsões usando LLM
- odds_history é append-only
- Prevenção de data leakage
- Nenhuma previsão histórica alterável após início da partida
