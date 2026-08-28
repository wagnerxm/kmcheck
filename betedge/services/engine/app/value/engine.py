"""Motor de value bets: probabilidade implícita, remoção de vig, edge, EV e edge score.

Este módulo contém toda a matemática do "value engine" do BetEdge, totalmente
implementada e testada (`tests/test_value_engine.py`). Os métodos de remoção
de vig (`remove_vig_*`) reaproveitam as implementações de
`app.models.market_consensus` — o modelo de consenso de mercado é, em
essência, este mesmo motor aplicado e combinado entre múltiplas casas de
apostas; manter uma única implementação evita divergência entre os dois usos.

Versão 2.0: Edge Score completo com 7 componentes (MODELING.md §7.5),
compressão logística do edge bruto, e pesos otimizáveis via regressão de CLV.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize

from app.models.market_consensus import (
    multiplicative_normalization,
    power_method,
    shin_method,
)

# ═══════════════════════════════════════════════════════════════════════════
# Constantes de normalização e default do Edge Score
# ═══════════════════════════════════════════════════════════════════════════

# Limites de saturação para EV (edge usa compressão logística, não linear).
MAX_EXPECTED_EV = 0.30

# Parâmetros da função de compressão logística do edge bruto f(E).
# E0 = ponto de inflexão (edge típico confirmado por CLV positivo, §7.5).
# EDGE_LOGISTIC_A = suavidade da compressão.
EDGE_LOGISTIC_E0 = 0.045  # 4.5 p.p. — meio da faixa 3-6 p.p. mencionada na spec.
EDGE_LOGISTIC_A = 40.0    # Crescimento rápido ao redor de E0, satura acima de ~15 p.p.

# Pesos padrão dos 7 componentes (devem somar 1.0).
# Estes são os defaults iniciais; em produção são reotimizados via regressão
# de CLV realizado contra componentes (§7.5).
DEFAULT_WEIGHTS = {
    "edge": 0.30,               # E — magnitude do edge (comprimido)
    "ev": 0.20,                 # EV implícito nos pesos via edge, mas vale separar
    "model_confidence": 0.15,   # C — concordância do ensemble
    "market_efficiency": 0.10,  # M — inversão da eficiência do mercado
    "sample_size": 0.05,        # N — volume de dados históricos
    "calibration_quality": 0.10,# K — ECE recente do modelo
    "line_movement": 0.05,      # L — movimento de odds confirmando o modelo
    "bookmaker_coverage": 0.05, # B — nº de casas com odds compatíveis
}


# ═══════════════════════════════════════════════════════════════════════════
# Probabilidade implícita e overround
# ═══════════════════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════════════════
# Remoção de vig (delegam para market_consensus)
# ═══════════════════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════════════════
# Edge e Expected Value
# ═══════════════════════════════════════════════════════════════════════════

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


def calculate_relative_edge(model_prob: float, fair_market_prob: float) -> float:
    """Calcula o edge relativo: edge / fair_market_prob.

    Útil para comparar edges entre mercados com probabilidade-base muito
    diferente (um edge de 3 p.p. sobre um favorito a 80% é menos significativo
    que 3 p.p. sobre um azarão a 10%).

    Args:
        model_prob: probabilidade estimada pelo modelo, em [0, 1].
        fair_market_prob: probabilidade justa de mercado (sem vig), em (0, 1].

    Returns:
        Edge relativo (adimensional). Ex.: 0.10 = edge de 10% relativo à prob de mercado.
    """
    if not (0.0 <= model_prob <= 1.0):
        raise ValueError(f"model_prob fora de [0, 1]: {model_prob!r}")
    if not (0.0 < fair_market_prob <= 1.0):
        raise ValueError(f"fair_market_prob deve estar em (0, 1]: {fair_market_prob!r}")
    return (model_prob - fair_market_prob) / fair_market_prob


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


# ═══════════════════════════════════════════════════════════════════════════
# Compressão logística do edge (§7.5)
# ═══════════════════════════════════════════════════════════════════════════

def compress_edge(
    edge: float,
    a: float = EDGE_LOGISTIC_A,
    e0: float = EDGE_LOGISTIC_E0,
) -> float:
    """Comprime o edge bruto via função logística, conforme §7.5 do MODELING.md.

        f(E) = 1 / (1 + exp(-a · (E - E0)))

    A compressão satura edges muito grandes (> 15-20 p.p.) que são mais
    prováveis de refletir erro de modelo/dado do que oportunidade genuína.
    O ponto de inflexão E0 é calibrado na faixa do edge tipicamente
    confirmado por CLV positivo (3-6 p.p.).

    Args:
        edge: edge bruto (fração, ex.: 0.05 = 5 p.p.).
        a: suavidade da compressão logística.
        e0: ponto de inflexão.

    Returns:
        Valor comprimido em (0, 1). Para edge ≤ 0, retorna um valor muito
        próximo de 0 (a logística não é exatamente 0, mas o componente é
        praticamente anulado).
    """
    z = a * (edge - e0)
    # Numericamente estável: evita overflow em exp(-z) para z muito positivo.
    if z > 500:
        return 1.0
    if z < -500:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


# ═══════════════════════════════════════════════════════════════════════════
# Edge Score completo — 7 componentes (§7.5 do MODELING.md)
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class EdgeScoreComponents:
    """Decomposição dos 7 componentes normalizados do Edge Score.

    Cada campo é um valor em [0, 1] representando a contribuição normalizada
    do fator *antes* da ponderação. O score final é:

        EdgeScore = 100 × Σ w_i · componente_i
    """

    edge: float = 0.0                  # E — magnitude do edge (comprimido)
    ev: float = 0.0                    # EV normalizado
    model_confidence: float = 0.0      # C — concordância do ensemble
    market_efficiency: float = 0.0     # M — ineficiência do mercado
    sample_size: float = 0.0           # N — volume de dados históricos
    calibration_quality: float = 0.0   # K — ECE recente invertido
    line_movement: float = 0.0         # L — movimento de odds confirmando modelo
    bookmaker_coverage: float = 0.0    # B — cobertura de casas

    def to_dict(self) -> dict[str, float]:
        """Retorna os componentes como dict (para serialização/API)."""
        return {
            "edge": self.edge,
            "ev": self.ev,
            "model_confidence": self.model_confidence,
            "market_efficiency": self.market_efficiency,
            "sample_size": self.sample_size,
            "calibration_quality": self.calibration_quality,
            "line_movement": self.line_movement,
            "bookmaker_coverage": self.bookmaker_coverage,
        }


@dataclass
class EdgeScoreResult:
    """Resultado completo do cálculo do Edge Score."""

    score: float                       # Score final 0-100
    components: EdgeScoreComponents    # Componentes normalizados
    weights: dict[str, float]          # Pesos usados no cálculo


def calculate_edge_score(
    edge: float,
    expected_value: float,
    model_confidence: float = 1.0,
    historical_model_accuracy: float = 0.5,
    market_liquidity_factor: float = 1.0,
    *,
    # Novos parâmetros (7 componentes completos, §7.5).
    ensemble_variance: float | None = None,
    market_overround: float | None = None,
    odds_dispersion: float | None = None,
    n_bookmakers_market: int | None = None,
    historical_sample_size: int | None = None,
    max_sample_size: int = 5000,
    recent_ece: float | None = None,
    line_movement_confirms: float | None = None,
    n_bookmakers_compatible: int | None = None,
    max_bookmakers: int = 20,
    weights: dict[str, float] | None = None,
) -> float:
    """Calcula o Edge Score proprietário do BetEdge — score único de 0 a 100.

    Versão 2.0 com 7 componentes (MODELING.md §7.5) e compressão logística.
    Retrocompatível: sem os parâmetros nomeados, usa heurísticas sobre os 5
    parâmetros originais para derivar os 7 componentes.

    Args:
        edge: ver `calculate_edge` (fração).
        expected_value: ver `calculate_ev` (fração).
        model_confidence: confiança do modelo na predição, em [0, 1].
        historical_model_accuracy: acurácia histórica recente do modelo, em [0, 1].
        market_liquidity_factor: fator de liquidez/confiabilidade do mercado, em [0, 1].
        ensemble_variance: σ² do ensemble (menor = mais concordância). Se None,
            usa `1 - model_confidence` como proxy.
        market_overround: overround do mercado (fração). Se None, usa
            `1 - market_liquidity_factor` como proxy inverso.
        odds_dispersion: desvio-padrão das odds entre casas. Se None, ignora.
        n_bookmakers_market: nº de casas cotando o mercado. Se None, ignora.
        historical_sample_size: nº de partidas/dados históricos disponíveis.
        max_sample_size: tamanho de amostra para saturação do componente N.
        recent_ece: ECE recente do modelo na liga (menor = melhor calibração).
        line_movement_confirms: valor em [-1, 1] indicando direção do movimento
            de odds vs direção do edge (+1 = confirma, -1 = contradiz).
        n_bookmakers_compatible: nº de casas com odds compatíveis.
        max_bookmakers: nº de casas para saturação do componente B.
        weights: pesos dos 7 componentes (se None, usa DEFAULT_WEIGHTS).

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

    w = weights if weights is not None else DEFAULT_WEIGHTS

    # --- Componente E: magnitude do edge (compressão logística) ---
    comp_edge = compress_edge(edge) if edge > 0 else 0.0

    # --- Componente EV: normalizado linearmente (clamp em MAX_EXPECTED_EV) ---
    comp_ev = max(0.0, min(expected_value / MAX_EXPECTED_EV, 1.0))

    # --- Componente C: confiança do modelo / concordância do ensemble ---
    if ensemble_variance is not None:
        # σ² normalizado: 0 = concordância total (score 1), alta variância → score 0.
        # Variância máxima teórica para probs em [0,1] é 0.25 (p=0.5, modelos nos extremos).
        comp_confidence = max(0.0, 1.0 - ensemble_variance / 0.25)
    else:
        comp_confidence = model_confidence

    # --- Componente M: ineficiência do mercado ---
    if market_overround is not None:
        # Overround alto = mercado ineficiente = mais espaço para edge genuíno.
        # Normaliza: overround de 10% (0.10) → score ~0.5, 20%+ → ~1.0.
        comp_market_efficiency = min(1.0, market_overround / 0.20)
    elif odds_dispersion is not None:
        # Dispersão alta entre casas = mercado não convergiu = mais ineficiente.
        comp_market_efficiency = min(1.0, odds_dispersion / 0.50)
    elif n_bookmakers_market is not None:
        # Poucas casas cotando → mercado menos eficiente.
        comp_market_efficiency = max(0.0, 1.0 - n_bookmakers_market / 15.0)
    else:
        # Fallback: proxy via market_liquidity_factor invertido (alta liquidez ≈ eficiente).
        comp_market_efficiency = 1.0 - market_liquidity_factor

    # --- Componente N: tamanho de amostra histórica ---
    if historical_sample_size is not None:
        # Compressão logarítmica para saturar suavemente.
        if historical_sample_size <= 0:
            comp_sample_size = 0.0
        else:
            comp_sample_size = min(1.0, math.log1p(historical_sample_size) / math.log1p(max_sample_size))
    else:
        # Fallback: proxy via historical_model_accuracy (mais dados → modelo mais preciso).
        comp_sample_size = historical_model_accuracy

    # --- Componente K: qualidade de calibração (ECE recente) ---
    if recent_ece is not None:
        # ECE = 0 → calibração perfeita (score 1); ECE = 0.20+ → score ~0.
        comp_calibration = max(0.0, 1.0 - recent_ece / 0.20)
    else:
        comp_calibration = historical_model_accuracy

    # --- Componente L: movimento de linha ---
    if line_movement_confirms is not None:
        # +1 = odds se moveram confirmando o modelo → score 1.
        # -1 = odds se moveram contra → score 0.
        # 0 = sem movimento / neutro → score 0.5.
        comp_line_movement = max(0.0, min(1.0, (line_movement_confirms + 1.0) / 2.0))
    else:
        comp_line_movement = 0.5  # neutro quando não disponível.

    # --- Componente B: cobertura de casas ---
    if n_bookmakers_compatible is not None:
        comp_bookmaker_coverage = min(1.0, n_bookmakers_compatible / max_bookmakers)
    else:
        comp_bookmaker_coverage = market_liquidity_factor

    # --- Combinação ponderada ---
    score = 100.0 * (
        w.get("edge", 0) * comp_edge
        + w.get("ev", 0) * comp_ev
        + w.get("model_confidence", 0) * comp_confidence
        + w.get("market_efficiency", 0) * comp_market_efficiency
        + w.get("sample_size", 0) * comp_sample_size
        + w.get("calibration_quality", 0) * comp_calibration
        + w.get("line_movement", 0) * comp_line_movement
        + w.get("bookmaker_coverage", 0) * comp_bookmaker_coverage
    )

    return max(0.0, min(score, 100.0))


def calculate_edge_score_detailed(
    edge: float,
    expected_value: float,
    model_confidence: float = 1.0,
    historical_model_accuracy: float = 0.5,
    market_liquidity_factor: float = 1.0,
    *,
    ensemble_variance: float | None = None,
    market_overround: float | None = None,
    odds_dispersion: float | None = None,
    n_bookmakers_market: int | None = None,
    historical_sample_size: int | None = None,
    max_sample_size: int = 5000,
    recent_ece: float | None = None,
    line_movement_confirms: float | None = None,
    n_bookmakers_compatible: int | None = None,
    max_bookmakers: int = 20,
    weights: dict[str, float] | None = None,
) -> EdgeScoreResult:
    """Versão detalhada que retorna a decomposição completa dos componentes.

    Mesma lógica de `calculate_edge_score`, mas retorna um `EdgeScoreResult`
    com os componentes individuais normalizados e os pesos usados.
    Aceita os mesmos fallbacks (`historical_model_accuracy`, `market_liquidity_factor`)
    para garantir paridade exata com a versão simples.
    """
    w = weights if weights is not None else DEFAULT_WEIGHTS

    # Componentes individuais.
    comp_edge = compress_edge(edge) if edge > 0 else 0.0
    comp_ev = max(0.0, min(expected_value / MAX_EXPECTED_EV, 1.0))

    if ensemble_variance is not None:
        comp_confidence = max(0.0, 1.0 - ensemble_variance / 0.25)
    else:
        comp_confidence = model_confidence

    if market_overround is not None:
        comp_market_efficiency = min(1.0, market_overround / 0.20)
    elif odds_dispersion is not None:
        comp_market_efficiency = min(1.0, odds_dispersion / 0.50)
    elif n_bookmakers_market is not None:
        comp_market_efficiency = max(0.0, 1.0 - n_bookmakers_market / 15.0)
    else:
        # Fallback: proxy via market_liquidity_factor invertido (alta liquidez ≈ eficiente).
        comp_market_efficiency = 1.0 - market_liquidity_factor

    if historical_sample_size is not None:
        if historical_sample_size <= 0:
            comp_sample_size = 0.0
        else:
            comp_sample_size = min(1.0, math.log1p(historical_sample_size) / math.log1p(max_sample_size))
    else:
        # Fallback: proxy via historical_model_accuracy.
        comp_sample_size = historical_model_accuracy

    if recent_ece is not None:
        comp_calibration = max(0.0, 1.0 - recent_ece / 0.20)
    else:
        comp_calibration = historical_model_accuracy

    if line_movement_confirms is not None:
        comp_line_movement = max(0.0, min(1.0, (line_movement_confirms + 1.0) / 2.0))
    else:
        comp_line_movement = 0.5

    if n_bookmakers_compatible is not None:
        comp_bookmaker_coverage = min(1.0, n_bookmakers_compatible / max_bookmakers)
    else:
        comp_bookmaker_coverage = market_liquidity_factor

    components = EdgeScoreComponents(
        edge=comp_edge,
        ev=comp_ev,
        model_confidence=comp_confidence,
        market_efficiency=comp_market_efficiency,
        sample_size=comp_sample_size,
        calibration_quality=comp_calibration,
        line_movement=comp_line_movement,
        bookmaker_coverage=comp_bookmaker_coverage,
    )

    score = 100.0 * (
        w.get("edge", 0) * components.edge
        + w.get("ev", 0) * components.ev
        + w.get("model_confidence", 0) * components.model_confidence
        + w.get("market_efficiency", 0) * components.market_efficiency
        + w.get("sample_size", 0) * components.sample_size
        + w.get("calibration_quality", 0) * components.calibration_quality
        + w.get("line_movement", 0) * components.line_movement
        + w.get("bookmaker_coverage", 0) * components.bookmaker_coverage
    )

    return EdgeScoreResult(
        score=max(0.0, min(score, 100.0)),
        components=components,
        weights=dict(w),
    )


# ═══════════════════════════════════════════════════════════════════════════
# Otimização de pesos do Edge Score via regressão de CLV (§7.5)
# ═══════════════════════════════════════════════════════════════════════════

def optimize_edge_score_weights(
    component_matrix: np.ndarray,
    realized_clv: np.ndarray,
) -> dict[str, float]:
    """Otimiza os pesos do Edge Score por regressão de CLV realizado.

    Resolve:
        w* = argmin_w Σ (CLV_realizado − Σ_i w_i · componente_i)²
        sujeito a  Σ w_i = 1, w_i ≥ 0

    Args:
        component_matrix: array (n_opportunities, 8) — cada linha contém os
            8 componentes normalizados de uma oportunidade histórica, na ordem:
            [edge, ev, confidence, market_eff, sample_size, calibration,
             line_movement, bookmaker_coverage].
        realized_clv: array (n_opportunities,) — CLV realizado de cada
            oportunidade (normalizado para [0, 1] antes de passar).

    Returns:
        Dict com pesos otimizados, na mesma estrutura de DEFAULT_WEIGHTS.

    Raises:
        ValueError: se a matriz não tem 8 colunas ou não há amostras suficientes.
    """
    component_matrix = np.asarray(component_matrix, dtype=np.float64)
    realized_clv = np.asarray(realized_clv, dtype=np.float64)

    if component_matrix.ndim != 2 or component_matrix.shape[1] != 8:
        raise ValueError(
            f"component_matrix deve ter shape (N, 8), recebido: {component_matrix.shape}"
        )
    if len(realized_clv) != len(component_matrix):
        raise ValueError("component_matrix e realized_clv devem ter o mesmo número de linhas.")
    if len(realized_clv) < 20:
        raise ValueError("Pelo menos 20 oportunidades são necessárias para otimizar pesos.")

    n_weights = 8
    weight_names = [
        "edge", "ev", "model_confidence", "market_efficiency",
        "sample_size", "calibration_quality", "line_movement", "bookmaker_coverage",
    ]

    def objective(w: np.ndarray) -> float:
        predicted = component_matrix @ w
        residuals = realized_clv - predicted
        return float(np.mean(residuals ** 2))

    # Restrições: soma = 1, cada w_i >= 0.
    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    bounds = [(0.0, 1.0)] * n_weights
    x0 = np.full(n_weights, 1.0 / n_weights)

    result = minimize(
        objective,
        x0=x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
    )

    optimized = result.x
    # Normaliza para garantir soma exata = 1 (tolerância numérica do SLSQP).
    total = optimized.sum()
    if total > 0:
        optimized = optimized / total

    return {name: float(optimized[i]) for i, name in enumerate(weight_names)}
