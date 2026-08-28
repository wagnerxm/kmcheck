"""Task de execução de backtest — executada de forma assíncrona pelo worker Python.

Disparada por `POST /backtest/run` no Motor Estatístico (ver
`services/engine/app/api/backtest.py::run_backtest`). Simula, sobre um
período histórico, como uma estratégia de aposta teria performado usando as
predições do(s) modelo(s) escolhido(s) — sem, em nenhum momento, deixar o
modelo "ver" dados posteriores ao instante simulado de cada aposta (mesma
regra de não-vazamento aplicada ao treino, ver `tasks.train_model`).
"""
from datetime import datetime
from typing import Any

from celery_app import celery_app


@celery_app.task(
    name="tasks.run_backtest",
    bind=True,
    max_retries=1,
)
def run_backtest(
    self,
    job_id: str,
    model_ids: list[str],
    start_date_iso: str,
    end_date_iso: str,
    markets: list[str] | None = None,
    leagues: list[str] | None = None,
    staking_strategy: str = "flat",
    min_edge: float = 0.0,
    initial_bankroll: float = 1000.0,
) -> dict[str, Any]:
    """Executa um backtest completo e persiste os resultados agregados.

    Args:
        job_id: identificador do job de backtest (usado pela API para
            correlacionar com `GET /backtest/{job_id}/status|results`).
        model_ids: modelo(s) a avaliar (múltiplos IDs implicam um ensemble
            simples, salvo estratégia mais sofisticada configurada à parte).
        start_date_iso / end_date_iso: janela histórica simulada, em ISO 8601.
        markets / leagues: filtros opcionais de escopo do backtest.
        staking_strategy: "flat", "kelly" ou "fractional_kelly" (ver
            `app.api.backtest.BacktestRunRequest`).
        min_edge: edge mínimo (fração) para a simulação considerar apostar.
        initial_bankroll: banca inicial simulada.

    Returns:
        dict com o resumo do backtest: nº de apostas, hit rate, ROI,
        drawdown máximo, Brier Score, ECE — o mesmo shape de
        `BacktestResultsResponse` na API.

    TODO(fase 1/2):
        1. Para cada evento histórico no intervalo, gerar a predição do(s)
           modelo(s) usando `as_of = kickoff_at do evento` (nunca dados
           posteriores) e comparar contra as odds disponíveis NAQUELE
           momento (não as odds de fechamento, que são conhecimento futuro).
        2. Aplicar `app.value.engine.calculate_edge`/`calculate_ev` para
           decidir se a aposta simulada teria sido feita (`edge >= min_edge`).
        3. Simular o staking (`staking_strategy`) e atualizar a banca
           simulada partida a partida, em ORDEM CRONOLÓGICA.
        4. Calcular métricas finais via `app.metrics.brier`/`app.metrics.calibration`.
        5. Persistir o resultado (tabela `backtest_results`) e atualizar o
           status do job para "completed" (ou "failed", com o erro).
    """
    start_date = datetime.fromisoformat(start_date_iso)
    end_date = datetime.fromisoformat(end_date_iso)

    if start_date >= end_date:
        raise ValueError("start_date deve ser anterior a end_date.")

    self.update_state(
        state="STARTED",
        meta={"job_id": job_id, "model_ids": model_ids, "progress_pct": 0.0},
    )

    raise NotImplementedError(
        f"Execução de backtest (job_id={job_id}, model_ids={model_ids}, "
        f"período={start_date.isoformat()}..{end_date.isoformat()}, "
        f"staking={staking_strategy!r}) será implementada na Fase 1/2."
    )
