"""Task de computação de features em lote — executada de forma assíncrona pelo worker Python.

Materializa, para um conjunto (potencialmente grande) de eventos históricos,
as features usadas no treino dos modelos (ver `app.features.batch` no Motor
Estatístico), gravando o resultado em uma tabela/cache de features
pré-calculadas para acelerar treinos e retreinos subsequentes — recalcular
features do zero a cada treino seria caro e desnecessário quando o histórico
subjacente não mudou.
"""
from datetime import datetime
from typing import Any

from celery_app import celery_app


@celery_app.task(
    name="tasks.compute_features_batch",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
)
def compute_features_batch(
    self,
    feature_names: list[str] | None = None,
    start_date_iso: str | None = None,
    end_date_iso: str | None = None,
    league: str | None = None,
) -> dict[str, Any]:
    """Calcula e persiste features em lote para os eventos no intervalo/escopo informado.

    Args:
        feature_names: subconjunto do catálogo (`app.features.registry`) a
            calcular. `None` calcula todas as features registradas.
        start_date_iso / end_date_iso: intervalo de eventos a processar, em
            ISO 8601. `None` em ambos processa todo o histórico disponível
            (uso tipicamente único, ex.: após adicionar uma feature nova ao
            catálogo — recomputações incrementais devem sempre informar o
            intervalo para não reprocessar tudo).
        league: filtro opcional por liga/competição.

    Returns:
        dict com o resumo da execução: nº de eventos processados, nº de
        features calculadas, tempo de execução.

    TODO(fase 1):
        1. Carregar o conjunto de eventos no escopo (`start_date`/`end_date`/`league`).
        2. Chamar `app.features.batch.compute_batch_features` (Motor
           Estatístico) — ou a lógica equivalente compartilhada — sobre esse
           conjunto, respeitando `validate_batch_no_leakage` antes de persistir.
        3. Upsert do resultado na tabela/cache de features materializadas,
           versionado por `feature_name` (permitindo invalidar e recalcular
           uma única feature sem afetar as demais).
    """
    start_date = datetime.fromisoformat(start_date_iso) if start_date_iso else None
    end_date = datetime.fromisoformat(end_date_iso) if end_date_iso else None

    if start_date and end_date and start_date >= end_date:
        raise ValueError("start_date deve ser anterior a end_date.")

    self.update_state(
        state="STARTED",
        meta={"feature_names": feature_names, "league": league},
    )

    raise NotImplementedError(
        f"Computação de features em lote (feature_names={feature_names}, "
        f"período={start_date_iso}..{end_date_iso}, league={league}) "
        "será implementada na Fase 1."
    )
