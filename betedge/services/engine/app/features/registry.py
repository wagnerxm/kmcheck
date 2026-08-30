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

Contrato das funções de computação (compute_fn)
-------------------------------------------------
Cada `compute_fn` recebe um dicionário `context` com:
    - "team_id": str  — time para o qual calcular a feature.
    - "as_of": datetime — data de referência (somente dados anteriores a esta).
    - "match_history": list[dict] — lista de partidas do time anteriores a
      `as_of`, ORDENADAS do mais recente para o mais antigo. Cada dict contém
      pelo menos: home_team_id, away_team_id, home_goals, away_goals, kickoff_at.
    - "elo_ratings": dict[str, float] (opcional) — ratings Elo vigentes em `as_of`.
    - "market_odds": dict (opcional) — odds de mercado pré-jogo vigentes.
    - "opponent_id": str (opcional) — adversário na partida a predizer.

A função retorna um valor numérico (float) ou None quando histórico é insuficiente.
"""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
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


# ═══════════════════════════════════════════════════════════════════════════
# Funções de computação de features
# ═══════════════════════════════════════════════════════════════════════════

def _team_goals(match: dict, team_id: str) -> tuple[int, int]:
    """Retorna (gols marcados, gols sofridos) pelo time nesta partida."""
    if match["home_team_id"] == team_id:
        return match["home_goals"], match["away_goals"]
    return match["away_goals"], match["home_goals"]


def _compute_elo_diff(context: dict) -> float | None:
    """Diferença = Elo(home) - Elo(away), no rating vigente em `as_of`.

    Requer que o context contenha "elo_ratings" com o rating dos dois times.
    Se os ratings não estiverem disponíveis, retorna 0.0 (times equilibrados).
    """
    elo_ratings = context.get("elo_ratings", {})
    team_id = context["team_id"]
    opponent_id = context.get("opponent_id")

    if not opponent_id:
        return None

    r_team = elo_ratings.get(team_id, 1500.0)
    r_opp = elo_ratings.get(opponent_id, 1500.0)
    return r_team - r_opp


def _compute_goals_scored_avg_last5(context: dict) -> float | None:
    """Média de gols marcados nos últimos 5 jogos anteriores a `as_of`.

    Retorna None se o time não tiver pelo menos 1 jogo no histórico.
    """
    history = context.get("match_history", [])
    team_id = context["team_id"]

    if not history:
        return None

    recent = history[:5]  # já vem ordenado do mais recente para o mais antigo
    total = sum(_team_goals(m, team_id)[0] for m in recent)
    return total / len(recent)


def _compute_goals_conceded_avg_last5(context: dict) -> float | None:
    """Média de gols sofridos nos últimos 5 jogos anteriores a `as_of`.

    Retorna None se o time não tiver pelo menos 1 jogo no histórico.
    """
    history = context.get("match_history", [])
    team_id = context["team_id"]

    if not history:
        return None

    recent = history[:5]
    total = sum(_team_goals(m, team_id)[1] for m in recent)
    return total / len(recent)


def _compute_rest_days(context: dict) -> float | None:
    """Dias de descanso desde o último jogo disputado antes de `as_of`.

    Retorna None se não houver partida anterior no histórico.
    """
    history = context.get("match_history", [])
    as_of = context["as_of"]

    if not history:
        return None

    last_match = history[0]  # mais recente
    delta = as_of - last_match["kickoff_at"]
    return delta.total_seconds() / 86400.0


def _compute_market_implied_prob(context: dict) -> float | None:
    """Probabilidade implícita de consenso de mercado (sem vig) no momento de `as_of`.

    Requer "market_odds" no context com pelo menos a odds do desfecho
    relevante para o time. Se não disponível, retorna None.
    """
    odds = context.get("market_odds", {})
    team_id = context["team_id"]

    # Busca a odds para o time (pode estar indexada por team_id ou "home"/"away")
    team_odds = odds.get(team_id)
    if team_odds is not None and team_odds > 1.0:
        return 1.0 / team_odds
    return None


def _compute_goals_scored_avg_last10(context: dict) -> float | None:
    """Média de gols marcados nos últimos 10 jogos anteriores a `as_of`."""
    history = context.get("match_history", [])
    team_id = context["team_id"]

    if not history:
        return None

    recent = history[:10]
    total = sum(_team_goals(m, team_id)[0] for m in recent)
    return total / len(recent)


def _compute_goals_conceded_avg_last10(context: dict) -> float | None:
    """Média de gols sofridos nos últimos 10 jogos anteriores a `as_of`."""
    history = context.get("match_history", [])
    team_id = context["team_id"]

    if not history:
        return None

    recent = history[:10]
    total = sum(_team_goals(m, team_id)[1] for m in recent)
    return total / len(recent)


def _compute_points_per_game_last5(context: dict) -> float | None:
    """Pontos por jogo nos últimos 5 jogos (3 vitória, 1 empate, 0 derrota).

    Proxy direta de forma recente — captura tendência de curto prazo que
    modelos baseados em gols (Poisson) não capturam diretamente.
    """
    history = context.get("match_history", [])
    team_id = context["team_id"]

    if not history:
        return None

    recent = history[:5]
    total = 0
    for m in recent:
        scored, conceded = _team_goals(m, team_id)
        if scored > conceded:
            total += 3
        elif scored == conceded:
            total += 1
    return total / len(recent)


def _compute_win_streak(context: dict) -> float:
    """Número de vitórias consecutivas até o jogo anterior (0 se empate/derrota)."""
    history = context.get("match_history", [])
    team_id = context["team_id"]

    streak = 0
    for m in history:
        scored, conceded = _team_goals(m, team_id)
        if scored > conceded:
            streak += 1
        else:
            break
    return float(streak)


def _compute_unbeaten_streak(context: dict) -> float:
    """Jogos consecutivos sem derrota (invencibilidade)."""
    history = context.get("match_history", [])
    team_id = context["team_id"]

    streak = 0
    for m in history:
        scored, conceded = _team_goals(m, team_id)
        if scored >= conceded:
            streak += 1
        else:
            break
    return float(streak)


def _compute_clean_sheet_streak(context: dict) -> float:
    """Jogos consecutivos sem sofrer gol (clean sheet)."""
    history = context.get("match_history", [])
    team_id = context["team_id"]

    streak = 0
    for m in history:
        _, conceded = _team_goals(m, team_id)
        if conceded == 0:
            streak += 1
        else:
            break
    return float(streak)


def _compute_h2h_points_avg(context: dict) -> float | None:
    """Pontos médios obtidos nos confrontos diretos recentes (últimos 10).

    Requer "opponent_id" no context. Usa o match_history que já contém
    apenas jogos do time — filtra os que envolvem o adversário.
    """
    history = context.get("match_history", [])
    team_id = context["team_id"]
    opponent_id = context.get("opponent_id")

    if not opponent_id:
        return None

    # Filtra confrontos diretos do histórico do time
    h2h_matches = [
        m for m in history
        if (m["home_team_id"] == opponent_id or m["away_team_id"] == opponent_id)
    ][:10]

    if not h2h_matches:
        return None

    total = 0
    for m in h2h_matches:
        scored, conceded = _team_goals(m, team_id)
        if scored > conceded:
            total += 3
        elif scored == conceded:
            total += 1
    return total / len(h2h_matches)


def _compute_games_last_14_days(context: dict) -> float:
    """Contagem de partidas nos últimos 14 dias — proxy de fadiga/congestionamento."""
    from datetime import timedelta

    history = context.get("match_history", [])
    as_of = context["as_of"]
    cutoff = as_of - timedelta(days=14)

    return float(sum(1 for m in history if m["kickoff_at"] >= cutoff))


def _compute_is_home(context: dict) -> float:
    """Indicador binário: 1.0 se o time joga em casa, 0.0 se fora.

    Feature básica mas essencial — captura o efeito de mando de campo
    diretamente como variável de entrada para modelos de ML.
    """
    return float(context.get("is_home", 0))


# ═══════════════════════════════════════════════════════════════════════════
# Registro do catálogo de features
# ═══════════════════════════════════════════════════════════════════════════

registry.register(
    FeatureSpec(
        name="elo_diff",
        description="Diferença entre o rating Elo do time e do adversário.",
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
registry.register(
    FeatureSpec(
        name="goals_scored_avg_last10",
        description="Média de gols marcados pelo time nos últimos 10 jogos.",
        compute_fn=_compute_goals_scored_avg_last10,
        min_lookback_days=60,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="goals_conceded_avg_last10",
        description="Média de gols sofridos pelo time nos últimos 10 jogos.",
        compute_fn=_compute_goals_conceded_avg_last10,
        min_lookback_days=60,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="points_per_game_last5",
        description="Pontos por jogo nos últimos 5 jogos (3/1/0).",
        compute_fn=_compute_points_per_game_last5,
        min_lookback_days=30,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="win_streak",
        description="Número de vitórias consecutivas até o jogo anterior.",
        compute_fn=_compute_win_streak,
        min_lookback_days=0,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="unbeaten_streak",
        description="Jogos consecutivos sem derrota (invencibilidade).",
        compute_fn=_compute_unbeaten_streak,
        min_lookback_days=0,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="clean_sheet_streak",
        description="Jogos consecutivos sem sofrer gol.",
        compute_fn=_compute_clean_sheet_streak,
        min_lookback_days=0,
        category="form",
    )
)
registry.register(
    FeatureSpec(
        name="h2h_points_avg",
        description="Pontos médios obtidos nos confrontos diretos recentes (últimos 10).",
        compute_fn=_compute_h2h_points_avg,
        min_lookback_days=0,
        category="h2h",
    )
)
registry.register(
    FeatureSpec(
        name="games_last_14_days",
        description="Partidas disputadas nos últimos 14 dias (fadiga/congestionamento).",
        compute_fn=_compute_games_last_14_days,
        min_lookback_days=0,
        category="context",
    )
)
registry.register(
    FeatureSpec(
        name="is_home",
        description="Indicador binário: 1.0 se joga em casa, 0.0 se fora.",
        compute_fn=_compute_is_home,
        min_lookback_days=0,
        category="context",
    )
)
