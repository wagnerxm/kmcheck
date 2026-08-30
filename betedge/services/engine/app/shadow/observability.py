"""Contadores de observabilidade do Shadow Mode.

Registra métricas operacionais em memória (sem dependência de Prometheus/StatsD)
para exposição via endpoint /health/shadow e logs estruturados.

Contadores são thread-safe e podem ser consultados a qualquer momento.
Não persistem entre restarts — são métricas de runtime, não de negócio.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class JobMetrics:
    """Métricas de execução de um job."""

    total_runs: int = 0
    total_successes: int = 0
    total_failures: int = 0
    total_skipped: int = 0
    total_timeouts: int = 0
    last_run_at: str | None = None
    last_duration_seconds: float | None = None
    last_status: str | None = None
    last_error: str | None = None


class ShadowObservability:
    """Singleton de contadores de observabilidade do Shadow Mode.

    Uso:
        from app.shadow.observability import shadow_metrics
        shadow_metrics.increment("predictions_generated")
        shadow_metrics.record_job_execution("pipeline", "success", 12.3)
        snapshot = shadow_metrics.get_snapshot()
    """

    _instance: ShadowObservability | None = None
    _lock = threading.Lock()

    def __new__(cls) -> ShadowObservability:
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        self._counters: dict[str, int] = {
            "predictions_generated": 0,
            "selections_made": 0,
            "predictions_graded": 0,
            "closing_odds_captured": 0,
            "fail_safe_skipped": 0,
            "leakage_violations": 0,
            "pipeline_runs_total": 0,
            "pipeline_runs_failed": 0,
            "dry_run_executions": 0,
        }
        self._job_metrics: dict[str, JobMetrics] = {}
        self._started_at = datetime.now(timezone.utc).isoformat()
        self._counter_lock = threading.Lock()

    def increment(self, counter: str, amount: int = 1) -> None:
        """Incrementa um contador. Cria automaticamente se não existir."""
        with self._counter_lock:
            if counter in self._counters:
                self._counters[counter] += amount
            else:
                self._counters[counter] = amount

    def record_job_execution(
        self,
        job_id: str,
        status: str,
        duration_seconds: float,
        error: str | None = None,
    ) -> None:
        """Registra execução de um job do scheduler.

        Atualiza contadores totais e guarda snapshot da última execução
        para cada job_id (ex.: "pipeline", "grading", "closing_odds").
        """
        with self._counter_lock:
            if job_id not in self._job_metrics:
                self._job_metrics[job_id] = JobMetrics()

            metrics = self._job_metrics[job_id]
            metrics.total_runs += 1
            metrics.last_run_at = datetime.now(timezone.utc).isoformat()
            metrics.last_duration_seconds = round(duration_seconds, 2)
            metrics.last_status = status
            metrics.last_error = error

            if status == "success":
                metrics.total_successes += 1
            elif status == "failed":
                metrics.total_failures += 1
            elif status == "skipped":
                metrics.total_skipped += 1
            elif status == "timeout":
                metrics.total_timeouts += 1

    def get_snapshot(self) -> dict[str, Any]:
        """Retorna snapshot completo das métricas para exibição.

        Formato estável — consumido por /health/shadow e logs.
        """
        with self._counter_lock:
            return {
                "started_at": self._started_at,
                "counters": dict(self._counters),
                "jobs": {
                    job_id: {
                        "total_runs": m.total_runs,
                        "total_successes": m.total_successes,
                        "total_failures": m.total_failures,
                        "total_skipped": m.total_skipped,
                        "total_timeouts": m.total_timeouts,
                        "last_run_at": m.last_run_at,
                        "last_duration_seconds": m.last_duration_seconds,
                        "last_status": m.last_status,
                        "last_error": m.last_error,
                    }
                    for job_id, m in self._job_metrics.items()
                },
            }

    def reset(self) -> None:
        """Reset para testes — zera contadores e limpa métricas de jobs."""
        with self._counter_lock:
            for k in self._counters:
                self._counters[k] = 0
            self._job_metrics.clear()


# Singleton global — importar e usar diretamente
shadow_metrics = ShadowObservability()
