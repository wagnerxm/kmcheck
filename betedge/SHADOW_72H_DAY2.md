# SHADOW 72H — DIA 2 (Observação Operacional)

**Período:** 2026-08-30 → 2026-08-31
**Modo:** SHADOW_COLLECTING (SHADOW_DRY_RUN=false)
**Environment:** ENV=staging, SHADOW_ENABLED=true

---

## ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA

Métricas quantitativas exibidas apenas para observação operacional.
Critérios de graduação NÃO estão sendo avaliados neste período.
Objetivo: validar operação contínua, não performance estatística.

---

## Pipeline Runs

| Run ID | Timestamp (UTC) | Eventos | Previsões | Seleções | Fail-safe | Erros | Warnings |
|--------|-----------------|---------|-----------|----------|-----------|-------|----------|
| _Aguardando dados reais_ | | | | | | | |

### Tendência (Dia 1 → Dia 2)

| Métrica | Dia 1 | Dia 2 | Δ | Nota |
|---------|-------|-------|---|------|
| Pipeline runs | — | — | — | |
| Eventos processados | — | — | — | |
| Previsões criadas | — | — | — | |
| Seleções feitas | — | — | — | |
| Erros | — | — | — | |
| Warnings | — | — | — | |

---

## Eventos Processados

- **Total de eventos buscados:** —
- **Eventos com odds válidas:** —
- **Eventos sem odds (ignorados):** —
- **Eventos adiados/cancelados:** —
- **Acumulado (2 dias):** —

---

## Prediction Snapshots

- **Previsões criadas (dia):** —
- **Previsões acumuladas (total):** —
- **Mercados cobertos:** —
- **Ligas cobertas:** —

---

## Shadow Selections

- **Seleções feitas (dia):** —
- **Seleções acumuladas (total):** —
- **Critérios de seleção ativados:** —
- **Taxa de seleção (seleções / previsões):** —

---

## Closing Captures

- **Closing odds capturadas:** —
- **Eventos com closing ausente:** —
- **Intervalo médio kickoff → capture:** —
- **Acumulado (2 dias):** —

---

## Gradings Concluídos

- **Previsões graded (dia):** —
- **Previsões graded (acumulado):** —
- **Won / Lost / Void:** — / — / —
- **Void rate:** —
- **Void rate acumulado:** —

---

## Erros e Warnings

| Categoria | Dia 1 | Dia 2 | Total | Detalhes |
|-----------|-------|-------|-------|----------|
| Erros de pipeline | — | — | — | |
| Warnings de pipeline | — | — | — | |
| Stale odds detectadas | — | — | — | |
| Leakage violations | — | — | — | |
| Scheduler failures | — | — | — | |
| Provider failures | — | — | — | |
| Redis lock failures | — | — | — | |
| Previsões bloqueadas (fail-safe) | — | — | — | |

---

## Health

| Componente | Dia 1 | Dia 2 | Detalhes |
|------------|-------|-------|----------|
| Database | — | — | |
| Redis | — | — | |
| Scheduler | — | — | |
| Shadow Mode | — | — | |

---

## Tempo Médio de Execução

| Job | Execuções (dia) | Execuções (total) | Tempo Médio | Max | Falhas |
|-----|-----------------|-------------------|-------------|-----|--------|
| shadow_daily_cycle | — | — | — | — | — |
| shadow_closing_odds | — | — | — | — | — |
| shadow_grading | — | — | — | — | — |
| shadow_metrics | — | — | — | — | — |
| shadow_leakage_check | — | — | — | — | — |
| shadow_daily_report | — | — | — | — | — |

---

## Métricas Quantitativas (OBSERVAÇÃO — AMOSTRA NÃO SIGNIFICATIVA)

| Métrica | Dia 1 | Dia 2 | Δ | Nota |
|---------|-------|-------|---|------|
| Brier Score | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| Log Loss | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| ECE | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| CLV Price (média) | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| CLV Probability (média) | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| ROI Teórico | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| Max Drawdown | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |

---

## Divergências API ↔ Banco ↔ Shadow Lab

| Item | Dia 1 | Dia 2 | Detalhes |
|------|-------|-------|----------|
| Python Engine ↔ Supabase | — | — | |
| Shadow Lab ↔ Engine | — | — | |
| BFF ↔ Engine | — | — | |

---

_Relatório gerado como template. Será preenchido com dados reais após_
_48 horas de operação do Shadow Mode._
