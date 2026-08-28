"""Registro central de features — catálogo com metadados de cada feature usada pelos modelos.

Ter um registro único evita duas classes de bug muito comuns em projetos de
modelagem esportiva:

1. **Vazamento de dados (leakage)**: uma feature calculada com uma janela
   temporal errada (ex.: incluindo o próprio jogo que está sendo predito).
   Cada `FeatureSpec` declara explicitamente `min_lookback_days` para deixar
   claro qual é a defasagem mínima segura de dados exigida.
2. **Divergência treino/predição (training-serving skew)**: a mesma feature
   calculada de formas ligeiramente diferentes em `app.features.batch`
   (treino) e `app.features.on_demand` (predição). Ao registrar a função de
   computação uma única vez aqui, ambos os módulos reaproveitam exatamente
   o mesmo código.
"""
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FeatureSpec:
    """Metadados de uma feature disponível para os modelos."""

    name: str
    description: str
    # Função pura: recebe o contexto bruto do evento (histórico disponível
    # até `as_of`) e retorna o valor numérico/categórico da feature.
    compute_fn: Callable[..., Any]
    # Nº mínimo de dias de histórico anteriores a `as_of` necessários para a
    # feature ser computável de forma confiável (ex.: médias móveis de N jogos).
    min_lookback_days: int
    dtype: str = "float"
    # Categoria usada para organizar o catálogo (ex.: "form", "rating", "market", "context").
    category: str = "general"


class FeatureRegistry:
    """Catálogo em memória de todas as `FeatureSpec` conhecidas pelo Motor Estatístico."""

    def __init__(self) -> None:
        self._features: dict[str, FeatureSpec] = {}

    def register(self, spec: FeatureSpec) -> None:
        """Adiciona (ou substitui) uma feature no catálogo."""
        if spec.name in self._features:
            raise ValueError(f"Feature '{spec.name}' já registrada — use um nome único.")
        self._features[spec.name] = spec

    def get(self, name: str) -> FeatureSpec:
        """Busca a especificação de uma feature pelo nome; levanta KeyError se ausente."""
        return self._features[name]

    def list_by_category(self, category: str) -> list[FeatureSpec]:
        """Lista todas as features de uma categoria (ex.: 'form', 'rating')."""
        return [f for f in self._features.values() if f.category == category]

    def all(self) -> list[FeatureSpec]:
        """Retorna todas as features registradas."""
        return list(self._features.values())

    def names(self) -> list[str]:
        """Retorna apenas os nomes das features registradas, para montar vetores de feature."""
        return list(self._features.keys())


# Instância global reaproveitada por `app.features.batch` e `app.features.on_demand`.
registry = FeatureRegistry()


# --- Placeholders das funções de computação -------------------------------
# As implementações completas (consulta ao histórico, cálculo de médias
# móveis, etc.) chegam na Fase 1, junto com o schema definitivo do banco.
# Por ora, cada função apenas documenta o contrato esperado.

def _compute_elo_diff(context: dict) -> float:
    """diferença = elo(home) - elo(away), no rating vigente em `as_of`."""
    raise NotImplementedError("Cálculo de elo_diff será implementado na Fase 1.")


def _compute_goals_scored_avg_last5(context: dict) -> float:
    """Média de gols marcados nos últimos 5 jogos anteriores a `as_of`."""
    raise NotImplementedError("Cálculo de goals_scored_avg_last5 será implementado na Fase 1.")


def _compute_goals_conceded_avg_last5(context: dict) -> float:
    """Média de gols sofridos nos últimos 5 jogos anteriores a `as_of`."""
    raise NotImplementedError("Cálculo de goals_conceded_avg_last5 será implementado na Fase 1.")


def _compute_rest_days(context: dict) -> float:
    """Dias de descanso desde o último jogo disputado antes de `as_of`."""
    raise NotImplementedError("Cálculo de rest_days será implementado na Fase 1.")


def _compute_market_implied_prob(context: dict) -> float:
    """Probabilidade implícita de consenso de mercado (sem vig) no momento de `as_of`."""
    raise NotImplementedError("Cálculo de market_implied_prob será implementado na Fase 1.")


# --- Registro do catálogo inicial ------------------------------------------

registry.register(
    FeatureSpec(
        name="elo_diff",
        description="Diferença entre o rating Elo do mandante e do visitante.",
        compute_fn=_compute_elo_diff,
        min_lookback_days=0,
        category="rating",
    )
)
registry.register(
    FeatureSpec(
        name="goals_scored_avg_last5",
        description="Média de gols marcados pelo time nos últimos 5 jogos.",
        compute_fn=_compute_goals_scored_avg_last5,
        min_lookback_days=30,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="goals_conceded_avg_last5",
        description="Média de gols sofridos pelo time nos últimos 5 jogos.",
        compute_fn=_compute_goals_conceded_avg_last5,
        min_lookback_days=30,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="rest_days",
        description="Dias de descanso desde a última partida disputada.",
        compute_fn=_compute_rest_days,
        min_lookback_days=0,
        category="context",
    )
)
registry.register(
    FeatureSpec(
        name="market_implied_prob",
        description="Probabilidade justa (sem vig) de consenso de mercado no momento da predição.",
        compute_fn=_compute_market_implied_prob,
        min_lookback_days=0,
        category="market",
    )
)
