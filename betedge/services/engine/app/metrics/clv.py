"""Closing Line Value (CLV) — mede se a odd obtida na aposta era melhor que a odd de fechamento.

Conceito
---------
CLV é considerada, na literatura de apostas esportivas quantitativas, o
melhor preditor de longo prazo de lucratividade de um apostador — mais
confiável que o resultado individual de qualquer aposta (que é dominado por
variância de curto prazo). A intuição: se você consistentemente consegue
odds melhores do que a odd de fechamento do mercado (o consenso final, mais
informado, do "dinheiro esperto"), você está sistematicamente identificando
valor antes do mercado se ajustar.

Definição
---------
Para uma aposta feita em `prediction_odds` (odds decimais no momento da
aposta) e a odd de fechamento correspondente `closing_odds`:

    CLV_pct = (prediction_odds / closing_odds - 1) * 100

CLV_pct > 0 significa que a odd obtida era melhor (mais alta) que a de
fechamento — sinal positivo, mesmo que a aposta acabe perdendo. CLV_pct < 0
é o oposto: o mercado se moveu contra a própria avaliação inicial.

Uma forma equivalente, em termos de probabilidade implícita (útil para
comparar apostas com odds decimais muito diferentes em magnitude), usa as
probabilidades implícitas justas (ver `app.value.engine.implied_probability`
+ remoção de vig) em vez das odds cruas:

    CLV_prob = fair_prob_closing - fair_prob_at_bet_time
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class CLVResult:
    """Resultado do CLV de uma única aposta."""

    prediction_odds: float
    closing_odds: float
    clv_pct: float


def calculate_clv(prediction_odds: float, closing_odds: float) -> float:
    """Calcula o CLV percentual de uma aposta individual.

        CLV_pct = (prediction_odds / closing_odds - 1) * 100

    Args:
        prediction_odds: odds decimais obtidas no momento da aposta.
        closing_odds: odds decimais de fechamento do mercado para o mesmo
            evento/mercado/resultado.

    Returns:
        CLV em pontos percentuais. Positivo = odd obtida melhor que o
        fechamento (bom sinal); negativo = mercado se moveu contra a aposta.
    """
    if prediction_odds <= 1.0 or closing_odds <= 1.0:
        raise ValueError("Odds decimais devem ser maiores que 1.0.")
    return (prediction_odds / closing_odds - 1.0) * 100.0


def aggregate_clv(
    predictions_with_closing: Sequence[tuple[float, float]],
    *,
    stakes: Sequence[float] | None = None,
) -> dict[str, float]:
    """Agrega o CLV de várias apostas em estatísticas resumo.

    Calcula métricas que indicam se o sistema está consistentemente
    capturando valor (CLV positivo médio, alta taxa de CLV+), o que é o
    melhor preditor de longo prazo de lucratividade na literatura.

    Args:
        predictions_with_closing: sequência de pares
            `(prediction_odds, closing_odds)`, um por aposta avaliada.
        stakes: pesos opcionais (stake de cada aposta). Se fornecido,
            calcula também o CLV ponderado por volume apostado.

    Returns:
        Dict com:
        - `mean_clv_pct`: CLV médio em pontos percentuais.
        - `median_clv_pct`: CLV mediano.
        - `positive_clv_rate`: fração de apostas com CLV > 0.
        - `weighted_clv_pct`: CLV ponderado por stake (se stakes fornecidos).
        - `std_clv_pct`: desvio-padrão do CLV.
        - `n_bets`: número total de apostas avaliadas.
    """
    if not predictions_with_closing:
        raise ValueError("predictions_with_closing não pode ser vazio.")

    clv_values: list[float] = []
    for pred_odds, close_odds in predictions_with_closing:
        clv_values.append(calculate_clv(pred_odds, close_odds))

    n = len(clv_values)
    mean_clv = sum(clv_values) / n
    positive_count = sum(1 for c in clv_values if c > 0)

    # Mediana.
    sorted_clv = sorted(clv_values)
    if n % 2 == 0:
        median_clv = (sorted_clv[n // 2 - 1] + sorted_clv[n // 2]) / 2.0
    else:
        median_clv = sorted_clv[n // 2]

    # Desvio-padrão.
    variance = sum((c - mean_clv) ** 2 for c in clv_values) / n
    std_clv = math.sqrt(variance)

    result: dict[str, float] = {
        "mean_clv_pct": round(mean_clv, 4),
        "median_clv_pct": round(median_clv, 4),
        "positive_clv_rate": round(positive_count / n, 4),
        "std_clv_pct": round(std_clv, 4),
        "n_bets": float(n),
    }

    # CLV ponderado por stake.
    if stakes is not None:
        if len(stakes) != n:
            raise ValueError("stakes deve ter o mesmo tamanho que predictions_with_closing.")
        total_stake = sum(stakes)
        if total_stake > 0:
            weighted_clv = sum(c * s for c, s in zip(clv_values, stakes)) / total_stake
            result["weighted_clv_pct"] = round(weighted_clv, 4)

    return result


def calculate_clv_prob(
    fair_prob_at_bet: float,
    fair_prob_closing: float,
) -> float:
    """Calcula CLV em termos de probabilidade implícita (alternativa ao CLV por odds).

        CLV_prob = fair_prob_closing - fair_prob_at_bet

    CLV_prob > 0 → a probabilidade de fechamento é maior que a do momento da
    aposta, indicando que o mercado "convergiu" na direção que o modelo havia
    identificado (o resultado ficou mais provável segundo o mercado).

    Args:
        fair_prob_at_bet: probabilidade justa (sem vig) no momento da aposta.
        fair_prob_closing: probabilidade justa (sem vig) no fechamento do mercado.

    Returns:
        CLV em pontos de probabilidade (fração, não percentual).
    """
    for name, val in (("fair_prob_at_bet", fair_prob_at_bet),
                      ("fair_prob_closing", fair_prob_closing)):
        if not (0.0 < val < 1.0):
            raise ValueError(f"{name} deve estar em (0, 1), recebido: {val!r}")

    return fair_prob_closing - fair_prob_at_bet
