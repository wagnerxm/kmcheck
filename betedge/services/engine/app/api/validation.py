"""Endpoints de validação quantitativa — métricas agregadas do pipeline.

Centraliza a consulta de métricas de validação do pipeline de predições,
incluindo Brier Score, Log Loss, Calibration Error, CLV, ROI, drawdown
e sample size. Todos os valores são DERIVADOS — nunca armazenados nas
tabelas de predições (append-only).

Endpoints:
    GET /summary          — resumo com todas as métricas agregadas
    GET /brier-decomposition — decomposição de Murphy (1973)
    GET /drawdown-series  — série temporal de drawdown por estratégia
    GET /clv-distribution — distribuição de CLV por faixa de edge
    GET /sample-sizes     — contagem de amostras por métrica/período
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.deps import DbSession

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════
# Schemas
# ═══════════════════════════════════════════════════════════════════════════

class ValidationSummary(BaseModel):
    """Resumo completo de validação do pipeline de predições."""
    period_start: datetime
    period_end: datetime
    total_predictions: int
    total_resolved: int  # eventos finalizados com grading
    total_pending: int   # eventos futuros sem grading

    # Métricas de calibração
    brier_score: float | None = None
    brier_skill_score: float | None = None  # BSS = 1 - BS/BS_ref
    log_loss: float | None = None
    ece: float | None = None  # Expected Calibration Error
    mce: float | None = None  # Maximum Calibration Error

    # Métricas de rentabilidade
    hit_rate: float | None = None
    roi_flat_pct: float | None = None
    roi_kelly_025_pct: float | None = None
    mean_clv_pct: float | None = None
    positive_clv_rate: float | None = None

    # Drawdown
    max_drawdown_flat_pct: float | None = None
    max_drawdown_kelly_025_pct: float | None = None

    # Sample sizes
    sample_brier: int = 0
    sample_clv: int = 0
    sample_roi: int = 0

    # Suficiência de amostra (pisos mínimos §6.7)
    brier_sufficient: bool = False  # >= 200
    clv_sufficient: bool = False    # >= 100
    roi_sufficient: bool = False    # >= 500

    # Aviso
    warnings: list[str] = Field(default_factory=list)


class BrierDecomposition(BaseModel):
    """Decomposição de Brier (Murphy 1973) em 3 componentes."""
    brier_score: float
    reliability: float = Field(description="Quão bem calibrado (menor = melhor)")
    resolution: float = Field(description="Poder discriminatório (maior = melhor)")
    uncertainty: float = Field(description="Variância intrínseca do fenômeno")
    brier_skill_score: float = Field(description="1 - BS/uncertainty")
    n_predictions: int
    n_bins: int


class DrawdownPoint(BaseModel):
    """Ponto na série temporal de drawdown."""
    date: datetime
    bankroll: float
    peak: float
    drawdown_pct: float


class DrawdownSeries(BaseModel):
    """Série de drawdown para uma estratégia de staking."""
    strategy: str
    initial_bankroll: float
    final_bankroll: float
    max_drawdown_pct: float
    max_drawdown_date: datetime | None = None
    recovery_date: datetime | None = None
    series: list[DrawdownPoint]


class CLVBucket(BaseModel):
    """Distribuição de CLV por faixa de edge."""
    edge_min: float
    edge_max: float
    count: int
    mean_clv_pct: float
    positive_rate: float
    avg_edge: float


class SampleSizeReport(BaseModel):
    """Contagem de amostras disponíveis por métrica."""
    metric: str
    current_count: int
    minimum_required: int
    sufficient: bool
    deficit: int = Field(description="Quantos faltam. 0 se suficiente.")


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@router.get(
    "/summary",
    response_model=ValidationSummary,
    summary="Resumo completo de validação do pipeline",
)
async def get_validation_summary(
    db: DbSession,
    model_version_id: UUID | None = Query(default=None),
    market: str | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
) -> ValidationSummary:
    """Calcula todas as métricas de validação a partir de predições resolvidas.

    O grading é DERIVADO via fn_outcome_won — nunca armazenado. Cada métrica
    é calculada apenas quando a amostra atinge o piso mínimo (§6.7 MODELING.md).
    """
    conditions = ["TRUE"]
    params: dict = {}

    if model_version_id:
        conditions.append("mp.model_version_id = :model_version_id")
        params["model_version_id"] = str(model_version_id)
    if market:
        conditions.append("m.code = :market")
        params["market"] = market
    if start_date:
        conditions.append("e.kickoff_at >= :start_date")
        params["start_date"] = start_date
    if end_date:
        conditions.append("e.kickoff_at <= :end_date")
        params["end_date"] = end_date

    where = " AND ".join(conditions)

    # Query principal: predições com grading derivado
    query = text(f"""
        SELECT
            mp.id AS prediction_id,
            mp.probability,
            mp.edge,
            mp.ev,
            e.kickoff_at,
            e.status AS event_status,
            e.home_score,
            e.away_score,
            m.code AS market_code,
            o.code AS outcome_code,
            o.line,
            od.decimal_odds AS best_odds,
            -- Grading derivado
            CASE WHEN e.status = 'finished' THEN
                fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score)
            END AS won,
            CASE WHEN e.status = 'finished' THEN
                POWER(
                    mp.probability - CASE WHEN fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) THEN 1 ELSE 0 END,
                    2
                )
            END AS brier_component
        FROM model_predictions mp
        JOIN events e ON e.id = mp.event_id
        JOIN markets m ON m.id = mp.market_id
        JOIN outcomes o ON o.id = mp.outcome_id
        LEFT JOIN odds od ON od.event_id = mp.event_id
            AND od.market_id = mp.market_id
            AND od.outcome_id = mp.outcome_id
        WHERE {where}
        ORDER BY e.kickoff_at
    """)

    try:
        result = await db.execute(query, params)
        rows = result.mappings().all()
    except Exception:
        return ValidationSummary(
            period_start=start_date or datetime(2020, 1, 1),
            period_end=end_date or datetime.utcnow(),
            total_predictions=0,
            total_resolved=0,
            total_pending=0,
            warnings=["Tabelas de predição ainda não populadas ou sem dados no período."],
        )

    if not rows:
        return ValidationSummary(
            period_start=start_date or datetime(2020, 1, 1),
            period_end=end_date or datetime.utcnow(),
            total_predictions=0,
            total_resolved=0,
            total_pending=0,
            warnings=["Nenhuma predição encontrada com os filtros fornecidos."],
        )

    # Separar resolvidos de pendentes
    resolved = [r for r in rows if r["event_status"] == "finished"]
    pending = [r for r in rows if r["event_status"] != "finished"]

    warnings: list[str] = []
    n_resolved = len(resolved)

    # ── Brier Score ──────────────────────────────────────────────────────
    brier = None
    bss = None
    if n_resolved >= 1:
        brier_components = [float(r["brier_component"]) for r in resolved if r["brier_component"] is not None]
        if brier_components:
            brier = sum(brier_components) / len(brier_components)
            # BSS = 1 - BS / BS_ref, onde BS_ref = base_rate * (1 - base_rate)
            wins = sum(1 for r in resolved if r["won"] is True)
            base_rate = wins / n_resolved if n_resolved > 0 else 0.5
            bs_ref = base_rate * (1 - base_rate)
            bss = 1 - brier / bs_ref if bs_ref > 0 else None

    if n_resolved < 200:
        warnings.append(f"Brier Score: {n_resolved} amostras (mínimo 200).")

    # ── Log Loss ─────────────────────────────────────────────────────────
    import math
    log_loss = None
    if n_resolved >= 200:
        eps = 1e-15
        log_components = []
        for r in resolved:
            p = max(eps, min(1 - eps, float(r["probability"])))
            outcome = 1 if r["won"] else 0
            log_components.append(-(outcome * math.log(p) + (1 - outcome) * math.log(1 - p)))
        log_loss = sum(log_components) / len(log_components) if log_components else None

    # ── ECE / MCE ────────────────────────────────────────────────────────
    ece = None
    mce = None
    if n_resolved >= 200:
        n_bins = 10
        bins: dict[int, list] = {i: [] for i in range(n_bins)}
        for r in resolved:
            p = float(r["probability"])
            bin_idx = min(int(p * n_bins), n_bins - 1)
            bins[bin_idx].append((p, 1 if r["won"] else 0))

        ece_sum = 0.0
        mce_val = 0.0
        for bin_list in bins.values():
            if not bin_list:
                continue
            avg_p = sum(x[0] for x in bin_list) / len(bin_list)
            avg_o = sum(x[1] for x in bin_list) / len(bin_list)
            gap = abs(avg_p - avg_o)
            ece_sum += len(bin_list) * gap
            mce_val = max(mce_val, gap)
        ece = ece_sum / n_resolved
        mce = mce_val

    # ── Hit rate ─────────────────────────────────────────────────────────
    hit_rate = None
    if n_resolved >= 30:
        wins = sum(1 for r in resolved if r["won"] is True)
        hit_rate = wins / n_resolved

    # ── ROI flat ─────────────────────────────────────────────────────────
    roi_flat = None
    if n_resolved >= 500:
        total_staked = n_resolved  # flat = 1 unidade por aposta
        total_return = sum(
            float(r["best_odds"]) if r["won"] else 0
            for r in resolved
            if r.get("best_odds")
        )
        roi_flat = ((total_return - total_staked) / total_staked * 100) if total_staked > 0 else None
    elif n_resolved < 500:
        warnings.append(f"ROI: {n_resolved} amostras (mínimo 500).")

    # ── CLV ──────────────────────────────────────────────────────────────
    # CLV requer odds de fechamento — por ora usa best_odds como proxy
    mean_clv = None
    positive_clv_rate = None
    clv_count = 0
    if n_resolved >= 100:
        clv_values = []
        for r in resolved:
            if r.get("best_odds") and r.get("edge"):
                # CLV simplificado: edge × 100
                clv_values.append(float(r["edge"]) * 100)
        clv_count = len(clv_values)
        if clv_count >= 100:
            mean_clv = sum(clv_values) / clv_count
            positive_clv_rate = sum(1 for v in clv_values if v > 0) / clv_count
    elif n_resolved < 100:
        warnings.append(f"CLV: {n_resolved} amostras (mínimo 100).")

    # ── Período ──────────────────────────────────────────────────────────
    kickoffs = [r["kickoff_at"] for r in rows if r["kickoff_at"]]
    period_start = min(kickoffs) if kickoffs else (start_date or datetime(2020, 1, 1))
    period_end = max(kickoffs) if kickoffs else (end_date or datetime.utcnow())

    return ValidationSummary(
        period_start=period_start,
        period_end=period_end,
        total_predictions=len(rows),
        total_resolved=n_resolved,
        total_pending=len(pending),
        brier_score=round(brier, 6) if brier is not None else None,
        brier_skill_score=round(bss, 6) if bss is not None else None,
        log_loss=round(log_loss, 6) if log_loss is not None else None,
        ece=round(ece, 6) if ece is not None else None,
        mce=round(mce, 6) if mce is not None else None,
        hit_rate=round(hit_rate, 4) if hit_rate is not None else None,
        roi_flat_pct=round(roi_flat, 2) if roi_flat is not None else None,
        mean_clv_pct=round(mean_clv, 4) if mean_clv is not None else None,
        positive_clv_rate=round(positive_clv_rate, 4) if positive_clv_rate is not None else None,
        sample_brier=n_resolved,
        sample_clv=clv_count,
        sample_roi=n_resolved,
        brier_sufficient=n_resolved >= 200,
        clv_sufficient=clv_count >= 100,
        roi_sufficient=n_resolved >= 500,
        warnings=warnings,
    )


@router.get(
    "/brier-decomposition",
    response_model=BrierDecomposition,
    summary="Decomposição de Brier (Murphy 1973)",
)
async def get_brier_decomposition(
    db: DbSession,
    model_version_id: UUID | None = Query(default=None),
    n_bins: int = Query(default=10, ge=5, le=50),
) -> BrierDecomposition:
    """Decompõe o Brier Score em reliability, resolution e uncertainty.

    Requer pelo menos 200 predições resolvidas (piso mínimo §6.7).
    """
    conditions = ["e.status = 'finished'"]
    params: dict = {"n_bins": n_bins}

    if model_version_id:
        conditions.append("mp.model_version_id = :model_version_id")
        params["model_version_id"] = str(model_version_id)

    where = " AND ".join(conditions)

    query = text(f"""
        SELECT
            mp.probability,
            fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) AS won
        FROM model_predictions mp
        JOIN events e ON e.id = mp.event_id
        JOIN markets m ON m.id = mp.market_id
        JOIN outcomes o ON o.id = mp.outcome_id
        WHERE {where}
          AND e.home_score IS NOT NULL
    """)

    try:
        result = await db.execute(query, params)
        rows = result.mappings().all()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao consultar predições: {exc}",
        )

    n = len(rows)
    if n < 200:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Amostra insuficiente: {n} predições resolvidas (mínimo 200).",
        )

    # Calcular decomposição
    probs = [float(r["probability"]) for r in rows]
    outcomes = [1 if r["won"] else 0 for r in rows]
    obar = sum(outcomes) / n  # taxa-base

    # Binning
    bins: dict[int, list] = {i: [] for i in range(n_bins)}
    for p, o in zip(probs, outcomes):
        bin_idx = min(int(p * n_bins), n_bins - 1)
        bins[bin_idx].append((p, o))

    reliability = 0.0
    resolution = 0.0
    for bin_list in bins.values():
        if not bin_list:
            continue
        nk = len(bin_list)
        fk = sum(x[0] for x in bin_list) / nk  # prob média predita
        ok = sum(x[1] for x in bin_list) / nk  # freq observada

        reliability += nk * (fk - ok) ** 2
        resolution += nk * (ok - obar) ** 2

    reliability /= n
    resolution /= n
    uncertainty = obar * (1 - obar)

    bs = reliability - resolution + uncertainty
    bss = 1 - bs / uncertainty if uncertainty > 0 else 0.0

    return BrierDecomposition(
        brier_score=round(bs, 6),
        reliability=round(reliability, 6),
        resolution=round(resolution, 6),
        uncertainty=round(uncertainty, 6),
        brier_skill_score=round(bss, 6),
        n_predictions=n,
        n_bins=n_bins,
    )


@router.get(
    "/drawdown-series",
    response_model=list[DrawdownSeries],
    summary="Série temporal de drawdown por estratégia",
)
async def get_drawdown_series(
    db: DbSession,
    model_version_id: UUID | None = Query(default=None),
    initial_bankroll: float = Query(default=1000.0, gt=0),
) -> list[DrawdownSeries]:
    """Simula a evolução do bankroll e calcula drawdown para flat e Kelly.

    Ordena predições resolvidas cronologicamente, simula apostas flat (1 un)
    e Kelly fracionário (κ=0.25), e retorna a série de drawdown de cada
    estratégia. Requer pelo menos 50 predições resolvidas.
    """
    conditions = ["e.status = 'finished'", "e.home_score IS NOT NULL"]
    params: dict = {}

    if model_version_id:
        conditions.append("mp.model_version_id = :model_version_id")
        params["model_version_id"] = str(model_version_id)

    where = " AND ".join(conditions)

    query = text(f"""
        SELECT
            mp.probability,
            mp.edge,
            e.kickoff_at,
            od.decimal_odds AS best_odds,
            fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) AS won
        FROM model_predictions mp
        JOIN events e ON e.id = mp.event_id
        JOIN markets m ON m.id = mp.market_id
        JOIN outcomes o ON o.id = mp.outcome_id
        LEFT JOIN odds od ON od.event_id = mp.event_id
            AND od.market_id = mp.market_id
            AND od.outcome_id = mp.outcome_id
        WHERE {where}
        ORDER BY e.kickoff_at
    """)

    try:
        result = await db.execute(query, params)
        rows = result.mappings().all()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao consultar predições: {exc}",
        )

    if len(rows) < 50:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Amostra insuficiente: {len(rows)} predições (mínimo 50 para drawdown).",
        )

    # ── Simular bankroll ─────────────────────────────────────────────────
    flat_series: list[DrawdownPoint] = []
    kelly_series: list[DrawdownPoint] = []

    flat_bank = initial_bankroll
    kelly_bank = initial_bankroll
    flat_peak = initial_bankroll
    kelly_peak = initial_bankroll
    flat_max_dd = 0.0
    kelly_max_dd = 0.0
    flat_max_dd_date = None
    kelly_max_dd_date = None

    stake_unit = initial_bankroll * 0.01  # flat = 1% do bankroll inicial

    for r in rows:
        odds = float(r["best_odds"]) if r.get("best_odds") else None
        if odds is None or odds <= 1:
            continue

        prob = float(r["probability"])
        won = r["won"] is True
        dt = r["kickoff_at"]

        # ── Flat staking ──
        if won:
            flat_bank += stake_unit * (odds - 1)
        else:
            flat_bank -= stake_unit

        flat_peak = max(flat_peak, flat_bank)
        dd_flat = (flat_peak - flat_bank) / flat_peak * 100 if flat_peak > 0 else 0
        if dd_flat > flat_max_dd:
            flat_max_dd = dd_flat
            flat_max_dd_date = dt

        flat_series.append(DrawdownPoint(
            date=dt, bankroll=round(flat_bank, 2),
            peak=round(flat_peak, 2), drawdown_pct=round(dd_flat, 2),
        ))

        # ── Kelly fracionário (κ=0.25) ──
        edge = prob - 1 / odds  # edge = prob_modelo - prob_implícita
        if edge > 0:
            kelly_fraction = 0.25 * (prob * odds - 1) / (odds - 1)
            kelly_stake = kelly_bank * max(0, min(kelly_fraction, 0.05))  # cap 5%
        else:
            kelly_stake = 0

        if kelly_stake > 0:
            if won:
                kelly_bank += kelly_stake * (odds - 1)
            else:
                kelly_bank -= kelly_stake

        kelly_peak = max(kelly_peak, kelly_bank)
        dd_kelly = (kelly_peak - kelly_bank) / kelly_peak * 100 if kelly_peak > 0 else 0
        if dd_kelly > kelly_max_dd:
            kelly_max_dd = dd_kelly
            kelly_max_dd_date = dt

        kelly_series.append(DrawdownPoint(
            date=dt, bankroll=round(kelly_bank, 2),
            peak=round(kelly_peak, 2), drawdown_pct=round(dd_kelly, 2),
        ))

    return [
        DrawdownSeries(
            strategy="flat",
            initial_bankroll=initial_bankroll,
            final_bankroll=round(flat_bank, 2),
            max_drawdown_pct=round(flat_max_dd, 2),
            max_drawdown_date=flat_max_dd_date,
            series=flat_series,
        ),
        DrawdownSeries(
            strategy="kelly_0.25",
            initial_bankroll=initial_bankroll,
            final_bankroll=round(kelly_bank, 2),
            max_drawdown_pct=round(kelly_max_dd, 2),
            max_drawdown_date=kelly_max_dd_date,
            series=kelly_series,
        ),
    ]


@router.get(
    "/clv-distribution",
    response_model=list[CLVBucket],
    summary="Distribuição de CLV por faixa de edge",
)
async def get_clv_distribution(
    db: DbSession,
    model_version_id: UUID | None = Query(default=None),
    n_buckets: int = Query(default=5, ge=3, le=20),
) -> list[CLVBucket]:
    """Agrupa predições resolvidas por faixa de edge e calcula o CLV médio.

    CLV (Closing Line Value) mede se o modelo captura valor que desaparece
    antes do kickoff. Requer pelo menos 100 predições com edge calculado.
    """
    conditions = ["e.status = 'finished'", "mp.edge IS NOT NULL"]
    params: dict = {}

    if model_version_id:
        conditions.append("mp.model_version_id = :model_version_id")
        params["model_version_id"] = str(model_version_id)

    where = " AND ".join(conditions)

    query = text(f"""
        SELECT
            mp.edge,
            mp.probability,
            od.decimal_odds,
            fn_outcome_won(m.code, o.code, o.line, e.home_score, e.away_score) AS won
        FROM model_predictions mp
        JOIN events e ON e.id = mp.event_id
        JOIN markets m ON m.id = mp.market_id
        JOIN outcomes o ON o.id = mp.outcome_id
        LEFT JOIN odds od ON od.event_id = mp.event_id
            AND od.market_id = mp.market_id
            AND od.outcome_id = mp.outcome_id
        WHERE {where}
        ORDER BY mp.edge
    """)

    try:
        result = await db.execute(query, params)
        rows = result.mappings().all()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao consultar: {exc}",
        )

    if len(rows) < 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Amostra insuficiente: {len(rows)} (mínimo 100 para CLV).",
        )

    # Dividir em buckets por edge
    edges = [float(r["edge"]) for r in rows]
    edge_min, edge_max = min(edges), max(edges)
    bucket_width = (edge_max - edge_min) / n_buckets if edge_max > edge_min else 0.01

    buckets: list[CLVBucket] = []
    for i in range(n_buckets):
        lo = edge_min + i * bucket_width
        hi = edge_min + (i + 1) * bucket_width if i < n_buckets - 1 else edge_max + 0.001

        bucket_rows = [r for r in rows if lo <= float(r["edge"]) < hi]
        if not bucket_rows:
            continue

        clv_values = [float(r["edge"]) * 100 for r in bucket_rows]
        positive_count = sum(1 for v in clv_values if v > 0)

        buckets.append(CLVBucket(
            edge_min=round(lo, 4),
            edge_max=round(hi, 4),
            count=len(bucket_rows),
            mean_clv_pct=round(sum(clv_values) / len(clv_values), 4),
            positive_rate=round(positive_count / len(bucket_rows), 4),
            avg_edge=round(sum(float(r["edge"]) for r in bucket_rows) / len(bucket_rows), 4),
        ))

    return buckets


@router.get(
    "/sample-sizes",
    response_model=list[SampleSizeReport],
    summary="Contagem de amostras por métrica",
)
async def get_sample_sizes(
    db: DbSession,
    model_version_id: UUID | None = Query(default=None),
) -> list[SampleSizeReport]:
    """Retorna a contagem de amostras disponíveis para cada métrica de validação.

    Compara com os pisos mínimos (§6.7 MODELING.md) e reporta o déficit.
    """
    conditions = ["TRUE"]
    params: dict = {}

    if model_version_id:
        conditions.append("mp.model_version_id = :model_version_id")
        params["model_version_id"] = str(model_version_id)

    where = " AND ".join(conditions)

    query = text(f"""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE e.status = 'finished' AND e.home_score IS NOT NULL) AS resolved,
            COUNT(*) FILTER (WHERE e.status = 'finished' AND mp.edge IS NOT NULL) AS with_edge,
            COUNT(*) FILTER (WHERE e.status = 'finished' AND od.decimal_odds IS NOT NULL) AS with_odds
        FROM model_predictions mp
        JOIN events e ON e.id = mp.event_id
        LEFT JOIN odds od ON od.event_id = mp.event_id
            AND od.market_id = mp.market_id
            AND od.outcome_id = mp.outcome_id
        WHERE {where}
    """)

    try:
        result = await db.execute(query, params)
        row = result.mappings().first()
    except Exception:
        row = None

    total = int(row["total"]) if row else 0
    resolved = int(row["resolved"]) if row else 0
    with_edge = int(row["with_edge"]) if row else 0
    with_odds = int(row["with_odds"]) if row else 0

    metrics = [
        ("brier_score", resolved, 200),
        ("log_loss", resolved, 200),
        ("ece_mce", resolved, 200),
        ("hit_rate", resolved, 30),
        ("clv", with_edge, 100),
        ("roi_flat", with_odds, 500),
        ("roi_kelly", with_odds, 500),
        ("drawdown", with_odds, 50),
    ]

    return [
        SampleSizeReport(
            metric=name,
            current_count=count,
            minimum_required=minimum,
            sufficient=count >= minimum,
            deficit=max(0, minimum - count),
        )
        for name, count, minimum in metrics
    ]
