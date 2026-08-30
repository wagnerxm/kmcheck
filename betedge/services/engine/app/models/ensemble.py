"""Modelo de ensemble — combina predições de múltiplos modelos em um consenso único.

Formulação matemática
----------------------
Dado um conjunto de M modelos, cada um produzindo uma probabilidade `p_m` para
o mesmo (evento, mercado, resultado), o ensemble combina essas estimativas em
uma única probabilidade de consenso. Estratégias suportadas (configuráveis
via `self.strategy`):

1. **Média simples**:

       p_ensemble = (1/M) * sum_m(p_m)

2. **Média ponderada por performance histórica** — pesos otimizados para
   minimizar o log loss em um conjunto de validação temporal:

       w* = argmin_w  −(1/T) Σ_t log(Σ_m w_m · p_{m,t,y_t})
       sujeito a  Σ_m w_m = 1,  w_m ≥ 0

   Resolvido por otimização convexa restrita (SLSQP) sobre o simplex.
   Os pesos são reotimizados a cada ciclo de retreino, permitindo que o
   ensemble se adapte se um modelo começar a performar melhor ou pior.

3. **Stacking** — um meta-modelo (regressão logística regularizada) recebe
   as probabilidades dos modelos-base como features e aprende uma combinação
   não necessariamente linear:

       p_ensemble = sigmoid(sum_m(beta_m * p_m) + beta_0)

   com `beta_m` ajustados por máxima verossimilhança sobre um conjunto de
   validação held-out (nunca sobre os mesmos dados usados para treinar os
   modelos-base, para não superestimar a confiança do stacking).

4. **Ajuste dinâmico de pesos** — entre ciclos de retreino, o sistema mantém
   um fator de decaimento por modelo baseado no log loss recente:

       w_m^{ajustado} ∝ w_m · exp(−κ · logloss_recente_m)

   renormalizado para somar 1, com κ controlando a sensibilidade.

5. **Incerteza do ensemble** — a dispersão das probabilidades individuais
   em torno da média do ensemble como proxy de incerteza epistêmica:

       σ²_ensemble = Σ_m w_m · (p_m − p_ensemble)²

   σ² baixo → modelos concordam (mais confiança); alto → discordância.

Importante: como cada modelo-base já respeita `cutoff_date`/`as_of`
individualmente (contrato de `BaseModel`), o ensemble em si não introduz
vazamento adicional — mas o treino do meta-modelo de stacking (estratégia 3)
deve, adicionalmente, respeitar walk-forward validation para os pesos não
serem ajustados com dados que os modelos-base "não deveriam" ter visto.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import numpy as np
from scipy.optimize import minimize

from app.models.base import BaseModel, PredictionResult

EnsembleStrategy = Literal["simple_average", "weighted_average", "stacking"]

_EPSILON = 1e-6  # evita divisão por zero


@dataclass
class EnsembleMember:
    """Um modelo-base participante do ensemble, com seu peso corrente."""

    model: BaseModel
    weight: float = 1.0
    # Brier Score histórico recente do modelo — diagnóstico.
    recent_brier_score: float | None = None
    # Log loss recente (rolling window) — usado no ajuste dinâmico.
    recent_log_loss: float | None = None


class EnsembleModel(BaseModel):
    """Combina predições de múltiplos `BaseModel` em uma predição de consenso.

    Não substitui `app.models.market_consensus.MarketConsensusModel` (que
    combina *odds de casas de apostas*): este ensemble combina *predições de
    modelos estatísticos/ML*. Os dois podem, por sua vez, ser combinados em
    uma camada de decisão final (fora do escopo deste módulo).
    """

    name = "ensemble"
    version = "2.0.0"

    def __init__(
        self,
        strategy: EnsembleStrategy = "simple_average",
        kappa: float = 1.0,
    ) -> None:
        self.strategy: EnsembleStrategy = strategy
        self.members: list[EnsembleMember] = []
        # κ do ajuste dinâmico de pesos.
        self.kappa = kappa
        # Pesos do meta-modelo de stacking.
        self._stacking_model: Any = None
        self._stacking_feature_names: list[str] = []
        self._stacking_multiclass: bool = False
        self._trained_at: datetime | None = None
        # Pesos otimizados (weighted_average).
        self._optimized_weights: list[float] | None = None

    def add_member(self, model: BaseModel, weight: float = 1.0) -> None:
        """Registra um modelo-base como membro do ensemble."""
        self.members.append(EnsembleMember(model=model, weight=weight))

    # ------------------------------------------------------------------
    # train
    # ------------------------------------------------------------------

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Treina/atualiza os pesos de combinação, conforme `self.strategy`.

        Para 'simple_average' não há nada a ajustar (pesos fixos em 1/M).
        Para 'weighted_average', espera `training_data` como dict com:
            - "validation_predictions": list[dict] — cada dict tem
              "model_name" → str, "predictions" → list[float],
              "outcomes" → list[int].
            OU, fallback simples:
            - "brier_scores": dict model_name → brier_score recente.
        Para 'stacking', espera `training_data` como dict com:
            - "validation_predictions": list[dict] com
              "model_name", "predictions" (list[list[float]] para multiclasse),
              "outcomes" (list[int]).
        """
        self._trained_at = cutoff_date

        if self.strategy == "simple_average":
            for member in self.members:
                member.weight = 1.0
            return {
                "model_name": self.name,
                "strategy": self.strategy,
                "n_members": len(self.members),
            }

        if self.strategy == "weighted_average":
            return self._train_weighted_average(training_data)

        if self.strategy == "stacking":
            return self._train_stacking(training_data)

        raise ValueError(f"Estratégia desconhecida: {self.strategy}")

    def _train_weighted_average(self, training_data: Any) -> dict:
        """Otimiza pesos minimizando log loss sobre validação (SLSQP)."""
        data = training_data if isinstance(training_data, dict) else {}

        # --- Caminho 1: otimização por log loss sobre predições de validação ---
        val_preds = data.get("validation_predictions")
        if val_preds and len(self.members) >= 2:
            return self._optimize_weights_log_loss(val_preds)

        # --- Caminho 2 (fallback): pesos por 1/brier ---
        brier_scores: dict[str, float] = data.get("brier_scores", {})
        for member in self.members:
            score = brier_scores.get(member.model.name)
            member.recent_brier_score = score
            member.weight = 1.0 / (score + _EPSILON) if score is not None else 1.0

        # Normaliza.
        total_w = sum(m.weight for m in self.members)
        if total_w > 0:
            for m in self.members:
                m.weight /= total_w

        self._optimized_weights = [m.weight for m in self.members]

        return {
            "model_name": self.name,
            "strategy": self.strategy,
            "n_members": len(self.members),
            "weights": {m.model.name: m.weight for m in self.members},
            "method": "inverse_brier",
        }

    def _optimize_weights_log_loss(self, val_preds: list[dict]) -> dict:
        """Otimiza pesos w_m minimizando log loss sobre conjunto de validação.

        Formulação:
            w* = argmin_w  −(1/T) Σ_t log(Σ_m w_m · p_{m,t,y_t})
            s.t.  Σ w_m = 1,  w_m ≥ 0
        """
        M = len(self.members)
        member_names = [m.model.name for m in self.members]

        # Monta dict model_name → (preds, outcomes).
        pred_map: dict[str, tuple[list[float], list[int]]] = {}
        for vp in val_preds:
            name = vp["model_name"]
            pred_map[name] = (vp["predictions"], vp["outcomes"])

        # Pega o primeiro membro que tem dados para descobrir N.
        first_name = next((n for n in member_names if n in pred_map), None)
        if first_name is None:
            # Sem dados → pesos iguais.
            for m in self.members:
                m.weight = 1.0 / M
            return {
                "model_name": self.name,
                "strategy": self.strategy,
                "n_members": M,
                "weights": {m.model.name: m.weight for m in self.members},
                "method": "equal_fallback",
            }

        N = len(pred_map[first_name][0])
        outcomes = np.array(pred_map[first_name][1], dtype=np.float64)

        # Matriz P: (M, N) — predições de cada membro.
        P = np.zeros((M, N), dtype=np.float64)
        for i, name in enumerate(member_names):
            if name in pred_map:
                P[i] = np.array(pred_map[name][0], dtype=np.float64)
            else:
                P[i] = 0.5  # fallback se membro não tem predição

        def neg_avg_log_likelihood(w: np.ndarray) -> float:
            # p_ensemble = Σ w_m * p_m
            p_ens = np.clip(w @ P, _EPSILON, 1 - _EPSILON)
            # log loss binário: -[y*log(p) + (1-y)*log(1-p)]
            ll = outcomes * np.log(p_ens) + (1 - outcomes) * np.log(1 - p_ens)
            return float(-np.mean(ll))

        # Restrições: simplex (soma = 1, cada w >= 0).
        constraints = {"type": "eq", "fun": lambda w: np.sum(w) - 1.0}
        bounds = [(0.0, 1.0)] * M
        w0 = np.ones(M) / M

        result = minimize(
            neg_avg_log_likelihood,
            x0=w0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
        )
        w_opt = result.x

        for i, member in enumerate(self.members):
            member.weight = float(w_opt[i])

        self._optimized_weights = [float(w) for w in w_opt]

        return {
            "model_name": self.name,
            "strategy": self.strategy,
            "n_members": M,
            "weights": {m.model.name: m.weight for m in self.members},
            "method": "log_loss_optimization",
            "optimization_success": result.success,
            "final_log_loss": float(result.fun),
        }

    def _train_stacking(self, training_data: Any) -> dict:
        """Treina o meta-modelo de stacking (regressão logística regularizada).

        O meta-modelo recebe as probabilidades de cada modelo-base como features
        e aprende os coeficientes ótimos de combinação.
        """
        from sklearn.linear_model import LogisticRegression

        data = training_data if isinstance(training_data, dict) else {}
        val_preds = data.get("validation_predictions")

        if not val_preds:
            raise ValueError(
                "Stacking requer 'validation_predictions' no training_data — "
                "lista de dicts com 'model_name', 'predictions', 'outcomes'."
            )

        M = len(self.members)
        member_names = [m.model.name for m in self.members]

        # Monta dict model_name → preds.
        pred_map: dict[str, list] = {}
        outcomes_raw: list | None = None
        for vp in val_preds:
            pred_map[vp["model_name"]] = vp["predictions"]
            if outcomes_raw is None:
                outcomes_raw = vp["outcomes"]

        if outcomes_raw is None:
            raise ValueError("validation_predictions sem outcomes.")

        N = len(outcomes_raw)
        outcomes = np.array(outcomes_raw, dtype=np.int32)

        # Monta matriz de features: (N, M) — cada coluna é a predição de um membro.
        # Para multiclasse, cada "prediction" é um vetor de probs → achata.
        sample = pred_map.get(member_names[0], [])
        is_multiclass = sample and isinstance(sample[0], (list, np.ndarray))
        if is_multiclass:
            # Multiclasse: cada predição é [p_0, p_1, p_2, ...]
            n_classes = len(sample[0])
            X = np.zeros((N, M * n_classes), dtype=np.float64)
            feature_names = []
            for i, name in enumerate(member_names):
                preds = pred_map.get(name, [[1.0 / n_classes] * n_classes] * N)
                for j in range(n_classes):
                    col_idx = i * n_classes + j
                    X[:, col_idx] = [p[j] for p in preds]
                    feature_names.append(f"{name}_class{j}")
        else:
            # Binário: cada predição é um escalar.
            X = np.zeros((N, M), dtype=np.float64)
            feature_names = []
            for i, name in enumerate(member_names):
                preds = pred_map.get(name, [0.5] * N)
                X[:, i] = np.array(preds, dtype=np.float64)
                feature_names.append(name)

        self._stacking_feature_names = feature_names
        self._stacking_multiclass = bool(is_multiclass)

        # Treina regressão logística regularizada (L2, C=1.0).
        # Nota: sklearn ≥1.6 removeu o parâmetro multi_class (auto-detecta).
        lr = LogisticRegression(
            C=1.0,
            max_iter=1000,
            random_state=42,
        )
        lr.fit(X, outcomes)
        self._stacking_model = lr

        # Atualiza pesos dos membros (para exibição) com magnitude dos coefs.
        coefs = np.abs(lr.coef_).sum(axis=0) if lr.coef_.ndim > 1 else np.abs(lr.coef_[0])
        # Agrupa coefs por membro (se multiclasse, soma as colunas de cada membro).
        member_importance = np.zeros(M)
        if sample and isinstance(sample[0], (list, np.ndarray)):
            for i in range(M):
                start = i * n_classes
                member_importance[i] = coefs[start:start + n_classes].sum()
        else:
            member_importance = coefs[:M]

        total_imp = member_importance.sum()
        if total_imp > 0:
            member_importance /= total_imp
        for i, member in enumerate(self.members):
            member.weight = float(member_importance[i])

        return {
            "model_name": self.name,
            "strategy": self.strategy,
            "n_members": M,
            "n_features": len(feature_names),
            "weights": {m.model.name: m.weight for m in self.members},
            "method": "logistic_regression_stacking",
        }

    # ------------------------------------------------------------------
    # predict
    # ------------------------------------------------------------------

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
            return self._predict_stacking(event_data, as_of)

        return self._predict_average(event_data, as_of)

    def _predict_average(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Predição por média simples ou ponderada."""
        # Coleta todas as predições, indexadas por (market, outcome).
        grouped: dict[tuple[str, str], list[tuple[float, float]]] = {}
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

            # Incerteza do ensemble: variância ponderada.
            variance = sum(
                w * (p - combined_prob) ** 2 for p, w in prob_weight_pairs
            ) / weight_sum

            results.append(
                PredictionResult(
                    market=market,
                    outcome=outcome,
                    probability=combined_prob,
                    confidence=min(1.0, len(prob_weight_pairs) / max(len(self.members), 1)),
                    features_used={
                        "strategy": self.strategy,
                        "n_contributing_models": len(prob_weight_pairs),
                        "ensemble_variance": float(variance),
                    },
                )
            )

        # Renormaliza cada mercado para somar 1.
        self._renormalize_results(results)
        return results

    def _predict_stacking(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Predição via meta-modelo de stacking.

        A construção do feature vector respeita o modo em que o meta-modelo
        foi treinado (binário ou multiclasse). No modo binário, aplicamos o
        meta-modelo *por outcome* (cada outcome recebe prob independente do LR),
        depois renormalizamos por mercado. No multiclasse, um único predict_proba
        já retorna as probabilidades de cada classe.
        """
        if self._stacking_model is None:
            raise RuntimeError("Meta-modelo de stacking não treinado — chame train() primeiro.")

        # Coleta predições brutas de cada membro.
        member_preds: dict[str, list[PredictionResult]] = {}
        for member in self.members:
            preds = member.model.predict(event_data, as_of)
            member_preds[member.model.name] = preds

        # Agrupa outcomes por mercado (usa primeiro membro como referência).
        first_preds = next(iter(member_preds.values()))
        by_market: dict[str, list[PredictionResult]] = {}
        for p in first_preds:
            by_market.setdefault(p.market, []).append(p)

        results: list[PredictionResult] = []

        for market, market_outcomes in by_market.items():
            outcome_names = [p.outcome for p in market_outcomes]

            if self._stacking_multiclass and len(outcome_names) >= 3:
                # Multiclasse: monta feature vector [m1_c0, m1_c1, m1_c2, m2_c0, ...]
                n_classes = len(outcome_names)
                x = []
                for member in self.members:
                    m_preds = {p.outcome: p.probability
                               for p in member_preds.get(member.model.name, [])
                               if p.market == market}
                    for oc in outcome_names:
                        x.append(m_preds.get(oc, 1.0 / n_classes))
                X = np.array([x])
                probs = self._stacking_model.predict_proba(X)[0]

                for i, outcome in enumerate(outcome_names):
                    prob = float(probs[i]) if i < len(probs) else 0.0
                    results.append(PredictionResult(
                        market=market,
                        outcome=outcome,
                        probability=prob,
                        features_used={
                            "strategy": "stacking",
                            "n_contributing_models": len(self.members),
                        },
                    ))
            else:
                # Binário: para cada outcome, monta feature = [m1_prob, m2_prob, ...]
                # e obtém P(classe=1) do meta-modelo, que é a prob calibrada
                # para esse outcome. Renormalização posterior garante soma = 1.
                for outcome in outcome_names:
                    x = []
                    for member in self.members:
                        m_preds = {p.outcome: p.probability
                                   for p in member_preds.get(member.model.name, [])
                                   if p.market == market}
                        x.append(m_preds.get(outcome, 0.5))
                    X = np.array([x])
                    probs = self._stacking_model.predict_proba(X)[0]
                    # Usa P(classe=1) como probabilidade do outcome.
                    prob = float(probs[1]) if len(probs) > 1 else float(probs[0])
                    results.append(PredictionResult(
                        market=market,
                        outcome=outcome,
                        probability=prob,
                        features_used={"strategy": "stacking"},
                    ))

        self._renormalize_results(results)
        return results

    # ------------------------------------------------------------------
    # Ajuste dinâmico de pesos
    # ------------------------------------------------------------------

    def adjust_weights_dynamic(
        self,
        recent_log_losses: dict[str, float],
    ) -> dict[str, float]:
        """Ajusta pesos dinamicamente via decaimento exponencial por log loss recente.

            w_m^{ajustado} ∝ w_m · exp(−κ · logloss_recente_m)

        Permite reagir a degradação de performance de um modelo entre ciclos
        de retreino, sem esperar a próxima reotimização completa.

        Args:
            recent_log_losses: dict model_name → log loss das últimas N predições.

        Returns:
            Dict model_name → peso ajustado (normalizado para somar 1).
        """
        for member in self.members:
            ll = recent_log_losses.get(member.model.name)
            member.recent_log_loss = ll
            if ll is not None:
                member.weight *= math.exp(-self.kappa * ll)

        # Renormaliza.
        total = sum(m.weight for m in self.members)
        if total > 0:
            for m in self.members:
                m.weight /= total

        return {m.model.name: m.weight for m in self.members}

    # ------------------------------------------------------------------
    # Incerteza do ensemble
    # ------------------------------------------------------------------

    @staticmethod
    def compute_ensemble_uncertainty(
        member_probs: list[float],
        weights: list[float],
    ) -> float:
        """Calcula a variância ponderada das probabilidades individuais.

            σ² = Σ_m w_m · (p_m − p_ensemble)²

        Retorna σ² — proxy de incerteza epistêmica. Baixo → concordância;
        alto → discordância entre modelos.
        """
        if not member_probs or not weights:
            return 0.0

        w = np.array(weights, dtype=np.float64)
        p = np.array(member_probs, dtype=np.float64)

        # Normaliza pesos.
        w_sum = w.sum()
        if w_sum <= 0:
            return 0.0
        w = w / w_sum

        p_ensemble = float(np.dot(w, p))
        variance = float(np.dot(w, (p - p_ensemble) ** 2))
        return variance

    # ------------------------------------------------------------------
    # Utilitários
    # ------------------------------------------------------------------

    @staticmethod
    def _renormalize_results(results: list[PredictionResult]) -> None:
        """Renormaliza probabilidades por mercado para somar 1."""
        by_market: dict[str, list[PredictionResult]] = {}
        for r in results:
            by_market.setdefault(r.market, []).append(r)
        for market_results in by_market.values():
            total = sum(r.probability for r in market_results)
            if total > 0:
                for r in market_results:
                    r.probability /= total

    def get_params(self) -> dict:
        return {
            "strategy": self.strategy,
            "kappa": self.kappa,
            "members": [
                {
                    "name": m.model.name,
                    "version": m.model.version,
                    "weight": m.weight,
                    "recent_brier_score": m.recent_brier_score,
                    "recent_log_loss": m.recent_log_loss,
                }
                for m in self.members
            ],
            "has_stacking_model": self._stacking_model is not None,
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
