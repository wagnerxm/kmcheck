"""Testes do critério de Kelly (app.value.kelly).

Cobre:
  - Kelly pleno: fórmula básica, breakeven, valor negativo, validação.
  - Kelly fracionário: quarter, half, clamp, zero quando sem valor.
  - kelly_stake_pct: conveniência multi-κ, formato de saída.
"""
import pytest

from app.value.kelly import (
    fractional_kelly,
    kelly_fraction,
    kelly_stake_pct,
)


class TestKellyFraction:
    """Testa f* = (b·p - q) / b."""

    def test_positive_value_bet(self):
        # Modelo acredita em 60%, odds 2.00 (b=1). f* = (1*0.6 - 0.4)/1 = 0.2.
        assert kelly_fraction(0.6, 2.0) == pytest.approx(0.2)

    def test_breakeven(self):
        # Probabilidade = 1/odds → f* = 0.
        assert kelly_fraction(0.5, 2.0) == pytest.approx(0.0)

    def test_no_value(self):
        # Modelo acredita em 40%, odds 2.00 → f* < 0 (não apostar).
        assert kelly_fraction(0.4, 2.0) < 0

    def test_strong_favorite(self):
        # Modelo 80%, odds 1.50 (b=0.5). f* = (0.5*0.8 - 0.2)/0.5 = 0.4.
        assert kelly_fraction(0.8, 1.50) == pytest.approx(0.4)

    def test_long_odds(self):
        # Odds 10.0 (b=9), modelo 15%. f* = (9*0.15 - 0.85)/9 = 0.0556.
        assert kelly_fraction(0.15, 10.0) == pytest.approx(0.0556, abs=1e-3)

    def test_rejects_prob_zero(self):
        with pytest.raises(ValueError):
            kelly_fraction(0.0, 2.0)

    def test_rejects_prob_one(self):
        with pytest.raises(ValueError):
            kelly_fraction(1.0, 2.0)

    def test_rejects_bad_odds(self):
        with pytest.raises(ValueError):
            kelly_fraction(0.5, 1.0)


class TestFractionalKelly:
    def test_quarter_kelly(self):
        # f* = 0.2, quarter-Kelly = 0.25 * 0.2 = 0.05.
        frac = fractional_kelly(0.6, 2.0, fraction=0.25)
        assert frac == pytest.approx(0.05)

    def test_half_kelly(self):
        # f* = 0.2, half-Kelly = 0.5 * 0.2 = 0.10.
        frac = fractional_kelly(0.6, 2.0, fraction=0.5)
        assert frac == pytest.approx(0.10)

    def test_zero_when_no_value(self):
        # Sem valor (f* ≤ 0) → retorna 0.0.
        frac = fractional_kelly(0.4, 2.0, fraction=0.25)
        assert frac == 0.0

    def test_clamp_at_fraction(self):
        # f* muito alto não deve exceder κ.
        frac = fractional_kelly(0.95, 1.10, fraction=0.25)
        assert frac <= 0.25

    def test_rejects_bad_fraction(self):
        with pytest.raises(ValueError):
            fractional_kelly(0.6, 2.0, fraction=0.0)
        with pytest.raises(ValueError):
            fractional_kelly(0.6, 2.0, fraction=1.5)


class TestKellyStakePct:
    def test_default_fractions(self):
        result = kelly_stake_pct(0.6, 2.0)
        assert "kelly_0.25" in result
        assert "kelly_0.5" in result

    def test_values_are_percentages(self):
        result = kelly_stake_pct(0.6, 2.0)
        # f* = 0.2; quarter-Kelly = 0.05 → 5.0%
        assert result["kelly_0.25"] == pytest.approx(5.0)
        # half-Kelly = 0.10 → 10.0%
        assert result["kelly_0.5"] == pytest.approx(10.0)

    def test_custom_fractions(self):
        result = kelly_stake_pct(0.6, 2.0, fractions=(0.1, 0.25, 0.5))
        assert len(result) == 3
        assert "kelly_0.1" in result

    def test_zero_when_no_value(self):
        result = kelly_stake_pct(0.4, 2.0)
        assert result["kelly_0.25"] == 0.0
        assert result["kelly_0.5"] == 0.0

    def test_reasonable_stakes_for_typical_value(self):
        # Edge pequeno (3 p.p.): modelo 53%, odds 2.00. f* = 0.06.
        result = kelly_stake_pct(0.53, 2.0)
        assert 0.0 < result["kelly_0.25"] < 5.0  # quarter-Kelly razoável
        assert 0.0 < result["kelly_0.5"] < 10.0   # half-Kelly razoável
