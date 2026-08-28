"""Motor de value bets: probabilidade implícita, remoção de vig, edge, EV e edge score.

Este módulo contém toda a matemática do "value engine" do BetEdge, totalmente
implementada e testada (`tests/test_value_engine.py`). Os métodos de remoção
de vig (`remove_vig_*`) reaproveitam as implementações de
`app.models.market_consensus` — o modelo de consenso de mercado é, em
essência, este mesmo motor aplicado e combinado entre múltiplas casas de
apostas; manter uma única implementação evita divergência entre os dois usos.
"""
from app.models.market_consensus import (
    multiplicative_normalization,
    power_method,
    shin_method,
)

# --- Constantes de normalização do edge score -------------------------------
# Valores de referência usados para escalar edge/EV brutos em [0, 1] antes de
# combiná-los no score de 0-100. Calibrados para o mercado de apostas
# esportivas: um edge de 20% ou uma EV de 30% já são excepcionalmente altos
# na prática (a maioria das oportunidades reais de valor fica na casa de
# poucos pontos percentuais) — acima disso, o componente satura em 1.0.
MAX_EXPECTED_EDGE = 0.20
MAX_EXPECTED_EV = 0.30

# Pesos dos componentes do edge score (devem somar 100).
_WEIGHT_EDGE = 40.0
_WEIGHT_EV = 30.0
_WEIGHT_CONFIDENCE = 15.0
_WEIGHT_ACCURACY = 10.0
_WEIGHT_LIQUIDITY = 5.0


def implied_probability(decimal_odds: float) -> float:
    """Converte odds decimais em probabilidade implícita (com vig): pi = 1 / odds.

    Args:
        decimal_odds: odds decimais (formato europeu), ex.: 2.50 significa
            que R$1 apostado retorna R$2,50 (incluindo o stake) em caso de acerto.

    Returns:
        Probabilidade implícita em (0, 1). Note que a SOMA das probabilidades
        implícitas de todos os resultados de um mercado é tipicamente > 1
        (a margem/overround do bookmaker) — para a probabilidade "justa",
        use `remove_vig_*`.
    """
    if decimal_odds <= 1.0:
        raise ValueError(f"decimal_odds deve ser > 1.0, recebido: {decimal_odds!r}")
    return 1.0 / decimal_odds


def calculate_overround(implied_probs: list[float]) -> float:
    """Calcula o overround (margem do bookmaker) de um mercado.

        overround = sum(implied_probs) - 1

    Um overround de 0.05 significa 5% de margem embutida nas odds — ou seja,
    a soma das probabilidades implícitas de todos os resultados é 1.05.

    Args:
        implied_probs: probabilidades implícitas (com vig) de todos os
            resultados de um mercado (ex.: [P(casa), P(empate), P(fora)]).

    Returns:
        O overround como fração (não percentual — multiplique por 100 para
        exibir como "%", conforme feito na camada de API).
    """
    if not implied_probs:
        raise ValueError("implied_probs não pode ser vazio.")
    return sum(implied_probs) - 1.0


def remove_vig_multiplicative(implied_probs: list[float]) -> list[float]:
    """Remove o overround por normalização multiplicativa simples.

    Ver a formulação completa em `app.models.market_consensus.multiplicative_normalization`.
    """
    return multiplicative_normalization(implied_probs)


def remove_vig_power(implied_probs: list[float]) -> list[float]:
    """Remove o overround pelo método da potência (power method).

    Ver a formulação completa em `app.models.market_consensus.power_method`.
    """
    return power_method(implied_probs)


def remove_vig_shin(implied_probs: list[float]) -> list[float]:
    """Remove o overround pelo método de Shin (1992/1993), modelando insider trading.

    Ver a formulação completa em `app.models.market_consensus.shin_method`.
    """
    return shin_method(implied_probs)


def calculate_edge(model_prob: float, fair_market_prob: float) -> float:
    """Calcula o edge: a diferença entre a probabilidade do modelo e a probabilidade justa de mercado.

        edge = model_prob - fair_market_prob

    Edge positivo indica que o modelo acredita no resultado mais do que o
    mercado (sem vig) — um candidato a value bet. Edge negativo indica o
    oposto (o modelo está mais pessimista que o mercado quanto a este resultado).

    Args:
        model_prob: probabilidade estimada pelo modelo do BetEdge, em [0, 1].
        fair_market_prob: probabilidade justa de mercado (já sem vig), em [0, 1].

    Returns:
        O edge, em [-1, 1].
    """
    if not (0.0 <= model_prob <= 1.0):
        raise ValueError(f"model_prob fora de [0, 1]: {model_prob!r}")
    if not (0.0 <= fair_market_prob <= 1.0):
        raise ValueError(f"fair_market_prob fora de [0, 1]: {fair_market_prob!r}")
    return model_prob - fair_market_prob


def calculate_ev(model_prob: float, decimal_odds: float) -> float:
    """Calcula o valor esperado (EV) percentual de uma aposta, usando as odds oferecidas.

    Para uma aposta de stake unitário com odds decimais `o` e probabilidade
    real (segundo o modelo) `p` de acerto:

        EV = p * (o - 1) - (1 - p) * 1 = p * o - 1

    `EV` é a fração esperada de retorno sobre o stake apostado: EV = 0.10
    significa um retorno esperado de +10% do valor apostado, no longo prazo,
    SE a probabilidade `model_prob` estiver correta.

    Args:
        model_prob: probabilidade estimada pelo modelo do resultado ocorrer, em [0, 1].
        decimal_odds: odds decimais oferecidas pela casa de apostas.

    Returns:
        EV como fração do stake (ex.: 0.10 = +10% de EV). Multiplique por
        100 para exibir como percentual.
    """
    if not (0.0 <= model_prob <= 1.0):
        raise ValueError(f"model_prob fora de [0, 1]: {model_prob!r}")
    if decimal_odds <= 1.0:
        raise ValueError(f"decimal_odds deve ser > 1.0, recebido: {decimal_odds!r}")
    return model_prob * decimal_odds - 1.0


def calculate_edge_score(
    edge: float,
    expected_value: float,
    model_confidence: float = 1.0,
    historical_model_accuracy: float = 0.5,
    market_liquidity_factor: float = 1.0,
) -> float:
    """Calcula o Edge Score proprietário do BetEdge — score único de 0 a 100.

    Combina cinco componentes, cada um normalizado para [0, 1] e ponderado,
    de forma que o score final some no máximo 100:

        - edge (peso 40): força bruta do edge, saturando em `MAX_EXPECTED_EDGE`.
        - expected_value (peso 30): EV bruto, saturando em `MAX_EXPECTED_EV`.
        - model_confidence (peso 15): confiança do modelo na predição (já em [0, 1]).
        - historical_model_accuracy (peso 10): acurácia/calibração histórica
          recente do modelo que gerou a predição (já em [0, 1]).
        - market_liquidity_factor (peso 5): quão líquido/confiável é o
          mercado onde a odd foi observada (já em [0, 1]; 1.0 = mercado
          principal de casa grande, valores menores para mercados exóticos
          ou casas com pouco volume).

    Edge e EV negativos ou nulos contribuem 0 ao score (não há "edge score
    negativo" — abaixo de zero, simplesmente não é uma oportunidade de valor).

    Args:
        edge: ver `calculate_edge` (fração, tipicamente pequena e positiva
            para ser uma oportunidade de valor).
        expected_value: ver `calculate_ev` (fração).
        model_confidence: confiança do modelo na predição usada, em [0, 1].
        historical_model_accuracy: acurácia histórica recente do modelo, em [0, 1].
        market_liquidity_factor: fator de liquidez/confiabilidade do mercado, em [0, 1].

    Returns:
        O Edge Score, sempre em [0, 100].
    """
    for name, value in (
        ("model_confidence", model_confidence),
        ("historical_model_accuracy", historical_model_accuracy),
        ("market_liquidity_factor", market_liquidity_factor),
    ):
        if not (0.0 <= value <= 1.0):
            raise ValueError(f"{name} deve estar em [0, 1], recebido: {value!r}")

    edge_component = max(0.0, min(edge / MAX_EXPECTED_EDGE, 1.0)) * _WEIGHT_EDGE
    ev_component = max(0.0, min(expected_value / MAX_EXPECTED_EV, 1.0)) * _WEIGHT_EV
    confidence_component = model_confidence * _WEIGHT_CONFIDENCE
    accuracy_component = historical_model_accuracy * _WEIGHT_ACCURACY
    liquidity_component = market_liquidity_factor * _WEIGHT_LIQUIDITY

    score = edge_component + ev_component + confidence_component + accuracy_component + liquidity_component

    # Clamp defensivo — a soma dos pesos já garante <= 100, mas erros de
    # ponto flutuante ou pesos futuros mal ajustados não devem escapar do contrato.
    return max(0.0, min(score, 100.0))
