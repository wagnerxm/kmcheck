"""Modelo de ensemble — combina predições de múltiplos modelos em um consenso único.

Formulação matemática
----------------------
Dado um conjunto de M modelos, cada um produzindo uma probabilidade `p_m` para
o mesmo (evento, mercado, resultado), o ensemble combina essas estimativas em
uma única probabilidade de consenso. Estratégias suportadas (configuráveis
via `self.strategy`):

1. **Média simples**:

       p_ensemble = (1/M) * sum_m(p_m)

2. **Média ponderada por performance histórica** — pesa cada modelo pelo
   inverso do seu Brier Score histórico recente (modelos mais calibrados
   pesam mais). Com `w_m = 1 / (brier_m + epsilon)`:

       p_ensemble = sum_m(w_m * p_m) / sum_m(w_m)

3. **Stacking** — em vez de uma combinação linear fixa, treina um
   meta-modelo (tipicamente regressão logística) que recebe as predições
   dos modelos-base como features e aprende os pesos ótimos de combinação:

       p_ensemble = sigmoid(sum_m(beta_m * p_m) + beta_0)

   com `beta_m` ajustados por máxima verossimilhança sobre um conjunto de
   validação held-out (nunca sobre os mesmos dados usados para treinar os
   modelos-base, para não superestimar a confiança do stacking).

Importante: como cada modelo-base já respeita `cutoff_date`/`as_of`
individualmente (contrato de `BaseModel`), o ensemble em si não introduz
vazamento adicional — mas o treino do meta-modelo de stacking (estratégia 3)
deve, adicionalmente, respeitar walk-forward validation
(`app.validation.walk_forward`) para os pesos não serem ajustados com dados
que os modelos-base "não deveriam" ter visto antes do respectivo `as_of`.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.models.base import BaseModel, PredictionResult

EnsembleStrategy = Literal["simple_average", "weighted_average", "stacking"]

_EPSILON = 1e-6  # evita divisão por zero ao ponderar por 1/brier_score


@dataclass
class EnsembleMember:
    """Um modelo-base participante do ensemble, com seu peso corrente."""

    model: BaseModel
    weight: float = 1.0
    # Brier Score histórico recente do modelo — usado na estratégia 'weighted_average'.
    recent_brier_score: float | None = None


class EnsembleModel(BaseModel):
    """Combina predições de múltiplos `BaseModel` em uma predição de consenso.

    Não substitui `app.models.market_consensus.MarketConsensusModel` (que
    combina *odds de casas de apostas*): este ensemble combina *predições de
    modelos estatísticos/ML*. Os dois podem, por sua vez, ser combinados em
    uma camada de decisão final (fora do escopo deste módulo).
    """

    name = "ensemble"
    version = "1.0.0"

    def __init__(self, strategy: EnsembleStrategy = "simple_average") -> None:
        self.strategy: EnsembleStrategy = strategy
        self.members: list[EnsembleMember] = []
        # Pesos do meta-modelo de stacking (populados apenas quando strategy == "stacking").
        self._stacking_weights: dict[str, float] | None = None
        self._trained_at: datetime | None = None

    def add_member(self, model: BaseModel, weight: float = 1.0) -> None:
        """Registra um modelo-base como membro do ensemble."""
        self.members.append(EnsembleMember(model=model, weight=weight))

    def train(self, training_data: dict, cutoff_date: datetime) -> dict:
        """Treina/atualiza os pesos de combinação, conforme `self.strategy`.

        Para 'simple_average' não há nada a ajustar (pesos fixos em 1.0).
        Para 'weighted_average', espera `training_data["brier_scores"]`
        (dict model_name -> brier_score recente) para recalcular os pesos.
        Para 'stacking', TODO(fase 2): ajustar o meta-modelo de regressão
        logística sobre as predições dos membros em um conjunto de validação
        held-out, respeitando `cutoff_date`.
        """
        self._trained_at = cutoff_date

        if self.strategy == "weighted_average":
            brier_scores: dict[str, float] = training_data.get("brier_scores", {}) if training_data else {}
            for member in self.members:
                score = brier_scores.get(member.model.name)
                member.recent_brier_score = score
                member.weight = 1.0 / (score + _EPSILON) if score is not None else 1.0
            return {
                "model_name": self.name,
                "strategy": self.strategy,
                "n_members": len(self.members),
                "weights": {m.model.name: m.weight for m in self.members},
            }

        if self.strategy == "stacking":
            raise NotImplementedError("Treino do meta-modelo de stacking será implementado na Fase 2.")

        # simple_average: nada a ajustar.
        return {
            "model_name": self.name,
            "strategy": self.strategy,
            "n_members": len(self.members),
        }

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Coleta a predição de cada membro e combina segundo `self.strategy`.

        Predições de membros diferentes são casadas por (market, outcome).
        Membros que não produzirem uma predição para um dado (market, outcome)
        simplesmente não contribuem para aquela combinação específica.
        """
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        if not self.members:
            raise RuntimeError("Ensemble sem membros registrados — use add_member() antes de predict().")

        if self.strategy == "stacking":
            raise NotImplementedError("Predição via stacking será implementada na Fase 2.")

        # Coleta todas as predições de todos os membros, indexadas por (market, outcome).
        grouped: dict[tuple[str, str], list[tuple[float, float]]] = {}  # (prob, weight)
        for member in self.members:
            member_predictions = member.model.predict(event_data, as_of)
            for pred in member_predictions:
                key = (pred.market, pred.outcome)
                grouped.setdefault(key, []).append((pred.probability, member.weight))

        results: list[PredictionResult] = []
        for (market, outcome), prob_weight_pairs in grouped.items():
            weight_sum = sum(w for _, w in prob_weight_pairs)
            if weight_sum <= 0:
                continue
            combined_prob = sum(p * w for p, w in prob_weight_pairs) / weight_sum

            results.append(
                PredictionResult(
                    market=market,
                    outcome=outcome,
                    probability=combined_prob,
                    confidence=min(1.0, len(prob_weight_pairs) / max(len(self.members), 1)),
                    features_used={
                        "strategy": self.strategy,
                        "n_contributing_models": len(prob_weight_pairs),
                    },
                )
            )

        # Renormaliza cada grupo de mercado para que as probabilidades somem 1
        # (necessário quando nem todos os membros cobrem todos os resultados).
        by_market: dict[str, list[PredictionResult]] = {}
        for r in results:
            by_market.setdefault(r.market, []).append(r)
        for market_results in by_market.values():
            total = sum(r.probability for r in market_results)
            if total > 0:
                for r in market_results:
                    r.probability = r.probability / total

        return results

    def get_params(self) -> dict:
        return {
            "strategy": self.strategy,
            "members": [
                {
                    "name": m.model.name,
                    "version": m.model.version,
                    "weight": m.weight,
                    "recent_brier_score": m.recent_brier_score,
                }
                for m in self.members
            ],
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
