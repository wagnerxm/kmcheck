# SHADOW 72H — DIA 3 (Observação Operacional — Consolidado)

**Período:** 2026-08-31 → 2026-09-01
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

### Tendência Consolidada (3 dias)

| Métrica | Dia 1 | Dia 2 | Dia 3 | Total | Média/dia |
|---------|-------|-------|-------|-------|-----------|
| Pipeline runs | — | — | — | — | — |
| Eventos processados | — | — | — | — | — |
| Previsões criadas | — | — | — | — | — |
| Seleções feitas | — | — | — | — | — |
| Erros | — | — | — | — | — |
| Warnings | — | — | — | — | — |

---

## Eventos Processados

- **Total de eventos buscados (dia):** —
- **Total de eventos buscados (3 dias):** —
- **Eventos com odds válidas:** —
- **Eventos sem odds (ignorados):** —
- **Eventos adiados/cancelados:** —

---

## Prediction Snapshots

- **Previsões criadas (dia):** —
- **Previsões acumuladas (3 dias):** —
- **Mercados cobertos:** —
- **Ligas cobertas:** —

---

## Shadow Selections

- **Seleções feitas (dia):** —
- **Seleções acumuladas (3 dias):** —
- **Critérios de seleção ativados:** —
- **Taxa de seleção (seleções / previsões):** —

---

## Closing Captures

- **Closing odds capturadas (dia):** —
- **Closing odds capturadas (3 dias):** —
- **Eventos com closing ausente:** —
- **Intervalo médio kickoff → capture:** —

---

## Gradings Concluídos

- **Previsões graded (dia):** —
- **Previsões graded (3 dias):** —
- **Won / Lost / Void (dia):** — / — / —
- **Won / Lost / Void (3 dias):** — / — / —
- **Void rate (dia):** —
- **Void rate (3 dias):** —

---

## Erros e Warnings — Consolidado

| Categoria | Dia 1 | Dia 2 | Dia 3 | Total | Tendência |
|-----------|-------|-------|-------|-------|-----------|
| Erros de pipeline | — | — | — | — | |
| Warnings de pipeline | — | — | — | — | |
| Stale odds detectadas | — | — | — | — | |
| Leakage violations | — | — | — | — | |
| Scheduler failures | — | — | — | — | |
| Provider failures | — | — | — | — | |
| Redis lock failures | — | — | — | — | |
| Previsões bloqueadas (fail-safe) | — | — | — | — | |

---

## Health — Consolidado

| Componente | Dia 1 | Dia 2 | Dia 3 | Veredicto |
|------------|-------|-------|-------|-----------|
| Database | — | — | — | |
| Redis | — | — | — | |
| Scheduler | — | — | — | |
| Shadow Mode | — | — | — | |

---

## Tempo Médio de Execução — Consolidado

| Job | Execuções (3 dias) | Tempo Médio | Max | Min | Falhas | Taxa de Sucesso |
|-----|--------------------|-------------|-----|-----|--------|-----------------|
| shadow_daily_cycle | — | — | — | — | — | — |
| shadow_closing_odds | — | — | — | — | — | — |
| shadow_grading | — | — | — | — | — | — |
| shadow_metrics | — | — | — | — | — | — |
| shadow_leakage_check | — | — | — | — | — | — |
| shadow_daily_report | — | — | — | — | — | — |

---

## Métricas Quantitativas (OBSERVAÇÃO — AMOSTRA NÃO SIGNIFICATIVA)

| Métrica | Dia 1 | Dia 2 | Dia 3 | Tendência | Nota |
|---------|-------|-------|-------|-----------|------|
| Brier Score | — | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| Log Loss | — | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| ECE | — | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| CLV Price (média) | — | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| CLV Probability (média) | — | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| ROI Teórico | — | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |
| Max Drawdown | — | — | — | — | ⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA |

---

## Divergências API ↔ Banco ↔ Shadow Lab — Consolidado

| Item | Dia 1 | Dia 2 | Dia 3 | Veredicto |
|------|-------|-------|-------|-----------|
| Python Engine ↔ Supabase | — | — | — | |
| Shadow Lab ↔ Engine | — | — | — | |
| BFF ↔ Engine | — | — | — | |

---

_Relatório gerado como template. Será preenchido com dados reais após_
_72 horas de operação do Shadow Mode._

_Após preenchimento deste relatório, gerar `SHADOW_72H_OPERATIONAL_REVIEW.md`_
_com veredicto final por dimensão._
