# SHADOW DAY-1 CHECKLIST — Ativação Staging

**Versão:** 1.0.0 | **Data:** 2026-08-29
**Pipeline:** shadow-pipeline-v1.0.0 | **Modelo:** shadow-v1.0.0

---

## Pré-requisitos de Infraestrutura

- [ ] PostgreSQL 15+ operacional com extensões (uuid-ossp, pgcrypto)
- [ ] Redis 7+ operacional (cache + locks distribuídos)
- [ ] Migrations executadas (001-012 inclusive)
- [ ] Tabelas shadow criadas (shadow_predictions, shadow_pipeline_runs)
- [ ] RLS policies aplicadas (migration 012)
- [ ] Seed data carregado (esportes, ligas, mercados, bookmakers)

## Variáveis de Ambiente

- [ ] `ENV=staging`
- [ ] `DATABASE_URL` configurado (postgresql+asyncpg://...)
- [ ] `REDIS_URL` configurado
- [ ] `ENGINE_API_KEY` configurado (não usar valor padrão)
- [ ] `SPORTSGAMEODDS_API_KEY` configurado e válido
- [ ] `SPORTSGAMEODDS_BASE_URL` configurado
- [ ] `SHADOW_ENABLED=true`
- [ ] `SHADOW_DRY_RUN=false` (ou `true` para teste inicial)
- [ ] `CORS_ORIGINS` configurado para o frontend staging

## Verificações de Saúde

- [ ] `GET /health` retorna `status: "ok"` (DB + Redis)
- [ ] `GET /health/db` retorna `ok: true` com latência aceitável
- [ ] `GET /health/redis` retorna `ok: true`
- [ ] `GET /health/shadow` retorna `shadow_enabled: true`
- [ ] `GET /health/scheduler` retorna configuração dos 6 jobs

## Teste Dry Run (Primeiro Ciclo)

- [ ] Configurar `SHADOW_DRY_RUN=true`
- [ ] `POST /api/shadow/run` — executa sem erros
- [ ] Verificar que `selections_made = 0` (dry run não seleciona)
- [ ] Verificar que previsões foram geradas (predictions_created > 0)
- [ ] Verificar logs estruturados (JSON, sem erros não tratados)
- [ ] `POST /api/shadow/closing-odds` — captura closing odds
- [ ] `POST /api/shadow/grade` — grading funciona
- [ ] `GET /api/shadow/overview` — retorna métricas

## Ativação Real (Após Dry Run Bem-Sucedido)

- [ ] Configurar `SHADOW_DRY_RUN=false`
- [ ] `POST /api/shadow/run` — executa com seleções
- [ ] Verificar `selections_made > 0` (seleções ativas)
- [ ] Verificar que `is_shadow_selection = TRUE` para seleções válidas
- [ ] Verificar `shadow_pipeline_runs` registrou o run com status 'completed'
- [ ] Confirmar que `leakage_check = 'passed'`

## Scheduler

- [ ] Jobs configurados (via cron externo ou endpoint manual):
  - [ ] `shadow_daily_cycle` — diário às 09:00 UTC
  - [ ] `shadow_closing_odds` — a cada 15 minutos
  - [ ] `shadow_grading` — a cada 30 minutos
  - [ ] `shadow_metrics` — a cada 1 hora
  - [ ] `shadow_leakage_check` — a cada 6 horas
  - [ ] `shadow_daily_report` — diário às 23:30 UTC
- [ ] Lock distribuído (Redis) impede execução concorrente
- [ ] Cada job tem timeout configurado

## Validação de Dados (Após 24h)

- [ ] Previsões geradas para eventos futuros (não passados)
- [ ] `generated_at < kickoff_at` para todas as previsões
- [ ] Fair probs somam ~1.0 para cada mercado
- [ ] Nenhuma violação de data leakage detectada
- [ ] CLV calculado corretamente para previsões gradeadas
- [ ] Relatório diário gerado sem erros

## Monitoramento Contínuo

- [ ] Logs estruturados sendo coletados
- [ ] Alertas configurados para:
  - [ ] Pipeline run com status 'failed'
  - [ ] Leakage check com resultado 'failed'
  - [ ] Health check com status 'degraded'
- [ ] Dashboard Shadow Lab acessível e mostrando dados
- [ ] Graduation progress visível no dashboard

## Critérios de Graduação (Acompanhamento)

| Critério | Meta | Status |
|----------|------|--------|
| Eventos distintos | ≥ 200 | ⬜ Coletando |
| Seleções gradeadas | ≥ 500 | ⬜ Coletando |
| ECE < 0.05 em ≥ 3 ligas | 3+ ligas | ⬜ Coletando |
| CLV probabilidade positivo | > 0 | ⬜ Coletando |
| Sem data leakage | 0 violações | ⬜ Verificando |
| Convergência Py/TS | Verificação manual | ⬜ Pendente |

---

## Comando de Ativação

```bash
# 1. Configurar variáveis de ambiente
export ENV=staging
export SHADOW_ENABLED=true
export SHADOW_DRY_RUN=false

# 2. Executar migrations
supabase db push

# 3. Iniciar o engine
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4. Verificar saúde
curl http://localhost:8000/health
curl http://localhost:8000/health/shadow

# 5. Primeiro ciclo manual
curl -X POST http://localhost:8000/api/shadow/run \
  -H "X-Engine-Api-Key: $ENGINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event_ids": null}'

# 6. Verificar resultado
curl http://localhost:8000/api/shadow/overview \
  -H "X-Engine-Api-Key: $ENGINE_API_KEY"
```

---

*Checklist versão 1.0.0 | Shadow Mode v1 | graduation-v1.0.0*
