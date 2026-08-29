# Relatório Shadow Mode — {DATA}

Pipeline: `shadow-pipeline-v1.0.0` | Modelo: `shadow-v1.0.0` | Edge threshold: 2%
Gerado em: {TIMESTAMP_UTC}

## 1. Previsões Geradas

- **Total**: {TOTAL_PREVISOES} previsões
- **Eventos**: {EVENTOS_DISTINTOS}
- **Ligas**: {LIGAS_DISTINTAS}
- **Edge médio**: {EDGE_MEDIO}%
- **EV médio**: {EV_MEDIO}%
- **PREDIQ Score médio**: {SCORE_MEDIO}

## 2. Oportunidades por Liga

| Liga | Qtd | Edge Médio | Odds Média | Score Médio |
|------|-----|-----------|-----------|------------|
| {LIGA_1} | {QTD} | {EDGE}% | {ODDS} | {SCORE} |

## 2.5. Shadow Selections

- **Total seleções**: {TOTAL_SELECOES}
- **Eventos**: {SEL_EVENTOS}
- **Ligas**: {SEL_LIGAS}
- **Edge médio**: {SEL_EDGE}%
- **EV médio**: {SEL_EV}%
- **PREDIQ Score médio**: {SEL_SCORE}

> Shadow selections são previsões que atenderam TODOS os critérios:
> Edge ≥ 3%, EV ≥ 2%, PREDIQ Score ≥ 50, bookmakers ≥ 2, fair_prob válida, pré-kickoff.

## 3. Resultados Finalizados

- **Gradeados**: {GRADEADOS} ({WON}W / {LOST}L / {VOID}V)
- **Hit rate**: {HIT_RATE}%
- **Retorno teórico**: {RETORNO} unidades
- **CLV preço**: {CLV_PRICE}%
- **CLV probabilidade**: {CLV_PROB}%

## 4. Métricas Acumuladas (all-time)

### Calibração (todas as previsões)
- **Previsões resolvidas**: {RESOLVIDAS}
- **Brier Score**: {BRIER}
- **Log Loss**: {LOG_LOSS}

### Performance (seleções shadow apenas)
- **Hit rate seleções**: {SEL_HIT_RATE}%
- **ROI seleções**: {SEL_ROI}%
- **CLV preço médio**: {CLV_PRICE_MEAN}%
- **CLV probabilidade médio**: {CLV_PROB_MEAN}%
- **Max drawdown**: {MAX_DD} unidades

## 5. Alertas de Inconsistência

- {ALERTA_1}
- {ALERTA_2}

> Tipos de alerta monitorados:
> - CRÍTICO: Previsões geradas após kickoff (data leakage)
> - ALERTA: Anomalias temporais (generated_at > graded_at)
> - AVISO: Edge extremo > 30% (possível erro de modelo)

## 6. Critérios de Graduação

| Critério | Status | Valor |
|----------|--------|-------|
| Eventos >= 200 | {STATUS} | {VALOR}/200 |
| Seleções >= 500 | {STATUS} | {VALOR}/500 |
| ECE < 0.05 em >= 3 ligas | {STATUS} | {VALOR} ligas |
| CLV positivo | {STATUS} | {VALOR}% |
| Sem data leakage | {STATUS} | {VALOR} violações |
| Convergência Py/TS | PENDENTE | verificação manual |

**{CRITERIOS_STATUS}**

---

*Relatório gerado automaticamente pelo Shadow Mode v1.*
*Versão do template: 1.0.0 | Política de graduação: graduation-v1.0.0*
