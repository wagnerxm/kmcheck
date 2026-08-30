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
from scipy.optimize import minimize

from app.models.base import BaseModel, PredictionResult

MAX_GOALS = 10  # truncamento da matriz de placares para cálculo de mercados

# Taxa de decaimento temporal (dias^-1). Jogos recentes pesam mais no ajuste.
# xi = 0.005 equivale a meia-vida de ~139 dias — padrão usual em modelos
# Dixon-Coles/Poisson aplicados a futebol.
_DEFAULT_DECAY_RATE = 0.005


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

        # ------------------------------------------------------------------
        # 1. Filtragem anti-leakage: descartar jogos posteriores ao cutoff
        # ------------------------------------------------------------------
        matches = [
            m for m in training_data
            if m["kickoff_at"] <= cutoff_date
        ]
        n_matches = len(matches)
        if n_matches == 0:
            raise ValueError(
                "Nenhuma partida disponível até cutoff_date — impossível treinar."
            )

        # ------------------------------------------------------------------
        # 2. Montar índice de times e vetores numéricos das partidas
        # ------------------------------------------------------------------
        teams = sorted(
            {m["home_team_id"] for m in matches}
            | {m["away_team_id"] for m in matches}
        )
        n_teams = len(teams)
        team_idx = {t: i for i, t in enumerate(teams)}

        # Vetores pré-alocados para o loop da função objetivo ser todo numpy
        home_idx = np.array(
            [team_idx[m["home_team_id"]] for m in matches], dtype=np.int32
        )
        away_idx = np.array(
            [team_idx[m["away_team_id"]] for m in matches], dtype=np.int32
        )
        home_goals = np.array(
            [m["home_goals"] for m in matches], dtype=np.float64
        )
        away_goals = np.array(
            [m["away_goals"] for m in matches], dtype=np.float64
        )

        # ------------------------------------------------------------------
        # Pesos de decaimento temporal
        # ------------------------------------------------------------------
        # Jogos mais recentes (próximos do cutoff) recebem peso maior.
        # w_j = exp(-xi * dias_até_cutoff).
        days_from_cutoff = np.array(
            [
                (cutoff_date - m["kickoff_at"]).total_seconds() / 86400.0
                for m in matches
            ],
            dtype=np.float64,
        )
        weights = np.exp(-_DEFAULT_DECAY_RATE * days_from_cutoff)

        # ------------------------------------------------------------------
        # 3. Otimização por MLE (L-BFGS-B) em log-space
        # ------------------------------------------------------------------
        # Vetor de parâmetros:
        #   x[0 : n_teams]           -> log(attack_i)
        #   x[n_teams : 2*n_teams]   -> log(defense_i)
        #   x[2*n_teams]             -> log(home_advantage)
        #
        # Trabalhar em log-space garante positividade (attack, defense, HA > 0)
        # sem precisar de bounds rígidos, e torna o espaço quase irrestrito —
        # ideal para L-BFGS-B.

        x0 = np.zeros(2 * n_teams + 1, dtype=np.float64)
        # Chute inicial: log(1.0) = 0 para ratings, log(HA_init) para HA
        x0[2 * n_teams] = np.log(self.home_advantage)

        # Limites suaves em log-space para evitar explosão numérica:
        # exp(-5) ~ 0.007, exp(5) ~ 148 — faixa ampla o bastante para qualquer
        # liga real, mas evita overflow nos primeiros passos do otimizador.
        bounds = [(-5.0, 5.0)] * (2 * n_teams + 1)

        def neg_log_likelihood(x: np.ndarray) -> float:
            """Log-verossimilhança negativa ponderada pelo decaimento temporal."""
            log_att = x[:n_teams]
            log_def = x[n_teams : 2 * n_teams]
            log_ha = x[2 * n_teams]

            # lambda_home_j = exp(log_att[home_j] + log_def[away_j] + log_ha)
            log_lambda_h = log_att[home_idx] + log_def[away_idx] + log_ha
            # lambda_away_j = exp(log_att[away_j] + log_def[home_j])
            log_lambda_a = log_att[away_idx] + log_def[home_idx]

            lambda_h = np.exp(log_lambda_h)
            lambda_a = np.exp(log_lambda_a)

            # -log L = Σ w_j * [ λ_h - g_h·log(λ_h) + λ_a - g_a·log(λ_a) ]
            # (termos log(g!) são constantes e não afetam o argmin)
            nll = np.sum(
                weights
                * (
                    lambda_h
                    - home_goals * log_lambda_h
                    + lambda_a
                    - away_goals * log_lambda_a
                )
            )
            return nll

        result = minimize(
            neg_log_likelihood,
            x0,
            method="L-BFGS-B",
            bounds=bounds,
            options={"maxiter": 500, "ftol": 1e-12},
        )

        # ------------------------------------------------------------------
        # 4. Normalização de identificabilidade
        # ------------------------------------------------------------------
        # O modelo é invariante a multiplicar todos os attacks por c e dividir
        # todos os defenses por c. Fixamos a média geométrica dos attacks em 1
        # (mean(log_attack) = 0): subtraímos a média dos log-attacks e somamos
        # essa média aos log-defenses.
        opt_x = result.x
        log_att = opt_x[:n_teams].copy()
        log_def = opt_x[n_teams : 2 * n_teams].copy()
        log_ha = opt_x[2 * n_teams]

        mean_log_att = np.mean(log_att)
        log_att -= mean_log_att
        log_def += mean_log_att

        # ------------------------------------------------------------------
        # 5. Armazenar parâmetros ajustados
        # ------------------------------------------------------------------
        self.attack_ratings = {
            t: float(np.exp(log_att[i])) for i, t in enumerate(teams)
        }
        self.defense_ratings = {
            t: float(np.exp(log_def[i])) for i, t in enumerate(teams)
        }
        self.home_advantage = float(np.exp(log_ha))
        self._trained_at = datetime.utcnow()

        # Log-verossimilhança final (sinal positivo, para facilitar leitura):
        # -(-nll) = ll
        final_ll = -float(result.fun)

        return {
            "n_teams": n_teams,
            "n_matches": n_matches,
            "log_likelihood": final_ll,
            "home_advantage": self.home_advantage,
            "converged": bool(result.success),
        }

    def predict(
        self, event_data: dict, as_of: datetime
    ) -> list[PredictionResult]:
        """Gera predições de mercados (1X2, over/under, BTTS) para um confronto.

        Espera `event_data` com pelo menos `home_team` e `away_team` (chaves
        presentes em `self.attack_ratings`/`self.defense_ratings`). Calcula
        lambda_home/lambda_away, monta a matriz de probabilidades de placar
        via `self.score_matrix(...)` e agrega para cada mercado suportado.
        """
        # ------------------------------------------------------------------
        # 1. Checagem anti-leakage
        # ------------------------------------------------------------------
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError(
                "event_data contém informação posterior a as_of (vazamento de dados)."
            )

        home_id = event_data["home_team_id"]
        away_id = event_data["away_team_id"]

        # ------------------------------------------------------------------
        # 2. Ratings: se time desconhecido, usar a média da liga
        # ------------------------------------------------------------------
        # Fallback para times não vistos no treino — usa a média aritmética dos
        # ratings conhecidos (equivalente a um time "médio" da liga).
        if self.attack_ratings:
            mean_att = sum(self.attack_ratings.values()) / len(
                self.attack_ratings
            )
            mean_def = sum(self.defense_ratings.values()) / len(
                self.defense_ratings
            )
        else:
            # Modelo não treinado — defaults neutros
            mean_att = 1.0
            mean_def = 1.0

        att_home = self.attack_ratings.get(home_id, mean_att)
        def_home = self.defense_ratings.get(home_id, mean_def)
        att_away = self.attack_ratings.get(away_id, mean_att)
        def_away = self.defense_ratings.get(away_id, mean_def)

        # ------------------------------------------------------------------
        # 3. Calcular lambdas e montar a matriz de placares
        # ------------------------------------------------------------------
        lambda_home = att_home * def_away * self.home_advantage
        lambda_away = att_away * def_home

        matrix = self.score_matrix(lambda_home, lambda_away)
        # matrix[h, a] = P(H=h, A=a), shape (MAX_GOALS+1, MAX_GOALS+1)

        # ------------------------------------------------------------------
        # 4. Agregar probabilidades por mercado
        # ------------------------------------------------------------------
        results: list[PredictionResult] = []
        n = matrix.shape[0]  # MAX_GOALS + 1

        # Índices auxiliares para cada célula (h, a)
        h_idx, a_idx = np.meshgrid(
            np.arange(n), np.arange(n), indexing="ij"
        )

        # --- 1X2 (match_result) ---
        p_home = float(np.sum(matrix[h_idx > a_idx]))
        p_draw = float(np.sum(matrix[h_idx == a_idx]))
        p_away = float(np.sum(matrix[h_idx < a_idx]))

        results.append(
            PredictionResult(
                market="match_result", outcome="home", probability=p_home
            )
        )
        results.append(
            PredictionResult(
                market="match_result", outcome="draw", probability=p_draw
            )
        )
        results.append(
            PredictionResult(
                market="match_result", outcome="away", probability=p_away
            )
        )

        # --- Over/Under 2.5 ---
        total_goals = h_idx + a_idx
        # > 2.5 em gols inteiros equivale a >= 3
        p_over = float(np.sum(matrix[total_goals > 2]))
        p_under = 1.0 - p_over

        results.append(
            PredictionResult(
                market="over_under_2_5", outcome="over", probability=p_over
            )
        )
        results.append(
            PredictionResult(
                market="over_under_2_5", outcome="under", probability=p_under
            )
        )

        # --- BTTS (ambas marcam) ---
        # P(BTTS=sim) = soma das células onde h >= 1 e a >= 1
        p_btts_yes = float(np.sum(matrix[1:, 1:]))
        p_btts_no = 1.0 - p_btts_yes

        results.append(
            PredictionResult(
                market="btts", outcome="yes", probability=p_btts_yes
            )
        )
        results.append(
            PredictionResult(
                market="btts", outcome="no", probability=p_btts_no
            )
        )

        # --- Double Chance ---
        p_1x = p_home + p_draw  # mandante ou empate
        p_12 = p_home + p_away  # mandante ou visitante (não empate)
        p_x2 = p_draw + p_away  # empate ou visitante

        results.append(
            PredictionResult(
                market="double_chance", outcome="1X", probability=p_1x
            )
        )
        results.append(
            PredictionResult(
                market="double_chance", outcome="12", probability=p_12
            )
        )
        results.append(
            PredictionResult(
                market="double_chance", outcome="X2", probability=p_x2
            )
        )

        # --- Correct Score (top 5) ---
        # Achatar a matriz e pegar os 5 placares mais prováveis
        flat = matrix.ravel()
        top_5_flat = np.argsort(flat)[::-1][:5]
        for idx in top_5_flat:
            h = int(idx // n)
            a = int(idx % n)
            prob = float(flat[idx])
            results.append(
                PredictionResult(
                    market="correct_score",
                    outcome=f"{h}-{a}",
                    probability=prob,
                )
            )

        return results

    def score_matrix(
        self,
        lambda_home: float,
        lambda_away: float,
        max_goals: int = MAX_GOALS,
    ) -> np.ndarray:
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
            "trained_at": self._trained_at.isoformat()
            if self._trained_at
            else None,
        }
