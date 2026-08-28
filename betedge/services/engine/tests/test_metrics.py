"""Testes unitários das métricas de avaliação (`app.metrics.brier`, `app.metrics.calibration`)."""
import pytest

from app.metrics.brier import brier_decomposition, brier_score, brier_skill_score
from app.metrics.calibration import (
    expected_calibration_error,
    maximum_calibration_error,
    reliability_curve,
)


class TestBrierScore:
    def test_perfect_predictions(self):
        # Predição 1.0 para outcome 1 e 0.0 para outcome 0: erro zero.
        predictions = [1.0, 0.0, 1.0, 0.0]
        outcomes = [1, 0, 1, 0]
        assert brier_score(predictions, outcomes) == pytest.approx(0.0)

    def test_worst_case_predictions(self):
        # Predição 1.0 para o que não acontece e 0.0 para o que acontece: erro máximo (1.0).
        predictions = [1.0, 0.0]
        outcomes = [0, 1]
        assert brier_score(predictions, outcomes) == pytest.approx(1.0)

    def test_always_50_50(self):
        # Prever sempre 50% dá Brier Score de 0.25, independente do resultado real.
        predictions = [0.5, 0.5, 0.5, 0.5]
        outcomes = [1, 0, 1, 0]
        assert brier_score(predictions, outcomes) == pytest.approx(0.25)

    def test_known_value(self):
        # BS = mean((p-o)^2) = mean([(0.7-1)^2, (0.2-0)^2]) = mean([0.09, 0.04]) = 0.065
        predictions = [0.7, 0.2]
        outcomes = [1, 0]
        assert brier_score(predictions, outcomes) == pytest.approx(0.065)

    def test_rejects_mismatched_lengths(self):
        with pytest.raises(ValueError):
            brier_score([0.5, 0.5], [1])

    def test_rejects_empty(self):
        with pytest.raises(ValueError):
            brier_score([], [])

    def test_rejects_invalid_probability(self):
        with pytest.raises(ValueError):
            brier_score([1.5], [1])

    def test_rejects_invalid_outcome(self):
        with pytest.raises(ValueError):
            brier_score([0.5], [2])


class TestBrierSkillScore:
    def test_model_better_than_baseline(self):
        predictions = [0.9, 0.1, 0.9, 0.1]
        outcomes = [1, 0, 1, 0]
        bss = brier_skill_score(predictions, outcomes, baseline=0.5)
        assert bss > 0.0

    def test_model_equal_to_baseline(self):
        predictions = [0.5, 0.5, 0.5, 0.5]
        outcomes = [1, 0, 1, 0]
        bss = brier_skill_score(predictions, outcomes, baseline=0.5)
        assert bss == pytest.approx(0.0)

    def test_model_worse_than_baseline(self):
        predictions = [0.1, 0.9, 0.1, 0.9]  # sempre errado
        outcomes = [1, 0, 1, 0]
        bss = brier_skill_score(predictions, outcomes, baseline=0.5)
        assert bss < 0.0

    def test_baseline_as_sequence(self):
        predictions = [0.9, 0.1]
        outcomes = [1, 0]
        baseline = [0.5, 0.5]
        bss_seq = brier_skill_score(predictions, outcomes, baseline=baseline)
        bss_float = brier_skill_score(predictions, outcomes, baseline=0.5)
        assert bss_seq == pytest.approx(bss_float)


class TestBrierDecomposition:
    def test_decomposition_reconstructs_brier_score(self):
        # A identidade BS = reliability - resolution + uncertainty é exata
        # quando todas as predições dentro de um mesmo bin são idênticas
        # (o caso de forecasts já discretizados) — por isso usamos aqui dois
        # grupos de predições constantes (0.1 e 0.6) em vez de valores
        # arbitrários espalhados por um mesmo bin, o que introduziria um
        # termo de variância intra-bin não capturado pela decomposição de Murphy.
        predictions = [0.1, 0.1, 0.1, 0.1, 0.6, 0.6, 0.6, 0.6]
        outcomes = [0, 0, 1, 0, 1, 1, 0, 1]
        reliability, resolution, uncertainty = brier_decomposition(predictions, outcomes, n_bins=10)
        reconstructed = reliability - resolution + uncertainty
        assert reconstructed == pytest.approx(brier_score(predictions, outcomes), abs=1e-9)

    def test_uncertainty_matches_base_rate_variance(self):
        outcomes = [1, 1, 0, 0]  # taxa-base = 0.5
        predictions = [0.5, 0.5, 0.5, 0.5]
        _, _, uncertainty = brier_decomposition(predictions, outcomes, n_bins=10)
        assert uncertainty == pytest.approx(0.5 * 0.5)

    def test_perfectly_calibrated_predictions_have_zero_reliability(self):
        # Duas predições de 1.0 (ambas acertam) e duas de 0.0 (ambas erram):
        # cada bin tem frequência observada idêntica à predita -> reliability = 0.
        predictions = [1.0, 1.0, 0.0, 0.0]
        outcomes = [1, 1, 0, 0]
        reliability, _, _ = brier_decomposition(predictions, outcomes, n_bins=2)
        assert reliability == pytest.approx(0.0)

    def test_rejects_invalid_n_bins(self):
        with pytest.raises(ValueError):
            brier_decomposition([0.5], [1], n_bins=0)


class TestCalibrationErrors:
    def test_perfect_calibration_has_zero_ece(self):
        # Em cada bin, a fração observada bate exatamente com a probabilidade predita.
        predictions = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
        outcomes = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]  # 1 em 10 -> frequência observada 0.1
        ece = expected_calibration_error(predictions, outcomes, n_bins=10)
        assert ece == pytest.approx(0.0, abs=1e-9)

    def test_perfect_calibration_has_zero_mce(self):
        predictions = [0.1] * 10
        outcomes = [1] + [0] * 9
        mce = maximum_calibration_error(predictions, outcomes, n_bins=10)
        assert mce == pytest.approx(0.0, abs=1e-9)

    def test_worst_case_calibration_maximizes_error(self):
        # Modelo sempre prevê 100% mas nunca acontece: ECE e MCE devem ser 1.0.
        predictions = [1.0, 1.0, 1.0, 1.0]
        outcomes = [0, 0, 0, 0]
        assert expected_calibration_error(predictions, outcomes, n_bins=10) == pytest.approx(1.0)
        assert maximum_calibration_error(predictions, outcomes, n_bins=10) == pytest.approx(1.0)

    def test_mce_is_always_greater_or_equal_to_ece(self):
        predictions = [0.05, 0.15, 0.55, 0.95, 0.5, 0.3]
        outcomes = [0, 1, 1, 1, 0, 0]
        ece = expected_calibration_error(predictions, outcomes, n_bins=5)
        mce = maximum_calibration_error(predictions, outcomes, n_bins=5)
        assert mce >= ece - 1e-9

    def test_rejects_mismatched_lengths(self):
        with pytest.raises(ValueError):
            expected_calibration_error([0.5, 0.5], [1], n_bins=5)


class TestReliabilityCurve:
    def test_returns_parallel_lists_of_equal_length(self):
        predictions = [0.05, 0.15, 0.55, 0.95, 0.5, 0.3]
        outcomes = [0, 1, 1, 1, 0, 0]
        mean_predicted, fraction_positive = reliability_curve(predictions, outcomes, n_bins=5)
        assert len(mean_predicted) == len(fraction_positive)
        assert len(mean_predicted) > 0

    def test_single_bin_matches_overall_means(self):
        predictions = [0.2, 0.4, 0.6, 0.8]
        outcomes = [0, 0, 1, 1]
        mean_predicted, fraction_positive = reliability_curve(predictions, outcomes, n_bins=1)
        assert mean_predicted == [pytest.approx(sum(predictions) / len(predictions))]
        assert fraction_positive == [pytest.approx(sum(outcomes) / len(outcomes))]

    def test_perfectly_calibrated_curve_lies_on_diagonal(self):
        # Bin baixo: 10% de probabilidade, 1 em 10 aconteceu (10%).
        # Bin alto: 90% de probabilidade, 9 em 10 aconteceram (90%).
        predictions = [0.1] * 10 + [0.9] * 10
        outcomes = ([1] + [0] * 9) + ([1] * 9 + [0])
        mean_predicted, fraction_positive = reliability_curve(predictions, outcomes, n_bins=10)
        for p, f in zip(mean_predicted, fraction_positive, strict=True):
            assert p == pytest.approx(f, abs=1e-9)
