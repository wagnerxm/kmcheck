"""Endpoints de gestão de modelos e métricas de performance.

Consulta model_versions, model_performance e calcula métricas agregadas
a partir de v_prediction_results (grading derivado de events, nunca
armazenado em model_predictions).
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.deps import DbSession

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════
# Schemas
# ═══════════════════════════════════════════════════════════════════════════

class ModelSummary(BaseModel):
    """Resumo de uma versão de modelo."""
    id: UUID
    model_name: str
    version: str
    algorithm: str | None = None
    status: str
    feature_set_version: str | None = None
    training_data_cutoff: datetime
    trained_at: datetime | None = None
    training_metrics: dict = Field(default_factory=dict)
    hyperparameters: dict = Field(default_factory=dict)
    prediction_count: int = 0
    created_at: datetime


class ModelPerformanceMetrics(BaseModel):
    """Métricas de performance detalhadas (agregadas ou por período)."""
    model_version_id: UUID
    model_name: str
    version: str
    period_start: datetime | None = None
    period_end: datetime | None = None
    sample_size: int
    # Calibração
    brier_score: float | None = None
    brier_skill_score: float | None = None
    log_loss: float | None = None
    calibration_error: float | None = None  # ECE
    # Rentabilidade
    hit_rate: float | None = None
    roi_flat: float | None = None
    clv_mean: float | None = None
    clv_positive_pct: float | None = None
    # Risco
    avg_edge: float | None = None
    avg_odds: float | None = None
    max_drawdown: float | None = None
    sharpe_ratio: float | None = None
    # Metadados
    is_walk_forward: bool = True
    computed_at: datetime


class ReliabilityCurvePoint(BaseModel):
    """Ponto da curva de confiabilidade (calibração)."""
    bin_lower: float
    bin_upper: float
    bin_midpoint: float
    mean_predicted: float
    mean_observed: float
    count: int


class ReliabilityCurveResponse(BaseModel):
    """Curva de confiabilidade completa + métricas resumo."""
    model_version_id: UUID
    model_name: str
    points: list[ReliabilityCurvePoint]
    ece: float | None = None
    mce: float | None = None
    sample_size: int


class PerformanceTimeSeriesPoint(BaseModel):
    """Ponto de série temporal de performance."""
    period_start: datetime
    period_end: datetime
    brier_score: float | None = None
    roi_flat: float | None = None
    clv_mean: float | None = None
    hit_rate: float | None = None
    sample_size: int


class DrawdownPoint(BaseModel):
    """Ponto de drawdown na curva de equity."""
    period: str
    equity: float
    peak: float
    drawdown_pct: float


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@router.get(
    "",
    response_model=list[ModelSummary],
    summary="Lista todas as versões de modelo",
)
async def list_models(
    db: DbSession,
    status_filter: str | None = Query(
        default=None, alias="status",
        description="Filtrar por status: production, active, shadow, deprecated, all",
    ),
) -> list[ModelSummary]:
    """Lista modelos registrados com contagem de predições."""
    conditions = []
    params: dict = {}

    if status_filter and status_filter != "all":
        conditions.append("mv.status = :status")
        params["status"] = status_filter

    where_clause = " AND ".join(conditions) if conditions else "TRUE"

    query = text(f"""
        SELECT
            mv.*,
            COALESCE(pc.cnt, 0) AS prediction_count
        FROM model_versions mv
        LEFT JOIN (
            SELECT model_version_id, COUNT(*) AS cnt
            FROM model_predictions
            GROUP BY model_version_id
        ) pc ON pc.model_version_id = mv.id
        WHERE {where_clause}
        ORDER BY mv.created_at DESC
    """)

    try:
        result = await db.execute(query, params)
        rows = result.mappings().all()
    except Exception:
        return []

    return [
        ModelSummary(
            id=r["id"],
            model_name=r["model_name"],
            version=r["version"],
            algorithm=r.get("algorithm"),
            status=r["status"],
            feature_set_version=r.get("feature_set_version") or r.get("features_version"),
            training_data_cutoff=r["training_data_cutoff"],
            trained_at=r.get("trained_at"),
            training_metrics=r.get("training_metrics") or r.get("metrics") or {},
            hyperparameters=r.get("hyperparameters") or {},
            prediction_count=r["prediction_count"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.get(
    "/{model_version_id}",
    response_model=ModelSummary,
    summary="Detalhes de uma versão de modelo",
)
async def get_model(model_version_id: UUID, db: DbSession) -> ModelSummary:
    """Retorna detalhes completos de uma versão de modelo."""
    query = text("""
        SELECT mv.*,
               COALESCE(pc.cnt, 0) AS prediction_count
        FROM model_versions mv
        LEFT JOIN (
            SELECT model_version_id, COUNT(*) AS cnt
            FROM model_predictions
            WHERE model_version_id = :mvid
            GROUP BY model_version_id
        ) pc ON pc.model_version_id = mv.id
        WHERE mv.id = :mvid
    """)

    try:
        result = await db.execute(query, {"mvid": str(model_version_id)})
        r = result.mappings().first()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not r:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    return ModelSummary(
        id=r["id"],
        model_name=r["model_name"],
        version=r["version"],
        algorithm=r.get("algorithm"),
        status=r["status"],
        feature_set_version=r.get("feature_set_version") or r.get("features_version"),
        training_data_cutoff=r["training_data_cutoff"],
        trained_at=r.get("trained_at"),
        training_metrics=r.get("training_metrics") or r.get("metrics") or {},
        hyperparameters=r.get("hyperparameters") or {},
        prediction_count=r["prediction_count"],
        created_at=r["created_at"],
    )


@router.get(
    "/{model_version_id}/performance",
    response_model=ModelPerformanceMetrics,
    summary="Métricas agregadas de performance",
)
async def get_model_performance(
    model_version_id: UUID,
    db: DbSession,
    period_start: datetime | None = Query(default=None),
    period_end: datetime | None = Query(default=None),
) -> ModelPerformanceMetrics:
    """Calcula métricas de performance a partir de predições resolvidas.

    O grading é DERIVADO por fn_outcome_won no momento da consulta —
    nunca armazenado em model_predictions. Isso garante que nenhuma
    predição histórica pode ser alterada após o resultado da partida.
    """
    # Primeiro: tentar ler de model_performance (pré-calculado)
    mp_query = text("""
        SELECT * FROM model_performance
        WHERE model_version_id = :mvid
        ORDER BY computed_at DESC
        LIMIT 1
    """)

    try:
        mp_result = await db.execute(mp_query, {"mvid": str(model_version_id)})
        cached = mp_result.mappings().first()
    except Exception:
        cached = None

    if cached and cached.get("sample_size", 0) > 0:
        # Buscar nome do modelo
        mv_result = await db.execute(
            text("SELECT model_name, version FROM model_versions WHERE id = :mvid"),
            {"mvid": str(model_version_id)},
        )
        mv = mv_result.mappings().first()
        return ModelPerformanceMetrics(
            model_version_id=model_version_id,
            model_name=mv["model_name"] if mv else "unknown",
            version=mv["version"] if mv else "?",
            period_start=cached.get("period_start"),
            period_end=cached.get("period_end"),
            sample_size=cached["sample_size"],
            brier_score=_f(cached.get("brier_score")),
            log_loss=_f(cached.get("log_loss")),
            calibration_error=_f(cached.get("calibration_error")),
            hit_rate=_f(cached.get("hit_rate")),
            roi_flat=_f(cached.get("roi")),
            clv_mean=_f(cached.get("clv")),
            clv_positive_pct=_f(cached.get("clv_positive_pct")),
            avg_edge=_f(cached.get("avg_edge")),
            avg_odds=_f(cached.get("avg_odds")),
            max_drawdown=_f(cached.get("max_drawdown")),
            sharpe_ratio=_f(cached.get("sharpe_ratio")),
            is_walk_forward=cached.get("is_walk_forward", True),
            computed_at=cached["computed_at"],
        )

    # Fallback: calcular em tempo real a partir de predições resolvidas
    date_conditions = ""
    params: dict = {"mvid": str(model_version_id)}
    if period_start:
        date_conditions += " AND e.kickoff_at >= :period_start"
        params["period_start"] = period_start
    if period_end:
        date_conditions += " AND e.kickoff_at <= :period_end"
        params["period_end"] = period_end

    calc_query = text(f"""
        SELECT
            mv.model_name,
            mv.version,
            COUNT(*) AS sample_size,
            MIN(e.kickoff_at) AS period_start,
            MAX(e.kickoff_at) AS period_end,
            -- Brier Score (média do componente quadrático)
            AVG(
                POWER(
                    mp.probability - CASE WHEN fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score)
                                     THEN 1 ELSE 0 END,
                    2
                )
            ) AS brier_score,
            -- Hit rate
            AVG(
                CASE WHEN fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) THEN 1.0 ELSE 0.0 END
            ) AS hit_rate,
            -- ROI flat (simplificado: se acertou, retorno = odds-1; se errou, retorno = -1)
            AVG(
                CASE WHEN fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score)
                     THEN COALESCE(mp.best_market_odds, mp.fair_odds) - 1
                     ELSE -1
                END
            ) AS roi_flat,
            -- Edge médio
            AVG(mp.edge) AS avg_edge,
            -- Odds médias
            AVG(COALESCE(mp.best_market_odds, mp.fair_odds)) AS avg_odds,
            -- CLV médio (edge como proxy quando CLV direto não disponível)
            AVG(mp.edge) AS clv_mean,
            -- % de edges positivos
            AVG(CASE WHEN mp.edge > 0 THEN 1.0 ELSE 0.0 END) AS clv_positive_pct
        FROM model_predictions mp
        JOIN model_versions mv ON mv.id = mp.model_version_id
        JOIN events e ON e.id = mp.event_id
        JOIN markets m ON m.id = mp.market_id
        JOIN outcomes o ON o.id = mp.outcome_id
        WHERE mp.model_version_id = :mvid
          AND e.status = 'finished'
          AND e.home_score IS NOT NULL
          AND e.away_score IS NOT NULL
          {date_conditions}
        GROUP BY mv.model_name, mv.version
    """)

    try:
        result = await db.execute(calc_query, params)
        r = result.mappings().first()
    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Erro ao calcular métricas ou nenhuma predição resolvida encontrada: {exc}",
        )

    if not r or r["sample_size"] == 0:
        raise HTTPException(
            status_code=404,
            detail="Nenhuma predição resolvida encontrada para este modelo.",
        )

    return ModelPerformanceMetrics(
        model_version_id=model_version_id,
        model_name=r["model_name"],
        version=r["version"],
        period_start=r.get("period_start"),
        period_end=r.get("period_end"),
        sample_size=r["sample_size"],
        brier_score=_f(r.get("brier_score")),
        hit_rate=_f(r.get("hit_rate")),
        roi_flat=_f(r.get("roi_flat")),
        avg_edge=_f(r.get("avg_edge")),
        avg_odds=_f(r.get("avg_odds")),
        clv_mean=_f(r.get("clv_mean")),
        clv_positive_pct=_f(r.get("clv_positive_pct")),
        is_walk_forward=True,
        computed_at=datetime.utcnow(),
    )


@router.get(
    "/{model_version_id}/reliability-curve",
    response_model=ReliabilityCurveResponse,
    summary="Curva de confiabilidade (calibração)",
)
async def get_reliability_curve(
    model_version_id: UUID,
    db: DbSession,
    n_bins: int = Query(default=10, ge=5, le=20),
) -> ReliabilityCurveResponse:
    """Calcula a curva de confiabilidade agrupando predições em bins.

    Para cada bin [lower, upper), compara a probabilidade média predita
    com a frequência observada de acertos. Um modelo perfeitamente
    calibrado produz pontos sobre a diagonal.
    """
    query = text("""
        SELECT
            mp.probability,
            fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) AS won
        FROM model_predictions mp
        JOIN events e ON e.id = mp.event_id
        JOIN markets m ON m.id = mp.market_id
        JOIN outcomes o ON o.id = mp.outcome_id
        WHERE mp.model_version_id = :mvid
          AND e.status = 'finished'
          AND e.home_score IS NOT NULL
        ORDER BY mp.probability
    """)

    try:
        result = await db.execute(query, {"mvid": str(model_version_id)})
        rows = result.mappings().all()
    except Exception:
        rows = []

    if not rows:
        raise HTTPException(status_code=404, detail="Nenhuma predição resolvida.")

    # Buscar nome do modelo
    mv_result = await db.execute(
        text("SELECT model_name FROM model_versions WHERE id = :mvid"),
        {"mvid": str(model_version_id)},
    )
    mv = mv_result.mappings().first()

    # Calcular bins
    bin_width = 1.0 / n_bins
    points = []
    total_ece = 0.0
    max_ce = 0.0
    total_count = len(rows)

    for i in range(n_bins):
        lower = i * bin_width
        upper = (i + 1) * bin_width
        bin_rows = [r for r in rows if lower <= float(r["probability"]) < upper]
        if not bin_rows:
            continue

        mean_pred = sum(float(r["probability"]) for r in bin_rows) / len(bin_rows)
        # won pode ser None (push) — filtrar
        resolved = [r for r in bin_rows if r["won"] is not None]
        if not resolved:
            continue

        mean_obs = sum(1.0 for r in resolved if r["won"]) / len(resolved)
        ce = abs(mean_pred - mean_obs)
        total_ece += ce * len(resolved)
        max_ce = max(max_ce, ce)

        points.append(ReliabilityCurvePoint(
            bin_lower=round(lower, 4),
            bin_upper=round(upper, 4),
            bin_midpoint=round((lower + upper) / 2, 4),
            mean_predicted=round(mean_pred, 6),
            mean_observed=round(mean_obs, 6),
            count=len(resolved),
        ))

    resolved_total = sum(p.count for p in points)
    ece = total_ece / resolved_total if resolved_total > 0 else None

    return ReliabilityCurveResponse(
        model_version_id=model_version_id,
        model_name=mv["model_name"] if mv else "unknown",
        points=points,
        ece=round(ece, 6) if ece is not None else None,
        mce=round(max_ce, 6) if max_ce > 0 else None,
        sample_size=resolved_total,
    )


@router.get(
    "/{model_version_id}/performance-history",
    response_model=list[PerformanceTimeSeriesPoint],
    summary="Série temporal de performance por período",
)
async def get_performance_history(
    model_version_id: UUID,
    db: DbSession,
) -> list[PerformanceTimeSeriesPoint]:
    """Retorna métricas de performance ao longo do tempo (model_performance)."""
    query = text("""
        SELECT period_start, period_end, brier_score, roi AS roi_flat,
               clv AS clv_mean, hit_rate, sample_size
        FROM model_performance
        WHERE model_version_id = :mvid AND is_walk_forward = true
        ORDER BY period_start
    """)

    try:
        result = await db.execute(query, {"mvid": str(model_version_id)})
        rows = result.mappings().all()
    except Exception:
        return []

    return [
        PerformanceTimeSeriesPoint(
            period_start=r["period_start"],
            period_end=r["period_end"],
            brier_score=_f(r.get("brier_score")),
            roi_flat=_f(r.get("roi_flat")),
            clv_mean=_f(r.get("clv_mean")),
            hit_rate=_f(r.get("hit_rate")),
            sample_size=r["sample_size"],
        )
        for r in rows
    ]


@router.post(
    "/{model_version_id}/retrain",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Dispara retreino assíncrono",
)
async def retrain_model(
    model_version_id: UUID,
    db: DbSession,
    cutoff_date: datetime = Query(description="Treinar com dados até esta data"),
) -> dict:
    """Validação de cutoff e enfileiramento do retreino.

    O cutoff_date garante que nenhum dado futuro contamina o treino
    (anti data-leakage). Em produção, publicará task no Celery.
    """
    # Verificar que o modelo existe
    mv_result = await db.execute(
        text("SELECT id, model_name FROM model_versions WHERE id = :mvid"),
        {"mvid": str(model_version_id)},
    )
    mv = mv_result.mappings().first()
    if not mv:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    # Validar cutoff não é no futuro
    if cutoff_date > datetime.utcnow():
        raise HTTPException(
            status_code=422,
            detail="cutoff_date não pode ser no futuro — impediria validação walk-forward.",
        )

    # TODO(fase 2): publicar task Celery
    return {
        "model_version_id": str(model_version_id),
        "model_name": mv["model_name"],
        "cutoff_date": cutoff_date.isoformat(),
        "status": "ready",
        "message": "Retreino validado. Pipeline Celery será ativado na próxima fase.",
    }


def _f(v) -> float | None:
    """Converte Decimal/numeric para float, None-safe."""
    if v is None:
        return None
    return float(v)
