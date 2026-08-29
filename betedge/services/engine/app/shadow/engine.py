"""Motor principal do Shadow Mode v1 — ciclo de previsão, seleção, grading e CLV.

Fluxo do ciclo shadow:
    1. Criar pipeline_run_id para rastreabilidade
    2. Buscar eventos futuros com odds
    3. Para cada evento: calcular fair probs, edges, EVs, edge scores
    4. Persistir snapshots de previsão (append-only)
    5. Aplicar seleção shadow (is_shadow_selection) com critérios formais
    6. Capturar closing odds antes do kickoff (com metadados)
    7. Grading automático após resultado
    8. Calcular CLV dual (preço e probabilidade)

Princípios invioláveis:
    - Nenhuma previsão é modificada após o kickoff (imutabilidade)
    - Grading é write-once: result/clv/theoretical_return preenchidos uma vez
    - ON CONFLICT DO NOTHING garante idempotência
    - Nenhum dinheiro real — Shadow Mode é puramente prospectivo
    - Preferir não prever a prever com dados ruins (fail-safe)
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shadow.schema import ensure_shadow_tables
from app.value.engine import (
    calculate_edge,
    calculate_ev,
    calculate_edge_score,
    calculate_edge_score_detailed,
    implied_probability,
)
from app.value.fair_probability import (
    compute_fair_probs_for_event,
    compute_market_overround,
)
from app.value.kelly import kelly_fraction as kelly_full_calc, fractional_kelly

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# Constantes e versões
# ═══════════════════════════════════════════════════════════════════════════

# Threshold mínimo de edge para persistir uma shadow prediction (2 p.p.)
MIN_EDGE_THRESHOLD = 0.02

# Critérios de seleção shadow v1
SELECTION_MIN_EDGE = 0.03
SELECTION_MIN_EV = 0.02
SELECTION_MIN_SCORE = 50.0
SELECTION_MIN_BOOKMAKERS = 2
SELECTION_VERSION = "shadow_selection_v1"

# Versões — persistidas para reprodutibilidade
FEATURES_VERSION = "1.0.0"
MODEL_VERSION = "shadow-v1.0.0"
ENSEMBLE_VERSION = "ensemble-v1.0.0"
SCORE_VERSION = "prediq-score-v1.0.0"
FAIR_PROBABILITY_VERSION = "fair-prob-v1.0.0"
FAIR_PROBABILITY_METHOD = "shin"
PIPELINE_VERSION = "shadow-pipeline-v1.0.0"
KELLY_VERSION = "kelly-v1.0.0"
GRADING_VERSION = "grading-v1.0.0"

# Kelly — quarter-Kelly padrão com cap configurável
KELLY_FRACTION = 0.25
KELLY_CAP = 0.05  # máximo 5% da banca

# Fail-safe thresholds
MAX_OVERROUND = 0.30  # 30% — acima disso, mercado suspeito
MIN_BOOKMAKERS_FOR_FAIR_PROB = 2
MAX_ODDS = 100.0  # odds acima disso são provavelmente erro
MIN_HOURS_BEFORE_KICKOFF = 0.25  # 15 min — não prever muito perto do kickoff
STALE_ODDS_HOURS = 48  # odds mais velhas que 48h são consideradas stale


# ═══════════════════════════════════════════════════════════════════════════
# Dataclass de resultado
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class ShadowCycleResult:
    """Resultado consolidado de um ciclo shadow."""
    pipeline_run_id: str = ""
    events_processed: int = 0
    predictions_created: int = 0
    selections_made: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    skipped_fail_safe: int = 0


# ═══════════════════════════════════════════════════════════════════════════
# Pipeline run tracking
# ═══════════════════════════════════════════════════════════════════════════

def _generate_pipeline_run_id() -> str:
    """Gera ID único para a execução do pipeline."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    short_uuid = uuid.uuid4().hex[:8]
    return f"shadow-run-{ts}-{short_uuid}"


def _generate_prediction_run_id(pipeline_run_id: str, event_id: str) -> str:
    """Gera ID do snapshot de previsão dentro de um pipeline run.

    Determinístico em (pipeline_run_id, event_id) — reprocessar o mesmo
    evento dentro do mesmo ciclo (ex.: retry após erro parcial) produz o
    MESMO prediction_run_id, permitindo que o ON CONFLICT DO NOTHING da
    UNIQUE (prediction_run_id, event_id, market, outcome) absorva a
    reinserção sem duplicar snapshots nem exigir um uuid aleatório novo
    a cada tentativa.
    """
    digest = hashlib.sha1(f"{pipeline_run_id}::{event_id}".encode("utf-8")).hexdigest()[:8]
    return f"{pipeline_run_id}::{event_id[:8]}::{digest}"


async def _create_pipeline_run(db: AsyncSession, run_id: str) -> None:
    """Registra início de uma execução do pipeline."""
    await db.execute(text("""
        INSERT INTO shadow_pipeline_runs (
            pipeline_run_id, pipeline_version, model_version,
            features_version, ensemble_version, score_version,
            fair_probability_version, selection_version,
            config_snapshot
        ) VALUES (
            :run_id, :pipeline_ver, :model_ver,
            :features_ver, :ensemble_ver, :score_ver,
            :fp_ver, :sel_ver,
            :config::jsonb
        )
    """), {
        "run_id": run_id,
        "pipeline_ver": PIPELINE_VERSION,
        "model_ver": MODEL_VERSION,
        "features_ver": FEATURES_VERSION,
        "ensemble_ver": ENSEMBLE_VERSION,
        "score_ver": SCORE_VERSION,
        "fp_ver": FAIR_PROBABILITY_VERSION,
        "sel_ver": SELECTION_VERSION,
        "config": json.dumps({
            "min_edge_threshold": MIN_EDGE_THRESHOLD,
            "selection_min_edge": SELECTION_MIN_EDGE,
            "selection_min_ev": SELECTION_MIN_EV,
            "selection_min_score": SELECTION_MIN_SCORE,
            "kelly_fraction": KELLY_FRACTION,
            "kelly_cap": KELLY_CAP,
            "fair_probability_method": FAIR_PROBABILITY_METHOD,
        }),
    })
    await db.commit()


async def _finish_pipeline_run(
    db: AsyncSession,
    run_id: str,
    result: ShadowCycleResult,
    status: str = "completed",
    *,
    duration_seconds: float | None = None,
    markets_processed: int = 0,
    odds_sources_count: int = 0,
) -> None:
    """Registra fim de uma execução do pipeline."""
    await db.execute(text("""
        UPDATE shadow_pipeline_runs
        SET finished_at = now(),
            status = :status,
            events_processed = :events,
            predictions_created = :preds,
            selections_made = :sels,
            errors = :errors::jsonb,
            warnings = :warnings::jsonb,
            duration_seconds = :duration,
            markets_processed = :mkts,
            odds_sources_count = :odds_src,
            skipped_fail_safe = :skipped
        WHERE pipeline_run_id = :run_id
    """), {
        "run_id": run_id,
        "status": status,
        "events": result.events_processed,
        "preds": result.predictions_created,
        "sels": result.selections_made,
        "errors": json.dumps(result.errors),
        "warnings": json.dumps(result.warnings),
        "duration": duration_seconds,
        "mkts": markets_processed,
        "odds_src": odds_sources_count,
        "skipped": result.skipped_fail_safe,
    })
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# Validação de data leakage
# ═══════════════════════════════════════════════════════════════════════════

async def validate_no_leakage(db: AsyncSession, pipeline_run_id: str | None = None) -> dict:
    """Verifica ausência de data leakage nas shadow predictions.

    Checks:
        1. Previsões geradas após o kickoff
        2. Closing odds capturadas após o kickoff
        3. Grading antes do fim do evento

    Returns:
        Dict com passed (bool), violations (list), checked_at.
    """
    violations: list[str] = []

    # 1. Previsões geradas após kickoff
    run_filter = ""
    params: dict[str, Any] = {}
    if pipeline_run_id:
        run_filter = "AND pipeline_run_id = :run_id"
        params["run_id"] = pipeline_run_id

    leak1 = await db.execute(text(f"""
        SELECT COUNT(*) FROM shadow_predictions
        WHERE generated_at > kickoff_at {run_filter}
    """), params)
    count1 = int(leak1.scalar() or 0)
    if count1 > 0:
        violations.append(f"CRÍTICO: {count1} previsões geradas APÓS o kickoff")

    # 2. Closing odds capturadas após kickoff
    leak2 = await db.execute(text(f"""
        SELECT COUNT(*) FROM shadow_predictions
        WHERE closing_odds_at IS NOT NULL
          AND closing_odds_at > kickoff_at {run_filter}
    """), params)
    count2 = int(leak2.scalar() or 0)
    if count2 > 0:
        violations.append(f"CRÍTICO: {count2} closing odds capturadas APÓS o kickoff")

    # 3. Grading antes do kickoff (impossível mas verifica integridade)
    leak3 = await db.execute(text(f"""
        SELECT COUNT(*) FROM shadow_predictions
        WHERE graded_at IS NOT NULL
          AND graded_at < kickoff_at {run_filter}
    """), params)
    count3 = int(leak3.scalar() or 0)
    if count3 > 0:
        violations.append(f"CRÍTICO: {count3} previsões gradeadas ANTES do kickoff")

    passed = len(violations) == 0
    result = {
        "passed": passed,
        "violations": violations,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }

    # Registrar no pipeline run se fornecido
    if pipeline_run_id:
        leakage_status = "passed" if passed else "failed"
        await db.execute(text("""
            UPDATE shadow_pipeline_runs
            SET leakage_check = :status
            WHERE pipeline_run_id = :run_id
        """), {"run_id": pipeline_run_id, "status": leakage_status})
        await db.commit()

    return result


# ═══════════════════════════════════════════════════════════════════════════
# Fail-safe validations
# ═══════════════════════════════════════════════════════════════════════════

def _validate_fair_probs(
    fair_probs: dict[str, float],
    market_code: str,
) -> tuple[bool, str | None]:
    """Valida fair probabilities antes de usar.

    Returns:
        (is_valid, reason) — reason é None se válido.
    """
    if not fair_probs:
        return False, f"fair_probs vazio para mercado {market_code}"

    total = sum(fair_probs.values())
    if abs(total - 1.0) > 0.02:
        return False, f"fair_probs soma {total:.4f} (esperado ~1.0) para {market_code}"

    for outcome, prob in fair_probs.items():
        if prob <= 0 or prob >= 1:
            return False, f"fair_prob {prob:.4f} fora de (0,1) para {market_code}/{outcome}"

    # Verificar outcomes esperados por mercado
    expected_outcomes = {
        "1x2": {"home", "draw", "away"},
        "ou": {"over", "under"},
        "btts": {"yes", "no"},
    }
    if market_code in expected_outcomes:
        missing = expected_outcomes[market_code] - set(fair_probs.keys())
        if missing:
            return False, f"outcomes faltando {missing} para {market_code}"

    return True, None


def _validate_odds(odds: float, context: str) -> tuple[bool, str | None]:
    """Valida que uma odd é razoável."""
    if odds <= 1.0:
        return False, f"odds {odds} <= 1.0 em {context}"
    if odds > MAX_ODDS:
        return False, f"odds {odds} > {MAX_ODDS} (possível erro) em {context}"
    return True, None


def _validate_event_timing(
    kickoff_at: datetime,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Valida que o evento ainda está longe o suficiente do kickoff."""
    current = now or datetime.now(timezone.utc)
    hours_until = (kickoff_at - current).total_seconds() / 3600

    if hours_until < MIN_HOURS_BEFORE_KICKOFF:
        return False, f"evento muito próximo do kickoff ({hours_until:.1f}h)"
    return True, None


# ═══════════════════════════════════════════════════════════════════════════
# Helpers de banco
# ═══════════════════════════════════════════════════════════════════════════

async def _fetch_scheduled_events_with_odds(
    db: AsyncSession,
    event_ids: list[str] | None = None,
) -> list[dict]:
    """Busca eventos futuros (scheduled) com odds e dados de liga."""
    params: dict[str, Any] = {}
    event_filter = ""
    if event_ids:
        event_filter = "AND e.id = ANY(:event_ids)"
        params["event_ids"] = event_ids

    result = await db.execute(text(f"""
        SELECT DISTINCT
            e.id::text AS event_id,
            e.home_team_id::text AS home_team_id,
            e.away_team_id::text AS away_team_id,
            e.kickoff_at,
            e.league_id::text AS league_id,
            e.sport_id::text AS sport_id,
            ht.name AS home_team_name,
            at_t.name AS away_team_name,
            l.name AS league_name,
            s.code AS sport_code
        FROM events e
        JOIN odds o ON o.event_id = e.id
        JOIN teams ht ON ht.id = e.home_team_id
        JOIN teams at_t ON at_t.id = e.away_team_id
        LEFT JOIN leagues l ON l.id = e.league_id
        LEFT JOIN sports s ON s.id = e.sport_id
        WHERE e.status = 'scheduled'
          AND e.kickoff_at > now()
          {event_filter}
        ORDER BY e.kickoff_at ASC
    """), params)
    return [dict(row) for row in result.mappings().all()]


async def _fetch_event_odds(
    db: AsyncSession, event_id: str,
) -> dict[str, dict[str, dict[str, float]]]:
    """Busca odds atuais: {market: {bookmaker: {outcome: odds}}}."""
    result = await db.execute(text("""
        SELECT
            m.code  AS market_code,
            b.name  AS bookmaker_name,
            oc.code AS outcome_code,
            o.decimal_odds
        FROM odds o
        JOIN markets m    ON m.id  = o.market_id
        JOIN bookmakers b ON b.id  = o.bookmaker_id
        JOIN outcomes oc  ON oc.id = o.outcome_id
        WHERE o.event_id = :event_id
          AND o.is_suspended = false
        ORDER BY m.code, b.name
    """), {"event_id": event_id})

    odds_tree: dict[str, dict[str, dict[str, float]]] = {}
    for row in result.mappings().all():
        market = row["market_code"]
        bookie = row["bookmaker_name"]
        outcome = row["outcome_code"]
        odds_tree.setdefault(market, {}).setdefault(bookie, {})[outcome] = float(row["decimal_odds"])

    return odds_tree


async def _fetch_model_probability(
    db: AsyncSession, event_id: str, market_code: str, outcome_code: str,
) -> tuple[float | None, dict | None]:
    """Busca probabilidade do ensemble em model_predictions (se existir).

    Retorna (probability, metadata) onde metadata contém individual_probs
    e ensemble_weights se disponíveis. Retorna (None, None) se não houver
    nenhuma previsão — o caller DEVE recusar a previsão (fail-safe).
    """
    # Primeiro: consensus_predictions (ensemble)
    result = await db.execute(text("""
        SELECT cp.probability
        FROM consensus_predictions cp
        JOIN markets m   ON m.id  = cp.market_id
        JOIN outcomes oc ON oc.id = cp.outcome_id
        WHERE cp.event_id = :event_id
          AND m.code  = :market
          AND oc.code = :outcome
        ORDER BY cp.generated_at DESC
        LIMIT 1
    """), {"event_id": event_id, "market": market_code, "outcome": outcome_code})
    row = result.scalar()
    if row is not None:
        return float(row), {"source": "consensus_predictions"}

    # Fallback: model_predictions mais recente
    result = await db.execute(text("""
        SELECT mp.probability
        FROM model_predictions mp
        JOIN markets m   ON m.id  = mp.market_id
        JOIN outcomes oc ON oc.id = mp.outcome_id
        WHERE mp.event_id = :event_id
          AND m.code  = :market
          AND oc.code = :outcome
        ORDER BY mp.generated_at DESC
        LIMIT 1
    """), {"event_id": event_id, "market": market_code, "outcome": outcome_code})
    row = result.scalar()
    if row is not None:
        return float(row), {"source": "model_predictions"}

    # FAIL-SAFE: sem modelo disponível → NÃO fabricar probabilidade
    # Retorna None — o caller deve recusar esta previsão
    return None, None


def _find_best_odds(
    bookmaker_odds: dict[str, dict[str, float]], outcome: str,
) -> tuple[float, str]:
    """Encontra a melhor odd (maior) para um outcome entre bookmakers."""
    best = 0.0
    best_bookie = ""
    for bookie, outcomes in bookmaker_odds.items():
        odds = outcomes.get(outcome, 0.0)
        if odds > best:
            best = odds
            best_bookie = bookie
    if best <= 1.0:
        raise ValueError(f"Nenhuma odd válida para outcome '{outcome}'")
    return best, best_bookie


# ═══════════════════════════════════════════════════════════════════════════
# Seleção shadow
# ═══════════════════════════════════════════════════════════════════════════

def _evaluate_shadow_selection(
    edge: float,
    ev: float,
    prediq_score: float,
    n_bookmakers: int,
    fair_prob_valid: bool,
    kickoff_at: datetime,
) -> tuple[bool, dict]:
    """Avalia se uma previsão deve ser selecionada como shadow bet.

    Critérios shadow_selection_v1:
        - Edge >= 3%
        - EV >= 2%
        - PREDIQ Score >= 50
        - Cobertura mínima de bookmakers >= 2
        - Fair probability válida
        - Closing ainda não ocorreu (kickoff futuro)

    Returns:
        (is_selected, reason_dict)
    """
    now = datetime.now(timezone.utc)
    reasons: dict[str, Any] = {
        "strategy": SELECTION_VERSION,
        "criteria": {},
    }

    criteria = {
        "edge_min": {"value": edge, "threshold": SELECTION_MIN_EDGE, "passed": edge >= SELECTION_MIN_EDGE},
        "ev_min": {"value": ev, "threshold": SELECTION_MIN_EV, "passed": ev >= SELECTION_MIN_EV},
        "score_min": {"value": prediq_score, "threshold": SELECTION_MIN_SCORE, "passed": prediq_score >= SELECTION_MIN_SCORE},
        "bookmaker_coverage": {"value": n_bookmakers, "threshold": SELECTION_MIN_BOOKMAKERS, "passed": n_bookmakers >= SELECTION_MIN_BOOKMAKERS},
        "fair_prob_valid": {"value": fair_prob_valid, "threshold": True, "passed": fair_prob_valid},
        "pre_kickoff": {"value": (kickoff_at - now).total_seconds() / 3600, "threshold": 0, "passed": kickoff_at > now},
    }

    reasons["criteria"] = criteria
    is_selected = all(c["passed"] for c in criteria.values())

    return is_selected, reasons


# ═══════════════════════════════════════════════════════════════════════════
# Ciclo principal
# ═══════════════════════════════════════════════════════════════════════════

async def run_shadow_cycle(
    db: AsyncSession,
    event_ids: list[str] | None = None,
) -> ShadowCycleResult:
    """Executa o ciclo shadow completo com rastreabilidade e fail-safes.

    Passos:
        1. Criar pipeline_run_id e registrar início
        2. Garantir tabelas
        3. Buscar eventos scheduled com odds
        4. Para cada evento/mercado/outcome:
           a. Validar fair probability (fail-safe)
           b. Obter model_probability (fail-safe: recusar se ausente)
           c. Validar odds (fail-safe)
           d. Calcular edge, EV, PREDIQ Score detalhado, Kelly variantes
           e. Persistir snapshot (ON CONFLICT DO NOTHING)
           f. Avaliar seleção shadow
        5. Validar ausência de data leakage
        6. Registrar fim do pipeline run

    Args:
        db: Sessão assíncrona do SQLAlchemy.
        event_ids: IDs específicos. Se None, processa todos os futuros.

    Returns:
        ShadowCycleResult com métricas da execução.
    """
    cycle_result = ShadowCycleResult()
    cycle_start = time.monotonic()

    # Contadores adicionais para métricas do run
    total_markets_processed = 0
    total_odds_sources = 0

    # 1. Pipeline run
    run_id = _generate_pipeline_run_id()
    cycle_result.pipeline_run_id = run_id

    await ensure_shadow_tables(db)
    await _create_pipeline_run(db, run_id)

    logger.info("Shadow cycle iniciado — run_id=%s", run_id)

    try:
        # 2. Eventos elegíveis
        events = await _fetch_scheduled_events_with_odds(db, event_ids)
        if not events:
            logger.info("Shadow cycle: nenhum evento futuro com odds.")
            duration = time.monotonic() - cycle_start
            await _finish_pipeline_run(
                db, run_id, cycle_result,
                duration_seconds=round(duration, 2),
            )
            return cycle_result

        logger.info("Shadow cycle: %d eventos elegíveis.", len(events))

        for event in events:
            try:
                event_id = event["event_id"]
                league = event.get("league_name") or event.get("league_id") or "unknown"
                sport = event.get("sport_code") or "football"
                home_team = event.get("home_team_name")
                away_team = event.get("away_team_name")
                kickoff_at = event["kickoff_at"]

                # Fail-safe: verificar timing
                timing_ok, timing_reason = _validate_event_timing(kickoff_at)
                if not timing_ok:
                    cycle_result.warnings.append(
                        f"Evento {event_id}: {timing_reason}"
                    )
                    cycle_result.skipped_fail_safe += 1
                    continue

                # Árvore de odds do evento
                event_odds = await _fetch_event_odds(db, event_id)
                if not event_odds:
                    continue

                # Contabilizar fontes de odds (bookmakers distintas neste evento)
                event_bookmakers = set()
                for _mkt_odds in event_odds.values():
                    event_bookmakers.update(_mkt_odds.keys())
                total_odds_sources += len(event_bookmakers)

                # Fair probabilities por mercado (Shin preferencial)
                fair_probs_map = compute_fair_probs_for_event(
                    event_odds, method=FAIR_PROBABILITY_METHOD,
                )

                prediction_run_id = _generate_prediction_run_id(run_id, event_id)
                event_predictions = 0
                event_selections = 0

                for market_code, bookmaker_odds in event_odds.items():
                    total_markets_processed += 1
                    fair_probs = fair_probs_map.get(market_code)
                    if not fair_probs:
                        continue

                    # Fail-safe: validar fair probs
                    fp_valid, fp_reason = _validate_fair_probs(fair_probs, market_code)
                    if not fp_valid:
                        cycle_result.warnings.append(
                            f"Evento {event_id}/{market_code}: {fp_reason}"
                        )
                        cycle_result.skipped_fail_safe += 1
                        continue

                    n_bookmakers = len(bookmaker_odds)
                    mkt_overround = compute_market_overround(bookmaker_odds)

                    # Fail-safe: overround extremo
                    if mkt_overround > MAX_OVERROUND:
                        cycle_result.warnings.append(
                            f"Evento {event_id}/{market_code}: overround {mkt_overround:.2%} > {MAX_OVERROUND:.0%}"
                        )
                        cycle_result.skipped_fail_safe += 1
                        continue

                    for outcome_code, fair_prob in fair_probs.items():
                        if fair_prob <= 0:
                            continue

                        # Melhor odd entre bookmakers
                        try:
                            best_odds, best_bookmaker = _find_best_odds(
                                bookmaker_odds, outcome_code,
                            )
                        except ValueError:
                            continue

                        # Fail-safe: validar odds
                        odds_ok, odds_reason = _validate_odds(best_odds, f"{event_id}/{market_code}/{outcome_code}")
                        if not odds_ok:
                            cycle_result.warnings.append(odds_reason)
                            cycle_result.skipped_fail_safe += 1
                            continue

                        # Model probability — FAIL-SAFE: recusar se ausente
                        model_prob, model_meta = await _fetch_model_probability(
                            db, event_id, market_code, outcome_code,
                        )
                        if model_prob is None:
                            # NÃO fabricar probabilidade — preferir não prever
                            cycle_result.warnings.append(
                                f"Evento {event_id}/{market_code}/{outcome_code}: "
                                "sem model_probability disponível — previsão recusada (fail-safe)"
                            )
                            cycle_result.skipped_fail_safe += 1
                            continue

                        # Calcular métricas de valor
                        edge = calculate_edge(model_prob, fair_prob)

                        # Só persiste se edge > threshold
                        if edge <= MIN_EDGE_THRESHOLD:
                            continue

                        ev = calculate_ev(model_prob, best_odds)

                        # PREDIQ Score detalhado — persiste componentes individuais
                        try:
                            score_result = calculate_edge_score_detailed(
                                edge=edge,
                                expected_value=ev,
                                model_confidence=0.7,  # placeholder — ensemble real dará variância
                                market_overround=mkt_overround if mkt_overround > 0 else None,
                            )
                            prediq_score = score_result.score
                            # `to_dict()` espelha os campos reais de EdgeScoreComponents
                            # (inclui `ev`, não `expected_value`, e `bookmaker_coverage`)
                            # — usar os nomes do dataclass evita divergência silenciosa
                            # entre o que é calculado e o que é persistido.
                            score_components = {
                                "components": score_result.components.to_dict(),
                                "weights": score_result.weights,
                            }
                        except Exception:
                            # Fallback ao score simples se detailed falhar
                            prediq_score = calculate_edge_score(
                                edge=edge,
                                expected_value=ev,
                                model_confidence=0.7,
                                market_overround=mkt_overround if mkt_overround > 0 else None,
                            )
                            score_components = None

                        # Kelly variantes
                        try:
                            k_full = kelly_full_calc(model_prob, best_odds)
                        except ValueError:
                            k_full = 0.0
                        k_fractional = fractional_kelly(model_prob, best_odds, fraction=KELLY_FRACTION)
                        k_capped = min(k_fractional, KELLY_CAP)

                        # Snapshot de odds por bookmaker para auditoria
                        snapshot = {
                            bookie: outcomes.get(outcome_code)
                            for bookie, outcomes in bookmaker_odds.items()
                            if outcomes.get(outcome_code) is not None
                        }

                        # Avaliar seleção shadow
                        is_selected, selection_reason = _evaluate_shadow_selection(
                            edge=edge,
                            ev=ev,
                            prediq_score=prediq_score,
                            n_bookmakers=n_bookmakers,
                            fair_prob_valid=fp_valid,
                            kickoff_at=kickoff_at,
                        )

                        # Inserir (idempotente — ON CONFLICT DO NOTHING)
                        insert_result = await db.execute(text("""
                            INSERT INTO shadow_predictions (
                                event_id, league, sport, market, outcome,
                                kickoff_at, bookmaker, best_odds,
                                fair_market_probability, entry_fair_probability,
                                model_probability,
                                edge, ev, prediq_score, kelly_fraction,
                                model_version, features_version,
                                snapshot_odds, market_overround,
                                home_team, away_team,
                                pipeline_run_id, prediction_run_id,
                                as_of, snapshot_sequence,
                                is_shadow_selection, selection_strategy,
                                selection_reason, selected_at, selection_version,
                                fair_probability_method, fair_probability_version,
                                ensemble_version, score_version, pipeline_version,
                                score_components,
                                kelly_full, kelly_capped, kelly_version,
                                individual_model_probs, ensemble_variance,
                                ensemble_probability
                            ) VALUES (
                                :event_id, :league, :sport, :market, :outcome,
                                :kickoff_at, :bookmaker, :best_odds,
                                :fair_prob, :entry_fair_prob,
                                :model_prob,
                                :edge, :ev, :prediq_score, :kelly,
                                :model_version, :features_version,
                                :snapshot::jsonb, :overround,
                                :home_team, :away_team,
                                :pipeline_run_id, :prediction_run_id,
                                :as_of, :snapshot_seq,
                                :is_selected, :sel_strategy,
                                :sel_reason::jsonb, :selected_at, :sel_version,
                                :fp_method, :fp_version,
                                :ensemble_ver, :score_ver, :pipeline_ver,
                                :score_comp::jsonb,
                                :kelly_full, :kelly_capped, :kelly_ver,
                                :individual_probs::jsonb, :ensemble_var,
                                :ensemble_prob
                            )
                            ON CONFLICT (prediction_run_id, event_id, market, outcome)
                            DO NOTHING
                            RETURNING id
                        """), {
                            "event_id": event_id,
                            "league": league,
                            "sport": sport,
                            "market": market_code,
                            "outcome": outcome_code,
                            "kickoff_at": kickoff_at,
                            "bookmaker": best_bookmaker,
                            "best_odds": best_odds,
                            "fair_prob": fair_prob,
                            "entry_fair_prob": fair_prob,
                            "model_prob": model_prob,
                            "edge": edge,
                            "ev": ev,
                            "prediq_score": prediq_score,
                            "kelly": k_fractional,
                            "model_version": MODEL_VERSION,
                            "features_version": FEATURES_VERSION,
                            "snapshot": json.dumps(snapshot),
                            "overround": mkt_overround,
                            "home_team": home_team,
                            "away_team": away_team,
                            "pipeline_run_id": run_id,
                            "prediction_run_id": prediction_run_id,
                            "as_of": datetime.now(timezone.utc),
                            "snapshot_seq": 1,
                            "is_selected": is_selected,
                            "sel_strategy": SELECTION_VERSION if is_selected else None,
                            "sel_reason": json.dumps(selection_reason) if is_selected else None,
                            "selected_at": datetime.now(timezone.utc) if is_selected else None,
                            "sel_version": SELECTION_VERSION if is_selected else None,
                            "fp_method": FAIR_PROBABILITY_METHOD,
                            "fp_version": FAIR_PROBABILITY_VERSION,
                            "ensemble_ver": ENSEMBLE_VERSION,
                            "score_ver": SCORE_VERSION,
                            "pipeline_ver": PIPELINE_VERSION,
                            "score_comp": json.dumps(score_components) if score_components else None,
                            "kelly_full": k_full,
                            "kelly_capped": k_capped,
                            "kelly_ver": KELLY_VERSION,
                            "individual_probs": json.dumps(model_meta) if model_meta else None,
                            "ensemble_var": None,  # placeholder — ensemble real dará variância
                            "ensemble_prob": model_prob,
                        })

                        row = insert_result.fetchone()
                        if row:
                            event_predictions += 1
                            if is_selected:
                                event_selections += 1

                await db.commit()

                if event_predictions > 0:
                    cycle_result.predictions_created += event_predictions
                    cycle_result.selections_made += event_selections
                    logger.debug(
                        "Shadow: evento %s — %d previsões, %d seleções.",
                        event_id, event_predictions, event_selections,
                    )

                cycle_result.events_processed += 1

            except Exception as exc:
                cycle_result.errors.append(f"Evento {event.get('event_id', '?')}: {exc}")
                logger.exception(
                    "Shadow cycle: erro no evento %s", event.get("event_id"),
                )

        # Validar ausência de data leakage neste run
        leakage = await validate_no_leakage(db, pipeline_run_id=run_id)
        if not leakage["passed"]:
            cycle_result.errors.extend(leakage["violations"])

        duration = time.monotonic() - cycle_start
        await _finish_pipeline_run(
            db, run_id, cycle_result,
            duration_seconds=round(duration, 2),
            markets_processed=total_markets_processed,
            odds_sources_count=total_odds_sources,
        )

    except Exception as exc:
        cycle_result.errors.append(f"Erro fatal no pipeline: {exc}")
        logger.exception("Shadow cycle: erro fatal — run_id=%s", run_id)
        duration = time.monotonic() - cycle_start
        await _finish_pipeline_run(
            db, run_id, cycle_result, status="failed",
            duration_seconds=round(duration, 2),
            markets_processed=total_markets_processed,
            odds_sources_count=total_odds_sources,
        )

    logger.info(
        "Shadow cycle concluído — run_id=%s, %d eventos, %d previsões, "
        "%d seleções, %d erros, %d fail-safes.",
        run_id, cycle_result.events_processed, cycle_result.predictions_created,
        cycle_result.selections_made, len(cycle_result.errors),
        cycle_result.skipped_fail_safe,
    )
    return cycle_result


# ═══════════════════════════════════════════════════════════════════════════
# Captura de closing odds
# ═══════════════════════════════════════════════════════════════════════════

async def capture_closing_odds(db: AsyncSession) -> int:
    """Captura closing odds para eventos prestes a começar (kickoff em até 2h).

    Diferenças do v1 hardened:
        - Persiste closing_bookmaker, closing_odds_at, closing_source
        - Valida closing_is_valid (odds razoáveis, mercado ativo)
        - NÃO sobrescreve snapshot_odds original (usa campo separado)
        - Write-once: closing_odds IS NULL

    Returns:
        Número de previsões atualizadas com closing odds.
    """
    predictions = await db.execute(text("""
        SELECT sp.id, sp.event_id, sp.market, sp.outcome, sp.best_odds
        FROM shadow_predictions sp
        WHERE sp.status = 'open'
          AND sp.closing_odds IS NULL
          AND sp.kickoff_at BETWEEN now() AND now() + interval '2 hours'
    """))
    rows = predictions.mappings().all()

    if not rows:
        return 0

    updated = 0
    now = datetime.now(timezone.utc)

    for pred in rows:
        odds_result = await db.execute(text("""
            SELECT
                o.decimal_odds,
                b.name AS bookmaker_name
            FROM odds o
            JOIN bookmakers b ON b.id = o.bookmaker_id
            JOIN markets m    ON m.id = o.market_id
            JOIN outcomes oc  ON oc.id = o.outcome_id
            WHERE o.event_id = :event_id
              AND m.code  = :market
              AND oc.code = :outcome
              AND o.is_suspended = false
            ORDER BY o.decimal_odds DESC
            LIMIT 1
        """), {
            "event_id": pred["event_id"],
            "market": pred["market"],
            "outcome": pred["outcome"],
        })
        best_row = odds_result.mappings().first()

        if not best_row:
            # Mercado suspenso ou sem odds — registrar como inválido
            await db.execute(text("""
                UPDATE shadow_predictions
                SET closing_is_valid = FALSE,
                    closing_reason = :reason,
                    closing_odds_at = :captured_at
                WHERE id = :pred_id
                  AND closing_odds IS NULL
            """), {
                "pred_id": pred["id"],
                "reason": "mercado suspenso ou sem odds disponíveis",
                "captured_at": now,
            })
            updated += 1
            continue

        closing = float(best_row["decimal_odds"])
        closing_bookie = best_row["bookmaker_name"]

        # Validar closing odds
        closing_valid = True
        closing_reason = None
        if closing <= 1.0:
            closing_valid = False
            closing_reason = f"closing odds {closing} <= 1.0"
        elif closing > MAX_ODDS:
            closing_valid = False
            closing_reason = f"closing odds {closing} > {MAX_ODDS}"

        # Calcular fair probability de fechamento via Shin method —
        # busca TODAS as odds do mercado de closing para remover overround.
        closing_fair_prob = None
        try:
            closing_event_odds = await _fetch_event_odds(db, str(pred["event_id"]))
            if closing_event_odds and pred["market"] in closing_event_odds:
                closing_fair_map = compute_fair_probs_for_event(
                    {pred["market"]: closing_event_odds[pred["market"]]},
                    method=FAIR_PROBABILITY_METHOD,
                )
                closing_fair_probs = closing_fair_map.get(pred["market"])
                if closing_fair_probs and pred["outcome"] in closing_fair_probs:
                    closing_fair_prob = closing_fair_probs[pred["outcome"]]
        except Exception:
            # Falha no cálculo de fair prob de fechamento não deve impedir
            # a captura da closing odds em si — closing_fair_probability
            # ficará NULL e o CLV probability não será calculado.
            logger.warning(
                "Falha ao calcular closing_fair_probability para pred %s",
                pred["id"],
            )

        await db.execute(text("""
            UPDATE shadow_predictions
            SET closing_odds              = :closing,
                closing_bookmaker         = :bookie,
                closing_odds_at           = :captured_at,
                closing_source            = :source,
                closing_is_valid          = :is_valid,
                closing_reason            = :reason,
                closing_fair_probability  = :closing_fair_prob
            WHERE id = :pred_id
              AND closing_odds IS NULL
        """), {
            "pred_id": pred["id"],
            "closing": closing,
            "bookie": closing_bookie,
            "captured_at": now,
            "source": "odds_table_best",
            "is_valid": closing_valid,
            "reason": closing_reason,
            "closing_fair_prob": closing_fair_prob,
        })
        updated += 1

    if updated:
        await db.commit()

    logger.info("Closing odds capturadas para %d previsões.", updated)
    return updated


# ═══════════════════════════════════════════════════════════════════════════
# Grading
# ═══════════════════════════════════════════════════════════════════════════

def _determine_result(
    market: str,
    outcome: str,
    home_score: int,
    away_score: int,
) -> str:
    """Determina resultado de uma previsão baseado no placar.

    Suporta: 1x2, ou (2.5), btts, double_chance, dnb.
    Retorna 'void' para mercados não reconhecidos.
    """
    if market == "1x2":
        if outcome == "home":
            return "won" if home_score > away_score else "lost"
        elif outcome == "draw":
            return "won" if home_score == away_score else "lost"
        elif outcome == "away":
            return "won" if away_score > home_score else "lost"
    elif market == "ou":
        total = home_score + away_score
        if outcome == "over":
            return "won" if total > 2.5 else "lost"
        elif outcome == "under":
            return "won" if total < 2.5 else "lost"
    elif market == "btts":
        both = home_score > 0 and away_score > 0
        if outcome == "yes":
            return "won" if both else "lost"
        elif outcome == "no":
            return "won" if not both else "lost"
    elif market == "double_chance":
        if outcome == "home_or_draw":
            return "won" if home_score >= away_score else "lost"
        elif outcome == "home_or_away":
            return "won" if home_score != away_score else "lost"
        elif outcome == "away_or_draw":
            return "won" if away_score >= home_score else "lost"
    elif market == "dnb":
        if home_score == away_score:
            return "void"
        if outcome == "home":
            return "won" if home_score > away_score else "lost"
        elif outcome == "away":
            return "won" if away_score > home_score else "lost"

    logger.warning("Mercado '%s/%s' não suportado para grading automático.", market, outcome)
    return "void"


def _calculate_theoretical_return(result: str, best_odds: float) -> float:
    """Calcula retorno teórico por unidade apostada."""
    if result == "won":
        return best_odds - 1.0
    elif result == "lost":
        return -1.0
    return 0.0


def _calculate_clv_price(entry_odds: float, closing_odds: float | None) -> float | None:
    """CLV baseado em preço: entry_odds / closing_odds - 1.

    Positivo = obteve odds melhores que o mercado de fechamento.
    """
    if closing_odds is None or closing_odds <= 1.0:
        return None
    return (entry_odds / closing_odds) - 1.0


def _calculate_clv_probability(
    entry_fair_prob: float | None,
    closing_fair_prob: float | None,
) -> float | None:
    """CLV baseado em probabilidade: closing_fair_probability - entry_fair_probability.

    Positivo = probabilidade justa de fechamento é MAIOR que a de abertura,
    indicando que o mercado "caminhou" na direção do modelo.
    """
    if entry_fair_prob is None or closing_fair_prob is None:
        return None
    if entry_fair_prob <= 0 or closing_fair_prob <= 0:
        return None
    return closing_fair_prob - entry_fair_prob


async def grade_shadow_predictions(db: AsyncSession) -> int:
    """Faz grading de previsões abertas cujos eventos já terminaram.

    Calcula resultado, retorno teórico, e CLV dual (preço e probabilidade).
    Write-once: só atualiza WHERE status='open' AND kickoff_at < now().
    """
    result = await db.execute(text("""
        SELECT
            sp.id,
            sp.market,
            sp.outcome,
            sp.best_odds,
            sp.closing_odds,
            sp.closing_is_valid,
            sp.model_probability,
            sp.fair_market_probability,
            sp.closing_fair_probability,
            e.home_score,
            e.away_score
        FROM shadow_predictions sp
        JOIN events e ON e.id = sp.event_id
        WHERE sp.status = 'open'
          AND sp.kickoff_at < now()
          AND e.status = 'finished'
          AND e.home_score IS NOT NULL
          AND e.away_score IS NOT NULL
    """))
    rows = result.mappings().all()

    if not rows:
        return 0

    graded = 0
    for row in rows:
        pred_result = _determine_result(
            market=row["market"],
            outcome=row["outcome"],
            home_score=int(row["home_score"]),
            away_score=int(row["away_score"]),
        )

        theoretical_ret = _calculate_theoretical_return(
            pred_result, float(row["best_odds"]),
        )

        closing = float(row["closing_odds"]) if row["closing_odds"] is not None else None
        closing_valid = row["closing_is_valid"]

        # CLV dual — só calcular se closing odds válidas
        clv_price = None
        clv_prob = None
        # entry_fair_prob e closing_fair_prob para a nova fórmula de CLV probability
        entry_fair_prob = float(row["fair_market_probability"]) if row["fair_market_probability"] is not None else None
        closing_fair_prob = float(row["closing_fair_probability"]) if row["closing_fair_probability"] is not None else None
        if closing and closing_valid:
            clv_price = _calculate_clv_price(float(row["best_odds"]), closing)
            clv_prob = _calculate_clv_probability(entry_fair_prob, closing_fair_prob)
        elif closing:
            # Closing odds existem mas são inválidas — calcular CLV prob se possível
            clv_prob = _calculate_clv_probability(entry_fair_prob, closing_fair_prob)

        # Para compatibilidade, 'clv' mantém o valor probability-based
        clv_compat = clv_prob

        final_status = "void" if pred_result == "void" else "graded"

        await db.execute(text("""
            UPDATE shadow_predictions
            SET result             = :result,
                theoretical_return = :ret,
                clv                = :clv_compat,
                clv_price          = :clv_price,
                clv_probability    = :clv_prob,
                graded_at          = now(),
                status             = :status,
                grading_source     = 'events_table',
                grading_version    = :grading_ver
            WHERE id = :pred_id
              AND status = 'open'
              AND kickoff_at < now()
        """), {
            "pred_id": row["id"],
            "result": pred_result,
            "ret": theoretical_ret,
            "clv_compat": clv_compat,
            "clv_price": clv_price,
            "clv_prob": clv_prob,
            "status": final_status,
            "grading_ver": GRADING_VERSION,
        })
        graded += 1

    if graded:
        await db.commit()

    logger.info("Shadow grading: %d previsões gradeadas.", graded)
    return graded


# ═══════════════════════════════════════════════════════════════════════════
# Overview / Dashboard
# ═══════════════════════════════════════════════════════════════════════════

async def get_shadow_overview(db: AsyncSession) -> dict:
    """Retorna overview do Shadow Mode com métricas acumuladas.

    IMPORTANTE: métricas de ROI, drawdown e hit rate usam APENAS
    shadow selections (is_shadow_selection = TRUE). Métricas de
    calibração (Brier, Log Loss, ECE) usam TODAS as previsões gradeadas.
    """
    # Contagens gerais (todas as previsões)
    counts = await db.execute(text("""
        SELECT
            COUNT(*)                                                     AS total,
            COUNT(*) FILTER (WHERE status = 'open')                      AS open,
            COUNT(*) FILTER (WHERE status = 'graded')                    AS graded,
            COUNT(*) FILTER (WHERE status = 'void')                      AS voided,
            COUNT(*) FILTER (WHERE result = 'won')                       AS won,
            COUNT(*) FILTER (WHERE result = 'lost')                      AS lost,
            COUNT(*) FILTER (WHERE is_shadow_selection = TRUE)           AS total_selections,
            COUNT(*) FILTER (WHERE is_shadow_selection = TRUE
                                AND status = 'graded')                   AS graded_selections
        FROM shadow_predictions
    """))
    c = counts.mappings().first()

    total = int(c["total"])
    open_count = int(c["open"])
    graded_count = int(c["graded"])
    total_selections = int(c["total_selections"] or 0)
    graded_selections = int(c["graded_selections"] or 0)
    won_count = int(c["won"] or 0)
    lost_count = int(c["lost"] or 0)
    resolved = won_count + lost_count

    # Métricas de seleção (ROI, hit rate, drawdown — APENAS seleções)
    sel_metrics = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE result = 'won')           AS sel_won,
            COUNT(*) FILTER (WHERE result = 'lost')          AS sel_lost,
            AVG(clv_price) FILTER (WHERE clv_price IS NOT NULL) AS clv_price_mean,
            AVG(clv_probability) FILTER (WHERE clv_probability IS NOT NULL) AS clv_prob_mean,
            SUM(theoretical_return) FILTER (WHERE status = 'graded') AS sel_return,
            COUNT(*) FILTER (WHERE status = 'graded')        AS sel_graded
        FROM shadow_predictions
        WHERE is_shadow_selection = TRUE
    """))
    sm = sel_metrics.mappings().first()

    sel_won = int(sm["sel_won"] or 0)
    sel_lost = int(sm["sel_lost"] or 0)
    sel_resolved = sel_won + sel_lost
    sel_graded = int(sm["sel_graded"] or 0)
    sel_return = float(sm["sel_return"]) if sm["sel_return"] is not None else 0.0
    clv_price_mean = float(sm["clv_price_mean"]) if sm["clv_price_mean"] is not None else None
    clv_prob_mean = float(sm["clv_prob_mean"]) if sm["clv_prob_mean"] is not None else None

    hit_rate = sel_won / sel_resolved if sel_resolved > 0 else None
    roi = sel_return / sel_graded if sel_graded > 0 else None

    # Brier Score e Log Loss — sobre TODAS as previsões gradeadas
    brier = None
    log_loss = None
    ece = None

    if resolved >= 10:
        brier_result = await db.execute(text("""
            SELECT
                AVG(POWER(model_probability - CASE WHEN result = 'won' THEN 1 ELSE 0 END, 2))
                    AS brier
            FROM shadow_predictions
            WHERE status = 'graded' AND result IN ('won', 'lost')
        """))
        br = brier_result.scalar()
        brier = float(br) if br is not None else None

        ll_result = await db.execute(text("""
            SELECT model_probability, result
            FROM shadow_predictions
            WHERE status = 'graded' AND result IN ('won', 'lost')
        """))
        ll_rows = ll_result.mappings().all()
        if ll_rows:
            eps = 1e-15
            ll_sum = 0.0
            for r in ll_rows:
                p = max(eps, min(1 - eps, float(r["model_probability"])))
                outcome = 1 if r["result"] == "won" else 0
                ll_sum += -(outcome * math.log(p) + (1 - outcome) * math.log(1 - p))
            log_loss = ll_sum / len(ll_rows)

        if resolved >= 50:
            n_bins = 10
            bins: dict[int, list[tuple[float, int]]] = {i: [] for i in range(n_bins)}
            for r in ll_rows:
                p = float(r["model_probability"])
                o = 1 if r["result"] == "won" else 0
                idx = min(int(p * n_bins), n_bins - 1)
                bins[idx].append((p, o))

            ece_sum = 0.0
            for bin_list in bins.values():
                if not bin_list:
                    continue
                avg_p = sum(x[0] for x in bin_list) / len(bin_list)
                avg_o = sum(x[1] for x in bin_list) / len(bin_list)
                ece_sum += len(bin_list) * abs(avg_p - avg_o)
            ece = ece_sum / resolved

    # Drawdown (APENAS seleções)
    drawdown = None
    if sel_graded >= 10:
        dd_result = await db.execute(text("""
            SELECT theoretical_return
            FROM shadow_predictions
            WHERE is_shadow_selection = TRUE AND status = 'graded'
            ORDER BY graded_at ASC
        """))
        returns = [float(r[0]) for r in dd_result.fetchall()]
        cumulative = 0.0
        peak = 0.0
        max_dd = 0.0
        for ret in returns:
            cumulative += ret
            peak = max(peak, cumulative)
            max_dd = max(max_dd, peak - cumulative)
        drawdown = max_dd

    # Sistema status
    system_status = _determine_system_status(resolved, sel_graded, ece, clv_prob_mean)

    # Critérios de graduação
    graduation = {
        "events_200": resolved >= 200,
        "selections_500": sel_graded >= 500,
        "ece_threshold": ece is not None and ece < 0.05,
        "clv_positive": clv_prob_mean is not None and clv_prob_mean > 0,
        "no_data_leakage": True,  # verificado separadamente via validate_no_leakage
        "convergence_check": False,  # placeholder — verificação manual
    }
    graduation["ready"] = all(
        graduation[k] for k in ("events_200", "selections_500", "ece_threshold", "clv_positive")
    )

    return {
        "system_status": system_status,
        "total_predictions": total,
        "open": open_count,
        "graded": graded_count,
        "voided": int(c["voided"] or 0),
        "won": won_count,
        "lost": lost_count,
        "total_selections": total_selections,
        "graded_selections": graded_selections,
        "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
        "roi": round(roi, 6) if roi is not None else None,
        "brier_score": round(brier, 6) if brier is not None else None,
        "log_loss": round(log_loss, 6) if log_loss is not None else None,
        "ece": round(ece, 6) if ece is not None else None,
        "clv_price_mean": round(clv_price_mean, 6) if clv_price_mean is not None else None,
        "clv_probability_mean": round(clv_prob_mean, 6) if clv_prob_mean is not None else None,
        "max_drawdown": round(drawdown, 4) if drawdown is not None else None,
        "sample_size": resolved,
        "graduation_criteria": graduation,
    }


# ═══════════════════════════════════════════════════════════════════════════
# System status
# ═══════════════════════════════════════════════════════════════════════════

def _determine_system_status(
    resolved: int,
    selections_graded: int,
    ece: float | None,
    clv_mean: float | None,
) -> str:
    """Determina o estado do sistema Shadow Mode.

    Estados:
        DEVELOPMENT: Ainda não coleta dados prospectivos
        SHADOW_COLLECTING: Coletando dados, volume insuficiente
        SHADOW_VALIDATING: Volume suficiente, validando métricas
        SHADOW_ELIGIBLE: Todos os critérios automáticos atendidos
        PRODUCTION_CANDIDATE: Elegível + convergência manual verificada
    """
    if resolved < 50:
        return "SHADOW_COLLECTING"
    if resolved < 200 or selections_graded < 500:
        return "SHADOW_COLLECTING"
    # Volume suficiente — verificar métricas
    if ece is not None and ece < 0.05 and clv_mean is not None and clv_mean > 0:
        return "SHADOW_ELIGIBLE"
    return "SHADOW_VALIDATING"
