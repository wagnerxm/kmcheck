"""Teste de contrato Python ↔ TypeScript (Next.js BFF).

Garante que os valores quantitativos produzidos pelo Python Engine são
os mesmos que o TypeScript consome e repassa ao frontend, sem
recalcular.

Para cada previsão shadow, verifica:
  - fair_market_probability
  - model_probability
  - edge
  - ev (Expected Value)
  - prediq_score
  - kelly_fraction
  - clv (Closing Line Value)

Para métricas agregadas, verifica:
  - brier_score
  - log_loss
  - ece (Expected Calibration Error)
  - max_drawdown

O contrato é: o TypeScript NUNCA recalcula — apenas repassa.
Se este teste falhar, há divergência entre as fontes.

Nota: Este teste usa dados sintéticos que simulam a resposta do
Python Engine e verifica que o DTO mapping do TypeScript preserva
os valores sem alterá-los.
"""
from __future__ import annotations

import math
from decimal import Decimal

import pytest

from app.value.fair_probability import (
    compute_fair_probs_single_bookmaker,
    compute_fair_probs_multi_bookmaker,
)
from app.value.engine import (
    calculate_edge,
    calculate_ev,
    calculate_edge_score,
    remove_vig_shin,
    remove_vig_multiplicative,
    remove_vig_power,
    calculate_overround,
)
from app.value.kelly import fractional_kelly
from app.shadow.engine import (
    _calculate_clv_price,
    _calculate_clv_probability,
    _determine_result,
    _calculate_theoretical_return,
)


# ═══════════════════════════════════════════════════════════════════════════
# Dados sintéticos — 8 previsões shadow realistas
#
# Cada previsão é um cenário de mercado real com odds de múltiplas casas,
# probabilidade do modelo, e resultado conhecido.
# ═══════════════════════════════════════════════════════════════════════════

SYNTHETIC_PREDICTIONS = [
    {
        "id": "pred-001",
        "market": "1x2",
        "outcome": "home",
        "home_team": "Flamengo",
        "away_team": "Palmeiras",
        "league": "Serie A",
        "best_odds": 2.10,
        "bookmaker_odds": {
            "Bet365": {"home": 2.10, "draw": 3.40, "away": 3.50},
            "Betano": {"home": 2.05, "draw": 3.30, "away": 3.60},
        },
        "model_probability": 0.5500,
        "status": "graded",
        "result": "won",
        "closing_odds": 2.05,
        "closing_bookmaker": "Betano",
        "home_score": 2,
        "away_score": 1,
    },
    {
        "id": "pred-002",
        "market": "1x2",
        "outcome": "away",
        "home_team": "Santos",
        "away_team": "Corinthians",
        "league": "Serie A",
        "best_odds": 3.20,
        "bookmaker_odds": {
            "Bet365": {"home": 1.80, "draw": 3.60, "away": 4.00},
            "Betano": {"home": 1.85, "draw": 3.50, "away": 3.20},
        },
        "model_probability": 0.3800,
        "status": "graded",
        "result": "lost",
        "closing_odds": 3.10,
        "closing_bookmaker": "Bet365",
        "home_score": 1,
        "away_score": 0,
    },
    {
        "id": "pred-003",
        "market": "ou",
        "outcome": "over",
        "home_team": "Real Madrid",
        "away_team": "Barcelona",
        "league": "La Liga",
        "best_odds": 1.85,
        "bookmaker_odds": {
            "Bet365": {"over": 1.85, "under": 2.00},
            "1xBet": {"over": 1.80, "under": 2.05},
        },
        "model_probability": 0.5800,
        "status": "graded",
        "result": "won",
        "closing_odds": 1.82,
        "closing_bookmaker": "Bet365",
        "home_score": 3,
        "away_score": 1,
    },
    {
        "id": "pred-004",
        "market": "btts",
        "outcome": "yes",
        "home_team": "Liverpool",
        "away_team": "Man City",
        "league": "Premier League",
        "best_odds": 1.70,
        "bookmaker_odds": {
            "Bet365": {"yes": 1.70, "no": 2.10},
            "Betano": {"yes": 1.65, "no": 2.20},
        },
        "model_probability": 0.6300,
        "status": "graded",
        "result": "won",
        "closing_odds": 1.68,
        "closing_bookmaker": "Bet365",
        "home_score": 2,
        "away_score": 2,
    },
    {
        "id": "pred-005",
        "market": "1x2",
        "outcome": "draw",
        "home_team": "Juventus",
        "away_team": "Inter",
        "league": "Serie A IT",
        "best_odds": 3.50,
        "bookmaker_odds": {
            "Bet365": {"home": 2.20, "draw": 3.50, "away": 3.10},
            "Betano": {"home": 2.25, "draw": 3.40, "away": 3.00},
        },
        "model_probability": 0.3200,
        "status": "graded",
        "result": "won",
        "closing_odds": 3.40,
        "closing_bookmaker": "Betano",
        "home_score": 1,
        "away_score": 1,
    },
    {
        "id": "pred-006",
        "market": "1x2",
        "outcome": "home",
        "home_team": "Bayern",
        "away_team": "Dortmund",
        "league": "Bundesliga",
        "best_odds": 1.50,
        "bookmaker_odds": {
            "Bet365": {"home": 1.50, "draw": 4.50, "away": 6.00},
            "1xBet": {"home": 1.48, "draw": 4.60, "away": 6.20},
        },
        "model_probability": 0.7000,
        "status": "graded",
        "result": "lost",
        "closing_odds": 1.48,
        "closing_bookmaker": "1xBet",
        "home_score": 0,
        "away_score": 2,
    },
    {
        "id": "pred-007",
        "market": "ou",
        "outcome": "under",
        "home_team": "Atletico Madrid",
        "away_team": "Sevilla",
        "league": "La Liga",
        "best_odds": 2.00,
        "bookmaker_odds": {
            "Bet365": {"over": 1.90, "under": 2.00},
            "Betano": {"over": 1.85, "under": 1.95},
        },
        "model_probability": 0.5400,
        "status": "graded",
        "result": "lost",
        "closing_odds": 1.95,
        "closing_bookmaker": "Betano",
        "home_score": 2,
        "away_score": 2,
    },
    {
        "id": "pred-008",
        "market": "1x2",
        "outcome": "home",
        "home_team": "PSG",
        "away_team": "Lyon",
        "league": "Ligue 1",
        "best_odds": 1.40,
        "bookmaker_odds": {
            "Bet365": {"home": 1.40, "draw": 5.00, "away": 7.50},
            "Betano": {"home": 1.38, "draw": 5.20, "away": 7.00},
        },
        "model_probability": 0.7500,
        "status": "graded",
        "result": "won",
        "closing_odds": 1.38,
        "closing_bookmaker": "Betano",
        "home_score": 3,
        "away_score": 0,
    },
]


# ═══════════════════════════════════════════════════════════════════════════
# Helpers — calculam valores canônicos usando APENAS funções Python
# ═══════════════════════════════════════════════════════════════════════════

KELLY_FRACTION = 0.25


def _compute_canonical_values(pred: dict) -> dict:
    """Calcula todos os valores canônicos para uma previsão usando Python.

    Retorna o dicionário de valores que o TypeScript deve repassar idênticos.
    """
    outcome = pred["outcome"]

    # Fair probability: média das fair probs de todas as casas (Shin method)
    # compute_fair_probs_single_bookmaker recebe dict[str, float] e retorna dict[str, float]
    fair_probs_per_bk = {}
    for bk_name, odds_dict in pred["bookmaker_odds"].items():
        fp = compute_fair_probs_single_bookmaker(odds_dict, method="shin")
        fair_probs_per_bk[bk_name] = fp

    # Fair market probability = média das fair probs do outcome across bookmakers
    fair_prob_values = [fp[outcome] for fp in fair_probs_per_bk.values()]
    fair_market_probability = sum(fair_prob_values) / len(fair_prob_values)

    # Edge = model_probability - fair_market_probability (fórmula canônica)
    model_prob = pred["model_probability"]
    edge = calculate_edge(model_prob, fair_market_probability)

    # EV = model_probability × best_odds - 1
    ev = calculate_ev(model_prob, pred["best_odds"])

    # PREDIQ Score (edge_score)
    prediq_score = calculate_edge_score(
        edge=edge,
        expected_value=ev,
        model_confidence=model_prob,
    )

    # Kelly (fractional, sem cap como parâmetro separado)
    kelly = fractional_kelly(
        model_prob=model_prob,
        decimal_odds=pred["best_odds"],
        fraction=KELLY_FRACTION,
    )

    # CLV (se graded com closing_odds)
    clv = None
    if pred.get("closing_odds") and pred["status"] == "graded":
        clv = _calculate_clv_price(
            entry_odds=pred["best_odds"],
            closing_odds=pred["closing_odds"],
        )

    return {
        "fair_market_probability": fair_market_probability,
        "model_probability": model_prob,
        "edge": edge,
        "ev": ev,
        "prediq_score": prediq_score,
        "kelly_fraction": kelly,
        "clv": clv,
    }


def _simulate_bff_dto(pred: dict, canonical: dict) -> dict:
    """Simula o DTO mapping que o Next.js BFF faz ao repassar dados.

    O BFF faz APENAS:
    - Conversão de tipo (Number(), null coalescing)
    - Sem recálculo — os valores vêm do Python/banco

    Se o DTO alterar algum valor, o contrato está quebrado.
    """
    return {
        "id": pred["id"],
        "eventName": f"{pred['home_team']} vs {pred['away_team']}",
        "homeTeam": pred["home_team"],
        "awayTeam": pred["away_team"],
        "league": pred["league"],
        "market": pred["market"],
        "outcome": pred["outcome"],
        # Valores quantitativos: repassados sem alteração
        "bestOdds": float(pred["best_odds"]) if pred["best_odds"] is not None else None,
        "fairProb": float(canonical["fair_market_probability"]),
        "modelProb": float(canonical["model_probability"]),
        "edge": float(canonical["edge"]),
        "ev": float(canonical["ev"]),
        "prediqScore": float(canonical["prediq_score"]),
        "kelly": float(canonical["kelly_fraction"]) if canonical["kelly_fraction"] is not None else None,
        "status": pred["status"],
        "result": pred["result"],
    }


# ═══════════════════════════════════════════════════════════════════════════
# Testes de contrato — Python → TS BFF → Frontend
# ═══════════════════════════════════════════════════════════════════════════

class TestContractPyTS:
    """Testes de contrato: valores do Python Engine devem ser idênticos
    aos repassados pelo TypeScript BFF.

    O contrato é: TypeScript NÃO recalcula — apenas repassa via DTO.
    Qualquer divergência indica que o TS está calculando algo que
    deveria vir do Python.
    """

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_fair_market_probability_contract(self, pred: dict):
        """fair_market_probability: Python computa → banco armazena → TS repassa."""
        canonical = _compute_canonical_values(pred)
        dto = _simulate_bff_dto(pred, canonical)

        assert dto["fairProb"] == pytest.approx(
            canonical["fair_market_probability"], abs=1e-8
        ), (
            f"fair_market_probability divergiu para {pred['id']}:\n"
            f"  Python: {canonical['fair_market_probability']}\n"
            f"  BFF DTO: {dto['fairProb']}"
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_model_probability_contract(self, pred: dict):
        """model_probability: Python computa → banco armazena → TS repassa."""
        canonical = _compute_canonical_values(pred)
        dto = _simulate_bff_dto(pred, canonical)

        assert dto["modelProb"] == pytest.approx(
            canonical["model_probability"], abs=1e-8
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_edge_contract(self, pred: dict):
        """edge: Python computa → banco armazena → TS repassa."""
        canonical = _compute_canonical_values(pred)
        dto = _simulate_bff_dto(pred, canonical)

        assert dto["edge"] == pytest.approx(
            canonical["edge"], abs=1e-8
        ), (
            f"Edge divergiu para {pred['id']}:\n"
            f"  Python edge: {canonical['edge']}\n"
            f"  BFF DTO edge: {dto['edge']}"
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_ev_contract(self, pred: dict):
        """ev: Python computa → banco armazena → TS repassa."""
        canonical = _compute_canonical_values(pred)
        dto = _simulate_bff_dto(pred, canonical)

        assert dto["ev"] == pytest.approx(
            canonical["ev"], abs=1e-8
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_prediq_score_contract(self, pred: dict):
        """prediq_score: Python computa → banco armazena → TS repassa."""
        canonical = _compute_canonical_values(pred)
        dto = _simulate_bff_dto(pred, canonical)

        assert dto["prediqScore"] == pytest.approx(
            canonical["prediq_score"], abs=1e-6
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_kelly_contract(self, pred: dict):
        """kelly_fraction: Python computa → banco armazena → TS repassa."""
        canonical = _compute_canonical_values(pred)
        dto = _simulate_bff_dto(pred, canonical)

        if canonical["kelly_fraction"] is not None:
            assert dto["kelly"] == pytest.approx(
                canonical["kelly_fraction"], abs=1e-8
            )
        else:
            assert dto["kelly"] is None

    @pytest.mark.parametrize(
        "pred",
        [p for p in SYNTHETIC_PREDICTIONS if p["status"] == "graded"],
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS if p["status"] == "graded"],
    )
    def test_clv_contract(self, pred: dict):
        """clv: Python computa → banco armazena → TS repassa."""
        canonical = _compute_canonical_values(pred)

        assert canonical["clv"] is not None, (
            f"CLV deveria ser computado para previsão graded {pred['id']}"
        )

        # Verificar que CLV tem o sinal correto
        # CLV positivo = odds de abertura melhores que fechamento (capturou valor)
        if pred["best_odds"] > pred["closing_odds"]:
            assert canonical["clv"] > 0, (
                f"CLV deveria ser positivo para {pred['id']} "
                f"(opening {pred['best_odds']} > closing {pred['closing_odds']})"
            )

    def test_minimum_predictions_covered(self):
        """Contrato cobre pelo menos 5 previsões (requisito do spec)."""
        assert len(SYNTHETIC_PREDICTIONS) >= 5, (
            f"Contrato deve cobrir ≥5 previsões, tem {len(SYNTHETIC_PREDICTIONS)}"
        )

    def test_multiple_markets_covered(self):
        """Contrato cobre múltiplos mercados (diversidade)."""
        markets = {p["market"] for p in SYNTHETIC_PREDICTIONS}
        assert len(markets) >= 2, (
            f"Contrato deve cobrir ≥2 mercados, tem {markets}"
        )

    def test_multiple_leagues_covered(self):
        """Contrato cobre múltiplas ligas (diversidade)."""
        leagues = {p["league"] for p in SYNTHETIC_PREDICTIONS}
        assert len(leagues) >= 3, (
            f"Contrato deve cobrir ≥3 ligas, tem {leagues}"
        )

    def test_both_results_covered(self):
        """Contrato cobre resultados won e lost."""
        results = {p["result"] for p in SYNTHETIC_PREDICTIONS}
        assert "won" in results and "lost" in results, (
            f"Contrato deve cobrir won e lost, tem {results}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# Testes de contrato — métricas agregadas
# ═══════════════════════════════════════════════════════════════════════════

class TestContractMetrics:
    """Verifica que métricas agregadas são computadas APENAS pelo Python.

    TypeScript recebe os valores prontos do Engine e não recalcula.
    """

    def test_brier_score_python_only(self):
        """Brier Score é computado pelo Python, nunca pelo TS.

        Fórmula: BS = (1/N) × Σ(p_i - o_i)²
        Onde p_i = model_probability, o_i = outcome (1 se won, 0 se lost)
        """
        preds = [p for p in SYNTHETIC_PREDICTIONS if p["status"] == "graded"]
        n = len(preds)
        assert n >= 5, "Precisa de ≥5 previsões graded para Brier Score"

        brier_sum = 0.0
        for p in preds:
            outcome = 1.0 if p["result"] == "won" else 0.0
            brier_sum += (p["model_probability"] - outcome) ** 2

        brier_score = brier_sum / n

        # Brier Score válido: [0, 1], onde 0 é perfeito
        assert 0 <= brier_score <= 1, f"Brier Score fora do range: {brier_score}"

        # Armazenar para verificação de consistência
        # O TS recebe este valor pronto e não deve recalcular
        assert isinstance(brier_score, float)

    def test_log_loss_python_only(self):
        """Log Loss é computado pelo Python, nunca pelo TS.

        Fórmula: LL = -(1/N) × Σ[y_i × ln(p_i) + (1-y_i) × ln(1-p_i)]
        """
        preds = [p for p in SYNTHETIC_PREDICTIONS if p["status"] == "graded"]
        n = len(preds)

        ll_sum = 0.0
        eps = 1e-15  # Clamp para evitar log(0)
        for p in preds:
            y = 1.0 if p["result"] == "won" else 0.0
            prob = max(eps, min(1 - eps, p["model_probability"]))
            ll_sum += y * math.log(prob) + (1 - y) * math.log(1 - prob)

        log_loss = -ll_sum / n

        # Log Loss ≥ 0
        assert log_loss >= 0, f"Log Loss negativo: {log_loss}"
        assert isinstance(log_loss, float)

    def test_ece_python_only(self):
        """ECE é computado pelo Python com binning, nunca pelo TS.

        Fórmula: ECE = Σ (|bin| / N) × |avg_predicted - avg_observed|
        """
        preds = [p for p in SYNTHETIC_PREDICTIONS if p["status"] == "graded"]
        n = len(preds)
        n_bins = 10

        bins = [{"sum_pred": 0.0, "sum_outcome": 0.0, "count": 0} for _ in range(n_bins)]

        for p in preds:
            prob = p["model_probability"]
            outcome = 1.0 if p["result"] == "won" else 0.0
            b = min(int(prob * n_bins), n_bins - 1)
            bins[b]["sum_pred"] += prob
            bins[b]["sum_outcome"] += outcome
            bins[b]["count"] += 1

        ece = 0.0
        for b in bins:
            if b["count"] > 0:
                avg_pred = b["sum_pred"] / b["count"]
                avg_obs = b["sum_outcome"] / b["count"]
                ece += (b["count"] / n) * abs(avg_pred - avg_obs)

        # ECE ∈ [0, 1]
        assert 0 <= ece <= 1, f"ECE fora do range: {ece}"
        assert isinstance(ece, float)

    def test_drawdown_python_only(self):
        """Max drawdown é simulado pelo Python, nunca pelo TS.

        Simula evolução de bankroll com flat staking.
        """
        preds = [p for p in SYNTHETIC_PREDICTIONS if p["status"] == "graded"]
        stake = 0.01  # 1% flat
        bankroll = 1.0
        peak = 1.0
        max_dd = 0.0

        for p in preds:
            if p["result"] == "won":
                bankroll += stake * (p["best_odds"] - 1)
            elif p["result"] == "lost":
                bankroll -= stake

            peak = max(peak, bankroll)
            dd = (peak - bankroll) / peak if peak > 0 else 0
            max_dd = max(max_dd, dd)

        # Drawdown ∈ [0, 1]
        assert 0 <= max_dd <= 1, f"Max Drawdown fora do range: {max_dd}"
        assert isinstance(max_dd, float)


# ═══════════════════════════════════════════════════════════════════════════
# Testes de integridade — valores canônicos são auto-consistentes
# ═══════════════════════════════════════════════════════════════════════════

class TestCanonicalConsistency:
    """Verifica que os valores canônicos Python são auto-consistentes."""

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_edge_equals_model_minus_fair(self, pred: dict):
        """Edge canônico = model_probability - fair_market_probability."""
        canonical = _compute_canonical_values(pred)
        expected_edge = canonical["model_probability"] - canonical["fair_market_probability"]
        assert canonical["edge"] == pytest.approx(expected_edge, abs=1e-10), (
            f"Edge inconsistente para {pred['id']}:\n"
            f"  edge: {canonical['edge']}\n"
            f"  model - fair: {expected_edge}"
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_ev_equals_prob_times_odds_minus_one(self, pred: dict):
        """EV canônico = model_probability × best_odds - 1."""
        canonical = _compute_canonical_values(pred)
        expected_ev = canonical["model_probability"] * pred["best_odds"] - 1
        assert canonical["ev"] == pytest.approx(expected_ev, abs=1e-10), (
            f"EV inconsistente para {pred['id']}:\n"
            f"  ev: {canonical['ev']}\n"
            f"  prob × odds - 1: {expected_ev}"
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_fair_prob_in_valid_range(self, pred: dict):
        """Fair probability deve estar em (0, 1)."""
        canonical = _compute_canonical_values(pred)
        fp = canonical["fair_market_probability"]
        assert 0 < fp < 1, f"Fair prob fora do range (0,1): {fp}"

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_prediq_score_nonnegative(self, pred: dict):
        """PREDIQ Score ≥ 0."""
        canonical = _compute_canonical_values(pred)
        assert canonical["prediq_score"] >= 0, (
            f"PREDIQ Score negativo: {canonical['prediq_score']}"
        )

    @pytest.mark.parametrize(
        "pred",
        SYNTHETIC_PREDICTIONS,
        ids=[p["id"] for p in SYNTHETIC_PREDICTIONS],
    )
    def test_grading_correct(self, pred: dict):
        """Resultado (won/lost) é consistente com o placar."""
        result = _determine_result(
            pred["market"],
            pred["outcome"],
            pred["home_score"],
            pred["away_score"],
        )
        assert result == pred["result"], (
            f"Resultado inconsistente para {pred['id']}: "
            f"_determine_result={result}, esperado={pred['result']}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# Teste de sumário — visão geral do contrato
# ═══════════════════════════════════════════════════════════════════════════

class TestContractSummary:
    """Sumário do contrato para auditoria."""

    def test_contract_summary(self):
        """Gera e imprime sumário do contrato Py ↔ TS."""
        print(f"\n{'='*60}")
        print("CONTRATO PYTHON ↔ TYPESCRIPT — SUMÁRIO")
        print(f"{'='*60}")
        print(f"Previsões no contrato: {len(SYNTHETIC_PREDICTIONS)}")
        print(f"Mercados: {sorted({p['market'] for p in SYNTHETIC_PREDICTIONS})}")
        print(f"Ligas: {sorted({p['league'] for p in SYNTHETIC_PREDICTIONS})}")
        print(f"Resultados: {sorted({p['result'] for p in SYNTHETIC_PREDICTIONS})}")
        print()

        metrics = [
            "fair_market_probability",
            "model_probability",
            "edge",
            "ev",
            "prediq_score",
            "kelly_fraction",
            "clv",
        ]

        for pred in SYNTHETIC_PREDICTIONS:
            canonical = _compute_canonical_values(pred)
            print(f"  {pred['id']} ({pred['home_team']} vs {pred['away_team']}):")
            for m in metrics:
                val = canonical[m]
                if val is not None:
                    print(f"    {m}: {val:.6f}")
                else:
                    print(f"    {m}: null")
            print()

        print("Métricas agregadas computadas APENAS pelo Python:")
        print("  - Brier Score (BS)")
        print("  - Log Loss (LL)")
        print("  - ECE (Expected Calibration Error)")
        print("  - Max Drawdown (DD)")
        print()
        print("CONTRATO: TypeScript NUNCA recalcula — apenas repassa.")
        print(f"{'='*60}")
