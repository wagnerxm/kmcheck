"""Testes unitários do motor de value bets (`app.value.engine`)."""
import pytest

from app.value.engine import (
    MAX_EXPECTED_EDGE,
    MAX_EXPECTED_EV,
    calculate_edge,
    calculate_edge_score,
    calculate_ev,
    calculate_overround,
    implied_probability,
    remove_vig_multiplicative,
    remove_vig_power,
    remove_vig_shin,
)


class TestImpliedProbability:
    def test_even_money(self):
        # Odds 2.00 ("evens") implicam exatamente 50% de probabilidade.
        assert implied_probability(2.0) == pytest.approx(0.5)

    def test_short_odds(self):
        assert implied_probability(1.25) == pytest.approx(0.8)

    def test_long_odds(self):
        assert implied_probability(10.0) == pytest.approx(0.1)

    def test_rejects_odds_at_or_below_one(self):
        with pytest.raises(ValueError):
            implied_probability(1.0)
        with pytest.raises(ValueError):
            implied_probability(0.5)


class TestOverround:
    def test_no_overround_when_probabilities_sum_to_one(self):
        assert calculate_overround([0.5, 0.5]) == pytest.approx(0.0)

    def test_typical_three_way_market_overround(self):
        # Odds típicas de 1X2: 2.20 / 3.30 / 3.40 -> soma de implícitas > 1.
        implied = [implied_probability(o) for o in (2.20, 3.30, 3.40)]
        overround = calculate_overround(implied)
        assert overround > 0.0
        assert overround == pytest.approx(sum(implied) - 1.0)

    def test_rejects_empty_list(self):
        with pytest.raises(ValueError):
            calculate_overround([])


class TestVigRemoval:
    """Testa os três métodos de remoção de vig com um mercado 1X2 com overround conhecido."""

    RAW_ODDS = (2.20, 3.30, 3.40)

    @pytest.fixture
    def implied(self) -> list[float]:
        return [implied_probability(o) for o in self.RAW_ODDS]

    def test_multiplicative_sums_to_one(self, implied):
        fair = remove_vig_multiplicative(implied)
        assert sum(fair) == pytest.approx(1.0, abs=1e-9)
        assert len(fair) == len(implied)

    def test_multiplicative_preserves_relative_order(self, implied):
        fair = remove_vig_multiplicative(implied)
        # A remoção de vig não deve inverter a ordem de favoritismo: se o
        # resultado i era mais provável que o j antes, continua sendo depois.
        for i in range(len(implied)):
            for j in range(len(implied)):
                assert (implied[i] > implied[j]) == (fair[i] > fair[j])

    def test_multiplicative_known_values(self):
        # Duas probabilidades implícitas iguais devem seguir iguais após normalização.
        fair = remove_vig_multiplicative([0.55, 0.55])
        assert fair[0] == pytest.approx(0.5)
        assert fair[1] == pytest.approx(0.5)

    def test_power_method_sums_to_one(self, implied):
        fair = remove_vig_power(implied)
        assert sum(fair) == pytest.approx(1.0, abs=1e-6)

    def test_power_method_no_overround_is_noop(self):
        # Sem overround, o método da potência deve devolver as próprias probabilidades.
        fair = remove_vig_power([0.5, 0.5])
        assert fair[0] == pytest.approx(0.5, abs=1e-6)
        assert fair[1] == pytest.approx(0.5, abs=1e-6)

    def test_power_method_rejects_out_of_range(self):
        with pytest.raises(ValueError):
            remove_vig_power([1.0, 0.5])
        with pytest.raises(ValueError):
            remove_vig_power([0.0, 0.5])

    def test_shin_method_sums_to_one(self, implied):
        fair = remove_vig_shin(implied)
        assert sum(fair) == pytest.approx(1.0, abs=1e-6)

    def test_shin_method_no_overround_returns_normalized(self):
        fair = remove_vig_shin([0.5, 0.5])
        assert sum(fair) == pytest.approx(1.0, abs=1e-9)

    def test_all_methods_agree_within_tolerance_on_balanced_market(self, implied):
        # Os três métodos devem concordar aproximadamente em mercados com
        # pouco overround e favoritismo moderado (divergem mais em mercados
        # com overround alto e forte assimetria entre favoritos/azarões).
        m = remove_vig_multiplicative(implied)
        p = remove_vig_power(implied)
        s = remove_vig_shin(implied)
        for i in range(len(implied)):
            assert m[i] == pytest.approx(p[i], abs=0.02)
            assert m[i] == pytest.approx(s[i], abs=0.02)


class TestEdgeAndEV:
    def test_calculate_edge_positive(self):
        assert calculate_edge(model_prob=0.55, fair_market_prob=0.50) == pytest.approx(0.05)

    def test_calculate_edge_negative(self):
        assert calculate_edge(model_prob=0.40, fair_market_prob=0.50) == pytest.approx(-0.10)

    def test_calculate_edge_rejects_out_of_range(self):
        with pytest.raises(ValueError):
            calculate_edge(model_prob=1.5, fair_market_prob=0.5)
        with pytest.raises(ValueError):
            calculate_edge(model_prob=0.5, fair_market_prob=-0.1)

    def test_calculate_ev_breakeven(self):
        # Com odds "justas" (sem vig) exatamente iguais à probabilidade real, EV = 0.
        assert calculate_ev(model_prob=0.5, decimal_odds=2.0) == pytest.approx(0.0)

    def test_calculate_ev_positive(self):
        # Modelo acredita em 60%, mas as odds pagam como se fosse 50% (odds 2.00) -> EV positivo.
        ev = calculate_ev(model_prob=0.6, decimal_odds=2.0)
        assert ev == pytest.approx(0.2)

    def test_calculate_ev_negative(self):
        ev = calculate_ev(model_prob=0.4, decimal_odds=2.0)
        assert ev == pytest.approx(-0.2)

    def test_calculate_ev_rejects_bad_odds(self):
        with pytest.raises(ValueError):
            calculate_ev(model_prob=0.5, decimal_odds=1.0)


class TestEdgeScore:
    def test_edge_score_within_bounds_for_typical_input(self):
        score = calculate_edge_score(edge=0.05, expected_value=0.08, model_confidence=0.7)
        assert 0.0 <= score <= 100.0

    def test_edge_score_zero_when_no_edge_or_ev(self):
        score = calculate_edge_score(
            edge=0.0,
            expected_value=0.0,
            model_confidence=0.0,
            historical_model_accuracy=0.0,
            market_liquidity_factor=0.0,
        )
        assert score == pytest.approx(0.0)

    def test_edge_score_negative_edge_contributes_zero(self):
        score_negative = calculate_edge_score(edge=-0.10, expected_value=0.0, model_confidence=0.0,
                                               historical_model_accuracy=0.0, market_liquidity_factor=0.0)
        score_zero = calculate_edge_score(edge=0.0, expected_value=0.0, model_confidence=0.0,
                                           historical_model_accuracy=0.0, market_liquidity_factor=0.0)
        assert score_negative == pytest.approx(score_zero)

    def test_edge_score_saturates_at_max(self):
        # Edge/EV muito acima dos limiares de saturação não deve estourar 100.
        score = calculate_edge_score(
            edge=MAX_EXPECTED_EDGE * 10,
            expected_value=MAX_EXPECTED_EV * 10,
            model_confidence=1.0,
            historical_model_accuracy=1.0,
            market_liquidity_factor=1.0,
        )
        assert score == pytest.approx(100.0)

    def test_edge_score_maximal_all_components_full(self):
        score = calculate_edge_score(
            edge=MAX_EXPECTED_EDGE,
            expected_value=MAX_EXPECTED_EV,
            model_confidence=1.0,
            historical_model_accuracy=1.0,
            market_liquidity_factor=1.0,
        )
        assert score == pytest.approx(100.0)

    def test_edge_score_monotonic_in_edge(self):
        low = calculate_edge_score(edge=0.01, expected_value=0.05, model_confidence=0.5)
        high = calculate_edge_score(edge=0.10, expected_value=0.05, model_confidence=0.5)
        assert high > low

    def test_edge_score_rejects_out_of_range_confidence(self):
        with pytest.raises(ValueError):
            calculate_edge_score(edge=0.05, expected_value=0.05, model_confidence=1.5)

    @pytest.mark.parametrize("edge", [-0.5, -0.01, 0.0, 0.01, 0.05, 0.10, 0.20, 0.50, 1.0])
    @pytest.mark.parametrize("ev", [-0.5, 0.0, 0.05, 0.10, 0.30, 1.0])
    def test_edge_score_always_within_bounds(self, edge, ev):
        score = calculate_edge_score(edge=edge, expected_value=ev, model_confidence=0.8,
                                      historical_model_accuracy=0.6, market_liquidity_factor=0.9)
        assert 0.0 <= score <= 100.0
