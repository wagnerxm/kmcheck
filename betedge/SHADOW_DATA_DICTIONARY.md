# SHADOW_DATA_DICTIONARY.md — Dicionário de Dados do Shadow Mode v1 (hardened)

> **Versão:** 1.0.0
> **Data:** 2026-08-29
> **Escopo:** `shadow_pipeline_runs` e `shadow_predictions`
> **Fonte da verdade (DDL):** `services/engine/app/shadow/schema.py`
> **Especificação funcional:** `SHADOW_MODE_SPEC.md`, `PIPELINE_CONTRACT.md`

---

## 1. Visão Geral

O Shadow Mode v1 "hardened" persiste dados em duas tabelas complementares:

- **`shadow_pipeline_runs`** — uma linha por **execução** do pipeline shadow. Guarda o
  "estado do mundo" no momento do run (versão de cada estágio, config, fontes de dados,
  contadores e diagnósticos), permitindo auditar e reproduzir qualquer previsão a partir
  do seu `pipeline_run_id`.
- **`shadow_predictions`** — uma linha por **snapshot de previsão** gerado. Diferente de
  versões anteriores do shadow mode (onde a chave de unicidade era
  `(event_id, market, outcome, model_version)`), aqui a mesma combinação
  `(event_id, market, outcome)` **pode se repetir entre runs diferentes** — cada execução
  do pipeline registra um snapshot temporal (odds mudam, features mudam, o modelo pode ser
  reavaliado). A unicidade passa a ser por `prediction_run_id`, não mais por
  `model_version` isolado.

Um conceito novo nesta versão é a **separação entre "previsão" e "seleção shadow"**: gerar
uma previsão (linha em `shadow_predictions`) não significa que ela é uma aposta simulada
oficial do shadow mode. Apenas previsões marcadas `is_shadow_selection = TRUE` — no máximo
uma por `(event_id, market, outcome)`, garantido por índice único parcial — entram nas
métricas de performance (hit rate, ROI, CLV) usadas para avaliar os critérios de graduação.

Ambas as tabelas são **append-only**: nenhuma linha é apagada; atualizações são restritas
aos campos write-once descritos na §5.

---

## 2. Tabela `shadow_pipeline_runs`

Uma linha por execução (ciclo) do pipeline shadow — seja um run agendado diário, seja um
disparo manual via `POST /api/shadow/run`.

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `id` | `UUID` | PK, `DEFAULT gen_random_uuid()` | Identificador interno da linha (chave técnica, sem significado de negócio). |
| `pipeline_run_id` | `TEXT` | `NOT NULL`, `UNIQUE` | Identificador único e legível da execução. Formato: `shadow-run-YYYYMMDD-HHMMSS-xxxxxxxx` (data/hora UTC do início + sufixo aleatório para evitar colisão em runs concorrentes). É a chave lógica que amarra todas as previsões geradas neste ciclo (`shadow_predictions.pipeline_run_id`). |
| `started_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Instante de início da execução. |
| `finished_at` | `TIMESTAMPTZ` | — | Instante de término da execução. `NULL` enquanto o run está em andamento (`status = 'running'`). |
| `status` | `TEXT` | `NOT NULL`, `DEFAULT 'running'`, `CHECK IN ('running','completed','failed','partial')` | Estado do ciclo — ver §6 "Estados do Sistema". |
| `pipeline_version` | `TEXT` | `NOT NULL` | Versão do pipeline shadow como um todo (orquestração ingestão → pipeline → persistência). Ver `PIPELINE_CONTRACT.md`. |
| `model_version` | `TEXT` | `NOT NULL` | Versão do(s) modelo(s) estatístico(s) usados neste run (ex.: `poisson_1.2.0`). |
| `features_version` | `TEXT` | `NOT NULL` | Versão do feature set (conjunto de variáveis de entrada dos modelos) usado neste run. |
| `ensemble_version` | `TEXT` | `NOT NULL` | Versão da lógica de blend/ensemble entre os modelos individuais. |
| `score_version` | `TEXT` | `NOT NULL` | Versão do cálculo do Índice PREDIQ Score (pesos e componentes). |
| `fair_probability_version` | `TEXT` | `NOT NULL` | Versão do módulo de remoção de vig / cálculo de probabilidade justa (Shin, power, multiplicative). |
| `selection_version` | `TEXT` | opcional | Versão da estratégia de seleção shadow usada neste run (pode ser `NULL` em runs que apenas geram previsões, sem selecionar). |
| `events_processed` | `INT` | `DEFAULT 0` | Quantidade de eventos esportivos processados (candidatos avaliados) neste run. |
| `predictions_created` | `INT` | `DEFAULT 0` | Quantidade de linhas inseridas em `shadow_predictions` neste run. |
| `selections_made` | `INT` | `DEFAULT 0` | Quantidade de previsões marcadas como seleção shadow oficial (`is_shadow_selection = TRUE`) neste run. |
| `errors` | `JSONB` | `DEFAULT '[]'` | Lista de erros ocorridos durante o run (um objeto por erro: mensagem, estágio, evento afetado quando aplicável). Run com `errors` não vazio mas que concluiu parcialmente tende a `status = 'partial'`. |
| `warnings` | `JSONB` | `DEFAULT '[]'` | Lista de avisos não bloqueantes (ex.: evento sem odds suficientes para Shin, fallback para multiplicative). |
| `data_sources` | `JSONB` | — | Fontes de dados consultadas neste run (ex.: provedor de odds, timestamp da última sincronização de cada fonte) — usado para auditoria de proveniência. |
| `leakage_check` | `TEXT` | `CHECK IN ('passed','failed','skipped')` | Resultado da verificação anti-data-leakage executada ao fim do run (ex.: nenhuma previsão com `generated_at > kickoff_at`). `skipped` indica que a verificação não rodou neste ciclo (não deve ocorrer em produção). |
| `config_snapshot` | `JSONB` | — | Snapshot da configuração operacional vigente no momento do run: thresholds de edge/EV para seleção, fração de Kelly (κ), janela de captura de closing odds, etc. Permite reproduzir exatamente o comportamento do run mesmo que a config mude depois. |

### Índices — `shadow_pipeline_runs`

| Índice | Definição | Propósito |
|---|---|---|
| `idx_spr_pipeline_run_id` | `(pipeline_run_id)` | Lookup pelo identificador lógico do run (join com `shadow_predictions.pipeline_run_id`). |
| `idx_spr_status` | `(status)` | Filtrar runs em andamento / com falha (monitoramento operacional). |
| `idx_spr_started_at` | `(started_at)` | Ordenação cronológica e consultas por período (relatório diário, dashboards). |

(A `UNIQUE` em `pipeline_run_id`, declarada na própria coluna, já cria implicitamente um
índice único — não há necessidade de índice adicional para essa restrição.)

---

## 3. Tabela `shadow_predictions`

Uma linha por snapshot de previsão gerado pelo pipeline. Tabela append-only, com um
conjunto restrito de campos que podem ser preenchidos depois da inserção (write-once —
ver §5).

### 3.1. Identidade e mercado

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `id` | `UUID` | PK, `DEFAULT gen_random_uuid()` | Identificador interno da linha. |
| `event_id` | `UUID` | `NOT NULL` | ID do evento esportivo (referência lógica a `events.id`; sem FK física — ver §7). |
| `league` | `TEXT` | `NOT NULL` | Nome da liga/campeonato do evento (ex.: "Brasileirão Série A", "Premier League"). Desnormalizado para permitir agregações sem JOIN. |
| `sport` | `TEXT` | `NOT NULL`, `DEFAULT 'football'` | Código do esporte (hoje, apenas futebol é suportado no shadow mode). |
| `market` | `TEXT` | `NOT NULL` | Código do mercado de apostas: `1x2`, `ou` (over/under), `btts` (both teams to score), `double_chance`, `dnb` (draw no bet), etc. |
| `outcome` | `TEXT` | `NOT NULL` | Código do resultado previsto dentro do mercado: `home`/`draw`/`away` (1x2), `over`/`under` (ou), `yes`/`no` (btts), `home_or_draw`/`home_or_away`/`away_or_draw` (double_chance), `home`/`away` (dnb). |

### 3.2. Rastreabilidade do pipeline (novo nesta versão)

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `pipeline_run_id` | `TEXT` | `NOT NULL` | ID do ciclo do pipeline (`shadow_pipeline_runs.pipeline_run_id`) que gerou esta previsão. Um pipeline_run pode conter mais de um `prediction_run`. |
| `prediction_run_id` | `TEXT` | `NOT NULL` | ID único do **snapshot de previsão** dentro do run. Permite múltiplos snapshots temporais para o mesmo evento/mercado/outcome (ex.: recálculo periódico das odds antes do kickoff). É a chave de unicidade real da tabela (junto com event/market/outcome — ver §4). |
| `as_of` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Timestamp de referência do snapshot — "os dados refletem o estado do mercado/modelo neste instante". Usado nas checagens anti-leakage (nada em `as_of` pode depender de dados posteriores a este instante). |
| `snapshot_sequence` | `INT` | `NOT NULL`, `DEFAULT 1` | Posição do snapshot na sequência de recomputações para o mesmo `(event_id, market, outcome)` dentro do mesmo `prediction_run_id`/ciclo (1 = primeiro, 2 = segundo, …). |

### 3.3. Tempo do evento e odds de abertura

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `generated_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Momento exato em que a previsão foi gerada pelo pipeline. Campo-chave para anti-data-leakage — nunca deve ser posterior a `kickoff_at`. **Write-never** (nunca alterado após o INSERT). |
| `kickoff_at` | `TIMESTAMPTZ` | `NOT NULL` | Horário agendado de início do evento (kickoff). |
| `bookmaker` | `TEXT` | `NOT NULL` | Casa de apostas que ofereceu a melhor odd disponível no momento da geração (`best_odds`). |
| `best_odds` | `NUMERIC(8,4)` | `NOT NULL` | Melhor odd decimal disponível no momento da geração — a odd de "entrada" usada nos cálculos de valor (edge, EV, Kelly) e no grading (retorno teórico). |

### 3.4. Closing line

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `closing_odds` | `NUMERIC(8,4)` | opcional, write-once | Odd de fechamento (melhor odd disponível pouco antes do kickoff), capturada por `capture_closing_odds()`. `NULL` até a captura ocorrer; nunca sobrescrita depois de preenchida. |
| `closing_odds_at` | `TIMESTAMPTZ` | opcional, write-once | Instante exato em que a closing odd foi capturada. |
| `closing_bookmaker` | `TEXT` | opcional, write-once | Casa de apostas de onde veio a closing odd. |
| `closing_source` | `TEXT` | opcional, write-once | Fonte/método da captura (ex.: `odds_table_best` = melhor odd não suspensa na tabela `odds` no momento da captura). |
| `closing_is_valid` | `BOOLEAN` | opcional, write-once | Se a closing odd é considerada confiável para cálculo de CLV. `FALSE` quando, por exemplo, o mercado estava suspenso ou ilíquido perto do kickoff, tornando a "closing line" pouco representativa. |
| `closing_reason` | `TEXT` | opcional, write-once | Texto explicando por que `closing_is_valid = FALSE` (motivo da invalidação), quando aplicável. `NULL` quando `closing_is_valid` é `TRUE` ou ainda não avaliado. |

### 3.5. Probabilidades

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `fair_market_probability` | `NUMERIC(8,6)` | `NOT NULL`, write-never | Probabilidade justa (sem overround/vig) implícita nas odds do mercado no momento da geração, calculada pelo método indicado em `fair_probability_method`. |
| `model_probability` | `NUMERIC(8,6)` | `NOT NULL`, write-never | Probabilidade estimada pelo ensemble de modelos estatísticos para este outcome. |
| `fair_probability_method` | `TEXT` | `NOT NULL`, `DEFAULT 'shin'` | Método usado para remover o overround das odds e obter `fair_market_probability`: `shin` (padrão, ≥ 3 outcomes), `power`, ou `multiplicative` (fallback para mercados com menos de 3 outcomes ou quando Shin não converge). |
| `fair_probability_version` | `TEXT` | `NOT NULL` | Versão do algoritmo/módulo de fair probability usado. |

### 3.6. Métricas de valor

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `edge` | `NUMERIC(8,6)` | `NOT NULL`, write-never | `edge = model_probability − fair_market_probability`. Mede o quanto o modelo diverge do consenso do mercado (positivo = modelo mais otimista que o mercado quanto a este outcome). |
| `ev` | `NUMERIC(8,6)` | `NOT NULL`, write-never | Expected Value: `ev = model_probability × best_odds − 1`. Valor esperado por unidade apostada, segundo a probabilidade do modelo e a odd de entrada. |
| `prediq_score` | `NUMERIC(6,2)` | `NOT NULL`, write-never | Índice PREDIQ — score composto de 0 a 100 que resume a qualidade da oportunidade (combina edge, EV, confiança do modelo, variância do ensemble, liquidez, entre outros componentes — ver `score_components`). |
| `kelly_fraction` | `NUMERIC(8,6)` | `NOT NULL`, write-never | Fração de banca recomendada, já fracionada (Kelly fracionário, padrão quarter-Kelly, κ = 0.25). É o valor efetivamente usado/exibido como sugestão de stake. |

### 3.7. Kelly — diagnóstico

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `kelly_full` | `NUMERIC(8,6)` | opcional | Kelly pleno (`f*`), **apenas para diagnóstico** — nunca usado como sugestão de stake real. Fórmula: com `b = best_odds − 1` e `q = 1 − model_probability`, `f* = (b·model_probability − q) / b`. Pode ser negativo (indica que o modelo não vê valor na aposta). |
| `kelly_capped` | `NUMERIC(8,6)` | opcional | Kelly fracionário (`κ·f*`) já com o cap superior aplicado (nunca excede κ da banca, mesmo com `f*` muito alto). Distinto de `kelly_fraction` apenas quando a estratégia de cap difere da fração-padrão persistida em `kelly_fraction`. |
| `kelly_version` | `TEXT` | `NOT NULL`, `DEFAULT '1.0.0'` | Versão do módulo de cálculo de Kelly. |

### 3.8. Ensemble

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `ensemble_weights` | `JSONB` | opcional | Pesos atribuídos a cada modelo individual no blend que gerou `model_probability` (ex.: `{"poisson": 0.4, "dixon_coles": 0.35, "elo": 0.25}`). |
| `ensemble_probability` | `NUMERIC(8,6)` | opcional | Probabilidade bruta resultante do blend do ensemble, **antes** de qualquer ajuste posterior (ex.: calibração, shrinkage) que possa ter sido aplicado para chegar a `model_probability`. Quando não há ajuste pós-ensemble, `ensemble_probability = model_probability`. |
| `individual_model_probs` | `JSONB` | opcional | Probabilidades individuais estimadas por cada modelo do ensemble antes do blend (ex.: `{"poisson": 0.52, "dixon_coles": 0.55, "elo": 0.49}`). Usado para auditoria e para calcular `ensemble_variance`. |
| `ensemble_variance` | `NUMERIC(8,6)` | opcional | Variância entre as probabilidades individuais dos modelos do ensemble (`individual_model_probs`). Alta variância indica desacordo entre modelos — sinal de menor confiança, tipicamente penalizado no PREDIQ Score. |

### 3.9. PREDIQ Score — componentes

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `score_components` | `JSONB` | opcional | Decomposição do `prediq_score` nos seus componentes individuais e respectivos pesos (ex.: `{"edge_score": 22.1, "ev_score": 18.4, "confidence_score": 15.0, ...}`), permitindo auditar como o score final foi composto sem recalcular do zero. |

### 3.10. Versionamento (redundante com `shadow_pipeline_runs`, persistido na própria linha)

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `model_version` | `TEXT` | `NOT NULL` | Versão do modelo usado para gerar `model_probability` nesta previsão. |
| `features_version` | `TEXT` | `NOT NULL` | Versão do feature set usado. |
| `ensemble_version` | `TEXT` | `NOT NULL` | Versão do ensemble de modelos. |
| `score_version` | `TEXT` | `NOT NULL` | Versão do cálculo do PREDIQ Score. |
| `pipeline_version` | `TEXT` | `NOT NULL` | Versão do pipeline shadow que gerou esta previsão. |

> Estes cinco campos duplicam informação também presente em `shadow_pipeline_runs` para o
> mesmo `pipeline_run_id`. A duplicação é intencional: permite auditar/filtrar uma previsão
> individualmente sem JOIN, mesmo que o registro do run tenha falhado ou seja alterado no
> futuro (ex.: adição de novos campos de config). Em caso de divergência, o valor gravado
> na própria previsão é a fonte de verdade para aquela previsão específica.

### 3.11. Seleção shadow

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `is_shadow_selection` | `BOOLEAN` | `NOT NULL`, `DEFAULT FALSE` | Se esta previsão foi promovida a **seleção shadow oficial** — isto é, entra nas métricas de performance (hit rate, ROI teórico, CLV, equity curve) usadas para avaliar a qualidade do sistema. Nem toda previsão gerada é selecionada; a seleção aplica um critério adicional (threshold de edge/EV/score) sobre o universo de previsões geradas. |
| `selection_strategy` | `TEXT` | opcional | Nome/identificador da estratégia de seleção aplicada (ex.: `shadow_selection_v1`). `NULL` quando `is_shadow_selection = FALSE`. |
| `selection_reason` | `JSONB` | opcional | Detalhe de cada critério avaliado na decisão de seleção (ex.: `{"edge_threshold": {"value": 0.034, "min": 0.02, "met": true}, "ev_threshold": {...}}`) — permite auditar por que a previsão foi (ou não) selecionada. |
| `selected_at` | `TIMESTAMPTZ` | opcional | Momento em que a seleção foi decidida. |
| `selection_version` | `TEXT` | opcional | Versão do módulo/estratégia de seleção usada. |

### 3.12. Grading (write-once, após o resultado do evento)

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `result` | `TEXT` | `CHECK IN ('won','lost','void')`, write-once | Resultado da previsão, determinado a partir do placar final do evento. `void` também é usado quando o mercado não é suportado pelo grading automático (requer grading manual) ou quando a regra do mercado invalida a aposta (ex.: empate em Draw No Bet). |
| `theoretical_return` | `NUMERIC(10,4)` | write-once | Retorno teórico por unidade apostada: `best_odds − 1` se `won`; `−1` se `lost`; `0` se `void`. |
| `clv` | `NUMERIC(8,6)` | write-once | CLV **legado**, baseado em probabilidade: `model_probability − 1/closing_odds`. Mantido por compatibilidade retroativa com dashboards e relatórios já existentes; ver `clv_probability` para o campo canônico equivalente. `NULL` quando não há `closing_odds` válida. |
| `graded_at` | `TIMESTAMPTZ` | write-once | Momento em que o grading foi realizado. |
| `status` | `TEXT` | `NOT NULL`, `DEFAULT 'open'`, `CHECK IN ('open','graded','void')`, write-once (transição única) | Estado da previsão — ver §6. Transiciona de `open` para `graded` (resultado won/lost) ou `void` (mercado não suportado / aposta anulada pela regra do mercado), e nunca retorna a `open`. |

### 3.13. CLV canônico (dual)

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `clv_price` | `NUMERIC(8,6)` | opcional, write-once | CLV baseado em preço (odds): `clv_price = entry_odds / closing_odds − 1`, onde `entry_odds = best_odds`. Positivo indica que a odd obtida na entrada era melhor (mais alta) que a de fechamento — a formulação clássica de CLV usada na literatura de apostas quantitativas. |
| `clv_probability` | `NUMERIC(8,6)` | opcional, write-once | CLV baseado em probabilidade: `clv_probability = model_probability − 1/closing_odds`. Compara a probabilidade estimada pelo modelo contra a probabilidade implícita (com vig) da closing odd. Conceitualmente equivalente ao `clv` legado; é o campo canônico a partir desta versão. |

> **Nota de nomenclatura:** `clv` (legado), `clv_probability` (canônico) e o campo interno de
> `services/engine/app/metrics/clv.py` (`calculate_clv_prob`, baseado em
> `fair_prob_closing − fair_prob_at_bet`) representam a mesma família conceitual de CLV
> baseado em probabilidade, mas com pontos de referência ligeiramente distintos (probabilidade
> do **modelo** vs. probabilidade **justa de mercado** no momento da entrada). Ao consumir
> estes campos em relatórios, usar sempre `clv_price` e `clv_probability` como fonte primária
> para novas análises; `clv` é mantido só para não quebrar consumidores existentes.

### 3.14. Metadados auxiliares

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `snapshot_odds` | `JSONB` | opcional, write-once (junto com `closing_odds`) | Snapshot completo das odds de todas as casas de apostas para este `(event_id, market, outcome)` no momento da captura de closing odds. Formato: `{"bet365": 2.10, "pinnacle": 2.15, ...}`. |
| `market_overround` | `NUMERIC(8,6)` | opcional | Overround médio do mercado (soma das probabilidades implícitas cruas menos 1) no momento da geração — indicador da margem embutida pelas casas de apostas. |
| `home_team` | `TEXT` | opcional | Nome do time mandante (desnormalizado, conveniência para exibição/relatórios sem JOIN em `teams`). |
| `away_team` | `TEXT` | opcional | Nome do time visitante (idem). |

---

## 4. Restrições de Unicidade

### 4.1. `UNIQUE (prediction_run_id, event_id, market, outcome)`

Garante idempotência dentro do mesmo run de previsão: a mesma previsão (mesmo evento,
mercado e outcome) não é inserida duas vezes para o mesmo `prediction_run_id`. Diferente da
versão anterior do shadow mode — onde a unicidade era `(event_id, market, outcome,
model_version)` e, portanto, um novo run com o mesmo modelo não podia gerar um novo registro
para o mesmo evento —, aqui a combinação `(event_id, market, outcome)` **pode se repetir
entre `prediction_run_id`s diferentes**. Isso é intencional: cada execução do pipeline
registra seu próprio snapshot temporal, permitindo reconstruir o histórico completo de como
a previsão evoluiu (odds mudando, modelo sendo reavaliado) até o kickoff.

### 4.2. Índice único parcial de seleção

```sql
CREATE UNIQUE INDEX idx_shadow_unique_selection
    ON shadow_predictions (event_id, market, outcome)
    WHERE is_shadow_selection = TRUE;
```

Garante que, entre **todos** os snapshots gerados ao longo do tempo para um mesmo
`(event_id, market, outcome)` — mesmo vindos de `prediction_run_id`s diferentes —, no
máximo **um** pode estar marcado como a seleção shadow oficial ativa
(`is_shadow_selection = TRUE`). Por ser um índice único **parcial** (com cláusula `WHERE`),
ele não impede a inserção de múltiplos snapshots não-selecionados
(`is_shadow_selection = FALSE`) para o mesmo evento/mercado/outcome — apenas impede
duplicidade de seleções oficiais, que é o que entra nas métricas de performance do sistema.

---

## 5. Índices de `shadow_predictions`

| Índice | Definição | Propósito |
|---|---|---|
| `idx_shadow_status` | `(status)` | Filtrar previsões abertas/gradeadas/anuladas (grading, dashboards). |
| `idx_shadow_league` | `(league)` | Agregações e filtros por liga. |
| `idx_shadow_kickoff_at` | `(kickoff_at)` | Consultas por janela de tempo do evento (ex.: captura de closing odds nas próximas 2h, grading de eventos já iniciados). |
| `idx_shadow_generated_at` | `(generated_at)` | Ordenação cronológica das previsões geradas; auditoria anti-leakage. |
| `idx_shadow_prediq_score` | `(prediq_score)` | Ordenação/filtro por qualidade da oportunidade (faixas de PREDIQ Score). |
| `idx_shadow_pipeline_run` | `(pipeline_run_id)` | Join/lookup com `shadow_pipeline_runs`; listar todas as previsões de um run. |
| `idx_shadow_prediction_run` | `(prediction_run_id)` | Lookup de um snapshot de previsão específico. |
| `idx_shadow_selection` | `(is_shadow_selection) WHERE is_shadow_selection = TRUE` | Índice parcial — acesso rápido apenas às seleções oficiais (o subconjunto usado nas métricas de performance), sem varrer todo o histórico de snapshots não-selecionados. |
| `idx_shadow_as_of` | `(as_of)` | Consultas por instante de referência do snapshot (reconstrução temporal). |
| `idx_shadow_unique_selection` | `(event_id, market, outcome) WHERE is_shadow_selection = TRUE` (único) | Ver §4.2 — restrição de integridade, funciona também como índice de lookup da seleção ativa de um evento/mercado/outcome. |

---

## 6. Estados do Sistema

### 6.1. `shadow_pipeline_runs.status`

| Valor | Significado |
|---|---|
| `running` | Execução em andamento (`finished_at IS NULL`). Estado inicial (`DEFAULT`). |
| `completed` | Execução concluída com sucesso, sem erros bloqueantes. |
| `failed` | Execução interrompida por erro não recuperável antes de concluir o ciclo. |
| `partial` | Execução terminou, mas processou apenas parte dos eventos/previsões esperados (ex.: falha pontual em alguns eventos, registrada em `errors`, sem abortar o ciclo inteiro). |

### 6.2. `shadow_pipeline_runs.leakage_check`

| Valor | Significado |
|---|---|
| `passed` | Verificação anti-data-leakage executada e nenhuma violação encontrada (nenhuma previsão com `generated_at > kickoff_at`, nenhum uso de dado pós-evento nos cálculos). |
| `failed` | Verificação encontrou pelo menos uma violação — sinal crítico, deve interromper a confiança nos resultados do run. |
| `skipped` | Verificação não foi executada neste ciclo. Não esperado em produção contínua. |

### 6.3. `shadow_predictions.status`

| Valor | Significado |
|---|---|
| `open` | Previsão gerada, evento ainda não finalizado ou grading ainda não executado. Estado inicial (`DEFAULT`). |
| `graded` | Grading automático concluído com resultado `won` ou `lost` determinado a partir do placar final. |
| `void` | Previsão anulada — mercado não suportado pelo grading automático, ou regra do próprio mercado invalida a aposta (ex.: empate em Draw No Bet). |

Transição permitida: `open → graded` ou `open → void`, uma única vez (write-once — ver §7).
Nunca retorna a `open`.

### 6.4. `shadow_predictions.result`

| Valor | Significado |
|---|---|
| `won` | A previsão acertou o outcome segundo o placar final. |
| `lost` | A previsão errou o outcome. |
| `void` | Aposta anulada pela regra do mercado (ex.: empate em Draw No Bet) — devolução do stake, sem lucro nem prejuízo. |

### 6.5. `shadow_predictions.fair_probability_method`

| Valor | Significado |
|---|---|
| `shin` | Método de Shin para remoção de overround — padrão para mercados com ≥ 3 outcomes (ex.: 1x2). |
| `power` | Método de remoção de overround baseado em transformação de potência. |
| `multiplicative` | Normalização proporcional simples (fallback) — usado quando Shin não converge ou o mercado tem menos de 3 outcomes. |

---

## 7. Regras de Imutabilidade

A tabela `shadow_predictions` é conceitualmente append-only: a maior parte dos campos é
gravada uma única vez no `INSERT` e nunca mais alterada. Um subconjunto restrito de campos
pode ser preenchido depois, sempre no formato **write-once** (só grava se o valor atual for
`NULL`/estado inicial) — nunca sobrescreve um valor já preenchido.

| Campo | Pode ser atualizado? | Quando / condição do `UPDATE` |
|---|---|---|
| `fair_market_probability` | ❌ Nunca | — |
| `model_probability` | ❌ Nunca | — |
| `edge` | ❌ Nunca | — |
| `ev` | ❌ Nunca | — |
| `prediq_score` | ❌ Nunca | — |
| `kelly_fraction` | ❌ Nunca | — |
| `kelly_full` | ❌ Nunca | — |
| `kelly_capped` | ❌ Nunca | — |
| `ensemble_probability` | ❌ Nunca | — |
| `individual_model_probs` | ❌ Nunca | — |
| `ensemble_variance` | ❌ Nunca | — |
| `score_components` | ❌ Nunca | — |
| `generated_at` | ❌ Nunca | — |
| `best_odds` | ❌ Nunca | — |
| `as_of` / `snapshot_sequence` | ❌ Nunca | Definidos no INSERT do snapshot. |
| `closing_odds` | ✅ Uma vez | `UPDATE ... WHERE closing_odds IS NULL`, disparado por `capture_closing_odds()` quando o kickoff está a até 2h de distância. |
| `snapshot_odds` | ✅ Uma vez | Junto com `closing_odds`. |
| `closing_odds_at` / `closing_bookmaker` / `closing_source` / `closing_is_valid` / `closing_reason` | ✅ Uma vez | Junto com `closing_odds`. |
| `is_shadow_selection` / `selection_strategy` / `selection_reason` / `selected_at` / `selection_version` | ✅ Uma vez | No momento em que a estratégia de seleção decide promover a previsão a seleção oficial. Sujeito ao índice único parcial (§4.2). |
| `result` | ✅ Uma vez | `UPDATE ... WHERE status = 'open' AND kickoff_at < now()`, disparado por `grade_shadow_predictions()` após o evento finalizar com placar disponível. |
| `theoretical_return` | ✅ Uma vez | Junto com `result`. |
| `clv` | ✅ Uma vez | Junto com `result` (quando `closing_odds` disponível; `NULL` caso contrário). |
| `clv_price` / `clv_probability` | ✅ Uma vez | Junto com `result`/grading (quando `closing_odds` válida disponível). |
| `graded_at` | ✅ Uma vez | Junto com `result`. |
| `status` | ✅ Uma transição | `'open' → 'graded'` ou `'open' → 'void'`. Nunca retorna a `'open'`. |

**Regra fundamental (`SHADOW_MODE_SPEC.md` §3.4):** nenhuma previsão é modificada após o
grading. Todo `UPDATE` de campos de grading tem `WHERE status = 'open'` explícito na
cláusula — uma vez que `status` sai de `'open'`, a linha se torna efetivamente somente
leitura.

Em `shadow_pipeline_runs`, o mesmo princípio se aplica a `finished_at` e `status`: só são
atualizados enquanto o run está em `'running'`, ao final do ciclo (via `UPDATE` disparado
pela função que orquestra o run).

### 7.1. Prevenção de data leakage

- `generated_at` é gravado no `INSERT` e nunca alterado — é a referência temporal auditável
  de quando a previsão "existiu" para fins de comparação com o kickoff.
- Nenhum dado posterior ao kickoff influencia os campos de predição
  (`model_probability`, `edge`, `ev`, `prediq_score`, `kelly_*`, `ensemble_*`).
- O grading usa exclusivamente o placar final do evento (`home_score`, `away_score`) —
  dado disponível publicamente após o apito final, nunca antes.
- Walk-forward validation dos modelos usa expanding window com `cutoff_date` estrito (ver
  `MODELING.md`).
- `shadow_pipeline_runs.leakage_check` registra o resultado da verificação automática ao
  fim de cada ciclo.

---

## 8. Fórmulas — CLV (Closing Line Value)

CLV mede se a odd (ou probabilidade) obtida no momento da previsão era melhor do que a odd
de fechamento do mercado — considerado na literatura de apostas quantitativas o melhor
preditor de longo prazo de lucratividade, mais confiável que o resultado individual de
qualquer aposta isolada (dominado por variância de curto prazo).

### 8.1. CLV baseado em preço — `clv_price`

```
clv_price = best_odds / closing_odds − 1
```

- `clv_price > 0` → a odd obtida na entrada era melhor (mais alta) que a de fechamento —
  sinal positivo de que o valor foi identificado antes do mercado se ajustar, mesmo que a
  aposta individual acabe perdendo.
- `clv_price < 0` → o mercado se moveu contra a avaliação inicial.
- `clv_price = 0` → odd de entrada igual à de fechamento.

### 8.2. CLV baseado em probabilidade — `clv_probability` (e `clv` legado)

```
clv_probability = model_probability − 1 / closing_odds
```

Compara a probabilidade estimada pelo modelo com a probabilidade implícita **com vig** da
closing odd (`1 / closing_odds`).

- `clv_probability > 0` → o modelo atribuiu ao outcome uma probabilidade maior do que a
  implícita na odd de fechamento — evidência de edge que persistiu até o fechamento do
  mercado.
- `clv_probability < 0` → o mercado, ao fechar, precificou o outcome como menos provável
  do que o modelo indicava.

O campo `clv` (legado) usa exatamente esta mesma fórmula; `clv_probability` é o nome
canônico a partir desta versão do schema, mantido lado a lado por compatibilidade
retroativa com consumidores (relatórios, dashboards) já existentes.

### 8.3. Pré-condições

Ambas as fórmulas exigem `closing_odds` válida (`closing_odds > 1.0` e, idealmente,
`closing_is_valid = TRUE`). Quando `closing_odds` é `NULL` ou o mercado foi marcado como
inválido para CLV (`closing_is_valid = FALSE`), os campos de CLV permanecem `NULL` — não
são estimados a partir de dados incompletos.

---

## 9. Fórmulas — Kelly Criterion

Para uma aposta com odds decimais `d` (= `best_odds`) e probabilidade estimada pelo modelo
`p` (= `model_probability`):

```
b = d − 1                        (lucro líquido por unidade apostada, em caso de acerto)
q = 1 − p                        (probabilidade de derrota segundo o modelo)

f* = (b·p − q) / b = p − q/b     (Kelly pleno — kelly_full)
```

- `f* > 0` ⟺ `EV > 0` (a aposta tem valor positivo segundo o modelo).
- `f* = 0` quando `p = 1/d` (breakeven exato).
- `f* < 0` → modelo indica valor negativo; não apostar.

**Kelly fracionário** (usado como sugestão de stake real — o Kelly pleno nunca é exibido
como recomendação, apenas guardado em `kelly_full` para diagnóstico):

```
f_frac = κ · f*        com κ tipicamente 0.25 (quarter-Kelly, padrão do BetEdge)

kelly_fraction = kelly_capped = max(0, min(κ · f*, κ))
```

- Retorna `0` quando `f* ≤ 0` (sem valor → sem aposta).
- É limitado (capped) a no máximo `κ` da banca, mesmo que `f*` seja muito alto — proteção
  contra estimativas extremas de `p`.
- `kelly_fraction` é o valor efetivamente exibido/recomendado; `kelly_capped` registra
  explicitamente o resultado já com o cap aplicado (podem coincidir com a config-padrão,
  mas são persistidos separadamente para permitir estratégias de cap distintas por
  experimento).

---

## 10. Critérios de Graduação

O shadow mode é considerado apto a avançar de fase (para paper trading — Fase 2) quando
**todos** os critérios abaixo são atendidos **simultaneamente**, calculados sobre o
subconjunto de previsões com `is_shadow_selection = TRUE` e `status IN ('graded', 'void')`:

| # | Critério | Threshold | Justificativa |
|---|---|---|---|
| 1 | Eventos avaliados | ≥ 200 | Significância estatística mínima para o Brier Score. |
| 2 | Apostas simuladas (seleções gradeadas) | ≥ 500 | Significância para ROI, com intervalo de confiança de Wilson < ±3%. |
| 3 | ECE (Expected Calibration Error) por liga | < 0.05 em ≥ 3 ligas | Calibração estável comprovada em múltiplos mercados/contextos, não apenas em um. |
| 4 | CLV médio (`clv_probability`/`clv_price`) | > 0 | Edge real confirmado pelo movimento do mercado até o fechamento — não apenas pelo próprio modelo. |
| 5 | Data leakage | Ausente | Zero previsões com `generated_at > kickoff_at`; `leakage_check = 'passed'` em todos os runs do período avaliado. |
| 6 | Convergência Python/TypeScript | Verificada | Cálculos de fair probability idênticos entre o engine (Python) e o Model Audit (TypeScript) — hoje verificação manual pendente de automação. |

A função `get_graduation_status()` (`services/engine/app/shadow/engine.py`) verifica os
critérios 1–4 automaticamente e retorna, por critério, o valor atual, o alvo e se foi
atingido (`met: true/false`); o critério 5 depende de `shadow_pipeline_runs.leakage_check`
agregado no período; o critério 6 permanece de verificação manual.

Ao atingir todos os critérios: **os pesos do Índice PREDIQ não são alterados nesta fase**;
gera-se um relatório final de graduação; o pipeline pode avançar para paper trading (apostas
registradas mas não executadas, odds reais de execução capturadas, slippage e liquidez
medidos); a decisão de avançar é sempre humana e explícita — nunca automática.

---

## 11. Referências Cruzadas

| Documento | Conteúdo relacionado |
|---|---|
| `SHADOW_MODE_SPEC.md` | Arquitetura, ciclo diário, agregações, dashboard SHADOW LAB, endpoints da API, timeline de graduação. |
| `PIPELINE_CONTRACT.md` | Contrato geral do pipeline PREDIQ, restrições de segurança compartilhadas com o shadow mode. |
| `MODELING.md` | Detalhes dos modelos estatísticos, ensemble, walk-forward validation, PREDIQ Score. |
| `DATABASE.md` | Schema das tabelas de produção (`events`, `odds`, `model_predictions`, etc.) referenciadas logicamente por `shadow_predictions`. |
| `services/engine/app/shadow/schema.py` | DDL exato (fonte da verdade) das duas tabelas descritas neste documento. |
| `services/engine/app/shadow/engine.py` | Implementação do ciclo shadow, captura de closing odds e grading automático. |
| `services/engine/app/value/kelly.py` | Implementação das fórmulas de Kelly (`kelly_fraction`, `fractional_kelly`, `kelly_stake_pct`). |
| `services/engine/app/metrics/clv.py` | Implementação das fórmulas de CLV (`calculate_clv`, `calculate_clv_prob`, `aggregate_clv`). |

---

*Documento gerado como parte da documentação do Shadow Mode v1 (hardened) do pipeline
PREDIQ. Mantenha-o sincronizado com `services/engine/app/shadow/schema.py` sempre que o
schema for alterado.*
