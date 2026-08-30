"""Serviço centralizado de cálculo de probabilidade justa (fair probability).

Este módulo é o ÚNICO ponto de cálculo de fair probability do pipeline PREDIQ.
Toda chamada — orchestrator, Model Audit, Value Engine, backtest — deve usar
estas funções para evitar divergência entre produção e auditoria.

Fluxo:
    1. Para cada mercado, coleta odds de todos os bookmakers
    2. Para cada bookmaker, converte odds → implied probs → remove vig (Shin
       preferencial para ≥3 outcomes, multiplicative como fallback)
    3. Agrega fair probabilities entre bookmakers (média simples, renormalizada)
    4. Retorna dict {outcome_code: fair_probability}

Regra fundamental do PIPELINE_CONTRACT.md:
    - Edge = model_probability - fair_market_probability
    - EV = model_probability * best_decimal_odds - 1
    - A melhor odd serve para EV e retorno potencial, MAS NÃO para determinar
      isoladamente a fair probability do mercado
    - A fair probability DEVE ser calculada com remoção de vig sobre todas as
      outcomes de um mesmo bookmaker, e depois agregada entre bookmakers
"""
from __future__ import annotations

import logging
from typing import Literal

from app.value.engine import (
    implied_probability,
    remove_vig_shin,
    remove_vig_multiplicative,
    remove_vig_power,
    calculate_overround,
)

logger = logging.getLogger(__name__)

VigMethod = Literal["shin", "power", "multiplicative"]


def compute_fair_probs_single_bookmaker(
    odds_by_outcome: dict[str, float],
    method: VigMethod = "shin",
) -> dict[str, float]:
    """Calcula probabilidades justas de UM bookmaker para UM mercado.

    Converte odds decimais de todos os outcomes em implied probs, remove
    o vig usando o método especificado, e retorna as fair probs.

    Args:
        odds_by_outcome: {outcome_code: decimal_odds} para todas as outcomes
            de um mercado de um único bookmaker.
        method: método de remoção de vig ("shin", "power", "multiplicative").

    Returns:
        {outcome_code: fair_probability} com sum ≈ 1.0

    Raises:
        ValueError: se odds_by_outcome estiver vazio ou contiver odds ≤ 1.0.
    """
    if not odds_by_outcome:
        raise ValueError("odds_by_outcome não pode ser vazio.")

    outcomes = list(odds_by_outcome.keys())
    implied = [implied_probability(odds_by_outcome[oc]) for oc in outcomes]

    try:
        if method == "shin" and len(outcomes) >= 3:
            fair = remove_vig_shin(implied)
        elif method == "power":
            fair = remove_vig_power(implied)
        else:
            fair = remove_vig_multiplicative(implied)
    except (ValueError, RuntimeError):
        # Fallback para normalização multiplicativa em caso de erro numérico
        total = sum(implied)
        if total > 0:
            fair = [p / total for p in implied]
        else:
            fair = implied
        logger.warning(
            "Falha na remoção de vig por '%s', usando multiplicative fallback. "
            "Outcomes: %s, implied: %s",
            method, outcomes, implied,
        )

    return dict(zip(outcomes, fair, strict=True))


def compute_fair_probs_multi_bookmaker(
    bookmaker_odds: dict[str, dict[str, float]],
    method: VigMethod = "shin",
) -> dict[str, float]:
    """Calcula probabilidade justa agregada de MÚLTIPLOS bookmakers para UM mercado.

    Para cada bookmaker, remove o vig individualmente (usando todas as outcomes
    do mercado daquela casa), depois agrega as fair probs entre casas por média
    simples e renormaliza para garantir sum = 1.

    Este é o cálculo que o orchestrator, Model Audit, e backtest DEVEM usar
    para calcular a fair_market_probability do Edge.

    Args:
        bookmaker_odds: {bookmaker_name: {outcome_code: decimal_odds}}
            Ex.: {"bet365": {"home": 2.10, "draw": 3.40, "away": 3.20},
                  "pinnacle": {"home": 2.15, "draw": 3.30, "away": 3.25}}

    Returns:
        {outcome_code: fair_probability} com sum ≈ 1.0

    Raises:
        ValueError: se bookmaker_odds estiver vazio ou nenhum bookmaker tiver
            outcomes válidos.
    """
    if not bookmaker_odds:
        raise ValueError("bookmaker_odds não pode ser vazio.")

    # Acumula fair probs por outcome para depois fazer média
    outcome_accum: dict[str, list[float]] = {}
    n_valid_bookmakers = 0

    for bookmaker, odds_by_outcome in bookmaker_odds.items():
        if not odds_by_outcome:
            continue

        try:
            fair = compute_fair_probs_single_bookmaker(odds_by_outcome, method)
            n_valid_bookmakers += 1
            for outcome, prob in fair.items():
                outcome_accum.setdefault(outcome, []).append(prob)
        except (ValueError, RuntimeError) as e:
            logger.warning(
                "Bookmaker '%s' excluído do cálculo de fair prob: %s", bookmaker, e
            )
            continue

    if not outcome_accum or n_valid_bookmakers == 0:
        raise ValueError(
            "Nenhum bookmaker produziu fair probabilities válidas. "
            f"Input: {list(bookmaker_odds.keys())}"
        )

    # Média simples por outcome
    consensus: dict[str, float] = {}
    for outcome, probs in outcome_accum.items():
        consensus[outcome] = sum(probs) / len(probs)

    # Renormalização final para garantir sum = 1.0
    total = sum(consensus.values())
    if total > 0:
        consensus = {oc: p / total for oc, p in consensus.items()}

    return consensus


def compute_fair_probs_for_event(
    event_odds: dict[str, dict[str, dict[str, float]]],
    method: VigMethod = "shin",
) -> dict[str, dict[str, float]]:
    """Calcula fair probabilities para TODOS os mercados de um evento.

    Ponto de entrada principal do serviço. Recebe a árvore de odds no formato
    retornado por `_fetch_event_odds()` do orchestrator:

        {market_code: {bookmaker_name: {outcome_code: decimal_odds}}}

    Retorna:
        {market_code: {outcome_code: fair_probability}}

    Cada fair probability é calculada via remoção de vig por bookmaker + média
    entre bookmakers, conforme descrito em `compute_fair_probs_multi_bookmaker`.
    """
    result: dict[str, dict[str, float]] = {}

    for market_code, bookmaker_odds in event_odds.items():
        try:
            fair = compute_fair_probs_multi_bookmaker(bookmaker_odds, method)
            result[market_code] = fair
        except (ValueError, RuntimeError) as e:
            logger.warning(
                "Não foi possível calcular fair probs para mercado '%s': %s",
                market_code, e,
            )
            continue

    return result


def compute_overround_per_bookmaker(
    bookmaker_odds: dict[str, dict[str, float]],
) -> dict[str, float]:
    """Calcula o overround de cada bookmaker para um mercado.

    Útil para auditoria e relatórios.

    Args:
        bookmaker_odds: {bookmaker_name: {outcome_code: decimal_odds}}

    Returns:
        {bookmaker_name: overround_fraction}
    """
    result: dict[str, float] = {}
    for bookmaker, odds_by_outcome in bookmaker_odds.items():
        if not odds_by_outcome:
            continue
        implied = [implied_probability(odds) for odds in odds_by_outcome.values()]
        result[bookmaker] = calculate_overround(implied)
    return result


def compute_market_overround(
    bookmaker_odds: dict[str, dict[str, float]],
) -> float:
    """Calcula o overround médio de um mercado entre todos os bookmakers.

    Args:
        bookmaker_odds: {bookmaker_name: {outcome_code: decimal_odds}}

    Returns:
        Overround médio como fração (ex.: 0.05 = 5%).
    """
    overrounds = compute_overround_per_bookmaker(bookmaker_odds)
    if not overrounds:
        return 0.0
    return sum(overrounds.values()) / len(overrounds)
