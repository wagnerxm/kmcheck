"""Testes do pipeline de detecção de oportunidades de valor (app.value.opportunity).

Cobre:
  - Detecção básica: edge positivo gera oportunidade, negativo não.
  - Filtros: min_edge, min_ev, min_edge_score.
  - Ordenação: por edge_score desc.
  - Kelly: stakes calculados para oportunidades com EV > 0.
  - Múltiplas casas: melhor odds é usada, casas compatíveis contadas.
  - Top picks: filtragem por piso de edge_score.
  - Campos de saída: completude e sanidade.
"""
from datetime import datetime

import pytest

from app.value.opportunity import (
    BookmakerOdds,
    MarketOdds,
    ModelPrediction,
    ValueOpportunity,
    detect_opportunities,
    filter_top_picks,
)


def _make_market_odds(
    home_odds: list[tuple[str, float]],
    draw_odds: list[tuple[str, float]],
    away_odds: list[tuple[str, float]],
) -> list[MarketOdds]:
    """Cria MarketOdds para match_result a partir de listas de (bookmaker, odds)."""
    return [MarketOdds(
        market="match_result",
        outcomes={
            "home": [BookmakerOdds(bk, odds) for bk, odds in home_odds],
            "draw": [BookmakerOdds(bk, odds) for bk, odds in draw_odds],
            "away": [BookmakerOdds(bk, odds) for bk, odds in away_odds],
        },
    )]


def _make_predictions(
    home: float = 0.55, draw: float = 0.25, away: float = 0.20
) -> list[ModelPrediction]:
    return [
        ModelPrediction(market="match_result", outcome="home", probability=home, confidence=0.8),
        ModelPrediction(market="match_result", outcome="draw", probability=draw, confidence=0.8),
        ModelPrediction(market="match_result", outcome="away", probability=away, confidence=0.8),
    ]


class TestDetectOpportunities:
    def test_positive_edge_generates_opportunity(self):
        """Modelo a 55% e mercado justo a ~45% → edge positivo → oportunidade."""
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],  # implícita ~45%
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55, draw=0.25, away=0.20)

        opps = detect_opportunities(
            event_id="evt1", league="Serie A", predictions=preds,
            market_odds=odds, min_edge=0.01,
        )

        # Pelo menos a oportunidade "home" deve aparecer (edge de ~10 p.p.).
        home_opps = [o for o in opps if o.outcome == "home"]
        assert len(home_opps) >= 1
        assert home_opps[0].edge > 0

    def test_no_edge_no_opportunity(self):
        """Sem edge positivo, nenhuma oportunidade com filtro min_edge > 0."""
        odds = _make_market_odds(
            home_odds=[("bet365", 2.00)],  # implícita 50%
            draw_odds=[("bet365", 3.00)],
            away_odds=[("bet365", 4.00)],
        )
        # Modelo concorda com o mercado.
        preds = _make_predictions(home=0.50, draw=0.33, away=0.17)

        opps = detect_opportunities(
            event_id="evt2", league="PL", predictions=preds,
            market_odds=odds, min_edge=0.05,  # exige 5 p.p. de edge
        )

        # Nenhuma oportunidade com edge >= 5 p.p. porque modelo ≈ mercado.
        assert len(opps) == 0

    def test_min_ev_filter(self):
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55, draw=0.25, away=0.20)

        opps = detect_opportunities(
            event_id="evt3", league="PL", predictions=preds,
            market_odds=odds, min_ev=0.50,  # EV mínimo altíssimo
        )
        # Nenhuma oportunidade com EV >= 50%.
        assert len(opps) == 0

    def test_min_edge_score_filter(self):
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55, draw=0.25, away=0.20)

        opps = detect_opportunities(
            event_id="evt4", league="PL", predictions=preds,
            market_odds=odds, min_edge_score=99.0,  # piso altíssimo
        )
        assert len(opps) == 0

    def test_sorted_by_edge_score_desc(self):
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55, draw=0.25, away=0.20)

        opps = detect_opportunities(
            event_id="evt5", league="PL", predictions=preds, market_odds=odds,
        )

        if len(opps) >= 2:
            for i in range(len(opps) - 1):
                assert opps[i].edge_score >= opps[i + 1].edge_score

    def test_kelly_calculated_for_positive_ev(self):
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55, draw=0.25, away=0.20)

        opps = detect_opportunities(
            event_id="evt6", league="PL", predictions=preds, market_odds=odds,
        )

        positive_ev_opps = [o for o in opps if o.expected_value > 0]
        for o in positive_ev_opps:
            assert len(o.kelly_stakes) > 0
            assert "kelly_0.25" in o.kelly_stakes

    def test_best_odds_used(self):
        """Quando múltiplas casas, deve usar a melhor odds (mais alta)."""
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20), ("pinnacle", 2.30), ("betfair", 2.15)],
            draw_odds=[("bet365", 3.30), ("pinnacle", 3.40), ("betfair", 3.20)],
            away_odds=[("bet365", 3.40), ("pinnacle", 3.50), ("betfair", 3.30)],
        )
        preds = _make_predictions(home=0.55)

        opps = detect_opportunities(
            event_id="evt7", league="PL", predictions=preds, market_odds=odds,
        )

        home_opps = [o for o in opps if o.outcome == "home"]
        if home_opps:
            # Deve usar a Pinnacle (2.30), a mais alta.
            assert home_opps[0].decimal_odds == 2.30
            assert home_opps[0].bookmaker == "pinnacle"

    def test_bookmakers_analyzed_count(self):
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20), ("pinnacle", 2.30), ("betfair", 2.15)],
            draw_odds=[("bet365", 3.30), ("pinnacle", 3.40), ("betfair", 3.20)],
            away_odds=[("bet365", 3.40), ("pinnacle", 3.50), ("betfair", 3.30)],
        )
        preds = _make_predictions()

        opps = detect_opportunities(
            event_id="evt8", league="PL", predictions=preds, market_odds=odds,
        )

        for o in opps:
            assert o.bookmakers_analyzed == 3

    def test_compatible_bookmakers_counted(self):
        """Casas com odds dentro de 5% da melhor são contadas como compatíveis."""
        odds = _make_market_odds(
            home_odds=[
                ("bet365", 2.30),    # melhor
                ("pinnacle", 2.25),  # 2.25/2.30 = 0.978 > 0.95 → compatível
                ("betfair", 1.90),   # 1.90/2.30 = 0.826 < 0.95 → não compatível
            ],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55)

        opps = detect_opportunities(
            event_id="evt9", league="PL", predictions=preds, market_odds=odds,
        )

        home_opps = [o for o in opps if o.outcome == "home"]
        if home_opps:
            assert home_opps[0].n_bookmakers_compatible == 2  # bet365 + pinnacle

    def test_opportunity_fields_complete(self):
        """Todos os campos obrigatórios devem estar presentes e válidos."""
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55)

        opps = detect_opportunities(
            event_id="evt10", league="Serie A", predictions=preds, market_odds=odds,
        )

        for o in opps:
            assert o.event_id == "evt10"
            assert o.league == "Serie A"
            assert o.market == "match_result"
            assert o.outcome in ("home", "draw", "away")
            assert o.decimal_odds > 1.0
            assert 0.0 < o.implied_probability < 1.0
            assert 0.0 < o.fair_probability < 1.0
            assert 0.0 <= o.model_probability <= 1.0
            assert 0.0 <= o.edge_score <= 100.0
            assert o.detected_at is not None

    def test_vig_method_power(self):
        """Deve funcionar com vig_method='power'."""
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55)

        opps = detect_opportunities(
            event_id="evt11", league="PL", predictions=preds,
            market_odds=odds, vig_method="power",
        )
        # Não deve levantar erro.
        assert isinstance(opps, list)

    def test_empty_odds(self):
        """Sem odds, sem oportunidades."""
        preds = _make_predictions()
        opps = detect_opportunities(
            event_id="evt12", league="PL", predictions=preds, market_odds=[],
        )
        assert len(opps) == 0

    def test_extra_context_params(self):
        """Parâmetros de contexto (sample_size, ECE, line movement) não devem quebrar."""
        odds = _make_market_odds(
            home_odds=[("bet365", 2.20)],
            draw_odds=[("bet365", 3.30)],
            away_odds=[("bet365", 3.40)],
        )
        preds = _make_predictions(home=0.55)

        opps = detect_opportunities(
            event_id="evt13", league="PL", predictions=preds, market_odds=odds,
            historical_sample_size=2000,
            recent_ece=0.03,
            line_movement_confirms=0.5,
        )
        assert isinstance(opps, list)


class TestFilterTopPicks:
    def _make_opps(self, scores: list[float]) -> list[ValueOpportunity]:
        return [
            ValueOpportunity(
                event_id=f"evt_{i}", league="PL", market="match_result",
                outcome="home", bookmaker="bet365", decimal_odds=2.0,
                implied_probability=0.5, fair_probability=0.45,
                model_probability=0.55, edge=0.10, relative_edge=0.22,
                expected_value=0.10, edge_score=score,
                edge_score_components={}, confidence=0.8,
                kelly_stakes={"kelly_0.25": 2.5}, bookmakers_analyzed=3,
                n_bookmakers_compatible=2,
            )
            for i, score in enumerate(scores)
        ]

    def test_filters_by_min_score(self):
        opps = self._make_opps([80, 75, 65, 50, 30])
        top = filter_top_picks(opps, n=10, min_edge_score=70.0)
        assert len(top) == 2
        assert all(o.edge_score >= 70 for o in top)

    def test_limits_to_n(self):
        opps = self._make_opps([90, 85, 80, 75, 72])
        top = filter_top_picks(opps, n=3, min_edge_score=70.0)
        assert len(top) == 3

    def test_empty_when_none_qualify(self):
        opps = self._make_opps([60, 50, 40])
        top = filter_top_picks(opps, n=10, min_edge_score=70.0)
        assert len(top) == 0

    def test_is_top_pick_method(self):
        opps = self._make_opps([80, 50])
        assert opps[0].is_top_pick()
        assert not opps[1].is_top_pick()

    def test_is_listed_method(self):
        opps = self._make_opps([80, 50, 30])
        assert opps[0].is_listed()  # 80 >= 40
        assert opps[1].is_listed()  # 50 >= 40
        assert not opps[2].is_listed()  # 30 < 40
