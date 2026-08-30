"""Modelo de consenso de mercado (remoção de vig / no-vig) sobre múltiplas casas de apostas.

Diferente dos demais modelos em `app/models/`, este é **puramente matemático**
— não há parâmetros a ajustar por máxima verossimilhança nem features a
aprender. Por isso está totalmente implementado (não é apenas um scaffold):
dado um conjunto de odds decimais de várias casas, ele estima a probabilidade
"justa" (sem a margem/overround do bookmaker) de cada resultado, e combina
essa estimativa entre casas para formar um consenso de mercado.

Formulação matemática
----------------------
Odds decimais `o_i` implicam uma probabilidade bruta (com vig) por:

    pi_i = 1 / o_i

Como o bookmaker cobra uma margem, `sum(pi_i) = 1 + overround > 1`. Este
módulo implementa três métodos clássicos para remover essa margem e obter
probabilidades "justas" `p_i` (com `sum(p_i) = 1`):

1. **Normalização multiplicativa** — o método mais simples: divide cada
   probabilidade implícita pela soma, distribuindo a margem
   proporcionalmente a todos os resultados:

       p_i = pi_i / sum_j(pi_j)

2. **Método da potência (power method)** — assume que a relação entre a
   probabilidade implícita e a verdadeira segue uma lei de potência,
   `pi_i = p_i^(1/k)`, e resolve numericamente o expoente `k` tal que as
   probabilidades resultantes somem 1:

       p_i(k) = pi_i^k        sujeito a       sum_i pi_i^k = 1

   Como `sum_i pi_i^k` é estritamente decrescente em `k` (para `k >= 1` e
   `0 < pi_i < 1`), existe um único `k* >= 1` que satisfaz a restrição,
   encontrado aqui por busca binária.

3. **Método de Shin (Shin, 1992/1993)** — modela a margem como resultante
   de uma fração `z` de apostadores "informados" (insider trading). A
   relação entre probabilidade implícita `pi_i` e verdadeira `p_i` é:

       p_i(z) = [ sqrt(z^2 + 4*(1-z)*pi_i^2 / S) - z ] / (2*(1-z))

   onde `S = sum_j(pi_j)`. Resolve-se `z` (por busca binária) tal que
   `sum_i p_i(z) = 1`. O método de Shin tende a atribuir mais probabilidade
   a azarões do que a normalização multiplicativa, refletindo a ideia de
   que o overround não é distribuído uniformemente entre os resultados.

Consenso entre casas
----------------------
Após remover a margem de cada casa individualmente, o consenso de mercado
para um resultado é a média (por padrão, simples; opcionalmente ponderada
por confiabilidade/liquidez da casa) das probabilidades justas de cada casa:

    p_consenso_i = sum_b(peso_b * p_i_b) / sum_b(peso_b)
"""
import math
from datetime import datetime
from typing import Literal

from app.models.base import BaseModel, PredictionResult

VigRemovalMethod = Literal["multiplicative", "power", "shin"]


def multiplicative_normalization(implied_probs: list[float]) -> list[float]:
    """Remove a margem distribuindo-a proporcionalmente entre todos os resultados.

    p_i = pi_i / sum_j(pi_j)
    """
    if not implied_probs:
        raise ValueError("implied_probs não pode ser vazio.")
    total = sum(implied_probs)
    if total <= 0:
        raise ValueError("A soma das probabilidades implícitas deve ser positiva.")
    return [p / total for p in implied_probs]


def power_method(implied_probs: list[float], tol: float = 1e-10, max_iter: int = 200) -> list[float]:
    """Remove a margem via lei de potência: encontra k tal que sum(pi_i^k) = 1.

    Busca binária sobre k em [1, k_max], já que sum(pi_i^k) é estritamente
    decrescente em k para probabilidades implícitas em (0, 1).
    """
    if not implied_probs:
        raise ValueError("implied_probs não pode ser vazio.")
    if any(p <= 0 or p >= 1 for p in implied_probs):
        raise ValueError("power_method requer 0 < pi_i < 1 para todo resultado.")

    def total_at(k: float) -> float:
        return sum(p**k for p in implied_probs)

    if abs(total_at(1.0) - 1.0) < tol:
        # Já não há overround perceptível — normalização multiplicativa basta.
        return multiplicative_normalization(implied_probs)

    lo, hi = 1.0, 2.0
    # Expande hi até a soma cair abaixo de 1 (garante que a raiz está no intervalo).
    while total_at(hi) > 1.0:
        hi *= 2.0
        if hi > 1e6:
            raise RuntimeError("power_method não convergiu ao expandir o limite superior de k.")

    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        if total_at(mid) > 1.0:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol:
            break

    k = (lo + hi) / 2.0
    probs = [p**k for p in implied_probs]
    # Normalização final para corrigir erro residual de ponto flutuante.
    s = sum(probs)
    return [p / s for p in probs]


def shin_method(implied_probs: list[float], tol: float = 1e-12, max_iter: int = 200) -> list[float]:
    """Remove a margem pelo método de Shin (1992/1993), modelando insider trading.

    Resolve z em [0, 1) tal que sum_i p_i(z) = 1, onde:
        p_i(z) = [ sqrt(z^2 + 4*(1-z)*pi_i^2/S) - z ] / (2*(1-z))
    """
    if not implied_probs:
        raise ValueError("implied_probs não pode ser vazio.")
    if any(p <= 0 for p in implied_probs):
        raise ValueError("shin_method requer pi_i > 0 para todo resultado.")

    s = sum(implied_probs)

    def probs_at(z: float) -> list[float]:
        if z <= 0.0:
            # No limite z->0, a fórmula se reduz a pi_i / sqrt(S).
            return [p / math.sqrt(s) for p in implied_probs]
        denom = 2.0 * (1.0 - z)
        return [(math.sqrt(z * z + 4.0 * (1.0 - z) * (p * p) / s) - z) / denom for p in implied_probs]

    def total_at(z: float) -> float:
        return sum(probs_at(z))

    if s <= 1.0:
        # Sem overround (ou book "plus"): não há margem de insider a remover.
        return multiplicative_normalization(implied_probs)

    lo, hi = 0.0, 1.0 - 1e-9
    if total_at(hi) > 1.0:
        # Overround extremo — melhor esforço: usa o z mais próximo de 1 permitido.
        z_star = hi
    else:
        for _ in range(max_iter):
            mid = (lo + hi) / 2.0
            if total_at(mid) > 1.0:
                lo = mid
            else:
                hi = mid
            if hi - lo < tol:
                break
        z_star = (lo + hi) / 2.0

    probs = probs_at(z_star)
    total = sum(probs)
    return [p / total for p in probs]


_METHOD_FUNCS = {
    "multiplicative": multiplicative_normalization,
    "power": power_method,
    "shin": shin_method,
}


class MarketConsensusModel(BaseModel):
    """Consenso de mercado: remove vig de cada casa e combina as probabilidades justas.

    Ao contrário dos demais modelos, não requer `train()` no sentido de
    ajuste de parâmetros por dados históricos — o "treino" aqui apenas fixa
    o método de remoção de vig e, opcionalmente, os pesos de confiabilidade
    por casa de apostas.
    """

    name = "market_consensus"
    version = "1.0.0"

    def __init__(self, method: VigRemovalMethod = "multiplicative") -> None:
        if method not in _METHOD_FUNCS:
            raise ValueError(f"Método de remoção de vig desconhecido: {method!r}")
        self.method: VigRemovalMethod = method
        # Pesos de confiabilidade/liquidez por casa de apostas (bookmaker -> peso).
        # Casas ausentes deste dict usam peso 1.0 (padrão: todas as casas iguais).
        self.bookmaker_weights: dict[str, float] = {}
        self._trained_at: datetime | None = None

    def train(self, training_data: dict, cutoff_date: datetime) -> dict:
        """Configura o método de remoção de vig e os pesos por casa (sem ajuste estatístico).

        `training_data` é opcional aqui e, quando fornecido, espera-se o
        formato `{"method": "shin", "bookmaker_weights": {"bet365": 1.2, ...}}`.
        """
        self._trained_at = cutoff_date
        if training_data:
            method = training_data.get("method")
            if method:
                if method not in _METHOD_FUNCS:
                    raise ValueError(f"Método de remoção de vig desconhecido: {method!r}")
                self.method = method
            weights = training_data.get("bookmaker_weights")
            if weights:
                self.bookmaker_weights = dict(weights)

        return {
            "model_name": self.name,
            "model_version": self.version,
            "method": self.method,
            "n_bookmaker_weights": len(self.bookmaker_weights),
        }

    def fair_probabilities_per_bookmaker(self, odds_by_outcome: dict[str, float]) -> dict[str, float]:
        """Remove a margem de UMA casa: recebe {outcome: odds_decimais} e devolve {outcome: prob_justa}."""
        outcomes = list(odds_by_outcome.keys())
        implied = [1.0 / odds_by_outcome[o] for o in outcomes]
        fair = _METHOD_FUNCS[self.method](implied)
        return dict(zip(outcomes, fair, strict=True))

    def consensus_probabilities(
        self, bookmaker_odds: dict[str, dict[str, float]]
    ) -> dict[str, float]:
        """Combina as probabilidades justas de várias casas em um consenso ponderado.

        `bookmaker_odds`: {bookmaker: {outcome: odds_decimais}}.
        Retorna {outcome: probabilidade_de_consenso}, somando 1.
        """
        if not bookmaker_odds:
            raise ValueError("bookmaker_odds não pode ser vazio.")

        weighted_sums: dict[str, float] = {}
        weight_total = 0.0

        for bookmaker, odds_by_outcome in bookmaker_odds.items():
            weight = self.bookmaker_weights.get(bookmaker, 1.0)
            fair = self.fair_probabilities_per_bookmaker(odds_by_outcome)
            for outcome, prob in fair.items():
                weighted_sums[outcome] = weighted_sums.get(outcome, 0.0) + weight * prob
            weight_total += weight

        if weight_total <= 0:
            raise ValueError("Soma dos pesos das casas deve ser positiva.")

        consensus = {outcome: total / weight_total for outcome, total in weighted_sums.items()}
        # Renormaliza — cada casa pode ter listado resultados ligeiramente
        # diferentes (ex.: linhas de handicap distintas), então a soma pode
        # não ser exatamente 1 após a média ponderada.
        s = sum(consensus.values())
        return {outcome: p / s for outcome, p in consensus.items()}

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Gera o consenso de mercado a partir de `event_data["bookmaker_odds"]`.

        `event_data` esperado:
            {
                "market": "match_result",
                "bookmaker_odds": {"bet365": {"home": 2.1, "draw": 3.4, "away": 3.2}, ...},
            }
        """
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")

        market = event_data.get("market", "match_result")
        bookmaker_odds = event_data.get("bookmaker_odds")
        if not bookmaker_odds:
            raise ValueError("event_data deve conter 'bookmaker_odds' não vazio.")

        consensus = self.consensus_probabilities(bookmaker_odds)
        n_books = len(bookmaker_odds)

        return [
            PredictionResult(
                market=market,
                outcome=outcome,
                probability=probability,
                # Confiança cresce com o número de casas concordando — proxy
                # simples; refinamentos (dispersão entre casas) ficam para depois.
                confidence=min(1.0, n_books / 5.0),
                features_used={"n_bookmakers": n_books, "vig_removal_method": self.method},
            )
            for outcome, probability in consensus.items()
        ]

    def get_params(self) -> dict:
        return {
            "method": self.method,
            "bookmaker_weights": dict(self.bookmaker_weights),
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
