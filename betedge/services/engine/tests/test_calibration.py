"""Testes dos calibradores pós-hoc e do CalibratedModel.

Cobre:
  - PlattScaling: fit, transform, identidade, overconfidence/underconfidence.
  - IsotonicCalibrator: fit, transform, monotonicidade.
  - TemperatureScaling: fit, transform, T>1 suaviza, T<1 aguça, T=1 identidade.
  - MulticlassCalibrator: fit, transform, soma = 1.
  - CalibratedModel: wrapper sobre modelo-base, calibração pós-hoc.
"""
from datetime import datetime, timedelta

import numpy as np
import pytest

from app.calibration.calibrators import (
    BaseCalibrator,
    IsotonicCalibrator,
    MulticlassCalibrator,
    PlattScaling,
    TemperatureScaling,
)
from app.calibration.calibrated_model import CalibratedModel
from app.models.base import BaseModel, PredictionResult


# ═══════════════════════════════════════════════════════════════════════════
# Dados sintéticos para calibração
# ═══════════════════════════════════════════════════════════════════════════

def _make_overconfident_data(n: int = 200, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """Gera predições overconfident: modelo diz 80% mas evento ocorre ~55% das vezes."""
    rng = np.random.default_rng(seed)
    # Probabilidades brutas concentradas em [0.6, 0.9] (overconfident)
    preds = rng.uniform(0.6, 0.9, size=n)
    # Outcomes reais: a taxa real é ~55%, não 75%.
    outcomes = rng.binomial(1, 0.55, size=n).astype(np.float64)
    return preds, outcomes


def _make_calibrated_data(n: int = 200, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """Gera predições já calibradas: prob predita ≈ freq observada."""
    rng = np.random.default_rng(seed)
    preds = rng.uniform(0.1, 0.9, size=n)
    outcomes = rng.binomial(1, preds).astype(np.float64)
    return preds, outcomes


def _make_multiclass_data(
    n: int = 300, seed: int = 42
) -> tuple[np.ndarray, np.ndarray]:
    """Gera dados multiclasse (3 vias) com descalibração."""
    rng = np.random.default_rng(seed)
    # Probabilidades brutas (overconfident no favorito).
    raw = rng.dirichlet([3, 1, 1], size=n)
    # Labels reais: distribuição mais equilibrada.
    labels = rng.choice([0, 1, 2], size=n, p=[0.45, 0.25, 0.30])
    return raw.astype(np.float64), labels.astype(np.int32)


# ═══════════════════════════════════════════════════════════════════════════
# Modelo mock para testes do CalibratedModel
# ═══════════════════════════════════════════════════════════════════════════

class _MockModel(BaseModel):
    """Modelo mock que retorna probabilidades fixas, controlável nos testes."""

    name = "mock"
    version = "1.0.0"

    def __init__(self, probs: dict[str, float] | None = None) -> None:
        self._probs = probs or {"home": 0.75, "draw": 0.15, "away": 0.10}
        self._trained = False

    def train(self, training_data, cutoff_date: datetime) -> dict:
        self._trained = True
        return {"n_samples": 100}

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        return [
            PredictionResult(market="match_result", outcome=k, probability=v,
                             features_used={"mock": True} if k == "home" else None)
            for k, v in self._probs.items()
        ]

    def get_params(self) -> dict:
        return {"probs": self._probs}


# ═══════════════════════════════════════════════════════════════════════════
# Testes do PlattScaling
# ═══════════════════════════════════════════════════════════════════════════

class TestPlattScaling:
    def test_fit_e_transform(self):
        preds, outcomes = _make_overconfident_data()
        cal = PlattScaling()
        cal.fit(preds, outcomes)
        calibrated = cal.transform(preds)

        assert len(calibrated) == len(preds)
        assert all(0 <= p <= 1 for p in calibrated)

    def test_overconfidence_corrigida(self):
        """Platt deve reduzir probabilidades overconfident mais perto da freq real."""
        preds, outcomes = _make_overconfident_data()
        cal = PlattScaling()
        cal.fit(preds, outcomes)
        calibrated = cal.transform(preds)

        # Média das predições calibradas deve ser mais baixa que as brutas.
        assert np.mean(calibrated) < np.mean(preds)

    def test_modelo_calibrado_pouca_mudanca(self):
        """Se o modelo já está calibrado, Platt não deve distorcer muito."""
        preds, outcomes = _make_calibrated_data(n=500)
        cal = PlattScaling()
        cal.fit(preds, outcomes)
        calibrated = cal.transform(preds)

        # a ≈ 1, b ≈ 0 → transformação próxima da identidade.
        diff = np.abs(calibrated - preds)
        assert np.mean(diff) < 0.1

    def test_parametros_aprendidos(self):
        preds, outcomes = _make_overconfident_data()
        cal = PlattScaling()
        cal.fit(preds, outcomes)
        params = cal.get_params()

        assert params["method"] == "platt_scaling"
        assert params["fitted"] is True
        assert isinstance(params["a"], float)
        assert isinstance(params["b"], float)

    def test_transform_sem_fit(self):
        cal = PlattScaling()
        with pytest.raises(RuntimeError, match="não ajustado"):
            cal.transform(np.array([0.5]))

    def test_poucas_amostras(self):
        with pytest.raises(ValueError, match="pelo menos 5"):
            PlattScaling().fit(np.array([0.5, 0.6]), np.array([1.0, 0.0]))

    def test_fit_transform_atalho(self):
        preds, outcomes = _make_overconfident_data()
        cal = PlattScaling()
        result = cal.fit_transform(preds, outcomes)
        assert len(result) == len(preds)
        assert cal._fitted


# ═══════════════════════════════════════════════════════════════════════════
# Testes do IsotonicCalibrator
# ═══════════════════════════════════════════════════════════════════════════

class TestIsotonicCalibrator:
    def test_fit_e_transform(self):
        preds, outcomes = _make_overconfident_data(n=300)
        cal = IsotonicCalibrator()
        cal.fit(preds, outcomes)
        calibrated = cal.transform(preds)

        assert len(calibrated) == len(preds)
        assert all(0 <= p <= 1 for p in calibrated)

    def test_monotonicidade(self):
        """Isotonic deve preservar a ordenação das probabilidades."""
        preds, outcomes = _make_overconfident_data(n=300)
        cal = IsotonicCalibrator()
        cal.fit(preds, outcomes)

        # Aplica a um vetor monotonicamente crescente.
        test_input = np.linspace(0.1, 0.9, 50)
        calibrated = cal.transform(test_input)

        # Resultado deve ser monotonicamente não-decrescente.
        for i in range(1, len(calibrated)):
            assert calibrated[i] >= calibrated[i - 1] - 1e-10

    def test_transform_sem_fit(self):
        cal = IsotonicCalibrator()
        with pytest.raises(RuntimeError, match="não ajustado"):
            cal.transform(np.array([0.5]))

    def test_poucas_amostras(self):
        with pytest.raises(ValueError, match="pelo menos 10"):
            IsotonicCalibrator().fit(np.array([0.5]), np.array([1.0]))

    def test_out_of_bounds_clipped(self):
        """Valores fora do range de treino devem ser clippados."""
        preds = np.array([0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.3, 0.4, 0.5, 0.6])
        outcomes = np.array([0, 0, 1, 0, 1, 1, 1, 0, 1, 1], dtype=np.float64)

        cal = IsotonicCalibrator()
        cal.fit(preds, outcomes)

        # Extrapola para fora do range.
        test = np.array([0.0, 0.1, 0.95, 1.0])
        result = cal.transform(test)
        assert all(0 <= p <= 1 for p in result)


# ═══════════════════════════════════════════════════════════════════════════
# Testes do TemperatureScaling
# ═══════════════════════════════════════════════════════════════════════════

class TestTemperatureScaling:
    def test_fit_e_transform(self):
        preds, outcomes = _make_overconfident_data()
        cal = TemperatureScaling()
        cal.fit(preds, outcomes)
        calibrated = cal.transform(preds)

        assert len(calibrated) == len(preds)
        assert all(0 <= p <= 1 for p in calibrated)

    def test_overconfidence_temperatura_sobe(self):
        """Modelo overconfident → T > 1 (suaviza as probabilidades)."""
        preds, outcomes = _make_overconfident_data()
        cal = TemperatureScaling()
        cal.fit(preds, outcomes)

        assert cal.temperature > 1.0

    def test_temperatura_1_identidade(self):
        """T = 1 deve ser (aproximadamente) a transformação identidade."""
        cal = TemperatureScaling()
        cal.temperature = 1.0
        cal._fitted = True

        test = np.array([0.1, 0.3, 0.5, 0.7, 0.9])
        result = cal.transform(test)
        np.testing.assert_allclose(result, test, atol=1e-10)

    def test_temperatura_alta_suaviza(self):
        """T > 1 → probabilidades mais perto de 0.5."""
        cal = TemperatureScaling()
        cal.temperature = 3.0
        cal._fitted = True

        test = np.array([0.1, 0.9])
        result = cal.transform(test)
        assert result[0] > 0.1  # moveu para cima (mais perto de 0.5)
        assert result[1] < 0.9  # moveu para baixo (mais perto de 0.5)

    def test_temperatura_baixa_aguça(self):
        """T < 1 → probabilidades mais extremas."""
        cal = TemperatureScaling()
        cal.temperature = 0.3
        cal._fitted = True

        test = np.array([0.3, 0.7])
        result = cal.transform(test)
        assert result[0] < 0.3  # moveu para baixo (mais extremo)
        assert result[1] > 0.7  # moveu para cima (mais extremo)

    def test_parametros(self):
        preds, outcomes = _make_overconfident_data()
        cal = TemperatureScaling()
        cal.fit(preds, outcomes)
        params = cal.get_params()

        assert params["method"] == "temperature_scaling"
        assert params["fitted"] is True
        assert params["temperature"] > 0

    def test_transform_sem_fit(self):
        cal = TemperatureScaling()
        with pytest.raises(RuntimeError, match="não ajustado"):
            cal.transform(np.array([0.5]))


# ═══════════════════════════════════════════════════════════════════════════
# Testes do MulticlassCalibrator
# ═══════════════════════════════════════════════════════════════════════════

class TestMulticlassCalibrator:
    def test_fit_e_transform(self):
        probs, labels = _make_multiclass_data()
        cal = MulticlassCalibrator(PlattScaling)
        cal.fit(probs, labels)
        calibrated = cal.transform(probs)

        assert calibrated.shape == probs.shape
        assert all(0 <= p <= 1 for row in calibrated for p in row)

    def test_soma_1(self):
        """Probabilidades calibradas devem somar 1 por amostra."""
        probs, labels = _make_multiclass_data()
        cal = MulticlassCalibrator(PlattScaling)
        cal.fit(probs, labels)
        calibrated = cal.transform(probs)

        row_sums = calibrated.sum(axis=1)
        np.testing.assert_allclose(row_sums, 1.0, atol=1e-6)

    def test_com_isotonic(self):
        probs, labels = _make_multiclass_data(n=500)
        cal = MulticlassCalibrator(IsotonicCalibrator)
        cal.fit(probs, labels)
        calibrated = cal.transform(probs)

        row_sums = calibrated.sum(axis=1)
        np.testing.assert_allclose(row_sums, 1.0, atol=1e-6)

    def test_com_temperature(self):
        probs, labels = _make_multiclass_data()
        cal = MulticlassCalibrator(TemperatureScaling)
        cal.fit(probs, labels)
        calibrated = cal.transform(probs)

        row_sums = calibrated.sum(axis=1)
        np.testing.assert_allclose(row_sums, 1.0, atol=1e-6)

    def test_parametros(self):
        probs, labels = _make_multiclass_data()
        cal = MulticlassCalibrator(PlattScaling)
        cal.fit(probs, labels)
        params = cal.get_params()

        assert params["method"] == "multiclass_one_vs_all"
        assert params["n_classes"] == 3
        assert params["calibrator_type"] == "PlattScaling"
        assert len(params["per_class_params"]) == 3

    def test_transform_sem_fit(self):
        cal = MulticlassCalibrator(PlattScaling)
        with pytest.raises(RuntimeError, match="não ajustado"):
            cal.transform(np.array([[0.5, 0.3, 0.2]]))


# ═══════════════════════════════════════════════════════════════════════════
# Testes do CalibratedModel
# ═══════════════════════════════════════════════════════════════════════════

class TestCalibratedModel:
    def _make_validation_data(self, n: int = 50, seed: int = 42):
        """Cria eventos de validação, outcomes e as_of para fit_calibration."""
        rng = np.random.default_rng(seed)
        base_date = datetime(2024, 6, 1)

        events = []
        outcomes = []
        as_of_dates = []

        for i in range(n):
            event = {
                "home_team_id": "A",
                "away_team_id": "B",
                "kickoff_at": base_date + timedelta(days=i),
            }
            events.append(event)
            as_of_dates.append(base_date + timedelta(days=i))

            # Outcome: home ganha com ~55% (model diz 75% → overconfident)
            if rng.random() < 0.55:
                outcomes.append({"home": 1, "draw": 0, "away": 0})
            elif rng.random() < 0.5:
                outcomes.append({"home": 0, "draw": 1, "away": 0})
            else:
                outcomes.append({"home": 0, "draw": 0, "away": 1})

        return events, outcomes, as_of_dates

    def test_calibrated_model_basico(self):
        mock = _MockModel()
        cal_model = CalibratedModel(mock, calibrator_type="platt")

        events, outcomes, as_of_dates = self._make_validation_data()
        cal_model.fit_calibration(events, outcomes, as_of_dates)

        event = {"home_team_id": "A", "away_team_id": "B",
                 "kickoff_at": datetime(2024, 8, 1)}
        results = cal_model.predict(event, as_of=datetime(2024, 8, 1))

        assert len(results) > 0
        for r in results:
            assert 0 <= r.probability <= 1

    def test_soma_1_apos_calibracao(self):
        mock = _MockModel()
        cal_model = CalibratedModel(mock, calibrator_type="platt")

        events, outcomes, as_of_dates = self._make_validation_data()
        cal_model.fit_calibration(events, outcomes, as_of_dates)

        event = {"home_team_id": "A", "away_team_id": "B",
                 "kickoff_at": datetime(2024, 8, 1)}
        results = cal_model.predict(event, as_of=datetime(2024, 8, 1))

        mr = [r for r in results if r.market == "match_result"]
        assert sum(r.probability for r in mr) == pytest.approx(1.0, abs=1e-4)

    def test_train_delega_para_base(self):
        mock = _MockModel()
        cal_model = CalibratedModel(mock, calibrator_type="platt")
        report = cal_model.train([], cutoff_date=datetime(2024, 1, 1))
        assert report["n_samples"] == 100
        assert mock._trained

    def test_sem_calibracao_retorna_bruto(self):
        """Se fit_calibration não foi chamado, predict retorna probabilidades brutas."""
        mock = _MockModel()
        cal_model = CalibratedModel(mock, calibrator_type="platt")

        event = {"home_team_id": "A", "away_team_id": "B",
                 "kickoff_at": datetime(2024, 8, 1)}
        results = cal_model.predict(event, as_of=datetime(2024, 8, 1))

        probs = {r.outcome: r.probability for r in results if r.market == "match_result"}
        assert probs["home"] == pytest.approx(0.75, abs=1e-6)

    def test_get_params_inclui_calibracao(self):
        mock = _MockModel()
        cal_model = CalibratedModel(mock, calibrator_type="temperature")

        events, outcomes, as_of_dates = self._make_validation_data()
        cal_model.fit_calibration(events, outcomes, as_of_dates)

        params = cal_model.get_params()
        assert params["calibrator_type"] == "temperature"
        assert params["calibration_fitted"] is True
        assert params["calibrated_at"] is not None
        assert "base_model" in params

    def test_calibrador_invalido(self):
        mock = _MockModel()
        with pytest.raises(ValueError, match="não reconhecido"):
            CalibratedModel(mock, calibrator_type="fantasia")

    def test_poucas_amostras_validacao(self):
        mock = _MockModel()
        cal_model = CalibratedModel(mock, calibrator_type="platt")
        with pytest.raises(ValueError, match="(?i)pelo menos 5"):
            cal_model.fit_calibration([], [], [])

    def test_isotonic_calibrator_type(self):
        mock = _MockModel()
        cal_model = CalibratedModel(mock, calibrator_type="isotonic")

        events, outcomes, as_of_dates = self._make_validation_data(n=100)
        cal_model.fit_calibration(events, outcomes, as_of_dates)

        event = {"home_team_id": "A", "away_team_id": "B",
                 "kickoff_at": datetime(2024, 8, 1)}
        results = cal_model.predict(event, as_of=datetime(2024, 8, 1))
        assert len(results) > 0
