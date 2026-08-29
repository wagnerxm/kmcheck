"""DDL da tabela shadow_predictions e função de bootstrap.

A tabela é append-only para previsões. Campos de grading (result,
theoretical_return, clv, graded_at) são preenchidos uma única vez quando
o evento finaliza — nunca mais sobrescritos. closing_odds é capturado
pouco antes do kickoff e também é write-once.

Usa sqlalchemy.text() exclusivamente (sem modelos ORM), seguindo o
padrão do orchestrator.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# DDL — shadow_predictions
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

    -- Timestamps
    generated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    kickoff_at             TIMESTAMPTZ NOT NULL,

    -- Odds de abertura (melhor odd no momento da geração)
    bookmaker              TEXT NOT NULL,
    best_odds              NUMERIC(8,4) NOT NULL,

    -- Closing odds — capturadas pouco antes do kickoff (write-once)
    closing_odds           NUMERIC(8,4),

    -- Probabilidades
    fair_market_probability NUMERIC(8,6) NOT NULL,
    model_probability       NUMERIC(8,6) NOT NULL,

    -- Métricas de valor
    edge                   NUMERIC(8,6) NOT NULL,
    ev                     NUMERIC(8,6) NOT NULL,
    prediq_score           NUMERIC(6,2) NOT NULL,
    kelly_fraction         NUMERIC(8,6) NOT NULL,

    -- Rastreabilidade de versão
    model_version          TEXT NOT NULL,
    features_version       TEXT NOT NULL,

    -- Grading (preenchido após resultado — write-once)
    result                 TEXT CHECK (result IN ('won', 'lost', 'void')),
    theoretical_return     NUMERIC(10,4),
    clv                    NUMERIC(8,6),
    graded_at              TIMESTAMPTZ,
    status                 TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'graded', 'void')),

    -- Metadados auxiliares (diagnóstico / auditoria)
    individual_model_probs JSONB,
    snapshot_odds          JSONB,
    ensemble_variance      NUMERIC(8,6),
    market_overround       NUMERIC(8,6),
    home_team              TEXT,
    away_team              TEXT,

    -- Idempotência: mesma previsão não é inserida duas vezes
    UNIQUE (event_id, market, outcome, model_version)
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
"""


async def ensure_shadow_table(db: AsyncSession) -> None:
    """Cria a tabela shadow_predictions caso ainda não exista.

    Chamada no início de cada ciclo shadow — idempotente e segura para
    execução concorrente (IF NOT EXISTS em todos os DDLs).
    """
    await db.execute(text(_SHADOW_TABLE_DDL))
    await db.execute(text(_SHADOW_INDEXES_DDL))
    await db.commit()
    logger.info("shadow_predictions: tabela e índices garantidos.")
