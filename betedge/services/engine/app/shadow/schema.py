"""DDL das tabelas shadow_predictions e shadow_pipeline_runs.

shadow_predictions: append-only para previsões. Campos de grading são write-once.
shadow_pipeline_runs: rastreabilidade completa de cada execução do pipeline.

Usa sqlalchemy.text() exclusivamente (sem modelos ORM).
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# DDL — shadow_pipeline_runs
#
# Uma linha por execução do pipeline shadow. Guarda o "estado do mundo" no
# momento da execução (versões de cada estágio, config, fontes de dados) para
# que qualquer previsão gerada naquele ciclo possa ser auditada/reproduzida
# a partir do pipeline_run_id.
# ═══════════════════════════════════════════════════════════════════════════

_SHADOW_PIPELINE_RUNS_DDL = """
CREATE TABLE IF NOT EXISTS shadow_pipeline_runs (
    -- Identidade
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_run_id           TEXT NOT NULL UNIQUE,

    -- Ciclo de vida da execução
    started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at                TIMESTAMPTZ,
    status                    TEXT NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'completed', 'failed', 'partial')),

    -- Versões de cada estágio do pipeline neste run (para reprodutibilidade)
    pipeline_version          TEXT NOT NULL,
    model_version              TEXT NOT NULL,
    features_version           TEXT NOT NULL,
    ensemble_version           TEXT NOT NULL,
    score_version               TEXT NOT NULL,
    fair_probability_version   TEXT NOT NULL,
    selection_version           TEXT,

    -- Contadores de progresso/resultado
    events_processed           INT DEFAULT 0,
    predictions_created         INT DEFAULT 0,
    selections_made              INT DEFAULT 0,

    -- Métricas adicionais do run
    duration_seconds          NUMERIC(10,2),
    markets_processed         INT DEFAULT 0,
    odds_sources_count        INT DEFAULT 0,
    skipped_fail_safe         INT DEFAULT 0,

    -- Diagnóstico
    errors                    JSONB DEFAULT '[]'::jsonb,
    warnings                  JSONB DEFAULT '[]'::jsonb,
    data_sources               JSONB,
    leakage_check              TEXT CHECK (leakage_check IN ('passed', 'failed', 'skipped')),
    config_snapshot            JSONB
);
"""

_SHADOW_PIPELINE_RUNS_INDEXES_DDL = """
CREATE INDEX IF NOT EXISTS idx_spr_pipeline_run_id
    ON shadow_pipeline_runs (pipeline_run_id);

CREATE INDEX IF NOT EXISTS idx_spr_status
    ON shadow_pipeline_runs (status);

CREATE INDEX IF NOT EXISTS idx_spr_started_at
    ON shadow_pipeline_runs (started_at);
"""

# ═══════════════════════════════════════════════════════════════════════════
# DDL — shadow_predictions
#
# Uma linha por previsão gerada (snapshot). Diferente da versão anterior,
# a mesma combinação (event_id, market, outcome) PODE se repetir entre runs
# diferentes — isso é intencional: cada execução do pipeline registra um
# snapshot temporal da previsão (odds mudam, features mudam, o modelo pode
# ser reavaliado). A unicidade passa a ser por prediction_run_id, não mais
# por model_version isolado.
#
# "Seleção shadow" (is_shadow_selection) é um conceito separado de
# "previsão": entre todos os snapshots gerados para um (event, market,
# outcome), no máximo um pode ser marcado como a seleção oficial do shadow
# mode — isso é garantido por um índice único parcial, não pela chave
# primária da tabela.
# ═══════════════════════════════════════════════════════════════════════════

_SHADOW_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS shadow_predictions (
    -- Identidade
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id               UUID NOT NULL,
    league                 TEXT NOT NULL,
    sport                  TEXT NOT NULL DEFAULT 'football',

    -- Mercado e desfecho previsto
    market                 TEXT NOT NULL,
    outcome                TEXT NOT NULL,

    -- Rastreabilidade do pipeline: qual execução gerou esta previsão, com
    -- que "run de previsão" (pode haver mais de um prediction_run dentro do
    -- mesmo pipeline_run) e em que sequência de snapshot para o mesmo
    -- (event, market, outcome) dentro desse run.
    pipeline_run_id         TEXT NOT NULL,
    prediction_run_id       TEXT NOT NULL,
    as_of                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    snapshot_sequence       INT NOT NULL DEFAULT 1,

    -- Timestamps
    generated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    kickoff_at             TIMESTAMPTZ NOT NULL,

    -- Odds de abertura (melhor odd no momento da geração)
    bookmaker              TEXT NOT NULL,
    best_odds              NUMERIC(8,4) NOT NULL,

    -- Closing odds — capturadas pouco antes do kickoff (write-once)
    closing_odds           NUMERIC(8,4),

    -- Closing line formalizada: de onde veio, quando foi capturada e se é
    -- válida para cálculo de CLV (ex.: mercado suspenso perto do kickoff
    -- pode gerar uma closing line não confiável — closing_is_valid=FALSE e
    -- closing_reason explica o motivo).
    closing_odds_at         TIMESTAMPTZ,
    closing_bookmaker       TEXT,
    closing_source          TEXT,
    closing_is_valid        BOOLEAN,
    closing_reason          TEXT,

    -- Fair probability de fechamento — calculada via Shin method no momento
    -- da captura de closing odds, usada para CLV probability corrigido.
    closing_fair_probability NUMERIC(8,6),

    -- Probabilidades
    fair_market_probability NUMERIC(8,6) NOT NULL,

    -- Entry fair probability — snapshot no momento da geração da previsão.
    -- Mesmo valor de fair_market_probability, persistido explicitamente para
    -- CLV probability = closing_fair_probability - entry_fair_probability.
    entry_fair_probability   NUMERIC(8,6),

    model_probability       NUMERIC(8,6) NOT NULL,

    -- Fair probability tracking: método usado para remover o overround
    -- (ex.: 'shin', 'power', 'multiplicative') e a versão do algoritmo.
    fair_probability_method  TEXT NOT NULL DEFAULT 'shin',
    fair_probability_version TEXT NOT NULL,

    -- Métricas de valor
    edge                   NUMERIC(8,6) NOT NULL,
    ev                     NUMERIC(8,6) NOT NULL,
    prediq_score           NUMERIC(6,2) NOT NULL,
    kelly_fraction         NUMERIC(8,6) NOT NULL,

    -- Kelly — variantes persistidas separadamente do kelly_fraction
    -- (que é a fração efetivamente usada/recomendada).
    kelly_full             NUMERIC(8,6),
    kelly_capped           NUMERIC(8,6),
    kelly_version          TEXT NOT NULL DEFAULT '1.0.0',

    -- Ensemble — detalhes do blend de modelos que gerou model_probability.
    ensemble_weights       JSONB,
    ensemble_probability   NUMERIC(8,6),

    -- PREDIQ Score — componentes individuais persistidos para auditoria
    -- (o valor final continua em prediq_score acima).
    score_components       JSONB,

    -- Rastreabilidade de versão
    model_version          TEXT NOT NULL,
    features_version       TEXT NOT NULL,
    ensemble_version       TEXT NOT NULL,
    score_version          TEXT NOT NULL,
    pipeline_version       TEXT NOT NULL,

    -- Seleção shadow — separada da geração da previsão. Nem toda previsão
    -- vira uma seleção oficial do shadow mode; quando vira, estes campos
    -- registram a estratégia e o motivo da escolha.
    is_shadow_selection     BOOLEAN NOT NULL DEFAULT FALSE,
    selection_strategy      TEXT,
    selection_reason        JSONB,
    selected_at             TIMESTAMPTZ,
    selection_version       TEXT,

    -- Grading (preenchido após resultado — write-once)
    result                 TEXT CHECK (result IN ('won', 'lost', 'void')),
    theoretical_return     NUMERIC(10,4),
    clv                    NUMERIC(8,6),
    graded_at              TIMESTAMPTZ,
    status                 TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'graded', 'void')),

    -- Rastreabilidade do grading
    grading_source           TEXT DEFAULT 'events_table',
    grading_version          TEXT DEFAULT 'grading-v1.0.0',

    -- CLV dual — clv (acima) é mantido por compatibilidade retroativa, mas
    -- clv_price e clv_probability são os campos canônicos daqui em diante:
    -- clv_price compara odds (preço) e clv_probability compara a
    -- probabilidade justa de abertura vs. fechamento.
    clv_price               NUMERIC(8,6),
    clv_probability          NUMERIC(8,6),

    -- Metadados auxiliares (diagnóstico / auditoria)
    individual_model_probs JSONB,
    snapshot_odds          JSONB,
    ensemble_variance      NUMERIC(8,6),
    market_overround       NUMERIC(8,6),
    home_team              TEXT,
    away_team              TEXT,

    -- Idempotência: dentro do mesmo run de previsão, a mesma previsão não é
    -- inserida duas vezes. Diferente do run anterior, o mesmo (event,
    -- market, outcome) PODE se repetir — cada prediction_run_id gera seu
    -- próprio snapshot, permitindo histórico temporal completo.
    UNIQUE (prediction_run_id, event_id, market, outcome)
);
"""

_SHADOW_INDEXES_DDL = """
CREATE INDEX IF NOT EXISTS idx_shadow_status
    ON shadow_predictions (status);

CREATE INDEX IF NOT EXISTS idx_shadow_league
    ON shadow_predictions (league);

CREATE INDEX IF NOT EXISTS idx_shadow_kickoff_at
    ON shadow_predictions (kickoff_at);

CREATE INDEX IF NOT EXISTS idx_shadow_generated_at
    ON shadow_predictions (generated_at);

CREATE INDEX IF NOT EXISTS idx_shadow_prediq_score
    ON shadow_predictions (prediq_score);

CREATE INDEX IF NOT EXISTS idx_shadow_pipeline_run
    ON shadow_predictions (pipeline_run_id);

CREATE INDEX IF NOT EXISTS idx_shadow_prediction_run
    ON shadow_predictions (prediction_run_id);

CREATE INDEX IF NOT EXISTS idx_shadow_selection
    ON shadow_predictions (is_shadow_selection)
    WHERE is_shadow_selection = TRUE;

CREATE INDEX IF NOT EXISTS idx_shadow_as_of
    ON shadow_predictions (as_of);

-- Proteção contra seleções oficiais duplicadas: entre todos os snapshots de
-- um mesmo (event_id, market, outcome), no máximo um pode estar marcado
-- como seleção shadow ativa. Índice único parcial — não interfere na
-- inserção de snapshots que não são seleção (is_shadow_selection = FALSE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_unique_selection
    ON shadow_predictions (event_id, market, outcome)
    WHERE is_shadow_selection = TRUE;
"""


async def _execute_ddl_statements(db: AsyncSession, ddl_block: str) -> None:
    """Executa um bloco DDL dividindo por ';' e rodando cada statement isoladamente.

    asyncpg não permite múltiplos comandos em uma única prepared statement.
    Cada CREATE INDEX / CREATE TABLE é enviado individualmente.
    """
    for stmt in ddl_block.split(";"):
        stmt = stmt.strip()
        if stmt:
            await db.execute(text(stmt))


async def ensure_shadow_tables(db: AsyncSession) -> None:
    """Cria as tabelas shadow_pipeline_runs e shadow_predictions caso ainda não existam.

    Chamada no início de cada ciclo shadow — idempotente e segura para
    execução concorrente (IF NOT EXISTS em todos os DDLs). A tabela de runs
    é criada primeiro pois shadow_predictions referencia pipeline_run_id
    logicamente (sem FK explícita, para não travar a inserção de previsões
    caso o registro do run falhe por qualquer motivo).

    Cada statement DDL é executado individualmente porque o asyncpg não
    suporta múltiplos comandos em um único prepared statement.
    """
    await db.execute(text(_SHADOW_PIPELINE_RUNS_DDL))
    await _execute_ddl_statements(db, _SHADOW_PIPELINE_RUNS_INDEXES_DDL)
    await db.execute(text(_SHADOW_TABLE_DDL))
    await _execute_ddl_statements(db, _SHADOW_INDEXES_DDL)
    await db.commit()
    logger.info("shadow_predictions e shadow_pipeline_runs: tabelas e índices garantidos.")


# Alias mantido por compatibilidade retroativa com chamadores existentes
# (ex.: app.shadow.engine) que ainda importam ensure_shadow_table.
async def ensure_shadow_table(db: AsyncSession) -> None:
    """Alias retrocompatível de ensure_shadow_tables()."""
    await ensure_shadow_tables(db)
