"""Pipeline de detecção de oportunidades de valor (value bets).

Conecta predições de modelos, odds de mercado e o motor de cálculo
(`app.value.engine`) para identificar, pontuar e materializar oportunidades.

Este módulo é o ponto de entrada operacional do Value Engine: recebe como
entrada um conjunto de predições de modelo + odds de casas para um evento,
calcula edge/EV/Edge Score, aplica filtros mínimos, e retorna as oportunidades
em formato pronto para persistência na tabela `value_opportunities` (§8 do
schema de banco).

O pipeline é stateless e puro (sem I/O) — a persistência e a integração com o
banco de dados ficam a cargo da camada de serviço ou job (não implementados
neste módulo).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.value.engine import (
    calculate_edge,
    calculate_edge_score,
    calculate_edge_score_detailed,
    calculate_ev,
    calculate_relative_edge,
    compress_edge,
    implied_probability,
    remove_vig_shin,
    remove_vig_power,
    EdgeScoreComponents,
    EdgeScoreResult,
)
from app.value.kelly import kelly_stake_pct


# ═══════════════════════════════════════════════════════════════════════════
# Data classes de entrada e saída
# ═══════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class BookmakerOdds:
    """Odds de uma casa de apostas para um outcome específico."""

    bookmaker: str
    decimal_odds: float
    updated_at: datetime | None = None


@dataclass(frozen=True)
class MarketOdds:
    """Odds de todas as casas para todos os outcomes de um mercado."""

    market: str
    outcomes: dict[str, list[BookmakerOdds]]
    # Mapa outcome → lista de odds por casa.
    # Ex.: {"home": [BookmakerOdds("bet365", 2.10), ...], "draw": [...], ...}


@dataclass(frozen=True)
class ModelPrediction:
    """Predição de modelo para um outcome."""

    market: str
    outcome: str
    probability: float
    confidence: float = 1.0
    ensemble_variance: float | None = None
    model_name: str = "ensemble"


@dataclass
class ValueOpportunity:
    """Uma oportunidade de valor identificada pelo pipeline.

    Contém todos os campos necessários para persistência na tabela
    `value_opportunities` e para exibição na interface do produto.
    """

    event_id: str
    league: str
    market: str
    outcome: str
    bookmaker: str
    decimal_odds: float
    implied_probability: float
    fair_probability: float
    model_probability: float
    edge: float
    relative_edge: float
    expected_value: float
    edge_score: float
    edge_score_components: dict[str, float]
    confidence: float
    kelly_stakes: dict[str, float]
    bookmakers_analyzed: int
    n_bookmakers_compatible: int
    event_start: datetime | None = None
    detected_at: datetime | None = None

    def is_top_pick(self) -> bool:
        """Retorna True se a oportunidade atinge o piso de destaque (§7.5)."""
        return self.edge_score >= 70.0

    def is_listed(self) -> bool:
        """Retorna True se a oportunidade merece listagem completa (§7.5)."""
        return self.edge_score >= 40.0


# ═══════════════════════════════════════════════════════════════════════════
# Pipeline principal de detecção
# ═══════════════════════════════════════════════════════════════════════════

def detect_opportunities(
    event_id: str,
    league: str,
    predictions: list[ModelPrediction],
    market_odds: list[MarketOdds],
    *,
    min_edge: float = 0.0,
    min_ev: float = 0.0,
    min_edge_score: float = 0.0,
    vig_method: str = "shin",
    historical_sample_size: int | None = None,
    recent_ece: float | None = None,
    line_movement_confirms: float | None = None,
    event_start: datetime | None = None,
) -> list[ValueOpportunity]:
    """Detecta oportunidades de valor comparando predições com odds de mercado.

    Pipeline (§7 e §8 do MODELING.md):
        1. Para cada mercado, calcula probabilidade justa via remoção de vig
           (Shin por padrão, Power como fallback).
        2. Para cada (mercado, outcome), calcula edge, EV e Edge Score usando
           a melhor odds disponível entre casas.
        3. Filtra por limiares mínimos (edge, EV, edge_score).
        4. Calcula Kelly fracionário para oportunidades com EV > 0.
        5. Retorna lista ordenada por edge_score desc.

    Args:
        event_id: identificador do evento.
        league: liga/competição do evento.
        predictions: predições do ensemble para cada outcome.
        market_odds: odds de mercado por casa e outcome.
        min_edge: edge mínimo para considerar (fração).
        min_ev: EV mínimo para considerar (fração).
        min_edge_score: edge score mínimo para considerar.
        vig_method: método de remoção de vig ("shin" ou "power").
        historical_sample_size: nº de dados históricos (para componente N).
        recent_ece: ECE recente do modelo na liga (para componente K).
        line_movement_confirms: direção do movimento de odds vs edge do modelo.
        event_start: data/hora de início do evento.

    Returns:
        Lista de ValueOpportunity ordenada por edge_score desc.
    """
    now = datetime.utcnow()
    opportunities: list[ValueOpportunity] = []

    # Indexa predições por (market, outcome).
    pred_map: dict[tuple[str, str], ModelPrediction] = {}
    for pred in predictions:
        pred_map[(pred.market, pred.outcome)] = pred

    for mkt_odds in market_odds:
        market = mkt_odds.market

        # --- 1. Calcula probabilidade justa do mercado ---
        # Coleta a melhor odds (mais alta) por outcome para remoção de vig.
        best_odds_per_outcome: dict[str, tuple[float, str]] = {}
        all_bookmakers_count = 0

        for outcome, bk_odds_list in mkt_odds.outcomes.items():
            if not bk_odds_list:
                continue
            all_bookmakers_count = max(all_bookmakers_count, len(bk_odds_list))
            # Melhor odds = maior retorno para o apostador.
            best = max(bk_odds_list, key=lambda o: o.decimal_odds)
            best_odds_per_outcome[outcome] = (best.decimal_odds, best.bookmaker)

        if not best_odds_per_outcome:
            continue

        # Probabilidades implícitas (usando a melhor odds por outcome).
        outcome_names = list(best_odds_per_outcome.keys())
        implied_probs = [implied_probability(best_odds_per_outcome[oc][0]) for oc in outcome_names]

        # Remoção de vig: Shin por padrão, Power como fallback (§7.2).
        try:
            if vig_method == "shin" and len(outcome_names) >= 3:
                fair_probs = remove_vig_shin(implied_probs)
            else:
                fair_probs = remove_vig_power(implied_probs)
        except (ValueError, RuntimeError):
            # Fallback: normalização simples em caso de erro numérico.
            total = sum(implied_probs)
            fair_probs = [p / total for p in implied_probs] if total > 0 else implied_probs

        fair_map = dict(zip(outcome_names, fair_probs))

        # Calcula overround para componente M.
        market_overround = sum(implied_probs) - 1.0

        # Dispersão de odds entre casas (para componente M alternativo).
        odds_values: list[list[float]] = []
        for oc in outcome_names:
            if oc in mkt_odds.outcomes:
                odds_values.append([o.decimal_odds for o in mkt_odds.outcomes[oc]])

        # --- 2. Para cada outcome, calcula edge/EV/EdgeScore ---
        for outcome in outcome_names:
            key = (market, outcome)
            pred = pred_map.get(key)
            if pred is None:
                continue

            fair_prob = fair_map.get(outcome, 0.0)
            if fair_prob <= 0:
                continue

            best_decimal_odds, best_bookmaker = best_odds_per_outcome[outcome]

            edge = calculate_edge(pred.probability, fair_prob)
            ev = calculate_ev(pred.probability, best_decimal_odds)
            relative_edge = calculate_relative_edge(pred.probability, fair_prob)

            # Conta casas com odds compatíveis (dentro de 5% da melhor odds).
            compatible_bookmakers = 0
            if outcome in mkt_odds.outcomes:
                for bk_odds in mkt_odds.outcomes[outcome]:
                    if bk_odds.decimal_odds >= best_decimal_odds * 0.95:
                        compatible_bookmakers += 1

            # Edge Score detalhado (7 componentes).
            score_result = calculate_edge_score_detailed(
                edge=edge,
                expected_value=ev,
                model_confidence=pred.confidence,
                ensemble_variance=pred.ensemble_variance,
                market_overround=market_overround if market_overround > 0 else None,
                historical_sample_size=historical_sample_size,
                recent_ece=recent_ece,
                line_movement_confirms=line_movement_confirms,
                n_bookmakers_compatible=compatible_bookmakers,
            )

            # --- 3. Filtra ---
            if edge < min_edge:
                continue
            if ev < min_ev:
                continue
            if score_result.score < min_edge_score:
                continue

            # --- 4. Kelly fracionário ---
            kelly = {}
            if ev > 0 and 0 < pred.probability < 1:
                kelly = kelly_stake_pct(pred.probability, best_decimal_odds)

            opportunities.append(ValueOpportunity(
                event_id=event_id,
                league=league,
                market=market,
                outcome=outcome,
                bookmaker=best_bookmaker,
                decimal_odds=best_decimal_odds,
                implied_probability=implied_probability(best_decimal_odds),
                fair_probability=fair_prob,
                model_probability=pred.probability,
                edge=edge,
                relative_edge=relative_edge,
                expected_value=ev,
                edge_score=score_result.score,
                edge_score_components=score_result.components.to_dict(),
                confidence=pred.confidence,
                kelly_stakes=kelly,
                bookmakers_analyzed=all_bookmakers_count,
                n_bookmakers_compatible=compatible_bookmakers,
                event_start=event_start,
                detected_at=now,
            ))

    # --- 5. Ordena por edge_score desc ---
    opportunities.sort(key=lambda o: o.edge_score, reverse=True)
    return opportunities


def filter_top_picks(
    opportunities: list[ValueOpportunity],
    n: int = 10,
    min_edge_score: float = 70.0,
) -> list[ValueOpportunity]:
    """Filtra as top N oportunidades com edge_score >= limiar.

    Usado pelo endpoint /top-picks (§7.5: EdgeScore >= 70 para destaque).

    Args:
        opportunities: lista de oportunidades (já ordenada por edge_score desc).
        n: número máximo de oportunidades a retornar.
        min_edge_score: edge score mínimo para qualificar como top pick.

    Returns:
        As N melhores oportunidades que atendem ao piso de score.
    """
    return [o for o in opportunities if o.edge_score >= min_edge_score][:n]
