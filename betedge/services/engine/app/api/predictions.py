"""Endpoints de predições — consulta, geração e auditoria.

Consulta model_predictions (append-only) e consensus_predictions para
retornar predições por evento. A geração é assíncrona (enfileira no Celery).
Nenhuma predição é alterada após o kickoff — o grading é sempre DERIVADO
por fn_grade_prediction/v_prediction_results (ver 007_models_predictions.sql).
"""
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.deps import DbSession

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════
# Schemas
# ═══════════════════════════════════════════════════════════════════════════

class MarketType(StrEnum):
    """Mercados suportados pelo motor de predições."""
    MATCH_RESULT = "1x2"
    BOTH_TEAMS_TO_SCORE = "btts"
    OVER_UNDER = "ou"
    ASIAN_HANDICAP = "ah"
    DOUBLE_CHANCE = "double_chance"
    DRAW_NO_BET = "dnb"
    TEAM_TOTALS = "team_totals"


class PredictionDetail(BaseModel):
    """Predição individual de um modelo para um outcome."""
    prediction_id: UUID
    model_version_id: UUID
    model_name: str
    model_version: str
    algorithm: str | None = None
    market_name: str
    outcome_name: str
    probability: float = Field(ge=0.0, le=1.0)
    fair_odds: float | None = None
    edge: float | None = None
    ev: float | None = None
    edge_score: float | None = None
    confidence: float | None = None
    features_version: str
    features_snapshot: dict | None = None
    best_market_odds: float | None = None
    best_bookmaker: str | None = None
    is_pre_match: bool = True
    generated_at: datetime


class ConsensusSummary(BaseModel):
    """Predição de consenso (ensemble) para um outcome."""
    method: str
    probability: float = Field(ge=0.0, le=1.0)
    fair_odds: float | None = None
    model_count: int
    model_agreement: float | None = None
    edge: float | None = None
    ev: float | None = None
    edge_score: float | None = None
    generated_at: datetime


class GradingResult(BaseModel):
    """Resultado da liquidação de uma predição (derivado, nunca armazenado)."""
    won: bool | None = None  # None = evento não finalizado ou push
    brier_component: float | None = None


class EventPredictionsSummary(BaseModel):
    """Predições completas (modelos + consenso + grading) para um evento."""
    event_id: UUID
    predictions: list[PredictionDetail]
    consensus: list[ConsensusSummary] = []
    grading: dict[str, GradingResult] = Field(
        default_factory=dict,
        description="Mapa prediction_id -> resultado. Vazio se evento não finalizado.",
    )


class GeneratePredictionsRequest(BaseModel):
    """Payload para disparar geração de predições."""
    event_ids: list[UUID] | None = Field(
        default=None,
        description="IDs de eventos. Se omitido, processa todos os futuros elegíveis.",
    )
    model_version_ids: list[UUID] | None = Field(
        default=None,
        description="Modelos específicos. Se omitido, usa todos em status 'production'.",
    )


class GeneratePredictionsResponse(BaseModel):
    """Confirmação de enfileiramento."""
    events_queued: int
    models_queued: int
    status: str = "queued"
    message: str


class LatestPredictionRow(BaseModel):
    """Linha resumida de predição para listagem paginada."""
    prediction_id: UUID
    event_id: UUID
    home_team: str
    away_team: str
    league: str
    kickoff_at: datetime
    event_status: str
    model_name: str
    model_version: str
    market: str
    outcome: str
    probability: float
    fair_odds: float | None = None
    edge: float | None = None
    ev: float | None = None
    edge_score: float | None = None
    generated_at: datetime
    won: bool | None = None
    brier_component: float | None = None


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@router.get(
    "/{event_id}",
    response_model=EventPredictionsSummary,
    summary="Predições de todos os modelos para um evento",
)
async def get_event_predictions(event_id: UUID, db: DbSession) -> EventPredictionsSummary:
    """Retorna predições individuais, consenso e grading (se evento finalizado).

    As predições vêm de model_predictions (append-only). O grading é
    DERIVADO por fn_grade_prediction — nunca armazenado na tabela de predições.
    """
    # 1. Predições individuais (última gerada por modelo/mercado/outcome)
    pred_query = text("""
        WITH ranked AS (
            SELECT mp.*,
                   mv.model_name, mv.version AS model_version, mv.algorithm,
                   m.name AS market_name,
                   o.name AS outcome_name,
                   b.name AS best_bookmaker_name,
                   ROW_NUMBER() OVER (
                       PARTITION BY mp.model_version_id, mp.market_id, mp.outcome_id
                       ORDER BY mp.generated_at DESC
                   ) AS rn
            FROM model_predictions mp
            JOIN model_versions mv ON mv.id = mp.model_version_id
            JOIN markets m ON m.id = mp.market_id
            JOIN outcomes o ON o.id = mp.outcome_id
            LEFT JOIN bookmakers b ON b.id = mp.best_bookmaker_id
            WHERE mp.event_id = :event_id
        )
        SELECT * FROM ranked WHERE rn = 1
        ORDER BY market_name, outcome_name, model_name
    """)

    try:
        result = await db.execute(pred_query, {"event_id": str(event_id)})
        pred_rows = result.mappings().all()
    except Exception:
        pred_rows = []

    predictions = []
    for r in pred_rows:
        predictions.append(PredictionDetail(
            prediction_id=r["id"],
            model_version_id=r["model_version_id"],
            model_name=r["model_name"],
            model_version=r["model_version"],
            algorithm=r.get("algorithm"),
            market_name=r["market_name"],
            outcome_name=r["outcome_name"],
            probability=float(r["probability"]),
            fair_odds=float(r["fair_odds"]) if r.get("fair_odds") else None,
            edge=float(r["edge"]) if r.get("edge") else None,
            ev=float(r["ev"]) if r.get("ev") else None,
            edge_score=float(r["edge_score"]) if r.get("edge_score") else None,
            confidence=float(r["confidence"]) if r.get("confidence") else None,
            features_version=r["features_version"],
            features_snapshot=r.get("features_snapshot"),
            best_market_odds=float(r["best_market_odds"]) if r.get("best_market_odds") else None,
            best_bookmaker=r.get("best_bookmaker_name"),
            is_pre_match=r.get("is_pre_match", True),
            generated_at=r["generated_at"],
        ))

    # 2. Consenso
    cons_query = text("""
        WITH ranked AS (
            SELECT cp.*,
                   m.name AS market_name,
                   o.name AS outcome_name,
                   ROW_NUMBER() OVER (
                       PARTITION BY cp.market_id, cp.outcome_id, cp.method
                       ORDER BY cp.generated_at DESC
                   ) AS rn
            FROM consensus_predictions cp
            JOIN markets m ON m.id = cp.market_id
            JOIN outcomes o ON o.id = cp.outcome_id
            WHERE cp.event_id = :event_id
        )
        SELECT * FROM ranked WHERE rn = 1
    """)

    consensus_list = []
    try:
        cons_result = await db.execute(cons_query, {"event_id": str(event_id)})
        cons_rows = cons_result.mappings().all()
        for r in cons_rows:
            consensus_list.append(ConsensusSummary(
                method=r["method"],
                probability=float(r["probability"]),
                fair_odds=float(r["fair_odds"]) if r.get("fair_odds") else None,
                model_count=r["model_count"],
                model_agreement=float(r["model_agreement"]) if r.get("model_agreement") else None,
                edge=float(r["edge"]) if r.get("edge") else None,
                ev=float(r["ev"]) if r.get("ev") else None,
                edge_score=float(r["edge_score"]) if r.get("edge_score") else None,
                generated_at=r["generated_at"],
            ))
    except Exception:
        pass

    # 3. Grading (derivado — fn_grade_prediction)
    grading: dict[str, GradingResult] = {}
    for pred in predictions:
        try:
            grade_result = await db.execute(
                text("SELECT * FROM fn_grade_prediction(:pid, :gen_at)"),
                {"pid": str(pred.prediction_id), "gen_at": pred.generated_at},
            )
            grade_row = grade_result.mappings().first()
            if grade_row:
                grading[str(pred.prediction_id)] = GradingResult(
                    won=grade_row.get("won"),
                    brier_component=float(grade_row["brier_component"]) if grade_row.get("brier_component") is not None else None,
                )
        except Exception:
            pass

    return EventPredictionsSummary(
        event_id=event_id,
        predictions=predictions,
        consensus=consensus_list,
        grading=grading,
    )


@router.post(
    "/generate",
    response_model=GeneratePredictionsResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Enfileira geração de predições",
)
async def generate_predictions(
    payload: GeneratePredictionsRequest, db: DbSession
) -> GeneratePredictionsResponse:
    """Conta eventos/modelos elegíveis e retorna o que SERIA enfileirado.

    Em produção, publicará task no Celery. Por enquanto, retorna a contagem
    para validação do pipeline sem efeitos colaterais.
    """
    # Contar eventos elegíveis (futuros, com odds)
    event_filter = ""
    params: dict = {}
    if payload.event_ids:
        event_filter = "AND e.id = ANY(:event_ids)"
        params["event_ids"] = [str(eid) for eid in payload.event_ids]

    try:
        ev_result = await db.execute(text(f"""
            SELECT COUNT(DISTINCT e.id) AS cnt
            FROM events e
            JOIN odds o ON o.event_id = e.id
            WHERE e.status = 'scheduled'
              AND e.kickoff_at > now()
              {event_filter}
        """), params)
        event_count = ev_result.scalar() or 0
    except Exception:
        event_count = 0

    # Contar modelos ativos
    model_filter = ""
    if payload.model_version_ids:
        model_filter = "AND id = ANY(:model_ids)"
        params["model_ids"] = [str(mid) for mid in payload.model_version_ids]

    try:
        mod_result = await db.execute(text(f"""
            SELECT COUNT(*) AS cnt
            FROM model_versions
            WHERE status IN ('production', 'active')
              {model_filter}
        """), params)
        model_count = mod_result.scalar() or 0
    except Exception:
        model_count = 0

    if event_count == 0:
        return GeneratePredictionsResponse(
            events_queued=0,
            models_queued=0,
            status="empty",
            message="Nenhum evento futuro com odds encontrado para gerar predições.",
        )

    if model_count == 0:
        return GeneratePredictionsResponse(
            events_queued=event_count,
            models_queued=0,
            status="no_models",
            message="Eventos encontrados, mas nenhum modelo em status 'production'. Treine e promova um modelo primeiro.",
        )

    # TODO(fase 2): publicar task Celery aqui
    # from tasks.generate_predictions import generate_predictions_task
    # job = generate_predictions_task.delay(event_ids=..., model_ids=...)

    return GeneratePredictionsResponse(
        events_queued=event_count,
        models_queued=model_count,
        status="ready",
        message=f"{event_count} eventos × {model_count} modelos prontos para geração. "
                f"Pipeline Celery será ativado na próxima fase.",
    )


@router.get(
    "/latest",
    response_model=list[LatestPredictionRow],
    summary="Últimas predições com filtros e grading",
)
async def get_latest_predictions(
    db: DbSession,
    event_status: str | None = Query(default=None, description="scheduled, finished, all"),
    league_id: UUID | None = Query(default=None),
    model_version_id: UUID | None = Query(default=None),
    market_id: UUID | None = Query(default=None),
    min_edge: float | None = Query(default=None, description="Edge mínimo (ex: 0.02 = 2%)"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[LatestPredictionRow]:
    """Lista predições mais recentes com dados do evento, modelo e grading derivado.

    O grading (won, brier_component) é calculado no momento da consulta via
    fn_outcome_won — nunca armazenado em model_predictions.
    """
    conditions = []
    params: dict = {"limit": limit, "offset": offset}

    if event_status and event_status != "all":
        conditions.append("e.status = :event_status")
        params["event_status"] = event_status
    if league_id:
        conditions.append("e.league_id = :league_id")
        params["league_id"] = str(league_id)
    if model_version_id:
        conditions.append("mp.model_version_id = :model_version_id")
        params["model_version_id"] = str(model_version_id)
    if market_id:
        conditions.append("mp.market_id = :market_id")
        params["market_id"] = str(market_id)
    if min_edge is not None:
        conditions.append("mp.edge >= :min_edge")
        params["min_edge"] = min_edge

    where_clause = " AND ".join(conditions) if conditions else "TRUE"

    query = text(f"""
        SELECT
            mp.id AS prediction_id,
            mp.event_id,
            ht.name AS home_team,
            at.name AS away_team,
            l.name AS league,
            e.kickoff_at,
            e.status AS event_status,
            e.home_score,
            e.away_score,
            mv.model_name,
            mv.version AS model_version,
            m.name AS market,
            m.code AS market_code,
            o.name AS outcome,
            o.code AS outcome_code,
            o.line,
            mp.probability,
            mp.fair_odds,
            mp.edge,
            mp.ev,
            mp.edge_score,
            mp.generated_at,
            -- Grading derivado inline (sem chamar fn_grade_prediction por row)
            CASE WHEN e.status = 'finished' THEN
                fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score)
            END AS won,
            CASE WHEN e.status = 'finished' THEN
                POWER(
                    mp.probability - CASE WHEN fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) THEN 1 ELSE 0 END,
                    2
                )
            END AS brier_component
        FROM model_predictions mp
        JOIN model_versions mv ON mv.id = mp.model_version_id
        JOIN events e ON e.id = mp.event_id
        JOIN teams ht ON ht.id = e.home_team_id
        JOIN teams at ON at.id = e.away_team_id
        JOIN leagues l ON l.id = e.league_id
        JOIN markets m ON m.id = mp.market_id
        JOIN outcomes o ON o.id = mp.outcome_id
        WHERE {where_clause}
        ORDER BY mp.generated_at DESC
        LIMIT :limit OFFSET :offset
    """)

    try:
        result = await db.execute(query, params)
        rows = result.mappings().all()
    except Exception:
        return []

    return [
        LatestPredictionRow(
            prediction_id=r["prediction_id"],
            event_id=r["event_id"],
            home_team=r["home_team"],
            away_team=r["away_team"],
            league=r["league"],
            kickoff_at=r["kickoff_at"],
            event_status=r["event_status"],
            model_name=r["model_name"],
            model_version=r["model_version"],
            market=r["market"],
            outcome=r["outcome"],
            probability=float(r["probability"]),
            fair_odds=float(r["fair_odds"]) if r.get("fair_odds") else None,
            edge=float(r["edge"]) if r.get("edge") else None,
            ev=float(r["ev"]) if r.get("ev") else None,
            edge_score=float(r["edge_score"]) if r.get("edge_score") else None,
            generated_at=r["generated_at"],
            won=r.get("won"),
            brier_component=float(r["brier_component"]) if r.get("brier_component") is not None else None,
        )
        for r in rows
    ]
