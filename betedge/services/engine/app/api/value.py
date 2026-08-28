"""Endpoints do motor de value bets (edge, EV, edge score).

Fase 0: contrato definido; a lógica matemática já existe e está TOTALMENTE
implementada em `app/value/engine.py` — este router ainda não a conecta ao
banco de dados real (isso é Fase 1: persistência de odds/predições).
"""
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.core.deps import DbSession

router = APIRouter()


class MarketType(StrEnum):
    MATCH_RESULT = "match_result"
    BOTH_TEAMS_TO_SCORE = "btts"
    OVER_UNDER_GOALS = "over_under_goals"
    ASIAN_HANDICAP = "asian_handicap"
    CORRECT_SCORE = "correct_score"
    DOUBLE_CHANCE = "double_chance"


class ValueOpportunity(BaseModel):
    """Uma oportunidade de valor identificada para um evento/mercado/casa."""

    event_id: UUID
    league: str
    market: MarketType
    outcome: str
    bookmaker: str
    decimal_odds: float = Field(gt=1.0)
    model_probability: float = Field(ge=0.0, le=1.0)
    fair_market_probability: float = Field(ge=0.0, le=1.0)
    edge: float = Field(description="model_probability - fair_market_probability")
    expected_value: float = Field(description="EV percentual da aposta")
    edge_score: float = Field(ge=0.0, le=100.0, description="Score proprietário 0-100")
    event_start: datetime


class EdgeScoreBreakdown(BaseModel):
    """Decomposição detalhada de como o edge score foi calculado."""

    event_id: UUID
    market: MarketType
    edge: float
    expected_value: float
    model_confidence: float
    market_liquidity_factor: float
    historical_model_accuracy: float
    edge_score: float = Field(ge=0.0, le=100.0)
    components: dict[str, float] = Field(
        description="Contribuição de cada componente para o score final."
    )


@router.get("/opportunities", response_model=list[ValueOpportunity], summary="Lista oportunidades de valor")
async def list_value_opportunities(
    db: DbSession,
    min_edge: float = Query(default=0.0, description="Edge mínimo (fração, ex.: 0.05 = 5%)."),
    min_ev: float = Query(default=0.0, description="EV percentual mínimo."),
    markets: list[MarketType] | None = Query(default=None),
    leagues: list[str] | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[ValueOpportunity]:
    """Lista oportunidades de valor vigentes filtradas por edge/EV/mercados/ligas.

    TODO(fase 1): consultar odds correntes + predições de consenso, calcular
    edge/EV via `app.value.engine`, e persistir/ordenar os resultados.
    """
    raise NotImplementedError("Listagem de oportunidades de valor será implementada na Fase 1.")


@router.get("/top-picks", response_model=list[ValueOpportunity], summary="Top N oportunidades por edge score")
async def get_top_picks(
    db: DbSession,
    n: int = Query(default=10, ge=1, le=100),
    markets: list[MarketType] | None = Query(default=None),
) -> list[ValueOpportunity]:
    """Retorna as N melhores oportunidades correntes, ordenadas por `edge_score` desc.

    TODO(fase 1): reaproveitar `list_value_opportunities` com ordenação e corte por N.
    """
    raise NotImplementedError("Top picks será implementado na Fase 1.")


@router.get(
    "/edge-score/{event_id}/{market}",
    response_model=EdgeScoreBreakdown,
    summary="Decomposição do edge score de um evento/mercado",
)
async def get_edge_score_breakdown(event_id: UUID, market: MarketType, db: DbSession) -> EdgeScoreBreakdown:
    """Detalha os componentes que formam o edge score de 0-100 para um evento/mercado.

    TODO(fase 1): buscar predição de consenso + odds correntes e chamar
    `app.value.engine.calculate_edge_score` retornando a decomposição completa.
    """
    raise NotImplementedError("Decomposição do edge score será implementada na Fase 1.")
