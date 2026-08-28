"""Computação de features em lote — usada no treino de modelos (`train`).

Diferente de `app.features.on_demand` (um evento por vez, latência baixa),
este módulo é otimizado para throughput: calcula features para muitos
eventos históricos de uma vez, tipicamente via operações vetorizadas do
pandas sobre todo o histórico relevante.
"""
from datetime import datetime

import pandas as pd

from app.features.registry import registry


def compute_batch_features(
    events: pd.DataFrame,
    feature_names: list[str] | None = None,
    cutoff_date: datetime | None = None,
) -> pd.DataFrame:
    """Calcula um DataFrame de features para um conjunto de eventos históricos.

    Args:
        events: DataFrame com uma linha por evento (deve conter, no mínimo,
            `event_id`, `home_team`, `away_team`, `kickoff_at`).
        feature_names: subconjunto do catálogo (`app.features.registry`) a
            calcular. Se `None`, calcula todas as features registradas.
        cutoff_date: quando fornecido, filtra `events` para
            `kickoff_at <= cutoff_date` ANTES de calcular qualquer feature —
            a principal barreira contra vazamento de dados no treino em lote.

    Returns:
        DataFrame com `event_id` + uma coluna por feature calculada.

    TODO(fase 1): para cada `FeatureSpec` selecionada, aplicar
    `spec.compute_fn` de forma vetorizada (idealmente reescrita em pandas/
    numpy puro para performance, mantendo a mesma semântica documentada na
    `FeatureSpec`) sobre o histórico anterior a cada `kickoff_at` — nunca
    sobre o próprio evento sendo calculado.
    """
    if cutoff_date is not None and "kickoff_at" in events.columns:
        events = events[events["kickoff_at"] <= cutoff_date]

    names = feature_names or registry.names()
    for name in names:
        # Valida cedo que toda feature pedida existe no catálogo, mesmo antes
        # da lógica de cálculo em si estar implementada.
        registry.get(name)

    raise NotImplementedError("Cálculo de features em lote será implementado na Fase 1.")


def validate_batch_no_leakage(features: pd.DataFrame, cutoff_date: datetime) -> bool:
    """Confere que nenhuma linha do DataFrame de features usa dados posteriores a `cutoff_date`.

    Verificação complementar a `BaseModel.validate_no_leakage`, aplicada em
    lote logo após `compute_batch_features` e antes de qualquer `model.train`.
    """
    if "kickoff_at" not in features.columns:
        return True
    return bool((features["kickoff_at"] <= cutoff_date).all())
