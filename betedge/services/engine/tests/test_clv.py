"""Testes do módulo de CLV (Closing Line Value, app.metrics.clv).

Cobre:
  - calculate_clv: CLV positivo, negativo, validação.
  - aggregate_clv: média, mediana, taxa positiva, desvio-padrão, ponderado.
  - calculate_clv_prob: CLV baseado em probabilidade.
"""
import math

import pytest

from app.metrics.clv import (
    aggregate_clv,
    calculate_clv,
    calculate_clv_prob,
)


class TestCalculateClv:
    def test_positive_clv(self):
        # Odds obtidas (2.50) > fechamento (2.00) → CLV = +25%.
        clv = calculate_clv(prediction_odds=2.50, closing_odds=2.00)
        assert clv == pytest.approx(25.0)

    def test_negative_clv(self):
        # Odds obtidas (1.80) < fechamento (2.00) → CLV = -10%.
        clv = calculate_clv(prediction_odds=1.80, closing_odds=2.00)
        assert clv == pytest.approx(-10.0)

    def test_zero_clv(self):
        # Odds iguais → CLV = 0.
        clv = calculate_clv(prediction_odds=2.00, closing_odds=2.00)
        assert clv == pytest.approx(0.0)

    def test_rejects_bad_odds(self):
        with pytest.raises(ValueError):
            calculate_clv(prediction_odds=1.0, closing_odds=2.0)
        with pytest.raises(ValueError):
            calculate_clv(prediction_odds=2.0, closing_odds=0.5)


class TestAggregateClv:
    def test_basic_aggregation(self):
        pairs = [(2.50, 2.00), (1.80, 2.00), (3.00, 2.80)]
        result = aggregate_clv(pairs)

        assert "mean_clv_pct" in result
        assert "median_clv_pct" in result
        assert "positive_clv_rate" in result
        assert "std_clv_pct" in result
        assert "n_bets" in result
        assert result["n_bets"] == 3.0

    def test_mean_clv(self):
        # CLVs: +25%, -10%, +7.14% → média ≈ 7.38%.
        pairs = [(2.50, 2.00), (1.80, 2.00), (3.00, 2.80)]
        result = aggregate_clv(pairs)
        expected_mean = (25.0 + (-10.0) + (3.00 / 2.80 - 1.0) * 100) / 3
        assert result["mean_clv_pct"] == pytest.approx(expected_mean, abs=0.1)

    def test_positive_clv_rate(self):
        # 2 de 3 são positivos.
        pairs = [(2.50, 2.00), (1.80, 2.00), (3.00, 2.80)]
        result = aggregate_clv(pairs)
        assert result["positive_clv_rate"] == pytest.approx(2 / 3, abs=0.01)

    def test_all_positive(self):
        pairs = [(2.50, 2.00), (3.00, 2.50), (4.00, 3.50)]
        result = aggregate_clv(pairs)
        assert result["positive_clv_rate"] == pytest.approx(1.0)
        assert result["mean_clv_pct"] > 0

    def test_all_negative(self):
        pairs = [(1.80, 2.00), (2.00, 2.50), (3.00, 3.50)]
        result = aggregate_clv(pairs)
        assert result["positive_clv_rate"] == pytest.approx(0.0)
        assert result["mean_clv_pct"] < 0

    def test_single_bet(self):
        result = aggregate_clv([(2.50, 2.00)])
        assert result["n_bets"] == 1.0
        assert result["mean_clv_pct"] == pytest.approx(25.0)
        assert result["median_clv_pct"] == pytest.approx(25.0)
        assert result["std_clv_pct"] == pytest.approx(0.0)

    def test_rejects_empty(self):
        with pytest.raises(ValueError):
            aggregate_clv([])

    def test_weighted_clv(self):
        pairs = [(2.50, 2.00), (1.80, 2.00)]
        stakes = [100.0, 200.0]
        result = aggregate_clv(pairs, stakes=stakes)

        assert "weighted_clv_pct" in result
        # CLVs: +25% (stake 100), -10% (stake 200).
        # Ponderado: (25*100 + (-10)*200) / 300 = 500/300 = 1.67.
        expected = (25.0 * 100 + (-10.0) * 200) / 300
        assert result["weighted_clv_pct"] == pytest.approx(expected, abs=0.1)

    def test_weighted_clv_wrong_size(self):
        with pytest.raises(ValueError):
            aggregate_clv([(2.0, 1.8)], stakes=[100, 200])

    def test_median_even_count(self):
        pairs = [(2.50, 2.00), (1.80, 2.00), (3.00, 2.80), (2.20, 2.10)]
        result = aggregate_clv(pairs)
        # Mediana de 4 valores: média dos dois centrais.
        clvs = sorted([calculate_clv(p, c) for p, c in pairs])
        expected_median = (clvs[1] + clvs[2]) / 2
        assert result["median_clv_pct"] == pytest.approx(expected_median, abs=0.01)

    def test_std_clv(self):
        pairs = [(2.50, 2.00), (1.80, 2.00)]
        result = aggregate_clv(pairs)
        clvs = [calculate_clv(p, c) for p, c in pairs]
        mean = sum(clvs) / len(clvs)
        var = sum((c - mean) ** 2 for c in clvs) / len(clvs)
        assert result["std_clv_pct"] == pytest.approx(math.sqrt(var), abs=0.01)


class TestCalculateClvProb:
    def test_positive_movement(self):
        # Prob subiu: mercado convergiu na direção que o modelo indicava.
        clv = calculate_clv_prob(fair_prob_at_bet=0.45, fair_prob_closing=0.50)
        assert clv == pytest.approx(0.05)

    def test_negative_movement(self):
        clv = calculate_clv_prob(fair_prob_at_bet=0.50, fair_prob_closing=0.45)
        assert clv == pytest.approx(-0.05)

    def test_no_movement(self):
        clv = calculate_clv_prob(fair_prob_at_bet=0.50, fair_prob_closing=0.50)
        assert clv == pytest.approx(0.0)

    def test_rejects_out_of_range(self):
        with pytest.raises(ValueError):
            calculate_clv_prob(fair_prob_at_bet=0.0, fair_prob_closing=0.5)
        with pytest.raises(ValueError):
            calculate_clv_prob(fair_prob_at_bet=0.5, fair_prob_closing=1.0)
