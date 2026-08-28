"""Motor de backtesting walk-forward do BetEdge.

Simula o pipeline completo de predição + apostas em dados históricos,
respeitando rigorosamente a ordem temporal (§4 do MODELING.md) para
evitar data leakage. O motor usa o mesmo código de inferência de
produção (§5.1), garantindo reprodutibilidade.

Módulos:
    engine.py — backtesting walk-forward completo: treino, predição,
                apostas, bankroll, métricas e intervalos de confiança.
"""

from app.backtest.engine import (
    BacktestResult,
    BetRecord,
    ConfidenceInterval,
    DrawdownInfo,
    EquityCurve,
    FoldResult,
    MatchEvent,
    run_backtest,
)

__all__ = [
    "BacktestResult",
    "BetRecord",
    "ConfidenceInterval",
    "DrawdownInfo",
    "EquityCurve",
    "FoldResult",
    "MatchEvent",
    "run_backtest",
]
