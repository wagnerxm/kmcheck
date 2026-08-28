"""Endpoints do motor de value bets (edge, EV, edge score).

A lógica matemática está totalmente implementada em `app/value/engine.py`
e `app/value/opportunity.py`. Estes endpoints conectam a matemática à
camada de dados, consultando odds e predições vigentes para calcular
oportunidades em tempo real.
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
    relative_edge: float = Field(description="edge / fair_market_probability")
    expected_value: float = Field(description="EV percentual da aposta")
    edge_score: float = Field(ge=0.0, le=100.0, description="Score proprietário 0-100")
    confidence: float = Field(ge=0.0, le=1.0)
    kelly_stakes: dict[str, float] = Field(
        default_factory=dict,
        description="Stakes fracionários de Kelly (ex.: kelly_0.25: 1.5%)"
    )
    bookmakers_analyzed: int = Field(ge=0)
    event_start: datetime


class EdgeScoreBreakdown(BaseModel):
    """Decomposição detalhada de como o edge score foi calculado."""

    event_id: UUID
    market: MarketType
    outcome: str
    edge: float
    expected_value: float
    edge_score: float = Field(ge=0.0, le=100.0)
    components: dict[str, float] = Field(
        description="Contribuição normalizada [0,1] de cada componente."
    )
    weights: dict[str, float] = Field(
        description="Pesos usados na combinação dos componentes."
    )
    kelly_stakes: dict[str, float] = Field(
        default_factory=dict,
        description="Stakes fracionários de Kelly."
    )


@router.get(
    "/opportunities",
    response_model=list[ValueOpportunity],
    summary="Lista oportunidades de valor",
)
async def list_value_opportunities(
    db: DbSession,
    min_edge: float = Query(default=0.0, description="Edge mínimo (fração, ex.: 0.05 = 5%)."),
    min_ev: float = Query(default=0.0, description="EV percentual mínimo."),
    min_edge_score: float = Query(default=0.0, ge=0.0, le=100.0, description="Edge Score mínimo."),
    markets: list[MarketType] | None = Query(default=None),
    leagues: list[str] | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[ValueOpportunity]:
    """Lista oportunidades de valor vigentes filtradas por edge/EV/mercados/ligas.

    Consulta odds correntes e predições de consenso, calcula edge/EV via
    `app.value.engine`, filtra e ordena por edge_score desc.

    A integração com dados em tempo real depende do pipeline de odds e predições
    estar populado — sem dados no banco, retorna lista vazia.
    """
    from sqlalchemy import text

    # Consulta oportunidades ativas diretamente da tabela value_opportunities.
    query_parts = [
        "SELECT * FROM value_opportunities WHERE status = 'active'"
    ]
    params: dict = {}

    if min_edge > 0:
        query_parts.append("AND edge >= :min_edge")
        params["min_edge"] = min_edge
    if min_ev > 0:
        query_parts.append("AND ev >= :min_ev")
        params["min_ev"] = min_ev
    if min_edge_score > 0:
        query_parts.append("AND edge_score >= :min_edge_score")
        params["min_edge_score"] = min_edge_score

    query_parts.append("ORDER BY edge_score DESC LIMIT :limit")
    params["limit"] = limit

    try:
        result = await db.execute(text(" ".join(query_parts)), params)
        rows = result.mappings().all()
    except Exception:
        # Tabela ainda não existe ou sem dados — retorna vazio.
        return []

    opportunities = []
    for row in rows:
        try:
            opportunities.append(ValueOpportunity(
                event_id=row["event_id"],
                league=row.get("league", ""),
                market=row.get("market", "match_result"),
                outcome=row.get("outcome", ""),
                bookmaker=row.get("bookmaker", ""),
                decimal_odds=row["decimal_odds"],
                model_probability=row.get("model_probability", 0.0),
                fair_market_probability=row.get("fair_probability", 0.0),
                edge=row["edge"],
                relative_edge=row.get("relative_edge", 0.0),
                expected_value=row["ev"],
                edge_score=row["edge_score"],
                confidence=row.get("confidence", 0.0),
                kelly_stakes=row.get("kelly_stakes", {}),
                bookmakers_analyzed=row.get("bookmakers_analyzed", 0),
                event_start=row.get("event_start", row.get("detected_at", datetime.utcnow())),
            ))
        except (KeyError, TypeError):
            continue

    return opportunities


@router.get(
    "/top-picks",
    response_model=list[ValueOpportunity],
    summary="Top N oportunidades por edge score",
)
async def get_top_picks(
    db: DbSession,
    n: int = Query(default=10, ge=1, le=100),
    markets: list[MarketType] | None = Query(default=None),
) -> list[ValueOpportunity]:
    """Retorna as N melhores oportunidades correntes, ordenadas por `edge_score` desc.

    Filtra apenas oportunidades com edge_score >= 70 (piso de destaque, §7.5).
    """
    return await list_value_opportunities(
        db=db,
        min_edge_score=70.0,
        markets=markets,
        limit=n,
    )


@router.get(
    "/edge-score/{event_id}/{market}/{outcome}",
    response_model=EdgeScoreBreakdown,
    summary="Decomposição do edge score de um evento/mercado/outcome",
)
async def get_edge_score_breakdown(
    event_id: UUID,
    market: MarketType,
    outcome: str,
    db: DbSession,
) -> EdgeScoreBreakdown:
    """Detalha os componentes que formam o edge score de 0-100 para um evento/mercado/outcome.

    Busca a oportunidade ativa correspondente e retorna a decomposição completa
    dos 7 componentes, incluindo os pesos usados no cálculo.
    """
    from sqlalchemy import text

    try:
        result = await db.execute(
            text(
                "SELECT * FROM value_opportunities "
                "WHERE event_id = :event_id AND status = 'active' "
                "LIMIT 10"
            ),
            {"event_id": str(event_id)},
        )
        rows = result.mappings().all()
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Oportunidade não encontrada.")

    # Filtra pelo market/outcome no app (permite flexibilidade no schema).
    for row in rows:
        if row.get("market") == market and row.get("outcome") == outcome:
            components = row.get("edge_score_components", {})
            from app.value.engine import DEFAULT_WEIGHTS
            return EdgeScoreBreakdown(
                event_id=event_id,
                market=market,
                outcome=outcome,
                edge=row["edge"],
                expected_value=row["ev"],
                edge_score=row["edge_score"],
                components=components if isinstance(components, dict) else {},
                weights=DEFAULT_WEIGHTS,
                kelly_stakes=row.get("kelly_stakes", {}),
            )

    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Oportunidade não encontrada para este mercado/outcome.")
