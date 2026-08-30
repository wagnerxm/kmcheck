"""Calibradores pós-hoc — transformam probabilidades brutas em probabilidades calibradas.

Cada calibrador implementa a interface:
    fit(predictions, outcomes)   — ajusta parâmetros sobre dados de validação.
    transform(predictions)       — aplica a transformação calibrada.
    fit_transform(preds, outs)   — atalho: fit + transform.

Os dados de validação usados em `fit` DEVEM ser estritamente temporais e
posteriores ao conjunto de treino do modelo-base (para não introduzir
leakage indireto). A responsabilidade de garantir isso é do chamador
(tipicamente `CalibratedModel` ou o pipeline de walk-forward).

Referências:
- Platt (2000), "Probabilistic outputs for support vector machines"
- Zadrozny & Elkan (2002), "Transforming classifier scores into accurate
  multiclass probability estimates" (isotonic)
- Guo et al. (2017), "On calibration of modern neural networks" (temperature)
"""
from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np
from scipy.optimize import minimize


class BaseCalibrator(ABC):
    """Interface comum para todos os calibradores."""

    @abstractmethod
    def fit(self, predictions: np.ndarray, outcomes: np.ndarray) -> None:
        """Ajusta os parâmetros do calibrador sobre dados de validação."""
        ...

    @abstractmethod
    def transform(self, predictions: np.ndarray) -> np.ndarray:
        """Aplica a calibração a um vetor de probabilidades brutas."""
        ...

    def fit_transform(self, predictions: np.ndarray, outcomes: np.ndarray) -> np.ndarray:
        """Ajusta e aplica a calibração em sequência."""
        self.fit(predictions, outcomes)
        return self.transform(predictions)

    @abstractmethod
    def get_params(self) -> dict:
        """Retorna os parâmetros aprendidos (para serialização/auditoria)."""
        ...


# ═══════════════════════════════════════════════════════════════════════════
# Platt Scaling
# ═══════════════════════════════════════════════════════════════════════════

class PlattScaling(BaseCalibrator):
    """Platt scaling — ajusta uma sigmóide sobre as log-odds do modelo.

    Transforma a probabilidade predita `p` em calibrada `q`:

        f = log(p / (1 - p))           (log-odds do modelo)
        q = 1 / (1 + exp(-(a*f + b)))  (sigmóide parametrizada)

    Os parâmetros (a, b) são aprendidos minimizando a log-loss (entropia
    cruzada binária) sobre o conjunto de validação.

    Propriedades:
    - Monotônica: preserva a ordenação das probabilidades originais (se a > 0).
    - 2 parâmetros: baixo risco de overfitting, adequada mesmo com ~100 amostras.
    - a ≈ 1, b ≈ 0 indica modelo já calibrado (identidade em log-odds).
    """

    def __init__(self) -> None:
        self.a: float = 1.0  # inclinação (slope)
        self.b: float = 0.0  # intercepto (bias)
        self._fitted: bool = False

    def fit(self, predictions: np.ndarray, outcomes: np.ndarray) -> None:
        """Ajusta (a, b) por máxima verossimilhança (minimização de log-loss)."""
        predictions = np.asarray(predictions, dtype=np.float64)
        outcomes = np.asarray(outcomes, dtype=np.float64)

        if len(predictions) < 5:
            raise ValueError("Platt scaling requer pelo menos 5 amostras de validação.")

        eps = 1e-12
        # Log-odds do modelo original.
        p_clip = np.clip(predictions, eps, 1 - eps)
        logits = np.log(p_clip / (1 - p_clip))

        def neg_log_likelihood(params: np.ndarray) -> float:
            a, b = params
            # Sigmóide: q = 1 / (1 + exp(-(a*f + b)))
            z = a * logits + b
            # Numericamente estável: -y*log(σ(z)) - (1-y)*log(1-σ(z))
            #   = max(z,0) - y*z + log(1 + exp(-|z|))
            loss = np.mean(
                np.maximum(z, 0) - outcomes * z + np.log1p(np.exp(-np.abs(z)))
            )
            return float(loss)

        result = minimize(
            neg_log_likelihood,
            x0=np.array([1.0, 0.0]),
            method="L-BFGS-B",
        )
        self.a, self.b = float(result.x[0]), float(result.x[1])
        self._fitted = True

    def transform(self, predictions: np.ndarray) -> np.ndarray:
        """Aplica a transformação sigmóide calibrada."""
        if not self._fitted:
            raise RuntimeError("Calibrador não ajustado — chame fit() antes de transform().")

        predictions = np.asarray(predictions, dtype=np.float64)
        eps = 1e-12
        p_clip = np.clip(predictions, eps, 1 - eps)
        logits = np.log(p_clip / (1 - p_clip))

        z = self.a * logits + self.b
        # Sigmóide numericamente estável.
        return 1.0 / (1.0 + np.exp(-z))

    def get_params(self) -> dict:
        return {"method": "platt_scaling", "a": self.a, "b": self.b, "fitted": self._fitted}


# ═══════════════════════════════════════════════════════════════════════════
# Isotonic Regression
# ═══════════════════════════════════════════════════════════════════════════

class IsotonicCalibrator(BaseCalibrator):
    """Calibração por regressão isotônica — mapeamento não-paramétrico monotônico.

    Ajusta uma step-function monotonicamente não-decrescente que mapeia
    probabilidades preditas → frequências observadas, sem assumir forma
    funcional (ao contrário de Platt). Usa a implementação de pool adjacent
    violators (PAVA) via `sklearn.isotonic.IsotonicRegression`.

    Propriedades:
    - Não-paramétrica: pode corrigir descalibrações não-monotônicas (ex.:
      overconfidence em probabilidades altas e underconfidence em baixas).
    - Requer mais dados (~300+ amostras) para evitar overfitting.
    - Garante monotonicidade (probabilidades calibradas preservam a
      ordenação das originais).
    """

    def __init__(self) -> None:
        self._model: object | None = None
        self._fitted: bool = False

    def fit(self, predictions: np.ndarray, outcomes: np.ndarray) -> None:
        from sklearn.isotonic import IsotonicRegression

        predictions = np.asarray(predictions, dtype=np.float64)
        outcomes = np.asarray(outcomes, dtype=np.float64)

        if len(predictions) < 10:
            raise ValueError("Isotonic calibration requer pelo menos 10 amostras de validação.")

        self._model = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
        self._model.fit(predictions, outcomes)
        self._fitted = True

    def transform(self, predictions: np.ndarray) -> np.ndarray:
        if not self._fitted or self._model is None:
            raise RuntimeError("Calibrador não ajustado — chame fit() antes de transform().")

        predictions = np.asarray(predictions, dtype=np.float64)
        return np.asarray(self._model.transform(predictions), dtype=np.float64)

    def get_params(self) -> dict:
        return {"method": "isotonic", "fitted": self._fitted}


# ═══════════════════════════════════════════════════════════════════════════
# Temperature Scaling
# ═══════════════════════════════════════════════════════════════════════════

class TemperatureScaling(BaseCalibrator):
    """Temperature scaling — recalibra por um único parâmetro de temperatura.

    Caso especial de Platt scaling com a = 1/T e b = 0. Transforma a
    probabilidade predita `p` em calibrada `q`:

        f = log(p / (1-p))             (log-odds)
        q = 1 / (1 + exp(-f/T))        (sigmóide com temperatura)

    T > 1 "esfria" as distribuições (move probabilidades para mais perto
    de 0.5, reduzindo overconfidence); T < 1 "esquenta" (move para os
    extremos, reduzindo underconfidence); T = 1 é a identidade.

    Um único parâmetro → praticamente impossível overfittar, mesmo com
    poucas amostras de validação. Ideal como primeira passada de calibração.
    """

    def __init__(self) -> None:
        self.temperature: float = 1.0
        self._fitted: bool = False

    def fit(self, predictions: np.ndarray, outcomes: np.ndarray) -> None:
        predictions = np.asarray(predictions, dtype=np.float64)
        outcomes = np.asarray(outcomes, dtype=np.float64)

        if len(predictions) < 5:
            raise ValueError("Temperature scaling requer pelo menos 5 amostras.")

        eps = 1e-12
        p_clip = np.clip(predictions, eps, 1 - eps)
        logits = np.log(p_clip / (1 - p_clip))

        def neg_log_likelihood(log_T: np.ndarray) -> float:
            T = np.exp(log_T[0])  # otimiza em log-espaço para garantir T > 0
            z = logits / T
            loss = np.mean(
                np.maximum(z, 0) - outcomes * z + np.log1p(np.exp(-np.abs(z)))
            )
            return float(loss)

        # Otimiza log(T), partindo de T=1 (log(1)=0).
        result = minimize(neg_log_likelihood, x0=np.array([0.0]), method="L-BFGS-B")
        self.temperature = float(np.exp(result.x[0]))
        self._fitted = True

    def transform(self, predictions: np.ndarray) -> np.ndarray:
        if not self._fitted:
            raise RuntimeError("Calibrador não ajustado — chame fit() antes de transform().")

        predictions = np.asarray(predictions, dtype=np.float64)
        eps = 1e-12
        p_clip = np.clip(predictions, eps, 1 - eps)
        logits = np.log(p_clip / (1 - p_clip))

        z = logits / self.temperature
        return 1.0 / (1.0 + np.exp(-z))

    def get_params(self) -> dict:
        return {
            "method": "temperature_scaling",
            "temperature": self.temperature,
            "fitted": self._fitted,
        }


# ═══════════════════════════════════════════════════════════════════════════
# Calibração multiclasse (3-vias)
# ═══════════════════════════════════════════════════════════════════════════

class MulticlassCalibrator:
    """Calibração de probabilidades multiclasse via one-vs-all.

    Para mercados como match_result (3 vias: home/draw/away), aplica um
    calibrador binário a cada classe separadamente e renormaliza para que
    as probabilidades calibradas somem 1.

    Isso é necessário porque Platt, isotonic e temperature scaling são
    definidos para o caso binário (P(classe k) individual). A aplicação
    ingênua sem renormalização pode produzir probabilidades que somam != 1.
    """

    def __init__(self, calibrator_factory: type[BaseCalibrator] = PlattScaling) -> None:
        self._factory = calibrator_factory
        self._calibrators: dict[int, BaseCalibrator] = {}
        self._n_classes: int = 0
        self._fitted: bool = False

    def fit(self, prob_matrix: np.ndarray, labels: np.ndarray) -> None:
        """Ajusta um calibrador por classe sobre dados de validação.

        Args:
            prob_matrix: (n_samples, n_classes) — probabilidades brutas.
            labels: (n_samples,) — classe correta (inteiro 0..n_classes-1).
        """
        prob_matrix = np.asarray(prob_matrix, dtype=np.float64)
        labels = np.asarray(labels, dtype=np.int32)
        self._n_classes = prob_matrix.shape[1]

        for k in range(self._n_classes):
            cal = self._factory()
            # Binário: P(classe k) vs outcomes indicadores.
            binary_outcomes = (labels == k).astype(np.float64)
            cal.fit(prob_matrix[:, k], binary_outcomes)
            self._calibrators[k] = cal

        self._fitted = True

    def transform(self, prob_matrix: np.ndarray) -> np.ndarray:
        """Calibra e renormaliza o vetor de probabilidades."""
        if not self._fitted:
            raise RuntimeError("Calibrador não ajustado — chame fit() antes de transform().")

        prob_matrix = np.asarray(prob_matrix, dtype=np.float64)
        calibrated = np.zeros_like(prob_matrix)

        for k in range(self._n_classes):
            calibrated[:, k] = self._calibrators[k].transform(prob_matrix[:, k])

        # Renormaliza para somar 1 por amostra.
        row_sums = calibrated.sum(axis=1, keepdims=True)
        row_sums = np.maximum(row_sums, 1e-15)
        calibrated /= row_sums

        return calibrated

    def fit_transform(self, prob_matrix: np.ndarray, labels: np.ndarray) -> np.ndarray:
        self.fit(prob_matrix, labels)
        return self.transform(prob_matrix)

    def get_params(self) -> dict:
        return {
            "method": "multiclass_one_vs_all",
            "n_classes": self._n_classes,
            "calibrator_type": self._factory.__name__,
            "per_class_params": {
                k: cal.get_params() for k, cal in self._calibrators.items()
            },
            "fitted": self._fitted,
        }
