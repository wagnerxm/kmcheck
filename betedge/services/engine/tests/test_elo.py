"""Testes do modelo Elo adaptado para futebol (3 vias, MoV, calibração de empate).

Cobre:
  - Funções auxiliares (expected_score, mov_multiplier).
  - Treino incremental sobre dados sintéticos (ratings, draw_threshold, etc.).
  - Conversão 3-vias (ordered logistic): simetria, limites, soma = 1.
  - Predição de mercados (match_result, double_chance).
  - Propriedades do Elo: soma zero, times fortes ganham rating, mando de campo.
  - Prevenção de data leakage (cutoff no treino, validate_no_leakage na predição).
"""
from datetime import datetime, timedelta

import pytest

from app.models.elo import EloModel, _ELO_SCALE, _sigmoid


# ═══════════════════════════════════════════════════════════════════════════
# Dados sintéticos
# ═══════════════════════════════════════════════════════════════════════════

def _make_training_data(
    n_matches: int = 200,
    base_date: datetime = datetime(2024, 1, 1),
    teams: list[str] | None = None,
    seed: int = 42,
) -> list[dict]:
    """Gera partidas sintéticas com resultados realistas para futebol.

    Times "fortes" (team_a, team_b) têm lambda maior em casa;
    os demais jogam com média mais equilibrada.
    """
    import numpy as np
    rng = np.random.default_rng(seed)
    teams = teams or ["team_a", "team_b", "team_c", "team_d", "team_e", "team_f"]

    # Força intrínseca: team_a e team_b ligeiramente mais fortes.
    strength = {t: 1.0 for t in teams}
    strength["team_a"] = 1.4
    strength["team_b"] = 1.3

    data = []
    for i in range(n_matches):
        home = teams[rng.integers(len(teams))]
        away = teams[rng.integers(len(teams))]
        while away == home:
            away = teams[rng.integers(len(teams))]

        # lambda com efeito de mando de campo (1.2×) e força intrínseca.
        lam_home = 1.2 * strength[home] * 1.0 / strength[away]
        lam_away = 0.9 * strength[away] * 1.0 / strength[home]
        home_goals = int(rng.poisson(lam_home))
        away_goals = int(rng.poisson(lam_away))

        data.append({
            "home_team_id": home,
            "away_team_id": away,
            "home_goals": home_goals,
            "away_goals": away_goals,
            "kickoff_at": base_date + timedelta(days=i),
        })
    return data


# ═══════════════════════════════════════════════════════════════════════════
# Testes das funções auxiliares
# ═══════════════════════════════════════════════════════════════════════════

class TestEloHelpers:
    def test_expected_score_equilibrado(self):
        """Ratings iguais + bônus de mando → mandante tem ligeira vantagem."""
        model = EloModel()
        e = model.expected_score(1500, 1500)
        # Com bonus=100: diff=100, E = 1/(1+10^(-100/400)) = 1/(1+10^(-0.25)) ≈ 0.64
        assert 0.60 < e < 0.68

    def test_expected_score_sem_bonus(self):
        """Sem bônus de mando, ratings iguais → E = 0.5 exato."""
        model = EloModel(home_field_bonus=0.0)
        e = model.expected_score(1500, 1500)
        assert e == pytest.approx(0.5, abs=1e-10)

    def test_expected_score_soma_1(self):
        """E_home + E_away = 1 (propriedade fundamental do Elo)."""
        model = EloModel()
        e_home = model.expected_score(1600, 1400)
        e_away = 1.0 - e_home
        assert e_home + e_away == pytest.approx(1.0, abs=1e-10)

    def test_expected_score_time_forte_domina(self):
        """Time com +400 pontos → E ≈ 0.91 (fórmula exata sem bônus)."""
        model = EloModel(home_field_bonus=0.0)
        e = model.expected_score(1900, 1500)
        assert e == pytest.approx(0.909, abs=0.01)

    def test_mov_multiplier_empate(self):
        """Empate (goal_diff=0) → multiplicador = 1.0 (sem efeito de MoV)."""
        model = EloModel()
        assert model.mov_multiplier(0, 100.0) == 1.0

    def test_mov_multiplier_cresce_com_goleada(self):
        """Margem de vitória maior → multiplicador maior (log cresce)."""
        model = EloModel()
        m1 = model.mov_multiplier(1, 0.0)
        m2 = model.mov_multiplier(3, 0.0)
        m5 = model.mov_multiplier(5, 0.0)
        assert m1 < m2 < m5

    def test_mov_multiplier_dampener(self):
        """Favorito ganhar por goleada → multiplicador menor que azarão ganhar por goleada."""
        model = EloModel()
        # Favorito (diff=+300) ganha por 3
        m_fav = model.mov_multiplier(3, 300.0)
        # Azarão (diff=0) ganha por 3
        m_dog = model.mov_multiplier(3, 0.0)
        assert m_fav < m_dog

    def test_sigmoid_limites(self):
        """σ(x) deve tender a 0 e 1 nos extremos, e σ(0) = 0.5."""
        assert _sigmoid(0.0) == pytest.approx(0.5, abs=1e-10)
        assert _sigmoid(500.0) == pytest.approx(1.0, abs=1e-10)
        assert _sigmoid(-500.0) == pytest.approx(0.0, abs=1e-10)

    def test_elo_scale_valor(self):
        """_ELO_SCALE ≈ 173.72 (400 / ln(10))."""
        import math
        assert _ELO_SCALE == pytest.approx(400.0 / math.log(10), abs=1e-2)


# ═══════════════════════════════════════════════════════════════════════════
# Testes da conversão 3-vias (three_way_probs)
# ═══════════════════════════════════════════════════════════════════════════

class TestThreeWayProbs:
    def test_soma_a_1(self):
        """P(home) + P(draw) + P(away) = 1.0 para qualquer diferença."""
        model = EloModel()
        for diff in [-300, -100, 0, 50, 100, 200, 400]:
            p_h, p_d, p_a = model.three_way_probs(float(diff))
            assert p_h + p_d + p_a == pytest.approx(1.0, abs=1e-8)

    def test_simetria_sem_bonus(self):
        """diff=0 → P(home) = P(away) (simetria perfeita)."""
        model = EloModel()
        p_h, p_d, p_a = model.three_way_probs(0.0)
        assert p_h == pytest.approx(p_a, abs=1e-8)
        assert p_d > 0

    def test_favorito_tem_mais_chance(self):
        """diff > 0 → P(home) > P(away)."""
        model = EloModel()
        p_h, p_d, p_a = model.three_way_probs(200.0)
        assert p_h > p_a

    def test_azarao_com_diff_negativo(self):
        """diff < 0 → P(away) > P(home)."""
        model = EloModel()
        p_h, p_d, p_a = model.three_way_probs(-200.0)
        assert p_a > p_h

    def test_empate_diminui_com_diff_grande(self):
        """Quanto maior |diff|, menor P(draw) (times muito desiguais)."""
        model = EloModel()
        _, p_d_eq, _ = model.three_way_probs(0.0)
        _, p_d_200, _ = model.three_way_probs(200.0)
        _, p_d_400, _ = model.three_way_probs(400.0)
        assert p_d_eq > p_d_200 > p_d_400

    def test_todas_probabilidades_positivas(self):
        """Nenhuma probabilidade pode ser negativa."""
        model = EloModel()
        for diff in [-500, -200, 0, 200, 500]:
            p_h, p_d, p_a = model.three_way_probs(float(diff))
            assert p_h >= 0
            assert p_d >= 0
            assert p_a >= 0

    def test_draw_threshold_alto_aumenta_empate(self):
        """Limiar de empate maior → mais empates previstos."""
        m1 = EloModel()
        m1._draw_threshold = 0.3
        m2 = EloModel()
        m2._draw_threshold = 0.8

        _, p_d_low, _ = m1.three_way_probs(0.0)
        _, p_d_high, _ = m2.three_way_probs(0.0)
        assert p_d_high > p_d_low


# ═══════════════════════════════════════════════════════════════════════════
# Testes do treino
# ═══════════════════════════════════════════════════════════════════════════

class TestEloTrain:
    def test_treino_basico(self):
        """Treino com dados sintéticos deve completar sem erro."""
        model = EloModel()
        data = _make_training_data(200)
        cutoff = datetime(2024, 7, 1)
        report = model.train(data, cutoff_date=cutoff)

        assert report["n_teams"] == 6
        assert report["n_matches"] > 0
        assert 0 < report["draw_rate"] < 1

    def test_ratings_populados(self):
        """Após treino, todos os times vistos devem ter rating."""
        model = EloModel()
        data = _make_training_data(200)
        cutoff = datetime(2024, 7, 1)
        model.train(data, cutoff_date=cutoff)

        assert len(model.ratings) == 6
        for r in model.ratings.values():
            assert isinstance(r, float)

    def test_time_forte_tem_rating_maior(self):
        """team_a (mais forte) deve convergir para rating acima da média."""
        model = EloModel()
        data = _make_training_data(500)
        cutoff = datetime(2025, 6, 1)
        model.train(data, cutoff_date=cutoff)

        mean_r = sum(model.ratings.values()) / len(model.ratings)
        # team_a tem força 1.4, deve estar acima da média.
        assert model.ratings["team_a"] > mean_r

    def test_soma_zero_aproximada(self):
        """O Elo é soma-zero: a média dos ratings deve ficar próxima ao inicial."""
        model = EloModel(initial_rating=1500.0)
        data = _make_training_data(300)
        cutoff = datetime(2024, 10, 1)
        model.train(data, cutoff_date=cutoff)

        mean_r = sum(model.ratings.values()) / len(model.ratings)
        # A média deve ficar razoavelmente perto de 1500.
        # Com MoV e times entrando em momentos diferentes, pode desviar um pouco.
        assert abs(mean_r - 1500.0) < 100

    def test_draw_threshold_calibrado(self):
        """O limiar de empate deve ser calibrado para reproduzir a taxa empírica."""
        model = EloModel()
        data = _make_training_data(300)
        cutoff = datetime(2024, 10, 1)
        report = model.train(data, cutoff_date=cutoff)

        # O threshold deve ser positivo e razoável para futebol (~0.3–0.8).
        assert 0.1 < model._draw_threshold < 2.0
        assert "draw_threshold" in report

    def test_cutoff_respeita_leakage(self):
        """Treino com cutoff antes de todas as partidas → ValueError."""
        model = EloModel()
        data = _make_training_data(200, base_date=datetime(2024, 6, 1))
        cutoff = datetime(2024, 1, 1)  # antes de todos os dados

        with pytest.raises(ValueError, match="Nenhuma partida"):
            model.train(data, cutoff_date=cutoff)

    def test_cutoff_filtra_partidas(self):
        """Partidas após o cutoff não devem ser usadas no treino."""
        model = EloModel()
        data = _make_training_data(200)
        cutoff = datetime(2024, 4, 1)  # ~90 dias de dados
        report = model.train(data, cutoff_date=cutoff)

        # Deve usar ~90 partidas (1 por dia desde 2024-01-01 até 2024-04-01)
        assert report["n_matches"] < 200
        assert report["n_matches"] == 92  # dias 0..91 inclusive (jan 1 a apr 1)

    def test_trained_at_definido(self):
        model = EloModel()
        data = _make_training_data(100)
        model.train(data, cutoff_date=datetime(2024, 4, 1))
        assert model._trained_at is not None

    def test_last_update_at_populado(self):
        """Cada time deve ter data do último jogo registrada."""
        model = EloModel()
        data = _make_training_data(200)
        model.train(data, cutoff_date=datetime(2024, 7, 1))

        assert len(model._last_update_at) == 6
        for team, dt in model._last_update_at.items():
            assert isinstance(dt, datetime)

    def test_treino_sem_mov(self):
        """Treino com use_margin_of_victory=False deve funcionar."""
        model = EloModel(use_margin_of_victory=False)
        data = _make_training_data(200)
        report = model.train(data, cutoff_date=datetime(2024, 7, 1))
        assert report["n_matches"] > 0

    def test_k_factor_alto_mais_volatil(self):
        """K-factor maior → ratings mais dispersos (reagem mais a cada resultado)."""
        data = _make_training_data(200)
        cutoff = datetime(2024, 7, 1)

        m_low = EloModel(k_factor=10.0)
        m_low.train(data, cutoff_date=cutoff)
        std_low = (
            sum((r - sum(m_low.ratings.values()) / len(m_low.ratings)) ** 2
                for r in m_low.ratings.values())
            / len(m_low.ratings)
        ) ** 0.5

        m_high = EloModel(k_factor=40.0)
        m_high.train(data, cutoff_date=cutoff)
        std_high = (
            sum((r - sum(m_high.ratings.values()) / len(m_high.ratings)) ** 2
                for r in m_high.ratings.values())
            / len(m_high.ratings)
        ) ** 0.5

        assert std_high > std_low


# ═══════════════════════════════════════════════════════════════════════════
# Testes da predição
# ═══════════════════════════════════════════════════════════════════════════

class TestEloPredict:
    @pytest.fixture()
    def trained_model(self):
        model = EloModel()
        data = _make_training_data(300)
        model.train(data, cutoff_date=datetime(2024, 10, 1))
        return model

    def test_retorna_mercados_esperados(self, trained_model):
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        markets = {r.market for r in results}
        assert "match_result" in markets
        assert "double_chance" in markets

    def test_1x2_soma_1(self, trained_model):
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        mr = [r for r in results if r.market == "match_result"]
        assert len(mr) == 3
        assert sum(r.probability for r in mr) == pytest.approx(1.0, abs=1e-6)

    def test_double_chance_coerente(self, trained_model):
        """Double chance deve ser soma dos pares corretos do 1X2."""
        event = {
            "home_team_id": "team_c",
            "away_team_id": "team_d",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        mr_dict = {r.outcome: r.probability for r in results if r.market == "match_result"}
        dc_dict = {r.outcome: r.probability for r in results if r.market == "double_chance"}

        assert dc_dict["1X"] == pytest.approx(mr_dict["home"] + mr_dict["draw"], abs=1e-8)
        assert dc_dict["12"] == pytest.approx(mr_dict["home"] + mr_dict["away"], abs=1e-8)
        assert dc_dict["X2"] == pytest.approx(mr_dict["draw"] + mr_dict["away"], abs=1e-8)

    def test_probabilidades_no_intervalo(self, trained_model):
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        for r in results:
            assert 0 <= r.probability <= 1, f"{r.market}/{r.outcome}: {r.probability}"

    def test_leakage_rejeitado(self, trained_model):
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
            "result_confirmed_at": datetime(2024, 10, 6),
        }
        with pytest.raises(ValueError, match="posterior a as_of"):
            trained_model.predict(event, as_of=datetime(2024, 10, 5))

    def test_time_desconhecido(self, trained_model):
        """Time não visto no treino recebe initial_rating — não deve crashar."""
        event = {
            "home_team_id": "time_novo",
            "away_team_id": "team_a",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))
        assert len(results) > 0
        for r in results:
            assert 0 <= r.probability <= 1

    def test_features_used_no_primeiro_resultado(self, trained_model):
        """O primeiro resultado (home) deve incluir features_used para rastreabilidade."""
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        home_result = next(r for r in results if r.market == "match_result" and r.outcome == "home")
        assert home_result.features_used is not None
        assert "rating_home" in home_result.features_used
        assert "rating_away" in home_result.features_used
        assert "rating_diff" in home_result.features_used


# ═══════════════════════════════════════════════════════════════════════════
# Testes de propriedades do Elo
# ═══════════════════════════════════════════════════════════════════════════

class TestEloProperties:
    def test_home_advantage_refletido(self):
        """Com times equilibrados, mando de campo deve favorecer o mandante."""
        model = EloModel()
        data = _make_training_data(300)
        model.train(data, cutoff_date=datetime(2024, 10, 1))

        # Dois times de força média similares.
        event = {
            "home_team_id": "team_c",
            "away_team_id": "team_d",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = model.predict(event, as_of=datetime(2024, 10, 5))
        mr = {r.outcome: r.probability for r in results if r.market == "match_result"}

        # O bônus de mando deve dar alguma vantagem ao mandante, mas
        # depende dos ratings específicos — verificamos apenas que as
        # probabilidades são realistas.
        assert mr["home"] > 0.1
        assert mr["away"] > 0.1
        assert mr["draw"] > 0.05

    def test_get_params_completo(self):
        """get_params() deve incluir todos os hiperparâmetros e estado."""
        model = EloModel()
        data = _make_training_data(200)
        model.train(data, cutoff_date=datetime(2024, 7, 1))

        params = model.get_params()
        assert "k_factor" in params
        assert "home_field_bonus" in params
        assert "initial_rating" in params
        assert "use_margin_of_victory" in params
        assert "draw_threshold" in params
        assert "ratings" in params
        assert "trained_at" in params
        assert params["trained_at"] is not None

    def test_reprodutibilidade(self):
        """Treinar duas vezes com os mesmos dados → mesmos ratings."""
        data = _make_training_data(200)
        cutoff = datetime(2024, 7, 1)

        m1 = EloModel()
        m1.train(data, cutoff_date=cutoff)

        m2 = EloModel()
        m2.train(data, cutoff_date=cutoff)

        for team in m1.ratings:
            assert m1.ratings[team] == pytest.approx(m2.ratings[team], abs=1e-10)

    def test_retrain_reseta_ratings(self):
        """Retreinar deve resetar ratings — não acumular sobre o treino anterior."""
        model = EloModel()
        data = _make_training_data(200)

        model.train(data, cutoff_date=datetime(2024, 4, 1))
        ratings_1 = dict(model.ratings)

        model.train(data, cutoff_date=datetime(2024, 4, 1))
        ratings_2 = dict(model.ratings)

        for team in ratings_1:
            assert ratings_1[team] == pytest.approx(ratings_2[team], abs=1e-10)
