"""Endpoints de gestão de modelos (versões, performance, retreino, consenso).

Nomeado `models_api` (em vez de `models`) para não colidir com o pacote
`app.models`, que contém as implementações estatísticas propriamente ditas.
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.core.deps import DbSession

router = APIRouter()


class ModelSummary(BaseModel):
    """Resumo de uma versão de modelo registrada."""

    model_id: str
    name: str
    version: str
    model_type: str = Field(description="Ex.: 'poisson', 'dixon_coles', 'xgboost', 'ensemble'.")
    is_active: bool
    trained_at: datetime | None = None
    brier_score: float | None = None
    accuracy: float | None = None


class ModelPerformanceMetrics(BaseModel):
    """Métricas detalhadas de performance de um modelo em um período."""

    model_id: str
    period_start: datetime
    period_end: datetime
    brier_score: float
    brier_skill_score: float | None = None
    expected_calibration_error: float
    maximum_calibration_error: float
    log_loss: float | None = None
    accuracy: float | None = None
    n_predictions: int


class RetrainRequest(BaseModel):
    """Payload para disparar retreino assíncrono de um modelo."""

    cutoff_date: datetime = Field(description="Treina apenas com dados até esta data (inclusive).")
    hyperparameters: dict | None = Field(default=None, description="Override opcional de hiperparâmetros.")


class RetrainResponse(BaseModel):
    """Confirmação de que o retreino foi enfileirado no Celery."""

    job_id: UUID
    model_id: str
    status: str = "queued"


class ConsensusPrediction(BaseModel):
    """Predição de consenso combinando todos os modelos ativos para um evento."""

    event_id: UUID
    market: str
    outcome: str
    consensus_probability: float = Field(ge=0.0, le=1.0)
    contributing_models: list[str]
    agreement_score: float = Field(ge=0.0, le=1.0, description="Quão próximas as predições individuais estão entre si.")


@router.get("", response_model=list[ModelSummary], summary="Lista todas as versões de modelo")
async def list_models(db: DbSession) -> list[ModelSummary]:
    """Lista todos os modelos registrados com suas métricas de performance mais recentes.

    TODO(fase 1): consultar tabela `model_versions` com join na última avaliação
    de performance disponível.
    """
    raise NotImplementedError("Listagem de modelos será implementada na Fase 1.")


@router.get(
    "/{model_id}/performance",
    response_model=ModelPerformanceMetrics,
    summary="Métricas detalhadas de performance de um modelo",
)
async def get_model_performance(model_id: str, db: DbSession) -> ModelPerformanceMetrics:
    """Retorna métricas de performance (Brier, calibração, etc.) do modelo no período avaliado.

    TODO(fase 1): agregar predições resolvidas do modelo e calcular métricas
    via `app.metrics.brier` e `app.metrics.calibration`.
    """
    raise NotImplementedError("Métricas de performance de modelo serão implementadas na Fase 1.")


@router.post(
    "/{model_id}/retrain",
    response_model=RetrainResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Dispara retreino assíncrono de um modelo",
)
async def retrain_model(model_id: str, payload: RetrainRequest, db: DbSession) -> RetrainResponse:
    """Enfileira o retreino do modelo no worker Python (Celery), respeitando `cutoff_date`.

    TODO(fase 1): publicar `tasks.train_model` com `model_id`, `cutoff_date` e
    `hyperparameters`, retornando o `job_id` do Celery para acompanhamento.
    """
    raise NotImplementedError("Retreino de modelo será implementado na Fase 1.")


@router.get(
    "/consensus/{event_id}",
    response_model=ConsensusPrediction,
    summary="Predição de consenso entre todos os modelos ativos",
)
async def get_consensus_prediction(event_id: UUID, db: DbSession) -> ConsensusPrediction:
    """Combina as predições de todos os modelos ativos via `app.models.ensemble`.

    TODO(fase 1): buscar predições individuais do evento e aplicar a estratégia
    de combinação configurada (média ponderada por performance histórica, etc.).
    """
    raise NotImplementedError("Predição de consenso será implementada na Fase 1.")
