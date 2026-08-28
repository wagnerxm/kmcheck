"""Endpoints de cálculo de odds (probabilidade justa, overround, implícitas).

A matemática por trás destes endpoints já está totalmente implementada em
`app/value/engine.py`; falta apenas conectar à camada de persistência de odds
(Fase 1), que ainda não existe neste esqueleto.
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.deps import DbSession

router = APIRouter()


class FairProbabilityResponse(BaseModel):
    """Probabilidade justa (sem vig) por resultado, após remoção do overround."""

    event_id: UUID
    market: str
    method: str = Field(description="Método de remoção de vig usado: 'multiplicative', 'power', 'shin'.")
    fair_probabilities: dict[str, float] = Field(description="Mapa outcome -> probabilidade justa.")
    computed_at: datetime


class OverroundEntry(BaseModel):
    """Overround (margem da casa) para uma casa de apostas específica."""

    bookmaker: str
    overround_pct: float = Field(description="Ex.: 5.2 significa 5.2% de margem.")


class OverroundResponse(BaseModel):
    """Overround de cada casa de apostas para um evento/mercado."""

    event_id: UUID
    market: str
    bookmakers: list[OverroundEntry]


class ImpliedProbabilitiesResponse(BaseModel):
    """Probabilidades implícitas cruas (com vig) de todas as casas para um evento."""

    event_id: UUID
    by_bookmaker: dict[str, dict[str, float]] = Field(
        description="Mapa bookmaker -> {outcome: probabilidade implícita}."
    )


@router.get(
    "/fair-probability/{event_id}/{market}",
    response_model=FairProbabilityResponse,
    summary="Probabilidade justa após remoção do vig",
)
async def get_fair_probability(event_id: UUID, market: str, db: DbSession) -> FairProbabilityResponse:
    """Calcula a probabilidade justa do mercado combinando odds de várias casas.

    TODO(fase 1): buscar odds correntes do evento/mercado e aplicar
    `app.value.engine.remove_vig_*` (método configurável, default 'multiplicative').
    """
    raise NotImplementedError("Cálculo de probabilidade justa será implementado na Fase 1.")


@router.get(
    "/overround/{event_id}/{market}",
    response_model=OverroundResponse,
    summary="Overround por casa de apostas",
)
async def get_overround(event_id: UUID, market: str, db: DbSession) -> OverroundResponse:
    """Retorna a margem (overround) de cada casa de apostas para o evento/mercado.

    TODO(fase 1): buscar odds por casa e aplicar `app.value.engine.calculate_overround`.
    """
    raise NotImplementedError("Cálculo de overround será implementado na Fase 1.")


@router.get(
    "/implied/{event_id}",
    response_model=ImpliedProbabilitiesResponse,
    summary="Probabilidades implícitas de todas as casas para um evento",
)
async def get_implied_probabilities(event_id: UUID, db: DbSession) -> ImpliedProbabilitiesResponse:
    """Retorna as probabilidades implícitas cruas (sem remoção de vig) de todas as casas.

    TODO(fase 1): buscar todas as odds vigentes do evento e aplicar
    `app.value.engine.implied_probability` a cada uma.
    """
    raise NotImplementedError("Cálculo de probabilidades implícitas será implementado na Fase 1.")
