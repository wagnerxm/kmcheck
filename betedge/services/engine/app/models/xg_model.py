"""Modelo baseado em Expected Goals (xG) para estimar a força ofensiva/defensiva real.

Formulação matemática
----------------------
Expected Goals (xG) atribui a cada finalização uma probabilidade de resultar
em gol, com base em características da jogada (distância ao gol, ângulo,
parte do corpo, tipo de assistência, se é pênalti, etc.), tipicamente vinda
de um modelo de terceiros (provider de dados) ou de um modelo próprio de
classificação binária treinado sobre finalizações rotuladas (gol/não-gol):

    xG(shot) = P(gol | distância, ângulo, tipo_de_chute, ...)

O xG agregado de uma partida para o time A é a soma do xG de todas as suas
finalizações:

    xG_match(A) = sum_{shot in finalizações de A} xG(shot)

Diferente de gols reais (ruidosos — dependem de sorte, qualidade do goleiro
adversário, etc.), o xG acumulado ao longo de várias partidas é um preditor
mais estável do desempenho ofensivo/defensivo subjacente de um time,
convergindo mais rápido que médias de gols reais (menor variância).

Este modelo usa séries de xG histórico (médias móveis exponenciais de
xG-a-favor e xG-contra) como entrada para estimar as taxas esperadas de gol
de uma partida futura, no mesmo espírito multiplicativo do Poisson/Dixon-Coles:

    lambda_home = xG_attack_home * xG_defense_away * home_advantage
    lambda_away = xG_attack_away * xG_defense_home

onde `xG_attack_i`/`xG_defense_i` são derivados de médias móveis
exponencialmente ponderadas (EWMA) do xG-a-favor/xG-contra do time i:

    EWMA_t = alpha * xG_t + (1 - alpha) * EWMA_{t-1}

com `alpha` controlando quão rápido o rating reage a jogos recentes. As
`lambda_home`/`lambda_away` resultantes alimentam a mesma matriz de placar
de Poisson (`app.models.poisson.PoissonModel.score_matrix`) para converter
em probabilidades de mercado.
"""
from datetime import datetime
from typing import Any

from app.models.base import BaseModel, PredictionResult


class ExpectedGoalsModel(BaseModel):
    """Modelo de força ofensiva/defensiva baseado em séries históricas de xG."""

    name = "xg_model"
    version = "1.0.0"

    def __init__(self, ewma_alpha: float = 0.15, home_advantage_init: float = 1.1) -> None:
        # Fator de suavização da EWMA — valores maiores reagem mais rápido a
        # jogos recentes, à custa de mais ruído.
        self.ewma_alpha = ewma_alpha
        self.home_advantage = home_advantage_init

        # dict time -> (xG_attack_rating, xG_defense_rating), atualizado por `train`.
        self.xg_attack_ratings: dict[str, float] = {}
        self.xg_defense_ratings: dict[str, float] = {}
        self._trained_at: datetime | None = None

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Reprocessa o histórico de xG partida a partida até `cutoff_date`, atualizando as EWMA.

        Passos previstos (implementação completa na Fase 1/2):
            1. Filtrar `training_data` (linhas com xG-a-favor/xG-contra por
               partida) para `kickoff_at <= cutoff_date`, ordenado cronologicamente.
            2. Para cada time, inicializar a EWMA na primeira observação
               disponível e atualizar via `EWMA_t = alpha * xG_t + (1-alpha) * EWMA_{t-1}`.
            3. Calibrar `home_advantage` como a razão média entre xG do
               mandante e xG esperado sem vantagem de mando.
        """
        raise NotImplementedError("Atualização das EWMA de xG será implementada na Fase 1/2.")

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Converte os ratings de xG em lambdas de gol e reaproveita a matriz de placar Poisson."""
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        raise NotImplementedError("Predição via modelo de xG será implementada na Fase 1/2.")

    def get_params(self) -> dict:
        return {
            "ewma_alpha": self.ewma_alpha,
            "home_advantage": self.home_advantage,
            "xg_attack_ratings": dict(self.xg_attack_ratings),
            "xg_defense_ratings": dict(self.xg_defense_ratings),
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
