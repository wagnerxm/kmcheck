# PREDIQ Shadow Mode v1 — Resumo da Ativação

**Data:** 2026-08-29
**Branch:** `claude/sports-betting-stats-platform-qrp7y8`
**Commit:** `b52c758`
**Status:** ✅ SHADOW_COLLECTING — ATIVADO

---

## O que foi feito

### 1. Convergência Python/TypeScript (pré-requisito)

Eliminado o WARNING de PYTHON/TS CONVERGENCE antes da ativação.

**Regra aplicada:** Python é a ÚNICA fonte oficial de toda matemática quantitativa.
TypeScript apenas consome, transforma para DTO e formata para apresentação.

| Ação | Resultado |
|------|-----------|
| 9 arquivos modificados (~1.270 linhas removidas do TS) | ✅ |
| Funções quantitativas removidas do TS (Shin, Brier, Log Loss, ECE, etc.) | ✅ |
| Novo endpoint Python `GET /api/odds/comparison/{event_id}/{market}` | ✅ |
| Guardrail `test_convergence_py_ts.py` (10 padrões, FAIL-on-any-finding) | ✅ |
| Contrato `test_contract_py_ts.py` (8 previsões × 7 métricas, 105 testes) | ✅ |
| Meta-teste que verifica que funções removidas NÃO estão exportadas | ✅ |
| Suite completa: **874 passed, 0 failures** | ✅ |

**Documentação gerada:**
- `PYTHON_TS_CONVERGENCE_REPORT.md` — relatório de auditoria completo
- `CONVERGENCE_EXECUTION_SUMMARY.md` — resumo executivo

### 2. Ativação do Shadow Collection

#### O que mudou

| Variável | Antes | Depois | Impacto |
|----------|-------|--------|---------|
| `SHADOW_DRY_RUN` | `true` | `false` | Pipeline persiste seleções oficiais (`is_shadow_selection=true`) |

#### O que NÃO mudou

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

#### Nota técnica

A ativação é uma **mudança de configuração de deploy**, não de código:

- `config.py` já define `SHADOW_DRY_RUN: bool = Field(default=False)`
- `.env.staging.example` já contém `SHADOW_DRY_RUN=false`
- Quando o staging faz deploy sem definir a variável, o default `False` se aplica
- O endpoint `/api/shadow/run` não passa `dry_run` (usa o default `False`)
- O scheduler repassa `settings.SHADOW_DRY_RUN`
- **Nenhuma alteração de código foi necessária**

### 3. Infraestrutura de Observação 72h

Criados 5 documentos para o período de observação operacional intensiva:

| Documento | Conteúdo | Quando |
|-----------|----------|--------|
| `SHADOW_ACTIVATION_LOG.md` | Log da ativação, config, jobs, monitoramento, restrições | Ativação |
| `SHADOW_72H_DAY1.md` | Template — pipeline runs, eventos, previsões, erros | +24h |
| `SHADOW_72H_DAY2.md` | Template — idem + tendências dia-a-dia | +48h |
| `SHADOW_72H_DAY3.md` | Template — consolidado 3 dias | +72h |
| `SHADOW_72H_OPERATIONAL_REVIEW.md` | Template — veredicto final por dimensão | +72h |

#### Conteúdo de cada relatório diário

Cada relatório (DAY1/DAY2/DAY3) contém:

- Pipeline runs executados (com Run ID, timestamp, contagens)
- Eventos processados (buscados, com odds válidas, sem odds, adiados/cancelados)
- Prediction snapshots (criadas, acumuladas, mercados, ligas)
- Shadow selections (feitas, acumuladas, critérios, taxa de seleção)
- Closing captures (capturadas, ausentes, intervalo kickoff → capture)
- Gradings concluídos (graded, won/lost/void, void rate)
- Erros e warnings (pipeline, stale odds, leakage, scheduler, provider, Redis, fail-safe)
- Health (Database, Redis, Scheduler, Shadow Mode)
- Tempo médio de execução por job
- Métricas quantitativas — **marcadas "⚠️ AMOSTRA AINDA NÃO SIGNIFICATIVA"**:
  - Brier Score, Log Loss, ECE
  - CLV Price (média), CLV Probability (média)
  - ROI Teórico, Max Drawdown
- Divergências API ↔ Banco ↔ Shadow Lab

DAY2 e DAY3 incluem colunas de tendência (dia-a-dia e consolidado).

#### Veredicto final — 11 Dimensões

O `SHADOW_72H_OPERATIONAL_REVIEW.md` classifica cada dimensão como PASS / WARNING / FAIL:

| # | Dimensão | O que avalia |
|---|----------|-------------|
| 1 | DATA INGESTION | Fetch de odds, timeouts, stale odds |
| 2 | SCHEDULER | Cron misfires, duplicados, locks |
| 3 | DATABASE | Conexões, queries, integridade |
| 4 | REDIS | Conexões, locks, memória |
| 5 | PIPELINE | Runs completados, tempo, erros, fail-safe |
| 6 | SELECTION | Seleções, `is_shadow_selection`, duplicados |
| 7 | CLOSING | Captura de closing odds, intervalo, cobertura |
| 8 | GRADING | Void rate, grading correto, retroativos |
| 9 | LEAKAGE | Previsões pós-kickoff, dados futuros, append-only |
| 10 | OBSERVABILITY | Logs, pipeline_run_id, métricas, relatórios |
| 11 | SHADOW LAB | Consistência Engine ↔ Supabase ↔ BFF |

**Critérios de decisão:**
- Zero FAIL crítico → `SHADOW_OPERATION_STABLE`
- FAIL crítico mas seguro manter → `SHADOW_OPERATION_DEGRADED`
- FAIL crítico inseguro → `SHADOW_OPERATION_UNSAFE` (desabilitar `SHADOW_ENABLED`)

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

Lock distribuído via Redis (SET NX) para evitar execução concorrente.

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

---

## Restrições em Vigor (72h)

- ❌ Não desenvolver novos modelos
- ❌ Não recalibrar ensemble ou Índice PREDIQ
- ❌ Não adicionar live betting
- ❌ Não criar integrações com contas de bookmakers
- ❌ Não realizar apostas reais
- ❌ Sistema NÃO inventa previsões usando LLM
- ❌ `odds_history` é append-only
- ❌ Nenhuma previsão histórica alterável após início da partida
- ❌ Não corrigir regras quantitativas baseado nos primeiros resultados
- ❌ Não iniciar produção real
- ❌ Não iniciar nova fase de modelagem

---

## Cronograma

| Data | Evento |
|------|--------|
| 2026-08-29 | ✅ Convergência Py/TS concluída |
| 2026-08-29 | ✅ Shadow Collection ativado |
| 2026-08-30 | 📋 Relatório DAY1 (+24h) |
| 2026-08-31 | 📋 Relatório DAY2 (+48h) |
| 2026-09-01 | 📋 Relatório DAY3 (+72h) |
| 2026-09-01 | 📋 Operational Review (veredicto final) |
| 2026-09-01+ | ⏸️ Aguardando revisão humana |

---

## Commits

| Hash | Mensagem |
|------|----------|
| `4227340` | `docs: add convergence execution summary` |
| `b52c758` | `docs: add Shadow Mode activation log and 72h observation templates` |

---

## Artefatos

| Artefato | Link |
|----------|------|
| Dashboard de Ativação | [PREDIQ Shadow Activation](https://claude.ai/code/artifact/1263d448-914e-40ce-80fe-aada0cc627c4) |

---

_Após o período de 72 horas, o sistema aguardará revisão humana._
_Nenhuma próxima fase será iniciada automaticamente._
