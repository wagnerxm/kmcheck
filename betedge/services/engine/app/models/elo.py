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

    R_home' = R_home + K * MoV * (S_home - E_home)
    R_away' = R_away + K * MoV * (S_away - E_away)

Para resultado de 3 vias (vitória/empate/derrota) usamos o "score" contínuo:
    S = 1.0 se vitória, 0.5 se empate, 0.0 se derrota
(S_home + S_away = 1, preservando a propriedade de soma-zero do Elo clássico.)

Uma variante amplamente usada em futebol (Elo do FiveThirtyEight/ClubElo)
pondera a atualização pela margem de vitória (Margin of Victory), usando um
multiplicador logarítmico:

    mov_multiplier = ln(|goal_diff| + 1) * (2.2 / (rating_diff * 0.001 + 2.2))

de forma que goleadas movem o rating mais do que vitórias de 1 gol, com
retornos decrescentes para evitar que um único resultado dispare o rating.

Conversão de rating para probabilidade 1X2
-------------------------------------------
O Elo clássico dá apenas E_home = P(não perder ponderado), que mistura
vitória e empate. Para separar P(home)/P(draw)/P(away) usamos um modelo
logístico ordinal (ordered logistic), parametrizado por um limiar de empate
*t* calibrado sobre os dados de treino:

    P(home)  = σ(z - t)
    P(away)  = σ(-z - t)
    P(draw)  = 1 - P(home) - P(away)

onde z = d / s, com d = R_home + bonus - R_away e s = 400 / ln(10) ≈ 173.7
(escala intrínseca do Elo).  O limiar t é encontrado por busca de raiz:
calibra-se para que a taxa média de empate prevista reproduza a taxa de
empate observada no histórico de treino.  Para futebol, t tipicamente fica
em torno de 0.45–0.65, gerando taxa de empate de ~25–30 %.
"""
import math
from datetime import datetime
from typing import Any

from app.models.base import BaseModel, PredictionResult

DEFAULT_INITIAL_RATING = 1500.0

# Escala intrínseca do Elo: converte diferença de rating para a variável
# z da logística padrão.  z = d / _ELO_SCALE.  A relação com a fórmula
# clássica é E = σ(z) = 1 / (1 + 10^(-d/400)).
_ELO_SCALE = 400.0 / math.log(10)  # ≈ 173.72

# Limiar de empate padrão (usado quando o modelo não foi treinado).
# Calibrado em ~27 % de empates com times equilibrados — valor razoável
# para ligas de futebol profissional.
_DEFAULT_DRAW_THRESHOLD = 0.55


def _sigmoid(x: float) -> float:
    """Função logística com clamp para evitar overflow."""
    x = max(-500.0, min(500.0, x))
    return 1.0 / (1.0 + math.exp(-x))


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

        # Limiar de empate do modelo logístico ordinal — calibrado em train().
        self._draw_threshold: float = _DEFAULT_DRAW_THRESHOLD

    # ------------------------------------------------------------------
    # Cálculos auxiliares de Elo
    # ------------------------------------------------------------------

    def expected_score(self, rating_home: float, rating_away: float) -> float:
        """E_home = P(mandante não perde), via função logística do Elo com bônus de mando."""
        diff = (rating_home + self.home_field_bonus) - rating_away
        return 1.0 / (1.0 + 10 ** (-diff / 400.0))

    def mov_multiplier(self, goal_diff: int, rating_diff: float) -> float:
        """Multiplicador de margem de vitória (variante FiveThirtyEight/ClubElo).

        Amplia a atualização de rating proporcionalmente ao tamanho da goleada,
        com retornos decrescentes controlados pelo termo `rating_diff * 0.001`.
        O `rating_diff` aqui é a diferença *bruta* (sem bônus de mando) — o
        dampener penaliza times já muito superiores para não inflarem demais
        com goleadas esperadas.
        """
        if goal_diff == 0:
            return 1.0
        return math.log(abs(goal_diff) + 1) * (2.2 / (abs(rating_diff) * 0.001 + 2.2))

    # ------------------------------------------------------------------
    # train
    # ------------------------------------------------------------------

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Reprocessa o histórico partida a partida (em ordem cronológica) até `cutoff_date`.

        Etapas:
            1. Filtra e ordena partidas por `kickoff_at <= cutoff_date` (anti-leakage).
            2. Para cada partida, em ordem cronológica:
               a) Busca ratings correntes (ou initial_rating para times novos).
               b) Calcula expectativa E_home via fórmula Elo.
               c) Obtém score observado S (1/0.5/0) e multiplicador de MoV.
               d) Atualiza R' = R + K * MoV * (S - E) para ambos os times.
            3. Coleta diferenças de rating pré-jogo para calibrar a probabilidade
               de empate (modelo logístico ordinal).
            4. Armazena ratings finais e metadados de treino.

        Retorna dict com métricas (n_teams, n_matches, draw_rate, etc.).
        """

        # ------------------------------------------------------------------
        # 1. Filtragem anti-leakage e ordenação cronológica
        # ------------------------------------------------------------------
        matches = [
            m for m in training_data
            if m["kickoff_at"] <= cutoff_date
        ]
        if not matches:
            raise ValueError(
                "Nenhuma partida disponível até cutoff_date — impossível treinar."
            )
        matches.sort(key=lambda m: m["kickoff_at"])

        # Reset completo — o Elo é determinístico dado o histórico, então
        # reprocessamos do zero para garantir reprodutibilidade.
        self.ratings = {}
        self._last_update_at = {}

        # Acumuladores para calibração do limiar de empate.
        pre_match_diffs: list[float] = []
        n_draws = 0

        # ------------------------------------------------------------------
        # 2. Processamento sequencial — atualiza ratings partida a partida
        # ------------------------------------------------------------------
        for m in matches:
            home_id = m["home_team_id"]
            away_id = m["away_team_id"]
            home_goals = m["home_goals"]
            away_goals = m["away_goals"]

            # Ratings correntes (ou iniciais para times ainda não vistos).
            r_home = self.ratings.get(home_id, self.initial_rating)
            r_away = self.ratings.get(away_id, self.initial_rating)

            # Salva diferença de rating pré-jogo (com bônus) para calibração.
            diff_with_bonus = (r_home + self.home_field_bonus) - r_away
            pre_match_diffs.append(diff_with_bonus)

            # Score observado: 1.0 = vitória, 0.5 = empate, 0.0 = derrota.
            if home_goals > away_goals:
                s_home = 1.0
            elif home_goals == away_goals:
                s_home = 0.5
                n_draws += 1
            else:
                s_home = 0.0
            s_away = 1.0 - s_home

            # Expectativa via fórmula clássica do Elo.
            e_home = self.expected_score(r_home, r_away)
            e_away = 1.0 - e_home

            # Multiplicador de margem de vitória.
            # Usa diff *sem* bônus de mando — o dampener mede disparidade
            # intrínseca entre os times, não vantagem contextual.
            goal_diff = home_goals - away_goals
            raw_diff = r_home - r_away
            if self.use_margin_of_victory:
                mov = self.mov_multiplier(goal_diff, raw_diff)
            else:
                mov = 1.0

            # Atualização de ratings.
            delta = self.k_factor * mov
            self.ratings[home_id] = r_home + delta * (s_home - e_home)
            self.ratings[away_id] = r_away + delta * (s_away - e_away)
            self._last_update_at[home_id] = m["kickoff_at"]
            self._last_update_at[away_id] = m["kickoff_at"]

        self._trained_at = datetime.utcnow()

        # ------------------------------------------------------------------
        # 3. Calibração do limiar de empate
        # ------------------------------------------------------------------
        n_matches = len(matches)
        empirical_draw_rate = n_draws / n_matches
        self._calibrate_draw_threshold(pre_match_diffs, empirical_draw_rate)

        # ------------------------------------------------------------------
        # 4. Métricas de retorno
        # ------------------------------------------------------------------
        ratings_list = list(self.ratings.values())
        return {
            "n_teams": len(self.ratings),
            "n_matches": n_matches,
            "n_draws": n_draws,
            "draw_rate": empirical_draw_rate,
            "draw_threshold": self._draw_threshold,
            "mean_rating": sum(ratings_list) / len(ratings_list),
            "rating_std": float(
                (sum((r - sum(ratings_list) / len(ratings_list)) ** 2 for r in ratings_list)
                 / len(ratings_list)) ** 0.5
            ),
        }

    # ------------------------------------------------------------------
    # Calibração do limiar de empate (modelo logístico ordinal)
    # ------------------------------------------------------------------

    def _calibrate_draw_threshold(
        self, pre_match_diffs: list[float], empirical_draw_rate: float
    ) -> None:
        """Encontra o limiar *t* tal que a taxa média prevista de empate reproduza a observada.

        Para cada partida j com diferença de rating d_j (com bônus de mando):
            z_j = d_j / _ELO_SCALE
            P(draw | z_j, t) = 1 - σ(z_j - t) - σ(-z_j - t)

        O limiar t é encontrado por busca de raiz (bisseção) tal que:
            mean_j[P(draw | z_j, t)] = empirical_draw_rate

        Sem essa calibração, o Elo clássico não produz probabilidades de empate
        separadas — apenas P(não perder).
        """
        # Casos degenerados: empate quase inexistente ou quase total.
        if empirical_draw_rate <= 0.01:
            self._draw_threshold = 0.01
            return
        if empirical_draw_rate >= 0.95:
            self._draw_threshold = 10.0
            return

        zs = [d / _ELO_SCALE for d in pre_match_diffs]

        def _avg_draw_rate(t: float) -> float:
            """Taxa média de empate prevista para um dado limiar t."""
            total = 0.0
            for z in zs:
                p_draw = 1.0 - _sigmoid(z - t) - _sigmoid(-z - t)
                total += max(0.0, p_draw)
            return total / len(zs)

        # Bisseção manual para evitar dependência de scipy só para isso.
        # Para t=0, draw_rate ≈ 0; para t=10, draw_rate ≈ 1.
        lo, hi = 0.001, 8.0
        target = empirical_draw_rate

        # Verificação: se nem no extremo superior alcançamos o target,
        # usamos o máximo (improvável em futebol).
        if _avg_draw_rate(hi) < target:
            self._draw_threshold = hi
            return

        for _ in range(60):  # 60 iterações → precisão de ~1e-18
            mid = (lo + hi) / 2.0
            if _avg_draw_rate(mid) < target:
                lo = mid
            else:
                hi = mid

        self._draw_threshold = (lo + hi) / 2.0

    # ------------------------------------------------------------------
    # Conversão de rating para probabilidades 3-vias
    # ------------------------------------------------------------------

    def three_way_probs(self, rating_diff: float) -> tuple[float, float, float]:
        """Converte diferença de rating (com bônus) em (P_home, P_draw, P_away).

        Usa o modelo logístico ordinal com limiar de empate calibrado:
            P(home)  = σ(z - t)
            P(away)  = σ(-z - t)
            P(draw)  = 1 - P(home) - P(away)

        Retorna probabilidades normalizadas (somam exatamente 1.0).
        """
        z = rating_diff / _ELO_SCALE
        t = self._draw_threshold

        p_home = _sigmoid(z - t)
        p_away = _sigmoid(-z - t)
        p_draw = max(0.0, 1.0 - p_home - p_away)

        # Renormalização por segurança numérica (raro, mas previne flutuações).
        total = p_home + p_draw + p_away
        if total > 0:
            p_home /= total
            p_draw /= total
            p_away /= total

        return p_home, p_draw, p_away

    # ------------------------------------------------------------------
    # predict
    # ------------------------------------------------------------------

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Converte a diferença de rating em probabilidades 1X2 e double chance.

        Mercados derivados:
            - match_result (1X2): P(home), P(draw), P(away) via logístico ordinal.
            - double_chance: 1X, 12, X2.

        O Elo não modela gols individuais, portanto não produz mercados
        baseados em placar (over/under, BTTS, correct_score) — para esses,
        usar Poisson ou Dixon-Coles (ou o ensemble que combina Elo com eles).
        """
        # --- 1. Validação anti-leakage ---------------------------------------
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError(
                "event_data contém informação posterior a as_of (vazamento de dados)."
            )

        home_id = event_data["home_team_id"]
        away_id = event_data["away_team_id"]

        # --- 2. Ratings dos times (desconhecidos recebem initial_rating) ------
        r_home = self.ratings.get(home_id, self.initial_rating)
        r_away = self.ratings.get(away_id, self.initial_rating)

        # --- 3. Probabilidades 1X2 -------------------------------------------
        diff = (r_home + self.home_field_bonus) - r_away
        p_home, p_draw, p_away = self.three_way_probs(diff)

        results: list[PredictionResult] = []

        # Inclui features_used no primeiro resultado para rastreabilidade.
        results.append(
            PredictionResult(
                market="match_result",
                outcome="home",
                probability=p_home,
                features_used={
                    "rating_home": r_home,
                    "rating_away": r_away,
                    "rating_diff": diff,
                    "draw_threshold": self._draw_threshold,
                },
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

        # --- 4. Double Chance -------------------------------------------------
        results.append(
            PredictionResult(
                market="double_chance",
                outcome="1X",
                probability=p_home + p_draw,
            )
        )
        results.append(
            PredictionResult(
                market="double_chance",
                outcome="12",
                probability=p_home + p_away,
            )
        )
        results.append(
            PredictionResult(
                market="double_chance",
                outcome="X2",
                probability=p_draw + p_away,
            )
        )

        return results

    # ------------------------------------------------------------------
    # get_params
    # ------------------------------------------------------------------

    def get_params(self) -> dict:
        return {
            "k_factor": self.k_factor,
            "home_field_bonus": self.home_field_bonus,
            "initial_rating": self.initial_rating,
            "use_margin_of_victory": self.use_margin_of_victory,
            "draw_threshold": self._draw_threshold,
            "ratings": dict(self.ratings),
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
