"""Agregações e métricas do Shadow Mode — análise por dimensão e calibração.

Todas as funções recebem AsyncSession e retornam dados estruturados.
Métricas computadas em SQL sempre que possível; ECE e curva de equidade
calculados em Python após fetch.

Dimensões de agrupamento:
    - league, market, model, period (semanal), country, outcome,
      bookmaker, ensemble_version
    - odds_range, edge_range, ev_range, prediq_range, score_range
      (faixas discretizadas)

Endurecimento (hardening) v1:
    - Métricas de staking (hit_rate, roi_theoretical, max_drawdown) usam
      SOMENTE previsões marcadas como `is_shadow_selection = TRUE` — ou
      seja, apenas as apostas que o sistema realmente "selecionaria" em
      produção, e não todo o universo de previsões geradas.
    - Métricas de calibração (brier_score, log_loss, ece) continuam
      usando TODAS as previsões gradeadas/resolvidas, selecionadas ou
      não, pois o objetivo ali é medir a qualidade probabilística do
      modelo como um todo.
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
# Constantes de graduação (critérios para sair do Shadow Mode)
# ═══════════════════════════════════════════════════════════════════════════

GRADUATION_MIN_EVENTS = 200
GRADUATION_MIN_SELECTIONS = 500
GRADUATION_ECE_THRESHOLD = 0.05
GRADUATION_MIN_ECE_LEAGUES = 3
GRADUATION_MIN_LEAGUE_SAMPLES = 30
GRADUATION_POLICY_VERSION = "graduation-v1.0.0"

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
            WHEN best_odds < 1.30 THEN '<1.30'
            WHEN best_odds < 1.50 THEN '1.30-1.50'
            WHEN best_odds < 1.80 THEN '1.50-1.80'
            WHEN best_odds < 2.00 THEN '1.80-2.00'
            WHEN best_odds < 2.50 THEN '2.00-2.50'
            WHEN best_odds < 3.00 THEN '2.50-3.00'
            WHEN best_odds < 5.00 THEN '3.00-5.00'
            WHEN best_odds < 10.00 THEN '5.00-10.00'
            ELSE '>10.00'
        END
    """,
    "edge_range": """
        CASE
            WHEN edge < 0.02 THEN '<2%'
            WHEN edge < 0.03 THEN '2-3%'
            WHEN edge < 0.05 THEN '3-5%'
            WHEN edge < 0.08 THEN '5-8%'
            WHEN edge < 0.12 THEN '8-12%'
            WHEN edge < 0.20 THEN '12-20%'
            ELSE '>20%'
        END
    """,
    "ev_range": """
        CASE
            WHEN ev < 0.01 THEN '<1%'
            WHEN ev < 0.02 THEN '1-2%'
            WHEN ev < 0.05 THEN '2-5%'
            WHEN ev < 0.10 THEN '5-10%'
            WHEN ev < 0.20 THEN '10-20%'
            ELSE '>20%'
        END
    """,
    "prediq_range": """
        CASE
            WHEN prediq_score < 20  THEN '0-20'
            WHEN prediq_score < 40  THEN '20-40'
            WHEN prediq_score < 60  THEN '40-60'
            WHEN prediq_score < 75  THEN '60-75'
            WHEN prediq_score < 90  THEN '75-90'
            ELSE '90-100'
        END
    """,
    "score_range": """
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
    "country": "sp.league",  # TODO: extrair país da liga quando disponível
    "outcome": "sp.outcome",
    "bookmaker": "sp.bookmaker",
    "ensemble_version": "sp.ensemble_version",
}


def _resolve_group_expression(group_by: str) -> str:
    """Retorna a expressão SQL para agrupamento.

    Suporta tanto colunas diretas (league, market, model, period, country,
    outcome, bookmaker, ensemble_version) quanto faixas discretizadas
    (odds_range, edge_range, ev_range, prediq_range, score_range).
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

    Para cada grupo retorna: key, sample_size, selection_sample_size,
    hit_rate, brier_score, log_loss, ece, clv_price_mean,
    clv_probability_mean, roi_theoretical, max_drawdown.

    ECE e max_drawdown são calculados em Python pós-fetch (requerem
    lógica de binning/acumulação que não é prática em SQL puro).

    IMPORTANTE (hardening v1): hit_rate, roi_theoretical e max_drawdown
    usam SOMENTE previsões com `is_shadow_selection = TRUE` — as
    métricas de staking devem refletir apenas o que o sistema de fato
    "selecionaria" em produção, não todo o universo de previsões
    geradas em shadow. Já brier_score, log_loss e ece (calibração) usam
    TODAS as previsões resolvidas/gradeadas, selecionadas ou não.

    Args:
        db: Sessão async SQLAlchemy.
        group_by: Dimensão de agrupamento. Valores aceitos:
            league, market, model, period, country, outcome, bookmaker,
            ensemble_version, odds_range, edge_range, ev_range,
            prediq_range, score_range.
        filters: Filtros opcionais (league, market, sport, status, min_date, max_date).

    Returns:
        Lista de dicts, um por grupo, com métricas computadas.
    """
    group_expr = _resolve_group_expression(group_by)
    where_clause, params = _build_where_clause(filters)

    # Métricas de calibração (TODAS as previsões resolvidas/gradeadas,
    # independente de is_shadow_selection) computadas em SQL
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

            -- CLV dual: preço (odds) e probabilidade, em separado
            AVG(sp.clv_price)       FILTER (WHERE sp.clv_price IS NOT NULL)       AS clv_price_mean,
            AVG(sp.clv_probability) FILTER (WHERE sp.clv_probability IS NOT NULL) AS clv_probability_mean

        FROM shadow_predictions sp
        WHERE {where_clause}
        GROUP BY grp_key
        ORDER BY grp_key
    """)

    result = await db.execute(query, params)
    sql_rows = result.mappings().all()

    if not sql_rows:
        return []

    # Métricas de staking (hit_rate, ROI, drawdown): APENAS shadow selections.
    # Uma previsão gerada em shadow nem sempre é uma "seleção" (pode ter sido
    # descartada por edge insuficiente, filtro de risco, etc.) — só o que o
    # sistema selecionaria de fato deve entrar na conta de ROI/hit rate.
    selection_query = text(f"""
        SELECT
            {group_expr}::text AS grp_key,
            COUNT(*) FILTER (WHERE sp.result IN ('won', 'lost'))       AS sel_resolved,
            COUNT(*) FILTER (WHERE sp.result = 'won')                  AS sel_won,
            SUM(sp.theoretical_return)
                FILTER (WHERE sp.status = 'graded')                    AS sel_total_return,
            COUNT(*) FILTER (WHERE sp.status = 'graded')               AS sel_graded_count
        FROM shadow_predictions sp
        WHERE {where_clause}
          AND sp.is_shadow_selection = TRUE
        GROUP BY grp_key
    """)
    selection_result = await db.execute(selection_query, params)
    sel_by_group = {r["grp_key"]: dict(r) for r in selection_result.mappings().all()}

    # Para ECE e log loss, precisamos dos dados brutos por grupo (calibração:
    # todas as previsões resolvidas, selecionadas ou não)
    raw_query = text(f"""
        SELECT
            {group_expr}::text AS grp_key,
            sp.model_probability,
            sp.result
        FROM shadow_predictions sp
        WHERE {where_clause}
          AND sp.result IN ('won', 'lost')
        ORDER BY {group_expr}::text, sp.graded_at ASC
    """)
    raw_result = await db.execute(raw_query, params)
    raw_rows = raw_result.mappings().all()

    # Para max_drawdown, dados brutos por grupo — SOMENTE shadow selections,
    # em ordem cronológica de graduação (é uma simulação de bankroll)
    raw_selection_query = text(f"""
        SELECT
            {group_expr}::text AS grp_key,
            sp.theoretical_return
        FROM shadow_predictions sp
        WHERE {where_clause}
          AND sp.is_shadow_selection = TRUE
          AND sp.status = 'graded'
        ORDER BY {group_expr}::text, sp.graded_at ASC
    """)
    raw_selection_result = await db.execute(raw_selection_query, params)
    raw_selection_rows = raw_selection_result.mappings().all()

    # Agrupar dados brutos de calibração por chave
    raw_by_group: dict[str, list[dict]] = {}
    for r in raw_rows:
        key = r["grp_key"]
        raw_by_group.setdefault(key, []).append(dict(r))

    # Agrupar dados brutos de selections (staking) por chave
    raw_selection_by_group: dict[str, list[dict]] = {}
    for r in raw_selection_rows:
        key = r["grp_key"]
        raw_selection_by_group.setdefault(key, []).append(dict(r))

    groups: list[dict] = []
    for row in sql_rows:
        key = row["grp_key"]
        resolved = int(row["resolved"] or 0)
        brier = float(row["brier"]) if row["brier"] is not None else None
        clv_price_mean = float(row["clv_price_mean"]) if row["clv_price_mean"] is not None else None
        clv_probability_mean = (
            float(row["clv_probability_mean"]) if row["clv_probability_mean"] is not None else None
        )

        # Staking (hit_rate, ROI): vêm da query de selections, não da geral
        sel_row = sel_by_group.get(key)
        sel_resolved = int(sel_row["sel_resolved"] or 0) if sel_row else 0
        sel_won = int(sel_row["sel_won"] or 0) if sel_row else 0
        sel_graded_count = int(sel_row["sel_graded_count"] or 0) if sel_row else 0
        sel_total_return = (
            float(sel_row["sel_total_return"])
            if sel_row and sel_row["sel_total_return"] is not None
            else 0.0
        )

        hit_rate = sel_won / sel_resolved if sel_resolved > 0 else None
        roi = sel_total_return / sel_graded_count if sel_graded_count > 0 else None

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

        # ECE (10 bins) — calibração, usa todas as previsões resolvidas
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

        # Max drawdown (flat staking) — SOMENTE shadow selections
        group_sel_raw = raw_selection_by_group.get(key, [])
        if len(group_sel_raw) >= 5:
            cumulative = 0.0
            peak = 0.0
            max_dd = 0.0
            for r in group_sel_raw:
                ret = float(r["theoretical_return"]) if r["theoretical_return"] is not None else 0.0
                cumulative += ret
                peak = max(peak, cumulative)
                max_dd = max(max_dd, peak - cumulative)
            max_drawdown = max_dd

        groups.append({
            "key": key,
            "sample_size": resolved,
            "selection_sample_size": sel_resolved,
            "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
            "brier_score": round(brier, 6) if brier is not None else None,
            "log_loss": round(log_loss, 6) if log_loss is not None else None,
            "ece": round(ece, 6) if ece is not None else None,
            "clv_price_mean": round(clv_price_mean, 6) if clv_price_mean is not None else None,
            "clv_probability_mean": (
                round(clv_probability_mean, 6) if clv_probability_mean is not None else None
            ),
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

    Usa TODAS as previsões resolvidas (calibração não depende de
    is_shadow_selection — queremos medir a qualidade probabilística do
    modelo como um todo, não só das apostas selecionadas).

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

    IMPORTANTE (hardening v1): usa SOMENTE previsões com
    `is_shadow_selection = TRUE` — a curva de equidade simula o bankroll
    de quem seguisse as seleções reais do sistema, não todo o universo
    de previsões geradas em shadow.

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
        WHERE sp.is_shadow_selection = TRUE
          AND sp.status = 'graded'
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
        1. events >= GRADUATION_MIN_EVENTS para avaliação probabilística confiável
        2. selections gradeadas >= GRADUATION_MIN_SELECTIONS para avaliação de ROI
           (apenas is_shadow_selection = TRUE — o universo de apostas que o
           sistema de fato selecionaria, não todas as previsões geradas)
        3. ECE < GRADUATION_ECE_THRESHOLD em pelo menos GRADUATION_MIN_ECE_LEAGUES ligas
        4. CLV médio positivo (modelo captura valor genuíno)
        5. Sem data leakage (nenhuma previsão modificada após kickoff)
        6. Convergência Python/TS (placeholder — verificação manual)

    Os limiares vêm das constantes no topo do módulo (GRADUATION_MIN_EVENTS,
    GRADUATION_MIN_SELECTIONS, GRADUATION_ECE_THRESHOLD,
    GRADUATION_MIN_ECE_LEAGUES, GRADUATION_MIN_LEAGUE_SAMPLES) para que a
    política de graduação fique centralizada e versionada
    (GRADUATION_POLICY_VERSION).

    Returns:
        Dict com status de cada critério, flag 'ready' e a versão da
        política de graduação aplicada.
    """
    # 1. Contagens gerais
    counts = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE result IN ('won', 'lost')) AS resolved,
            COUNT(*) FILTER (
                WHERE is_shadow_selection = TRUE AND status = 'graded'
            )                                                  AS graded_selections,
            AVG(clv) FILTER (WHERE clv IS NOT NULL)            AS clv_mean
        FROM shadow_predictions
    """))
    c = counts.mappings().first()
    resolved = int(c["resolved"] or 0)
    graded_selections = int(c["graded_selections"] or 0)
    clv_mean = float(c["clv_mean"]) if c["clv_mean"] is not None else None

    # 2. ECE por liga (para verificar se >= GRADUATION_MIN_ECE_LEAGUES ligas
    # têm ECE < GRADUATION_ECE_THRESHOLD)
    league_ece_count = 0
    league_eces: dict[str, float] = {}

    leagues_result = await db.execute(text("""
        SELECT DISTINCT league FROM shadow_predictions
        WHERE result IN ('won', 'lost')
        GROUP BY league
        HAVING COUNT(*) >= :min_samples
    """), {"min_samples": GRADUATION_MIN_LEAGUE_SAMPLES})
    leagues = [r[0] for r in leagues_result.fetchall()]

    for league in leagues:
        rows = await db.execute(text("""
            SELECT model_probability, result
            FROM shadow_predictions
            WHERE league = :league AND result IN ('won', 'lost')
        """), {"league": league})
        preds = rows.mappings().all()

        if len(preds) < GRADUATION_MIN_LEAGUE_SAMPLES:
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
        if ece < GRADUATION_ECE_THRESHOLD:
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
            "met": resolved >= GRADUATION_MIN_EVENTS,
            "current": resolved,
            "required": GRADUATION_MIN_EVENTS,
            "description": "Eventos resolvidos >= mínimo para avaliação probabilística",
        },
        "bets_500": {
            "met": graded_selections >= GRADUATION_MIN_SELECTIONS,
            "current": graded_selections,
            "required": GRADUATION_MIN_SELECTIONS,
            "description": (
                "Shadow selections gradeadas (is_shadow_selection = TRUE) >= "
                "mínimo para avaliação de ROI"
            ),
        },
        "ece_3_leagues": {
            "met": league_ece_count >= GRADUATION_MIN_ECE_LEAGUES,
            "current": league_ece_count,
            "required": GRADUATION_MIN_ECE_LEAGUES,
            "description": f"ECE < {GRADUATION_ECE_THRESHOLD} em pelo menos {GRADUATION_MIN_ECE_LEAGUES} ligas",
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
        "graduation_policy_version": GRADUATION_POLICY_VERSION,
        "summary": (
            "Todos os critérios automáticos atendidos. Verificar convergência manual."
            if all_auto_met
            else f"Critérios pendentes: {[k for k, v in criteria.items() if not v['met']]}"
        ),
    }
