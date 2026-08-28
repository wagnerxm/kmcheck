"""Computação de features sob demanda — usada na predição (`predict`) de um único evento.

Prioriza latência baixa (chamado dentro do request-response de
`GET /predictions/{event_id}` e afins) sobre throughput, ao contrário de
`app.features.batch`. Deve produzir exatamente os mesmos valores que o
cálculo em lote produziria para o mesmo evento/`as_of` — qualquer divergência
aqui é "training-serving skew" e degrada silenciosamente a qualidade das
predições em produção.
"""
from datetime import datetime
from typing import Any

from app.features.registry import registry


def compute_event_features(
    event_context: dict[str, Any],
    as_of: datetime,
    feature_names: list[str] | None = None,
) -> dict[str, float]:
    """Calcula o vetor de features de um único evento, para uso imediato em `model.predict`.

    Args:
        event_context: dados brutos disponíveis sobre o evento e o histórico
            recente dos participantes (times/atletas), já filtrados para não
            conter nada posterior a `as_of` (contrato reforçado por
            `BaseModel.validate_no_leakage` no modelo que consumir o resultado).
        as_of: instante de referência da predição — toda feature computada
            aqui deve refletir apenas informação conhecida até este momento.
        feature_names: subconjunto do catálogo a calcular. Se `None`, calcula
            todas as features registradas.

    Returns:
        dict feature_name -> valor calculado.

    TODO(fase 1): para cada `FeatureSpec` selecionada, chamar
    `spec.compute_fn(event_context)` reaproveitando exatamente a mesma
    implementação usada por `app.features.batch.compute_batch_features`
    (idealmente a mesma função Python, não uma reimplementação paralela).
    """
    names = feature_names or registry.names()

    features: dict[str, float] = {}
    for name in names:
        spec = registry.get(name)
        # `min_lookback_days` é usado aqui apenas como contrato documentado;
        # a validação efetiva de histórico suficiente entra na Fase 1, junto
        # com o acesso real ao histórico via `event_context`.
        features[name] = spec.compute_fn(event_context)

    return features
