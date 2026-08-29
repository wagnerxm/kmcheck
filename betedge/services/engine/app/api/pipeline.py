"""Endpoints do pipeline PREDIQ — disparo, status e grading.

Expõe o orquestrador do pipeline como endpoints HTTP para o BFF. O fluxo
completo (treino → predição → valor → grading) é executado via `run_pipeline`.

Contrato: PIPELINE_CONTRACT.md v1.0.0.
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, Field

from app.core.deps import DbSession
from app.pipeline.orchestrator import (
    PipelineRunResult,
    grade_value_opportunities,
    run_pipeline,
)

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════
# Schemas
# ═══════════════════════════════════════════════════════════════════════════

class RunPipelineRequest(BaseModel):
    """Payload para disparar execução do pipeline."""
    event_ids: list[UUID] | None = Field(
        default=None,
        description="IDs de eventos específicos. Se omitido, processa todos os futuros com odds.",
    )
    cutoff_date: datetime | None = Field(
        default=None,
        description="Data de corte para treino. Se omitida, usa now().",
    )
    ensemble_strategy: str = Field(
        default="simple_average",
        description="Estratégia do ensemble: simple_average, weighted_average, stacking.",
    )


class PipelineStatusResponse(BaseModel):
    """Resposta resumida da execução do pipeline."""
    run_id: str
    started_at: datetime
    finished_at: datetime | None = None
    events_processed: int
    total_predictions: int
    total_consensus: int
    total_value_opportunities: int
    model_versions_created: list[str]
    errors: list[str]


class GradeResponse(BaseModel):
    """Resposta do grading de value_opportunities."""
    opportunities_graded: int
    message: str


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@router.post(
    "/run",
    response_model=PipelineStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Executa o pipeline PREDIQ completo (síncrono)",
)
async def run_pipeline_endpoint(
    payload: RunPipelineRequest,
    db: DbSession,
) -> PipelineStatusResponse:
    """Executa o pipeline end-to-end: treino → predição → valor → grading.

    Execução síncrona (aguarda a conclusão). Para grandes volumes, usar o
    endpoint assíncrono (fase 2 — BullMQ/Celery).
    """
    event_ids_str = (
        [str(eid) for eid in payload.event_ids] if payload.event_ids else None
    )

    result = await run_pipeline(
        db=db,
        event_ids=event_ids_str,
        cutoff_date=payload.cutoff_date,
        ensemble_strategy=payload.ensemble_strategy,
    )

    return PipelineStatusResponse(
        run_id=result.run_id,
        started_at=result.started_at,
        finished_at=result.finished_at,
        events_processed=result.events_processed,
        total_predictions=result.total_predictions,
        total_consensus=result.total_consensus,
        total_value_opportunities=result.total_value_opportunities,
        model_versions_created=result.model_versions_created,
        errors=result.errors,
    )


@router.post(
    "/grade",
    response_model=GradeResponse,
    summary="Grading de value_opportunities de eventos finalizados",
)
async def grade_opportunities_endpoint(db: DbSession) -> GradeResponse:
    """Atualiza status de value_opportunities (active → won/lost/void) para
    eventos com resultado final.

    Usa fn_outcome_won para derivar o acerto/erro — NUNCA modifica
    model_predictions (append-only).
    """
    count = await grade_value_opportunities(db)
    return GradeResponse(
        opportunities_graded=count,
        message=f"{count} oportunidades atualizadas pelo grading.",
    )
