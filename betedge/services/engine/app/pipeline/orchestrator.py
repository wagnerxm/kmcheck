"""Orquestrador do pipeline PREDIQ — conecta todos os componentes end-to-end.

Fluxo completo:
    1. Consulta eventos futuros com odds no banco
    2. Consulta histórico de partidas finalizadas para treino
    3. Treina cada modelo base (Poisson, Dixon-Coles, Elo, MarketConsensus,
       GradientBoost) com cutoff_date adequado
    4. Registra model_versions no banco
    5. Gera predições para cada evento via cada modelo treinado
    6. Roda EnsembleModel para combinar predições
    7. Persiste model_predictions e consensus_predictions (append-only)
    8. Executa value engine: calcula edge/ev/edge_score/kelly
    9. Persiste value_opportunities
   10. Após resultado: atualiza status de value_opportunities
   11. Computa e persiste model_performance

Respeita PIPELINE_CONTRACT.md v1.0.0:
- Append-only: model_predictions e odds_history nunca sofrem UPDATE/DELETE
- Grading derivado: acerto/erro calculado por JOIN via fn_grade_prediction
- Sem data leakage: cutoff_date e as_of enforçados em todas as etapas
- Reprodutibilidade: 3 coordenadas persistidas (model_version, features_version,
  training_data_cutoff)
- Sem números inventados: tudo vem de dados + modelos estatísticos
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session_ctx
from app.models.base import BaseModel as StatModel, PredictionResult
from app.models.poisson import PoissonModel
from app.models.dixon_coles import DixonColesModel
from app.models.elo import EloModel
from app.models.market_consensus import MarketConsensusModel
from app.models.gradient_boost import GradientBoostModel
from app.models.ensemble import EnsembleModel
from app.value.engine import (
    calculate_edge,
    calculate_ev,
    calculate_edge_score,
    implied_probability,
)
from app.value.fair_probability import (
    compute_fair_probs_for_event,
    compute_market_overround,
)
from app.value.kelly import fractional_kelly

logger = logging.getLogger(__name__)

# Versão do feature set — persistida em model_predictions para reprodutibilidade
FEATURES_VERSION = "1.0.0"

# Threshold mínimo de edge para criar uma value_opportunity
MIN_EDGE_THRESHOLD = 0.02  # 2 p.p.

# Limite mínimo de partidas para treinar modelos baseados em gols
MIN_TRAINING_MATCHES = 50


@dataclass
class PipelineResult:
    """Resultado da execução do pipeline para um evento."""
    event_id: str
    models_trained: list[str] = field(default_factory=list)
    predictions_generated: int = 0
    consensus_generated: int = 0
    value_opportunities_created: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class PipelineRunResult:
    """Resultado consolidado de uma execução completa do pipeline."""
    run_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
    events_processed: int = 0
    total_predictions: int = 0
    total_consensus: int = 0
    total_value_opportunities: int = 0
    model_versions_created: list[str] = field(default_factory=list)
    event_results: list[PipelineResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════════
# Helpers de banco
# ═══════════════════════════════════════════════════════════════════════════

async def _fetch_finished_matches(
    db: AsyncSession, cutoff_date: datetime, sport_code: str = "football"
) -> list[dict]:
    """Busca partidas finalizadas com placar até cutoff_date, ordenadas por kickoff_at."""
    result = await db.execute(text("""
        SELECT
            e.id AS event_id,
            e.home_team_id::text AS home_team_id,
            e.away_team_id::text AS away_team_id,
            e.home_score AS home_goals,
            e.away_score AS away_goals,
            e.kickoff_at,
            e.league_id::text AS league_id
        FROM events e
        JOIN sports s ON s.id = e.sport_id
        WHERE e.status = 'finished'
          AND e.kickoff_at <= :cutoff
          AND e.home_score IS NOT NULL
          AND e.away_score IS NOT NULL
          AND s.code = :sport
        ORDER BY e.kickoff_at ASC
    """), {"cutoff": cutoff_date, "sport": sport_code})
    return [dict(row) for row in result.mappings().all()]


async def _fetch_scheduled_events_with_odds(
    db: AsyncSession,
    event_ids: list[str] | None = None,
) -> list[dict]:
    """Busca eventos futuros (scheduled) que têm odds no banco."""
    params: dict[str, Any] = {}
    event_filter = ""
    if event_ids:
        event_filter = "AND e.id = ANY(:event_ids)"
        params["event_ids"] = event_ids

    result = await db.execute(text(f"""
        SELECT DISTINCT
            e.id::text AS event_id,
            e.home_team_id::text AS home_team_id,
            e.away_team_id::text AS away_team_id,
            e.kickoff_at,
            e.league_id::text AS league_id,
            e.sport_id::text AS sport_id,
            ht.name AS home_team_name,
            at_t.name AS away_team_name
        FROM events e
        JOIN odds o ON o.event_id = e.id
        JOIN teams ht ON ht.id = e.home_team_id
        JOIN teams at_t ON at_t.id = e.away_team_id
        WHERE e.status = 'scheduled'
          AND e.kickoff_at > now()
          {event_filter}
        ORDER BY e.kickoff_at ASC
    """), params)
    return [dict(row) for row in result.mappings().all()]


async def _fetch_event_odds(
    db: AsyncSession, event_id: str
) -> dict[str, dict[str, dict[str, float]]]:
    """Busca odds atuais por mercado/casa para um evento.

    Retorna: {market_code: {bookmaker_name: {outcome_code: decimal_odds}}}
    """
    result = await db.execute(text("""
        SELECT
            m.code AS market_code,
            b.name AS bookmaker_name,
            oc.code AS outcome_code,
            o.decimal_odds
        FROM odds o
        JOIN markets m ON m.id = o.market_id
        JOIN bookmakers b ON b.id = o.bookmaker_id
        JOIN outcomes oc ON oc.id = o.outcome_id
        WHERE o.event_id = :event_id
          AND o.is_suspended = false
        ORDER BY m.code, b.name
    """), {"event_id": event_id})

    odds_tree: dict[str, dict[str, dict[str, float]]] = {}
    for row in result.mappings().all():
        market = row["market_code"]
        bookie = row["bookmaker_name"]
        outcome = row["outcome_code"]
        dec_odds = float(row["decimal_odds"])

        odds_tree.setdefault(market, {}).setdefault(bookie, {})[outcome] = dec_odds

    return odds_tree


async def _fetch_best_odds(
    db: AsyncSession, event_id: str, market_code: str, outcome_code: str
) -> tuple[float | None, str | None, str | None]:
    """Busca a melhor odd (maior) para um evento/mercado/outcome.

    Retorna: (decimal_odds, bookmaker_id, bookmaker_name) ou (None, None, None).
    """
    result = await db.execute(text("""
        SELECT
            o.decimal_odds,
            o.bookmaker_id::text AS bookmaker_id,
            b.name AS bookmaker_name
        FROM odds o
        JOIN bookmakers b ON b.id = o.bookmaker_id
        JOIN markets m ON m.id = o.market_id
        JOIN outcomes oc ON oc.id = o.outcome_id
        WHERE o.event_id = :event_id
          AND m.code = :market_code
          AND oc.code = :outcome_code
          AND o.is_suspended = false
        ORDER BY o.decimal_odds DESC
        LIMIT 1
    """), {
        "event_id": event_id,
        "market_code": market_code,
        "outcome_code": outcome_code,
    })
    row = result.mappings().first()
    if not row:
        return None, None, None
    return float(row["decimal_odds"]), row["bookmaker_id"], row["bookmaker_name"]


async def _fetch_team_match_history(
    db: AsyncSession, team_id: str, before: datetime, limit: int = 30
) -> list[dict]:
    """Busca histórico de partidas de um time, mais recentes primeiro."""
    result = await db.execute(text("""
        SELECT
            e.id::text AS event_id,
            e.home_team_id::text AS home_team_id,
            e.away_team_id::text AS away_team_id,
            e.home_score AS home_goals,
            e.away_score AS away_goals,
            e.kickoff_at
        FROM events e
        WHERE e.status = 'finished'
          AND (e.home_team_id = :team_id OR e.away_team_id = :team_id)
          AND e.kickoff_at < :before
          AND e.home_score IS NOT NULL
        ORDER BY e.kickoff_at DESC
        LIMIT :lim
    """), {"team_id": team_id, "before": before, "lim": limit})
    return [dict(row) for row in result.mappings().all()]


async def _resolve_id(db: AsyncSession, table: str, code: str) -> str | None:
    """Busca o UUID de uma entidade por código (markets, outcomes, etc.)."""
    result = await db.execute(
        text(f"SELECT id::text FROM {table} WHERE code = :code LIMIT 1"),
        {"code": code},
    )
    row = result.scalar()
    return row


async def _resolve_market_outcome_ids(
    db: AsyncSession, market_code: str, outcome_code: str
) -> tuple[str | None, str | None]:
    """Resolve market_id e outcome_id a partir dos códigos."""
    market_id = await _resolve_id(db, "markets", market_code)
    if not market_id:
        return None, None

    # outcome pertence ao mercado
    result = await db.execute(text("""
        SELECT id::text FROM outcomes
        WHERE market_id = :mid AND code = :ocode
        LIMIT 1
    """), {"mid": market_id, "ocode": outcome_code})
    outcome_id = result.scalar()
    return market_id, outcome_id


# ═══════════════════════════════════════════════════════════════════════════
# Mapeamento interno market/outcome ↔ códigos do banco
# ═══════════════════════════════════════════════════════════════════════════

# Os modelos usam nomes internos (match_result, home, draw, away, etc.)
# O banco usa códigos (1x2, home, draw, away, etc.)
# Este mapeamento permite a tradução.
_MARKET_CODE_MAP = {
    "match_result": "1x2",
    "over_under_2_5": "ou",
    "btts": "btts",
    "double_chance": "double_chance",
    "correct_score": "correct_score",
    "dnb": "dnb",
    "ah": "ah",
    "team_totals": "team_totals",
}

_OUTCOME_CODE_MAP = {
    # 1x2
    "home": "home",
    "draw": "draw",
    "away": "away",
    # double chance
    "1X": "home_or_draw",
    "12": "home_or_away",
    "X2": "away_or_draw",
    # btts
    "yes": "yes",
    "no": "no",
    # over/under
    "over": "over",
    "under": "under",
}


def _map_market_code(internal: str) -> str:
    """Converte nome interno do modelo para código do banco."""
    return _MARKET_CODE_MAP.get(internal, internal)


def _map_outcome_code(internal: str) -> str:
    """Converte nome interno do outcome para código do banco."""
    return _OUTCOME_CODE_MAP.get(internal, internal)


# ═══════════════════════════════════════════════════════════════════════════
# Registro de model_versions
# ═══════════════════════════════════════════════════════════════════════════

async def _register_model_version(
    db: AsyncSession,
    model: StatModel,
    sport_id: str,
    cutoff_date: datetime,
    training_metrics: dict,
) -> str:
    """Registra (ou busca existente) uma model_version no banco. Retorna o UUID."""
    # Verifica se já existe para evitar duplicatas
    existing = await db.execute(text("""
        SELECT id::text FROM model_versions
        WHERE model_name = :name AND version = :ver
        LIMIT 1
    """), {"name": model.name, "ver": model.version})
    row = existing.scalar()
    if row:
        # Atualiza cutoff e métricas se já existe
        await db.execute(text("""
            UPDATE model_versions
            SET training_data_cutoff = :cutoff,
                trained_at = :trained_at,
                metrics = :metrics,
                training_metrics = :training_metrics,
                hyperparameters = :hyperparams,
                status = 'production'
            WHERE model_name = :name AND version = :ver
        """), {
            "cutoff": cutoff_date,
            "trained_at": datetime.utcnow(),
            "metrics": "{}",
            "training_metrics": str(training_metrics).replace("'", '"') if training_metrics else "{}",
            "hyperparams": str(model.get_params()).replace("'", '"') if model.get_params() else "{}",
            "name": model.name,
            "ver": model.version,
        })
        await db.commit()
        return row

    mv_id = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO model_versions (
            id, model_name, version, sport_id, algorithm,
            training_data_cutoff, trained_at, features_version,
            hyperparameters, metrics, training_metrics, status
        ) VALUES (
            :id, :name, :ver, :sport_id, :algo,
            :cutoff, :trained_at, :fv,
            :hyperparams::jsonb, :metrics::jsonb, :training_metrics::jsonb, 'production'
        )
    """), {
        "id": mv_id,
        "name": model.name,
        "ver": model.version,
        "sport_id": sport_id,
        "algo": model.name,
        "cutoff": cutoff_date,
        "trained_at": datetime.utcnow(),
        "fv": FEATURES_VERSION,
        "hyperparams": "{}",
        "metrics": "{}",
        "training_metrics": "{}",
    })
    await db.commit()
    return mv_id


# ═══════════════════════════════════════════════════════════════════════════
# Persistência de predições
# ═══════════════════════════════════════════════════════════════════════════

async def _persist_prediction(
    db: AsyncSession,
    model_version_id: str,
    event_id: str,
    pred: PredictionResult,
    best_odds: float | None,
    best_bookmaker_id: str | None,
    edge: float | None,
    ev: float | None,
    edge_score: float | None,
    generated_at: datetime,
) -> str | None:
    """Persiste uma predição em model_predictions (append-only). Retorna o UUID."""
    market_code = _map_market_code(pred.market)
    outcome_code = _map_outcome_code(pred.outcome)

    market_id, outcome_id = await _resolve_market_outcome_ids(
        db, market_code, outcome_code
    )
    if not market_id or not outcome_id:
        logger.warning(
            "Mercado/outcome não encontrado: %s/%s (códigos: %s/%s)",
            pred.market, pred.outcome, market_code, outcome_code,
        )
        return None

    pred_id = str(uuid.uuid4())
    features_snapshot = pred.features_used or {}

    await db.execute(text("""
        INSERT INTO model_predictions (
            id, model_version_id, event_id, market_id, outcome_id,
            probability, best_market_odds, best_bookmaker_id,
            edge, ev, edge_score, confidence,
            features_version, features_snapshot,
            is_pre_match, generated_at
        ) VALUES (
            :id, :mv_id, :event_id, :market_id, :outcome_id,
            :prob, :best_odds, :best_bookie,
            :edge, :ev, :edge_score, :confidence,
            :fv, :features::jsonb,
            true, :gen_at
        )
    """), {
        "id": pred_id,
        "mv_id": model_version_id,
        "event_id": event_id,
        "market_id": market_id,
        "outcome_id": outcome_id,
        "prob": pred.probability,
        "best_odds": best_odds,
        "best_bookie": best_bookmaker_id,
        "edge": edge,
        "ev": ev,
        "edge_score": edge_score,
        "confidence": pred.confidence,
        "fv": FEATURES_VERSION,
        "features": "{}",
        "gen_at": generated_at,
    })
    return pred_id


async def _persist_consensus(
    db: AsyncSession,
    event_id: str,
    pred: PredictionResult,
    method: str,
    model_count: int,
    contributing_ids: list[str],
    weights: dict | None,
    edge: float | None,
    ev: float | None,
    edge_score: float | None,
    generated_at: datetime,
) -> str | None:
    """Persiste predição de consenso em consensus_predictions."""
    market_code = _map_market_code(pred.market)
    outcome_code = _map_outcome_code(pred.outcome)

    market_id, outcome_id = await _resolve_market_outcome_ids(
        db, market_code, outcome_code
    )
    if not market_id or not outcome_id:
        return None

    cons_id = str(uuid.uuid4())
    variance = pred.features_used.get("ensemble_variance", 0) if pred.features_used else 0
    agreement = 1.0 - min(1.0, (variance or 0) / 0.25)

    # Array de UUIDs em formato PostgreSQL
    ids_literal = "{" + ",".join(contributing_ids) + "}"

    await db.execute(text("""
        INSERT INTO consensus_predictions (
            id, event_id, market_id, outcome_id,
            method, probability, model_count,
            contributing_model_version_ids,
            weights, model_agreement,
            edge, ev, edge_score,
            is_pre_match, generated_at
        ) VALUES (
            :id, :event_id, :market_id, :outcome_id,
            :method, :prob, :model_count,
            :contrib_ids::uuid[],
            :weights::jsonb, :agreement,
            :edge, :ev, :edge_score,
            true, :gen_at
        )
    """), {
        "id": cons_id,
        "event_id": event_id,
        "market_id": market_id,
        "outcome_id": outcome_id,
        "method": method,
        "prob": pred.probability,
        "model_count": model_count,
        "contrib_ids": ids_literal,
        "weights": str(weights or {}).replace("'", '"'),
        "agreement": agreement,
        "edge": edge,
        "ev": ev,
        "edge_score": edge_score,
        "gen_at": generated_at,
    })
    return cons_id


async def _persist_value_opportunity(
    db: AsyncSession,
    event_id: str,
    pred: PredictionResult,
    model_version_id: str | None,
    consensus_id: str | None,
    prediction_id: str | None,
    prediction_generated_at: datetime | None,
    bookmaker_id: str,
    decimal_odds: float,
    fair_prob: float,
    model_prob: float,
    edge: float,
    ev: float,
    edge_score_val: float,
    kelly_pct: float,
    n_bookmakers: int,
    kickoff_at: datetime,
    model_source: str,
) -> str | None:
    """Persiste uma oportunidade de valor em value_opportunities."""
    market_code = _map_market_code(pred.market)
    outcome_code = _map_outcome_code(pred.outcome)

    market_id, outcome_id = await _resolve_market_outcome_ids(
        db, market_code, outcome_code
    )
    if not market_id or not outcome_id:
        return None

    opp_id = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO value_opportunities (
            id, event_id, market_id, outcome_id, bookmaker_id,
            model_version_id, consensus_prediction_id,
            model_prediction_id, model_prediction_generated_at,
            model_source,
            decimal_odds, implied_probability,
            fair_probability, model_probability,
            edge, ev, edge_score, confidence,
            kelly_stake_pct, bookmakers_analyzed,
            status, detected_at, expires_at
        ) VALUES (
            :id, :event_id, :market_id, :outcome_id, :bookmaker_id,
            :mv_id, :cons_id,
            :pred_id, :pred_gen_at,
            :model_source,
            :dec_odds, :implied_prob,
            :fair_prob, :model_prob,
            :edge, :ev, :edge_score, :confidence,
            :kelly, :n_books,
            'active', :detected_at, :expires_at
        )
    """), {
        "id": opp_id,
        "event_id": event_id,
        "market_id": market_id,
        "outcome_id": outcome_id,
        "bookmaker_id": bookmaker_id,
        "mv_id": model_version_id,
        "cons_id": consensus_id,
        "pred_id": prediction_id,
        "pred_gen_at": prediction_generated_at,
        "model_source": model_source,
        "dec_odds": decimal_odds,
        "implied_prob": 1.0 / decimal_odds,
        "fair_prob": fair_prob,
        "model_prob": model_prob,
        "edge": edge,
        "ev": ev,
        "edge_score": edge_score_val,
        "confidence": pred.confidence,
        "kelly": kelly_pct,
        "n_books": n_bookmakers,
        "detected_at": datetime.utcnow(),
        "expires_at": kickoff_at,
    })
    return opp_id


# ═══════════════════════════════════════════════════════════════════════════
# Grading — atualiza status de value_opportunities após resultado
# ═══════════════════════════════════════════════════════════════════════════

async def grade_value_opportunities(db: AsyncSession) -> int:
    """Atualiza status de value_opportunities para eventos finalizados.

    Usa fn_outcome_won para derivar o resultado e atualiza:
    - active → result_won / result_lost / result_void

    Retorna o número de oportunidades atualizadas.
    """
    result = await db.execute(text("""
        UPDATE value_opportunities vo
        SET status = CASE
                WHEN fn_outcome_won(m.code, oc.code, oc.line, e.home_score, e.away_score) = true
                    THEN 'result_won'
                WHEN fn_outcome_won(m.code, oc.code, oc.line, e.home_score, e.away_score) = false
                    THEN 'result_lost'
                ELSE 'result_void'
            END,
            resolved_at = now()
        FROM events e
        JOIN markets m ON m.id = vo.market_id
        JOIN outcomes oc ON oc.id = vo.outcome_id
        WHERE e.id = vo.event_id
          AND e.status = 'finished'
          AND vo.status = 'active'
        RETURNING vo.id
    """))
    updated = result.fetchall()
    if updated:
        await db.commit()
    return len(updated)


# ═══════════════════════════════════════════════════════════════════════════
# Model Performance — agrega métricas por janela temporal
# ═══════════════════════════════════════════════════════════════════════════

async def compute_model_performance(
    db: AsyncSession,
    model_version_id: str,
    period_start: datetime,
    period_end: datetime,
) -> dict | None:
    """Calcula e persiste métricas de performance para um model_version.

    Usa fn_grade_prediction para derivar won/brier_component (NUNCA armazena
    em model_predictions — grading é sempre derivado).
    """
    # Busca predições no período com grading derivado
    result = await db.execute(text("""
        SELECT
            mp.id, mp.probability, mp.edge, mp.ev,
            mp.generated_at,
            (fn_grade_prediction(mp.id, mp.generated_at)).won AS won,
            (fn_grade_prediction(mp.id, mp.generated_at)).brier_component AS brier_component
        FROM model_predictions mp
        JOIN events e ON e.id = mp.event_id
        WHERE mp.model_version_id = :mv_id
          AND mp.generated_at >= :start
          AND mp.generated_at < :end_dt
          AND e.status = 'finished'
    """), {
        "mv_id": model_version_id,
        "start": period_start,
        "end_dt": period_end,
    })
    rows = result.mappings().all()
    graded = [r for r in rows if r["won"] is not None]

    if not graded:
        return None

    sample_size = len(graded)
    avg_brier = sum(float(r["brier_component"]) for r in graded) / sample_size
    hit_rate = sum(1 for r in graded if r["won"]) / sample_size
    avg_edge = sum(float(r["edge"] or 0) for r in graded) / sample_size

    # Log loss
    import math
    eps = 1e-15
    log_loss = -sum(
        math.log(max(eps, float(r["probability"]))) if r["won"]
        else math.log(max(eps, 1.0 - float(r["probability"])))
        for r in graded
    ) / sample_size

    perf_id = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO model_performance (
            id, model_version_id, market_id, period_start, period_end,
            sample_size, brier_score, log_loss,
            hit_rate, avg_edge, roi_method,
            is_walk_forward, computed_at
        ) VALUES (
            :id, :mv_id, NULL, :start, :end_dt,
            :n, :brier, :log_loss,
            :hit_rate, :avg_edge, 'flat_stake',
            false, now()
        )
        ON CONFLICT (model_version_id, market_id, period_start, period_end, roi_method)
        DO UPDATE SET
            sample_size = EXCLUDED.sample_size,
            brier_score = EXCLUDED.brier_score,
            log_loss = EXCLUDED.log_loss,
            hit_rate = EXCLUDED.hit_rate,
            avg_edge = EXCLUDED.avg_edge,
            computed_at = EXCLUDED.computed_at
    """), {
        "id": perf_id,
        "mv_id": model_version_id,
        "start": period_start,
        "end_dt": period_end,
        "n": sample_size,
        "brier": avg_brier,
        "log_loss": log_loss,
        "hit_rate": hit_rate,
        "avg_edge": avg_edge,
    })
    await db.commit()

    return {
        "sample_size": sample_size,
        "brier_score": avg_brier,
        "log_loss": log_loss,
        "hit_rate": hit_rate,
        "avg_edge": avg_edge,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Orquestrador principal
# ═══════════════════════════════════════════════════════════════════════════

async def run_pipeline(
    db: AsyncSession,
    event_ids: list[str] | None = None,
    cutoff_date: datetime | None = None,
    ensemble_strategy: str = "simple_average",
) -> PipelineRunResult:
    """Executa o pipeline PREDIQ completo end-to-end.

    Args:
        db: Sessão SQLAlchemy async.
        event_ids: IDs de eventos específicos. Se None, processa todos os
            futuros com odds.
        cutoff_date: Data de corte para treino. Se None, usa now().
        ensemble_strategy: Estratégia do ensemble ('simple_average',
            'weighted_average', 'stacking').

    Returns:
        PipelineRunResult com métricas consolidadas da execução.
    """
    run = PipelineRunResult()
    now = datetime.utcnow()
    cutoff = cutoff_date or now

    logger.info("Pipeline PREDIQ iniciado — run_id=%s, cutoff=%s", run.run_id, cutoff)

    # ──────────────────────────────────────────────────────────────────────
    # 1. BUSCAR EVENTOS ELEGÍVEIS
    # ──────────────────────────────────────────────────────────────────────
    events = await _fetch_scheduled_events_with_odds(db, event_ids)
    if not events:
        run.errors.append("Nenhum evento futuro com odds encontrado.")
        run.finished_at = datetime.utcnow()
        logger.warning("Pipeline: nenhum evento elegível.")
        return run

    logger.info("Pipeline: %d eventos elegíveis.", len(events))

    # ──────────────────────────────────────────────────────────────────────
    # 2. BUSCAR HISTÓRICO DE TREINO
    # ──────────────────────────────────────────────────────────────────────
    matches = await _fetch_finished_matches(db, cutoff)
    logger.info("Pipeline: %d partidas finalizadas para treino.", len(matches))

    if len(matches) < MIN_TRAINING_MATCHES:
        run.errors.append(
            f"Histórico insuficiente: {len(matches)} partidas (mínimo: {MIN_TRAINING_MATCHES})."
        )
        run.finished_at = datetime.utcnow()
        return run

    # Buscar sport_id do primeiro evento
    sport_id = events[0].get("sport_id", "")
    if not sport_id:
        sport_result = await db.execute(text(
            "SELECT id::text FROM sports WHERE code = 'football' LIMIT 1"
        ))
        sport_id = sport_result.scalar() or ""

    # ──────────────────────────────────────────────────────────────────────
    # 3. TREINAR MODELOS
    # ──────────────────────────────────────────────────────────────────────
    models: list[StatModel] = []
    model_version_ids: dict[str, str] = {}  # model_name → model_version_id

    # 3a. Poisson
    try:
        poisson = PoissonModel()
        poisson_metrics = poisson.train(matches, cutoff)
        mv_id = await _register_model_version(db, poisson, sport_id, cutoff, poisson_metrics)
        models.append(poisson)
        model_version_ids[poisson.name] = mv_id
        run.model_versions_created.append(f"{poisson.name}:{poisson.version}")
        logger.info("Poisson treinado: %s", poisson_metrics)
    except Exception as e:
        run.errors.append(f"Erro ao treinar Poisson: {e}")
        logger.exception("Falha no treino do Poisson")

    # 3b. Dixon-Coles
    try:
        dixon = DixonColesModel()
        dixon_metrics = dixon.train(matches, cutoff)
        mv_id = await _register_model_version(db, dixon, sport_id, cutoff, dixon_metrics)
        models.append(dixon)
        model_version_ids[dixon.name] = mv_id
        run.model_versions_created.append(f"{dixon.name}:{dixon.version}")
        logger.info("Dixon-Coles treinado: %s", dixon_metrics)
    except Exception as e:
        run.errors.append(f"Erro ao treinar Dixon-Coles: {e}")
        logger.exception("Falha no treino do Dixon-Coles")

    # 3c. Elo
    try:
        elo = EloModel()
        elo_metrics = elo.train(matches, cutoff)
        mv_id = await _register_model_version(db, elo, sport_id, cutoff, elo_metrics)
        models.append(elo)
        model_version_ids[elo.name] = mv_id
        run.model_versions_created.append(f"{elo.name}:{elo.version}")
        logger.info("Elo treinado: %s", elo_metrics)
    except Exception as e:
        run.errors.append(f"Erro ao treinar Elo: {e}")
        logger.exception("Falha no treino do Elo")

    # 3d. MarketConsensus (não precisa de treino com dados — configura método)
    try:
        market_cons = MarketConsensusModel(method="shin")
        mc_metrics = market_cons.train({"method": "shin"}, cutoff)
        mv_id = await _register_model_version(db, market_cons, sport_id, cutoff, mc_metrics)
        models.append(market_cons)
        model_version_ids[market_cons.name] = mv_id
        run.model_versions_created.append(f"{market_cons.name}:{market_cons.version}")
        logger.info("MarketConsensus configurado: %s", mc_metrics)
    except Exception as e:
        run.errors.append(f"Erro ao configurar MarketConsensus: {e}")
        logger.exception("Falha na configuração do MarketConsensus")

    # 3e. GradientBoost
    try:
        gb = GradientBoostModel(backend="xgboost")
        gb_metrics = gb.train(matches, cutoff)
        mv_id = await _register_model_version(db, gb, sport_id, cutoff, gb_metrics)
        models.append(gb)
        model_version_ids[gb.name] = mv_id
        run.model_versions_created.append(f"{gb.name}:{gb.version}")
        logger.info("GradientBoost treinado: %s", gb_metrics)
    except Exception as e:
        run.errors.append(f"Erro ao treinar GradientBoost: {e}")
        logger.exception("Falha no treino do GradientBoost")

    if not models:
        run.errors.append("Nenhum modelo treinado com sucesso — pipeline abortado.")
        run.finished_at = datetime.utcnow()
        return run

    # 3f. Ensemble (combina os modelos treinados)
    ensemble = EnsembleModel(strategy=ensemble_strategy)
    for m in models:
        ensemble.add_member(m)
    ensemble.train({}, cutoff)  # simple_average não precisa de dados
    ens_mv_id = await _register_model_version(db, ensemble, sport_id, cutoff, {})
    model_version_ids[ensemble.name] = ens_mv_id

    # ──────────────────────────────────────────────────────────────────────
    # 4. GERAR PREDIÇÕES PARA CADA EVENTO
    # ──────────────────────────────────────────────────────────────────────
    for event in events:
        evt_result = PipelineResult(event_id=event["event_id"])
        generated_at = datetime.utcnow()

        try:
            # Buscar odds do evento para MarketConsensus e value engine
            event_odds = await _fetch_event_odds(db, event["event_id"])

            # Calcular fair probabilities UMA VEZ por evento, usando vig
            # removal centralizado (Shin + fallback multiplicative).
            # fair_probs_map: {market_code: {outcome_code: fair_probability}}
            fair_probs_map = compute_fair_probs_for_event(event_odds, method="shin")

            # Buscar histórico para GradientBoost
            home_history = await _fetch_team_match_history(
                db, event["home_team_id"], event["kickoff_at"]
            )
            away_history = await _fetch_team_match_history(
                db, event["away_team_id"], event["kickoff_at"]
            )

            # Montar event_data base
            event_data: dict[str, Any] = {
                "home_team_id": event["home_team_id"],
                "away_team_id": event["away_team_id"],
                "kickoff_at": event["kickoff_at"],
                "match_history_home": home_history,
                "match_history_away": away_history,
            }

            # Adicionar ratings Elo se disponíveis
            elo_model = next((m for m in models if m.name == "elo"), None)
            if elo_model and hasattr(elo_model, "ratings"):
                event_data["elo_ratings"] = elo_model.ratings

            # ─── 4a. Predições de cada modelo base ─────────────────────
            all_predictions: dict[str, list[PredictionResult]] = {}

            for model in models:
                try:
                    if model.name == "market_consensus":
                        # MarketConsensus precisa de odds de mercado
                        for market_code, bookmaker_odds in event_odds.items():
                            mc_data = {
                                "market": market_code,
                                "bookmaker_odds": bookmaker_odds,
                            }
                            preds = model.predict(mc_data, cutoff)
                            all_predictions.setdefault(model.name, []).extend(preds)
                    elif model.name == "gradient_boost":
                        preds = model.predict(event_data, cutoff)
                        all_predictions[model.name] = preds
                    else:
                        preds = model.predict(event_data, cutoff)
                        all_predictions[model.name] = preds

                    evt_result.models_trained.append(model.name)

                except Exception as e:
                    evt_result.errors.append(f"Erro predict {model.name}: {e}")
                    logger.warning(
                        "Falha na predição do %s para evento %s: %s",
                        model.name, event["event_id"], e,
                    )

            # ─── 4b. Persistir predições individuais ───────────────────
            for model_name, preds in all_predictions.items():
                mv_id = model_version_ids.get(model_name)
                if not mv_id:
                    continue

                for pred in preds:
                    # Buscar melhor odd para este mercado/outcome
                    market_code = _map_market_code(pred.market)
                    outcome_code = _map_outcome_code(pred.outcome)
                    best_odds, best_bookie_id, _ = await _fetch_best_odds(
                        db, event["event_id"], market_code, outcome_code
                    )

                    # Calcular edge, ev, edge_score usando fair probability
                    # centralizada (com remoção de vig via Shin)
                    edge_val = None
                    ev_val = None
                    es_val = None

                    if best_odds and best_odds > 1.0:
                        # Fair prob do serviço centralizado (vig removido)
                        fair_market_prob = (
                            fair_probs_map
                            .get(market_code, {})
                            .get(outcome_code)
                        )
                        if fair_market_prob is None or fair_market_prob <= 0:
                            # Fallback: implied probability bruta (sem vig removal)
                            fair_market_prob = implied_probability(best_odds)

                        edge_val = calculate_edge(pred.probability, fair_market_prob)
                        ev_val = calculate_ev(pred.probability, best_odds)

                        # Overround do mercado para componente M do Edge Score
                        mkt_overround = compute_market_overround(
                            event_odds.get(market_code, {})
                        )

                        es_val = calculate_edge_score(
                            edge=edge_val,
                            expected_value=ev_val,
                            model_confidence=pred.confidence or 0.5,
                            market_overround=mkt_overround if mkt_overround > 0 else None,
                        )

                    pred_id = await _persist_prediction(
                        db, mv_id, event["event_id"], pred,
                        best_odds, best_bookie_id,
                        edge_val, ev_val, es_val, generated_at,
                    )
                    if pred_id:
                        evt_result.predictions_generated += 1

                        # ─── 4c. Value opportunity se edge > threshold ──
                        if (
                            edge_val is not None
                            and edge_val > MIN_EDGE_THRESHOLD
                            and ev_val is not None
                            and ev_val > 0
                            and best_odds
                            and best_bookie_id
                        ):
                            kelly_pct = fractional_kelly(
                                pred.probability, best_odds, fraction=0.25
                            )
                            # Fair probability centralizada (vig removido)
                            fair_prob = (
                                fair_probs_map
                                .get(market_code, {})
                                .get(outcome_code)
                            )
                            if fair_prob is None or fair_prob <= 0:
                                fair_prob = implied_probability(best_odds)
                            n_books = len(event_odds.get(market_code, {}))

                            opp_id = await _persist_value_opportunity(
                                db,
                                event_id=event["event_id"],
                                pred=pred,
                                model_version_id=mv_id,
                                consensus_id=None,
                                prediction_id=pred_id,
                                prediction_generated_at=generated_at,
                                bookmaker_id=best_bookie_id,
                                decimal_odds=best_odds,
                                fair_prob=fair_prob,
                                model_prob=pred.probability,
                                edge=edge_val,
                                ev=ev_val,
                                edge_score_val=es_val or 0,
                                kelly_pct=kelly_pct,
                                n_bookmakers=max(1, n_books),
                                kickoff_at=event["kickoff_at"],
                                model_source=f"{model_name}:{next((m.version for m in models if m.name == model_name), '?')}",
                            )
                            if opp_id:
                                evt_result.value_opportunities_created += 1

            # ─── 4d. Ensemble: combinar predições ─────────────────────
            if len(all_predictions) >= 2:
                try:
                    ens_preds = ensemble.predict(event_data, cutoff)
                    ens_mv_id = model_version_ids.get("ensemble", "")
                    contributing_ids = [
                        model_version_ids[m.name]
                        for m in models
                        if m.name in model_version_ids
                    ]

                    for pred in ens_preds:
                        market_code = _map_market_code(pred.market)
                        outcome_code = _map_outcome_code(pred.outcome)
                        best_odds, best_bookie_id, _ = await _fetch_best_odds(
                            db, event["event_id"], market_code, outcome_code
                        )

                        edge_val = None
                        ev_val = None
                        es_val = None
                        if best_odds and best_odds > 1.0:
                            # Fair probability centralizada (vig removido)
                            fair_prob = (
                                fair_probs_map
                                .get(market_code, {})
                                .get(outcome_code)
                            )
                            if fair_prob is None or fair_prob <= 0:
                                fair_prob = implied_probability(best_odds)

                            edge_val = calculate_edge(pred.probability, fair_prob)
                            ev_val = calculate_ev(pred.probability, best_odds)

                            mkt_overround = compute_market_overround(
                                event_odds.get(market_code, {})
                            )

                            es_val = calculate_edge_score(
                                edge=edge_val,
                                expected_value=ev_val,
                                model_confidence=pred.confidence or 0.5,
                                ensemble_variance=pred.features_used.get("ensemble_variance") if pred.features_used else None,
                                market_overround=mkt_overround if mkt_overround > 0 else None,
                            )

                        weights_dict = {
                            m.model.name: m.weight for m in ensemble.members
                        }

                        cons_id = await _persist_consensus(
                            db, event["event_id"], pred,
                            method=ensemble_strategy,
                            model_count=len(contributing_ids),
                            contributing_ids=contributing_ids,
                            weights=weights_dict,
                            edge=edge_val,
                            ev=ev_val,
                            edge_score=es_val,
                            generated_at=generated_at,
                        )
                        if cons_id:
                            evt_result.consensus_generated += 1

                            # Value opportunity do ensemble
                            if (
                                edge_val is not None
                                and edge_val > MIN_EDGE_THRESHOLD
                                and ev_val is not None
                                and ev_val > 0
                                and best_odds
                                and best_bookie_id
                            ):
                                kelly_pct = fractional_kelly(
                                    pred.probability, best_odds, fraction=0.25
                                )
                                # Fair probability centralizada (vig removido)
                                fair_prob = (
                                    fair_probs_map
                                    .get(market_code, {})
                                    .get(outcome_code)
                                )
                                if fair_prob is None or fair_prob <= 0:
                                    fair_prob = implied_probability(best_odds)
                                n_books = len(event_odds.get(market_code, {}))

                                opp_id = await _persist_value_opportunity(
                                    db,
                                    event_id=event["event_id"],
                                    pred=pred,
                                    model_version_id=None,
                                    consensus_id=cons_id,
                                    prediction_id=None,
                                    prediction_generated_at=None,
                                    bookmaker_id=best_bookie_id,
                                    decimal_odds=best_odds,
                                    fair_prob=fair_prob,
                                    model_prob=pred.probability,
                                    edge=edge_val,
                                    ev=ev_val,
                                    edge_score_val=es_val or 0,
                                    kelly_pct=kelly_pct,
                                    n_bookmakers=max(1, n_books),
                                    kickoff_at=event["kickoff_at"],
                                    model_source=f"consensus:{ensemble_strategy}",
                                )
                                if opp_id:
                                    evt_result.value_opportunities_created += 1

                except Exception as e:
                    evt_result.errors.append(f"Erro ensemble: {e}")
                    logger.exception("Falha no ensemble para evento %s", event["event_id"])

            await db.commit()

        except Exception as e:
            evt_result.errors.append(f"Erro geral: {e}")
            logger.exception("Falha no processamento do evento %s", event["event_id"])

        run.event_results.append(evt_result)
        run.events_processed += 1
        run.total_predictions += evt_result.predictions_generated
        run.total_consensus += evt_result.consensus_generated
        run.total_value_opportunities += evt_result.value_opportunities_created

    # ──────────────────────────────────────────────────────────────────────
    # 5. GRADING — atualizar value_opportunities de eventos finalizados
    # ──────────────────────────────────────────────────────────────────────
    try:
        graded_count = await grade_value_opportunities(db)
        logger.info("Pipeline: %d value_opportunities atualizadas por grading.", graded_count)
    except Exception as e:
        run.errors.append(f"Erro no grading: {e}")
        logger.exception("Falha no grading")

    run.finished_at = datetime.utcnow()
    elapsed = (run.finished_at - run.started_at).total_seconds()
    logger.info(
        "Pipeline concluído em %.1fs — %d eventos, %d predições, %d consenso, %d oportunidades",
        elapsed, run.events_processed, run.total_predictions,
        run.total_consensus, run.total_value_opportunities,
    )

    return run


# ═══════════════════════════════════════════════════════════════════════════
# API endpoint para disparar o pipeline
# ═══════════════════════════════════════════════════════════════════════════

async def run_pipeline_standalone(
    event_ids: list[str] | None = None,
    cutoff_date: datetime | None = None,
) -> PipelineRunResult:
    """Entry point para executar o pipeline fora de uma request HTTP."""
    async with db_session_ctx() as db:
        return await run_pipeline(db, event_ids, cutoff_date)
