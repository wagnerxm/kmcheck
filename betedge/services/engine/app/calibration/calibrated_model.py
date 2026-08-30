"""CalibratedModel — wrapper que aplica calibração pós-hoc a qualquer BaseModel.

Uso típico:

    from app.models.poisson import PoissonModel
    from app.calibration.calibrated_model import CalibratedModel
    from app.calibration.calibrators import PlattScaling

    base = PoissonModel()
    base.train(data, cutoff_date=cutoff)

    calibrated = CalibratedModel(base, calibrator_type="platt")
    calibrated.fit_calibration(
        validation_events=events_after_cutoff,
        outcomes=outcomes_after_cutoff,
        as_of_dates=dates_after_cutoff,
    )

    results = calibrated.predict(event, as_of=game_date)
    # → probabilidades calibradas

O ajuste do calibrador é feito sobre predições do modelo-base em dados
de **validação temporal** (posteriores ao cutoff de treino), garantindo
que o calibrador aprende a corrigir o viés do modelo sem vazamento de dados.
"""
from datetime import datetime
from typing import Any

import numpy as np

from app.calibration.calibrators import (
    BaseCalibrator,
    IsotonicCalibrator,
    MulticlassCalibrator,
    PlattScaling,
    TemperatureScaling,
)
from app.models.base import BaseModel, PredictionResult


# Mapeamento de nomes amigáveis → classes de calibrador.
_CALIBRATOR_MAP: dict[str, type[BaseCalibrator]] = {
    "platt": PlattScaling,
    "isotonic": IsotonicCalibrator,
    "temperature": TemperatureScaling,
}


class CalibratedModel(BaseModel):
    """Wrapper que aplica calibração pós-hoc sobre um modelo-base.

    Delega `train()` ao modelo-base e intercepta `predict()` para aplicar
    a transformação calibrada sobre cada probabilidade de saída.
    """

    name = "calibrated"
    version = "1.0.0"

    def __init__(
        self,
        base_model: BaseModel,
        calibrator_type: str = "platt",
    ) -> None:
        self.base_model = base_model
        self.calibrator_type = calibrator_type

        if calibrator_type not in _CALIBRATOR_MAP:
            raise ValueError(
                f"Calibrador '{calibrator_type}' não reconhecido. "
                f"Opções: {list(_CALIBRATOR_MAP.keys())}"
            )

        # Calibradores binários: um por (market, outcome).
        self._calibrators: dict[tuple[str, str], BaseCalibrator] = {}
        # Calibrador multiclasse para mercados 3-vias.
        self._multiclass_calibrator: MulticlassCalibrator | None = None
        self._calibration_fitted: bool = False
        self._calibrated_at: datetime | None = None

    @property
    def _calibrator_factory(self) -> type[BaseCalibrator]:
        return _CALIBRATOR_MAP[self.calibrator_type]

    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Delega o treino ao modelo-base (calibração é pós-hoc)."""
        return self.base_model.train(training_data, cutoff_date)

    def fit_calibration(
        self,
        validation_events: list[dict],
        outcomes: list[dict[str, int]],
        as_of_dates: list[datetime],
    ) -> dict[str, Any]:
        """Ajusta os calibradores sobre predições do modelo-base em dados de validação.

        Processo:
            1. Para cada evento de validação, chama `base_model.predict()` para
               obter probabilidades brutas.
            2. Agrupa por (market, outcome) e acumula (prob, outcome_observado).
            3. Ajusta um calibrador para cada par (market, outcome).
            4. Para mercados multiclasse (match_result com 3 desfechos), ajusta
               também um MulticlassCalibrator que garante soma = 1.

        Args:
            validation_events: lista de dicts de evento (mesmo formato de predict()).
            outcomes: lista de dicts {outcome_name: 0_ou_1} — resultado observado
                para cada evento. Ex.: [{"home": 1, "draw": 0, "away": 0}, ...].
            as_of_dates: data de referência de cada evento (para predict).

        Returns:
            Dict com métricas de calibração antes/depois (ECE, se disponível).
        """
        if len(validation_events) != len(outcomes) or len(outcomes) != len(as_of_dates):
            raise ValueError("validation_events, outcomes e as_of_dates devem ter o mesmo tamanho.")

        if len(validation_events) < 5:
            raise ValueError("Pelo menos 5 eventos de validação são necessários para calibração.")

        # --- 1. Coletar predições brutas e outcomes ---
        # Estrutura: {(market, outcome): [(prob_bruta, outcome_obs), ...]}
        collected: dict[tuple[str, str], list[tuple[float, float]]] = {}
        # Para multiclasse: {market: [(probs_vec, label_int), ...]}
        multi_collected: dict[str, list[tuple[list[float], int]]] = {}

        for event, outcome_dict, as_of in zip(validation_events, outcomes, as_of_dates):
            try:
                preds = self.base_model.predict(event, as_of)
            except Exception:
                continue  # evento sem predição válida — pula

            # Agrupa por market para detectar multiclasse.
            by_market: dict[str, list[PredictionResult]] = {}
            for p in preds:
                by_market.setdefault(p.market, []).append(p)

            for market, market_preds in by_market.items():
                outcome_names = [p.outcome for p in market_preds]

                if len(market_preds) >= 3 and market == "match_result":
                    # Multiclasse: monta vetor de probs e label.
                    prob_vec = [p.probability for p in market_preds]
                    label = -1
                    for i, p in enumerate(market_preds):
                        obs = outcome_dict.get(p.outcome, 0)
                        if obs == 1:
                            label = i
                    if label >= 0:
                        multi_collected.setdefault(market, []).append((prob_vec, label))

                # Binário por outcome: sempre coleta (para fallback e mercados binários).
                for p in market_preds:
                    obs = float(outcome_dict.get(p.outcome, 0))
                    key = (p.market, p.outcome)
                    collected.setdefault(key, []).append((p.probability, obs))

        # --- 2. Ajustar calibradores multiclasse (3-vias) ---
        for market, samples in multi_collected.items():
            if len(samples) < 10:
                continue
            probs_matrix = np.array([s[0] for s in samples])
            labels = np.array([s[1] for s in samples])
            mc = MulticlassCalibrator(self._calibrator_factory)
            mc.fit(probs_matrix, labels)
            self._multiclass_calibrator = mc

        # --- 3. Ajustar calibradores binários (fallback + mercados binários) ---
        for key, pairs in collected.items():
            if len(pairs) < 5:
                continue
            preds_arr = np.array([p for p, _ in pairs])
            outs_arr = np.array([o for _, o in pairs])

            # Pula se todas as outcomes são iguais (calibrador não converge).
            if outs_arr.min() == outs_arr.max():
                continue

            cal = self._calibrator_factory()
            try:
                cal.fit(preds_arr, outs_arr)
                self._calibrators[key] = cal
            except Exception:
                pass  # calibrador não convergiu para este outcome

        self._calibration_fitted = True
        self._calibrated_at = datetime.utcnow()

        return {
            "calibrator_type": self.calibrator_type,
            "n_validation_events": len(validation_events),
            "n_binary_calibrators": len(self._calibrators),
            "has_multiclass": self._multiclass_calibrator is not None,
            "calibrated_at": self._calibrated_at.isoformat(),
        }

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Predição calibrada: obtém probs brutas do modelo-base e aplica calibração."""
        raw_results = self.base_model.predict(event_data, as_of)

        if not self._calibration_fitted:
            return raw_results  # sem calibração → retorna bruto

        # Agrupa por market para aplicar calibração multiclasse quando disponível.
        by_market: dict[str, list[PredictionResult]] = {}
        for r in raw_results:
            by_market.setdefault(r.market, []).append(r)

        calibrated_results: list[PredictionResult] = []

        for market, market_results in by_market.items():
            if (
                market == "match_result"
                and self._multiclass_calibrator is not None
                and len(market_results) >= 3
            ):
                # Calibração multiclasse: mantém soma = 1.
                prob_vec = np.array([[r.probability for r in market_results]])
                calibrated_probs = self._multiclass_calibrator.transform(prob_vec)[0]

                for i, r in enumerate(market_results):
                    calibrated_results.append(PredictionResult(
                        market=r.market,
                        outcome=r.outcome,
                        probability=float(calibrated_probs[i]),
                        confidence=r.confidence,
                        features_used=r.features_used,
                    ))
            else:
                # Calibração binária por (market, outcome).
                for r in market_results:
                    key = (r.market, r.outcome)
                    if key in self._calibrators:
                        cal_prob = self._calibrators[key].transform(np.array([r.probability]))
                        calibrated_results.append(PredictionResult(
                            market=r.market,
                            outcome=r.outcome,
                            probability=float(cal_prob[0]),
                            confidence=r.confidence,
                            features_used=r.features_used,
                        ))
                    else:
                        calibrated_results.append(r)

        # Renormaliza mercados para somar 1 (segurança).
        renorm_by_market: dict[str, list[PredictionResult]] = {}
        for r in calibrated_results:
            renorm_by_market.setdefault(r.market, []).append(r)
        for market_results in renorm_by_market.values():
            total = sum(r.probability for r in market_results)
            if total > 0:
                for r in market_results:
                    r.probability /= total

        return calibrated_results

    def get_params(self) -> dict:
        base_params = self.base_model.get_params()
        cal_params = {}
        if self._multiclass_calibrator is not None:
            cal_params["multiclass"] = self._multiclass_calibrator.get_params()
        for key, cal in self._calibrators.items():
            cal_params[f"{key[0]}:{key[1]}"] = cal.get_params()

        return {
            "base_model": base_params,
            "calibrator_type": self.calibrator_type,
            "calibration_fitted": self._calibration_fitted,
            "calibrated_at": self._calibrated_at.isoformat() if self._calibrated_at else None,
            "calibration_params": cal_params,
        }
