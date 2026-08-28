"""Computação de features sob demanda — usada na predição (`predict`) de um único evento.

Prioriza latência baixa (chamado dentro do request-response de
`GET /predictions/{event_id}` e afins) sobre throughput, ao contrário de
`app.features.batch`. Deve produzir exatamente os mesmos valores que o
cálculo em lote produziria para o mesmo evento/`as_of` — qualquer divergência
aqui é "training-serving skew" e degrada silenciosamente a qualidade das
predições em produção.

A garantia de consistência vem de reutilizar as mesmas funções `compute_fn`
registradas em `app.features.registry` — nenhuma reimplementação paralela.
"""
from datetime import datetime
from typing import Any

from app.features.registry import registry


def compute_event_features(
    event_context: dict[str, Any],
    as_of: datetime,
    feature_names: list[str] | None = None,
) -> dict[str, float | None]:
    """Calcula o vetor de features de um único evento, para uso imediato em `model.predict`.

    Args:
        event_context: dados brutos disponíveis sobre o evento e o histórico
            recente dos participantes (times/atletas), já filtrados para não
            conter nada posterior a `as_of`. Espera-se no mínimo:
            - "team_id": str
            - "as_of": datetime (adicionado por esta função se ausente)
            - "match_history": list[dict] — partidas do time anteriores a `as_of`,
              ordenadas do mais recente para o mais antigo.
            Opcionais: "opponent_id", "elo_ratings", "market_odds", "is_home".
        as_of: instante de referência da predição — toda feature computada
            aqui deve refletir apenas informação conhecida até este momento.
        feature_names: subconjunto do catálogo a calcular. Se `None`, calcula
            todas as features registradas.

    Returns:
        dict feature_name -> valor calculado (float ou None se indisponível).
    """
    names = feature_names or registry.names()

    # Garante que o context contém as_of para as funções que precisam dele.
    context = dict(event_context)
    context["as_of"] = as_of

    features: dict[str, float | None] = {}
    for name in names:
        spec = registry.get(name)
        try:
            value = spec.compute_fn(context)
        except Exception:
            # Feature indisponível (histórico insuficiente, campo ausente, etc.).
            # O modelo consumidor deve tratar None/NaN adequadamente.
            value = None
        features[name] = value

    return features
