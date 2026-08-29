"""Agregações e métricas do Shadow Mode — análise por dimensão e calibração.

Todas as funções recebem AsyncSession e retornam dados estruturados.
Métricas computadas em SQL sempre que possível; ECE e curva de equidade
calculados em Python após fetch.

Dimensões de agrupamento:
    - league, market, model, period (semanal)
    - odds_range, edge_range, ev_range, prediq_range (faixas discretizadas)
"""
from __future__ import annotations

import math
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════
# Helpers de filtragem SQL
# ═══════════════════════════════════════════════════════════════════════════

def _build_where_clause(filters: dict | None) -> tuple[str, dict]:
    """Constrói cláusula WHERE a partir de filtros opcionais.

    Filtros suportados: league, market, sport, status, min_date, max_date.
    """
    conditions = ["TRUE"]
    params: dict[str, Any] = {}

    if not filters:
        return " AND ".join(conditions), params

    if filters.get("league"):
        conditions.append("sp.league = :league")
        params["league"] = filters["league"]
    if filters.get("market"):
        conditions.append("sp.market = :market")
        params["market"] = filters["market"]
    if filters.get("sport"):
        conditions.append("sp.sport = :sport")
        params["sport"] = filters["sport"]
    if filters.get("status"):
        conditions.append("sp.status = :status")
        params["status"] = filters["status"]
    if filters.get("min_date"):
        conditions.append("sp.generated_at >= :min_date")
        params["min_date"] = filters["min_date"]
    if filters.get("max_date"):
        conditions.append("sp.generated_at <= :max_date")
        params["max_date"] = filters["max_date"]

    return " AND ".join(conditions), params


# ═══════════════════════════════════════════════════════════════════════════
# Expressões SQL de agrupamento por faixa
# ═══════════════════════════════════════════════════════════════════════════

# CASE WHEN para discretizar valores contínuos em faixas legíveis
_RANGE_EXPRESSIONS = {
    "odds_range": """
        CASE
            WHEN best_odds < 1.50 THEN '<1.50'
            WHEN best_odds < 2.00 THEN '1.50-2.00'
            WHEN best_odds < 3.00 THEN '2.00-3.00'
            WHEN best_odds < 5.00 THEN '3.00-5.00'
            ELSE '>5.00'
        END
    """,
    "edge_range": """
        CASE
            WHEN edge < 0.03 THEN '2-3%'
            WHEN edge < 0.05 THEN '3-5%'
            WHEN edge < 0.08 THEN '5-8%'
            WHEN edge < 0.12 THEN '8-12%'
            ELSE '>12%'
        END
    """,
    "ev_range": """
        CASE
            WHEN ev < 0.02 THEN '<2%'
            WHEN ev < 0.05 THEN '2-5%'
            WHEN ev < 0.10 THEN '5-10%'
            ELSE '>10%'
        END
    """,
    "prediq_range": """
        CASE
            WHEN prediq_score < 30  THEN '0-30'
            WHEN prediq_score < 50  THEN '30-50'
            WHEN prediq_score < 70  THEN '50-70'
            WHEN prediq_score < 85  THEN '70-85'
            ELSE '85-100'
        END
    """,
}

# Colunas diretas de agrupamento (não precisam de CASE)
_DIRECT_GROUP_COLUMNS = {
    "league": "sp.league",
    "market": "sp.market",
    "model": "sp.model_version",
    "period": "date_trunc('week', sp.generated_at)",
}


def _resolve_group_expression(group_by: str) -> str:
    """Retorna a expressão SQL para agrupamento.

    Suporta tanto colunas diretas (league, market, model, period) quanto
    faixas discretizadas (odds_range, edge_range, ev_range, prediq_range).
    """
    if group_by in _DIRECT_GROUP_COLUMNS:
        return _DIRECT_GROUP_COLUMNS[group_by]
    if group_by in _RANGE_EXPRESSIONS:
        return _RANGE_EXPRESSIONS[group_by]
    raise ValueError(f"group_by inválido: '{group_by}'. Valores aceitos: "
                     f"{list(_DIRECT_GROUP_COLUMNS) + list(_RANGE_EXPRESSIONS)}")


# ═══════════════════════════════════════════════════════════════════════════
# Agregação genérica
# ═══════════════════════════════════════════════════════════════════════════

async def aggregate_shadow_metrics(
    db: AsyncSession,
    *,
    group_by: str,
    filters: dict | None = None,
) -> list[dict]:
    """Agrega métricas do shadow mode por dimensão.

    Para cada grupo retorna: key, sample_size, hit_rate, brier_score,
    log_loss, ece, clv_mean, roi_theoretical, max_drawdown.

    ECE e max_drawdown são calculados em Python pós-fetch (requerem
    lógica de binning/acumulação que não é prática em SQL puro).

    Args:
        db: Sessão async SQLAlchemy.
        group_by: Dimensão de agrupamento. Valores aceitos:
            league, market, model, period,
            odds_range, edge_range, ev_range, prediq_range.
        filters: Filtros opcionais (league, market, sport, status, min_date, max_date).

    Returns:
        Lista de dicts, um por grupo, com métricas computadas.
    """
    group_expr = _resolve_group_expression(group_by)
    where_clause, params = _build_where_clause(filters)

    # Métricas principais computadas em SQL
    query = text(f"""
        SELECT
            {group_expr}::text AS grp_key,

            -- Contagens
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE sp.result IN ('won', 'lost'))       AS resolved,
            COUNT(*) FILTER (WHERE sp.result = 'won')                  AS won,

            -- Brier (computado em SQL para eficiência)
            AVG(
                POWER(sp.model_probability -
                      CASE WHEN sp.result = 'won' THEN 1 ELSE 0 END, 2)
            ) FILTER (WHERE sp.result IN ('won', 'lost'))              AS brier,

            -- CLV
            AVG(sp.clv)  FILTER (WHERE sp.clv IS NOT NULL)            AS clv_mean,

            -- ROI teórico
            SUM(sp.theoretical_return)
                FILTER (WHERE sp.status = 'graded')                    AS total_return,
            COUNT(*) FILTER (WHERE sp.status = 'graded')               AS graded_count

        FROM shadow_predictions sp
        WHERE {where_clause}
        GROUP BY grp_key
        ORDER BY grp_key
    """)

    result = await db.execute(query, params)
    sql_rows = result.mappings().all()

    if not sql_rows:
        return []

    # Para ECE e drawdown, precisamos dos dados brutos por grupo
    # Fazemos uma segunda query só se houver dados graded suficientes
    raw_query = text(f"""
        SELECT
            {group_expr}::text AS grp_key,
            sp.model_probability,
            sp.result,
            sp.theoretical_return
        FROM shadow_predictions sp
        WHERE {where_clause}
          AND sp.result IN ('won', 'lost')
        ORDER BY {group_expr}::text, sp.graded_at ASC
    """)
    raw_result = await db.execute(raw_query, params)
    raw_rows = raw_result.mappings().all()

    # Agrupar dados brutos por chave
    raw_by_group: dict[str, list[dict]] = {}
    for r in raw_rows:
        key = r["grp_key"]
        raw_by_group.setdefault(key, []).append(dict(r))

    groups: list[dict] = []
    for row in sql_rows:
        key = row["grp_key"]
        resolved = int(row["resolved"] or 0)
        won = int(row["won"] or 0)
        graded_count = int(row["graded_count"] or 0)
        total_return = float(row["total_return"]) if row["total_return"] is not None else 0.0

        hit_rate = won / resolved if resolved > 0 else None
        brier = float(row["brier"]) if row["brier"] is not None else None
        clv_mean = float(row["clv_mean"]) if row["clv_mean"] is not None else None
        roi = total_return / graded_count if graded_count > 0 else None

        # Log Loss (calculado em Python — log não é trivial em SQL para agregação condicional)
        log_loss = None
        ece = None
        max_drawdown = None

        group_raw = raw_by_group.get(key, [])

        if len(group_raw) >= 10:
            eps = 1e-15
            ll_sum = 0.0
            for r in group_raw:
                p = max(eps, min(1 - eps, float(r["model_probability"])))
                o = 1 if r["result"] == "won" else 0
                ll_sum += -(o * math.log(p) + (1 - o) * math.log(1 - p))
            log_loss = ll_sum / len(group_raw)

        # ECE (10 bins)
        if len(group_raw) >= 30:
            n_bins = 10
            bins: dict[int, list[tuple[float, int]]] = {i: [] for i in range(n_bins)}
            for r in group_raw:
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
            ece = ece_sum / len(group_raw)

        # Max drawdown (flat staking)
        if len(group_raw) >= 5:
            cumulative = 0.0
            peak = 0.0
            max_dd = 0.0
            for r in group_raw:
                ret = float(r["theoretical_return"]) if r["theoretical_return"] is not None else 0.0
                cumulative += ret
                peak = max(peak, cumulative)
                max_dd = max(max_dd, peak - cumulative)
            max_drawdown = max_dd

        groups.append({
            "key": key,
            "sample_size": resolved,
            "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
            "brier_score": round(brier, 6) if brier is not None else None,
            "log_loss": round(log_loss, 6) if log_loss is not None else None,
            "ece": round(ece, 6) if ece is not None else None,
            "clv_mean": round(clv_mean, 6) if clv_mean is not None else None,
            "roi_theoretical": round(roi, 6) if roi is not None else None,
            "max_drawdown": round(max_drawdown, 4) if max_drawdown is not None else None,
        })

    return groups


# ═══════════════════════════════════════════════════════════════════════════
# Curva de calibração (reliability diagram)
# ═══════════════════════════════════════════════════════════════════════════

async def get_calibration_data(
    db: AsyncSession,
    *,
    n_bins: int = 10,
    filters: dict | None = None,
) -> dict:
    """Retorna dados para reliability curve (diagrama de calibração).

    Para cada bin: centro, probabilidade média predita, frequência observada,
    contagem. Também retorna ECE e MCE globais.

    Args:
        db: Sessão async.
        n_bins: Número de bins (default 10).
        filters: Filtros opcionais.

    Returns:
        Dict com 'bins' (lista), 'ece', 'mce', 'n_predictions'.
    """
    where_clause, params = _build_where_clause(filters)

    result = await db.execute(text(f"""
        SELECT
            sp.model_probability,
            sp.result
        FROM shadow_predictions sp
        WHERE {where_clause}
          AND sp.result IN ('won', 'lost')
        ORDER BY sp.model_probability
    """), params)
    rows = result.mappings().all()

    n = len(rows)
    if n == 0:
        return {"bins": [], "ece": None, "mce": None, "n_predictions": 0}

    # Binning
    bin_data: dict[int, list[tuple[float, int]]] = {i: [] for i in range(n_bins)}
    for r in rows:
        p = float(r["model_probability"])
        o = 1 if r["result"] == "won" else 0
        idx = min(int(p * n_bins), n_bins - 1)
        bin_data[idx].append((p, o))

    bins_out = []
    ece_sum = 0.0
    mce = 0.0

    for i in range(n_bins):
        entries = bin_data[i]
        bin_center = (i + 0.5) / n_bins

        if not entries:
            bins_out.append({
                "bin_center": round(bin_center, 4),
                "mean_predicted": None,
                "mean_observed": None,
                "count": 0,
            })
            continue

        mean_pred = sum(x[0] for x in entries) / len(entries)
        mean_obs = sum(x[1] for x in entries) / len(entries)
        gap = abs(mean_pred - mean_obs)

        ece_sum += len(entries) * gap
        mce = max(mce, gap)

        bins_out.append({
            "bin_center": round(bin_center, 4),
            "mean_predicted": round(mean_pred, 6),
            "mean_observed": round(mean_obs, 6),
            "count": len(entries),
        })

    ece = ece_sum / n

    return {
        "bins": bins_out,
        "ece": round(ece, 6),
        "mce": round(mce, 6),
        "n_predictions": n,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Curva de equidade (equity curve)
# ═══════════════════════════════════════════════════════════════════════════

async def get_equity_curve(
    db: AsyncSession,
    *,
    stake_fraction: float = 0.01,
) -> dict:
    """Simula evolução do bankroll com flat staking no shadow mode.

    Percorre previsões gradeadas em ordem cronológica, aplica flat staking
    (stake_fraction do bankroll inicial), e rastreia a curva de equidade.

    Args:
        db: Sessão async.
        stake_fraction: Fração do bankroll por aposta (default 1%).

    Returns:
        Dict com 'curve' (lista de pontos), 'max_drawdown', 'final_bankroll',
        'total_bets'.
    """
    result = await db.execute(text("""
        SELECT
            sp.graded_at::date AS bet_date,
            sp.result,
            sp.best_odds,
            sp.theoretical_return
        FROM shadow_predictions sp
        WHERE sp.status = 'graded'
          AND sp.result IN ('won', 'lost')
        ORDER BY sp.graded_at ASC
    """))
    rows = result.mappings().all()

    if not rows:
        return {
            "curve": [],
            "max_drawdown": 0.0,
            "final_bankroll": 1000.0,
            "total_bets": 0,
        }

    initial = 1000.0
    stake = initial * stake_fraction
    bankroll = initial
    peak = initial
    max_dd = 0.0
    curve = []
    total_bets = 0

    # Agrupar por dia para suavizar a curva
    daily: dict[str, float] = {}
    for r in rows:
        day = str(r["bet_date"])
        ret = float(r["theoretical_return"]) if r["theoretical_return"] is not None else 0.0
        daily.setdefault(day, 0.0)
        daily[day] += ret * stake
        total_bets += 1

    for day, pnl in daily.items():
        bankroll += pnl
        peak = max(peak, bankroll)
        dd = (peak - bankroll) / peak if peak > 0 else 0.0
        max_dd = max(max_dd, dd)

        curve.append({
            "date": day,
            "bankroll": round(bankroll, 2),
            "cumulative_bets": total_bets,  # total, não diário — simplificação
        })

    return {
        "curve": curve,
        "max_drawdown": round(max_dd, 6),
        "final_bankroll": round(bankroll, 2),
        "total_bets": total_bets,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Critérios de graduação
# ═══════════════════════════════════════════════════════════════════════════

async def get_graduation_status(db: AsyncSession) -> dict:
    """Verifica todos os critérios para sair do Shadow Mode.

    Critérios:
        1. events >= 200 para avaliação probabilística confiável
        2. bets >= 500 para avaliação de ROI
        3. ECE < 0.05 em pelo menos 3 ligas
        4. CLV médio positivo (modelo captura valor genuíno)
        5. Sem data leakage (nenhuma previsão modificada após kickoff)
        6. Convergência Python/TS (placeholder — verificação manual)

    Returns:
        Dict com status de cada critério e flag 'ready'.
    """
    # 1. Contagens gerais
    counts = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE result IN ('won', 'lost')) AS resolved,
            COUNT(*) FILTER (WHERE status = 'graded')        AS graded,
            AVG(clv) FILTER (WHERE clv IS NOT NULL)          AS clv_mean
        FROM shadow_predictions
    """))
    c = counts.mappings().first()
    resolved = int(c["resolved"] or 0)
    graded = int(c["graded"] or 0)
    clv_mean = float(c["clv_mean"]) if c["clv_mean"] is not None else None

    # 2. ECE por liga (para verificar se >= 3 ligas têm ECE < 0.05)
    league_ece_count = 0
    league_eces: dict[str, float] = {}

    leagues_result = await db.execute(text("""
        SELECT DISTINCT league FROM shadow_predictions
        WHERE result IN ('won', 'lost')
        GROUP BY league
        HAVING COUNT(*) >= 30
    """))
    leagues = [r[0] for r in leagues_result.fetchall()]

    for league in leagues:
        rows = await db.execute(text("""
            SELECT model_probability, result
            FROM shadow_predictions
            WHERE league = :league AND result IN ('won', 'lost')
        """), {"league": league})
        preds = rows.mappings().all()

        if len(preds) < 30:
            continue

        # Calcular ECE
        n_bins = 10
        bins: dict[int, list[tuple[float, int]]] = {i: [] for i in range(n_bins)}
        for r in preds:
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

        ece = ece_sum / len(preds)
        league_eces[league] = round(ece, 6)
        if ece < 0.05:
            league_ece_count += 1

    # 3. Data leakage check — previsões com generated_at > kickoff_at
    leakage = await db.execute(text("""
        SELECT COUNT(*) AS leak_count
        FROM shadow_predictions
        WHERE generated_at > kickoff_at
    """))
    leak_count = int(leakage.scalar() or 0)

    # Montar resultado
    criteria = {
        "events_200": {
            "met": resolved >= 200,
            "current": resolved,
            "required": 200,
            "description": "Eventos resolvidos >= 200 para avaliação probabilística",
        },
        "bets_500": {
            "met": graded >= 500,
            "current": graded,
            "required": 500,
            "description": "Apostas gradeadas >= 500 para avaliação de ROI",
        },
        "ece_3_leagues": {
            "met": league_ece_count >= 3,
            "current": league_ece_count,
            "required": 3,
            "description": "ECE < 0.05 em pelo menos 3 ligas",
            "league_eces": league_eces,
        },
        "clv_positive": {
            "met": clv_mean is not None and clv_mean > 0,
            "current": round(clv_mean, 6) if clv_mean is not None else None,
            "required": "> 0",
            "description": "CLV médio positivo (modelo captura valor genuíno)",
        },
        "no_data_leakage": {
            "met": leak_count == 0,
            "current": leak_count,
            "required": 0,
            "description": "Nenhuma previsão gerada após kickoff (sem data leakage)",
        },
        "convergence_check": {
            "met": False,
            "current": None,
            "required": "manual",
            "description": "Convergência Python/TS verificada manualmente",
        },
    }

    all_auto_met = all(
        criteria[k]["met"]
        for k in ("events_200", "bets_500", "ece_3_leagues", "clv_positive", "no_data_leakage")
    )

    return {
        "criteria": criteria,
        "auto_criteria_met": all_auto_met,
        "ready": all_auto_met and criteria["convergence_check"]["met"],
        "summary": (
            "Todos os critérios automáticos atendidos. Verificar convergência manual."
            if all_auto_met
            else f"Critérios pendentes: {[k for k, v in criteria.items() if not v['met']]}"
        ),
    }
