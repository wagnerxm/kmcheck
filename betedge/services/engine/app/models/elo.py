"""Sistema de rating Elo adaptado para partidas esportivas com resultado de 3 vias.

Formulação matemática
----------------------
Cada time i tem um rating R_i, inicializado tipicamente em 1500. Antes de
uma partida entre home e away, a expectativa de vitória do mandante é dada
pela função logística padrão do Elo, ajustada por um bônus de mando de campo
(`home_field_bonus`, tipicamente ~100 pontos de rating):

    E_home = 1 / (1 + 10 ** (-(R_home + home_field_bonus - R_away) / 400))
    E_away = 1 - E_home

Após o resultado, os ratings são atualizados proporcionalmente ao erro entre
o resultado observado (S) e o esperado (E), escalado por um fator K:

    R_home' = R_home + K * (S_home - E_home)
    R_away' = R_away + K * (S_away - E_away)

Para resultado de 3 vias (vitória/empate/derrota) usamos o "score" contínuo:
    S = 1.0 se vitória, 0.5 se empate, 0.0 se derrota
(S_home + S_away = 1, preservando a propriedade de soma-zero do Elo clássico.)

Uma variante amplamente usada em futebol (Elo do FiveThirtyEight/ClubElo)
pondera a atualização pela margem de vitória (Margin of Victory), usando um
multiplicador logarítmico:

    mov_multiplier = ln(|goal_diff| + 1) * (2.2 / (rating_diff * 0.001 + 2.2))

de forma que goleadas movem o rating mais do que vitórias de 1 gol, com
retornos decrescentes para evitar que um único resultado dispare o rating.

Conversão de rating para probabilidade de mercado (1X2) requer um passo
adicional: a expectativa E_home acima só dá P(não-derrota). Probabilidades
separadas de vitória/empate/derrota tipicamente vêm de um modelo auxiliar
(ex.: regressão logística ordinal ou lookup histórico) calibrado sobre a
diferença de rating — ver `app.models.logistic` para essa combinação.
"""
from datetime import datetime
from typing import Any

from app.models.base import BaseModel, PredictionResult

DEFAULT_INITIAL_RATING = 1500.0


class EloModel(BaseModel):
    """Sistema de rating Elo com bônus de mando de campo e ajuste por margem de vitória."""

    name = "elo"
    version = "1.0.0"

    def __init__(
        self,
        k_factor: float = 20.0,
        home_field_bonus: float = 100.0,
        initial_rating: float = DEFAULT_INITIAL_RATING,
        use_margin_of_victory: bool = True,
    ) -> None:
        self.k_factor = k_factor
        self.home_field_bonus = home_field_bonus
        self.initial_rating = initial_rating
        self.use_margin_of_victory = use_margin_of_victory

        # dict time -> rating corrente. Populado incrementalmente durante `train`
        # (o Elo é atualizado partida a partida, em ordem cronológica).
        self.ratings: dict[str, float] = {}
        self._trained_at: datetime | None = None
        self._last_update_at: dict[str, datetime] = {}

    def expected_score(self, rating_home: float, rating_away: float) -> float:
        """E_home = P(mandante não perde), via função logística do Elo com bônus de mando."""
        diff = (rating_home + self.home_field_bonus) - rating_away
        return 1.0 / (1.0 + 10 ** (-diff / 400.0))

    def mov_multiplier(self, goal_diff: int, rating_diff: float) -> float:
        """Multiplicador de margem de vitória (variante FiveThirtyEight/ClubElo).

        Amplia a atualização de rating proporcionalmente ao tamanho da goleada,
        com retornos decrescentes controlados pelo termo `rating_diff * 0.001`.
        """
        import math

        if goal_diff == 0:
            return 1.0
        return math.log(abs(goal_diff) + 1) * (2.2 / (abs(rating_diff) * 0.001 + 2.2))

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Reprocessa o histórico partida a partida (em ordem cronológica) até `cutoff_date`.

        Passos previstos (implementação completa na Fase 1):
            1. Filtrar e ordenar `training_data` por `kickoff_at`, descartando
               qualquer partida com `kickoff_at > cutoff_date`.
            2. Para cada partida: calcular `expected_score`, obter o score
               observado real (1/0.5/0) e o multiplicador de MoV, e atualizar
               `self.ratings[home_team]`/`self.ratings[away_team]` via
               `R' = R + K * mov_multiplier * (S - E)`.
            3. Times sem rating prévio entram com `self.initial_rating`.
        """
        raise NotImplementedError("Reprocessamento cronológico de ratings Elo será implementado na Fase 1.")

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Converte a diferença de rating em probabilidades de vitória/empate/derrota.

        Requer um mapeamento calibrado rating_diff -> P(vitória)/P(empate)/P(derrota)
        (tipicamente ajustado sobre o histórico, fora do escopo puro do Elo) —
        por isso este modelo tende a ser combinado via `app.models.ensemble`
        em vez de usado isoladamente para o mercado 1X2.
        """
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        raise NotImplementedError("Predição de mercados via Elo será implementada na Fase 1.")

    def get_params(self) -> dict:
        return {
            "k_factor": self.k_factor,
            "home_field_bonus": self.home_field_bonus,
            "initial_rating": self.initial_rating,
            "use_margin_of_victory": self.use_margin_of_victory,
            "ratings": dict(self.ratings),
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
