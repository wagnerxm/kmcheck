# SHADOW DAY-1 GAP ANALYSIS

**Data:** 2026-08-29 | **Branch:** `claude/sports-betting-stats-platform-qrp7y8`
**Baseline:** Commit `5d31b8d` (Shadow Mode v1 Hardening — 28 PASS, 3 WARNING, 0 FAIL)

---

## Legenda de Status

| Status | Significado |
|--------|------------|
| ✅ DONE | Implementado e testado na fase de hardening |
| 🔧 PARTIAL | Parcialmente implementado — requer ajustes |
| 🆕 NEW | Funcionalidade nova — não existe no codebase |
| ⚠️ WARNING | Identificado como WARNING na auditoria anterior |

---

## Checklist por Item da Especificação Day-1

| # | Item | Estado Atual | Risco | Ação Necessária | Status |
|---|------|-------------|-------|-----------------|--------|
| 1 | Auditoria do estado atual → GAP_ANALYSIS.md | 🆕 NEW | Baixo | Gerar este documento | ✅ ESTE DOC |
| 2 | Staging environment (.env.example, separação dev/staging/prod) | 🔧 PARTIAL | Médio | `.env.example` existe mas sem separação staging/prod. Adicionar `.env.staging.example`, `ENV` com validação, config por ambiente | PENDENTE |
| 3 | Database migrations versionadas | 🔧 PARTIAL | Alto | Schema existe em `schema.py` (DDL inline). Supabase migrations existem para tabelas core mas NÃO para shadow. Criar migration SQL formal `012_shadow_mode.sql` | PENDENTE |
| 4 | Pipeline run tracking (duration, markets, odds processed) | 🔧 PARTIAL | Baixo | `shadow_pipeline_runs` já existe com versões, contadores, config_snapshot. Faltam: `duration_seconds`, `markets_processed`, `odds_sources_count` | PENDENTE |
| 5 | SportsGameOdds integração real (retry, backoff, timeout, stale) | ✅ DONE (Node workers) | Médio | Node worker já tem provider completo com retry/backoff/timeout. Engine shadow lê do DB (`odds` table), não da API diretamente. Validar que o fluxo Node→DB→Engine funciona. Adicionar detecção de stale no engine | PENDENTE |
| 6 | Scheduler (6 jobs idempotentes com locks, retries, timeouts) | ⚠️ WARNING | Alto | BullMQ existe para odds no Node. Celery existe para ML no Python. Shadow pipeline NÃO tem scheduler — endpoints `/run`, `/grade`, `/closing-odds` existem mas sem cron. Implementar APScheduler ou endpoint-driven cron | PENDENTE |
| 7 | Selection policy (stale odds check, leakage check adicionais) | 🔧 PARTIAL | Médio | 6 critérios implementados (edge≥3%, EV≥2%, score≥50, bookmakers≥2, fair_prob válida, pré-kickoff). Faltam: verificação de stale odds na seleção, leakage check antes de selecionar | PENDENTE |
| 8 | Snapshot de odds (múltiplos snapshots por previsão) | ✅ DONE | Baixo | `snapshot_odds` JSONB já persiste odds do momento. `odds_history` (append-only, partitioned) já captura histórico. OK |  |
| 9 | Fair probability (Shin method, versão) | ✅ DONE | — | `fair_probability_method` e `fair_probability_version` persistidos. Shin method implementado em `fair_probability.py`. OK | ✅ |
| 10 | Model predictions (consensus/ensemble) | ✅ DONE | — | Lê de `consensus_predictions` com fallback para `model_predictions`. `model_probability`, `ensemble_weights`, `ensemble_probability`, `individual_model_probs` persistidos. OK | ✅ |
| 11 | Edge, EV, PREDIQ Score | ✅ DONE | — | `edge`, `ev`, `prediq_score`, `score_components` JSONB persistidos. Versões rastreadas. OK | ✅ |
| 12 | Kelly staking | ✅ DONE | — | `kelly_fraction`, `kelly_full`, `kelly_capped`, `kelly_version` persistidos. Quarter-Kelly (κ=0.25), cap 5%. OK | ✅ |
| 13 | Closing line (5 campos formais) | ✅ DONE | — | `closing_odds`, `closing_odds_at`, `closing_bookmaker`, `closing_source`, `closing_is_valid`, `closing_reason` — 6 campos. OK | ✅ |
| 14 | **closing_fair_probability** (NOVO campo) | 🆕 NEW | Alto | CLV probability atualmente usa `model_prob - 1/closing_odds`. Spec Day-1 exige `closing_fair_probability` calculada via Shin no fechamento. Requer: novo campo na tabela, captura da fair prob no closing, recálculo do CLV | PENDENTE |
| 15 | **CLV probability = closing_fair_prob - entry_fair_prob** | 🆕 NEW | Alto | Fórmula atual: `model_prob - 1/closing_odds`. Nova fórmula: `closing_fair_probability - fair_market_probability`. Necessário após item 14 | PENDENTE |
| 16 | **grading_source, grading_version** (NOVOS campos) | 🆕 NEW | Baixo | Grading existe mas sem rastreabilidade de fonte/versão. Adicionar 2 campos na tabela + preencher no grading | PENDENTE |
| 17 | Data leakage prevention | ✅ DONE | — | `validate_no_leakage()` com 3 verificações, `leakage_check` no pipeline run, `_validate_event_timing()`. OK | ✅ |
| 18 | Timezone (UTC everywhere) | ✅ DONE | — | `datetime.now(timezone.utc)`, todas as colunas `TIMESTAMPTZ`. OK | ✅ |
| 19 | Métricas (Brier, Log Loss, ECE, CLV dual, ROI, drawdown) | ✅ DONE | — | `aggregations.py` com 14 dimensões. Brier, Log Loss, ECE, CLV dual, ROI, max drawdown. OK | ✅ |
| 20 | Agregações expandidas (+ week dimension) | 🔧 PARTIAL | Baixo | 14 dimensões implementadas: league, market, model, period, odds_range, edge_range, ev_range, prediq_range, country, outcome, bookmaker, ensemble_version. Falta: `week` | PENDENTE |
| 21 | Shadow Lab dashboard (detalhe expandido) | 🔧 PARTIAL | Baixo | Dashboard existe com badge "COLETANDO EVIDÊNCIAS", graduation progress. Verificar se precisa de ajustes adicionais para novos campos | PENDENTE |
| 22 | **Health endpoints expandidos** (/health/db, /health/odds-provider, /health/scheduler, /health/shadow) | 🔧 PARTIAL | Médio | `/health` existe com check de DB + Redis. Faltam: `/health/db` (dedicado), `/health/odds-provider`, `/health/scheduler`, `/health/shadow` | PENDENTE |
| 23 | Observabilidade (contadores, logs estruturados) | 🔧 PARTIAL | Baixo | Logs estruturados (JSON) existem via `core/logging.py`. `errors`/`warnings` JSONB no pipeline run. Faltam: contadores Prometheus-style, métricas de latência | PENDENTE |
| 24 | **Dry run mode** (SHADOW_DRY_RUN=true) | 🆕 NEW | Médio | Não existe. Pipeline executa e persiste sempre. Implementar flag que executa pipeline completo mas não persiste seleções oficiais | PENDENTE |
| 25 | Smoke test com dados reais (3-5 eventos) | ⚠️ WARNING | Médio | Não existe. Testes usam dados sintéticos. Criar smoke test que valida com eventos reais do DB | PENDENTE |
| 26 | Integration test com DB real | ⚠️ WARNING | Alto | Não existe `conftest.py`. Nenhum teste usa DB real. Criar fixtures de DB + integration tests | PENDENTE |
| 27 | E2E test (event→odds→prediction→selection→closing→grading→CLV→metrics) | ⚠️ WARNING | Alto | `test_pipeline_e2e.py` existe para o pipeline principal mas NÃO para shadow. Criar lifecycle test completo | PENDENTE |
| 28 | Failure tests (16 cenários) | 🔧 PARTIAL | Médio | `test_shadow.py` tem 110 testes incluindo fail-safe, validation, idempotency. Verificar cobertura dos 16 cenários específicos | PENDENTE |
| 29 | Security (RLS, rate limiting, input validation) | 🔧 PARTIAL | Médio | RLS existe para tabelas core (migration 009). API key auth via `X-Engine-Api-Key`. Shadow tables NÃO têm RLS. Sem rate limiting formal | PENDENTE |
| 30 | Daily report (automático) | ✅ DONE | — | `report.py` + endpoint `/shadow/report/{date}` + template. OK | ✅ |
| 31 | Graduation criteria (policy versioned) | ✅ DONE | — | `graduation-v1.0.0`, 6 critérios, `/shadow/graduation` endpoint. OK | ✅ |
| 32 | **SHADOW_DAY1_CHECKLIST.md** | 🆕 NEW | Baixo | Documento de checklist operacional para ativação. Gerar | PENDENTE |
| 33 | **SHADOW_DAY1_READINESS.md** (GO/NO-GO) | 🆕 NEW | Baixo | Relatório final de prontidão. Gerar após implementações | PENDENTE |
| 34 | Test suite 0 failures | ✅ DONE | — | 648 passed, 0 failures na fase hardening. Manter após alterações | ✅ |
| 35 | Documentação final atualizada | 🔧 PARTIAL | Baixo | 4 docs existem. Atualizar com novos campos/funcionalidades | PENDENTE |
| 36 | Commit final | 🆕 NEW | — | `feat(shadow): prepare PREDIQ Shadow Mode v1 for Day-1 staging activation` | PENDENTE |
| 37 | Stop condition (GO/NO-GO + comando de ativação) | 🆕 NEW | — | Entregar relatório + parar | PENDENTE |

---

## Resumo de Gaps por Prioridade

### 🔴 ALTA PRIORIDADE (integridade dos dados + correção temporal)

| Gap | Impacto | Complexidade |
|-----|---------|-------------|
| **#14 closing_fair_probability** | CLV probability incorreto sem fair prob de fechamento | Alta — novo campo, cálculo na captura de closing, recálculo CLV |
| **#15 CLV probability formula** | Métrica principal de validação errada | Média — depende de #14, alterar fórmula + testes |
| **#3 Database migration formal** | Shadow tables não estão no fluxo de migrations | Média — criar `012_shadow_mode.sql` com todo o DDL |
| **#6 Scheduler** | Sem automação, pipeline depende de chamada manual | Alta — implementar 6 jobs com locks/retries |

### 🟡 MÉDIA PRIORIDADE (operação automatizada + observabilidade)

| Gap | Impacto | Complexidade |
|-----|---------|-------------|
| **#2 Staging environment** | Sem separação dev/staging/prod | Baixa — config files + validação de ENV |
| **#5 Stale odds detection** | Engine pode usar odds desatualizadas | Baixa — já tem `STALE_ODDS_HOURS`, falta check na seleção |
| **#16 grading_source/version** | Grading sem rastreabilidade | Baixa — 2 campos + preenchimento |
| **#22 Health endpoints** | Monitoramento incompleto | Média — 4 endpoints adicionais |
| **#24 Dry run mode** | Não consegue testar pipeline sem persistir | Média — flag + condicional em seleção |
| **#29 Security** | Shadow tables sem RLS | Média — policies SQL |

### 🟢 BAIXA PRIORIDADE (validação + documentação)

| Gap | Impacto | Complexidade |
|-----|---------|-------------|
| **#4 Pipeline run fields** | Métricas incompletas no run | Baixa — 3 campos |
| **#7 Selection criteria** | Critérios quase completos | Baixa — 2 checks adicionais |
| **#20 Week aggregation** | Dimensão de análise faltante | Baixa — 1 dimensão |
| **#23 Observability counters** | Métricas de performance faltantes | Baixa — contadores |
| **#25-28 Tests** | Cobertura de testes incompleta | Média — testes novos |
| **#32-33 Docs** | Documentos finais | Baixa — gerar ao final |

---

## WARNINGs Existentes (da auditoria anterior)

| # Audit | Warning | Resolução nesta fase |
|---------|---------|---------------------|
| #15 | Scheduler — endpoints prontos, scheduler é config de infra | Item #6: implementar scheduler real |
| #23 | Failure tests — unitários completos, integração com DB pendente | Items #26-28: integration + e2e tests |
| #24 | E2E test — lifecycle testado em partes, e2e com DB pendente | Item #27: full lifecycle test |

---

## Infraestrutura Existente (não modificar)

| Componente | Estado | Localização |
|-----------|--------|-------------|
| Node.js odds worker (BullMQ) | ✅ Funcional | `services/workers/node/` — SportsGameOdds provider com retry/backoff |
| Celery Python worker | ✅ Funcional | `services/workers/python/` — treino de modelos |
| Docker Compose | ✅ Funcional | `docker/docker-compose.yml` — 5 services |
| Supabase migrations (core) | ✅ 11 migrations | `supabase/migrations/001-011` |
| RLS policies (core tables) | ✅ Funcional | `supabase/migrations/009_rls_policies.sql` |
| API key auth | ✅ Funcional | `core/security.py` — `X-Engine-Api-Key` via HMAC compare |
| Health check básico | ✅ Funcional | `api/health.py` — DB + Redis check |
| Structured logging | ✅ Funcional | `core/logging.py` — JSON formatter |
| Shadow engine | ✅ 1323 linhas | `shadow/engine.py` — ciclo completo |
| Shadow schema | ✅ 268 linhas | `shadow/schema.py` — DDL inline |
| Shadow aggregations | ✅ 732 linhas | `shadow/aggregations.py` — 14 dimensões |
| Shadow API | ✅ 403 linhas | `api/shadow.py` — 9 endpoints |
| Shadow tests | ✅ 110 testes | `tests/test_shadow.py` — 648 tests total |
| Shadow Lab (frontend) | ✅ Funcional | `apps/web/shadow-lab/` — dashboard |

---

## Plano de Execução

**Fase 1 — Integridade de dados (itens 14, 15, 16, 3)**
1. Adicionar `closing_fair_probability`, `entry_fair_probability`, `grading_source`, `grading_version` no schema
2. Implementar captura de fair probability no closing
3. Atualizar fórmula CLV probability
4. Criar migration formal `012_shadow_mode.sql`

**Fase 2 — Operação automatizada (itens 2, 4, 5, 6, 7, 24)**
1. Config de staging environment
2. Expandir pipeline_run tracking
3. Adicionar stale odds check + leakage check na seleção
4. Implementar scheduler com 6 jobs
5. Implementar dry run mode

**Fase 3 — Observabilidade + segurança (itens 22, 23, 29)**
1. Health endpoints expandidos
2. Contadores de observabilidade
3. RLS para shadow tables + rate limiting

**Fase 4 — Testes (itens 25, 26, 27, 28)**
1. Smoke test com dados reais
2. Integration test com DB
3. E2E lifecycle test
4. Failure tests expandidos

**Fase 5 — Finalização (itens 20, 21, 32, 33, 34, 35, 36, 37)**
1. Week aggregation
2. Dashboard ajustes
3. SHADOW_DAY1_CHECKLIST.md
4. SHADOW_DAY1_READINESS.md
5. Run full test suite
6. Update docs
7. Commit + push
8. GO/NO-GO report

---

*Gerado automaticamente. Baseline: commit 5d31b8d, 28 PASS / 3 WARNING / 0 FAIL.*
