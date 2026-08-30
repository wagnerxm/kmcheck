"""Critério de Kelly — dimensionamento ótimo de stake para apostas de valor.

Formulação
----------
Para uma aposta com odds decimais `d`, probabilidade estimada pelo modelo `p`:

    b = d − 1          (lucro líquido por unidade apostada, em caso de acerto)
    q = 1 − p           (probabilidade de derrota)

    f* = (b·p − q) / b = p − q/b = (p·(b+1) − 1) / b

`f*` é a fração da banca que maximiza o crescimento logarítmico esperado no
longo prazo (Kelly, 1956). Propriedades:

- `f* > 0` ⟺ `EV > 0` (a aposta tem valor positivo segundo o modelo).
- `f* = 0` quando `p = 1/d` (breakeven).
- `f* < 0` → não apostar (modelo indica valor negativo).

Variantes fracionárias
-----------------------
O Kelly pleno é extremamente sensível a erro de estimação de `p` — um viés
otimista de poucos pontos percentuais leva a stakes superdimensionados e
drawdowns severos. Por isso, a literatura recomenda **Kelly fracionário**:

    f_frac = κ · f*

com `κ` tipicamente ∈ {0.25, 0.5}. No BetEdge, apenas Kelly fracionário é
exibido como sugestão de stake (§6.6 do MODELING.md) — nunca o Kelly pleno.

Referências:
- Kelly (1956), "A new interpretation of information rate"
- Thorp (2006), "The Kelly criterion in blackjack, sports betting, and the
  stock market"
"""
from __future__ import annotations

import math


def kelly_fraction(model_prob: float, decimal_odds: float) -> float:
    """Calcula a fração de Kelly plena (f*).

    Args:
        model_prob: probabilidade estimada pelo modelo, em (0, 1).
        decimal_odds: odds decimais oferecidas, > 1.0.

    Returns:
        Fração ótima da banca a apostar. Pode ser negativa (não apostar).
    """
    if not (0.0 < model_prob < 1.0):
        raise ValueError(f"model_prob deve estar em (0, 1), recebido: {model_prob!r}")
    if decimal_odds <= 1.0:
        raise ValueError(f"decimal_odds deve ser > 1.0, recebido: {decimal_odds!r}")

    b = decimal_odds - 1.0
    q = 1.0 - model_prob
    return (b * model_prob - q) / b


def fractional_kelly(
    model_prob: float,
    decimal_odds: float,
    fraction: float = 0.25,
) -> float:
    """Calcula o Kelly fracionário: κ · f*.

    Retorna 0.0 quando f* ≤ 0 (sem valor → sem aposta), clampado ao máximo
    de `fraction` (garante que mesmo com probabilidades extremas o stake
    fracionário não excede κ da banca).

    Args:
        model_prob: probabilidade estimada pelo modelo, em (0, 1).
        decimal_odds: odds decimais oferecidas, > 1.0.
        fraction: fração κ do Kelly (0.25 = quarter-Kelly, 0.5 = half-Kelly).

    Returns:
        Fração da banca recomendada, em [0, fraction]. Arredondada para 4 casas.
    """
    if not (0.0 < fraction <= 1.0):
        raise ValueError(f"fraction deve estar em (0, 1], recebido: {fraction!r}")

    f_star = kelly_fraction(model_prob, decimal_odds)

    if f_star <= 0.0:
        return 0.0

    return round(min(fraction * f_star, fraction), 4)


def kelly_stake_pct(
    model_prob: float,
    decimal_odds: float,
    fractions: tuple[float, ...] = (0.25, 0.5),
) -> dict[str, float]:
    """Calcula stakes fracionários para múltiplos κ de uma vez.

    Conveniência para exibir na interface do produto, que tipicamente mostra
    quarter-Kelly e half-Kelly lado a lado.

    Args:
        model_prob: probabilidade estimada pelo modelo, em (0, 1).
        decimal_odds: odds decimais oferecidas, > 1.0.
        fractions: tupla de κ a calcular.

    Returns:
        Dict mapeando "kelly_{κ}" → fração da banca (%). Ex.:
        {"kelly_0.25": 1.5, "kelly_0.5": 3.0} significa quarter-Kelly
        recomenda 1.5% da banca, half-Kelly recomenda 3.0%.
    """
    result: dict[str, float] = {}
    for kappa in fractions:
        frac = fractional_kelly(model_prob, decimal_odds, fraction=kappa)
        # Converte fração para percentual para exibição.
        result[f"kelly_{kappa}"] = round(frac * 100.0, 2)

    return result
