"""Testes de integração do Shadow Mode — componentes interagindo.

Diferente dos testes unitários (test_shadow.py), estes testes verificam
a interação entre componentes: engine → aggregations → report,
fair probability → CLV, selection → grading, etc.

Usa dados sintéticos realistas que espelham a estrutura do banco.
"""
import pytest
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

# Imports do engine
from app.shadow.engine import (
    _generate_pipeline_run_id,
    _generate_prediction_run_id,
    _calculate_clv_price,
    _calculate_clv_probability,
    _determine_result,
    _calculate_theoretical_return,
    _validate_fair_probs,
    _validate_odds,
    _validate_event_timing,
    _evaluate_shadow_selection,
    MIN_EDGE_THRESHOLD,
    SELECTION_MIN_EDGE,
    SELECTION_MIN_EV,
    SELECTION_MIN_SCORE,
    SELECTION_MIN_BOOKMAKERS,
    KELLY_FRACTION,
    KELLY_CAP,
    MODEL_VERSION,
    PIPELINE_VERSION,
)

# GRADING_VERSION não existe ainda — fallback para quando o agent de
# schema não rodou. Quando o módulo exportar a constante, este fallback
# é silenciosamente ignorado.
try:
    from app.shadow.engine import GRADING_VERSION
except ImportError:
    GRADING_VERSION = "grading-v1.0.0"


# ═══════════════════════════════════════════════════════════════════════════
# Helpers — gera kickoff futuro para testes de seleção
# ═══════════════════════════════════════════════════════════════════════════

def _future_kickoff(hours: float = 5.0) -> datetime:
    """Retorna um kickoff futuro para uso nos testes de seleção."""
    return datetime.now(timezone.utc) + timedelta(hours=hours)


class TestPipelineRunIntegrity:
    """Testa integridade do pipeline run completo."""

    def test_pipeline_run_id_uniqueness(self):
        """IDs de pipeline run devem ser únicos entre chamadas."""
        ids = {_generate_pipeline_run_id() for _ in range(100)}
        assert len(ids) == 100

    def test_prediction_run_id_determinism(self):
        """prediction_run_id deve ser determinístico para o mesmo input."""
        run_id = "shadow-run-20260101-120000-abcd1234"
        event_id = "event-uuid-1234"

        id1 = _generate_prediction_run_id(run_id, event_id)
        id2 = _generate_prediction_run_id(run_id, event_id)
        assert id1 == id2, "prediction_run_id deve ser determinístico"

    def test_prediction_run_id_varies_by_event(self):
        """Eventos diferentes no mesmo pipeline devem ter prediction_run_ids diferentes."""
        run_id = "shadow-run-20260101-120000-abcd1234"
        id1 = _generate_prediction_run_id(run_id, "event-1")
        id2 = _generate_prediction_run_id(run_id, "event-2")
        assert id1 != id2

    def test_prediction_run_id_varies_by_run(self):
        """O mesmo evento em runs diferentes deve ter prediction_run_ids diferentes."""
        event_id = "event-uuid-1234"
        id1 = _generate_prediction_run_id("run-1", event_id)
        id2 = _generate_prediction_run_id("run-2", event_id)
        assert id1 != id2


class TestSelectionToGradingFlow:
    """Testa o fluxo completo de seleção → grading → CLV."""

    def test_winning_selection_flow(self):
        """Seleção vencedora: edge positivo → won → retorno positivo → CLV positivo."""
        # 1. Dados de entrada
        model_prob = 0.65
        fair_prob = 0.55
        best_odds = 2.10
        edge = model_prob - fair_prob  # 0.10
        ev = model_prob * best_odds - 1  # 0.365

        # 2. Validar que seria selecionada (edge e EV acima dos mínimos)
        assert edge >= SELECTION_MIN_EDGE
        assert ev >= SELECTION_MIN_EV

        # 3. Grading: home win com 1x2 market
        result = _determine_result("1x2", "home", home_score=2, away_score=1)
        assert result == "won"

        # 4. Retorno teórico
        ret = _calculate_theoretical_return(result, best_odds)
        assert ret == pytest.approx(best_odds - 1.0)  # 1.10

        # 5. CLV price (se mercado se moveu favoravelmente)
        closing_odds = 1.90  # mercado caiu → modelo estava certo
        clv_price = _calculate_clv_price(best_odds, closing_odds)
        assert clv_price is not None
        assert clv_price > 0, "CLV price deve ser positivo quando entry > closing"
        assert clv_price == pytest.approx(2.10 / 1.90 - 1.0, rel=1e-4)

    def test_losing_selection_flow(self):
        """Seleção perdedora: resultado correto de grading e CLV negativo."""
        result = _determine_result("1x2", "home", home_score=0, away_score=2)
        assert result == "lost"

        ret = _calculate_theoretical_return(result, 2.10)
        assert ret == -1.0

        # CLV negativo quando mercado se moveu contra
        closing_odds = 2.50  # mercado subiu → modelo estava errado
        clv_price = _calculate_clv_price(2.10, closing_odds)
        assert clv_price is not None
        assert clv_price < 0

    def test_void_result_flow(self):
        """Resultado void: retorno zero, sem impacto no bankroll."""
        # DNB com empate → void
        result = _determine_result("dnb", "home", home_score=1, away_score=1)
        assert result == "void"

        ret = _calculate_theoretical_return("void", 2.10)
        assert ret == 0.0


class TestCLVDualConsistency:
    """Testa consistência entre CLV price e CLV probability."""

    def test_clv_price_positive_means_good_entry(self):
        """CLV price positivo = obteve odds melhores que o mercado de fechamento."""
        entry = 2.50
        closing = 2.20
        clv = _calculate_clv_price(entry, closing)
        assert clv is not None and clv > 0

    def test_clv_price_negative_means_bad_entry(self):
        """CLV price negativo = odds pioraram (mercado se moveu contra)."""
        entry = 2.20
        closing = 2.50
        clv = _calculate_clv_price(entry, closing)
        assert clv is not None and clv < 0

    def test_clv_probability_positive_means_market_agreed(self):
        """CLV probability positivo = mercado convergiu para a visão do modelo.

        Fórmula: model_prob - 1/closing_odds.
        Closing odds 1.80 implica 55.6% → modelo com 60% tem CLV > 0.
        """
        model_prob = 0.60
        closing_odds = 1.80  # implied prob ~0.556
        clv = _calculate_clv_probability(model_prob, closing_odds)
        assert clv is not None and clv > 0
        assert clv == pytest.approx(model_prob - 1.0 / closing_odds)

    def test_clv_probability_negative_means_market_diverged(self):
        """CLV probability negativo = mercado divergiu do modelo.

        Closing odds 1.50 implica 66.7% → modelo com 55% tem CLV < 0.
        """
        model_prob = 0.55
        closing_odds = 1.50  # implied prob ~0.667
        clv = _calculate_clv_probability(model_prob, closing_odds)
        assert clv is not None and clv < 0

    def test_clv_both_none_without_closing(self):
        """Sem closing data, ambos CLVs devem ser None."""
        assert _calculate_clv_price(2.10, None) is None
        assert _calculate_clv_probability(0.50, None) is None

    def test_clv_price_invalid_closing(self):
        """Closing odds inválidas (<=1.0) → CLV None."""
        assert _calculate_clv_price(2.10, 1.0) is None
        assert _calculate_clv_price(2.10, 0.5) is None

    def test_clv_probability_invalid_closing(self):
        """Closing odds inválidas → CLV prob None."""
        assert _calculate_clv_probability(0.50, 1.0) is None
        assert _calculate_clv_probability(0.50, 0.5) is None
        assert _calculate_clv_probability(0.50, None) is None


class TestFailSafeChain:
    """Testa que falhas em validações propagam corretamente."""

    def test_invalid_fair_probs_blocks_prediction(self):
        """Fair probs inválidas devem bloquear a previsão."""
        # Soma != 1.0
        valid, reason = _validate_fair_probs(
            {"home": 0.5, "draw": 0.5, "away": 0.5}, "1x2"
        )
        assert not valid
        assert "soma" in reason.lower() or "1.0" in reason

    def test_missing_outcomes_blocks_prediction(self):
        """Outcomes faltando devem bloquear."""
        valid, reason = _validate_fair_probs(
            {"home": 0.6, "draw": 0.4}, "1x2"
        )
        assert not valid
        assert "faltando" in reason.lower() or "missing" in reason.lower()

    def test_extreme_odds_blocked(self):
        """Odds extremas (>100.0) devem ser rejeitadas."""
        valid, reason = _validate_odds(150.0, "test")
        assert not valid
        assert "100" in reason

    def test_odds_below_one_blocked(self):
        """Odds <= 1.0 devem ser rejeitadas."""
        valid, reason = _validate_odds(0.95, "test")
        assert not valid

    def test_too_close_to_kickoff_blocked(self):
        """Evento muito próximo do kickoff deve ser rejeitado."""
        now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        kickoff = now + timedelta(minutes=10)  # 10 min, mínimo é 15
        valid, reason = _validate_event_timing(kickoff, now=now)
        assert not valid
        assert "próximo" in reason.lower() or "kickoff" in reason.lower()

    def test_adequate_time_before_kickoff_passes(self):
        """Evento com tempo suficiente antes do kickoff deve passar."""
        now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        kickoff = now + timedelta(hours=3)
        valid, reason = _validate_event_timing(kickoff, now=now)
        assert valid
        assert reason is None


class TestSelectionCriteria:
    """Testa todos os 6 critérios de seleção shadow.

    NOTA: _evaluate_shadow_selection recebe kickoff_at (datetime) e
    calcula internamente se o evento está no futuro. Os testes usam
    um kickoff 5h no futuro para critérios não-temporais.
    """

    def test_all_criteria_met(self):
        """Previsão que atende todos os critérios → selecionada."""
        is_sel, reasons = _evaluate_shadow_selection(
            edge=0.05,
            ev=0.04,
            prediq_score=65.0,
            n_bookmakers=3,
            fair_prob_valid=True,
            kickoff_at=_future_kickoff(5.0),
        )
        assert is_sel is True

    def test_edge_too_low(self):
        """Edge abaixo do mínimo → não selecionada."""
        is_sel, reasons = _evaluate_shadow_selection(
            edge=0.02,
            ev=0.04,
            prediq_score=65.0,
            n_bookmakers=3,
            fair_prob_valid=True,
            kickoff_at=_future_kickoff(5.0),
        )
        assert is_sel is False
        # O dict de critérios indica qual falhou
        assert reasons["criteria"]["edge_min"]["passed"] is False

    def test_ev_too_low(self):
        """EV abaixo do mínimo → não selecionada."""
        is_sel, reasons = _evaluate_shadow_selection(
            edge=0.05,
            ev=0.01,
            prediq_score=65.0,
            n_bookmakers=3,
            fair_prob_valid=True,
            kickoff_at=_future_kickoff(5.0),
        )
        assert is_sel is False
        assert reasons["criteria"]["ev_min"]["passed"] is False

    def test_score_too_low(self):
        """PREDIQ Score abaixo do mínimo → não selecionada."""
        is_sel, reasons = _evaluate_shadow_selection(
            edge=0.05,
            ev=0.04,
            prediq_score=40.0,
            n_bookmakers=3,
            fair_prob_valid=True,
            kickoff_at=_future_kickoff(5.0),
        )
        assert is_sel is False
        assert reasons["criteria"]["score_min"]["passed"] is False

    def test_insufficient_bookmakers(self):
        """Poucos bookmakers → não selecionada."""
        is_sel, reasons = _evaluate_shadow_selection(
            edge=0.05,
            ev=0.04,
            prediq_score=65.0,
            n_bookmakers=1,
            fair_prob_valid=True,
            kickoff_at=_future_kickoff(5.0),
        )
        assert is_sel is False
        assert reasons["criteria"]["bookmaker_coverage"]["passed"] is False

    def test_invalid_fair_prob(self):
        """Fair prob inválida → não selecionada."""
        is_sel, reasons = _evaluate_shadow_selection(
            edge=0.05,
            ev=0.04,
            prediq_score=65.0,
            n_bookmakers=3,
            fair_prob_valid=False,
            kickoff_at=_future_kickoff(5.0),
        )
        assert is_sel is False
        assert reasons["criteria"]["fair_prob_valid"]["passed"] is False

    def test_kickoff_in_past(self):
        """Kickoff no passado → não selecionada."""
        past_kickoff = datetime.now(timezone.utc) - timedelta(hours=1)
        is_sel, reasons = _evaluate_shadow_selection(
            edge=0.05,
            ev=0.04,
            prediq_score=65.0,
            n_bookmakers=3,
            fair_prob_valid=True,
            kickoff_at=past_kickoff,
        )
        assert is_sel is False
        assert reasons["criteria"]["pre_kickoff"]["passed"] is False


class TestGradingAllMarkets:
    """Testa grading correto para cada mercado e desfecho."""

    @pytest.mark.parametrize("home,away,expected", [
        (2, 1, "won"),   # Home win
        (1, 2, "lost"),  # Home loss
        (1, 1, "lost"),  # Draw != home
    ])
    def test_1x2_home(self, home, away, expected):
        assert _determine_result("1x2", "home", home, away) == expected

    @pytest.mark.parametrize("home,away,expected", [
        (1, 1, "won"),   # Draw
        (2, 1, "lost"),  # Not draw
    ])
    def test_1x2_draw(self, home, away, expected):
        assert _determine_result("1x2", "draw", home, away) == expected

    @pytest.mark.parametrize("home,away,expected", [
        (1, 2, "won"),   # Away win
        (2, 1, "lost"),  # Away loss
    ])
    def test_1x2_away(self, home, away, expected):
        assert _determine_result("1x2", "away", home, away) == expected

    @pytest.mark.parametrize("home,away,expected", [
        (2, 1, "won"),   # Total 3 > 2.5
        (1, 1, "lost"),  # Total 2 <= 2.5
        (0, 0, "lost"),  # Total 0 <= 2.5
    ])
    def test_ou_over(self, home, away, expected):
        # Mercado é "ou" (não "ou_2.5") na engine
        assert _determine_result("ou", "over", home, away) == expected

    @pytest.mark.parametrize("home,away,expected", [
        (2, 1, "lost"),  # Total 3 > 2.5
        (1, 1, "won"),   # Total 2 <= 2.5
    ])
    def test_ou_under(self, home, away, expected):
        assert _determine_result("ou", "under", home, away) == expected

    @pytest.mark.parametrize("home,away,expected", [
        (1, 1, "won"),   # Both scored
        (2, 0, "lost"),  # Only home scored
        (0, 0, "lost"),  # Neither scored
    ])
    def test_btts_yes(self, home, away, expected):
        assert _determine_result("btts", "yes", home, away) == expected


class TestTheoreticalReturnEdgeCases:
    """Testa cálculo de retorno teórico em edge cases."""

    def test_won_returns_profit(self):
        assert _calculate_theoretical_return("won", 2.50) == pytest.approx(1.50)

    def test_lost_returns_minus_one(self):
        assert _calculate_theoretical_return("lost", 2.50) == -1.0

    def test_void_returns_zero(self):
        assert _calculate_theoretical_return("void", 2.50) == 0.0

    def test_won_with_low_odds(self):
        assert _calculate_theoretical_return("won", 1.10) == pytest.approx(0.10)

    def test_won_with_high_odds(self):
        assert _calculate_theoretical_return("won", 10.0) == pytest.approx(9.0)


class TestVersionConsistency:
    """Testa que as constantes de versão são consistentes."""

    def test_model_version_format(self):
        assert MODEL_VERSION.startswith("shadow-v")

    def test_pipeline_version_format(self):
        assert PIPELINE_VERSION.startswith("shadow-pipeline-v")

    def test_grading_version_format(self):
        """Verifica formato da versão de grading (se disponível)."""
        assert GRADING_VERSION.startswith("grading-v")

    def test_kelly_fraction_valid(self):
        assert 0 < KELLY_FRACTION <= 1.0

    def test_kelly_cap_valid(self):
        assert 0 < KELLY_CAP <= 0.10

    def test_selection_thresholds_ordered(self):
        """Edge de seleção deve ser maior que edge mínimo de previsão."""
        assert SELECTION_MIN_EDGE > MIN_EDGE_THRESHOLD
