"""Modelo de regressão logística (multinomial) para resultado de partida.

Formulação matemática
----------------------
Para o mercado 1X2 (vitória mandante / empate / vitória visitante), usamos
regressão logística multinomial (softmax) sobre um vetor de features x:

    P(y = k | x) = exp(w_k . x + b_k) / sum_{k' in {H,D,A}} exp(w_k' . x + b_k')

onde `w_k`/`b_k` são os pesos/bias da classe k, ajustados por máxima
verossimilhança regularizada (tipicamente L2) sobre o histórico rotulado:

    minimize_w  - sum_j log P(y_j | x_j) + (lambda/2) * ||w||^2

Para mercados binários (BTTS, over/under), usamos a forma logística padrão:

    P(y=1 | x) = sigmoid(w . x + b) = 1 / (1 + exp(-(w . x + b)))

Features tipicamente incluem: diferença de rating Elo, médias móveis de gols
marcados/sofridos (últimos N jogos), forma recente (pontos últimos N jogos),
dias de descanso, posição na tabela, head-to-head histórico, etc. — ver
`app.features.registry` para o catálogo completo e suas janelas temporais
(importante para não vazar dados: toda média móvel deve ser calculada com
uma janela que termina estritamente antes de `as_of`).

Diferente dos modelos de Poisson/Dixon-Coles (que modelam a distribuição de
gols diretamente), este modelo aprende os pesos das features via otimização
numérica padrão (`sklearn.linear_model.LogisticRegression`), servindo como
um dos membros do ensemble e como baseline de comparação para os modelos
de gradient boosting.
"""
from datetime import datetime
from typing import Any

from app.models.base import BaseModel, PredictionResult


class LogisticModel(BaseModel):
    """Regressão logística (multinomial ou binária, conforme o mercado) sobre features tabulares."""

    name = "logistic"
    version = "1.0.0"

    def __init__(self, market: str = "match_result", l2_penalty: float = 1.0) -> None:
        # Mercado-alvo deste modelo: um objeto `LogisticModel` é treinado por
        # mercado (ex.: uma instância para "match_result", outra para "btts").
        self.market = market
        self.l2_penalty = l2_penalty

        # Estimador scikit-learn, ajustado em `train`. Mantido como `Any` aqui
        # para não acoplar este scaffold a uma versão específica da lib.
        self._estimator: Any = None
        self.feature_names: list[str] = []
        self._trained_at: datetime | None = None

    def _build_estimator(self):
        """Instancia o estimador scikit-learn apropriado para o mercado configurado.

        Mercados de múltiplas classes (ex.: "match_result") usam
        `LogisticRegression(multi_class="multinomial")`; mercados binários
        (ex.: "btts", "over_under_goals") usam a forma binária padrão.
        """
        from sklearn.linear_model import LogisticRegression

        return LogisticRegression(
            C=1.0 / self.l2_penalty,
            max_iter=1000,
            multi_class="auto",
        )

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Ajusta os pesos da regressão logística sobre features calculadas até `cutoff_date`.

        Passos previstos (implementação completa na Fase 1):
            1. Filtrar `training_data` para partidas com `kickoff_at <= cutoff_date`.
            2. Montar a matriz de features X (via `app.features.batch`) e o
               vetor de rótulos y correspondente ao `self.market`.
            3. Ajustar `self._estimator.fit(X, y)` e registrar `self.feature_names`.
            4. Calcular métricas de treino in-sample (log-loss, acurácia) para o relatório.
        """
        raise NotImplementedError("Ajuste da regressão logística será implementado na Fase 1.")

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Calcula as probabilidades de cada classe do mercado via `predict_proba`.

        Requer que as features de `event_data` estejam na mesma ordem/escala
        de `self.feature_names` (garantido por `app.features.on_demand`).
        """
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of (vazamento de dados).")
        if self._estimator is None:
            raise RuntimeError("Modelo não treinado — chame train() antes de predict().")
        raise NotImplementedError("Predição via regressão logística será implementada na Fase 1.")

    def get_params(self) -> dict:
        return {
            "market": self.market,
            "l2_penalty": self.l2_penalty,
            "feature_names": list(self.feature_names),
            "sklearn_params": self._estimator.get_params() if self._estimator is not None else None,
            "trained_at": self._trained_at.isoformat() if self._trained_at else None,
        }
