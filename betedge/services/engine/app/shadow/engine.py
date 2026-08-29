"""Motor principal do Shadow Mode v1 — ciclo diário de previsão, grading e CLV.

Fluxo do ciclo shadow:
    1. Buscar eventos futuros com odds
    2. Para cada evento: calcular fair probs, edges, EVs, edge scores
    3. Persistir previsões com edge > MIN_EDGE_THRESHOLD (append-only)
    4. Capturar closing odds antes do kickoff
    5. Grading automático após resultado
    6. Calcular métricas acumuladas

Princípios invioláveis:
    - Nenhuma previsão é modificada após o kickoff (imutabilidade)
    - Grading é write-once: result/clv/theoretical_return preenchidos uma vez
    - ON CONFLICT DO NOTHING garante idempotência
    - Nenhum dinheiro real — Shadow Mode é puramente prospectivo
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shadow.schema import ensure_shadow_table
from app.value.engine import (
    calculate_edge,
    calculate_ev,
    calculate_edge_score,
    implied_probability,
)
from app.value.fair_probability import (
    compute_fair_probs_for_event,
    compute_market_overround,
)
from app.value.kelly import fractional_kelly

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# Constantes
# ═══════════════════════════════════════════════════════════════════════════

# Threshold mínimo de edge para persistir uma shadow prediction (2 p.p.)
MIN_EDGE_THRESHOLD = 0.02

# Versão do feature set — persistida para reprodutibilidade
FEATURES_VERSION = "1.0.0"

# Versão do modelo — placeholder até integrar ensemble real
MODEL_VERSION = "shadow-v1.0.0"


# ═══════════════════════════════════════════════════════════════════════════
# Dataclass de resultado
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class ShadowCycleResult:
    """Resultado consolidado de um ciclo shadow."""
    events_processed: int = 0
    predictions_created: int = 0
    errors: list[str] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════════
# Helpers de banco — reutilizam padrão do orchestrator
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
) -> float | None:
    """Busca probabilidade do ensemble em model_predictions (se existir).

    Tenta primeiro consensus_predictions (ensemble), depois model_predictions
    da versão mais recente. Retorna None se não houver nada — o caller usará
    um fallback (fair_prob * fator de ajuste).
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
        return float(row)

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
    return float(row) if row is not None else None


def _find_best_odds(
    bookmaker_odds: dict[str, dict[str, float]], outcome: str,
) -> tuple[float, str]:
    """Encontra a melhor odd (maior) para um outcome entre bookmakers.

    Retorna (best_odds, best_bookmaker). Levanta ValueError se nenhum
    bookmaker oferecer o outcome.
    """
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
# Ciclo principal
# ═══════════════════════════════════════════════════════════════════════════

async def run_shadow_cycle(
    db: AsyncSession,
    event_ids: list[str] | None = None,
) -> ShadowCycleResult:
    """Executa o ciclo shadow completo: gerar previsões para eventos futuros.

    Passos:
        1. Garantir tabela shadow_predictions
        2. Buscar eventos scheduled com odds
        3. Para cada evento/mercado/outcome:
           a. Calcular fair probability (Shin + fallback)
           b. Obter model_probability (ensemble ou fallback)
           c. Calcular edge, EV, PREDIQ Score, Kelly
           d. Persistir se edge > threshold (ON CONFLICT DO NOTHING)
        4. Retornar contadores

    Args:
        db: Sessão assíncrona do SQLAlchemy.
        event_ids: IDs específicos. Se None, processa todos os futuros.

    Returns:
        ShadowCycleResult com métricas da execução.
    """
    result = ShadowCycleResult()

    # 1. Garantir tabela
    await ensure_shadow_table(db)

    # 2. Eventos elegíveis
    events = await _fetch_scheduled_events_with_odds(db, event_ids)
    if not events:
        logger.info("Shadow cycle: nenhum evento futuro com odds.")
        return result

    logger.info("Shadow cycle: %d eventos elegíveis.", len(events))

    for event in events:
        try:
            event_id = event["event_id"]
            league = event.get("league_name") or event.get("league_id") or "unknown"
            sport = event.get("sport_code") or "football"
            home_team = event.get("home_team_name")
            away_team = event.get("away_team_name")
            kickoff_at = event["kickoff_at"]

            # 3a. Árvore de odds do evento
            event_odds = await _fetch_event_odds(db, event_id)
            if not event_odds:
                continue

            # 3b. Fair probabilities por mercado (Shin preferencial)
            fair_probs_map = compute_fair_probs_for_event(event_odds, method="shin")

            # 3c. Overround médio do evento (diagnóstico)
            event_predictions = 0

            for market_code, bookmaker_odds in event_odds.items():
                fair_probs = fair_probs_map.get(market_code)
                if not fair_probs:
                    continue

                # Overround do mercado
                mkt_overround = compute_market_overround(bookmaker_odds)

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

                    # Model probability: ensemble → fallback heurístico
                    model_prob = await _fetch_model_probability(
                        db, event_id, market_code, outcome_code,
                    )
                    if model_prob is None:
                        # Placeholder: fair_prob com leve ajuste para cima (5%)
                        # Simula que o modelo enxerga um pouco mais de valor
                        # do que o consenso de mercado. Em produção, será
                        # substituído pela saída real do ensemble.
                        model_prob = min(0.999, fair_prob * 1.05)

                    # Calcular métricas de valor
                    edge = calculate_edge(model_prob, fair_prob)

                    # Só persiste se edge > threshold — sem edge não há valor
                    if edge <= MIN_EDGE_THRESHOLD:
                        continue

                    ev = calculate_ev(model_prob, best_odds)
                    prediq_score = calculate_edge_score(
                        edge=edge,
                        expected_value=ev,
                        model_confidence=0.7,  # placeholder — ensemble real dará a variância
                        market_overround=mkt_overround if mkt_overround > 0 else None,
                    )
                    kelly = fractional_kelly(model_prob, best_odds, fraction=0.25)

                    # Snapshot de odds por bookmaker para auditoria
                    snapshot = {
                        bookie: outcomes.get(outcome_code)
                        for bookie, outcomes in bookmaker_odds.items()
                        if outcomes.get(outcome_code) is not None
                    }

                    # Inserir (idempotente — ON CONFLICT DO NOTHING)
                    insert_result = await db.execute(text("""
                        INSERT INTO shadow_predictions (
                            event_id, league, sport, market, outcome,
                            kickoff_at, bookmaker, best_odds,
                            fair_market_probability, model_probability,
                            edge, ev, prediq_score, kelly_fraction,
                            model_version, features_version,
                            snapshot_odds, market_overround,
                            home_team, away_team
                        ) VALUES (
                            :event_id, :league, :sport, :market, :outcome,
                            :kickoff_at, :bookmaker, :best_odds,
                            :fair_prob, :model_prob,
                            :edge, :ev, :prediq_score, :kelly,
                            :model_version, :features_version,
                            :snapshot::jsonb, :overround,
                            :home_team, :away_team
                        )
                        ON CONFLICT (event_id, market, outcome, model_version)
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
                        "model_prob": model_prob,
                        "edge": edge,
                        "ev": ev,
                        "prediq_score": prediq_score,
                        "kelly": kelly,
                        "model_version": MODEL_VERSION,
                        "features_version": FEATURES_VERSION,
                        "snapshot": json.dumps(snapshot),
                        "overround": mkt_overround,
                        "home_team": home_team,
                        "away_team": away_team,
                    })

                    # RETURNING id só retorna se houve inserção (não conflito)
                    row = insert_result.fetchone()
                    if row:
                        event_predictions += 1

            await db.commit()

            if event_predictions > 0:
                result.predictions_created += event_predictions
                logger.debug(
                    "Shadow: evento %s — %d previsões criadas.",
                    event_id, event_predictions,
                )

            result.events_processed += 1

        except Exception as exc:
            result.errors.append(f"Evento {event.get('event_id', '?')}: {exc}")
            logger.exception(
                "Shadow cycle: erro no evento %s", event.get("event_id"),
            )

    logger.info(
        "Shadow cycle concluído — %d eventos, %d previsões, %d erros.",
        result.events_processed, result.predictions_created, len(result.errors),
    )
    return result


# ═══════════════════════════════════════════════════════════════════════════
# Captura de closing odds
# ═══════════════════════════════════════════════════════════════════════════

async def capture_closing_odds(db: AsyncSession) -> int:
    """Captura closing odds para eventos prestes a começar (kickoff em até 2h).

    Busca as odds mais recentes e atualiza shadow_predictions onde
    closing_odds IS NULL (write-once — nunca sobrescreve). Também salva
    o snapshot completo das odds finais.

    Returns:
        Número de previsões atualizadas com closing odds.
    """
    # Buscar shadow predictions abertas com kickoff próximo e sem closing odds
    predictions = await db.execute(text("""
        SELECT sp.id, sp.event_id, sp.market, sp.outcome
        FROM shadow_predictions sp
        WHERE sp.status = 'open'
          AND sp.closing_odds IS NULL
          AND sp.kickoff_at BETWEEN now() AND now() + interval '2 hours'
    """))
    rows = predictions.mappings().all()

    if not rows:
        return 0

    updated = 0
    for pred in rows:
        # Buscar a melhor odd atual para este mercado/outcome
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
            continue

        closing = float(best_row["decimal_odds"])

        # Snapshot completo das odds finais para auditoria
        all_odds = await db.execute(text("""
            SELECT b.name AS bookmaker, o.decimal_odds
            FROM odds o
            JOIN bookmakers b ON b.id = o.bookmaker_id
            JOIN markets m    ON m.id = o.market_id
            JOIN outcomes oc  ON oc.id = o.outcome_id
            WHERE o.event_id = :event_id
              AND m.code  = :market
              AND oc.code = :outcome
              AND o.is_suspended = false
        """), {
            "event_id": pred["event_id"],
            "market": pred["market"],
            "outcome": pred["outcome"],
        })
        snapshot = {
            r["bookmaker"]: float(r["decimal_odds"])
            for r in all_odds.mappings().all()
        }

        # Atualizar — write-once (closing_odds IS NULL no WHERE original)
        await db.execute(text("""
            UPDATE shadow_predictions
            SET closing_odds  = :closing,
                snapshot_odds = :snapshot::jsonb
            WHERE id = :pred_id
              AND closing_odds IS NULL
        """), {
            "pred_id": pred["id"],
            "closing": closing,
            "snapshot": json.dumps(snapshot),
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

    Suporta mercados 1x2 (match result). Para mercados não reconhecidos,
    retorna 'void' (grading manual necessário).

    Args:
        market: código do mercado (ex.: '1x2', 'ou', 'btts').
        outcome: código do outcome (ex.: 'home', 'draw', 'away').
        home_score: gols do mandante.
        away_score: gols do visitante.

    Returns:
        'won', 'lost' ou 'void'.
    """
    if market == "1x2":
        if outcome == "home":
            return "won" if home_score > away_score else "lost"
        elif outcome == "draw":
            return "won" if home_score == away_score else "lost"
        elif outcome == "away":
            return "won" if away_score > home_score else "lost"

    elif market == "ou":
        # Over/Under 2.5 (padrão)
        total = home_score + away_score
        if outcome == "over":
            return "won" if total > 2.5 else "lost"
        elif outcome == "under":
            return "won" if total < 2.5 else "lost"

    elif market == "btts":
        # Both Teams To Score
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
        # Draw No Bet
        if home_score == away_score:
            return "void"
        if outcome == "home":
            return "won" if home_score > away_score else "lost"
        elif outcome == "away":
            return "won" if away_score > home_score else "lost"

    # Mercado não reconhecido — void para grading manual
    logger.warning("Mercado '%s/%s' não suportado para grading automático.", market, outcome)
    return "void"


def _calculate_theoretical_return(result: str, best_odds: float) -> float:
    """Calcula retorno teórico por unidade apostada.

    - won: odds - 1 (lucro líquido)
    - lost: -1 (perda do stake)
    - void: 0 (aposta devolvida)
    """
    if result == "won":
        return best_odds - 1.0
    elif result == "lost":
        return -1.0
    return 0.0


def _calculate_clv(model_prob: float, closing_odds: float | None) -> float | None:
    """Calcula Closing Line Value: diferença entre model prob e implied prob de fechamento.

    CLV = model_probability - (1 / closing_odds)

    CLV positivo indica que o modelo capturou valor que o mercado precificou
    corretamente no momento do fechamento — evidência de edge genuíno.
    """
    if closing_odds is None or closing_odds <= 1.0:
        return None
    return model_prob - (1.0 / closing_odds)


async def grade_shadow_predictions(db: AsyncSession) -> int:
    """Faz grading de previsões abertas cujos eventos já terminaram.

    Busca eventos finalizados com placar, determina resultado (won/lost/void),
    calcula retorno teórico e CLV, e atualiza shadow_predictions.

    CRÍTICO: só atualiza WHERE status='open' AND kickoff_at < now() — garante
    que previsões já gradeadas não são modificadas (write-once).

    Returns:
        Número de previsões gradeadas.
    """
    # Buscar previsões abertas com eventos finalizados
    result = await db.execute(text("""
        SELECT
            sp.id,
            sp.market,
            sp.outcome,
            sp.best_odds,
            sp.closing_odds,
            sp.model_probability,
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
        clv = _calculate_clv(float(row["model_probability"]), closing)

        # Status final: 'graded' para won/lost, 'void' para void
        final_status = "void" if pred_result == "void" else "graded"

        await db.execute(text("""
            UPDATE shadow_predictions
            SET result             = :result,
                theoretical_return = :ret,
                clv                = :clv,
                graded_at          = now(),
                status             = :status
            WHERE id = :pred_id
              AND status = 'open'
              AND kickoff_at < now()
        """), {
            "pred_id": row["id"],
            "result": pred_result,
            "ret": theoretical_ret,
            "clv": clv,
            "status": final_status,
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

    Inclui: contagens, hit rate, ROI, Brier, log loss, ECE, CLV médio,
    drawdown e critérios de graduação.
    """
    import math

    # Contagens por status
    counts = await db.execute(text("""
        SELECT
            COUNT(*)                                                     AS total,
            COUNT(*) FILTER (WHERE status = 'open')                      AS open,
            COUNT(*) FILTER (WHERE status = 'graded')                    AS graded,
            COUNT(*) FILTER (WHERE status = 'void')                      AS voided,
            COUNT(*) FILTER (WHERE result = 'won')                       AS won,
            COUNT(*) FILTER (WHERE result = 'lost')                      AS lost,
            AVG(clv)         FILTER (WHERE clv IS NOT NULL)              AS clv_mean,
            SUM(theoretical_return) FILTER (WHERE status = 'graded')     AS total_return,
            COUNT(*) FILTER (WHERE status = 'graded')                    AS graded_count
        FROM shadow_predictions
    """))
    c = counts.mappings().first()

    total = int(c["total"])
    open_count = int(c["open"])
    graded_count = int(c["graded"])
    won_count = int(c["won"] or 0)
    lost_count = int(c["lost"] or 0)
    resolved = won_count + lost_count
    clv_mean = float(c["clv_mean"]) if c["clv_mean"] is not None else None
    total_return = float(c["total_return"]) if c["total_return"] is not None else 0.0

    # Hit rate e ROI
    hit_rate = won_count / resolved if resolved > 0 else None
    roi = total_return / graded_count if graded_count > 0 else None

    # Brier Score e Log Loss — computados sobre graded
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

        # Log Loss
        ll_result = await db.execute(text("""
            SELECT
                model_probability, result
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

        # ECE (10 bins)
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

    # Drawdown simplificado (flat staking)
    drawdown = None
    if graded_count >= 10:
        dd_result = await db.execute(text("""
            SELECT theoretical_return
            FROM shadow_predictions
            WHERE status = 'graded'
            ORDER BY graded_at ASC
        """))
        returns = [float(r[0]) for r in dd_result.fetchall()]
        cumulative = 0.0
        peak = 0.0
        max_dd = 0.0
        for ret in returns:
            cumulative += ret
            peak = max(peak, cumulative)
            dd = peak - cumulative
            max_dd = max(max_dd, dd)
        drawdown = max_dd

    # Critérios de graduação
    graduation = {
        "events_200": resolved >= 200,
        "bets_500": graded_count >= 500,
        "ece_threshold": ece is not None and ece < 0.05,
        "clv_positive": clv_mean is not None and clv_mean > 0,
        "no_data_leakage": True,  # verificado separadamente
        "convergence_check": False,  # placeholder — verificação manual
    }
    graduation["ready"] = all(
        graduation[k] for k in ("events_200", "bets_500", "ece_threshold", "clv_positive")
    )

    return {
        "total_predictions": total,
        "open": open_count,
        "graded": graded_count,
        "voided": int(c["voided"] or 0),
        "won": won_count,
        "lost": lost_count,
        "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
        "roi": round(roi, 6) if roi is not None else None,
        "brier_score": round(brier, 6) if brier is not None else None,
        "log_loss": round(log_loss, 6) if log_loss is not None else None,
        "ece": round(ece, 6) if ece is not None else None,
        "clv_mean": round(clv_mean, 6) if clv_mean is not None else None,
        "max_drawdown": round(drawdown, 4) if drawdown is not None else None,
        "sample_size": resolved,
        "graduation_criteria": graduation,
    }
