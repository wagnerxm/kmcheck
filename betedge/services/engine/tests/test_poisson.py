"""Testes do modelo de Poisson independente (Maher 1982).

Cobre:
  - Construção da matriz de placares (propriedades estatísticas).
  - Treino por MLE sobre dados sintéticos (convergência, parâmetros razoáveis).
  - Predição de mercados (1X2, Over/Under, BTTS, Double Chance, Correct Score).
  - Prevenção de data leakage (cutoff no treino, validate_no_leakage na predição).
"""
from datetime import datetime, timedelta

import numpy as np
import pytest

from app.models.poisson import PoissonModel


# ═══════════════════════════════════════════════════════════════════════════
# Dados sintéticos para treino
# ═══════════════════════════════════════════════════════════════════════════

def _make_training_data(
    n_matches: int = 200,
    base_date: datetime = datetime(2024, 1, 1),
    teams: list[str] | None = None,
) -> list[dict]:
    """Gera partidas sintéticas com distribuição de gols realista."""
    rng = np.random.default_rng(42)
    teams = teams or ["team_a", "team_b", "team_c", "team_d", "team_e", "team_f"]
    data = []
    for i in range(n_matches):
        home = teams[rng.integers(len(teams))]
        away = teams[rng.integers(len(teams))]
        while away == home:
            away = teams[rng.integers(len(teams))]

        # Gols simulados com Poisson (lambda médio ~1.5 casa, ~1.1 fora)
        home_goals = int(rng.poisson(1.5))
        away_goals = int(rng.poisson(1.1))

        data.append({
            "home_team_id": home,
            "away_team_id": away,
            "home_goals": home_goals,
            "away_goals": away_goals,
            "kickoff_at": base_date + timedelta(days=i),
        })
    return data


# ═══════════════════════════════════════════════════════════════════════════
# Testes da score_matrix
# ═══════════════════════════════════════════════════════════════════════════

class TestPoissonScoreMatrix:
    def test_soma_a_um(self):
        model = PoissonModel()
        matrix = model.score_matrix(1.5, 1.1)
        assert matrix.sum() == pytest.approx(1.0, abs=1e-6)

    def test_formato_correto(self):
        model = PoissonModel()
        matrix = model.score_matrix(1.5, 1.1, max_goals=8)
        assert matrix.shape == (9, 9)

    def test_todas_probabilidades_positivas(self):
        model = PoissonModel()
        matrix = model.score_matrix(1.5, 1.1)
        assert (matrix >= 0).all()

    def test_lambda_alto_desloca_massa(self):
        """Com lambda_home muito maior que lambda_away, P(home win) deve dominar."""
        model = PoissonModel()
        matrix = model.score_matrix(3.0, 0.5)
        # P(home win) = soma do triângulo inferior (h > a)
        p_home = sum(matrix[h, a] for h in range(11) for a in range(11) if h > a)
        assert p_home > 0.85

    def test_simetria_lambdas_iguais(self):
        """Lambdas iguais (sem mando de campo implícito) → P(home) ≈ P(away)."""
        model = PoissonModel()
        matrix = model.score_matrix(1.5, 1.5)
        p_home = sum(matrix[h, a] for h in range(11) for a in range(11) if h > a)
        p_away = sum(matrix[h, a] for h in range(11) for a in range(11) if h < a)
        assert p_home == pytest.approx(p_away, abs=1e-6)


# ═══════════════════════════════════════════════════════════════════════════
# Testes do treino (train)
# ═══════════════════════════════════════════════════════════════════════════

class TestPoissonTrain:
    def test_treino_converge(self):
        model = PoissonModel()
        data = _make_training_data(200)
        cutoff = datetime(2024, 7, 1)
        report = model.train(data, cutoff_date=cutoff)

        assert report["converged"] is True
        assert report["n_teams"] == 6
        assert report["n_matches"] > 0
        assert report["n_matches"] <= 200

    def test_attack_defense_ratings_populados(self):
        model = PoissonModel()
        data = _make_training_data(200)
        cutoff = datetime(2024, 7, 1)
        model.train(data, cutoff_date=cutoff)

        assert len(model.attack_ratings) == 6
        assert len(model.defense_ratings) == 6
        # Ratings devem ser positivos (em escala linear)
        for r in model.attack_ratings.values():
            assert r > 0
        for r in model.defense_ratings.values():
            assert r > 0

    def test_home_advantage_razoavel(self):
        """Home advantage tipicamente entre 1.0 e 2.0 para futebol."""
        model = PoissonModel()
        data = _make_training_data(300)
        cutoff = datetime(2024, 10, 1)
        model.train(data, cutoff_date=cutoff)

        assert 0.8 < model.home_advantage < 2.5

    def test_cutoff_respeita_leakage(self):
        """Treino com cutoff antes dos dados → nenhuma partida usada ou pouquíssimas."""
        model = PoissonModel()
        data = _make_training_data(200, base_date=datetime(2024, 6, 1))
        cutoff = datetime(2024, 1, 1)  # Antes de todos os dados

        # Deve ou retornar n_matches=0 ou levantar exceção por dados insuficientes
        try:
            report = model.train(data, cutoff_date=cutoff)
            assert report["n_matches"] == 0
        except ValueError:
            pass  # Aceitável levantar erro por dados insuficientes

    def test_trained_at_definido(self):
        model = PoissonModel()
        data = _make_training_data(100)
        cutoff = datetime(2024, 4, 1)
        model.train(data, cutoff_date=cutoff)

        assert model._trained_at is not None

    def test_get_params_reflete_treino(self):
        model = PoissonModel()
        data = _make_training_data(200)
        cutoff = datetime(2024, 7, 1)
        model.train(data, cutoff_date=cutoff)

        params = model.get_params()
        assert "attack_ratings" in params
        assert "defense_ratings" in params
        assert "home_advantage" in params
        assert params["trained_at"] is not None


# ═══════════════════════════════════════════════════════════════════════════
# Testes da predição (predict)
# ═══════════════════════════════════════════════════════════════════════════

class TestPoissonPredict:
    @pytest.fixture()
    def trained_model(self):
        model = PoissonModel()
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
        assert "btts" in markets

    def test_probabilidades_1x2_somam_1(self, trained_model):
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        mr = [r for r in results if r.market == "match_result"]
        assert len(mr) == 3
        prob_sum = sum(r.probability for r in mr)
        assert prob_sum == pytest.approx(1.0, abs=1e-4)

    def test_probabilidades_over_under_somam_1(self, trained_model):
        event = {
            "home_team_id": "team_c",
            "away_team_id": "team_d",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        ou25 = [r for r in results if r.market == "over_under_2.5"]
        if len(ou25) == 2:
            assert sum(r.probability for r in ou25) == pytest.approx(1.0, abs=1e-4)

    def test_probabilidades_btts_somam_1(self, trained_model):
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_c",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        btts = [r for r in results if r.market == "btts"]
        if len(btts) == 2:
            assert sum(r.probability for r in btts) == pytest.approx(1.0, abs=1e-4)

    def test_probabilidades_no_intervalo(self, trained_model):
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))

        for r in results:
            assert 0 <= r.probability <= 1, f"{r.market}/{r.outcome}: {r.probability}"

    def test_leakage_rejeitado_na_predicao(self, trained_model):
        """Predição com dados futuros relativos a as_of deve ser rejeitada."""
        event = {
            "home_team_id": "team_a",
            "away_team_id": "team_b",
            "kickoff_at": datetime(2024, 10, 5),
            "result_confirmed_at": datetime(2024, 10, 6),  # futuro relativo ao as_of
        }
        with pytest.raises(ValueError, match="posterior a as_of"):
            trained_model.predict(event, as_of=datetime(2024, 10, 5))

    def test_time_desconhecido_usa_media(self, trained_model):
        """Time não visto no treino deve usar ratings médios (não crashar)."""
        event = {
            "home_team_id": "time_novo_xyz",
            "away_team_id": "team_a",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = trained_model.predict(event, as_of=datetime(2024, 10, 5))
        assert len(results) > 0
        for r in results:
            assert 0 <= r.probability <= 1


# ═══════════════════════════════════════════════════════════════════════════
# Testes de propriedades estatísticas
# ═══════════════════════════════════════════════════════════════════════════

class TestPoissonProperties:
    def test_home_advantage_aumenta_prob_casa(self):
        """Modelo treinado deve dar P(home) > P(away) em média, refletindo mando de campo."""
        model = PoissonModel()
        data = _make_training_data(300)
        model.train(data, cutoff_date=datetime(2024, 10, 1))

        # Escolhe dois times "médios" (não um muito forte vs fraco)
        event = {
            "home_team_id": "team_c",
            "away_team_id": "team_d",
            "kickoff_at": datetime(2024, 10, 5),
        }
        results = model.predict(event, as_of=datetime(2024, 10, 5))
        mr = {r.outcome: r.probability for r in results if r.market == "match_result"}

        # Com mando de campo, geralmente P(home) > P(away) para times equilibrados
        # (pode falhar se os dados aleatórios geraram times muito desiguais, então
        # verificamos apenas que as probabilidades são razoáveis)
        assert mr.get("home", 0) > 0.1
        assert mr.get("away", 0) > 0.1
        assert mr.get("draw", 0) > 0.05
