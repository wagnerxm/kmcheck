"""Endpoint de health check — usado por probes de liveness/readiness.

Inclui sub-endpoints granulares para cada componente (/health/db, /health/redis)
e status operacional do Shadow Mode (/health/shadow, /health/scheduler).
"""
import logging
import time

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


class ShadowHealthResponse(BaseModel):
    """Status do Shadow Mode."""

    status: str
    shadow_enabled: bool
    dry_run: bool
    system_status: str | None = None
    total_predictions: int = 0
    total_selections: int = 0
    last_pipeline_run: str | None = None
    last_pipeline_status: str | None = None
    scheduler_version: str | None = None


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


# ---------------------------------------------------------------------------
# Sub-endpoints granulares — permitem monitorar cada componente isoladamente
# ---------------------------------------------------------------------------


@router.get("/health/db", summary="Verifica conectividade com o banco de dados")
async def health_db(db: DbSession) -> ComponentStatus:
    """Verifica conexão com Postgres, retornando latência."""
    start = time.monotonic()
    try:
        await db.execute(text("SELECT 1"))
        latency = round((time.monotonic() - start) * 1000, 1)
        return ComponentStatus(ok=True, detail=f"latência: {latency}ms")
    except Exception as exc:  # noqa: BLE001
        return ComponentStatus(ok=False, detail=str(exc))


@router.get("/health/redis", summary="Verifica conectividade com Redis")
async def health_redis(redis: RedisClient) -> ComponentStatus:
    """Verifica conexão com Redis, retornando latência."""
    start = time.monotonic()
    try:
        await redis.ping()
        latency = round((time.monotonic() - start) * 1000, 1)
        return ComponentStatus(ok=True, detail=f"latência: {latency}ms")
    except Exception as exc:  # noqa: BLE001
        return ComponentStatus(ok=False, detail=str(exc))


@router.get(
    "/health/shadow",
    response_model=ShadowHealthResponse,
    summary="Status do Shadow Mode",
)
async def health_shadow(db: DbSession) -> ShadowHealthResponse:
    """Status operacional do Shadow Mode: contagens, último run, scheduler."""
    from app.core.config import settings

    if not settings.SHADOW_ENABLED:
        return ShadowHealthResponse(
            status="disabled",
            shadow_enabled=False,
            dry_run=settings.SHADOW_DRY_RUN,
        )

    try:
        # Contagens de predições e seleções
        pred_count = await db.execute(
            text("SELECT COUNT(*) FROM shadow_predictions")
        )
        total_preds = int(pred_count.scalar() or 0)

        sel_count = await db.execute(
            text(
                "SELECT COUNT(*) FROM shadow_predictions "
                "WHERE is_shadow_selection = TRUE"
            )
        )
        total_sels = int(sel_count.scalar() or 0)

        # Último pipeline run (mais recente por started_at)
        last_run = await db.execute(
            text(
                "SELECT pipeline_run_id, status, started_at "
                "FROM shadow_pipeline_runs "
                "ORDER BY started_at DESC LIMIT 1"
            )
        )
        run_row = last_run.mappings().first()

        last_run_id = run_row["pipeline_run_id"] if run_row else None
        last_run_status = run_row["status"] if run_row else None

        # Status geral do sistema — função opcional do engine
        system_status = None
        try:
            from app.shadow.engine import _determine_system_status

            status_result = await _determine_system_status(db)
            system_status = status_result
        except Exception:  # noqa: BLE001 — não falha se a função não existir
            pass

        # Versão do scheduler — exposta como constante opcional
        scheduler_ver = None
        try:
            from app.shadow.scheduler import SCHEDULER_VERSION

            scheduler_ver = SCHEDULER_VERSION
        except ImportError:
            pass

        return ShadowHealthResponse(
            status="ok",
            shadow_enabled=True,
            dry_run=settings.SHADOW_DRY_RUN,
            system_status=system_status,
            total_predictions=total_preds,
            total_selections=total_sels,
            last_pipeline_run=last_run_id,
            last_pipeline_status=last_run_status,
            scheduler_version=scheduler_ver,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro ao verificar shadow health")
        return ShadowHealthResponse(
            status="degraded",
            shadow_enabled=True,
            dry_run=settings.SHADOW_DRY_RUN,
        )


@router.get("/health/scheduler", summary="Status do scheduler shadow")
async def health_scheduler() -> dict:
    """Status de configuração do scheduler de jobs shadow."""
    try:
        from app.shadow.scheduler import get_scheduler_status

        return {"status": "ok", **get_scheduler_status()}
    except ImportError:
        return {"status": "not_configured", "detail": "scheduler module não disponível"}
