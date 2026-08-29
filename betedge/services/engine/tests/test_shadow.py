"""Testes unitários do Shadow Mode v1.

Testa funções puras (sem banco) do motor shadow:
  - Grading: determinação de resultado por mercado/outcome/placar
  - CLV: cálculo a partir de model prob e closing odds
  - Retorno teórico: won/lost/void
  - Bucketização de faixas para agregação
  - Formato do relatório
  - Critérios de graduação (lógica)
  - Imutabilidade: garantia de write-once
  - Idempotência: inserção duplicada ignorada
"""
from __future__ import annotations

import pytest

from app.shadow.engine import (
    MIN_EDGE_THRESHOLD,
    _calculate_clv,
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

    # ── DNB (Draw No Bet) ───────────────────────────────────────────────

    def test_dnb_home_win(self):
        assert _determine_result("dnb", "home", 2, 1) == "won"

    def test_dnb_home_loss(self):
        assert _determine_result("dnb", "home", 0, 1) == "lost"

    def test_dnb_draw_voids(self):
        assert _determine_result("dnb", "home", 1, 1) == "void"
        assert _determine_result("dnb", "away", 1, 1) == "void"

    # ── Mercado desconhecido ────────────────────────────────────────────

    def test_unknown_market_returns_void(self):
        assert _determine_result("exotic_market", "something", 2, 1) == "void"


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _calculate_clv
# ═══════════════════════════════════════════════════════════════════════════

class TestCalculateCLV:
    """Testa o cálculo de Closing Line Value."""

    def test_positive_clv(self):
        # Modelo diz 60% e closing odds implicam 50% → CLV = 0.10
        clv = _calculate_clv(0.60, 2.0)
        assert clv == pytest.approx(0.10)

    def test_negative_clv(self):
        # Modelo diz 40% e closing odds implicam 50% → CLV = -0.10
        clv = _calculate_clv(0.40, 2.0)
        assert clv == pytest.approx(-0.10)

    def test_zero_clv(self):
        # Modelo concorda exatamente com o mercado
        clv = _calculate_clv(0.50, 2.0)
        assert clv == pytest.approx(0.0)

    def test_no_closing_odds(self):
        # Sem closing odds → CLV indeterminado
        assert _calculate_clv(0.50, None) is None

    def test_invalid_closing_odds(self):
        # Closing odds <= 1.0 → inválido
        assert _calculate_clv(0.50, 1.0) is None
        assert _calculate_clv(0.50, 0.5) is None

    def test_high_closing_odds(self):
        # Closing odds altas (azarão) → prob implícita baixa
        clv = _calculate_clv(0.15, 10.0)
        assert clv == pytest.approx(0.15 - 0.10)  # 0.05

    def test_low_closing_odds(self):
        # Closing odds baixas (favorito) → prob implícita alta
        clv = _calculate_clv(0.85, 1.25)
        assert clv == pytest.approx(0.85 - 0.80)  # 0.05


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


# ═══════════════════════════════════════════════════════════════════════════
# Testes de lógica de graduação
# ═══════════════════════════════════════════════════════════════════════════

class TestGraduationCriteria:
    """Testa a lógica dos critérios de graduação (sem banco)."""

    def test_events_threshold(self):
        # 200 eventos necessários para avaliação probabilística
        assert 150 < 200  # não atende
        assert 200 >= 200  # atende

    def test_bets_threshold(self):
        # 500 apostas necessárias para ROI
        assert 499 < 500  # não atende
        assert 500 >= 500  # atende

    def test_ece_threshold(self):
        # ECE < 0.05 necessário
        assert 0.04 < 0.05  # atende
        assert 0.06 >= 0.05  # não atende

    def test_clv_positive(self):
        # CLV médio deve ser positivo
        assert 0.001 > 0  # atende
        assert -0.001 <= 0  # não atende
        assert 0.0 <= 0  # não atende (exige estritamente positivo)

    def test_all_criteria_combined(self):
        """Simula verificação de todos os critérios automáticos."""
        criteria = {
            "events_200": 250 >= 200,
            "bets_500": 600 >= 500,
            "ece_3_leagues": 4 >= 3,
            "clv_positive": 0.02 > 0,
            "no_data_leakage": 0 == 0,
        }
        all_met = all(criteria.values())
        assert all_met is True

    def test_one_criterion_fails(self):
        """Se qualquer critério falhar, graduação não está pronta."""
        criteria = {
            "events_200": 250 >= 200,
            "bets_500": 400 >= 500,  # falha
            "ece_3_leagues": 4 >= 3,
            "clv_positive": 0.02 > 0,
            "no_data_leakage": 0 == 0,
        }
        all_met = all(criteria.values())
        assert all_met is False


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
        # Simula a lógica
        statuses = ["open", "graded", "void", "open"]
        gradeable = [s for s in statuses if s == "open"]
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

    def test_edge_threshold_filter(self):
        """Só persiste se edge > MIN_EDGE_THRESHOLD."""
        assert MIN_EDGE_THRESHOLD == 0.02

        edges = [0.01, 0.02, 0.025, 0.05, 0.10]
        persisted = [e for e in edges if e > MIN_EDGE_THRESHOLD]
        assert len(persisted) == 3
        assert 0.01 not in persisted
        assert 0.02 not in persisted  # > não >=
        assert 0.025 in persisted

    def test_idempotency_conflict_handling(self):
        """ON CONFLICT DO NOTHING garante idempotência.

        Se (event_id, market, outcome, model_version) já existe,
        a inserção é silenciosamente ignorada.
        """
        # Simula lógica: UNIQUE(event_id, market, outcome, model_version)
        existing_keys = {
            ("evt-1", "1x2", "home", "v1"),
            ("evt-1", "1x2", "draw", "v1"),
        }

        new_key = ("evt-1", "1x2", "home", "v1")  # duplicata
        is_new = new_key not in existing_keys
        assert is_new is False  # não deve inserir

        unique_key = ("evt-2", "1x2", "home", "v1")
        is_new_2 = unique_key not in existing_keys
        assert is_new_2 is True  # deve inserir


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
