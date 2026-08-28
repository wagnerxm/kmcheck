"""Modelo de Poisson independente para gols em partidas de futebol.

Formulação matemática
----------------------
Modelo clássico introduzido por Maher (1982). Assume que o número de gols
marcados por cada time segue uma distribuição de Poisson independente:

    X_home ~ Poisson(lambda_home)
    X_away ~ Poisson(lambda_away)

onde as taxas esperadas de gol (lambda) são modeladas multiplicativamente a
partir de forças de ataque/defesa de cada time e um fator de mando de campo:

    lambda_home = attack_home * defense_away * home_advantage
    lambda_away = attack_away * defense_home

Os parâmetros `attack_i` e `defense_i` de cada time i, e `home_advantage`,
são estimados por máxima verossimilhança sobre o histórico de partidas:

    L(theta) = prod_{jogos} Poisson(gols_home_j; lambda_home_j)
                           * Poisson(gols_away_j; lambda_away_j)

Maximizar L é equivalente a minimizar a log-verossimilhança negativa:

    -log L(theta) = sum_j [ lambda_home_j - gols_home_j * log(lambda_home_j)
                           + lambda_away_j - gols_away_j * log(lambda_away_j) ]
                    (+ termos constantes de log(gols!), irrelevantes na otimização)

sujeito à restrição de identificabilidade sum_i attack_i = n_times (ou
equivalente), já que o modelo é invariante a reescalar todos os `attack_i`
por uma constante e todos os `defense_i` pelo inverso dela.

Uso das probabilidades
-----------------------
Dado (lambda_home, lambda_away), a probabilidade de um placar exato (h, a) é:

    P(H=h, A=a) = Poisson(h; lambda_home) * Poisson(a; lambda_away)

Probabilidades de mercado (1X2, over/under, BTTS, handicap) são obtidas
somando P(H=h, A=a) sobre a matriz de placares (h, a) que satisfazem cada
condição de mercado (ex.: P(over 2.5) = sum_{h+a > 2.5} P(H=h, A=a)).

Limitação conhecida: assume independência entre X_home e X_away, o que
subestima a frequência de empates em placares baixos (0-0, 1-1). O modelo
`app.models.dixon_coles` corrige isso com um termo de correlação (tau).
"""
from datetime import datetime
from typing import Any

import numpy as np

from app.models.base import BaseModel, PredictionResult

MAX_GOALS = 10  # truncamento da matriz de placares para cálculo de mercados


class PoissonModel(BaseModel):
    """Modelo de Poisson independente (Maher 1982) para gols em futebol."""

    name = "poisson"
    version = "1.0.0"

    def __init__(self, home_advantage_init: float = 1.35) -> None:
        # Parâmetros ajustados pelo treino: dict time -> força de ataque/defesa.
        # Inicializados vazios; populados em `train`.
        self.attack_ratings: dict[str, float] = {}
        self.defense_ratings: dict[str, float] = {}
        self.home_advantage: float = home_advantage_init
        self._trained_at: datetime | None = None

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Ajusta `attack_ratings`, `defense_ratings` e `home_advantage` por MLE.

        Passos previstos (implementação completa fica para a Fase 1/2):
            1. Filtrar `training_data` para partidas com `kickoff_at <= cutoff_date`.
            2. Inicializar `attack_i = defense_i = 1.0` para cada time.
            3. Otimizar a log-verossimilhança negativa (ver docstring do módulo)
               via `scipy.optimize.minimize` (L-BFGS-B), com a restrição de
               identificabilidade aplicada por normalização pós-otimização.
            4. Aplicar decaimento temporal opcional (peso maior para jogos
               recentes) — comum em implementações de Dixon-Coles/Poisson.

        Retorna um `dict` de métricas de treino (log-verossimilhança final,
        número de times, número de partidas usadas).
        """
        raise NotImplementedError(
            "Ajuste por máxima verossimilhança do modelo de Poisson será implementado na Fase 1."
        )

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Gera predições de mercados (1X2, over/under, BTTS) para um confronto.

        Espera `event_data` com pelo menos `home_team` e `away_team` (chaves
        presentes em `self.attack_ratings`/`self.defense_ratings`). Calcula
        lambda_home/lambda_away, monta a matriz de probabilidades de placar
        via `self.score_matrix(...)` e agrega para cada mercado suportado.
        """
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        raise NotImplementedError("Predição de mercados via Poisson será implementada na Fase 1.")

    def score_matrix(self, lambda_home: float, lambda_away: float, max_goals: int = MAX_GOALS) -> np.ndarray:
        """Retorna a matriz (max_goals+1) x (max_goals+1) de P(H=h, A=a).

        P(H=h, A=a) = Poisson(h; lambda_home) * Poisson(a; lambda_away),
        assumindo independência entre os dois processos de gol.
        """
        from scipy.stats import poisson

        home_probs = poisson.pmf(np.arange(max_goals + 1), lambda_home)
        away_probs = poisson.pmf(np.arange(max_goals + 1), lambda_away)
        return np.outer(home_probs, away_probs)

    def get_params(self) -> dict:
        """Retorna os ratings de ataque/defesa e o fator de mando de campo atuais."""
        return {
            "home_advantage": self.home_advantage,
            "attack_ratings": dict(self.attack_ratings),
            "defense_ratings": dict(self.defense_ratings),
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
