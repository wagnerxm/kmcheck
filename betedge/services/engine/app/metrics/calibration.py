"""Métricas de calibração — o quanto as probabilidades preditas refletem frequências reais.

Um modelo bem calibrado, dentre todas as vezes que prevê "70% de chance de
vitória", deve observar o evento ocorrer em aproximadamente 70% dessas
vezes. Calibração é uma propriedade distinta de acurácia/poder discriminativo
(um modelo pode discriminar bem quem vence mas estar mal calibrado, e
vice-versa) — por isso é avaliada separadamente do Brier Score bruto
(embora `app.metrics.brier.brier_decomposition` capture uma noção
relacionada via o termo "reliability").
"""
from collections.abc import Sequence


def _validate_inputs(predictions: Sequence[float], outcomes: Sequence[float], n_bins: int) -> None:
    if len(predictions) != len(outcomes):
        raise ValueError("predictions e outcomes devem ter o mesmo tamanho.")
    if len(predictions) == 0:
        raise ValueError("predictions/outcomes não podem ser vazios.")
    if n_bins < 1:
        raise ValueError("n_bins deve ser >= 1.")
    for p in predictions:
        if not (0.0 <= p <= 1.0):
            raise ValueError(f"Probabilidade fora do intervalo [0, 1]: {p!r}")
    for o in outcomes:
        if o not in (0, 1, 0.0, 1.0):
            raise ValueError(f"Outcome deve ser 0 ou 1, recebido: {o!r}")


def _bin_predictions(
    predictions: Sequence[float], outcomes: Sequence[float], n_bins: int
) -> dict[int, list[tuple[float, float]]]:
    """Agrupa (predição, outcome) em `n_bins` faixas de largura igual sobre [0, 1]."""
    bins: dict[int, list[tuple[float, float]]] = {}
    for p, o in zip(predictions, outcomes, strict=True):
        bin_idx = min(int(p * n_bins), n_bins - 1)
        bins.setdefault(bin_idx, []).append((p, o))
    return bins


def expected_calibration_error(
    predictions: Sequence[float], outcomes: Sequence[float], n_bins: int = 10
) -> float:
    """Calcula o Expected Calibration Error (ECE).

        ECE = sum_k (n_k / N) * |conf_k - acc_k|

    onde, para cada bin k: `conf_k` é a probabilidade média predita no bin,
    `acc_k` é a fração observada de ocorrências (frequência real) no bin, e
    `n_k` é o número de predições no bin. ECE = 0 é calibração perfeita;
    quanto maior, pior a calibração (limite superior teórico é 1.0).
    """
    _validate_inputs(predictions, outcomes, n_bins)
    n = len(predictions)
    bins = _bin_predictions(predictions, outcomes, n_bins)

    ece = 0.0
    for bin_items in bins.values():
        n_k = len(bin_items)
        conf_k = sum(p for p, _ in bin_items) / n_k
        acc_k = sum(o for _, o in bin_items) / n_k
        ece += (n_k / n) * abs(conf_k - acc_k)

    return ece


def maximum_calibration_error(
    predictions: Sequence[float], outcomes: Sequence[float], n_bins: int = 10
) -> float:
    """Calcula o Maximum Calibration Error (MCE): o pior desvio de calibração entre os bins.

        MCE = max_k |conf_k - acc_k|

    Mais sensível que o ECE a faixas de probabilidade raramente usadas mas
    muito mal calibradas — útil para identificar "pontos cegos" do modelo
    que uma média ponderada (ECE) poderia mascarar.
    """
    _validate_inputs(predictions, outcomes, n_bins)
    bins = _bin_predictions(predictions, outcomes, n_bins)

    deviations = []
    for bin_items in bins.values():
        n_k = len(bin_items)
        conf_k = sum(p for p, _ in bin_items) / n_k
        acc_k = sum(o for _, o in bin_items) / n_k
        deviations.append(abs(conf_k - acc_k))

    return max(deviations) if deviations else 0.0


def reliability_curve(
    predictions: Sequence[float], outcomes: Sequence[float], n_bins: int = 10
) -> tuple[list[float], list[float]]:
    """Calcula os pontos do diagrama de confiabilidade (reliability diagram).

    Para cada bin de probabilidade não-vazio, calcula a probabilidade média
    predita e a fração observada de ocorrências. Plotar `mean_predicted` (x)
    contra `fraction_positive` (y) e compará-lo à diagonal y=x é a forma
    visual padrão de inspecionar calibração — pontos sobre a diagonal
    indicam calibração perfeita naquela faixa.

    Args:
        predictions: probabilidades preditas (0 a 1).
        outcomes: resultados observados (0 ou 1).
        n_bins: número de faixas de largura igual sobre [0, 1].

    Returns:
        Tupla `(mean_predicted, fraction_positive)`: duas listas paralelas,
        uma entrada por bin não-vazio, ordenadas por índice do bin (ou seja,
        por probabilidade crescente).
    """
    _validate_inputs(predictions, outcomes, n_bins)
    bins = _bin_predictions(predictions, outcomes, n_bins)

    mean_predicted: list[float] = []
    fraction_positive: list[float] = []
    for bin_idx in sorted(bins.keys()):
        bin_items = bins[bin_idx]
        n_k = len(bin_items)
        mean_predicted.append(sum(p for p, _ in bin_items) / n_k)
        fraction_positive.append(sum(o for _, o in bin_items) / n_k)

    return mean_predicted, fraction_positive
