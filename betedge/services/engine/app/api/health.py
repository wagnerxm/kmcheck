"""Endpoint de health check — usado por probes de liveness/readiness."""
import logging

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.core.deps import DbSession, RedisClient

logger = logging.getLogger(__name__)

router = APIRouter()

APP_VERSION = "0.1.0"


class ComponentStatus(BaseModel):
    """Status de uma dependência externa (banco, cache, etc.)."""

    ok: bool
    detail: str | None = None


class HealthResponse(BaseModel):
    """Corpo de resposta do health check."""

    status: str
    version: str
    database: ComponentStatus
    redis: ComponentStatus


@router.get("/health", response_model=HealthResponse, summary="Verifica a saúde do serviço")
async def health_check(db: DbSession, redis: RedisClient) -> HealthResponse:
    """Confere conectividade real com Postgres e Redis, não apenas se o processo está de pé.

    Retorna 200 mesmo quando uma dependência está indisponível — o corpo da
    resposta detalha qual componente falhou, e quem consome (BFF/orquestrador
    de infra) decide como reagir a um `status != "ok"`.
    """
    db_status = ComponentStatus(ok=True)
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — queremos capturar qualquer falha de conexão
        logger.exception("Falha ao verificar conexão com o banco de dados.")
        db_status = ComponentStatus(ok=False, detail=str(exc))

    redis_status = ComponentStatus(ok=True)
    try:
        await redis.ping()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Falha ao verificar conexão com o Redis.")
        redis_status = ComponentStatus(ok=False, detail=str(exc))

    overall = "ok" if db_status.ok and redis_status.ok else "degraded"

    return HealthResponse(
        status=overall,
        version=APP_VERSION,
        database=db_status,
        redis=redis_status,
    )
