# SHADOW MODE v1 — ACTIVATION LOG

**Data de Ativação:** 2026-08-29
**Autorização:** Humana (explícita)
**Branch:** `claude/sports-betting-stats-platform-qrp7y8`
**Modo:** SHADOW_COLLECTING (coleta prospectiva real)

---

## Configuração Ativada

```
ENV=staging
SHADOW_ENABLED=true
SHADOW_DRY_RUN=false        ← ALTERADO (era true durante dry-run)
```

### O que mudou

| Variável | Antes | Depois | Impacto |
|----------|-------|--------|---------|
| `SHADOW_DRY_RUN` | `true` | `false` | Pipeline agora persiste seleções oficiais (`is_shadow_selection=true`) |

### O que NÃO mudou

- `ENV=staging` — mantido
- `SHADOW_ENABLED=true` — mantido
- Modelos — nenhuma alteração
- Ensemble — nenhuma alteração
- Fair probability — nenhuma alteração
- Índice PREDIQ — nenhuma alteração
- Thresholds de seleção — nenhuma alteração
- Critérios de graduação — nenhuma alteração
- Scheduler (6 jobs) — nenhuma alteração
- Regras quantitativas — nenhuma alteração

---

## 6 Jobs do Scheduler

| # | Job | Frequência | Timeout | Retries |
|---|-----|-----------|---------|---------|
| 1 | `shadow_daily_cycle` | 09:00 UTC (diário) | 10 min | 2 |
| 2 | `shadow_closing_odds` | cada 15 min | 2 min | 1 |
| 3 | `shadow_grading` | cada 30 min | 3 min | 1 |
| 4 | `shadow_metrics` | cada 1h | 5 min | 1 |
| 5 | `shadow_leakage_check` | cada 6h | 2 min | 0 |
| 6 | `shadow_daily_report` | 23:30 UTC (diário) | 3 min | 1 |

Todos os jobs utilizam lock distribuído via Redis (SET NX) para evitar
execução concorrente em múltiplas instâncias.

---

## Período de Observação Operacional — 72 Horas

**Início:** 2026-08-29 (ativação)
**Fim previsto:** 2026-09-01

### Monitoramento

| Dimensão | O que monitorar |
|----------|----------------|
| Ingestão | Falhas de fetch de odds, timeouts do provider |
| Stale odds | Odds desatualizadas (> 6h sem atualização) |
| Eventos | Adiados, cancelados, sem odds |
| Closing odds | Ausentes para eventos que iniciaram |
| Grading | Resultado incorreto, void rates anômalos |
| Data leakage | Predições após kickoff, dados futuros no treino |
| Jobs | Duplicados, lock conflicts, timeouts |
| Redis | Lock acquisition failures, connection errors |
| Divergências | API ≠ banco ≠ Shadow Lab |
| Scheduler | Cron misfire, jobs perdidos |
| Latência | Provider response time > 5s |
| Fail-safe | Previsões bloqueadas por validações |

### Relatórios Programados

| Relatório | Quando | Conteúdo |
|-----------|--------|----------|
| `SHADOW_72H_DAY1.md` | +24h | Pipeline runs, eventos, previsões, erros |
| `SHADOW_72H_DAY2.md` | +48h | Idem + tendências |
| `SHADOW_72H_DAY3.md` | +72h | Idem + consolidado |
| `SHADOW_72H_OPERATIONAL_REVIEW.md` | +72h | Veredicto final por dimensão |

---

## Restrições em Vigor

- ❌ Não desenvolver novos modelos
- ❌ Não recalibrar ensemble ou Índice PREDIQ
- ❌ Não adicionar live betting
- ❌ Não criar integrações com contas de bookmakers
- ❌ Não realizar apostas reais
- ❌ Sistema NÃO inventa previsões usando LLM
- ❌ odds_history é append-only
- ❌ Nenhuma previsão histórica alterável após início da partida
- ❌ Não corrigir regras quantitativas baseado nos primeiros resultados
- ❌ Não iniciar produção real
- ❌ Não iniciar nova fase de modelagem

---

## Pré-requisitos Verificados

| Item | Status |
|------|--------|
| Dry-run executado com sucesso | ✅ 5 eventos, 4 previsões, 0 seleções |
| Python/TS Convergence | ✅ PASS (0 findings proibidos) |
| Contrato Py ↔ TS | ✅ 105 testes passando |
| Suite completa | ✅ 874 testes, 0 falhas |
| Código commitado e pushado | ✅ |
| Autorização humana | ✅ Recebida 2026-08-29 |
