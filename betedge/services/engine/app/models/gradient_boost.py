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
compartilham a mesma formulação de boosting acima. Este módulo expõe
ambos por trás de uma interface comum (`self.backend`), selecionável por
hiperparâmetro.

Pipeline de features
---------------------
O modelo consome features tabulares computadas por `app.features.batch`
(treino) e `app.features.on_demand` (predição), via o registro central
`app.features.registry`. As features são passadas como arrays NumPy para
o estimador; valores ausentes (None/NaN) são tratados nativamente pelo
XGBoost/LightGBM (missing-value-aware splits).

Split temporal para early stopping
------------------------------------
O conjunto de treino é dividido em treino/validação por data (NUNCA split
aleatório — ver MODELING.md §4 e §5), usando o último ~20% cronológico
como validação para early stopping. Isso garante que a parada antecipada
reflete a capacidade preditiva real do modelo no futuro, não a capacidade
de memorizar dados vistos.
"""
from datetime import datetime
from typing import Any, Literal

import numpy as np

from app.features.batch import compute_batch_features
from app.features.on_demand import compute_event_features
from app.models.base import BaseModel, PredictionResult

Backend = Literal["xgboost", "lightgbm"]

# Features padrão usadas pelo modelo quando nenhuma lista é fornecida.
# Exclui market_implied_prob (nem sempre disponível) e features que
# requerem muito histórico. O modelo tolera NaN nativamente, mas
# features com alta taxa de ausência degradam a performance.
_DEFAULT_FEATURES = [
    "elo_diff",
    "goals_scored_avg_last5",
    "goals_conceded_avg_last5",
    "goals_scored_avg_last10",
    "goals_conceded_avg_last10",
    "rest_days",
    "points_per_game_last5",
    "win_streak",
    "unbeaten_streak",
    "clean_sheet_streak",
    "h2h_points_avg",
    "games_last_14_days",
    "is_home",
]

# Mapeamento de label contínuo (1.0/0.5/0.0) para classes inteiras.
# Para match_result (3 vias): 2=vitória, 1=empate, 0=derrota.
# Para mercados binários: 1=sim, 0=não.
_LABEL_MAP_3WAY = {1.0: 2, 0.5: 1, 0.0: 0}

# Fração do dataset reservada para validação (early stopping).
# Usa o último bloco cronológico, nunca aleatório.
_VALIDATION_FRACTION = 0.2

# Rodadas sem melhora no eval_set antes de parar o boosting.
_EARLY_STOPPING_ROUNDS = 30


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
        feature_list: list[str] | None = None,
    ) -> None:
        self.market = market
        self.backend: Backend = backend
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.learning_rate = learning_rate
        self.subsample = subsample
        self.colsample_bytree = colsample_bytree

        self._estimator: Any = None
        self.feature_names: list[str] = list(feature_list or _DEFAULT_FEATURES)
        self._trained_at: datetime | None = None
        self._best_iteration: int | None = None
        # Classes aprendidas (ex.: [0, 1, 2] para 3-vias).
        self._classes: list[int] = []

    def _build_estimator(self) -> Any:
        """Instancia o estimador do backend configurado (`xgboost` ou `lightgbm`).

        Ambos expõem uma API compatível com scikit-learn (`fit`/`predict_proba`),
        o que mantém o restante desta classe agnóstico ao backend escolhido.
        """
        is_multiclass = self.market == "match_result"

        common_params: dict[str, Any] = dict(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            learning_rate=self.learning_rate,
            subsample=self.subsample,
            colsample_bytree=self.colsample_bytree,
            random_state=42,  # reprodutibilidade
        )

        if self.backend == "xgboost":
            from xgboost import XGBClassifier

            return XGBClassifier(
                objective="multi:softprob" if is_multiclass else "binary:logistic",
                eval_metric="mlogloss" if is_multiclass else "logloss",
                use_label_encoder=False,
                verbosity=0,
                **common_params,
            )

        from lightgbm import LGBMClassifier

        return LGBMClassifier(
            objective="multiclass" if is_multiclass else "binary",
            num_class=3 if is_multiclass else None,
            verbose=-1,
            **common_params,
        )

    # ------------------------------------------------------------------
    # train
    # ------------------------------------------------------------------

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Ajusta o ensemble de árvores sobre features calculadas até `cutoff_date`.

        Etapas:
            1. Filtra `training_data` para `kickoff_at <= cutoff_date` (anti-leakage).
            2. Calcula features em lote via `compute_batch_features`.
            3. Monta X (features numéricas) e y (labels inteiros) adequados
               ao backend.
            4. Split temporal treino/validação (último ~20% cronológico) para
               early stopping — nunca split aleatório.
            5. Ajusta `self._estimator.fit(X_train, y_train, ...)` com
               eval_set para early stopping.
            6. Registra métricas, best_iteration e feature importances.

        Returns:
            dict com métricas do treino.
        """
        # --- 1. Computar features em lote ------------------------------------
        # O compute_batch_features já filtra por cutoff_date e ordena.
        features_df = compute_batch_features(
            events=training_data,
            feature_names=self.feature_names,
            cutoff_date=cutoff_date,
        )

        n_total = len(features_df)
        if n_total < 10:
            raise ValueError(
                f"Dados insuficientes para treino: apenas {n_total} amostras "
                "(mínimo recomendado: pelo menos 10)."
            )

        # --- 2. Montar X e y -------------------------------------------------
        # X: colunas de features numéricas. NaN é mantido — XGBoost/LightGBM
        # tratam valores ausentes nativamente (missing-value-aware splits).
        X = features_df[self.feature_names].values.astype(np.float64)

        # y: label inteiro para classificação.
        if self.market == "match_result":
            # 3 vias: 2=vitória, 1=empate, 0=derrota
            y = features_df["label"].map(_LABEL_MAP_3WAY).values.astype(np.int32)
            self._classes = [0, 1, 2]
        else:
            # Mercados binários: label já é 0/1 (derrota/vitória)
            y = (features_df["label"] > 0.5).astype(np.int32).values
            self._classes = [0, 1]

        # --- 3. Split temporal treino/validação ------------------------------
        # Ordena pelo kickoff_at já está feito no compute_batch_features.
        # Usa o último bloco cronológico como validação.
        n_val = max(4, int(n_total * _VALIDATION_FRACTION))
        n_train = n_total - n_val

        X_train, X_val = X[:n_train], X[n_train:]
        y_train, y_val = y[:n_train], y[n_train:]

        # --- 4. Instanciar e ajustar o estimador ----------------------------
        self._estimator = self._build_estimator()

        fit_params: dict[str, Any] = {}

        if self.backend == "xgboost":
            fit_params["eval_set"] = [(X_val, y_val)]
            fit_params["verbose"] = False
        else:
            # LightGBM
            fit_params["eval_set"] = [(X_val, y_val)]
            # LightGBM callbacks para early stopping
            from lightgbm import early_stopping, log_evaluation
            fit_params["callbacks"] = [
                early_stopping(_EARLY_STOPPING_ROUNDS, verbose=False),
                log_evaluation(period=-1),  # silencia logs
            ]

        self._estimator.fit(X_train, y_train, **fit_params)

        # --- 5. Registrar metadados ------------------------------------------
        self._trained_at = datetime.utcnow()

        # best_iteration: XGBoost e LightGBM armazenam de formas diferentes.
        if hasattr(self._estimator, "best_iteration"):
            self._best_iteration = int(self._estimator.best_iteration)
        elif hasattr(self._estimator, "best_iteration_"):
            self._best_iteration = int(self._estimator.best_iteration_)
        else:
            self._best_iteration = self.n_estimators

        # --- 6. Métricas de validação ----------------------------------------
        val_probs = self._estimator.predict_proba(X_val)
        val_log_loss = self._compute_log_loss(y_val, val_probs)

        return {
            "n_train": int(n_train),
            "n_val": int(n_val),
            "n_total": int(n_total),
            "n_features": len(self.feature_names),
            "best_iteration": self._best_iteration,
            "val_log_loss": val_log_loss,
            "backend": self.backend,
            "market": self.market,
        }

    @staticmethod
    def _compute_log_loss(y_true: np.ndarray, y_probs: np.ndarray) -> float:
        """Log loss manual — evita dependência de sklearn só para isso."""
        eps = 1e-15
        n_samples = len(y_true)
        if y_probs.ndim == 1:
            # Binário: y_probs é P(classe 1)
            probs = np.clip(y_probs, eps, 1 - eps)
            return float(-np.mean(
                y_true * np.log(probs) + (1 - y_true) * np.log(1 - probs)
            ))
        # Multiclasse: y_probs é (n_samples, n_classes)
        probs = np.clip(y_probs, eps, 1 - eps)
        total = 0.0
        for i in range(n_samples):
            total -= np.log(probs[i, y_true[i]])
        return total / n_samples

    # ------------------------------------------------------------------
    # predict
    # ------------------------------------------------------------------

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Calcula probabilidades via `predict_proba` do estimador ajustado.

        Espera `event_data` com:
            - home_team_id, away_team_id, kickoff_at
            - match_history_home, match_history_away: listas de partidas
              anteriores a as_of, ordenadas do mais recente ao mais antigo.
            - elo_ratings (opcional): dict team_id -> rating.
            - market_odds (opcional): dict team_id -> odds.

        Retorna PredictionResult para cada desfecho do mercado.
        """
        # --- 1. Validação anti-leakage ---------------------------------------
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError(
                "event_data contém informação posterior a as_of (vazamento de dados)."
            )
        if self._estimator is None:
            raise RuntimeError("Modelo não treinado — chame train() antes de predict().")

        home_id = event_data["home_team_id"]
        away_id = event_data["away_team_id"]

        # --- 2. Computar features para cada lado ----------------------------
        results: list[PredictionResult] = []

        # Para match_result, predizemos do ponto de vista do mandante
        # (vitória = home win, empate, derrota = away win).
        home_context: dict[str, Any] = {
            "team_id": home_id,
            "opponent_id": away_id,
            "match_history": event_data.get("match_history_home", []),
            "elo_ratings": event_data.get("elo_ratings", {}),
            "market_odds": event_data.get("market_odds", {}),
            "is_home": True,
        }

        features = compute_event_features(
            home_context, as_of=as_of, feature_names=self.feature_names
        )

        # --- 3. Montar vetor X e predizer ------------------------------------
        x = np.array(
            [features.get(f) for f in self.feature_names],
            dtype=np.float64,
        ).reshape(1, -1)

        probs = self._estimator.predict_proba(x)[0]

        # --- 4. Mapear probabilidades para PredictionResult ------------------
        if self.market == "match_result":
            # classes: 0=derrota(away win), 1=empate, 2=vitória(home win)
            p_away = float(probs[0]) if len(probs) > 0 else 0.0
            p_draw = float(probs[1]) if len(probs) > 1 else 0.0
            p_home = float(probs[2]) if len(probs) > 2 else 0.0

            # Renormaliza por segurança numérica.
            total = p_home + p_draw + p_away
            if total > 0:
                p_home /= total
                p_draw /= total
                p_away /= total

            results.append(PredictionResult(
                market="match_result",
                outcome="home",
                probability=p_home,
                features_used=dict(features),
            ))
            results.append(PredictionResult(
                market="match_result",
                outcome="draw",
                probability=p_draw,
            ))
            results.append(PredictionResult(
                market="match_result",
                outcome="away",
                probability=p_away,
            ))

            # Double chance (derivado do 1X2).
            results.append(PredictionResult(
                market="double_chance",
                outcome="1X",
                probability=p_home + p_draw,
            ))
            results.append(PredictionResult(
                market="double_chance",
                outcome="12",
                probability=p_home + p_away,
            ))
            results.append(PredictionResult(
                market="double_chance",
                outcome="X2",
                probability=p_draw + p_away,
            ))
        else:
            # Mercado binário: probs[0] = P(não), probs[1] = P(sim)
            p_no = float(probs[0])
            p_yes = float(probs[1]) if len(probs) > 1 else 1.0 - p_no

            results.append(PredictionResult(
                market=self.market,
                outcome="yes",
                probability=p_yes,
                features_used=dict(features),
            ))
            results.append(PredictionResult(
                market=self.market,
                outcome="no",
                probability=p_no,
            ))

        return results

    # ------------------------------------------------------------------
    # feature_importances
    # ------------------------------------------------------------------

    def feature_importances(self) -> dict[str, float]:
        """Retorna a importância de cada feature (gain) — útil para auditoria/explicabilidade.

        A importância é normalizada para somar 1.0 (distribuição percentual).
        """
        if self._estimator is None:
            raise RuntimeError("Modelo não treinado — chame train() antes de consultar importâncias.")

        importances = self._estimator.feature_importances_
        total = sum(importances)
        if total > 0:
            importances = importances / total

        return {
            name: float(imp)
            for name, imp in zip(self.feature_names, importances)
        }

    # ------------------------------------------------------------------
    # get_params
    # ------------------------------------------------------------------

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
