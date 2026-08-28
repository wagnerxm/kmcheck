"""Endpoints de predições geradas pelos modelos estatísticos.

Fase 0: apenas o contrato (rotas, schemas, status codes) está definido.
A lógica de geração/consulta real será implementada nas fases seguintes,
quando os modelos em `app/models/` estiverem treinados.
"""
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field

from app.core.deps import DbSession

router = APIRouter()


class MarketType(StrEnum):
    """Mercados suportados pelo motor de predições."""

    MATCH_RESULT = "match_result"       # 1X2
    BOTH_TEAMS_TO_SCORE = "btts"
    OVER_UNDER_GOALS = "over_under_goals"
    ASIAN_HANDICAP = "asian_handicap"
    CORRECT_SCORE = "correct_score"
    DOUBLE_CHANCE = "double_chance"


class ModelPrediction(BaseModel):
    """Predição de um único modelo para um único mercado/evento."""

    model_id: str
    model_name: str
    model_version: str
    event_id: UUID
    market: MarketType
    outcome: str
    probability: float = Field(ge=0.0, le=1.0)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    generated_at: datetime


class EventPredictionsResponse(BaseModel):
    """Conjunto de predições (de todos os modelos) para um evento."""

    event_id: UUID
    predictions: list[ModelPrediction]
    consensus: ModelPrediction | None = None


class GeneratePredictionsRequest(BaseModel):
    """Payload para disparar a geração de predições para eventos futuros."""

    event_ids: list[UUID] | None = Field(
        default=None,
        description="IDs específicos de eventos. Se omitido, processa todos os eventos futuros elegíveis.",
    )
    model_ids: list[str] | None = Field(
        default=None,
        description="Restringe a geração a modelos específicos. Se omitido, roda todos os modelos ativos.",
    )
    force_regenerate: bool = Field(
        default=False,
        description="Se True, regenera mesmo que já exista predição recente para o evento/modelo.",
    )


class GeneratePredictionsResponse(BaseModel):
    """Confirmação de que o job de geração foi enfileirado (execução é assíncrona)."""

    job_id: UUID
    events_queued: int
    status: str = "queued"


@router.get(
    "/{event_id}",
    response_model=EventPredictionsResponse,
    summary="Predições de todos os modelos para um evento",
)
async def get_event_predictions(event_id: UUID, db: DbSession) -> EventPredictionsResponse:
    """Retorna todas as predições (por modelo) disponíveis para o evento, mais o consenso.

    TODO(fase 1): consultar tabela `predictions` filtrando por `event_id` e
    calcular o consenso via `app.models.market_consensus` / `app.models.ensemble`.
    """
    raise NotImplementedError("Geração/consulta de predições será implementada na Fase 1.")


@router.post(
    "/generate",
    response_model=GeneratePredictionsResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Dispara geração de predições para eventos futuros",
)
async def generate_predictions(payload: GeneratePredictionsRequest, db: DbSession) -> GeneratePredictionsResponse:
    """Enfileira um job assíncrono (Celery, worker Python) que roda os modelos ativos.

    TODO(fase 1): publicar task `tasks.generate_predictions` na fila do Celery
    e retornar o `job_id` correspondente para acompanhamento via `/backtest`-like status.
    """
    raise NotImplementedError("Disparo de geração de predições será implementado na Fase 1.")


@router.get(
    "/latest",
    response_model=list[ModelPrediction],
    summary="Últimas predições geradas, com filtros",
)
async def get_latest_predictions(
    db: DbSession,
    market: MarketType | None = Query(default=None),
    league: str | None = Query(default=None, description="Código/slug da liga/competição."),
    model_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[ModelPrediction]:
    """Lista as predições mais recentes, opcionalmente filtradas por mercado/liga/modelo.

    TODO(fase 1): consultar `predictions` ordenando por `generated_at DESC`
    aplicando os filtros recebidos via query params.
    """
    raise NotImplementedError("Consulta de predições recentes será implementada na Fase 1.")
