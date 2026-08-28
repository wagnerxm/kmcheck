"""Modelo de gradient boosting (XGBoost/LightGBM) para resultado de partida.

Formulação matemática
----------------------
Gradient boosting constrói um ensemble aditivo de M árvores de decisão
fracas, ajustadas sequencialmente para corrigir o erro residual das
anteriores. A predição final é:

    F_M(x) = F_0(x) + sum_{m=1}^{M} eta * h_m(x)

onde `h_m` é a m-ésima árvore, `eta` é a taxa de aprendizado (shrinkage) e
`F_0` é uma predição inicial constante (ex.: log-odds da taxa-base).

A cada iteração m, a árvore `h_m` é ajustada para aproximar o gradiente
negativo da função de perda em relação à predição corrente:

    h_m ~ argmin_h  sum_j L(y_j, F_{m-1}(x_j) + h(x_j))

Para classificação multinomial (mercado 1X2) a perda é a log-loss
(entropia cruzada categórica); para mercados binários, log-loss binária:

    L(y, p) = -[y * log(p) + (1-y) * log(1-p)]         (caso binário)

XGBoost e LightGBM diferem principalmente na estratégia de crescimento das
árvores (level-wise vs. leaf-wise) e nas técnicas de regularização, mas
compartilham a mesma formulação de boosting acima. Este scaffold expõe
ambos por trás de uma interface comum (`self.backend`), selecionável por
hiperparâmetro.

Vantagem sobre modelos lineares (`app.models.logistic`): captura interações
não-lineares entre features (ex.: "vantagem de rating só importa quando o
time visitante está com muitas baixas por lesão") sem especificá-las
manualmente. Custo: menor interpretabilidade e maior risco de overfitting
em datasets pequenos — mitigado por validação walk-forward
(`app.validation.walk_forward`) e regularização (max_depth, min_child_weight,
subsample, colsample_bytree).
"""
from datetime import datetime
from typing import Any, Literal

from app.models.base import BaseModel, PredictionResult

Backend = Literal["xgboost", "lightgbm"]


class GradientBoostModel(BaseModel):
    """Modelo de gradient boosting (XGBoost ou LightGBM) sobre features tabulares."""

    name = "gradient_boost"
    version = "1.0.0"

    def __init__(
        self,
        market: str = "match_result",
        backend: Backend = "xgboost",
        n_estimators: int = 300,
        max_depth: int = 4,
        learning_rate: float = 0.05,
        subsample: float = 0.8,
        colsample_bytree: float = 0.8,
    ) -> None:
        self.market = market
        self.backend: Backend = backend
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.learning_rate = learning_rate
        self.subsample = subsample
        self.colsample_bytree = colsample_bytree

        self._estimator: Any = None
        self.feature_names: list[str] = []
        self._trained_at: datetime | None = None
        self._best_iteration: int | None = None

    def _build_estimator(self):
        """Instancia o estimador do backend configurado (`xgboost` ou `lightgbm`).

        Ambos expõem uma API compatível com scikit-learn (`fit`/`predict_proba`),
        o que mantém o restante desta classe agnóstico ao backend escolhido.
        """
        common_params = dict(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            learning_rate=self.learning_rate,
            subsample=self.subsample,
            colsample_bytree=self.colsample_bytree,
        )

        if self.backend == "xgboost":
            from xgboost import XGBClassifier

            return XGBClassifier(
                objective="multi:softprob" if self.market == "match_result" else "binary:logistic",
                eval_metric="mlogloss" if self.market == "match_result" else "logloss",
                **common_params,
            )

        from lightgbm import LGBMClassifier

        return LGBMClassifier(
            objective="multiclass" if self.market == "match_result" else "binary",
            **common_params,
        )

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Ajusta o ensemble de árvores sobre features calculadas até `cutoff_date`.

        Passos previstos (implementação completa na Fase 1):
            1. Filtrar `training_data` para `kickoff_at <= cutoff_date`.
            2. Montar X/y via `app.features.batch`, com split treino/validação
               respeitando ordem cronológica (nunca split aleatório — ver
               `app.validation.walk_forward`) para early stopping.
            3. Ajustar `self._estimator.fit(X_train, y_train,
               eval_set=[(X_val, y_val)], early_stopping_rounds=...)`.
            4. Registrar `self._best_iteration` e métricas de validação.
        """
        raise NotImplementedError("Ajuste do modelo de gradient boosting será implementado na Fase 1.")

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Calcula probabilidades via `predict_proba` do estimador ajustado."""
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        if self._estimator is None:
            raise RuntimeError("Modelo não treinado — chame train() antes de predict().")
        raise NotImplementedError("Predição via gradient boosting será implementada na Fase 1.")

    def feature_importances(self) -> dict[str, float]:
        """Retorna a importância de cada feature (gain) — útil para auditoria/explicabilidade."""
        if self._estimator is None:
            raise RuntimeError("Modelo não treinado — chame train() antes de consultar importâncias.")
        raise NotImplementedError("Extração de feature importances será implementada na Fase 1.")

    def get_params(self) -> dict:
        return {
            "market": self.market,
            "backend": self.backend,
            "n_estimators": self.n_estimators,
            "max_depth": self.max_depth,
            "learning_rate": self.learning_rate,
            "subsample": self.subsample,
            "colsample_bytree": self.colsample_bytree,
            "best_iteration": self._best_iteration,
            "feature_names": list(self.feature_names),
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
