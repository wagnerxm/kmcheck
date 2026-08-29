"""Endpoints de cálculo de odds (probabilidade justa, overround, implícitas).

A matemática por trás destes endpoints está totalmente implementada em
`app/value/engine.py`; estes endpoints conectam à camada de dados para
buscar odds vigentes e aplicar os cálculos.
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.deps import DbSession
from app.value.engine import (
    calculate_overround,
    implied_probability,
    remove_vig_multiplicative,
    remove_vig_power,
    remove_vig_shin,
)

router = APIRouter()


class FairProbabilityResponse(BaseModel):
    """Probabilidade justa (sem vig) por resultado, após remoção do overround."""

    event_id: UUID
    market: str
    method: str = Field(description="Método de remoção de vig usado: 'multiplicative', 'power', 'shin'.")
    fair_probabilities: dict[str, float] = Field(description="Mapa outcome -> probabilidade justa.")
    overround: float = Field(description="Overround do mercado (fração).")
    computed_at: datetime


class OverroundEntry(BaseModel):
    """Overround (margem da casa) para uma casa de apostas específica."""

    bookmaker: str
    overround_pct: float = Field(description="Ex.: 5.2 significa 5.2% de margem.")


class OverroundResponse(BaseModel):
    """Overround de cada casa de apostas para um evento/mercado."""

    event_id: UUID
    market: str
    bookmakers: list[OverroundEntry]
    average_overround_pct: float = Field(description="Overround médio entre casas.")


class ImpliedProbabilitiesResponse(BaseModel):
    """Probabilidades implícitas cruas (com vig) de todas as casas para um evento."""

    event_id: UUID
    by_bookmaker: dict[str, dict[str, float]] = Field(
        description="Mapa bookmaker -> {outcome: probabilidade implícita}."
    )


# ═══════════════════════════════════════════════════════════════════════════
# Helpers de consulta (compartilhados entre endpoints)
# ═══════════════════════════════════════════════════════════════════════════

async def _fetch_odds(
    db, event_id: UUID, market: str
) -> dict[str, dict[str, float]]:
    """Busca odds vigentes por bookmaker para um evento/mercado.

    Returns:
        Dict bookmaker -> {outcome: decimal_odds}.
    """
    from sqlalchemy import text

    result = await db.execute(
        text(
            "SELECT bookmaker, outcome, decimal_odds "
            "FROM odds_history "
            "WHERE event_id = :event_id AND market = :market "
            "AND is_latest = true "
            "ORDER BY bookmaker, outcome"
        ),
        {"event_id": str(event_id), "market": market},
    )
    rows = result.mappings().all()

    by_bookmaker: dict[str, dict[str, float]] = {}
    for row in rows:
        bk = row["bookmaker"]
        by_bookmaker.setdefault(bk, {})[row["outcome"]] = float(row["decimal_odds"])

    return by_bookmaker


# ═══════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@router.get(
    "/fair-probability/{event_id}/{market}",
    response_model=FairProbabilityResponse,
    summary="Probabilidade justa após remoção do vig",
)
async def get_fair_probability(
    event_id: UUID,
    market: str,
    db: DbSession,
    method: str = Query(
        default="shin",
        description="Método de remoção de vig: 'multiplicative', 'power', 'shin'.",
    ),
) -> FairProbabilityResponse:
    """Calcula a probabilidade justa do mercado combinando odds de várias casas.

    Usa a melhor odds por outcome entre todas as casas e remove o vig pelo
    método selecionado (Shin por padrão, conforme §7.2 do MODELING.md).
    """
    by_bookmaker = await _fetch_odds(db, event_id, market)

    if not by_bookmaker:
        raise HTTPException(status_code=404, detail="Nenhuma odds encontrada para este evento/mercado.")

    # Consolida: melhor odds por outcome entre todas as casas.
    best_odds: dict[str, float] = {}
    for bk_odds in by_bookmaker.values():
        for outcome, odds in bk_odds.items():
            if outcome not in best_odds or odds > best_odds[outcome]:
                best_odds[outcome] = odds

    outcome_names = sorted(best_odds.keys())
    implied_probs = [implied_probability(best_odds[oc]) for oc in outcome_names]

    # Aplica método de remoção de vig.
    methods = {
        "multiplicative": remove_vig_multiplicative,
        "power": remove_vig_power,
        "shin": remove_vig_shin,
    }
    if method not in methods:
        raise HTTPException(
            status_code=400,
            detail=f"Método '{method}' não reconhecido. Opções: {list(methods.keys())}",
        )

    fair_probs = methods[method](implied_probs)
    overround = calculate_overround(implied_probs)

    return FairProbabilityResponse(
        event_id=event_id,
        market=market,
        method=method,
        fair_probabilities=dict(zip(outcome_names, fair_probs)),
        overround=overround,
        computed_at=datetime.utcnow(),
    )


@router.get(
    "/overround/{event_id}/{market}",
    response_model=OverroundResponse,
    summary="Overround por casa de apostas",
)
async def get_overround(
    event_id: UUID,
    market: str,
    db: DbSession,
) -> OverroundResponse:
    """Retorna a margem (overround) de cada casa de apostas para o evento/mercado."""
    by_bookmaker = await _fetch_odds(db, event_id, market)

    if not by_bookmaker:
        raise HTTPException(status_code=404, detail="Nenhuma odds encontrada para este evento/mercado.")

    entries: list[OverroundEntry] = []
    for bookmaker, bk_odds in sorted(by_bookmaker.items()):
        implied_probs = [implied_probability(odds) for odds in bk_odds.values()]
        overround = calculate_overround(implied_probs)
        entries.append(OverroundEntry(
            bookmaker=bookmaker,
            overround_pct=round(overround * 100.0, 2),
        ))

    avg_overround = sum(e.overround_pct for e in entries) / len(entries) if entries else 0.0

    return OverroundResponse(
        event_id=event_id,
        market=market,
        bookmakers=entries,
        average_overround_pct=round(avg_overround, 2),
    )


class BookmakerFairProbs(BaseModel):
    """Fair probs por casa de apostas — 3 métodos de remoção de vig."""

    bookmaker: str
    outcomes: list[str]
    decimal_odds: list[float]
    implied_probabilities: list[float]
    overround_pct: float = Field(description="Overround em percentual (ex.: 5.2 = 5,2%).")
    fair_probs: dict[str, dict[str, float]] = Field(
        description="Mapa método → {outcome: fair_prob}. Métodos: multiplicative, power, shin."
    )


class OddsComparisonResponse(BaseModel):
    """Comparação completa de odds: fair probs com 3 métodos, por casa de apostas."""

    event_id: UUID
    market: str
    by_bookmaker: list[BookmakerFairProbs]
    best_odds: dict[str, float] = Field(description="Melhor odd por outcome entre todas as casas.")
    computed_at: datetime


@router.get(
    "/comparison/{event_id}/{market}",
    response_model=OddsComparisonResponse,
    summary="Comparação de odds: fair probs com 3 métodos por casa",
)
async def get_odds_comparison(
    event_id: UUID,
    market: str,
    db: DbSession,
) -> OddsComparisonResponse:
    """Retorna fair probabilities calculadas por 3 métodos (Shin, power, multiplicative)
    para cada casa de apostas, além do overround e melhor odd por outcome.

    Endpoint criado para que o frontend consuma fair probs do Python (fonte canônica)
    em vez de recalcular no TypeScript.
    """
    by_bookmaker = await _fetch_odds(db, event_id, market)

    if not by_bookmaker:
        raise HTTPException(
            status_code=404,
            detail="Nenhuma odds encontrada para este evento/mercado.",
        )

    best_odds: dict[str, float] = {}
    result: list[BookmakerFairProbs] = []

    for bk_name, bk_odds in sorted(by_bookmaker.items()):
        outcome_names = sorted(bk_odds.keys())
        odds_list = [bk_odds[oc] for oc in outcome_names]
        implied = [implied_probability(o) for o in odds_list]
        overround = calculate_overround(implied)

        # Computar fair probs com 3 métodos
        fair_mult = remove_vig_multiplicative(implied)
        try:
            fair_pow = remove_vig_power(implied)
        except Exception:
            # Fallback: power pode falhar com probs fora de (0,1)
            fair_pow = remove_vig_multiplicative(implied)
        try:
            fair_shin = remove_vig_shin(implied)
        except Exception:
            fair_shin = remove_vig_multiplicative(implied)

        result.append(BookmakerFairProbs(
            bookmaker=bk_name,
            outcomes=outcome_names,
            decimal_odds=[round(o, 4) for o in odds_list],
            implied_probabilities=[round(p, 6) for p in implied],
            overround_pct=round(overround * 100.0, 2),
            fair_probs={
                "multiplicative": {oc: round(fp, 6) for oc, fp in zip(outcome_names, fair_mult)},
                "power": {oc: round(fp, 6) for oc, fp in zip(outcome_names, fair_pow)},
                "shin": {oc: round(fp, 6) for oc, fp in zip(outcome_names, fair_shin)},
            },
        ))

        # Atualizar melhor odd por outcome
        for i, oc in enumerate(outcome_names):
            if oc not in best_odds or odds_list[i] > best_odds[oc]:
                best_odds[oc] = round(odds_list[i], 4)

    return OddsComparisonResponse(
        event_id=event_id,
        market=market,
        by_bookmaker=result,
        best_odds=best_odds,
        computed_at=datetime.utcnow(),
    )


@router.get(
    "/implied/{event_id}",
    response_model=ImpliedProbabilitiesResponse,
    summary="Probabilidades implícitas de todas as casas para um evento",
)
async def get_implied_probabilities(
    event_id: UUID,
    db: DbSession,
) -> ImpliedProbabilitiesResponse:
    """Retorna as probabilidades implícitas cruas (sem remoção de vig) de todas as casas."""
    from sqlalchemy import text

    result = await db.execute(
        text(
            "SELECT bookmaker, market, outcome, decimal_odds "
            "FROM odds_history "
            "WHERE event_id = :event_id AND is_latest = true "
            "ORDER BY bookmaker, market, outcome"
        ),
        {"event_id": str(event_id)},
    )
    rows = result.mappings().all()

    if not rows:
        raise HTTPException(status_code=404, detail="Nenhuma odds encontrada para este evento.")

    by_bookmaker: dict[str, dict[str, float]] = {}
    for row in rows:
        bk = row["bookmaker"]
        key = f"{row['market']}:{row['outcome']}"
        ip = implied_probability(float(row["decimal_odds"]))
        by_bookmaker.setdefault(bk, {})[key] = round(ip, 6)

    return ImpliedProbabilitiesResponse(
        event_id=event_id,
        by_bookmaker=by_bookmaker,
    )
