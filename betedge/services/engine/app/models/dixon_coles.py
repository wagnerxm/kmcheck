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
from math import log
from typing import Any

import numpy as np
from scipy.optimize import minimize

from app.models.base import BaseModel, PredictionResult

MAX_GOALS = 10

# Valor mínimo para clamp de tau — evita log(0) quando rho extremo produz tau <= 0.
_TAU_FLOOR = 1e-10


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

    # ------------------------------------------------------------------
    # train
    # ------------------------------------------------------------------
    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Ajusta ataque/defesa/mando de campo/rho por MLE ponderada no tempo.

        Etapas:
            1. Filtra partidas com kickoff_at <= cutoff_date (anti-leakage).
            2. Calcula peso temporal phi(t) = exp(-xi * dias_até_cutoff).
            3. Minimiza -log L ponderada via L-BFGS-B com parâmetros em log-space
               (ataque/defesa/home_adv) e rho via tanh(rho_raw).
            4. Aplica restrição de identificabilidade: centra log-ataques e
               log-defesas para que a média geométrica dos ataques seja 1.
        """
        from scipy.special import gammaln  # log(n!) para LL completa

        # --- 1. Filtro anti-leakage (defesa em profundidade) -----------------
        matches = [m for m in training_data if m["kickoff_at"] <= cutoff_date]
        if not matches:
            raise ValueError("Nenhuma partida disponível antes de cutoff_date.")

        # --- 2. Mapeamento de times e índices --------------------------------
        teams: list[str] = sorted(
            {m["home_team_id"] for m in matches} | {m["away_team_id"] for m in matches}
        )
        team_idx = {t: i for i, t in enumerate(teams)}
        n_teams = len(teams)

        # Arrays de dados das partidas (acesso vetorial na função de custo).
        home_idx = np.array([team_idx[m["home_team_id"]] for m in matches], dtype=int)
        away_idx = np.array([team_idx[m["away_team_id"]] for m in matches], dtype=int)
        home_goals = np.array([m["home_goals"] for m in matches], dtype=int)
        away_goals = np.array([m["away_goals"] for m in matches], dtype=int)

        # --- 3. Pesos temporais ----------------------------------------------
        # phi_j = exp(-xi * dias_entre(kickoff_j, cutoff)) — recentes pesam mais.
        days_diff = np.array(
            [(cutoff_date - m["kickoff_at"]).total_seconds() / 86400.0 for m in matches]
        )
        weights = np.exp(-self.xi * days_diff)

        n_matches = len(matches)

        # --- 4. Vetor de parâmetros e função de custo -------------------------
        # Layout do vetor x:
        #   [log_att_0 .. log_att_{n-1},  (n_teams ataques)
        #    log_def_0 .. log_def_{n-1},  (n_teams defesas)
        #    log_home_adv,                (1 mando de campo)
        #    rho_raw]                     (1 correlação, via tanh)
        # Total: 2*n_teams + 2.
        n_params = 2 * n_teams + 2

        # Máscara booleana: quais partidas têm placar em {0,1}x{0,1} e portanto
        # precisam do fator tau (evita iterar sobre todas na função de custo).
        low_score_mask = (home_goals <= 1) & (away_goals <= 1)
        low_score_indices = np.where(low_score_mask)[0]

        def neg_log_likelihood(params: np.ndarray) -> float:
            """Log-verossimilhança negativa ponderada — função a minimizar."""
            log_att = params[:n_teams]
            log_def = params[n_teams: 2 * n_teams]
            log_ha = params[2 * n_teams]
            rho_raw = params[2 * n_teams + 1]
            rho = float(np.tanh(rho_raw))  # garante rho em (-1, 1)

            # Taxas esperadas de gol por partida.
            # lambda_home_j = exp(log_att[mandante] + log_def[visitante] + log_ha)
            lh = np.exp(log_att[home_idx] + log_def[away_idx] + log_ha)
            # lambda_away_j = exp(log_att[visitante] + log_def[mandante])
            la = np.exp(log_att[away_idx] + log_def[home_idx])

            # Termos padrão da Poisson: lambda - y*log(lambda).
            # Os termos log(y!) são constantes e não afetam a otimização.
            poisson_term = (lh - home_goals * np.log(lh + 1e-30)
                            + la - away_goals * np.log(la + 1e-30))

            # Termo de correção tau — calculado apenas para placares baixos.
            log_tau = np.zeros(n_matches)
            for j in low_score_indices:
                hg = int(home_goals[j])
                ag = int(away_goals[j])
                t = DixonColesModel._tau(hg, ag, float(lh[j]), float(la[j]), rho)
                # Clamp para evitar log(0) se rho extremo tornar tau <= 0.
                log_tau[j] = np.log(max(t, _TAU_FLOOR))

            # -log L ponderada = Σ w_j * [poisson_term_j - log(tau_j)]
            cost = float(np.sum(weights * (poisson_term - log_tau)))
            return cost

        # --- Chute inicial ---------------------------------------------------
        # Todos os ataques/defesas começam em log(1)=0 (neutros).
        x0 = np.zeros(n_params)
        x0[2 * n_teams] = log(self.home_advantage)         # log_home_adv inicial
        x0[2 * n_teams + 1] = np.arctanh(                  # rho_raw inicial
            np.clip(self.rho, -0.99, 0.99)
        )

        # --- 5. Otimização via L-BFGS-B --------------------------------------
        result = minimize(
            neg_log_likelihood,
            x0,
            method="L-BFGS-B",
            options={"maxiter": 5000, "ftol": 1e-12},
        )

        # --- 6. Extrai e normaliza parâmetros otimizados ---------------------
        opt = result.x
        log_att = opt[:n_teams].copy()
        log_def = opt[n_teams: 2 * n_teams].copy()
        log_ha = opt[2 * n_teams]
        rho_raw = opt[2 * n_teams + 1]

        # Restrição de identificabilidade: centra log-ataques (média → 0).
        # Sem isso, pode-se somar uma constante a todos os log-ataques e subtrair
        # de todos os log-defesas sem alterar a verossimilhança (não-identificável).
        att_mean = log_att.mean()
        log_att -= att_mean
        log_def += att_mean

        # Armazena em escala natural (não log) nos dicts do modelo.
        self.attack_ratings = {teams[i]: float(np.exp(log_att[i])) for i in range(n_teams)}
        self.defense_ratings = {teams[i]: float(np.exp(log_def[i])) for i in range(n_teams)}
        self.home_advantage = float(np.exp(log_ha))
        self.rho = float(np.tanh(rho_raw))
        self._trained_at = datetime.utcnow()

        # --- 7. Métricas de retorno ------------------------------------------
        # Inclui log(y!) para obter a LL completa (comparável entre modelos).
        final_nll = result.fun
        log_factorial_sum = float(np.sum(
            weights * (gammaln(home_goals + 1) + gammaln(away_goals + 1))
        ))
        log_likelihood = -(final_nll + log_factorial_sum)

        return {
            "n_teams": n_teams,
            "n_matches": n_matches,
            "log_likelihood": log_likelihood,
            "home_advantage": self.home_advantage,
            "rho": self.rho,
            "xi": self.xi,
            "converged": result.success,
        }

    # ------------------------------------------------------------------
    # predict
    # ------------------------------------------------------------------
    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Gera predições de mercados aplicando a matriz de placar corrigida por tau.

        Mercados derivados:
            - match_result (1X2)
            - over_under_1.5 / 2.5 / 3.5
            - btts (ambos marcam)
            - double_chance (1X, 12, X2)
            - correct_score (top 5 mais prováveis)
        """
        # --- 1. Validação anti-leakage ---------------------------------------
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")

        home_id = event_data["home_team_id"]
        away_id = event_data["away_team_id"]

        # --- 2. Ratings — times desconhecidos recebem a média da liga --------
        # Se o time não foi visto no treino, usar a média aritmética dos ratings
        # conhecidos serve como proxy "time médio da liga".
        if self.attack_ratings:
            avg_att = sum(self.attack_ratings.values()) / len(self.attack_ratings)
            avg_def = sum(self.defense_ratings.values()) / len(self.defense_ratings)
        else:
            # Modelo não treinado: fallback neutro.
            avg_att = 1.0
            avg_def = 1.0

        att_home = self.attack_ratings.get(home_id, avg_att)
        def_home = self.defense_ratings.get(home_id, avg_def)
        att_away = self.attack_ratings.get(away_id, avg_att)
        def_away = self.defense_ratings.get(away_id, avg_def)

        # --- 3. Taxas esperadas de gol ---------------------------------------
        lambda_home = att_home * def_away * self.home_advantage
        lambda_away = att_away * def_home

        # --- 4. Matriz de probabilidade de placar (com correção tau) ----------
        matrix = self.score_matrix(lambda_home, lambda_away)
        g = MAX_GOALS + 1  # dimensão: 0..MAX_GOALS

        # --- 5. Derivar probabilidades de cada mercado -----------------------
        results: list[PredictionResult] = []

        # Índices auxiliares para somas condicionais sobre a matriz.
        idx_h = np.arange(g).reshape(-1, 1)  # gols mandante (eixo das linhas)
        idx_a = np.arange(g).reshape(1, -1)  # gols visitante (eixo das colunas)
        total_goals = idx_h + idx_a

        # 1X2 (match_result) --------------------------------------------------
        p_home = float(np.sum(matrix[idx_h > idx_a]))
        p_draw = float(np.sum(matrix[idx_h == idx_a]))
        p_away = float(np.sum(matrix[idx_h < idx_a]))

        results.append(PredictionResult(market="match_result", outcome="home", probability=p_home))
        results.append(PredictionResult(market="match_result", outcome="draw", probability=p_draw))
        results.append(PredictionResult(market="match_result", outcome="away", probability=p_away))

        # Over/Under 2.5 ------------------------------------------------------
        p_over_25 = float(np.sum(matrix[total_goals > 2]))
        p_under_25 = 1.0 - p_over_25
        results.append(PredictionResult(market="over_under_2.5", outcome="over", probability=p_over_25))
        results.append(PredictionResult(market="over_under_2.5", outcome="under", probability=p_under_25))

        # Over/Under 1.5 ------------------------------------------------------
        p_over_15 = float(np.sum(matrix[total_goals > 1]))
        p_under_15 = 1.0 - p_over_15
        results.append(PredictionResult(market="over_under_1.5", outcome="over", probability=p_over_15))
        results.append(PredictionResult(market="over_under_1.5", outcome="under", probability=p_under_15))

        # Over/Under 3.5 ------------------------------------------------------
        p_over_35 = float(np.sum(matrix[total_goals > 3]))
        p_under_35 = 1.0 - p_over_35
        results.append(PredictionResult(market="over_under_3.5", outcome="over", probability=p_over_35))
        results.append(PredictionResult(market="over_under_3.5", outcome="under", probability=p_under_35))

        # BTTS (Both Teams To Score) ------------------------------------------
        # Soma das células onde mandante >= 1 E visitante >= 1.
        p_btts_yes = float(np.sum(matrix[1:, 1:]))
        p_btts_no = 1.0 - p_btts_yes
        results.append(PredictionResult(market="btts", outcome="yes", probability=p_btts_yes))
        results.append(PredictionResult(market="btts", outcome="no", probability=p_btts_no))

        # Dupla Chance --------------------------------------------------------
        p_1x = p_home + p_draw   # mandante não perde
        p_12 = p_home + p_away   # não empata
        p_x2 = p_draw + p_away   # visitante não perde
        results.append(PredictionResult(market="double_chance", outcome="1X", probability=p_1x))
        results.append(PredictionResult(market="double_chance", outcome="12", probability=p_12))
        results.append(PredictionResult(market="double_chance", outcome="X2", probability=p_x2))

        # Placar Exato — top 5 mais prováveis ---------------------------------
        flat = matrix.flatten()
        # Índices dos 5 maiores valores em ordem decrescente de probabilidade.
        top5_flat = np.argsort(flat)[-5:][::-1]
        for idx in top5_flat:
            h_score = int(idx // g)
            a_score = int(idx % g)
            prob = float(flat[idx])
            results.append(PredictionResult(
                market="correct_score",
                outcome=f"{h_score}-{a_score}",
                probability=prob,
            ))

        return results

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
