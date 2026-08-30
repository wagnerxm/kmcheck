"""Testes unitários do motor de value bets (`app.value.engine`).

Cobre:
  - Probabilidade implícita: even money, short/long odds, validação.
  - Overround: zero, típico, validação.
  - Remoção de vig: multiplicativa, potência, Shin — soma=1, ordem, concordância.
  - Edge e EV: positivo, negativo, breakeven, validação.
  - Edge relativo: cálculo, validação.
  - Compressão logística: saturação, identidade, edge negativo.
  - Edge Score v2 (7 componentes): limites, monotonicidade, componentes novos,
    retrocompatibilidade com assinatura original.
  - Otimização de pesos via regressão de CLV.
"""
import numpy as np
import pytest

from app.value.engine import (
    DEFAULT_WEIGHTS,
    EDGE_LOGISTIC_A,
    EDGE_LOGISTIC_E0,
    MAX_EXPECTED_EV,
    EdgeScoreComponents,
    EdgeScoreResult,
    calculate_edge,
    calculate_edge_score,
    calculate_edge_score_detailed,
    calculate_ev,
    calculate_overround,
    calculate_relative_edge,
    compress_edge,
    implied_probability,
    optimize_edge_score_weights,
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
        for i in range(len(implied)):
            for j in range(len(implied)):
                assert (implied[i] > implied[j]) == (fair[i] > fair[j])

    def test_multiplicative_known_values(self):
        fair = remove_vig_multiplicative([0.55, 0.55])
        assert fair[0] == pytest.approx(0.5)
        assert fair[1] == pytest.approx(0.5)

    def test_power_method_sums_to_one(self, implied):
        fair = remove_vig_power(implied)
        assert sum(fair) == pytest.approx(1.0, abs=1e-6)

    def test_power_method_no_overround_is_noop(self):
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
        assert calculate_ev(model_prob=0.5, decimal_odds=2.0) == pytest.approx(0.0)

    def test_calculate_ev_positive(self):
        ev = calculate_ev(model_prob=0.6, decimal_odds=2.0)
        assert ev == pytest.approx(0.2)

    def test_calculate_ev_negative(self):
        ev = calculate_ev(model_prob=0.4, decimal_odds=2.0)
        assert ev == pytest.approx(-0.2)

    def test_calculate_ev_rejects_bad_odds(self):
        with pytest.raises(ValueError):
            calculate_ev(model_prob=0.5, decimal_odds=1.0)


class TestRelativeEdge:
    def test_calculate_relative_edge(self):
        # Edge de 5 p.p. sobre probabilidade de 50% → 10% relativo.
        rel = calculate_relative_edge(model_prob=0.55, fair_market_prob=0.50)
        assert rel == pytest.approx(0.10)

    def test_relative_edge_azarao(self):
        # Edge de 3 p.p. sobre probabilidade de 10% → 30% relativo (mais significativo).
        rel = calculate_relative_edge(model_prob=0.13, fair_market_prob=0.10)
        assert rel == pytest.approx(0.30)

    def test_relative_edge_rejects_zero_fair_prob(self):
        with pytest.raises(ValueError):
            calculate_relative_edge(model_prob=0.5, fair_market_prob=0.0)


class TestEdgeCompression:
    """Testa a função de compressão logística f(E) do §7.5."""

    def test_compression_at_inflection_point(self):
        # No ponto de inflexão E0, f(E0) = 0.5 (propriedade da logística).
        assert compress_edge(EDGE_LOGISTIC_E0) == pytest.approx(0.5)

    def test_compression_saturates_high_edge(self):
        # Edge muito alto (20 p.p.) deve saturar próximo de 1.
        val = compress_edge(0.20)
        assert val > 0.95

    def test_compression_very_high_edge_near_one(self):
        # Edge absurdo (50 p.p.) → praticamente 1.0.
        assert compress_edge(0.50) == pytest.approx(1.0, abs=1e-6)

    def test_compression_zero_edge_near_zero(self):
        # Edge = 0 → f(0) muito baixo (bem abaixo de E0).
        val = compress_edge(0.0)
        assert val < 0.2

    def test_compression_negative_edge_near_zero(self):
        val = compress_edge(-0.10)
        assert val < 0.01

    def test_compression_monotonic(self):
        edges = [0.0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.15, 0.20]
        values = [compress_edge(e) for e in edges]
        for i in range(len(values) - 1):
            assert values[i] < values[i + 1]

    def test_compression_custom_params(self):
        # Com E0=0.10 e a=20: f(0.10) = 0.5.
        assert compress_edge(0.10, a=20, e0=0.10) == pytest.approx(0.5)


class TestEdgeScore:
    """Testa o Edge Score v2 com 7 componentes (§7.5)."""

    def test_edge_score_within_bounds_for_typical_input(self):
        score = calculate_edge_score(edge=0.05, expected_value=0.08, model_confidence=0.7)
        assert 0.0 <= score <= 100.0

    def test_edge_score_low_when_no_edge_or_ev(self):
        score = calculate_edge_score(
            edge=0.0,
            expected_value=0.0,
            model_confidence=0.0,
            historical_model_accuracy=0.0,
            market_liquidity_factor=0.0,
        )
        # Score não é exatamente 0 por causa dos componentes L (neutro=0.5) e
        # M (ineficiência=1.0 quando liquidez=0) com fallbacks, mas deve ser
        # substancialmente baixo (sem edge/EV/confiança efetivos).
        assert score < 15.0

    def test_edge_score_negative_edge_contributes_zero(self):
        score_negative = calculate_edge_score(
            edge=-0.10, expected_value=0.0, model_confidence=0.0,
            historical_model_accuracy=0.0, market_liquidity_factor=0.0,
        )
        score_zero = calculate_edge_score(
            edge=0.0, expected_value=0.0, model_confidence=0.0,
            historical_model_accuracy=0.0, market_liquidity_factor=0.0,
        )
        assert score_negative == pytest.approx(score_zero)

    def test_edge_score_saturates_at_max(self):
        # Edge/EV extremos com todos os componentes no máximo não deve estourar 100.
        score = calculate_edge_score(
            edge=0.50,
            expected_value=MAX_EXPECTED_EV * 10,
            model_confidence=1.0,
            historical_model_accuracy=1.0,
            market_liquidity_factor=1.0,
        )
        assert score <= 100.0

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
        score = calculate_edge_score(
            edge=edge, expected_value=ev, model_confidence=0.8,
            historical_model_accuracy=0.6, market_liquidity_factor=0.9,
        )
        assert 0.0 <= score <= 100.0

    def test_edge_score_with_ensemble_variance(self):
        """Ensemble variance baixa → score mais alto (modelos concordam)."""
        score_concordant = calculate_edge_score(
            edge=0.05, expected_value=0.08,
            model_confidence=0.8,
            ensemble_variance=0.01,  # baixa variância
        )
        score_discordant = calculate_edge_score(
            edge=0.05, expected_value=0.08,
            model_confidence=0.8,
            ensemble_variance=0.20,  # alta variância
        )
        assert score_concordant > score_discordant

    def test_edge_score_with_sample_size(self):
        """Mais dados históricos → score mais alto."""
        score_small = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            historical_sample_size=50,
        )
        score_large = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            historical_sample_size=3000,
        )
        assert score_large > score_small

    def test_edge_score_with_calibration(self):
        """Melhor calibração (ECE menor) → score mais alto."""
        score_bad_cal = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            recent_ece=0.15,  # calibração ruim
        )
        score_good_cal = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            recent_ece=0.02,  # calibração boa
        )
        assert score_good_cal > score_bad_cal

    def test_edge_score_with_line_movement(self):
        """Movimento de odds confirmando o modelo → score mais alto."""
        score_confirms = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            line_movement_confirms=1.0,  # confirma
        )
        score_contradicts = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            line_movement_confirms=-1.0,  # contradiz
        )
        assert score_confirms > score_contradicts

    def test_edge_score_with_bookmaker_coverage(self):
        """Mais casas com odds compatíveis → score mais alto."""
        score_few = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            n_bookmakers_compatible=2,
        )
        score_many = calculate_edge_score(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            n_bookmakers_compatible=15,
        )
        assert score_many > score_few

    def test_edge_score_custom_weights(self):
        """Pesos customizados devem ser usados na combinação."""
        # Peso 100% no edge → score depende só do edge.
        custom = {k: 0.0 for k in DEFAULT_WEIGHTS}
        custom["edge"] = 1.0

        score = calculate_edge_score(
            edge=0.10, expected_value=0.0, model_confidence=0.0,
            historical_model_accuracy=0.0, market_liquidity_factor=0.0,
            weights=custom,
        )
        # Score deve ser ~100 * compress_edge(0.10).
        expected = 100.0 * compress_edge(0.10)
        assert score == pytest.approx(expected, abs=1.0)


class TestEdgeScoreDetailed:
    """Testa a versão detalhada com decomposição de componentes."""

    def test_returns_edge_score_result(self):
        result = calculate_edge_score_detailed(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
        )
        assert isinstance(result, EdgeScoreResult)
        assert 0.0 <= result.score <= 100.0
        assert isinstance(result.components, EdgeScoreComponents)
        assert isinstance(result.weights, dict)

    def test_components_in_range(self):
        result = calculate_edge_score_detailed(
            edge=0.05, expected_value=0.08, model_confidence=0.7,
            ensemble_variance=0.05,
            historical_sample_size=500,
            recent_ece=0.05,
            line_movement_confirms=0.5,
            n_bookmakers_compatible=8,
        )
        comps = result.components
        for field_name in ["edge", "ev", "model_confidence", "market_efficiency",
                           "sample_size", "calibration_quality", "line_movement",
                           "bookmaker_coverage"]:
            val = getattr(comps, field_name)
            assert 0.0 <= val <= 1.0, f"{field_name} = {val} fora de [0, 1]"

    def test_to_dict_has_all_keys(self):
        result = calculate_edge_score_detailed(edge=0.05, expected_value=0.08)
        d = result.components.to_dict()
        assert set(d.keys()) == {
            "edge", "ev", "model_confidence", "market_efficiency",
            "sample_size", "calibration_quality", "line_movement",
            "bookmaker_coverage",
        }

    def test_score_matches_simple_version(self):
        """A versão detalhada deve produzir o mesmo score que a simples."""
        simple = calculate_edge_score(
            edge=0.05, expected_value=0.10, model_confidence=0.8,
            ensemble_variance=0.03,
            historical_sample_size=1000,
            recent_ece=0.04,
            line_movement_confirms=0.5,
            n_bookmakers_compatible=10,
        )
        detailed = calculate_edge_score_detailed(
            edge=0.05, expected_value=0.10, model_confidence=0.8,
            ensemble_variance=0.03,
            historical_sample_size=1000,
            recent_ece=0.04,
            line_movement_confirms=0.5,
            n_bookmakers_compatible=10,
        )
        # Os dois devem dar o mesmo score.
        assert detailed.score == pytest.approx(simple, abs=1.0)


class TestOptimizeWeights:
    """Testa a otimização de pesos do Edge Score via regressão de CLV."""

    def test_optimized_weights_sum_to_one(self):
        rng = np.random.default_rng(42)
        n = 100
        components = rng.uniform(0, 1, size=(n, 8))
        # CLV correlacionado com o primeiro componente (edge).
        clv = 0.5 * components[:, 0] + 0.3 * components[:, 1] + rng.normal(0, 0.05, n)
        clv = np.clip(clv, 0, 1)

        weights = optimize_edge_score_weights(components, clv)
        assert sum(weights.values()) == pytest.approx(1.0, abs=1e-6)

    def test_optimized_weights_non_negative(self):
        rng = np.random.default_rng(42)
        n = 100
        components = rng.uniform(0, 1, size=(n, 8))
        clv = 0.5 * components[:, 0] + rng.normal(0, 0.1, n)
        clv = np.clip(clv, 0, 1)

        weights = optimize_edge_score_weights(components, clv)
        for w in weights.values():
            assert w >= -1e-10  # tolerância numérica

    def test_optimized_weights_favor_correlated_component(self):
        """O peso do componente mais correlacionado com CLV deve ser alto."""
        rng = np.random.default_rng(42)
        n = 200
        components = rng.uniform(0, 1, size=(n, 8))
        # CLV é quase inteiramente determinado pelo componente 0 (edge).
        clv = 0.9 * components[:, 0] + rng.normal(0, 0.02, n)
        clv = np.clip(clv, 0, 1)

        weights = optimize_edge_score_weights(components, clv)
        assert weights["edge"] > 0.5  # deve ser o peso dominante

    def test_rejects_wrong_shape(self):
        with pytest.raises(ValueError, match="shape"):
            optimize_edge_score_weights(np.zeros((10, 5)), np.zeros(10))

    def test_rejects_too_few_samples(self):
        with pytest.raises(ValueError, match="20"):
            optimize_edge_score_weights(np.zeros((10, 8)), np.zeros(10))

    def test_has_all_weight_keys(self):
        rng = np.random.default_rng(42)
        components = rng.uniform(0, 1, size=(50, 8))
        clv = rng.uniform(0, 1, size=50)

        weights = optimize_edge_score_weights(components, clv)
        assert set(weights.keys()) == set(DEFAULT_WEIGHTS.keys())
