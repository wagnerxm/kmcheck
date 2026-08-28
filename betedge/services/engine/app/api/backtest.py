"""Endpoints de backtesting walk-forward — validação histórica de modelos/estratégias.

Executa o motor de backtest (app.backtest.engine) de forma síncrona, sem fila
de jobs (Celery removido nesta fase). O endpoint /run recebe a configuração,
busca os eventos do banco, executa o backtest completo e retorna as métricas
agregadas com intervalos de confiança.

Endpoints:
    POST /run     — executa o backtest e retorna resultado completo.
    GET  /config  — retorna defaults e limites de configuração.
    GET  /health  — verifica se o motor de backtest está operacional.
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.backtest.engine import (
    BacktestResult,
    ConfidenceInterval,
    DrawdownInfo,
    MatchEvent,
    run_backtest,
)
from app.core.deps import DbSession

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════
# Modelos de request/response
# ═══════════════════════════════════════════════════════════════════════════


class BacktestRequest(BaseModel):
    """Configuração de um backtest walk-forward."""

    start_date: datetime
    end_date: datetime
    markets: list[str] = Field(default=["match_result"])
    leagues: list[str] | None = None
    initial_train_days: int = Field(default=365, ge=30)
    step_days: int = Field(default=7, ge=1)
    eval_horizon_days: int = Field(default=7, ge=1)
    min_edge: float = Field(default=0.0, ge=0.0)
    min_ev: float = Field(default=0.0, ge=0.0)
    initial_bankroll: float = Field(default=1000.0, gt=0)
    vig_method: str = Field(default="shin")


class FoldSummary(BaseModel):
    """Resumo de um fold individual do walk-forward."""

    fold_index: int
    train_start: datetime
    train_end: datetime
    eval_start: datetime
    eval_end: datetime
    n_train_samples: int
    n_eval_events: int
    n_bets: int
    brier_score: float
    log_loss: float
    ece: float
    hit_rate: float
    roi_flat_pct: float | None = None
    roi_kelly_025_pct: float | None = None
    mean_clv_pct: float | None = None


class DrawdownSummary(BaseModel):
    """Resumo do drawdown de uma estratégia de staking."""

    max_drawdown_pct: float
    max_drawdown_duration: int
    peak_bankroll: float
    trough_bankroll: float


class ConfidenceIntervalResponse(BaseModel):
    """Intervalo de confiança de uma métrica agregada."""

    estimate: float
    lower: float
    upper: float
    confidence_level: float
    n_samples: int
    sufficient_sample: bool


class BacktestResponse(BaseModel):
    """Resultado completo de um backtest walk-forward."""

    # Configuração usada
    start_date: datetime
    end_date: datetime
    n_folds: int
    min_edge: float
    initial_bankroll: float

    # Totais agregados
    total_events: int
    total_bets: int
    total_wins: int

    # Métricas com intervalos de confiança
    brier_score: ConfidenceIntervalResponse
    log_loss: ConfidenceIntervalResponse
    ece: float
    hit_rate: ConfidenceIntervalResponse
    roi_flat: ConfidenceIntervalResponse | None = None
    roi_kelly_025: ConfidenceIntervalResponse | None = None
    yield_flat: ConfidenceIntervalResponse | None = None
    mean_clv: ConfidenceIntervalResponse | None = None
    positive_clv_rate: ConfidenceIntervalResponse | None = None

    # Bankroll e drawdown por estratégia
    final_bankroll_flat: float
    final_bankroll_kelly_025: float
    final_bankroll_kelly_050: float
    drawdown_flat: DrawdownSummary
    drawdown_kelly_025: DrawdownSummary
    drawdown_kelly_050: DrawdownSummary

    # Detalhamento por fold
    folds: list[FoldSummary]

    # Avisos sobre amostra insuficiente, etc.
    warnings: list[str]

    # Decomposição de Brier (Murphy 1973)
    brier_reliability: float
    brier_resolution: float
    brier_uncertainty: float


# ═══════════════════════════════════════════════════════════════════════════
# Funções auxiliares de conversão engine → response
# ═══════════════════════════════════════════════════════════════════════════


def _ci_to_response(ci: ConfidenceInterval) -> ConfidenceIntervalResponse:
    """Converte um ConfidenceInterval do motor para o modelo de resposta da API."""
    return ConfidenceIntervalResponse(
        estimate=ci.estimate,
        lower=ci.lower,
        upper=ci.upper,
        confidence_level=ci.confidence_level,
        n_samples=ci.n_samples,
        sufficient_sample=ci.sufficient_sample,
    )


def _drawdown_to_response(dd: DrawdownInfo) -> DrawdownSummary:
    """Converte um DrawdownInfo do motor para o modelo de resposta da API."""
    return DrawdownSummary(
        max_drawdown_pct=dd.max_drawdown_pct,
        max_drawdown_duration=dd.max_drawdown_duration,
        peak_bankroll=dd.peak_bankroll,
        trough_bankroll=dd.trough_bankroll,
    )


def _result_to_response(
    result: BacktestResult,
    request: BacktestRequest,
) -> BacktestResponse:
    """Converte o BacktestResult do motor para o BacktestResponse da API.

    Centraliza a tradução entre as dataclasses internas do motor e os
    modelos Pydantic expostos na API, mantendo os dois desacoplados.
    """
    # Constrói o resumo de cada fold.
    fold_summaries: list[FoldSummary] = []
    for fr in result.folds:
        fold_summaries.append(FoldSummary(
            fold_index=fr.fold_index,
            train_start=fr.train_start,
            train_end=fr.train_end,
            eval_start=fr.eval_start,
            eval_end=fr.eval_end,
            n_train_samples=fr.n_train_samples,
            n_eval_events=fr.n_eval_events,
            n_bets=fr.n_bets,
            brier_score=fr.brier_score,
            log_loss=fr.log_loss,
            ece=fr.ece,
            hit_rate=fr.hit_rate,
            roi_flat_pct=fr.roi_flat_pct,
            roi_kelly_025_pct=fr.roi_kelly_025_pct,
            mean_clv_pct=fr.mean_clv_pct,
        ))

    return BacktestResponse(
        # Configuração
        start_date=request.start_date,
        end_date=request.end_date,
        n_folds=result.n_folds,
        min_edge=request.min_edge,
        initial_bankroll=request.initial_bankroll,
        # Totais
        total_events=result.total_events,
        total_bets=result.total_bets,
        total_wins=result.total_wins,
        # Métricas agregadas com IC
        brier_score=_ci_to_response(result.brier_score),
        log_loss=_ci_to_response(result.log_loss),
        ece=result.ece,
        hit_rate=_ci_to_response(result.hit_rate),
        roi_flat=_ci_to_response(result.roi_flat) if result.roi_flat else None,
        roi_kelly_025=_ci_to_response(result.roi_kelly_025) if result.roi_kelly_025 else None,
        yield_flat=_ci_to_response(result.yield_flat) if result.yield_flat else None,
        mean_clv=_ci_to_response(result.mean_clv) if result.mean_clv else None,
        positive_clv_rate=_ci_to_response(result.positive_clv_rate) if result.positive_clv_rate else None,
        # Bankroll
        final_bankroll_flat=result.final_bankroll_flat,
        final_bankroll_kelly_025=result.final_bankroll_kelly_025,
        final_bankroll_kelly_050=result.final_bankroll_kelly_050,
        drawdown_flat=_drawdown_to_response(result.drawdown_flat),
        drawdown_kelly_025=_drawdown_to_response(result.drawdown_kelly_025),
        drawdown_kelly_050=_drawdown_to_response(result.drawdown_kelly_050),
        # Folds
        folds=fold_summaries,
        # Avisos
        warnings=result.warnings,
        # Decomposição de Brier
        brier_reliability=result.brier_reliability,
        brier_resolution=result.brier_resolution,
        brier_uncertainty=result.brier_uncertainty,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════


@router.post(
    "/run",
    response_model=BacktestResponse,
    summary="Executa um backtest walk-forward",
)
async def run_backtest_endpoint(
    payload: BacktestRequest,
    db: DbSession,
) -> BacktestResponse:
    """Executa backtesting walk-forward com janela expansiva.

    Busca eventos do banco (tabela matches com resultados e odds), executa
    o motor de backtest e retorna métricas agregadas com intervalos de
    confiança. Se não houver dados suficientes para ao menos um fold,
    retorna 422 (Unprocessable Entity).

    O backtest roda de forma síncrona — para datasets grandes (>100k
    eventos), considere dividir por liga ou reduzir o horizonte.
    """
    # Validação básica de datas.
    if payload.start_date >= payload.end_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="start_date deve ser anterior a end_date.",
        )

    # Valida método de remoção de vig.
    vig_methods_validos = {"shin", "power", "multiplicative"}
    if payload.vig_method not in vig_methods_validos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"vig_method inválido: {payload.vig_method!r}. "
                   f"Opções: {', '.join(sorted(vig_methods_validos))}.",
        )

    # Busca eventos do banco de dados.
    # TODO: implementar query real quando as tabelas de matches e odds
    # estiverem povoadas. Por ora levanta 422 indicando falta de dados.
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=(
            "Integração com banco de dados para buscar eventos será "
            "implementada quando as tabelas de matches e odds estiverem "
            "povoadas. O motor de backtest (app.backtest.engine) está "
            "funcional e pode ser chamado diretamente com MatchEvents."
        ),
    )

    # --- Código preparado para quando o banco estiver povoado ---
    # from sqlalchemy import text
    #
    # query = text("""
    #     SELECT
    #         m.id AS match_id,
    #         m.home_team,
    #         m.away_team,
    #         m.league,
    #         m.match_datetime,
    #         m.home_goals,
    #         m.away_goals,
    #         o.bookmaker,
    #         o.market,
    #         o.outcome,
    #         o.odds AS opening_odds,
    #         o.closing_odds
    #     FROM matches m
    #     JOIN odds o ON o.match_id = m.id
    #     WHERE m.match_datetime BETWEEN :start AND :end
    #       AND m.home_goals IS NOT NULL
    #       AND o.market = ANY(:markets)
    #     ORDER BY m.match_datetime
    # """)
    # params = {
    #     "start": payload.start_date,
    #     "end": payload.end_date,
    #     "markets": payload.markets,
    # }
    # if payload.leagues:
    #     query = text(str(query) + " AND m.league = ANY(:leagues)")
    #     params["leagues"] = payload.leagues
    #
    # rows = (await db.execute(query, params)).mappings().all()
    #
    # if not rows:
    #     raise HTTPException(
    #         status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    #         detail="Sem eventos com resultado no período e mercados solicitados.",
    #     )
    #
    # # Converte linhas do banco para MatchEvent.
    # events = []
    # for row in rows:
    #     actual_outcome = _determine_outcome(
    #         row["home_goals"], row["away_goals"]
    #     )
    #     events.append(MatchEvent(
    #         match_id=str(row["match_id"]),
    #         home_team=row["home_team"],
    #         away_team=row["away_team"],
    #         league=row["league"],
    #         match_datetime=row["match_datetime"],
    #         actual_outcome=actual_outcome,
    #         market=row["market"],
    #         opening_odds={
    #             row["outcome"]: row["opening_odds"],
    #         },
    #         closing_odds={
    #             row["outcome"]: row["closing_odds"],
    #         } if row.get("closing_odds") else None,
    #     ))
    #
    # # Executa o motor de backtest.
    # result = run_backtest(
    #     events=events,
    #     model=model,  # TODO: instanciar modelo selecionado
    #     initial_train_days=payload.initial_train_days,
    #     step_days=payload.step_days,
    #     eval_horizon_days=payload.eval_horizon_days,
    #     min_edge=payload.min_edge,
    #     min_ev=payload.min_ev,
    #     initial_bankroll=payload.initial_bankroll,
    # )
    #
    # return _result_to_response(result, payload)


@router.get(
    "/config",
    summary="Retorna a configuração padrão do backtesting",
)
async def get_backtest_config() -> dict:
    """Retorna os defaults, limites e requisitos de amostra do backtesting.

    Útil para o frontend popular os campos do formulário de backtest com
    valores padrão sensatos e mostrar limites de validação ao usuário.
    """
    return {
        "defaults": {
            "initial_train_days": 365,
            "step_days": 7,
            "eval_horizon_days": 7,
            "min_edge": 0.0,
            "min_ev": 0.0,
            "initial_bankroll": 1000.0,
            "vig_method": "shin",
        },
        "limits": {
            "min_initial_train_days": 30,
            "min_step_days": 1,
            "min_eval_horizon_days": 1,
        },
        "sample_size_requirements": {
            "brier_score": 200,
            "clv": 100,
            "roi": 500,
            "hit_rate_per_bin": 30,
        },
        "staking_strategies": ["flat", "kelly_0.25", "kelly_0.50"],
        "vig_methods": ["shin", "power", "multiplicative"],
    }


@router.get(
    "/health",
    summary="Verifica se o motor de backtest está operacional",
)
async def backtest_health() -> dict:
    """Health check do subsistema de backtesting.

    Verifica que o módulo do motor está importável e funcional.
    Usado por probes de saúde e pelo frontend para habilitar/desabilitar
    a aba de backtesting.
    """
    try:
        # Tenta importar o motor — se falhar, o subsistema está quebrado.
        from app.backtest.engine import run_backtest as _check  # noqa: F401
        return {"status": "ok", "engine": "loaded"}
    except ImportError as exc:
        return {"status": "degraded", "engine": "unavailable", "detail": str(exc)}
