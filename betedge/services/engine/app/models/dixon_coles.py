"""Modelo de Dixon-Coles (1997) — Poisson bivariado com correção de baixo escore.

Formulação matemática
----------------------
Extensão do modelo de Poisson independente (`app.models.poisson`) que
corrige a subestimação de placares baixos (0-0, 1-0, 0-1, 1-1), frequentes
demais na realidade para serem explicados por dois Poisson independentes.

As taxas esperadas de gol permanecem multiplicativas, iguais ao Poisson:

    lambda_home = attack_home * defense_away * home_advantage
    lambda_away = attack_away * defense_home

mas a probabilidade conjunta ganha um fator de correção tau que só atua
sobre os placares (0,0), (0,1), (1,0) e (1,1):

    P(H=h, A=a) = tau_{lambda_home, lambda_away}(h, a)
                  * Poisson(h; lambda_home) * Poisson(a; lambda_away)

com:

    tau(0,0) = 1 - lambda_home * lambda_away * rho
    tau(0,1) = 1 + lambda_home * rho
    tau(1,0) = 1 + lambda_away * rho
    tau(1,1) = 1 - rho
    tau(h,a) = 1                                para h > 1 ou a > 1

O parâmetro rho (correlação de baixo escore) é estimado junto com as forças
de ataque/defesa por máxima verossimilhança, restrito a um intervalo que
mantenha todas as probabilidades não negativas (tipicamente rho em
[-1, 1], mas na prática valores pequenos e negativos, ex.: -0.1 a 0.05).

Log-verossimilhança (a maximizar, ou seu negativo a minimizar):

    log L(theta) = sum_j [ log(tau_{lh_j, la_j}(h_j, a_j))
                          + log Poisson(h_j; lh_j) + log Poisson(a_j; la_j) ]

Dixon e Coles também propuseram um decaimento exponencial de peso por
partida em função da distância no tempo até a data de referência:

    phi(t) = exp(-xi * t)     # t = dias entre a partida e a data de corte

de forma que partidas mais recentes pesam mais na log-verossimilhança —
crucial para capturar mudanças de forma dos times ao longo de uma temporada.
"""
from datetime import datetime
from typing import Any

import numpy as np

from app.models.base import BaseModel, PredictionResult

MAX_GOALS = 10


class DixonColesModel(BaseModel):
    """Modelo de Dixon-Coles: Poisson com correção de correlação em placares baixos."""

    name = "dixon_coles"
    version = "1.0.0"

    def __init__(self, home_advantage_init: float = 1.35, rho_init: float = -0.05, xi: float = 0.0018) -> None:
        self.attack_ratings: dict[str, float] = {}
        self.defense_ratings: dict[str, float] = {}
        self.home_advantage: float = home_advantage_init
        self.rho: float = rho_init
        # Taxa de decaimento temporal (partidas mais antigas pesam menos no treino).
        self.xi: float = xi
        self._trained_at: datetime | None = None

    @staticmethod
    def _tau(h: int, a: int, lambda_home: float, lambda_away: float, rho: float) -> float:
        """Fator de correção de Dixon-Coles para os quatro placares de baixo escore.

        Retorna 1.0 para qualquer placar fora de {(0,0), (0,1), (1,0), (1,1)}.
        """
        if h == 0 and a == 0:
            return 1 - lambda_home * lambda_away * rho
        if h == 0 and a == 1:
            return 1 + lambda_home * rho
        if h == 1 and a == 0:
            return 1 + lambda_away * rho
        if h == 1 and a == 1:
            return 1 - rho
        return 1.0

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Ajusta ataque/defesa/mando de campo/rho por máxima verossimilhança ponderada no tempo.

        Passos previstos (implementação completa na Fase 1/2):
            1. Filtrar `training_data` para `kickoff_at <= cutoff_date`.
            2. Calcular peso temporal `phi(t) = exp(-xi * dias_ate_cutoff)` por partida.
            3. Otimizar a log-verossimilhança negativa ponderada (ver docstring
               do módulo) via `scipy.optimize.minimize`, parametrizando `rho`
               com uma transformação (ex.: tanh) para mantê-lo num intervalo estável.
            4. Normalizar `attack_i`/`defense_i` para a restrição de identificabilidade.
        """
        raise NotImplementedError(
            "Ajuste por máxima verossimilhança do modelo de Dixon-Coles será implementado na Fase 1."
        )

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Gera predições de mercados aplicando a matriz de placar corrigida por tau."""
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        raise NotImplementedError("Predição de mercados via Dixon-Coles será implementada na Fase 1.")

    def score_matrix(self, lambda_home: float, lambda_away: float, max_goals: int = MAX_GOALS) -> np.ndarray:
        """Matriz de P(H=h, A=a) = tau(h,a) * Poisson(h; lambda_home) * Poisson(a; lambda_away)."""
        from scipy.stats import poisson

        home_probs = poisson.pmf(np.arange(max_goals + 1), lambda_home)
        away_probs = poisson.pmf(np.arange(max_goals + 1), lambda_away)
        matrix = np.outer(home_probs, away_probs)

        for h in range(2):
            for a in range(2):
                matrix[h, a] *= self._tau(h, a, lambda_home, lambda_away, self.rho)

        # Renormaliza para que a matriz continue somando 1 após a correção de tau.
        matrix /= matrix.sum()
        return matrix

    def get_params(self) -> dict:
        return {
            "home_advantage": self.home_advantage,
            "rho": self.rho,
            "xi": self.xi,
            "attack_ratings": dict(self.attack_ratings),
            "defense_ratings": dict(self.defense_ratings),
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
