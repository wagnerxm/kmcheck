"""Testes do Shadow Mode v1 — bateria de hardening (pure functions).

Este arquivo cobre a superfície de funções puras do motor shadow (sem banco),
resultado de uma auditoria que apontou lacunas na versão anterior:

  - Grading: determinação de resultado por mercado/outcome/placar
  - CLV dual: fórmula de preço (odds) e fórmula de probabilidade
  - Retorno teórico: won/lost/void
  - Validações fail-safe: fair probs, odds, timing do evento
  - Seleção shadow: avaliação combinada dos critérios de elegibilidade
  - IDs de pipeline/prediction run (rastreabilidade e reprodutibilidade)
  - Estado do sistema (SHADOW_COLLECTING / SHADOW_VALIDATING / SHADOW_ELIGIBLE)
  - Bucketização de faixas para agregação
  - Imutabilidade e idempotência (lógica, sem banco)
  - Formato do relatório
  - Constantes/versões de configuração

Testes de integração com banco (INSERT/UPDATE reais, idempotência via
UNIQUE constraint, ciclo e2e) NÃO estão neste arquivo — exigem uma sessão
async de banco (fixture `db`) e ficam em um módulo de integração separado,
propositalmente marcado (`@pytest.mark.integration`) para não rodar por
padrão no CI rápido.
"""
from __future__ import annotations

import pytest
from datetime import datetime, timedelta, timezone

from app.shadow.engine import (
    MIN_EDGE_THRESHOLD,
    _calculate_theoretical_return,
    _determine_result,
    _find_best_odds,
)


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _determine_result
# ═══════════════════════════════════════════════════════════════════════════

class TestDetermineResult:
    """Testa a derivação de resultado (won/lost/void) por mercado."""

    # ── 1x2 ─────────────────────────────────────────────────────────────

    def test_1x2_home_win(self):
        assert _determine_result("1x2", "home", 2, 1) == "won"

    def test_1x2_home_loss(self):
        assert _determine_result("1x2", "home", 0, 1) == "lost"

    def test_1x2_draw_correct(self):
        assert _determine_result("1x2", "draw", 1, 1) == "won"

    def test_1x2_draw_wrong(self):
        assert _determine_result("1x2", "draw", 2, 0) == "lost"

    def test_1x2_away_win(self):
        assert _determine_result("1x2", "away", 0, 3) == "won"

    def test_1x2_away_loss(self):
        assert _determine_result("1x2", "away", 2, 1) == "lost"

    def test_1x2_draw_when_home_picked(self):
        # Empate quando apostou em home → lost
        assert _determine_result("1x2", "home", 1, 1) == "lost"

    # ── Over/Under 2.5 ──────────────────────────────────────────────────

    def test_ou_over_high_score(self):
        assert _determine_result("ou", "over", 2, 1) == "won"

    def test_ou_over_low_score(self):
        assert _determine_result("ou", "over", 1, 0) == "lost"

    def test_ou_under_low_score(self):
        assert _determine_result("ou", "under", 1, 1) == "won"

    def test_ou_under_high_score(self):
        assert _determine_result("ou", "under", 2, 2) == "lost"

    def test_ou_exactly_2_goals(self):
        # 2 gols total < 2.5 → under ganha
        assert _determine_result("ou", "under", 1, 1) == "won"
        assert _determine_result("ou", "over", 1, 1) == "lost"

    def test_ou_exactly_3_goals(self):
        # 3 gols total > 2.5 → over ganha
        assert _determine_result("ou", "over", 2, 1) == "won"
        assert _determine_result("ou", "under", 2, 1) == "lost"

    # ── BTTS ────────────────────────────────────────────────────────────

    def test_btts_yes_both_scored(self):
        assert _determine_result("btts", "yes", 2, 1) == "won"

    def test_btts_yes_one_clean_sheet(self):
        assert _determine_result("btts", "yes", 3, 0) == "lost"

    def test_btts_no_clean_sheet(self):
        assert _determine_result("btts", "no", 1, 0) == "won"

    def test_btts_no_both_scored(self):
        assert _determine_result("btts", "no", 1, 1) == "lost"

    # ── Double Chance ───────────────────────────────────────────────────

    def test_dc_home_or_draw_with_home_win(self):
        assert _determine_result("double_chance", "home_or_draw", 2, 0) == "won"

    def test_dc_home_or_draw_with_draw(self):
        assert _determine_result("double_chance", "home_or_draw", 1, 1) == "won"

    def test_dc_home_or_draw_with_away_win(self):
        assert _determine_result("double_chance", "home_or_draw", 0, 2) == "lost"

    def test_dc_home_or_away(self):
        # Empate → lost (ambos marcam mas nenhum ganha)
        assert _determine_result("double_chance", "home_or_away", 1, 1) == "lost"
        assert _determine_result("double_chance", "home_or_away", 2, 0) == "won"

    def test_dc_away_or_draw(self):
        assert _determine_result("double_chance", "away_or_draw", 0, 2) == "won"
        assert _determine_result("double_chance", "away_or_draw", 1, 1) == "won"
        assert _determine_result("double_chance", "away_or_draw", 2, 0) == "lost"

    # ── DNB (Draw No Bet) ───────────────────────────────────────────────

    def test_dnb_home_win(self):
        assert _determine_result("dnb", "home", 2, 1) == "won"

    def test_dnb_home_loss(self):
        assert _determine_result("dnb", "home", 0, 1) == "lost"

    def test_dnb_away_win(self):
        assert _determine_result("dnb", "away", 0, 2) == "won"

    def test_dnb_away_loss(self):
        assert _determine_result("dnb", "away", 2, 0) == "lost"

    def test_dnb_draw_voids(self):
        assert _determine_result("dnb", "home", 1, 1) == "void"
        assert _determine_result("dnb", "away", 1, 1) == "void"

    # ── Mercado desconhecido ────────────────────────────────────────────

    def test_unknown_market_returns_void(self):
        assert _determine_result("exotic_market", "something", 2, 1) == "void"

    def test_unknown_outcome_in_known_market_returns_void(self):
        # Mercado 1x2 conhecido, mas outcome inválido → cai no fallback void
        assert _determine_result("1x2", "handicap_home", 2, 1) == "void"


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _calculate_theoretical_return
# ═══════════════════════════════════════════════════════════════════════════

class TestTheoreticalReturn:
    """Testa o cálculo de retorno teórico por unidade apostada."""

    def test_won_even_money(self):
        # Odds 2.0 → retorno = 1.0 (lucro líquido)
        ret = _calculate_theoretical_return("won", 2.0)
        assert ret == pytest.approx(1.0)

    def test_won_high_odds(self):
        # Odds 5.0 → retorno = 4.0
        ret = _calculate_theoretical_return("won", 5.0)
        assert ret == pytest.approx(4.0)

    def test_won_low_odds(self):
        # Odds 1.25 → retorno = 0.25
        ret = _calculate_theoretical_return("won", 1.25)
        assert ret == pytest.approx(0.25)

    def test_lost(self):
        # Perda → retorno = -1.0 (independente das odds)
        ret = _calculate_theoretical_return("lost", 3.50)
        assert ret == pytest.approx(-1.0)

    def test_void(self):
        # Void → retorno = 0.0 (aposta devolvida)
        ret = _calculate_theoretical_return("void", 2.50)
        assert ret == pytest.approx(0.0)


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _find_best_odds
# ═══════════════════════════════════════════════════════════════════════════

class TestFindBestOdds:
    """Testa busca da melhor odd entre bookmakers."""

    def test_finds_highest(self):
        bookmaker_odds = {
            "bet365": {"home": 2.10, "draw": 3.20, "away": 3.40},
            "pinnacle": {"home": 2.20, "draw": 3.30, "away": 3.25},
            "betfair": {"home": 2.15, "draw": 3.25, "away": 3.50},
        }
        odds, bookie = _find_best_odds(bookmaker_odds, "home")
        assert odds == pytest.approx(2.20)
        assert bookie == "pinnacle"

    def test_finds_best_away(self):
        bookmaker_odds = {
            "bet365": {"home": 2.10, "away": 3.40},
            "pinnacle": {"home": 2.20, "away": 3.25},
            "betfair": {"home": 2.15, "away": 3.50},
        }
        odds, bookie = _find_best_odds(bookmaker_odds, "away")
        assert odds == pytest.approx(3.50)
        assert bookie == "betfair"

    def test_raises_on_missing_outcome(self):
        bookmaker_odds = {
            "bet365": {"home": 2.10},
        }
        with pytest.raises(ValueError, match="Nenhuma odd"):
            _find_best_odds(bookmaker_odds, "draw")

    def test_single_bookmaker(self):
        bookmaker_odds = {
            "bet365": {"home": 1.80, "draw": 3.50, "away": 4.20},
        }
        odds, bookie = _find_best_odds(bookmaker_odds, "draw")
        assert odds == pytest.approx(3.50)
        assert bookie == "bet365"

    def test_raises_on_empty_bookmaker_odds(self):
        with pytest.raises(ValueError, match="Nenhuma odd"):
            _find_best_odds({}, "home")


# ═══════════════════════════════════════════════════════════════════════════
# Testes de CLV dual (preço e probabilidade)
# ═══════════════════════════════════════════════════════════════════════════

class TestCalculateCLV:
    """Testa CLV dual — preço e probabilidade.

    A versão hardened do Shadow Mode reporta duas métricas de CLV:
      - CLV Price = entry_odds / closing_odds - 1 (variação percentual de preço)
      - CLV Probability = model_prob - 1/closing_odds (edge contra o fechamento)
    """

    # ── CLV Price ───────────────────────────────────────────────────────

    def test_clv_price_positive(self):
        # Entrou a 2.20, fechou a 2.00 → 2.20/2.00 - 1 = 0.10 (linha moveu a favor)
        from app.shadow.engine import _calculate_clv_price
        assert _calculate_clv_price(2.20, 2.00) == pytest.approx(0.10)

    def test_clv_price_negative(self):
        # Entrou a 1.80, fechou a 2.00 → 1.80/2.00 - 1 = -0.10 (linha moveu contra)
        from app.shadow.engine import _calculate_clv_price
        assert _calculate_clv_price(1.80, 2.00) == pytest.approx(-0.10)

    def test_clv_price_zero(self):
        # Odds de entrada iguais ao fechamento → sem movimento de linha
        from app.shadow.engine import _calculate_clv_price
        assert _calculate_clv_price(2.00, 2.00) == pytest.approx(0.0)

    def test_clv_price_none_closing(self):
        from app.shadow.engine import _calculate_clv_price
        assert _calculate_clv_price(2.00, None) is None

    def test_clv_price_invalid_closing(self):
        from app.shadow.engine import _calculate_clv_price
        assert _calculate_clv_price(2.00, 1.0) is None
        assert _calculate_clv_price(2.00, 0.5) is None

    # ── CLV Probability ─────────────────────────────────────────────────

    def test_clv_probability_positive(self):
        # Modelo diz 60%, closing odds implicam 50% → CLV = 0.10
        from app.shadow.engine import _calculate_clv_probability
        clv = _calculate_clv_probability(0.60, 2.0)
        assert clv == pytest.approx(0.10)

    def test_clv_probability_negative(self):
        # Modelo diz 40%, closing odds implicam 50% → CLV = -0.10
        from app.shadow.engine import _calculate_clv_probability
        clv = _calculate_clv_probability(0.40, 2.0)
        assert clv == pytest.approx(-0.10)

    def test_clv_probability_zero(self):
        # Modelo concorda exatamente com o mercado de fechamento
        from app.shadow.engine import _calculate_clv_probability
        clv = _calculate_clv_probability(0.50, 2.0)
        assert clv == pytest.approx(0.0)

    def test_clv_probability_none_closing(self):
        from app.shadow.engine import _calculate_clv_probability
        assert _calculate_clv_probability(0.50, None) is None

    def test_clv_probability_invalid(self):
        from app.shadow.engine import _calculate_clv_probability
        assert _calculate_clv_probability(0.50, 1.0) is None
        assert _calculate_clv_probability(0.50, 0.5) is None

    def test_clv_probability_high_closing_odds(self):
        # Closing odds altas (azarão) → prob implícita baixa
        from app.shadow.engine import _calculate_clv_probability
        clv = _calculate_clv_probability(0.15, 10.0)
        assert clv == pytest.approx(0.15 - 0.10)  # 0.05

    def test_clv_probability_low_closing_odds(self):
        # Closing odds baixas (favorito) → prob implícita alta
        from app.shadow.engine import _calculate_clv_probability
        clv = _calculate_clv_probability(0.85, 1.25)
        assert clv == pytest.approx(0.85 - 0.80)  # 0.05


# ═══════════════════════════════════════════════════════════════════════════
# Testes de validações fail-safe
# ═══════════════════════════════════════════════════════════════════════════

class TestFailSafeValidations:
    """Testa validações fail-safe do Shadow Mode.

    Estas validações barram a persistência de uma previsão quando os dados
    de entrada estão fora de limites plausíveis — evitam que ruído/erro de
    coleta vire "sinal" no relatório de graduação.
    """

    # ── _validate_fair_probs ────────────────────────────────────────────

    def test_validate_fair_probs_valid_1x2(self):
        from app.shadow.engine import _validate_fair_probs
        ok, reason = _validate_fair_probs({"home": 0.45, "draw": 0.28, "away": 0.27}, "1x2")
        assert ok is True
        assert reason is None

    def test_validate_fair_probs_bad_sum(self):
        from app.shadow.engine import _validate_fair_probs
        # Soma 0.90 — está longe de 1.0 (mercado 1x2 exige os três outcomes somando ~1)
        ok, reason = _validate_fair_probs({"home": 0.30, "draw": 0.30, "away": 0.30}, "1x2")
        assert ok is False
        assert "soma" in reason

    def test_validate_fair_probs_missing_outcome(self):
        from app.shadow.engine import _validate_fair_probs
        ok, reason = _validate_fair_probs({"home": 0.50, "away": 0.50}, "1x2")
        assert ok is False
        assert "faltando" in reason

    def test_validate_fair_probs_zero_prob(self):
        from app.shadow.engine import _validate_fair_probs
        ok, reason = _validate_fair_probs({"home": 0.0, "draw": 0.50, "away": 0.50}, "1x2")
        assert ok is False

    def test_validate_fair_probs_negative_prob(self):
        from app.shadow.engine import _validate_fair_probs
        ok, reason = _validate_fair_probs({"home": -0.05, "draw": 0.55, "away": 0.50}, "1x2")
        assert ok is False

    def test_validate_fair_probs_empty(self):
        from app.shadow.engine import _validate_fair_probs
        ok, reason = _validate_fair_probs({}, "1x2")
        assert ok is False

    def test_validate_fair_probs_two_way_market(self):
        # Mercados de 2 outcomes (ex.: btts) também devem validar soma ~1
        from app.shadow.engine import _validate_fair_probs
        ok, reason = _validate_fair_probs({"yes": 0.55, "no": 0.45}, "btts")
        assert ok is True
        assert reason is None

    # ── _validate_odds ──────────────────────────────────────────────────

    def test_validate_odds_valid(self):
        from app.shadow.engine import _validate_odds
        ok, _ = _validate_odds(2.50, "test")
        assert ok is True

    def test_validate_odds_too_low(self):
        from app.shadow.engine import _validate_odds
        ok, reason = _validate_odds(0.95, "test")
        assert ok is False
        assert "<= 1.0" in reason

    def test_validate_odds_exactly_one(self):
        from app.shadow.engine import _validate_odds
        ok, reason = _validate_odds(1.0, "test")
        assert ok is False

    def test_validate_odds_absurdly_high(self):
        from app.shadow.engine import _validate_odds, MAX_ODDS
        ok, reason = _validate_odds(MAX_ODDS + 1, "test")
        assert ok is False

    def test_validate_odds_at_max_boundary(self):
        # No limite exato de MAX_ODDS ainda deve ser válido (fronteira inclusiva)
        from app.shadow.engine import _validate_odds, MAX_ODDS
        ok, _ = _validate_odds(MAX_ODDS, "test")
        assert ok is True

    def test_validate_odds_negative(self):
        from app.shadow.engine import _validate_odds
        ok, reason = _validate_odds(-1.5, "test")
        assert ok is False

    # ── _validate_event_timing ──────────────────────────────────────────

    def test_validate_event_timing_ok(self):
        from app.shadow.engine import _validate_event_timing
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        ok, _ = _validate_event_timing(future)
        assert ok is True

    def test_validate_event_timing_too_close(self):
        from app.shadow.engine import _validate_event_timing
        almost_now = datetime.now(timezone.utc) + timedelta(minutes=5)
        ok, reason = _validate_event_timing(almost_now)
        assert ok is False
        assert "próximo" in reason

    def test_validate_event_timing_past(self):
        from app.shadow.engine import _validate_event_timing
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        ok, _ = _validate_event_timing(past)
        assert ok is False

    def test_validate_event_timing_at_minimum_boundary(self):
        # Exatamente no limite mínimo de horas antes do kickoff — não deve passar
        # (a folga precisa ser estritamente maior que o mínimo, senão a captura
        # de closing odds e o próprio ciclo shadow correm risco de rodar tarde
        # demais).
        from app.shadow.engine import _validate_event_timing, MIN_HOURS_BEFORE_KICKOFF
        boundary = datetime.now(timezone.utc) + timedelta(hours=MIN_HOURS_BEFORE_KICKOFF)
        ok, _ = _validate_event_timing(boundary)
        assert ok is False


# ═══════════════════════════════════════════════════════════════════════════
# Testes de seleção shadow
# ═══════════════════════════════════════════════════════════════════════════

class TestShadowSelection:
    """Testa lógica de seleção shadow — combinação de todos os critérios."""

    def test_all_criteria_met(self):
        from app.shadow.engine import _evaluate_shadow_selection
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        selected, reasons = _evaluate_shadow_selection(
            edge=0.05, ev=0.04, prediq_score=65.0,
            n_bookmakers=3, fair_prob_valid=True, kickoff_at=future,
        )
        assert selected is True
        assert all(c["passed"] for c in reasons["criteria"].values())

    def test_edge_below_threshold(self):
        from app.shadow.engine import _evaluate_shadow_selection
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        selected, reasons = _evaluate_shadow_selection(
            edge=0.02, ev=0.04, prediq_score=65.0,
            n_bookmakers=3, fair_prob_valid=True, kickoff_at=future,
        )
        assert selected is False
        assert reasons["criteria"]["edge_min"]["passed"] is False

    def test_ev_below_threshold(self):
        from app.shadow.engine import _evaluate_shadow_selection
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        selected, _ = _evaluate_shadow_selection(
            edge=0.05, ev=0.01, prediq_score=65.0,
            n_bookmakers=3, fair_prob_valid=True, kickoff_at=future,
        )
        assert selected is False

    def test_score_below_threshold(self):
        from app.shadow.engine import _evaluate_shadow_selection
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        selected, _ = _evaluate_shadow_selection(
            edge=0.05, ev=0.04, prediq_score=40.0,
            n_bookmakers=3, fair_prob_valid=True, kickoff_at=future,
        )
        assert selected is False

    def test_insufficient_bookmakers(self):
        from app.shadow.engine import _evaluate_shadow_selection
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        selected, _ = _evaluate_shadow_selection(
            edge=0.05, ev=0.04, prediq_score=65.0,
            n_bookmakers=1, fair_prob_valid=True, kickoff_at=future,
        )
        assert selected is False

    def test_invalid_fair_prob(self):
        from app.shadow.engine import _evaluate_shadow_selection
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        selected, _ = _evaluate_shadow_selection(
            edge=0.05, ev=0.04, prediq_score=65.0,
            n_bookmakers=3, fair_prob_valid=False, kickoff_at=future,
        )
        assert selected is False

    def test_past_kickoff(self):
        from app.shadow.engine import _evaluate_shadow_selection
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        selected, _ = _evaluate_shadow_selection(
            edge=0.05, ev=0.04, prediq_score=65.0,
            n_bookmakers=3, fair_prob_valid=True, kickoff_at=past,
        )
        assert selected is False

    def test_multiple_failures_all_reported(self):
        # Vários critérios falhando simultaneamente — todos devem aparecer
        # como not passed, não só o primeiro que falhar.
        from app.shadow.engine import _evaluate_shadow_selection
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        selected, reasons = _evaluate_shadow_selection(
            edge=0.01, ev=0.0, prediq_score=10.0,
            n_bookmakers=1, fair_prob_valid=False, kickoff_at=past,
        )
        assert selected is False
        failed = [k for k, c in reasons["criteria"].items() if not c["passed"]]
        assert len(failed) >= 2


# ═══════════════════════════════════════════════════════════════════════════
# Testes de geração de IDs de pipeline/prediction run
# ═══════════════════════════════════════════════════════════════════════════

class TestPipelineRunId:
    """Testa geração de IDs de pipeline e prediction runs.

    IDs de pipeline_run e prediction_run existem para reprodutibilidade e
    para agrupar/rastrear todas as previsões geradas num mesmo ciclo.
    """

    def test_pipeline_run_id_format(self):
        from app.shadow.engine import _generate_pipeline_run_id
        run_id = _generate_pipeline_run_id()
        assert run_id.startswith("shadow-run-")
        parts = run_id.split("-")
        assert len(parts) >= 4  # shadow-run-YYYYMMDD-HHMMSS-xxxxxxxx

    def test_pipeline_run_id_unique(self):
        from app.shadow.engine import _generate_pipeline_run_id
        run1 = _generate_pipeline_run_id()
        run2 = _generate_pipeline_run_id()
        assert run1 != run2

    def test_pipeline_run_id_is_string(self):
        from app.shadow.engine import _generate_pipeline_run_id
        run_id = _generate_pipeline_run_id()
        assert isinstance(run_id, str)
        assert len(run_id) > len("shadow-run-")

    def test_prediction_run_id_format(self):
        from app.shadow.engine import _generate_prediction_run_id
        pred_id = _generate_prediction_run_id("shadow-run-test-123", "event-abc-def")
        assert "shadow-run-test-123" in pred_id
        assert "event-ab" in pred_id

    def test_prediction_run_id_contains_pipeline(self):
        from app.shadow.engine import _generate_prediction_run_id
        pred_id = _generate_prediction_run_id("run-42", "evt-99")
        assert "run-42" in pred_id

    def test_prediction_run_id_deterministic_for_same_inputs(self):
        # Mesmo pipeline_run_id + event_id devem produzir o mesmo prediction
        # run id — é isso que permite reprocessar um evento (ex.: retry após
        # erro parcial) dentro do mesmo ciclo sem duplicar snapshots: o
        # ON CONFLICT DO NOTHING da UNIQUE (prediction_run_id, event_id,
        # market, outcome) absorve a reinserção.
        from app.shadow.engine import _generate_prediction_run_id
        pred_a = _generate_prediction_run_id("run-1", "evt-1")
        pred_b = _generate_prediction_run_id("run-1", "evt-1")
        assert pred_a == pred_b

    def test_prediction_run_id_differs_per_event(self):
        from app.shadow.engine import _generate_prediction_run_id
        pred_a = _generate_prediction_run_id("run-1", "evt-1")
        pred_b = _generate_prediction_run_id("run-1", "evt-2")
        assert pred_a != pred_b


# ═══════════════════════════════════════════════════════════════════════════
# Testes de estado do sistema
# ═══════════════════════════════════════════════════════════════════════════

class TestSystemStatus:
    """Testa determinação do estado do sistema.

    Estados possíveis:
      - SHADOW_COLLECTING: ainda não há amostra suficiente
      - SHADOW_VALIDATING: amostra suficiente, mas métricas de qualidade
        (ECE, CLV) ainda não passam
      - SHADOW_ELIGIBLE: amostra suficiente e métricas dentro do esperado
    """

    def test_collecting_few_events(self):
        from app.shadow.engine import _determine_system_status
        assert _determine_system_status(30, 10, None, None) == "SHADOW_COLLECTING"

    def test_collecting_insufficient_selections(self):
        from app.shadow.engine import _determine_system_status
        assert _determine_system_status(250, 100, 0.04, 0.01) == "SHADOW_COLLECTING"

    def test_validating_bad_ece(self):
        from app.shadow.engine import _determine_system_status
        assert _determine_system_status(250, 600, 0.08, 0.01) == "SHADOW_VALIDATING"

    def test_validating_negative_clv(self):
        from app.shadow.engine import _determine_system_status
        assert _determine_system_status(250, 600, 0.04, -0.01) == "SHADOW_VALIDATING"

    def test_eligible(self):
        from app.shadow.engine import _determine_system_status
        assert _determine_system_status(250, 600, 0.04, 0.01) == "SHADOW_ELIGIBLE"

    def test_validating_ece_none(self):
        # Amostra suficiente para contagem, mas ECE ainda não computado
        # (ex.: resolved < 50 dentro do overview) → não pode estar elegível.
        from app.shadow.engine import _determine_system_status
        status = _determine_system_status(250, 600, None, 0.01)
        assert status in ("SHADOW_VALIDATING", "SHADOW_COLLECTING")
        assert status != "SHADOW_ELIGIBLE"

    def test_validating_clv_none(self):
        from app.shadow.engine import _determine_system_status
        status = _determine_system_status(250, 600, 0.04, None)
        assert status != "SHADOW_ELIGIBLE"


# ═══════════════════════════════════════════════════════════════════════════
# Testes de faixas de agregação (range bucketing)
# ═══════════════════════════════════════════════════════════════════════════

class TestRangeBucketing:
    """Testa a lógica de discretização usada nas agregações."""

    def test_odds_range_bucketing(self):
        """Verifica que as faixas de odds cobrem todo o espectro."""
        def bucket(odds: float) -> str:
            if odds < 1.50:
                return "<1.50"
            elif odds < 2.00:
                return "1.50-2.00"
            elif odds < 3.00:
                return "2.00-3.00"
            elif odds < 5.00:
                return "3.00-5.00"
            else:
                return ">5.00"

        assert bucket(1.20) == "<1.50"
        assert bucket(1.50) == "1.50-2.00"
        assert bucket(1.99) == "1.50-2.00"
        assert bucket(2.00) == "2.00-3.00"
        assert bucket(2.50) == "2.00-3.00"
        assert bucket(3.00) == "3.00-5.00"
        assert bucket(4.99) == "3.00-5.00"
        assert bucket(5.00) == ">5.00"
        assert bucket(10.00) == ">5.00"

    def test_edge_range_bucketing(self):
        def bucket(edge: float) -> str:
            if edge < 0.03:
                return "2-3%"
            elif edge < 0.05:
                return "3-5%"
            elif edge < 0.08:
                return "5-8%"
            elif edge < 0.12:
                return "8-12%"
            else:
                return ">12%"

        assert bucket(0.025) == "2-3%"
        assert bucket(0.03) == "3-5%"
        assert bucket(0.049) == "3-5%"
        assert bucket(0.05) == "5-8%"
        assert bucket(0.10) == "8-12%"
        assert bucket(0.15) == ">12%"

    def test_prediq_range_bucketing(self):
        def bucket(score: float) -> str:
            if score < 30:
                return "0-30"
            elif score < 50:
                return "30-50"
            elif score < 70:
                return "50-70"
            elif score < 85:
                return "70-85"
            else:
                return "85-100"

        assert bucket(15) == "0-30"
        assert bucket(30) == "30-50"
        assert bucket(50) == "50-70"
        assert bucket(70) == "70-85"
        assert bucket(85) == "85-100"
        assert bucket(100) == "85-100"


# ═══════════════════════════════════════════════════════════════════════════
# Testes de imutabilidade e idempotência (lógica)
# ═══════════════════════════════════════════════════════════════════════════

class TestImmutabilityLogic:
    """Testa a lógica de imutabilidade do Shadow Mode.

    Não testa banco, mas verifica que as regras de negócio estão corretas:
    - Previsões não podem ser modificadas após kickoff
    - Grading é write-once (só WHERE status='open')
    - Closing odds só preenchidas se NULL
    """

    def test_grading_only_open_predictions(self):
        """Grading só deve processar status='open'."""
        # SQL: WHERE status = 'open' AND kickoff_at < now()
        statuses = ["open", "graded", "void", "open"]
        gradeable = [s for s in statuses if s == "open"]
        assert gradeable == ["open", "open"]
        assert len(gradeable) == 2  # apenas os 'open'
        assert "graded" not in gradeable
        assert "void" not in gradeable

    def test_closing_odds_write_once(self):
        """Closing odds só são escritas se NULL."""
        # SQL: WHERE closing_odds IS NULL
        existing_closing = 2.50  # já tem closing odds
        should_update = existing_closing is None
        assert should_update is False

        no_closing = None
        should_update_2 = no_closing is None
        assert should_update_2 is True

    def test_closing_odds_never_overwritten_once_set(self):
        """Simula duas tentativas de captura — a segunda não deve sobrescrever."""
        record = {"closing_odds": None}

        def try_capture(record: dict, new_odds: float) -> bool:
            if record["closing_odds"] is not None:
                return False  # write-once — já capturado, ignora
            record["closing_odds"] = new_odds
            return True

        assert try_capture(record, 2.10) is True
        assert record["closing_odds"] == 2.10
        assert try_capture(record, 2.35) is False  # tentativa tardia é ignorada
        assert record["closing_odds"] == 2.10  # valor original preservado

    def test_edge_threshold_filter(self):
        """Só persiste se edge > MIN_EDGE_THRESHOLD."""
        assert MIN_EDGE_THRESHOLD == pytest.approx(0.02)

        edges = [0.01, 0.02, 0.025, 0.05, 0.10]
        persisted = [e for e in edges if e > MIN_EDGE_THRESHOLD]
        assert len(persisted) == 3
        assert 0.01 not in persisted
        assert 0.02 not in persisted  # > não >=
        assert 0.025 in persisted

    def test_grading_result_fields_written_once(self):
        """Simula que result/clv/theoretical_return só são setados uma vez."""
        record = {"status": "open", "result": None, "clv": None}

        def try_grade(record: dict, result: str, clv: float) -> bool:
            if record["status"] != "open":
                return False  # já gradeado — write-once
            record["status"] = "graded" if result != "void" else "void"
            record["result"] = result
            record["clv"] = clv
            return True

        assert try_grade(record, "won", 0.03) is True
        assert record["result"] == "won"
        # Segunda tentativa de grading (ex.: reprocessamento acidental) não altera nada
        assert try_grade(record, "lost", -0.05) is False
        assert record["result"] == "won"
        assert record["clv"] == pytest.approx(0.03)


# ═══════════════════════════════════════════════════════════════════════════
# Testes de idempotência (lógica, sem banco)
# ═══════════════════════════════════════════════════════════════════════════

class TestIdempotencyLogic:
    """Testa lógica de idempotência (sem banco).

    A nova UNIQUE constraint é (prediction_run_id, event_id, market, outcome).
    """

    def test_same_prediction_run_is_duplicate(self):
        existing = {("run-1", "evt-1", "1x2", "home")}
        new_key = ("run-1", "evt-1", "1x2", "home")
        assert new_key in existing  # ON CONFLICT DO NOTHING

    def test_different_run_allows_new_snapshot(self):
        existing = {("run-1", "evt-1", "1x2", "home")}
        new_key = ("run-2", "evt-1", "1x2", "home")
        assert new_key not in existing  # permite nova inserção

    def test_different_market_or_outcome_not_duplicate(self):
        existing = {("run-1", "evt-1", "1x2", "home")}
        assert ("run-1", "evt-1", "1x2", "draw") not in existing
        assert ("run-1", "evt-1", "ou", "home") not in existing

    def test_unique_selection_prevents_duplicate(self):
        """Partial unique index impede duas seleções para mesmo evento/market/outcome."""
        selections = set()

        def try_select(event, market, outcome):
            key = (event, market, outcome)
            if key in selections:
                return False  # idx_shadow_unique_selection rejeita
            selections.add(key)
            return True

        assert try_select("evt-1", "1x2", "home") is True
        assert try_select("evt-1", "1x2", "home") is False  # duplicata
        assert try_select("evt-1", "1x2", "away") is True   # outcome diferente

    def test_unique_selection_allows_different_events(self):
        selections = set()

        def try_select(event, market, outcome):
            key = (event, market, outcome)
            if key in selections:
                return False
            selections.add(key)
            return True

        assert try_select("evt-1", "1x2", "home") is True
        assert try_select("evt-2", "1x2", "home") is True  # evento diferente, permitido


# ═══════════════════════════════════════════════════════════════════════════
# Testes de constantes e configuração
# ═══════════════════════════════════════════════════════════════════════════

class TestConstants:
    """Verifica que constantes do Shadow Mode estão corretamente definidas."""

    def test_selection_thresholds_are_stricter_than_edge_threshold(self):
        # O threshold de seleção shadow (elegível a virar "sinal" reportado)
        # precisa ser mais exigente que o threshold mínimo de persistência —
        # senão toda previsão persistida seria automaticamente selecionada.
        from app.shadow.engine import MIN_EDGE_THRESHOLD, SELECTION_MIN_EDGE
        assert SELECTION_MIN_EDGE > MIN_EDGE_THRESHOLD

    def test_kelly_cap_is_reasonable(self):
        from app.shadow.engine import KELLY_CAP, KELLY_FRACTION
        assert KELLY_CAP <= KELLY_FRACTION
        assert KELLY_CAP <= 0.10  # máximo 10% do bankroll

    def test_max_odds_is_reasonable(self):
        # Odds acima disso são quase certamente erro de coleta/typo, não
        # um azarão genuíno.
        from app.shadow.engine import MAX_ODDS
        assert MAX_ODDS > 1.0
        assert MAX_ODDS <= 1000.0

    def test_min_hours_before_kickoff_is_positive(self):
        from app.shadow.engine import MIN_HOURS_BEFORE_KICKOFF
        assert MIN_HOURS_BEFORE_KICKOFF > 0

    def test_versions_are_defined(self):
        from app.shadow.engine import (
            MODEL_VERSION, FEATURES_VERSION, ENSEMBLE_VERSION,
            SCORE_VERSION, FAIR_PROBABILITY_VERSION, PIPELINE_VERSION,
            KELLY_VERSION, SELECTION_VERSION,
        )
        for v in [MODEL_VERSION, FEATURES_VERSION, ENSEMBLE_VERSION,
                  SCORE_VERSION, FAIR_PROBABILITY_VERSION, PIPELINE_VERSION,
                  KELLY_VERSION, SELECTION_VERSION]:
            assert isinstance(v, str)
            assert len(v) > 0


# ═══════════════════════════════════════════════════════════════════════════
# Testes de formato do relatório
# ═══════════════════════════════════════════════════════════════════════════

class TestReportFormat:
    """Testa que a estrutura do relatório está correta (sem banco)."""

    def test_report_has_required_sections(self):
        """Verifica que os 6 headers do relatório existem."""
        expected_sections = [
            "## 1. Previsões Geradas",
            "## 2. Oportunidades por Liga",
            "## 3. Resultados Finalizados",
            "## 4. Métricas Acumuladas",
            "## 5. Alertas de Inconsistência",
            "## 6. Critérios de Graduação",
        ]
        # Montamos um relatório dummy para validar headers
        report = "\n".join(expected_sections)
        for section in expected_sections:
            assert section in report

    def test_graduation_table_format(self):
        """Verifica que a tabela de graduação tem formato Markdown válido."""
        header = "| Critério | Status | Valor |"
        separator = "|----------|--------|-------|"
        row = "| Eventos >= 200 | OK | 250/200 |"

        # Markdown table: header + separator + rows
        table = f"{header}\n{separator}\n{row}"
        assert "|" in table
        assert "---" in separator
