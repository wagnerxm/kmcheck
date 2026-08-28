"""Testes de vazamento de dados (data leakage) — a regra mais crítica do projeto.

Cobrem tanto a checagem genérica em `BaseModel.validate_no_leakage` quanto o
contrato de que `train(..., cutoff_date=...)` nunca deve considerar registros
posteriores ao corte, usando um modelo de teste (`_DummyModel`) que faz
cumprir essa regra explicitamente para podermos testá-la.
"""
from datetime import datetime, timedelta

import pandas as pd
import pytest

from app.features.batch import validate_batch_no_leakage
from app.models.base import BaseModel, PredictionResult
from app.validation.walk_forward import generate_walk_forward_folds


class _DummyModel(BaseModel):
    """Modelo mínimo só para exercitar o contrato de `BaseModel` nos testes."""

    name = "dummy"
    version = "0.0.1"

    def __init__(self) -> None:
        self.n_samples_seen: int = 0

    def train(self, training_data: list[dict], cutoff_date: datetime, strict: bool = False) -> dict:
        # Comportamento padrão (strict=False): filtra silenciosamente os
        # registros futuros, como faria um modelo real recebendo um dataset
        # não pré-filtrado pelo pipeline upstream — nunca usa o que é
        # posterior a cutoff_date, mas também não trata isso como erro fatal.
        # Comportamento estrito (strict=True): recusa o treino por completo
        # ao detectar QUALQUER registro futuro — útil como checagem de
        # sanidade quando se espera que o chamador já tenha filtrado.
        if strict:
            for record in training_data:
                if record["played_at"] > cutoff_date:
                    raise ValueError(
                        f"Registro com played_at={record['played_at']} viola cutoff_date={cutoff_date}."
                    )
        usable = [r for r in training_data if r["played_at"] <= cutoff_date]
        self.n_samples_seen = len(usable)
        return {"n_samples": len(usable)}

    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        if not self.validate_no_leakage(event_data, as_of):
            raise ValueError("event_data contém informação posterior a as_of.")
        return [PredictionResult(market="match_result", outcome="home", probability=0.5)]

    def get_params(self) -> dict:
        return {"n_samples_seen": self.n_samples_seen}


class TestBaseModelValidateNoLeakage:
    def test_allows_data_strictly_before_as_of(self):
        model = _DummyModel()
        as_of = datetime(2026, 1, 10)
        event_data = {"home_team": "A", "away_team": "B", "last_update_at": datetime(2026, 1, 9)}
        assert model.validate_no_leakage(event_data, as_of) is True

    def test_allows_data_exactly_at_as_of(self):
        # A regra é "até as_of, inclusive" — não deve ser rígida demais a ponto
        # de rejeitar dados do próprio instante de referência.
        model = _DummyModel()
        as_of = datetime(2026, 1, 10, 12, 0, 0)
        event_data = {"snapshot_date": as_of}
        assert model.validate_no_leakage(event_data, as_of) is True

    def test_rejects_data_after_as_of(self):
        model = _DummyModel()
        as_of = datetime(2026, 1, 10)
        event_data = {"home_team": "A", "result_confirmed_at": datetime(2026, 1, 11)}
        assert model.validate_no_leakage(event_data, as_of) is False

    def test_ignores_non_temporal_fields(self):
        model = _DummyModel()
        as_of = datetime(2026, 1, 10)
        event_data = {"home_team": "A", "away_team": "B", "odds": 2.5}
        assert model.validate_no_leakage(event_data, as_of) is True

    def test_predict_raises_on_leaking_event_data(self):
        model = _DummyModel()
        as_of = datetime(2026, 1, 10)
        event_data = {"kickoff_at": datetime(2025, 1, 1), "result_confirmed_at": datetime(2026, 1, 11)}
        with pytest.raises(ValueError, match="posterior a as_of"):
            model.predict(event_data, as_of)

    def test_predict_succeeds_on_clean_event_data(self):
        model = _DummyModel()
        as_of = datetime(2026, 1, 10)
        event_data = {"kickoff_at": datetime(2026, 1, 10)}
        results = model.predict(event_data, as_of)
        assert len(results) == 1


class TestTrainingRespectsCutoffDate:
    def _make_training_data(self, base_date: datetime, n: int) -> list[dict]:
        return [{"played_at": base_date + timedelta(days=i), "home_goals": 1, "away_goals": 0} for i in range(n)]

    def test_train_uses_only_data_up_to_cutoff(self):
        model = _DummyModel()
        base_date = datetime(2026, 1, 1)
        training_data = self._make_training_data(base_date, n=10)  # dias 1..10 de janeiro
        cutoff = base_date + timedelta(days=4)  # inclui apenas os primeiros 5 registros

        report = model.train(training_data, cutoff_date=cutoff)

        assert report["n_samples"] == 5
        assert model.n_samples_seen == 5

    def test_train_never_lets_future_data_influence_n_samples_seen(self):
        # Mesmo sem o modo estrito, o registro futuro nunca deve ser contado
        # como usado — a filtragem silenciosa ainda respeita o cutoff à risca.
        model = _DummyModel()
        base_date = datetime(2026, 1, 1)
        training_data = [
            {"played_at": base_date, "home_goals": 1, "away_goals": 0},
            {"played_at": base_date + timedelta(days=100), "home_goals": 2, "away_goals": 1},
        ]
        cutoff = base_date  # o segundo registro é 100 dias no futuro em relação ao corte

        report = model.train(training_data, cutoff_date=cutoff)
        assert report["n_samples"] == 1
        assert model.n_samples_seen == 1

    def test_train_strict_mode_raises_when_caller_passes_future_data_directly(self):
        # No modo estrito, o modelo recusa o treino por completo em vez de
        # silenciosamente ignorar o registro futuro — útil como checagem de
        # sanidade quando se espera que o pipeline upstream já tenha filtrado
        # e qualquer dado futuro presente indica um bug ali, não aqui.
        model = _DummyModel()
        base_date = datetime(2026, 1, 1)
        training_data = [
            {"played_at": base_date, "home_goals": 1, "away_goals": 0},
            {"played_at": base_date + timedelta(days=100), "home_goals": 2, "away_goals": 1},
        ]
        cutoff = base_date  # o segundo registro é 100 dias no futuro em relação ao corte

        with pytest.raises(ValueError, match="viola cutoff_date"):
            model.train(training_data, cutoff_date=cutoff, strict=True)

    def test_train_with_no_future_data_does_not_raise(self):
        model = _DummyModel()
        base_date = datetime(2026, 1, 1)
        training_data = self._make_training_data(base_date, n=5)
        cutoff = base_date + timedelta(days=10)  # corte generoso, nenhum registro é futuro

        report = model.train(training_data, cutoff_date=cutoff)
        assert report["n_samples"] == 5


class TestWalkForwardFoldsNeverLeak:
    def test_eval_window_never_starts_before_train_ends(self):
        data_start = datetime(2024, 1, 1)
        data_end = datetime(2024, 12, 31)
        folds = list(
            generate_walk_forward_folds(
                data_start=data_start,
                data_end=data_end,
                initial_train_days=90,
                step_days=30,
                eval_horizon_days=30,
            )
        )
        assert len(folds) > 0
        for fold in folds:
            assert fold.eval_start == fold.train_end
            assert fold.eval_start <= fold.eval_end
            assert fold.train_start <= fold.train_end

    def test_train_window_never_shrinks_between_folds(self):
        data_start = datetime(2024, 1, 1)
        data_end = datetime(2024, 12, 31)
        folds = list(
            generate_walk_forward_folds(
                data_start=data_start,
                data_end=data_end,
                initial_train_days=60,
                step_days=15,
                eval_horizon_days=15,
            )
        )
        for previous, current in zip(folds, folds[1:], strict=False):
            # Janela expansiva: o treino nunca "esquece" dados, só cresce.
            assert current.train_start == previous.train_start
            assert current.train_end > previous.train_end

    def test_no_fold_evaluates_beyond_available_data(self):
        data_start = datetime(2024, 1, 1)
        data_end = datetime(2024, 6, 30)
        folds = list(
            generate_walk_forward_folds(
                data_start=data_start,
                data_end=data_end,
                initial_train_days=45,
                step_days=20,
                eval_horizon_days=20,
            )
        )
        for fold in folds:
            assert fold.eval_end <= data_end


class TestBatchFeatureNoLeakage:
    def test_validate_batch_no_leakage_passes_when_all_before_cutoff(self):
        cutoff = datetime(2026, 1, 15)
        df = pd.DataFrame(
            {
                "event_id": [1, 2, 3],
                "kickoff_at": [datetime(2026, 1, 10), datetime(2026, 1, 12), datetime(2026, 1, 15)],
            }
        )
        assert validate_batch_no_leakage(df, cutoff) is True

    def test_validate_batch_no_leakage_fails_when_any_after_cutoff(self):
        cutoff = datetime(2026, 1, 15)
        df = pd.DataFrame(
            {
                "event_id": [1, 2, 3],
                "kickoff_at": [datetime(2026, 1, 10), datetime(2026, 1, 12), datetime(2026, 1, 20)],
            }
        )
        assert validate_batch_no_leakage(df, cutoff) is False

    def test_validate_batch_no_leakage_passes_without_timestamp_column(self):
        # Sem coluna de timestamp não há como checar — assume-se conforme
        # (a responsabilidade de filtrar cai sobre quem monta o DataFrame).
        cutoff = datetime(2026, 1, 15)
        df = pd.DataFrame({"event_id": [1, 2, 3]})
        assert validate_batch_no_leakage(df, cutoff) is True
