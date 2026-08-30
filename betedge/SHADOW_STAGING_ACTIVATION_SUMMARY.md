# Resumo — Ativação Controlada de Staging (Shadow Mode v1)

**Data:** 2026-08-29 | **Branch:** `claude/sports-betting-stats-platform-qrp7y8`

---

## Status: ✅ READY_FOR_SHADOW_COLLECTION

O dry-run de staging foi executado com sucesso. Todos os itens críticos passaram.
**SHADOW_DRY_RUN=false NÃO foi alterado. Aguardando autorização humana.**

---

## O Que Foi Feito

### 1. Infraestrutura de Staging

- PostgreSQL 16 + Redis inicializados localmente
- Banco `betedge_staging` criado com todas as 12 migrations aplicadas
- 3 tabelas shadow verificadas: `shadow_predictions` (61 colunas), `shadow_pipeline_runs` (24 colunas), `shadow_rate_limits`
- 12 índices, 1 trigger write-once, RLS ativo
- Variáveis de ambiente `.env.staging.example` validadas (sem segredos expostos)

### 2. Dados Reais Semeados

- **5 eventos futuros reais** (EPL + La Liga):
  1. Arsenal vs Aston Villa — EPL — 30/08 14:00 UTC
  2. Liverpool vs Manchester United — EPL — 30/08 16:30 UTC
  3. Chelsea vs Brighton — EPL — 31/08 15:00 UTC
  4. Real Madrid vs Atlético Madrid — La Liga — 30/08 19:00 UTC
  5. Barcelona vs Sevilla — La Liga — 31/08 20:00 UTC
- **57 odds** de 5 bookmakers reais (1xBet, Bet365, Betfair, Pinnacle, William Hill)
- **15 consensus predictions** (3 outcomes × 5 eventos)
- **Zero dados mockados, fixtures ou valores inventados**

### 3. Correções Técnicas (asyncpg)

| Correção | Arquivo | Motivo |
|----------|---------|--------|
| Split multi-statement DDL | `shadow/schema.py` | asyncpg não suporta múltiplos comandos em prepared statement |
| `:param::jsonb` → `CAST(:param AS jsonb)` | `shadow/engine.py` (6 ocorrências) | asyncpg confunde `::` cast com `:param` syntax |
| Logger structlog → standard logging | `shadow/engine.py` | `logger.warning()` não aceita kwargs no stdlib logging |

### 4. Dry-Run Executado

```
Pipeline Run: shadow-run-20260829-104159-b3c428f4
ENV=staging, SHADOW_ENABLED=true, SHADOW_DRY_RUN=true
```

| Métrica | Valor |
|---------|-------|
| Eventos processados | 5 |
| Previsões geradas | 4 |
| Seleções marcadas | **0** (dry run) |
| Would-be-selections | 1 (Arsenal, edge 5.59%, score 51.04) |
| Erros | 0 |
| Fail-safes | 0 |
| Duração | 0.11s |
| Leakage check | passed |

**Chelsea vs Brighton** corretamente excluído — edge negativo (-0.60%).

### 5. Verificações Matemáticas Independentes

**12/12 verificações ✅ MATCH** (delta < 1e-6):

| Match | Fair Prob (Shin) | Edge | EV | Verificação |
|-------|------------------|------|-----|-------------|
| Arsenal vs Aston Villa | 0.6241 | 5.59% | 7.44% | ✅✅✅ |
| Liverpool vs Man Utd | 0.6894 | 3.06% | 3.68% | ✅✅✅ |
| Real Madrid vs Atlético | 0.5516 | 2.84% | 3.24% | ✅✅✅ |
| Barcelona vs Sevilla | 0.7296 | 5.04% | 5.30% | ✅✅✅ |

Fórmulas confirmadas:
- `Edge = model_probability - fair_market_probability`
- `EV = model_probability × best_decimal_odds - 1`

### 6. Teste Automatizado de Convergência Py/TS

Criado `tests/test_convergence_py_ts.py` com 5 testes:
- Varredura estática de 53 arquivos TS
- 15 findings em 7 arquivos (todos documentados como WARNING)
- **TS recalcula Shin/Edge/EV** em: `odds.ts`, `model-audit/route.ts`, `odds-comparison/route.ts`
- **TS recalcula métricas** em: `shadow-lab/route.ts` (Brier, Log Loss, ECE, Drawdown)
- **Impacto:** BAIXO — valores canônicos estão no banco (Python)

### 7. Demais Verificações

| Item | Status |
|------|--------|
| `/health/db` | ✅ PostgreSQL conectado |
| `/health/redis` | ✅ Redis PONG |
| `/health/shadow` | ✅ Endpoint ativo |
| `/health/scheduler` | ✅ Endpoint ativo |
| Scheduler (6 jobs) | ✅ Configurados com Redis locks, retries, timeouts |
| Leakage (3 checks) | ✅ 0 violações |
| is_shadow_selection=false | ✅ Nenhuma seleção marcada no dry run |
| pipeline_run registrado | ✅ status=completed, config_snapshot.dry_run=true |

---

## Classificação Final — 9 Dimensões

| # | Dimensão | Status |
|---|----------|--------|
| 1 | DATA PROVIDER | ✅ PASS |
| 2 | DATABASE | ✅ PASS |
| 3 | MATHEMATICS | ✅ PASS |
| 4 | PIPELINE | ✅ PASS |
| 5 | PYTHON/TS CONVERGENCE | ⚠️ WARNING |
| 6 | LEAKAGE | ✅ PASS |
| 7 | SCHEDULER | ✅ PASS |
| 8 | OBSERVABILITY | ✅ PASS |
| 9 | DRY RUN | ✅ PASS |

**0 FAIL → READY_FOR_SHADOW_COLLECTION**

---

## Test Suite

```
767 passed, 2 xfailed, 0 failures (13.95s)
```

- Baseline: 648 → +114 (Day-1) → +5 (convergência) = **767**

---

## Restrições de Segurança — TODAS VERIFICADAS

- ✅ Nenhum modelo criado ou recalibrado
- ✅ Ensemble, fair probability, Score, thresholds inalterados
- ✅ Sem live betting, sem integrações com bookmakers
- ✅ Sem apostas reais — Shadow Mode apenas
- ✅ Sem previsões inventadas por LLM
- ✅ odds_history append-only
- ✅ Write-once trigger para campos de grading
- ✅ validate_no_leakage() — 0 violações

---

## Próximo Passo (Aguardando Autorização)

Quando autorizar, o comando é:

```bash
export SHADOW_DRY_RUN=false
```

Isso inicia as primeiras 72h de coleta real em staging. O scheduler executará automaticamente os 6 jobs:
- **09:00 UTC** — Ciclo diário (previsões reais com seleções)
- **Cada 15min** — Captura de closing odds
- **Cada 30min** — Grading de resultados
- **Cada 1h** — Recálculo de métricas
- **Cada 6h** — Verificação de data leakage
- **23:30 UTC** — Relatório diário

Monitoramento via:
```bash
curl /api/v1/health/shadow
curl /api/v1/shadow/overview
curl /api/v1/shadow/report/$(date +%Y-%m-%d)
```

---

## Arquivos Criados/Modificados

| Arquivo | Ação |
|---------|------|
| `betedge/SHADOW_DAY1_DRY_RUN_REPORT.md` | **Criado** — Relatório completo do dry run |
| `betedge/SHADOW_STAGING_ACTIVATION_SUMMARY.md` | **Criado** — Este resumo |
| `betedge/services/engine/app/shadow/schema.py` | Modificado — Fix asyncpg multi-command |
| `betedge/services/engine/app/shadow/engine.py` | Modificado — Fix ::jsonb cast + logger |
| `betedge/services/engine/tests/test_convergence_py_ts.py` | **Criado** — 5 testes convergência |

---

*Branch: claude/sports-betting-stats-platform-qrp7y8*
*Commit: da9210e*
*Pushed: ✅*
