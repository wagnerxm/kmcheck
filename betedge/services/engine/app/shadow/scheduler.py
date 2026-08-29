"""Scheduler do Shadow Mode — 6 jobs independentes e idempotentes.

Cada job é auto-suficiente: pode falhar sem impactar os demais, possui
lock distribuído (via Redis) para evitar execução concorrente em
múltiplas instâncias, e registra métricas de execução.

Jobs:
    1. shadow_daily_cycle    — Execução diária do pipeline shadow (09:00 UTC)
    2. shadow_closing_odds   — Captura closing odds a cada 15 min
    3. shadow_grading        — Grading de previsões a cada 30 min
    4. shadow_metrics        — Recálculo de métricas agregadas a cada 1h
    5. shadow_leakage_check  — Verificação de data leakage a cada 6h
    6. shadow_daily_report   — Geração do relatório diário (23:30 UTC)
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Versão do scheduler — persistida nos logs para auditoria
SCHEDULER_VERSION = "shadow-scheduler-v1.0.0"


class ShadowSchedulerConfig:
    """Configuração dos 6 jobs do shadow scheduler."""

    JOBS = [
        {
            "id": "shadow_daily_cycle",
            "name": "Ciclo diário shadow",
            "cron": {"hour": 9, "minute": 0},  # 09:00 UTC
            "timeout_seconds": 600,  # 10 min
            "max_retries": 2,
            "retry_delay_seconds": 60,
        },
        {
            "id": "shadow_closing_odds",
            "name": "Captura closing odds",
            "interval_minutes": 15,
            "timeout_seconds": 120,  # 2 min
            "max_retries": 1,
            "retry_delay_seconds": 30,
        },
        {
            "id": "shadow_grading",
            "name": "Grading de previsões",
            "interval_minutes": 30,
            "timeout_seconds": 180,  # 3 min
            "max_retries": 1,
            "retry_delay_seconds": 30,
        },
        {
            "id": "shadow_metrics",
            "name": "Recálculo de métricas",
            "interval_minutes": 60,
            "timeout_seconds": 300,  # 5 min
            "max_retries": 1,
            "retry_delay_seconds": 60,
        },
        {
            "id": "shadow_leakage_check",
            "name": "Verificação de data leakage",
            "interval_minutes": 360,  # 6h
            "timeout_seconds": 120,
            "max_retries": 0,
            "retry_delay_seconds": 0,
        },
        {
            "id": "shadow_daily_report",
            "name": "Relatório diário",
            "cron": {"hour": 23, "minute": 30},  # 23:30 UTC
            "timeout_seconds": 180,
            "max_retries": 1,
            "retry_delay_seconds": 60,
        },
    ]


async def _acquire_lock(redis_client: Any, job_id: str, timeout: int = 300) -> bool:
    """Tenta adquirir lock distribuído via Redis SET NX.

    Evita que o mesmo job rode simultaneamente em múltiplas instâncias.
    TTL do lock = timeout do job (se travar, o lock expira e permite retry).
    """
    lock_key = f"shadow:lock:{job_id}"
    acquired = await redis_client.set(lock_key, "1", nx=True, ex=timeout)
    return bool(acquired)


async def _release_lock(redis_client: Any, job_id: str) -> None:
    """Libera o lock distribuído."""
    lock_key = f"shadow:lock:{job_id}"
    await redis_client.delete(lock_key)


async def _execute_with_retry(
    func,
    *args,
    job_id: str,
    max_retries: int = 1,
    retry_delay: int = 30,
    timeout: int = 300,
    **kwargs,
) -> dict:
    """Executa uma função com retry e timeout, retornando métricas de execução."""
    attempt = 0
    last_error = None

    while attempt <= max_retries:
        start = time.monotonic()
        try:
            result = await asyncio.wait_for(
                func(*args, **kwargs),
                timeout=timeout,
            )
            elapsed = time.monotonic() - start
            logger.info(
                "Job %s concluído com sucesso (tentativa %d, %.1fs)",
                job_id, attempt + 1, elapsed,
            )
            return {
                "job_id": job_id,
                "status": "success",
                "attempt": attempt + 1,
                "duration_seconds": round(elapsed, 2),
                "result": result,
                "error": None,
            }
        except asyncio.TimeoutError:
            elapsed = time.monotonic() - start
            last_error = f"timeout após {timeout}s"
            logger.warning(
                "Job %s timeout (tentativa %d, %.1fs)",
                job_id, attempt + 1, elapsed,
            )
        except Exception as exc:
            elapsed = time.monotonic() - start
            last_error = str(exc)
            logger.exception(
                "Job %s falhou (tentativa %d, %.1fs): %s",
                job_id, attempt + 1, elapsed, exc,
            )

        attempt += 1
        if attempt <= max_retries and retry_delay > 0:
            logger.info("Job %s: aguardando %ds antes do retry...", job_id, retry_delay)
            await asyncio.sleep(retry_delay)

    return {
        "job_id": job_id,
        "status": "failed",
        "attempt": attempt,
        "duration_seconds": round(time.monotonic() - start, 2),
        "result": None,
        "error": last_error,
    }


async def run_shadow_job(
    job_id: str,
    db_session_factory,
    redis_client: Any,
    dry_run: bool = False,
) -> dict:
    """Executa um job shadow individual com lock distribuído.

    Args:
        job_id: ID do job (deve corresponder a um dos 6 jobs definidos).
        db_session_factory: Context manager que fornece AsyncSession.
        redis_client: Cliente Redis para locks distribuídos.
        dry_run: Se True, executa mas não persiste seleções.

    Returns:
        Dict com métricas de execução (status, duration, errors).
    """
    job_config = None
    for j in ShadowSchedulerConfig.JOBS:
        if j["id"] == job_id:
            job_config = j
            break

    if not job_config:
        return {"job_id": job_id, "status": "error", "error": f"job desconhecido: {job_id}"}

    timeout = job_config["timeout_seconds"]

    # Lock distribuído
    if not await _acquire_lock(redis_client, job_id, timeout=timeout):
        logger.info("Job %s já em execução (lock ativo) — skip", job_id)
        return {"job_id": job_id, "status": "skipped", "error": "lock ativo"}

    try:
        async with db_session_factory() as db:
            if job_id == "shadow_daily_cycle":
                from app.shadow.engine import run_shadow_cycle
                result = await _execute_with_retry(
                    run_shadow_cycle, db,
                    job_id=job_id,
                    max_retries=job_config["max_retries"],
                    retry_delay=job_config["retry_delay_seconds"],
                    timeout=timeout,
                    dry_run=dry_run,
                )

            elif job_id == "shadow_closing_odds":
                from app.shadow.engine import capture_closing_odds
                result = await _execute_with_retry(
                    capture_closing_odds, db,
                    job_id=job_id,
                    max_retries=job_config["max_retries"],
                    retry_delay=job_config["retry_delay_seconds"],
                    timeout=timeout,
                )

            elif job_id == "shadow_grading":
                from app.shadow.engine import grade_shadow_predictions
                result = await _execute_with_retry(
                    grade_shadow_predictions, db,
                    job_id=job_id,
                    max_retries=job_config["max_retries"],
                    retry_delay=job_config["retry_delay_seconds"],
                    timeout=timeout,
                )

            elif job_id == "shadow_metrics":
                from app.shadow.aggregations import aggregate_shadow_metrics
                result = await _execute_with_retry(
                    aggregate_shadow_metrics, db, group_by="league",
                    job_id=job_id,
                    max_retries=job_config["max_retries"],
                    retry_delay=job_config["retry_delay_seconds"],
                    timeout=timeout,
                )

            elif job_id == "shadow_leakage_check":
                from app.shadow.engine import validate_no_leakage
                result = await _execute_with_retry(
                    validate_no_leakage, db,
                    job_id=job_id,
                    max_retries=job_config["max_retries"],
                    retry_delay=job_config["retry_delay_seconds"],
                    timeout=timeout,
                )

            elif job_id == "shadow_daily_report":
                from app.shadow.report import generate_daily_report
                now = datetime.now(timezone.utc)
                result = await _execute_with_retry(
                    generate_daily_report, db, report_date=now,
                    job_id=job_id,
                    max_retries=job_config["max_retries"],
                    retry_delay=job_config["retry_delay_seconds"],
                    timeout=timeout,
                )

            else:
                result = {"job_id": job_id, "status": "error", "error": "não implementado"}

        return result

    finally:
        await _release_lock(redis_client, job_id)


def get_scheduler_status() -> dict:
    """Retorna a configuração dos 6 jobs para exibição no health check."""
    return {
        "version": SCHEDULER_VERSION,
        "jobs": [
            {
                "id": j["id"],
                "name": j["name"],
                "schedule": j.get("cron") or {"interval_minutes": j.get("interval_minutes")},
                "timeout_seconds": j["timeout_seconds"],
                "max_retries": j["max_retries"],
            }
            for j in ShadowSchedulerConfig.JOBS
        ],
    }
