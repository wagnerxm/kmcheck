"""Geração de relatório diário do Shadow Mode.

Produz um relatório em Markdown com:
    1. Previsões geradas no dia
    2. Oportunidades selecionadas (edge > threshold), por liga
    3. Resultados finalizados (gradeados no dia)
    4. Métricas acumuladas (Brier, Log Loss, ECE, CLV, ROI, drawdown)
    5. Alertas de inconsistência
    6. Progresso nos critérios de graduação
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shadow.engine import MODEL_VERSION, MIN_EDGE_THRESHOLD

logger = logging.getLogger(__name__)


async def generate_daily_report(
    db: AsyncSession,
    *,
    report_date: datetime | None = None,
) -> str:
    """Gera relatório diário do Shadow Mode em Markdown.

    Args:
        db: Sessão async.
        report_date: Data do relatório (default: hoje UTC).

    Returns:
        String com o relatório completo em Markdown.
    """
    today = report_date or datetime.now(timezone.utc)
    day_start = today.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    lines: list[str] = []

    # ── Header ──────────────────────────────────────────────────────────
    lines.append(f"# Relatório Shadow Mode — {day_start.strftime('%Y-%m-%d')}")
    lines.append(f"Pipeline: `{MODEL_VERSION}` | Edge threshold: {MIN_EDGE_THRESHOLD * 100:.0f}%")
    lines.append(f"Gerado em: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")

    # ── 1. Previsões geradas ────────────────────────────────────────────
    lines.append("## 1. Previsões Geradas")

    gen_result = await db.execute(text("""
        SELECT
            COUNT(*)                             AS total,
            COUNT(DISTINCT event_id)             AS events,
            COUNT(DISTINCT league)               AS leagues,
            AVG(edge)                            AS avg_edge,
            AVG(ev)                              AS avg_ev,
            AVG(prediq_score)                    AS avg_score
        FROM shadow_predictions
        WHERE generated_at >= :start AND generated_at < :end_dt
    """), {"start": day_start, "end_dt": day_end})
    gen = gen_result.mappings().first()

    total_gen = int(gen["total"])
    if total_gen == 0:
        lines.append("Nenhuma previsão gerada neste dia.")
        lines.append("")
    else:
        lines.append(f"- **Total**: {total_gen} previsões")
        lines.append(f"- **Eventos**: {gen['events']}")
        lines.append(f"- **Ligas**: {gen['leagues']}")
        lines.append(f"- **Edge médio**: {float(gen['avg_edge'] or 0) * 100:.2f}%")
        lines.append(f"- **EV médio**: {float(gen['avg_ev'] or 0) * 100:.2f}%")
        lines.append(f"- **PREDIQ Score médio**: {float(gen['avg_score'] or 0):.1f}")
        lines.append("")

    # ── 2. Oportunidades selecionadas por liga ──────────────────────────
    lines.append("## 2. Oportunidades por Liga")

    opps = await db.execute(text("""
        SELECT
            league,
            COUNT(*)       AS cnt,
            AVG(edge)      AS avg_edge,
            AVG(best_odds) AS avg_odds,
            AVG(prediq_score) AS avg_score
        FROM shadow_predictions
        WHERE generated_at >= :start AND generated_at < :end_dt
        GROUP BY league
        ORDER BY cnt DESC
    """), {"start": day_start, "end_dt": day_end})
    opp_rows = opps.mappings().all()

    if not opp_rows:
        lines.append("Nenhuma oportunidade registrada.")
    else:
        lines.append("| Liga | Qtd | Edge Médio | Odds Média | Score Médio |")
        lines.append("|------|-----|-----------|-----------|------------|")
        for r in opp_rows:
            avg_e = float(r["avg_edge"] or 0) * 100
            avg_o = float(r["avg_odds"] or 0)
            avg_s = float(r["avg_score"] or 0)
            lines.append(f"| {r['league']} | {r['cnt']} | {avg_e:.2f}% | {avg_o:.2f} | {avg_s:.1f} |")
    lines.append("")

    # ── 3. Resultados finalizados ───────────────────────────────────────
    lines.append("## 3. Resultados Finalizados")

    graded = await db.execute(text("""
        SELECT
            COUNT(*)                                     AS total,
            COUNT(*) FILTER (WHERE result = 'won')       AS won,
            COUNT(*) FILTER (WHERE result = 'lost')      AS lost,
            COUNT(*) FILTER (WHERE result = 'void')      AS voided,
            SUM(theoretical_return)                       AS total_return,
            AVG(clv) FILTER (WHERE clv IS NOT NULL)      AS avg_clv
        FROM shadow_predictions
        WHERE graded_at >= :start AND graded_at < :end_dt
    """), {"start": day_start, "end_dt": day_end})
    g = graded.mappings().first()

    graded_total = int(g["total"])
    if graded_total == 0:
        lines.append("Nenhum resultado finalizado neste dia.")
    else:
        won = int(g["won"] or 0)
        lost = int(g["lost"] or 0)
        resolved = won + lost
        hr = won / resolved * 100 if resolved > 0 else 0
        total_ret = float(g["total_return"] or 0)
        avg_clv = float(g["avg_clv"]) if g["avg_clv"] is not None else None

        lines.append(f"- **Gradeados**: {graded_total} ({won}W / {lost}L / {int(g['voided'] or 0)}V)")
        lines.append(f"- **Hit rate**: {hr:.1f}%")
        lines.append(f"- **Retorno teórico**: {total_ret:+.2f} unidades")
        if avg_clv is not None:
            lines.append(f"- **CLV médio**: {avg_clv * 100:+.3f}%")
    lines.append("")

    # ── 4. Métricas acumuladas ──────────────────────────────────────────
    lines.append("## 4. Métricas Acumuladas (all-time)")

    cumul = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE result IN ('won', 'lost')) AS resolved,
            COUNT(*) FILTER (WHERE result = 'won')            AS won,
            COUNT(*) FILTER (WHERE status = 'graded')         AS graded,
            SUM(theoretical_return)
                FILTER (WHERE status = 'graded')              AS total_return,
            AVG(clv) FILTER (WHERE clv IS NOT NULL)           AS clv_mean,
            AVG(POWER(model_probability -
                CASE WHEN result = 'won' THEN 1 ELSE 0 END, 2))
                FILTER (WHERE result IN ('won', 'lost'))      AS brier
        FROM shadow_predictions
    """))
    cum = cumul.mappings().first()

    cum_resolved = int(cum["resolved"] or 0)
    cum_won = int(cum["won"] or 0)
    cum_graded = int(cum["graded"] or 0)
    cum_return = float(cum["total_return"]) if cum["total_return"] is not None else 0.0
    cum_clv = float(cum["clv_mean"]) if cum["clv_mean"] is not None else None
    cum_brier = float(cum["brier"]) if cum["brier"] is not None else None

    cum_hr = cum_won / cum_resolved * 100 if cum_resolved > 0 else 0
    cum_roi = cum_return / cum_graded * 100 if cum_graded > 0 else 0

    lines.append(f"- **Previsões resolvidas**: {cum_resolved}")
    lines.append(f"- **Hit rate**: {cum_hr:.1f}%")
    lines.append(f"- **ROI teórico**: {cum_roi:+.2f}%")
    if cum_brier is not None:
        lines.append(f"- **Brier Score**: {cum_brier:.6f}")
    if cum_clv is not None:
        lines.append(f"- **CLV médio**: {cum_clv * 100:+.4f}%")

    # Log Loss acumulado
    if cum_resolved >= 30:
        ll_result = await db.execute(text("""
            SELECT model_probability, result
            FROM shadow_predictions
            WHERE result IN ('won', 'lost')
        """))
        ll_rows = ll_result.mappings().all()
        eps = 1e-15
        ll_sum = 0.0
        for r in ll_rows:
            p = max(eps, min(1 - eps, float(r["model_probability"])))
            o = 1 if r["result"] == "won" else 0
            ll_sum += -(o * math.log(p) + (1 - o) * math.log(1 - p))
        log_loss = ll_sum / len(ll_rows) if ll_rows else None
        if log_loss is not None:
            lines.append(f"- **Log Loss**: {log_loss:.6f}")

    # Drawdown acumulado
    if cum_graded >= 10:
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
            max_dd = max(max_dd, peak - cumulative)
        lines.append(f"- **Max drawdown**: {max_dd:.2f} unidades")

    lines.append("")

    # ── 5. Alertas de inconsistência ────────────────────────────────────
    lines.append("## 5. Alertas de Inconsistência")

    alerts: list[str] = []

    # Previsões geradas após kickoff (data leakage)
    leakage = await db.execute(text("""
        SELECT COUNT(*) FROM shadow_predictions
        WHERE generated_at > kickoff_at
    """))
    leak_count = int(leakage.scalar() or 0)
    if leak_count > 0:
        alerts.append(f"CRITICO: {leak_count} previsões geradas APÓS o kickoff (data leakage)")

    # Previsões modificadas após grading (imutabilidade violada)
    # Não temos campo de updated_at, mas podemos checar anomalias
    # como previsões gradeadas com generated_at > graded_at
    anomaly = await db.execute(text("""
        SELECT COUNT(*) FROM shadow_predictions
        WHERE graded_at IS NOT NULL
          AND generated_at > graded_at
    """))
    anomaly_count = int(anomaly.scalar() or 0)
    if anomaly_count > 0:
        alerts.append(f"ALERTA: {anomaly_count} previsões com generated_at > graded_at")

    # Edge extremo (possível erro de modelo)
    extreme = await db.execute(text("""
        SELECT COUNT(*) FROM shadow_predictions
        WHERE edge > 0.30
          AND generated_at >= :start AND generated_at < :end_dt
    """), {"start": day_start, "end_dt": day_end})
    extreme_count = int(extreme.scalar() or 0)
    if extreme_count > 0:
        alerts.append(f"AVISO: {extreme_count} previsões com edge > 30% (possível erro de modelo)")

    if not alerts:
        lines.append("Nenhum alerta de inconsistência detectado.")
    else:
        for a in alerts:
            lines.append(f"- {a}")
    lines.append("")

    # ── 6. Critérios de graduação ───────────────────────────────────────
    lines.append("## 6. Critérios de Graduação")

    # Reutilizar contagens já calculadas
    criteria = [
        ("Eventos >= 200", cum_resolved >= 200, f"{cum_resolved}/200"),
        ("Apostas >= 500", cum_graded >= 500, f"{cum_graded}/500"),
        ("CLV positivo", cum_clv is not None and cum_clv > 0,
         f"{cum_clv * 100:+.4f}%" if cum_clv is not None else "N/A"),
        ("Sem data leakage", leak_count == 0, f"{leak_count} violações"),
        ("Convergência Py/TS", False, "verificação manual"),
    ]

    # ECE por liga
    ece_leagues = await db.execute(text("""
        SELECT league, COUNT(*) AS n
        FROM shadow_predictions
        WHERE result IN ('won', 'lost')
        GROUP BY league
        HAVING COUNT(*) >= 30
    """))
    ece_league_rows = ece_leagues.mappings().all()
    ece_pass_count = 0
    for lr in ece_league_rows:
        lg_preds = await db.execute(text("""
            SELECT model_probability, result
            FROM shadow_predictions
            WHERE league = :league AND result IN ('won', 'lost')
        """), {"league": lr["league"]})
        lg_rows = lg_preds.mappings().all()
        if len(lg_rows) < 30:
            continue

        n_bins = 10
        bins: dict[int, list[tuple[float, int]]] = {i: [] for i in range(n_bins)}
        for r in lg_rows:
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
        ece = ece_sum / len(lg_rows)
        if ece < 0.05:
            ece_pass_count += 1

    criteria.insert(2, ("ECE < 0.05 em >= 3 ligas", ece_pass_count >= 3, f"{ece_pass_count} ligas"))

    lines.append("| Critério | Status | Valor |")
    lines.append("|----------|--------|-------|")
    for name, met, value in criteria:
        status_icon = "OK" if met else "PENDENTE"
        lines.append(f"| {name} | {status_icon} | {value} |")
    lines.append("")

    all_auto = all(c[1] for c in criteria[:-1])  # excluir convergência manual
    if all_auto:
        lines.append("**Todos os critérios automáticos atendidos.**")
    else:
        pending = [c[0] for c in criteria if not c[1]]
        lines.append(f"**Critérios pendentes**: {', '.join(pending)}")

    lines.append("")
    lines.append("---")
    lines.append(f"*Relatório gerado automaticamente pelo Shadow Mode v1.*")

    return "\n".join(lines)
