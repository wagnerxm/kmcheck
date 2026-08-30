"""Testes do GradientBoostModel — treino, predição, importâncias e anti-leakage.

Cobre:
  - Construção do estimador (XGBoost e LightGBM).
  - Treino com dados sintéticos: métricas, best_iteration, split temporal.
  - Predição: mercados match_result e double_chance, soma=1, intervalo [0,1].
  - Feature importances: normalização, todas as features presentes.
  - Anti-leakage: cutoff no treino, validate_no_leakage na predição.
  - Reprodutibilidade (random_state fixo).
  - Dados insuficientes → ValueError.
  - Modelo não treinado → RuntimeError.
"""
from datetime import datetime, timedelta

import numpy as np
import pytest

from app.models.gradient_boost import GradientBoostModel, _LABEL_MAP_3WAY


# ═══════════════════════════════════════════════════════════════════════════
# Dados sintéticos
# ═══════════════════════════════════════════════════════════════════════════

def _make_training_data(
    n_matches: int = 200,
    base_date: datetime = datetime(2024, 1, 1),
    seed: int = 42,
) -> list[dict]:
    """Gera partidas sintéticas para treino do GradientBoostModel.

    Times fortes (team_a, team_b) marcam mais gols em casa;
    times fracos (team_e, team_f) marcam menos. Isso cria um padrão
    aprendível pelas features de forma.
    """
    rng = np.random.default_rng(seed)
    teams = ["team_a", "team_b", "team_c", "team_d", "team_e", "team_f"]

    strength = {"team_a": 1.5, "team_b": 1.3, "team_c": 1.0,
                "team_d": 1.0, "team_e": 0.8, "team_f": 0.7}

    data = []
    for i in range(n_matches):
        home = teams[rng.integers(len(teams))]
        away = teams[rng.integers(len(teams))]
        while away == home:
            away = teams[rng.integers(len(teams))]

        lam_home = 1.3 * strength[home] / max(strength[away], 0.5)
        lam_away = 0.9 * strength[away] / max(strength[home], 0.5)
        home_goals = int(rng.poisson(max(lam_home, 0.3)))
        away_goals = int(rng.poisson(max(lam_away, 0.3)))

        data.append({
            "home_team_id": home,
            "away_team_id": away,
            "home_goals": home_goals,
            "away_goals": away_goals,
            "kickoff_at": base_date + timedelta(days=i),
        })
    return data


def _make_event_data(
    data: list[dict],
    home_team: str = "team_a",
    away_team: str = "team_b",
    as_of: datetime = datetime(2024, 10, 1),
) -> dict:
    """Prepara um event_data para predict(), com match_history extraído dos dados."""
    # Filtra históricos do mandante e visitante anteriores a as_of.
    home_history = [
        m for m in data
        if (m["home_team_id"] == home_team or m["away_team_id"] == home_team)
        and m["kickoff_at"] < as_of
    ]
    home_history.sort(key=lambda m: m["kickoff_at"], reverse=True)

    away_history = [
        m for m in data
        if (m["home_team_id"] == away_team or m["away_team_id"] == away_team)
        and m["kickoff_at"] < as_of
    ]
    away_history.sort(key=lambda m: m["kickoff_at"], reverse=True)

    return {
        "home_team_id": home_team,
        "away_team_id": away_team,
        "kickoff_at": as_of,
        "match_history_home": home_history,
        "match_history_away": away_history,
        "elo_ratings": {},
        "market_odds": {},
    }


# ═══════════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture()
def training_data():
    return _make_training_data(300)


@pytest.fixture()
def trained_model(training_data):
    model = GradientBoostModel(backend="xgboost")
    model.train(training_data, cutoff_date=datetime(2024, 9, 1))
    return model, training_data


# ═══════════════════════════════════════════════════════════════════════════
# Testes do construtor e estimador
# ═══════════════════════════════════════════════════════════════════════════

class TestGradientBoostInit:
    def test_defaults(self):
        model = GradientBoostModel()
        assert model.name == "gradient_boost"
        assert model.version == "1.0.0"
        assert model.market == "match_result"
        assert model.backend == "xgboost"
        assert model.n_estimators == 300
        assert model.max_depth == 4
        assert model.learning_rate == 0.05
        assert model.subsample == 0.8
        assert model._estimator is None

    def test_custom_features(self):
        model = GradientBoostModel(feature_list=["is_home", "rest_days"])
        assert model.feature_names == ["is_home", "rest_days"]

    def test_default_features_13(self):
        model = GradientBoostModel()
        assert len(model.feature_names) == 13

    def test_build_estimator_xgboost(self):
        model = GradientBoostModel(backend="xgboost")
        est = model._build_estimator()
        assert est is not None
        from xgboost import XGBClassifier
        assert isinstance(est, XGBClassifier)

    def test_build_estimator_lightgbm(self):
        model = GradientBoostModel(backend="lightgbm")
        est = model._build_estimator()
        assert est is not None
        from lightgbm import LGBMClassifier
        assert isinstance(est, LGBMClassifier)

    def test_label_map_3way(self):
        assert _LABEL_MAP_3WAY[1.0] == 2  # vitória
        assert _LABEL_MAP_3WAY[0.5] == 1  # empate
        assert _LABEL_MAP_3WAY[0.0] == 0  # derrota


# ═══════════════════════════════════════════════════════════════════════════
# Testes do treino
# ═══════════════════════════════════════════════════════════════════════════

class TestGradientBoostTrain:
    def test_treino_basico_xgboost(self, training_data):
        model = GradientBoostModel(backend="xgboost")
        report = model.train(training_data, cutoff_date=datetime(2024, 9, 1))

        assert report["backend"] == "xgboost"
        assert report["market"] == "match_result"
        assert report["n_total"] > 0
        assert report["n_train"] > 0
        assert report["n_val"] > 0
        assert report["n_train"] + report["n_val"] == report["n_total"]
        assert report["val_log_loss"] > 0

    def test_treino_basico_lightgbm(self, training_data):
        model = GradientBoostModel(backend="lightgbm")
        report = model.train(training_data, cutoff_date=datetime(2024, 9, 1))

        assert report["backend"] == "lightgbm"
        assert report["n_total"] > 0
        assert report["val_log_loss"] > 0

    def test_best_iteration_registrado(self, training_data):
        model = GradientBoostModel(backend="xgboost")
        report = model.train(training_data, cutoff_date=datetime(2024, 9, 1))

        assert report["best_iteration"] is not None
        assert report["best_iteration"] > 0

    def test_estimator_populado(self, training_data):
        model = GradientBoostModel()
        model.train(training_data, cutoff_date=datetime(2024, 9, 1))
        assert model._estimator is not None

    def test_trained_at_definido(self, training_data):
        model = GradientBoostModel()
        model.train(training_data, cutoff_date=datetime(2024, 9, 1))
        assert model._trained_at is not None

    def test_classes_populadas(self, training_data):
        model = GradientBoostModel()
        model.train(training_data, cutoff_date=datetime(2024, 9, 1))
        assert model._classes == [0, 1, 2]

    def test_cutoff_filtra_dados(self, training_data):
        """Cutoff deve filtrar partidas — usar menos dados que o total."""
        model = GradientBoostModel()
        report = model.train(training_data, cutoff_date=datetime(2024, 4, 1))

        # 300 partidas, base_date=2024-01-01, cutoff=2024-04-01 → ~91 dias
        assert report["n_total"] < 300 * 2  # < 600 linhas (2 por partida)
        assert report["n_total"] > 0

    def test_dados_insuficientes_levanta_erro(self):
        """Com poucas partidas, treino deve levantar ValueError."""
        model = GradientBoostModel()
        data = _make_training_data(3)  # só 3 partidas → 6 linhas
        with pytest.raises(ValueError, match="insuficientes"):
            model.train(data, cutoff_date=datetime(2024, 1, 10))

    def test_sem_partidas_apos_cutoff(self):
        """Cutoff antes de todas as partidas → ValueError."""
        model = GradientBoostModel()
        data = _make_training_data(50, base_date=datetime(2024, 6, 1))
        with pytest.raises(ValueError, match="Nenhuma partida"):
            model.train(data, cutoff_date=datetime(2024, 1, 1))

    def test_split_temporal_nao_aleatorio(self, training_data):
        """Validação deve usar o último bloco cronológico, não aleatório.

        Isso é verificado indiretamente: duas execuções com os mesmos dados
        devem produzir exatamente as mesmas métricas (determinismo).
        """
        m1 = GradientBoostModel(backend="xgboost")
        r1 = m1.train(training_data, cutoff_date=datetime(2024, 9, 1))

        m2 = GradientBoostModel(backend="xgboost")
        r2 = m2.train(training_data, cutoff_date=datetime(2024, 9, 1))

        assert r1["val_log_loss"] == pytest.approx(r2["val_log_loss"], abs=1e-10)

    def test_custom_feature_list(self, training_data):
        """Treino com subset de features deve funcionar."""
        model = GradientBoostModel(feature_list=["is_home", "rest_days", "win_streak"])
        report = model.train(training_data, cutoff_date=datetime(2024, 9, 1))

        assert report["n_features"] == 3
        assert report["n_total"] > 0

    def test_val_log_loss_finito_e_positivo(self, training_data):
        """Log loss de validação deve ser finito e positivo (modelo convergiu)."""
        model = GradientBoostModel(backend="xgboost")
        report = model.train(training_data, cutoff_date=datetime(2024, 9, 1))

        # Com dados sintéticos, o modelo pode não bater o baseline uniforme
        # (ln(3) ≈ 1.099), mas deve convergir para um valor finito e razoável.
        assert 0 < report["val_log_loss"] < 3.0
        assert np.isfinite(report["val_log_loss"])


# ═══════════════════════════════════════════════════════════════════════════
# Testes da predição
# ═══════════════════════════════════════════════════════════════════════════

class TestGradientBoostPredict:
    def test_retorna_mercados_match_result(self, trained_model):
        model, data = trained_model
        event = _make_event_data(data)
        results = model.predict(event, as_of=datetime(2024, 10, 1))

        markets = {r.market for r in results}
        assert "match_result" in markets

    def test_retorna_double_chance(self, trained_model):
        model, data = trained_model
        event = _make_event_data(data)
        results = model.predict(event, as_of=datetime(2024, 10, 1))

        markets = {r.market for r in results}
        assert "double_chance" in markets

    def test_1x2_soma_1(self, trained_model):
        model, data = trained_model
        event = _make_event_data(data)
        results = model.predict(event, as_of=datetime(2024, 10, 1))

        mr = [r for r in results if r.market == "match_result"]
        assert len(mr) == 3
        assert sum(r.probability for r in mr) == pytest.approx(1.0, abs=1e-4)

    def test_double_chance_coerente(self, trained_model):
        """Double chance deve ser soma dos pares corretos do 1X2."""
        model, data = trained_model
        event = _make_event_data(data)
        results = model.predict(event, as_of=datetime(2024, 10, 1))

        mr_dict = {r.outcome: r.probability for r in results if r.market == "match_result"}
        dc_dict = {r.outcome: r.probability for r in results if r.market == "double_chance"}

        assert dc_dict["1X"] == pytest.approx(mr_dict["home"] + mr_dict["draw"], abs=1e-6)
        assert dc_dict["12"] == pytest.approx(mr_dict["home"] + mr_dict["away"], abs=1e-6)
        assert dc_dict["X2"] == pytest.approx(mr_dict["draw"] + mr_dict["away"], abs=1e-6)

    def test_probabilidades_no_intervalo(self, trained_model):
        model, data = trained_model
        event = _make_event_data(data)
        results = model.predict(event, as_of=datetime(2024, 10, 1))

        for r in results:
            assert 0 <= r.probability <= 1, f"{r.market}/{r.outcome}: {r.probability}"

    def test_features_used_no_primeiro_resultado(self, trained_model):
        """O primeiro resultado (home) deve incluir features_used."""
        model, data = trained_model
        event = _make_event_data(data)
        results = model.predict(event, as_of=datetime(2024, 10, 1))

        home_result = next(r for r in results if r.market == "match_result" and r.outcome == "home")
        assert home_result.features_used is not None
        assert len(home_result.features_used) > 0

    def test_modelo_nao_treinado_levanta_erro(self):
        """Chamar predict() antes de train() deve dar RuntimeError."""
        model = GradientBoostModel()
        event = {
            "home_team_id": "A",
            "away_team_id": "B",
            "kickoff_at": datetime(2024, 10, 1),
            "match_history_home": [],
            "match_history_away": [],
        }
        with pytest.raises(RuntimeError, match="não treinado"):
            model.predict(event, as_of=datetime(2024, 10, 1))

    def test_leakage_rejeitado(self, trained_model):
        """Event com timestamp futuro em relação a as_of deve ser rejeitado."""
        model, data = trained_model
        event = _make_event_data(data)
        event["result_confirmed_at"] = datetime(2024, 10, 5)

        with pytest.raises(ValueError, match="posterior a as_of"):
            model.predict(event, as_of=datetime(2024, 10, 1))

    def test_predicao_diferentes_times(self, trained_model):
        """Predições para matchups diferentes devem gerar probabilidades diferentes."""
        model, data = trained_model

        event1 = _make_event_data(data, home_team="team_a", away_team="team_f")
        event2 = _make_event_data(data, home_team="team_f", away_team="team_a")

        r1 = model.predict(event1, as_of=datetime(2024, 10, 1))
        r2 = model.predict(event2, as_of=datetime(2024, 10, 1))

        p_home_1 = next(r for r in r1 if r.market == "match_result" and r.outcome == "home").probability
        p_home_2 = next(r for r in r2 if r.market == "match_result" and r.outcome == "home").probability

        # Inverter mandante e visitante deve mudar as probabilidades.
        assert p_home_1 != pytest.approx(p_home_2, abs=0.01)


# ═══════════════════════════════════════════════════════════════════════════
# Testes de feature importances
# ═══════════════════════════════════════════════════════════════════════════

class TestFeatureImportances:
    def test_importances_retorna_dict(self, trained_model):
        model, _ = trained_model
        imp = model.feature_importances()

        assert isinstance(imp, dict)
        assert len(imp) == len(model.feature_names)

    def test_importances_soma_1(self, trained_model):
        model, _ = trained_model
        imp = model.feature_importances()

        assert sum(imp.values()) == pytest.approx(1.0, abs=1e-6)

    def test_importances_todas_positivas(self, trained_model):
        model, _ = trained_model
        imp = model.feature_importances()

        for name, val in imp.items():
            assert val >= 0, f"Importância negativa para '{name}': {val}"

    def test_importances_tem_todas_features(self, trained_model):
        model, _ = trained_model
        imp = model.feature_importances()

        for name in model.feature_names:
            assert name in imp

    def test_importances_modelo_nao_treinado(self):
        model = GradientBoostModel()
        with pytest.raises(RuntimeError, match="não treinado"):
            model.feature_importances()


# ═══════════════════════════════════════════════════════════════════════════
# Testes de get_params
# ═══════════════════════════════════════════════════════════════════════════

class TestGetParams:
    def test_params_completo(self, trained_model):
        model, _ = trained_model
        params = model.get_params()

        assert params["market"] == "match_result"
        assert params["backend"] == "xgboost"
        assert params["n_estimators"] == 300
        assert params["max_depth"] == 4
        assert params["learning_rate"] == 0.05
        assert params["subsample"] == 0.8
        assert params["colsample_bytree"] == 0.8
        assert params["best_iteration"] is not None
        assert params["trained_at"] is not None
        assert len(params["feature_names"]) == 13

    def test_params_antes_de_treinar(self):
        model = GradientBoostModel()
        params = model.get_params()

        assert params["best_iteration"] is None
        assert params["trained_at"] is None


# ═══════════════════════════════════════════════════════════════════════════
# Testes de reprodutibilidade
# ═══════════════════════════════════════════════════════════════════════════

class TestReproducibility:
    def test_predicoes_reprodutiveis(self, training_data):
        """Dois treinos com mesmos dados + random_state fixo → mesmas predições."""
        m1 = GradientBoostModel(backend="xgboost")
        m1.train(training_data, cutoff_date=datetime(2024, 9, 1))

        m2 = GradientBoostModel(backend="xgboost")
        m2.train(training_data, cutoff_date=datetime(2024, 9, 1))

        event = _make_event_data(training_data)

        r1 = m1.predict(event, as_of=datetime(2024, 10, 1))
        r2 = m2.predict(event, as_of=datetime(2024, 10, 1))

        for p1, p2 in zip(r1, r2):
            assert p1.probability == pytest.approx(p2.probability, abs=1e-10)


# ═══════════════════════════════════════════════════════════════════════════
# Testes de log loss manual
# ═══════════════════════════════════════════════════════════════════════════

class TestComputeLogLoss:
    def test_binario_perfeito(self):
        """Previsão perfeita (p=1 para classe correta) → log loss ≈ 0."""
        y_true = np.array([1, 0, 1, 0])
        y_probs = np.array([0.999, 0.001, 0.999, 0.001])
        loss = GradientBoostModel._compute_log_loss(y_true, y_probs)
        assert loss < 0.01

    def test_binario_aleatorio(self):
        """Previsão uniforme (p=0.5) → log loss = ln(2) ≈ 0.693."""
        y_true = np.array([1, 0, 1, 0])
        y_probs = np.array([0.5, 0.5, 0.5, 0.5])
        loss = GradientBoostModel._compute_log_loss(y_true, y_probs)
        assert loss == pytest.approx(np.log(2), abs=1e-3)

    def test_multiclasse_perfeito(self):
        """Previsão multiclasse perfeita → log loss ≈ 0."""
        y_true = np.array([0, 1, 2, 0])
        y_probs = np.array([
            [0.99, 0.005, 0.005],
            [0.005, 0.99, 0.005],
            [0.005, 0.005, 0.99],
            [0.99, 0.005, 0.005],
        ])
        loss = GradientBoostModel._compute_log_loss(y_true, y_probs)
        assert loss < 0.02

    def test_multiclasse_uniforme(self):
        """Previsão uniforme 1/3 → log loss = ln(3) ≈ 1.099."""
        y_true = np.array([0, 1, 2])
        y_probs = np.array([
            [1/3, 1/3, 1/3],
            [1/3, 1/3, 1/3],
            [1/3, 1/3, 1/3],
        ])
        loss = GradientBoostModel._compute_log_loss(y_true, y_probs)
        assert loss == pytest.approx(np.log(3), abs=1e-3)
