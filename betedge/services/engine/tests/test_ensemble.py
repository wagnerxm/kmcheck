"""Testes do EnsembleModel — todas as estratégias de combinação.

Cobre:
  - Média simples: pesos iguais, soma = 1, renormalização.
  - Média ponderada: fallback 1/brier, otimização por log loss (SLSQP).
  - Stacking: meta-modelo de regressão logística, multiclasse e binário.
  - Ajuste dinâmico de pesos via decaimento exponencial.
  - Incerteza do ensemble (variância ponderada).
  - Anti-leakage, modelo sem membros, get_params.
"""
from datetime import datetime

import numpy as np
import pytest

from app.models.base import BaseModel, PredictionResult
from app.models.ensemble import EnsembleModel, EnsembleMember


# ═══════════════════════════════════════════════════════════════════════════
# Modelo mock para testes
# ═══════════════════════════════════════════════════════════════════════════

class _MockModel(BaseModel):
    """Mock que retorna probabilidades configuráveis."""

    version = "1.0.0"

    def __init__(
        self,
        name: str,
        home: float = 0.5,
        draw: float = 0.25,
        away: float = 0.25,
    ) -> None:
        self.name = name
        self._home = home
        self._draw = draw
        self._away = away

    def train(self, training_data, cutoff_date: datetime) -> dict:
        return {}

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        return [
            PredictionResult(market="match_result", outcome="home", probability=self._home,
                             features_used={"model": self.name}),
            PredictionResult(market="match_result", outcome="draw", probability=self._draw),
            PredictionResult(market="match_result", outcome="away", probability=self._away),
            PredictionResult(market="double_chance", outcome="1X", probability=self._home + self._draw),
            PredictionResult(market="double_chance", outcome="12", probability=self._home + self._away),
            PredictionResult(market="double_chance", outcome="X2", probability=self._draw + self._away),
        ]

    def get_params(self) -> dict:
        return {"home": self._home, "draw": self._draw, "away": self._away}


def _event() -> dict:
    return {
        "home_team_id": "A",
        "away_team_id": "B",
        "kickoff_at": datetime(2024, 10, 1),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Média simples
# ═══════════════════════════════════════════════════════════════════════════

class TestSimpleAverage:
    def test_media_de_dois_modelos(self):
        ens = EnsembleModel(strategy="simple_average")
        ens.add_member(_MockModel("m1", home=0.6, draw=0.2, away=0.2))
        ens.add_member(_MockModel("m2", home=0.4, draw=0.3, away=0.3))
        ens.train({}, cutoff_date=datetime(2024, 9, 1))

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        mr = {r.outcome: r.probability for r in results if r.market == "match_result"}

        assert mr["home"] == pytest.approx(0.5, abs=1e-6)
        assert mr["draw"] == pytest.approx(0.25, abs=1e-6)
        assert mr["away"] == pytest.approx(0.25, abs=1e-6)

    def test_soma_1(self):
        ens = EnsembleModel(strategy="simple_average")
        ens.add_member(_MockModel("m1", home=0.7, draw=0.2, away=0.1))
        ens.add_member(_MockModel("m2", home=0.3, draw=0.4, away=0.3))
        ens.train({}, cutoff_date=datetime(2024, 9, 1))

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        mr = [r for r in results if r.market == "match_result"]
        assert sum(r.probability for r in mr) == pytest.approx(1.0, abs=1e-6)

    def test_double_chance_coerente(self):
        ens = EnsembleModel(strategy="simple_average")
        ens.add_member(_MockModel("m1", home=0.6, draw=0.2, away=0.2))
        ens.add_member(_MockModel("m2", home=0.4, draw=0.3, away=0.3))
        ens.train({}, cutoff_date=datetime(2024, 9, 1))

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        mr = {r.outcome: r.probability for r in results if r.market == "match_result"}
        dc = {r.outcome: r.probability for r in results if r.market == "double_chance"}

        # Double chance é renormalizado dentro do seu mercado para somar 1,
        # assim como match_result. As proporções relativas devem ser
        # preservadas: 1X > X2 se home+draw > draw+away.
        assert sum(dc.values()) == pytest.approx(1.0, abs=1e-6)
        # A proporção relativa 1X/X2 deve corresponder a (home+draw)/(draw+away).
        expected_1x_raw = mr["home"] + mr["draw"]  # antes da renorm dc
        expected_x2_raw = mr["draw"] + mr["away"]
        assert dc["1X"] / dc["X2"] == pytest.approx(expected_1x_raw / expected_x2_raw, abs=1e-4)

    def test_confidence_proporcional(self):
        ens = EnsembleModel(strategy="simple_average")
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))
        ens.train({}, cutoff_date=datetime(2024, 9, 1))

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        for r in results:
            assert r.confidence == 1.0  # todos contribuem

    def test_ensemble_variance(self):
        """Features_used deve incluir ensemble_variance."""
        ens = EnsembleModel(strategy="simple_average")
        ens.add_member(_MockModel("m1", home=0.8, draw=0.1, away=0.1))
        ens.add_member(_MockModel("m2", home=0.4, draw=0.3, away=0.3))
        ens.train({}, cutoff_date=datetime(2024, 9, 1))

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        home = next(r for r in results if r.market == "match_result" and r.outcome == "home")
        assert "ensemble_variance" in home.features_used
        assert home.features_used["ensemble_variance"] > 0


# ═══════════════════════════════════════════════════════════════════════════
# Média ponderada
# ═══════════════════════════════════════════════════════════════════════════

class TestWeightedAverage:
    def test_fallback_inverse_brier(self):
        ens = EnsembleModel(strategy="weighted_average")
        ens.add_member(_MockModel("m1", home=0.7, draw=0.15, away=0.15))
        ens.add_member(_MockModel("m2", home=0.3, draw=0.35, away=0.35))

        report = ens.train(
            {"brier_scores": {"m1": 0.15, "m2": 0.25}},
            cutoff_date=datetime(2024, 9, 1),
        )

        # m1 tem Brier menor → peso maior.
        assert ens.members[0].weight > ens.members[1].weight
        assert report["method"] == "inverse_brier"

    def test_pesos_somam_1(self):
        ens = EnsembleModel(strategy="weighted_average")
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))
        ens.add_member(_MockModel("m3"))

        ens.train(
            {"brier_scores": {"m1": 0.1, "m2": 0.2, "m3": 0.3}},
            cutoff_date=datetime(2024, 9, 1),
        )

        total = sum(m.weight for m in ens.members)
        assert total == pytest.approx(1.0, abs=1e-6)

    def test_log_loss_optimization(self):
        """Com validation_predictions, deve usar otimização por log loss."""
        rng = np.random.default_rng(42)
        n = 100

        # Modelo 1: bom (correlacionado com outcomes).
        outcomes = rng.binomial(1, 0.6, size=n).tolist()
        preds_m1 = [0.7 if o == 1 else 0.3 for o in outcomes]
        # Modelo 2: ruim (quase aleatório).
        preds_m2 = rng.uniform(0.3, 0.7, size=n).tolist()

        ens = EnsembleModel(strategy="weighted_average")
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))

        report = ens.train(
            {
                "validation_predictions": [
                    {"model_name": "m1", "predictions": preds_m1, "outcomes": outcomes},
                    {"model_name": "m2", "predictions": preds_m2, "outcomes": outcomes},
                ]
            },
            cutoff_date=datetime(2024, 9, 1),
        )

        assert report["method"] == "log_loss_optimization"
        # Modelo bom deve ter peso maior.
        assert ens.members[0].weight > ens.members[1].weight

    def test_predicao_ponderada(self):
        ens = EnsembleModel(strategy="weighted_average")
        ens.add_member(_MockModel("m1", home=0.8, draw=0.1, away=0.1))
        ens.add_member(_MockModel("m2", home=0.4, draw=0.3, away=0.3))
        ens.train(
            {"brier_scores": {"m1": 0.1, "m2": 0.3}},
            cutoff_date=datetime(2024, 9, 1),
        )

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        mr = {r.outcome: r.probability for r in results if r.market == "match_result"}

        # m1 tem peso ~3x maior que m2, então home deve ser > 0.5.
        assert mr["home"] > 0.5
        assert sum(mr.values()) == pytest.approx(1.0, abs=1e-6)


# ═══════════════════════════════════════════════════════════════════════════
# Stacking
# ═══════════════════════════════════════════════════════════════════════════

class TestStacking:
    def test_treino_binario(self):
        """Stacking binário: meta-modelo aprende sobre predições escalares."""
        rng = np.random.default_rng(42)
        n = 200
        outcomes = rng.binomial(1, 0.5, size=n).tolist()
        preds_m1 = [0.7 if o == 1 else 0.3 for o in outcomes]
        preds_m2 = rng.uniform(0.2, 0.8, size=n).tolist()

        ens = EnsembleModel(strategy="stacking")
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))

        report = ens.train(
            {
                "validation_predictions": [
                    {"model_name": "m1", "predictions": preds_m1, "outcomes": outcomes},
                    {"model_name": "m2", "predictions": preds_m2, "outcomes": outcomes},
                ]
            },
            cutoff_date=datetime(2024, 9, 1),
        )

        assert report["method"] == "logistic_regression_stacking"
        assert report["n_members"] == 2
        assert ens._stacking_model is not None

    def test_treino_multiclasse(self):
        """Stacking multiclasse: meta-modelo com predições [p0, p1, p2] por membro."""
        rng = np.random.default_rng(42)
        n = 200
        outcomes = rng.choice([0, 1, 2], size=n, p=[0.45, 0.25, 0.30]).tolist()

        # Predições como vetores de 3 probs.
        preds_m1 = []
        preds_m2 = []
        for o in outcomes:
            p = rng.dirichlet([1, 1, 1])
            p[o] += 0.3  # sinal informativo
            p /= p.sum()
            preds_m1.append(p.tolist())

            p2 = rng.dirichlet([1, 1, 1])
            preds_m2.append(p2.tolist())

        ens = EnsembleModel(strategy="stacking")
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))

        report = ens.train(
            {
                "validation_predictions": [
                    {"model_name": "m1", "predictions": preds_m1, "outcomes": outcomes},
                    {"model_name": "m2", "predictions": preds_m2, "outcomes": outcomes},
                ]
            },
            cutoff_date=datetime(2024, 9, 1),
        )

        assert report["method"] == "logistic_regression_stacking"
        assert report["n_features"] == 6  # 2 membros × 3 classes

    def test_predicao_stacking(self):
        """Predição via stacking deve retornar probabilidades válidas."""
        rng = np.random.default_rng(42)
        n = 200
        outcomes = rng.binomial(1, 0.5, size=n).tolist()
        preds_m1 = [0.7 if o == 1 else 0.3 for o in outcomes]
        preds_m2 = rng.uniform(0.2, 0.8, size=n).tolist()

        ens = EnsembleModel(strategy="stacking")
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))
        ens.train(
            {
                "validation_predictions": [
                    {"model_name": "m1", "predictions": preds_m1, "outcomes": outcomes},
                    {"model_name": "m2", "predictions": preds_m2, "outcomes": outcomes},
                ]
            },
            cutoff_date=datetime(2024, 9, 1),
        )

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        assert len(results) > 0
        for r in results:
            assert 0 <= r.probability <= 1

    def test_stacking_sem_dados_levanta_erro(self):
        ens = EnsembleModel(strategy="stacking")
        ens.add_member(_MockModel("m1"))
        with pytest.raises(ValueError, match="validation_predictions"):
            ens.train({}, cutoff_date=datetime(2024, 9, 1))

    def test_stacking_nao_treinado(self):
        ens = EnsembleModel(strategy="stacking")
        ens.add_member(_MockModel("m1"))
        with pytest.raises(RuntimeError, match="não treinado"):
            ens.predict(_event(), as_of=datetime(2024, 10, 1))


# ═══════════════════════════════════════════════════════════════════════════
# Ajuste dinâmico de pesos
# ═══════════════════════════════════════════════════════════════════════════

class TestDynamicAdjustment:
    def test_modelo_ruim_peso_reduzido(self):
        ens = EnsembleModel(strategy="weighted_average", kappa=2.0)
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))

        # Pesos iniciais iguais.
        for m in ens.members:
            m.weight = 0.5

        weights = ens.adjust_weights_dynamic(
            recent_log_losses={"m1": 0.5, "m2": 1.5}
        )

        # m1 tem log loss menor → peso maior após ajuste.
        assert weights["m1"] > weights["m2"]

    def test_pesos_somam_1_apos_ajuste(self):
        ens = EnsembleModel(strategy="weighted_average", kappa=1.0)
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))
        ens.add_member(_MockModel("m3"))

        for m in ens.members:
            m.weight = 1.0 / 3

        weights = ens.adjust_weights_dynamic(
            recent_log_losses={"m1": 0.3, "m2": 0.8, "m3": 1.2}
        )

        assert sum(weights.values()) == pytest.approx(1.0, abs=1e-6)

    def test_kappa_zero_sem_ajuste(self):
        """κ = 0 → exp(0) = 1 para todos → pesos inalterados."""
        ens = EnsembleModel(strategy="weighted_average", kappa=0.0)
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))

        for m in ens.members:
            m.weight = 0.5

        weights = ens.adjust_weights_dynamic(
            recent_log_losses={"m1": 0.5, "m2": 1.5}
        )

        assert weights["m1"] == pytest.approx(0.5, abs=1e-6)
        assert weights["m2"] == pytest.approx(0.5, abs=1e-6)


# ═══════════════════════════════════════════════════════════════════════════
# Incerteza do ensemble
# ═══════════════════════════════════════════════════════════════════════════

class TestEnsembleUncertainty:
    def test_concordancia_zero_variancia(self):
        """Modelos concordando → variância = 0."""
        var = EnsembleModel.compute_ensemble_uncertainty(
            member_probs=[0.5, 0.5, 0.5],
            weights=[1, 1, 1],
        )
        assert var == pytest.approx(0.0, abs=1e-10)

    def test_discordancia_alta_variancia(self):
        """Modelos discordando → variância > 0."""
        var = EnsembleModel.compute_ensemble_uncertainty(
            member_probs=[0.9, 0.1, 0.5],
            weights=[1, 1, 1],
        )
        assert var > 0.05

    def test_pesos_iguais_vs_desiguais(self):
        """Variância ponderada respeita os pesos."""
        var_equal = EnsembleModel.compute_ensemble_uncertainty(
            member_probs=[0.8, 0.2],
            weights=[1, 1],
        )
        # Com peso desigual (primeiro pesa muito mais), variância menor
        # porque o ensemble é dominado pelo primeiro modelo.
        var_unequal = EnsembleModel.compute_ensemble_uncertainty(
            member_probs=[0.8, 0.2],
            weights=[10, 1],
        )
        assert var_unequal < var_equal

    def test_listas_vazias(self):
        var = EnsembleModel.compute_ensemble_uncertainty([], [])
        assert var == 0.0


# ═══════════════════════════════════════════════════════════════════════════
# Testes gerais do EnsembleModel
# ═══════════════════════════════════════════════════════════════════════════

class TestEnsembleGeneral:
    def test_sem_membros_levanta_erro(self):
        ens = EnsembleModel()
        with pytest.raises(RuntimeError, match="sem membros"):
            ens.predict(_event(), as_of=datetime(2024, 10, 1))

    def test_leakage_rejeitado(self):
        ens = EnsembleModel()
        ens.add_member(_MockModel("m1"))
        ens.train({}, cutoff_date=datetime(2024, 9, 1))

        event = {
            "home_team_id": "A",
            "away_team_id": "B",
            "kickoff_at": datetime(2024, 10, 1),
            "result_confirmed_at": datetime(2024, 10, 5),
        }
        with pytest.raises(ValueError, match="posterior a as_of"):
            ens.predict(event, as_of=datetime(2024, 10, 1))

    def test_get_params_completo(self):
        ens = EnsembleModel(strategy="weighted_average", kappa=2.0)
        ens.add_member(_MockModel("m1"))
        ens.add_member(_MockModel("m2"))
        ens.train(
            {"brier_scores": {"m1": 0.1, "m2": 0.2}},
            cutoff_date=datetime(2024, 9, 1),
        )

        params = ens.get_params()
        assert params["strategy"] == "weighted_average"
        assert params["kappa"] == 2.0
        assert len(params["members"]) == 2
        assert params["trained_at"] is not None
        assert params["members"][0]["name"] == "m1"
        assert params["members"][0]["weight"] > 0

    def test_version_2(self):
        ens = EnsembleModel()
        assert ens.version == "2.0.0"

    def test_add_member(self):
        ens = EnsembleModel()
        m = _MockModel("m1")
        ens.add_member(m, weight=2.0)
        assert len(ens.members) == 1
        assert ens.members[0].weight == 2.0
        assert ens.members[0].model is m

    def test_probabilidades_no_intervalo(self):
        ens = EnsembleModel()
        ens.add_member(_MockModel("m1", home=0.9, draw=0.05, away=0.05))
        ens.add_member(_MockModel("m2", home=0.1, draw=0.45, away=0.45))
        ens.train({}, cutoff_date=datetime(2024, 9, 1))

        results = ens.predict(_event(), as_of=datetime(2024, 10, 1))
        for r in results:
            assert 0 <= r.probability <= 1, f"{r.market}/{r.outcome}: {r.probability}"
