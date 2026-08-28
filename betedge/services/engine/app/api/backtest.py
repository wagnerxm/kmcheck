"""Endpoints de backtesting — validação histórica de modelos/estratégias de aposta."""
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.core.deps import DbSession

router = APIRouter()


class BacktestJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class BacktestRunRequest(BaseModel):
    """Configuração de um job de backtest."""

    model_ids: list[str] = Field(description="Modelos a avaliar (ou uma estratégia de ensemble).")
    start_date: datetime
    end_date: datetime
    markets: list[str] | None = Field(default=None)
    leagues: list[str] | None = Field(default=None)
    staking_strategy: str = Field(
        default="flat",
        description="Estratégia de stake: 'flat', 'kelly', 'fractional_kelly'.",
    )
    min_edge: float = Field(default=0.0, description="Edge mínimo para considerar a aposta na simulação.")
    initial_bankroll: float = Field(default=1000.0, gt=0)


class BacktestRunResponse(BaseModel):
    """Confirmação de enfileiramento do backtest (execução é assíncrona, via Celery)."""

    job_id: UUID
    status: BacktestJobStatus = BacktestJobStatus.QUEUED


class BacktestStatusResponse(BaseModel):
    """Status corrente de um job de backtest."""

    job_id: UUID
    status: BacktestJobStatus
    progress_pct: float = Field(ge=0.0, le=100.0, default=0.0)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None


class BacktestResultsResponse(BaseModel):
    """Resultados agregados de um backtest concluído."""

    job_id: UUID
    n_bets: int
    n_wins: int
    hit_rate: float = Field(ge=0.0, le=1.0)
    roi_pct: float
    final_bankroll: float
    max_drawdown_pct: float
    brier_score: float
    expected_calibration_error: float
    average_clv_pct: float | None = None


@router.post(
    "/run",
    response_model=BacktestRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Inicia um job de backtest",
)
async def run_backtest(payload: BacktestRunRequest, db: DbSession) -> BacktestRunResponse:
    """Enfileira a execução do backtest no worker Python (Celery).

    TODO(fase 1): publicar `tasks.run_backtest` com os parâmetros recebidos,
    validando `start_date < end_date` e persistindo o registro do job.
    """
    raise NotImplementedError("Execução de backtest será implementada na Fase 1.")


@router.get(
    "/{job_id}/status",
    response_model=BacktestStatusResponse,
    summary="Consulta o status de um job de backtest",
)
async def get_backtest_status(job_id: UUID, db: DbSession) -> BacktestStatusResponse:
    """Consulta o progresso do job (via resultado assíncrono do Celery + registro no banco).

    TODO(fase 1): consultar tabela `backtest_jobs` e/ou `AsyncResult` do Celery.
    """
    raise NotImplementedError("Consulta de status de backtest será implementada na Fase 1.")


@router.get(
    "/{job_id}/results",
    response_model=BacktestResultsResponse,
    summary="Obtém os resultados de um backtest concluído",
)
async def get_backtest_results(job_id: UUID, db: DbSession) -> BacktestResultsResponse:
    """Retorna as métricas agregadas de um backtest já concluído.

    TODO(fase 1): consultar `backtest_results`; retornar 409/425 se o job
    ainda não tiver terminado (checar `status` antes de buscar resultados).
    """
    raise NotImplementedError("Consulta de resultados de backtest será implementada na Fase 1.")
