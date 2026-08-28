"""Brier Score — métrica padrão de qualidade de predições probabilísticas.

Referência: Brier, G.W. (1950), "Verification of forecasts expressed in
terms of probability", Monthly Weather Review.

Definição
----------
Para N predições binárias `p_i` (probabilidade do evento ocorrer) e
resultados observados `o_i` em {0, 1}:

    BS = (1/N) * sum_i (p_i - o_i)^2

`BS` varia em [0, 1], onde 0 é predição perfeita e 1 é o pior caso possível
(prever probabilidade 1 para tudo que não acontece, ou 0 para tudo que
acontece). É uma "proper scoring rule": o previsor só minimiza o BS esperado
reportando sua verdadeira crença de probabilidade — não há incentivo a
"blefar" probabilidades mais extremas ou mais conservadoras.

Decomposição de Murphy (1973)
-------------------------------
O Brier Score se decompõe em três componentes interpretáveis:

    BS = reliability - resolution + uncertainty

Agrupando as N predições em K "bins" de probabilidades similares (bin k com
`n_k` predições, probabilidade média `f_k` e frequência observada média `o_k`
nesse bin), e com `obar` = frequência-base geral (taxa média de ocorrência):

    reliability  = (1/N) * sum_k n_k * (f_k - o_k)^2
        -> quão longe as probabilidades preditas estão da frequência real
           observada em cada faixa de probabilidade (menor é melhor — mede
           calibração).

    resolution   = (1/N) * sum_k n_k * (o_k - obar)^2
        -> quão diferentes as frequências observadas são entre os bins, em
           relação à taxa-base geral (maior é melhor — mede capacidade do
           modelo de discriminar situações de risco diferente).

    uncertainty  = obar * (1 - obar)
        -> variância intrínseca do fenômeno sendo previsto, independente do
           modelo (quanto mais próximo de 50/50 o evento é, maior).
"""
from collections.abc import Sequence


def _validate_inputs(predictions: Sequence[float], outcomes: Sequence[float]) -> None:
    if len(predictions) != len(outcomes):
        raise ValueError("predictions e outcomes devem ter o mesmo tamanho.")
    if len(predictions) == 0:
        raise ValueError("predictions/outcomes não podem ser vazios.")
    for p in predictions:
        if not (0.0 <= p <= 1.0):
            raise ValueError(f"Probabilidade fora do intervalo [0, 1]: {p!r}")
    for o in outcomes:
        if o not in (0, 1, 0.0, 1.0):
            raise ValueError(f"Outcome deve ser 0 ou 1, recebido: {o!r}")


def brier_score(predictions: Sequence[float], outcomes: Sequence[float]) -> float:
    """Calcula o Brier Score: BS = (1/N) * sum((p_i - o_i)^2).

    Args:
        predictions: probabilidades preditas (0 a 1) de o evento ocorrer.
        outcomes: resultados observados (0 ou 1).

    Returns:
        O Brier Score, em [0, 1] (menor é melhor).
    """
    _validate_inputs(predictions, outcomes)
    n = len(predictions)
    return sum((p - o) ** 2 for p, o in zip(predictions, outcomes, strict=True)) / n


def brier_skill_score(
    predictions: Sequence[float],
    outcomes: Sequence[float],
    baseline: Sequence[float] | float,
) -> float:
    """Calcula o Brier Skill Score relativo a uma predição de referência (baseline).

    BSS = 1 - BS_model / BS_baseline

    BSS > 0 indica que o modelo é melhor que o baseline; BSS = 0 indica
    performance idêntica; BSS < 0 indica que o modelo é pior que o baseline
    (ex.: pior que simplesmente prever a frequência histórica constante).

    Args:
        predictions: probabilidades do modelo avaliado.
        outcomes: resultados observados (0 ou 1), mesmos eventos de `predictions`.
        baseline: probabilidades do modelo de referência (mesmo tamanho de
            `predictions`), ou um único float (ex.: a taxa-base histórica),
            replicado para todas as observações — caso comum de baseline
            "climatológico" (prever sempre a frequência média histórica).

    Returns:
        O Brier Skill Score (sem limite inferior; 1.0 é o máximo teórico,
        atingido apenas por uma predição perfeita quando BS_baseline > 0).
    """
    _validate_inputs(predictions, outcomes)

    if isinstance(baseline, (int, float)):
        baseline_predictions: Sequence[float] = [float(baseline)] * len(predictions)
    else:
        baseline_predictions = baseline
        if len(baseline_predictions) != len(predictions):
            raise ValueError("baseline deve ter o mesmo tamanho de predictions quando for uma sequência.")

    bs_model = brier_score(predictions, outcomes)
    bs_baseline = brier_score(baseline_predictions, outcomes)

    if bs_baseline == 0.0:
        # Baseline perfeito (BS=0): só é possível empatar (BSS=0) ou o modelo
        # também ser perfeito. Evita divisão por zero.
        return 0.0 if bs_model == 0.0 else float("-inf")

    return 1.0 - (bs_model / bs_baseline)


def brier_decomposition(
    predictions: Sequence[float],
    outcomes: Sequence[float],
    n_bins: int = 10,
) -> tuple[float, float, float]:
    """Decompõe o Brier Score em (reliability, resolution, uncertainty), via Murphy (1973).

    As predições são agrupadas em `n_bins` faixas de largura igual sobre
    [0, 1] (bin i cobre `[i/n_bins, (i+1)/n_bins)`, exceto o último bin, que
    inclui 1.0). `BS = reliability - resolution + uncertainty` é uma
    identidade exata (a menos de arredondamento de ponto flutuante).

    Args:
        predictions: probabilidades preditas (0 a 1).
        outcomes: resultados observados (0 ou 1).
        n_bins: número de faixas de probabilidade usadas para agrupar as
            predições ao calcular reliability/resolution.

    Returns:
        Tupla `(reliability, resolution, uncertainty)`.
    """
    _validate_inputs(predictions, outcomes)
    if n_bins < 1:
        raise ValueError("n_bins deve ser >= 1.")

    n = len(predictions)
    obar = sum(outcomes) / n

    bins: dict[int, list[tuple[float, float]]] = {}
    for p, o in zip(predictions, outcomes, strict=True):
        bin_idx = min(int(p * n_bins), n_bins - 1)
        bins.setdefault(bin_idx, []).append((p, o))

    reliability = 0.0
    resolution = 0.0
    for bin_items in bins.values():
        n_k = len(bin_items)
        f_k = sum(p for p, _ in bin_items) / n_k
        o_k = sum(o for _, o in bin_items) / n_k
        reliability += n_k * (f_k - o_k) ** 2
        resolution += n_k * (o_k - obar) ** 2

    reliability /= n
    resolution /= n
    uncertainty = obar * (1 - obar)

    return reliability, resolution, uncertainty
