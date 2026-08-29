# SHADOW MODE v1 — Runbook de Operação

> Versão: 1.0.0 | Última atualização: 2026-08-29

## 1. Visão Geral

O Shadow Mode é uma operação automatizada de validação prospectiva do pipeline PREDIQ.
Executa o pipeline diariamente, persiste previsões em `shadow_predictions` (append-only),
captura closing odds, faz grading automático após resultado, e calcula métricas agregadas.

**Nenhum dinheiro real é utilizado.** Todas as "apostas" são simuladas.

O objetivo desta operação é medir, com dados prospectivos (nunca retrospectivos), se:

1. O Índice PREDIQ realmente ordena oportunidades por qualidade.
2. Os modelos estão calibrados (ECE < 0.05).
3. O CLV médio é positivo (edge real confirmado pelo mercado).
4. O ROI teórico se sustenta ao longo do tempo.
5. Não há data leakage ou inconsistência nos cálculos.

Este runbook é o documento operacional do dia a dia: quem opera, o que rodar, o que
verificar e como reagir a incidentes. Para o desenho arquitetural completo e o racional
de cada decisão, ver `SHADOW_MODE_SPEC.md`; para o contrato do pipeline PREDIQ, ver
`PIPELINE_CONTRACT.md`.

## 2. Arquitetura

O sistema é composto por três camadas: um backend Python (FastAPI) que roda o pipeline
PREDIQ e expõe a API do Shadow Mode, um banco Postgres/Supabase que armazena as
previsões de forma append-only, e um frontend Next.js que expõe o dashboard SHADOW LAB
para acompanhamento humano.

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
| API Route (BFF) | `apps/web/src/app/api/shadow-lab/route.ts` | Proxy do frontend para o engine, com fallback de leitura direta no Supabase |

### 2.2. Fonte da verdade

O engine Python (FastAPI) é a **fonte da verdade** de todos os cálculos — probabilidades,
edge, EV, PREDIQ Score, CLV e métricas agregadas. O frontend (Next.js) nunca recalcula
nada: ele consome os endpoints do engine e, quando o engine está indisponível, o BFF pode
cair em uma leitura direta do Supabase apenas para exibição — nunca para decisão. Ver
seção 12 (Troubleshooting) sobre divergências entre as duas camadas.

## 3. Jobs Independentes

6 jobs independentes e idempotentes:

### Job A: Ingestão de Odds
- **Endpoint**: `POST /api/shadow/run`
- **Frequência**: A cada 4 horas (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
- **O que faz**: Busca eventos scheduled com odds, calcula fair probs, edges, EVs, persiste snapshots
- **Idempotência**: `ON CONFLICT (prediction_run_id, event_id, market, outcome) DO NOTHING`
- **Fail-safes**: Recusa previsão sem `model_probability`, com fair_prob inválida, odds absurdas, overround extremo, evento muito próximo do kickoff

### Job B: Geração de Previsões (múltiplos snapshots)
- Incluído no Job A (`run_shadow_cycle`)
- Snapshots em T-24h, T-6h, T-1h, T-15min do kickoff
- Cada snapshot tem `prediction_run_id` único

### Job C: Seleção Shadow
- Incluída no Job A (avaliação inline durante o ciclo)
- Critérios: Edge >= 3%, EV >= 2%, PREDIQ Score >= 50, bookmakers >= 2, fair prob válida, pré-kickoff
- Proteção contra duplicatas via partial unique index

### Job D: Captura de Closing Odds
- **Endpoint**: `POST /api/shadow/closing-odds`
- **Frequência**: A cada 15 minutos
- **O que faz**: Captura odds de fechamento para eventos com kickoff em até 2h
- **Write-once**: Só atualiza se `closing_odds IS NULL`
- **Metadados**: Persiste `closing_bookmaker`, `closing_odds_at`, `closing_source`, `closing_is_valid`, `closing_reason`

### Job E: Grading
- **Endpoint**: `POST /api/shadow/grade`
- **Frequência**: A cada hora
- **O que faz**: Busca eventos finalizados, determina resultado, calcula retorno teórico e CLV dual
- **Write-once**: `WHERE status = 'open' AND kickoff_at < now()`
- **CLV dual**: `clv_price = entry_odds/closing_odds - 1`, `clv_probability = model_prob - 1/closing_odds`

### Job F: Relatório Diário
- **Endpoint**: `GET /api/shadow/report/{YYYY-MM-DD}`
- **Frequência**: Diário às 06:00 UTC
- **O que faz**: Gera relatório Markdown com previsões, resultados, métricas, alertas, graduação

### 3.1. Ordem de dependência e por que cada job é independente

Os jobs são idempotentes e podem ser re-executados a qualquer momento sem corromper
dados: cada um lê o estado atual do banco e só escreve onde ainda não há dado (append,
`ON CONFLICT DO NOTHING`, ou write-once condicionado a `IS NULL`/`status='open'`). Isso
significa que:

- Rodar o Job A duas vezes seguidas não duplica previsões.
- Rodar o Job D antes do kickoff não afeta o Job E, que só roda depois do kickoff.
- Um job que falhou no meio pode simplesmente ser re-executado — não é preciso
  reverter nada manualmente.

A ordem lógica natural é A/B/C (ingestão + geração + seleção) → D (closing odds, antes
do kickoff) → E (grading, depois do kickoff) → F (relatório, no dia seguinte), mas isso
é uma consequência do agendamento (seção 3), não uma dependência rígida de execução.

## 4. Endpoints da API

### Operacionais
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/shadow/run` | Executa ciclo shadow |
| POST | `/api/shadow/grade` | Grading de previsões |
| POST | `/api/shadow/closing-odds` | Captura closing odds |

### Consulta
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/shadow/overview` | Dashboard overview |
| GET | `/api/shadow/predictions` | Lista previsões com filtros |
| GET | `/api/shadow/metrics?group_by=X` | Métricas por dimensão |
| GET | `/api/shadow/calibration` | Reliability curve |
| GET | `/api/shadow/equity-curve` | Equity curve simulada |
| GET | `/api/shadow/report/{date}` | Relatório diário |
| GET | `/api/shadow/graduation` | Critérios de graduação |

Todos os endpoints operacionais retornam um `pipeline_run_id` (Job A/B/C) ou identificam
os registros afetados (Job D/E), o que permite auditar exatamente o que cada chamada fez
(ver seção 8 — Rastreabilidade).

## 5. Dashboard (SHADOW LAB)

- **URL**: `/shadow-lab`
- **Badge**: "COLETANDO EVIDÊNCIAS" enquanto em shadow mode
- **Seções**: Overview, Previsões, Performance, Calibração

O dashboard é somente leitura para operação de rotina — não há botões que disparem os
jobs A–F a partir da UI; eles rodam via agendamento (cron/scheduler) ou são disparados
manualmente pelos endpoints operacionais (seção 4), conforme o troubleshooting da seção 12.

## 6. Critérios de Graduação

| # | Critério | Threshold | Como verificar |
|---|----------|-----------|---------------|
| 1 | Eventos resolvidos | >= 200 | `GET /api/shadow/graduation` |
| 2 | Seleções gradeadas | >= 500 | `GET /api/shadow/graduation` |
| 3 | ECE < 0.05 em >= 3 ligas | ECE < 0.05 por liga | `GET /api/shadow/graduation` |
| 4 | CLV médio positivo | > 0 | `GET /api/shadow/graduation` |
| 5 | Sem data leakage | 0 violações | `GET /api/shadow/graduation` |
| 6 | Convergência Py/TS | Verificação manual | Comparar outputs |

**Versão da política**: `graduation-v1.0.0` — thresholds não podem ser alterados sem versionar a política.

## 7. Estados do Sistema

| Estado | Descrição | Critério |
|--------|-----------|----------|
| `DEVELOPMENT` | Em desenvolvimento, sem dados prospectivos | N/A |
| `SHADOW_COLLECTING` | Coletando dados, volume insuficiente | < 200 eventos ou < 500 seleções |
| `SHADOW_VALIDATING` | Volume suficiente, validando métricas | >= 200 eventos E >= 500 seleções, mas ECE ou CLV fora |
| `SHADOW_ELIGIBLE` | Todos os critérios automáticos atendidos | Todos os 5 critérios passando |
| `PRODUCTION_CANDIDATE` | Elegível + convergência manual verificada | Todos os 6 critérios passando |

**Promoção**: Não há promoção automática para produção. `PRODUCTION_CANDIDATE` requer
aprovação humana — nenhum job ou script move o sistema para produção sozinho.

## 8. Rastreabilidade

Cada execução do pipeline gera um `pipeline_run_id` único (formato:
`shadow-run-YYYYMMDD-HHMMSS-xxxxxxxx`). Cada previsão recebe um `prediction_run_id` que
permite múltiplos snapshots temporais do mesmo evento.

Versões rastreadas: `model_version`, `features_version`, `ensemble_version`,
`score_version`, `fair_probability_version`, `pipeline_version`, `selection_version`,
`kelly_version`.

Ao investigar qualquer incidente, comece sempre identificando o `pipeline_run_id`
envolvido — ele é a chave que amarra logs, `shadow_pipeline_runs` e os registros
gerados/afetados em `shadow_predictions`.

## 9. Regras de Imutabilidade

| Campo | Pode ser atualizado? | Quando |
|-------|---------------------|--------|
| `fair_market_probability` | ❌ Nunca | — |
| `model_probability` | ❌ Nunca | — |
| `edge`, `ev`, `prediq_score` | ❌ Nunca | — |
| `closing_odds` | ✅ Uma vez | Antes do kickoff, se `NULL` |
| `result` | ✅ Uma vez | Após kickoff, se `status='open'` |
| `status` | ✅ Uma vez | `'open'` → `'graded'` ou `'void'` |
| `clv`, `clv_price`, `clv_probability` | ✅ Uma vez | Durante grading |

Nenhum job — inclusive re-execuções manuais idempotentes (seção 3.1) — deve jamais
sobrescrever um campo imutável. Se isso for observado, trata-se de um bug crítico: ver
"Data leakage detectado" na seção 12.

## 10. Fail-Safes

O sistema prefere não prever a prever com dados ruins:

- **Sem `model_probability`**: Previsão recusada (NÃO fabrica probabilidade)
- **Fair probability inválida**: Soma != ~1.0, outcomes faltando, prob fora de (0,1)
- **Odds inválidas**: <= 1.0 ou > 100.0
- **Overround extremo**: > 30% (mercado suspeito)
- **Evento muito próximo**: < 15 min do kickoff
- **Odds stale**: > 48h sem atualização

Toda previsão recusada por fail-safe é contabilizada (`skipped_fail_safe`) no run
correspondente em `shadow_pipeline_runs` — não é um erro silencioso, é uma decisão
registrada e auditável (ver seção 13, Monitoramento).

## 11. Restrições de Segurança

- Não criar novos modelos estatísticos
- Não recalibrar o ensemble
- Não recalibrar o PREDIQ Score
- Não alterar dados históricos
- Não expor apostas com dinheiro real
- Não usar linguagem de "garantia" ou "certeza"
- Todas as probabilidades vêm de cálculos matemáticos, nunca de LLM

Estas restrições valem tanto para mudanças no código do Shadow Mode quanto para
qualquer intervenção manual (ex.: correção de dado via SQL) feita durante um incidente.
Uma correção manual que recalcule `edge`/`ev`/`prediq_score` viola a seção 9 e esta seção
ao mesmo tempo — não faça isso; em vez disso, marque o registro como `'void'`.

## 12. Troubleshooting

### Pipeline run falhou (`status='failed'`)
1. Verificar logs: procurar por `pipeline_run_id`
2. Consultar `shadow_pipeline_runs`: `SELECT * FROM shadow_pipeline_runs WHERE status = 'failed' ORDER BY started_at DESC`
3. Verificar campo `errors` (JSONB)
4. Re-executar: `POST /api/shadow/run` (idempotente)

### Closing odds não capturadas
1. Verificar se o job está rodando a cada 15 min
2. Consultar: `SELECT COUNT(*) FROM shadow_predictions WHERE status = 'graded' AND closing_odds IS NULL`
3. Eventos podem ter sido cancelados/adiados

### Data leakage detectado
1. **CRÍTICO**: parar o pipeline imediatamente
2. Consultar: `SELECT * FROM shadow_predictions WHERE generated_at > kickoff_at`
3. Investigar causa raiz
4. Previsões afetadas devem ser marcadas como `'void'`

### Métricas divergentes Python/TypeScript
1. **SEMPRE** confiar na versão Python
2. A rota BFF `/api/shadow-lab` pode ter fallback para Supabase com cálculos diferentes
3. Verificar se o engine Python está respondendo

### Volume de previsões muito baixo (ou zero) em um período
1. Conferir se o Job A (`POST /api/shadow/run`) de fato rodou no horário esperado (00/04/08/12/16/20 UTC) — checar `shadow_pipeline_runs.started_at`
2. Verificar a taxa de `skipped_fail_safe` do run — um pico indica problema na fonte de odds, não no Shadow Mode
3. Confirmar que a ingestão de eventos/odds upstream está saudável (fora do escopo do Shadow Mode, mas é a causa mais comum de volume baixo)

## 13. Monitoramento

### Métricas a observar:
- Taxa de fail-safe (`skipped_fail_safe`) — se muito alta, investigar dados de entrada
- Erros por pipeline run — trend crescente indica problema
- Closing odds capturadas vs. esperadas — coverage rate
- ECE por liga ao longo do tempo — trend de calibração
- CLV médio — deve ser positivo e estável

### Alertas recomendados:
- Pipeline run com `status='failed'`
- \> 50% de previsões rejeitadas por fail-safe em um run
- Data leakage detectado (**CRÍTICO**)
- ECE > 0.10 em qualquer liga com > 50 previsões
- CLV médio negativo por mais de 7 dias consecutivos

### Checklist de operação diária

Rotina sugerida para quem acompanha o Shadow Mode no dia a dia:

1. Conferir `GET /api/shadow/overview` — volume do dia, alertas ativos
2. Conferir o relatório do dia anterior: `GET /api/shadow/report/{YYYY-MM-DD}`
3. Checar `GET /api/shadow/graduation` — evolução em direção aos critérios da seção 6
4. Revisar `shadow_pipeline_runs` das últimas 24h em busca de `status='failed'`
5. Se algum alerta da lista acima estiver ativo, seguir o troubleshooting correspondente na seção 12
