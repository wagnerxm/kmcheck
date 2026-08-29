"""Endpoints da API do Shadow Mode — operação e monitoramento.

Expõe o motor shadow como endpoints HTTP para execução diária automática,
captura de closing odds, grading, e consulta de métricas e relatórios.

Todos os endpoints exigem API key via dependency global (ver app/main.py).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.core.deps import DbSession
from app.shadow.engine import (
    ShadowCycleResult,
    capture_closing_odds,
    get_shadow_overview,
    grade_shadow_predictions,
    run_shadow_cycle,
)
from app.shadow.aggregations import (
    aggregate_shadow_metrics,
    get_calibration_data,
    get_equity_curve,
    get_graduation_status,
)
from app.shadow.report import generate_daily_report

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════
# Schemas
# ═══════════════════════════════════════════════════════════════════════════

class ShadowRunRequest(BaseModel):
    """Payload para disparar ciclo shadow."""
    event_ids: list[str] | None = Field(
        default=None,
        description="IDs de eventos específicos. Se omitido, processa todos os futuros com odds.",
    )


class ShadowRunResponse(BaseModel):
    """Resposta do ciclo shadow."""
    pipeline_run_id: str
    events_processed: int
    predictions_created: int
    selections_made: int
    skipped_fail_safe: int
    errors: list[str]
    warnings: list[str]


class GradeResponse(BaseModel):
    """Resposta do grading de previsões."""
    predictions_graded: int
    message: str


class ClosingOddsResponse(BaseModel):
    """Resposta da captura de closing odds."""
    predictions_updated: int
    message: str


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints operacionais
# ═══════════════════════════════════════════════════════════════════════════

@router.post(
    "/run",
    response_model=ShadowRunResponse,
    summary="Executa ciclo shadow (geração de previsões)",
)
async def run_shadow_endpoint(
    payload: ShadowRunRequest,
    db: DbSession,
) -> ShadowRunResponse:
    """Executa o ciclo shadow completo: buscar eventos, calcular edges,
    e persistir previsões.

    Pode ser chamado manualmente ou por um cron job diário.
    Idempotente — ON CONFLICT DO NOTHING impede duplicatas.
    """
    result = await run_shadow_cycle(db, event_ids=payload.event_ids)
    return ShadowRunResponse(
        pipeline_run_id=result.pipeline_run_id,
        events_processed=result.events_processed,
        predictions_created=result.predictions_created,
        selections_made=result.selections_made,
        skipped_fail_safe=result.skipped_fail_safe,
        errors=result.errors,
        warnings=result.warnings,
    )


@router.post(
    "/grade",
    response_model=GradeResponse,
    summary="Grading de previsões com resultado final",
)
async def grade_shadow_endpoint(db: DbSession) -> GradeResponse:
    """Faz grading de previsões abertas cujos eventos já terminaram.

    Calcula resultado (won/lost/void), retorno teórico e CLV.
    Write-once: previsões já gradeadas não são modificadas.
    """
    count = await grade_shadow_predictions(db)
    return GradeResponse(
        predictions_graded=count,
        message=f"{count} previsões gradeadas com sucesso.",
    )


@router.post(
    "/closing-odds",
    response_model=ClosingOddsResponse,
    summary="Captura closing odds de eventos próximos",
)
async def capture_closing_odds_endpoint(db: DbSession) -> ClosingOddsResponse:
    """Captura as odds de fechamento para eventos que começam em até 2 horas.

    Write-once: closing_odds já capturadas não são sobrescritas.
    Deve ser chamado periodicamente (a cada 15–30 min) para garantir captura.
    """
    count = await capture_closing_odds(db)
    return ClosingOddsResponse(
        predictions_updated=count,
        message=f"Closing odds capturadas para {count} previsões.",
    )


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints de consulta
# ═══════════════════════════════════════════════════════════════════════════

@router.get(
    "/overview",
    summary="Dashboard overview com critérios de graduação",
)
async def get_overview_endpoint(db: DbSession) -> dict:
    """Retorna métricas acumuladas do Shadow Mode: contagens, hit rate, ROI,
    Brier, Log Loss, ECE, CLV médio, drawdown e critérios de graduação.
    """
    return await get_shadow_overview(db)


@router.get(
    "/predictions",
    summary="Lista previsões com filtros",
)
async def list_predictions_endpoint(
    db: DbSession,
    status_filter: str | None = Query(default=None, alias="status"),
    league: str | None = Query(default=None),
    market: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """Lista previsões shadow com filtros opcionais.

    Retorna paginação com total, limit, offset e lista de previsões.
    """
    conditions = ["TRUE"]
    params: dict = {"lim": limit, "off": offset}

    if status_filter:
        conditions.append("sp.status = :status")
        params["status"] = status_filter
    if league:
        conditions.append("sp.league = :league")
        params["league"] = league
    if market:
        conditions.append("sp.market = :market")
        params["market"] = market

    where = " AND ".join(conditions)

    from sqlalchemy import text

    # Contagem total (com filtros)
    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM shadow_predictions sp WHERE {where}"),
        params,
    )
    total = int(count_result.scalar() or 0)

    # Dados paginados
    result = await db.execute(text(f"""
        SELECT
            sp.id::text,
            sp.event_id::text,
            sp.league,
            sp.sport,
            sp.market,
            sp.outcome,
            sp.pipeline_run_id,
            sp.prediction_run_id,
            sp.generated_at,
            sp.kickoff_at,
            sp.bookmaker,
            sp.best_odds,
            sp.closing_odds,
            sp.closing_bookmaker,
            sp.closing_is_valid,
            sp.fair_market_probability,
            sp.model_probability,
            sp.edge,
            sp.ev,
            sp.prediq_score,
            sp.kelly_fraction,
            sp.kelly_full,
            sp.kelly_capped,
            sp.model_version,
            sp.pipeline_version,
            sp.is_shadow_selection,
            sp.selection_strategy,
            sp.result,
            sp.theoretical_return,
            sp.clv,
            sp.clv_price,
            sp.clv_probability,
            sp.graded_at,
            sp.status,
            sp.home_team,
            sp.away_team
        FROM shadow_predictions sp
        WHERE {where}
        ORDER BY sp.generated_at DESC
        LIMIT :lim OFFSET :off
    """), params)
    rows = result.mappings().all()

    predictions = []
    for r in rows:
        predictions.append({
            "id": r["id"],
            "event_id": r["event_id"],
            "league": r["league"],
            "sport": r["sport"],
            "market": r["market"],
            "outcome": r["outcome"],
            "pipeline_run_id": r["pipeline_run_id"],
            "prediction_run_id": r["prediction_run_id"],
            "generated_at": r["generated_at"].isoformat() if r["generated_at"] else None,
            "kickoff_at": r["kickoff_at"].isoformat() if r["kickoff_at"] else None,
            "bookmaker": r["bookmaker"],
            "best_odds": float(r["best_odds"]) if r["best_odds"] else None,
            "closing_odds": float(r["closing_odds"]) if r["closing_odds"] else None,
            "closing_bookmaker": r["closing_bookmaker"],
            "closing_is_valid": r["closing_is_valid"],
            "fair_market_probability": float(r["fair_market_probability"]) if r["fair_market_probability"] else None,
            "model_probability": float(r["model_probability"]) if r["model_probability"] else None,
            "edge": float(r["edge"]) if r["edge"] else None,
            "ev": float(r["ev"]) if r["ev"] else None,
            "prediq_score": float(r["prediq_score"]) if r["prediq_score"] else None,
            "kelly_fraction": float(r["kelly_fraction"]) if r["kelly_fraction"] else None,
            "kelly_full": float(r["kelly_full"]) if r["kelly_full"] else None,
            "kelly_capped": float(r["kelly_capped"]) if r["kelly_capped"] else None,
            "model_version": r["model_version"],
            "pipeline_version": r["pipeline_version"],
            "is_shadow_selection": r["is_shadow_selection"],
            "selection_strategy": r["selection_strategy"],
            "result": r["result"],
            "theoretical_return": float(r["theoretical_return"]) if r["theoretical_return"] else None,
            "clv": float(r["clv"]) if r["clv"] else None,
            "clv_price": float(r["clv_price"]) if r["clv_price"] else None,
            "clv_probability": float(r["clv_probability"]) if r["clv_probability"] else None,
            "graded_at": r["graded_at"].isoformat() if r["graded_at"] else None,
            "status": r["status"],
            "home_team": r["home_team"],
            "away_team": r["away_team"],
        })

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "predictions": predictions,
    }


@router.get(
    "/metrics",
    summary="Métricas agregadas por dimensão",
)
async def get_metrics_endpoint(
    db: DbSession,
    group_by: str = Query(
        description="Dimensão de agrupamento: league, market, model, period, "
                     "odds_range, edge_range, ev_range, prediq_range.",
    ),
    league: str | None = Query(default=None),
    market: str | None = Query(default=None),
    sport: str | None = Query(default=None),
) -> list[dict]:
    """Retorna métricas agregadas por dimensão.

    Cada grupo contém: key, sample_size, hit_rate, brier_score, log_loss,
    ece, clv_mean, roi_theoretical, max_drawdown.
    """
    valid_groups = [
        "league", "market", "model", "period",
        "odds_range", "edge_range", "ev_range", "prediq_range",
    ]
    if group_by not in valid_groups:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"group_by inválido: '{group_by}'. Valores aceitos: {valid_groups}",
        )

    filters = {}
    if league:
        filters["league"] = league
    if market:
        filters["market"] = market
    if sport:
        filters["sport"] = sport

    return await aggregate_shadow_metrics(
        db, group_by=group_by, filters=filters or None,
    )


@router.get(
    "/calibration",
    summary="Dados de curva de calibração (reliability diagram)",
)
async def get_calibration_endpoint(
    db: DbSession,
    n_bins: int = Query(default=10, ge=5, le=50),
    league: str | None = Query(default=None),
    market: str | None = Query(default=None),
) -> dict:
    """Retorna dados para reliability curve: bins com probabilidade média
    predita vs frequência observada, ECE e MCE.
    """
    filters = {}
    if league:
        filters["league"] = league
    if market:
        filters["market"] = market

    return await get_calibration_data(
        db, n_bins=n_bins, filters=filters or None,
    )


@router.get(
    "/equity-curve",
    summary="Curva de equidade (simulação de bankroll)",
)
async def get_equity_curve_endpoint(
    db: DbSession,
    stake_fraction: float = Query(default=0.01, gt=0, le=0.10),
) -> dict:
    """Simula evolução do bankroll com flat staking.

    Retorna curva diária, max drawdown, bankroll final e total de apostas.
    """
    return await get_equity_curve(db, stake_fraction=stake_fraction)


@router.get(
    "/report/{date}",
    response_class=PlainTextResponse,
    summary="Relatório diário em Markdown",
)
async def get_daily_report_endpoint(
    date: str,
    db: DbSession,
) -> PlainTextResponse:
    """Gera relatório diário do Shadow Mode para a data especificada.

    Formato da data: YYYY-MM-DD. Retorna Markdown como texto plano.
    """
    try:
        report_date = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Formato de data inválido: '{date}'. Use YYYY-MM-DD.",
        )

    report = await generate_daily_report(db, report_date=report_date)
    return PlainTextResponse(content=report, media_type="text/markdown")


@router.get(
    "/graduation",
    summary="Status dos critérios de graduação",
)
async def get_graduation_endpoint(db: DbSession) -> dict:
    """Verifica todos os critérios para sair do Shadow Mode.

    Retorna status detalhado de cada critério e flag global 'ready'.
    """
    return await get_graduation_status(db)
