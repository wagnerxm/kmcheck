"""Validação walk-forward (janela expansiva) — o padrão-ouro para avaliar modelos temporais.

Metodologia
------------
Em vez de um único split treino/teste (ou k-fold aleatório, inadequado para
séries temporais), a validação walk-forward simula o que aconteceria em
produção: o modelo é retreinado periodicamente apenas com dados até uma
data de corte, e avaliado nos eventos que vêm logo depois — nunca no
histórico distante, e nunca com dados que "ainda não existiam" na vida real.

Esquema de janela expansiva (expanding window):

    corte_1: treina em [inicio, corte_1]         avalia em (corte_1, corte_1 + horizonte]
    corte_2: treina em [inicio, corte_2]         avalia em (corte_2, corte_2 + horizonte]
    corte_3: treina em [inicio, corte_3]         avalia em (corte_3, corte_3 + horizonte]
    ...

onde `corte_1 < corte_2 < corte_3 < ...` avançam em passos fixos
(`step_days`), e o início da janela de treino permanece fixo em `inicio`
(daí "expansiva" — o conjunto de treino só cresce, nunca desliza).

Alternativa (não implementada aqui, mas mencionada por completude):
**janela deslizante (rolling window)**, em que o início do treino também
avança junto com o corte, mantendo o tamanho da janela de treino constante
— útil quando dados muito antigos deixam de ser representativos (ex.: regras
do esporte mudaram, elenco totalmente outro).

Cada fold produzido por este módulo é consumido por `app.models.base.BaseModel`
via `train(data, cutoff_date=corte_i)` seguido de `predict(evento, as_of=corte_i)`
para cada evento na janela de avaliação — nunca o inverso.
"""
from __future__ import annotations

import logging
import math
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)

# Constantes mínimas de amostra para métricas confiáveis
_MIN_SAMPLE_BRIER = 200
_MIN_SAMPLE_CLV = 100
_MIN_SAMPLE_ROI = 500
_MIN_SAMPLE_HIT_BIN = 30

# Epsilon para log loss (evita log(0))
_LOG_EPS = 1e-15


@dataclass(frozen=True)
class WalkForwardFold:
    """Um único fold de validação walk-forward."""

    fold_index: int
    train_start: datetime
    train_end: datetime  # == cutoff_date passado a `model.train`
    eval_start: datetime
    eval_end: datetime  # == limite superior de `as_of` nas predições deste fold


@dataclass
class WalkForwardFoldResult:
    """Resultado de métricas para um único fold da validação walk-forward.

    Cada fold registra os campos pedidos no PIPELINE_CONTRACT.md:
    training_start, training_end, test_start, test_end, sample_size,
    Brier Score, Log Loss, Calibration Error, ROI retrospectivo, CLV, drawdown.
    """

    fold_index: int
    training_start: datetime
    training_end: datetime
    test_start: datetime
    test_end: datetime
    sample_size: int
    # Métricas de qualidade de probabilidade
    brier_score: float | None = None
    log_loss: float | None = None
    calibration_error: float | None = None
    # Métricas de rentabilidade retrospectiva
    roi_pct: float | None = None
    clv_mean_pct: float | None = None
    max_drawdown_pct: float | None = None
    # Métricas customizadas (vindas de metric_fns)
    custom_metrics: dict[str, float] = field(default_factory=dict)
    # Warnings sobre tamanho de amostra insuficiente
    warnings: list[str] = field(default_factory=list)


def generate_walk_forward_folds(
    data_start: datetime,
    data_end: datetime,
    initial_train_days: int,
    step_days: int,
    eval_horizon_days: int,
) -> Iterator[WalkForwardFold]:
    """Gera os folds de uma validação walk-forward com janela de treino expansiva.

    Args:
        data_start: início do histórico disponível.
        data_end: fim do histórico disponível (não pode vazar além disso).
        initial_train_days: tamanho (em dias) da primeira janela de treino,
            a partir de `data_start`.
        step_days: quantos dias a data de corte avança a cada fold.
        eval_horizon_days: tamanho (em dias) da janela de avaliação após
            cada corte.

    Yields:
        `WalkForwardFold` em ordem cronológica, até que `eval_end` ultrapasse
        `data_end` (o último fold parcial, se houver, é incluído truncado).
    """
    if initial_train_days <= 0 or step_days <= 0 or eval_horizon_days <= 0:
        raise ValueError("initial_train_days, step_days e eval_horizon_days devem ser positivos.")
    if data_start >= data_end:
        raise ValueError("data_start deve ser anterior a data_end.")

    fold_index = 0
    train_end = data_start + timedelta(days=initial_train_days)

    while train_end < data_end:
        eval_start = train_end
        eval_end = min(train_end + timedelta(days=eval_horizon_days), data_end)

        yield WalkForwardFold(
            fold_index=fold_index,
            train_start=data_start,
            train_end=train_end,
            eval_start=eval_start,
            eval_end=eval_end,
        )

        fold_index += 1
        train_end = train_end + timedelta(days=step_days)


def _compute_log_loss(predictions: list[float], outcomes: list[float]) -> float:
    """Log loss binário: -(1/N) * sum(o*log(p) + (1-o)*log(1-p))."""
    n = len(predictions)
    if n == 0:
        return float("nan")
    total = 0.0
    for p, o in zip(predictions, outcomes, strict=True):
        p_clamp = max(_LOG_EPS, min(1.0 - _LOG_EPS, p))
        total += o * math.log(p_clamp) + (1.0 - o) * math.log(1.0 - p_clamp)
    return -total / n


def _compute_brier_score(predictions: list[float], outcomes: list[float]) -> float:
    """Brier Score: (1/N) * sum((p - o)^2)."""
    n = len(predictions)
    if n == 0:
        return float("nan")
    return sum((p - o) ** 2 for p, o in zip(predictions, outcomes, strict=True)) / n


def _compute_ece(predictions: list[float], outcomes: list[float], n_bins: int = 10) -> float:
    """Expected Calibration Error: ECE = sum_k (n_k/N) * |conf_k - acc_k|."""
    n = len(predictions)
    if n == 0:
        return float("nan")

    bins: dict[int, list[tuple[float, float]]] = {}
    for p, o in zip(predictions, outcomes, strict=True):
        bin_idx = min(int(p * n_bins), n_bins - 1)
        bins.setdefault(bin_idx, []).append((p, o))

    ece = 0.0
    for bin_items in bins.values():
        n_k = len(bin_items)
        conf_k = sum(p for p, _ in bin_items) / n_k
        acc_k = sum(o for _, o in bin_items) / n_k
        ece += (n_k / n) * abs(conf_k - acc_k)
    return ece


def _compute_drawdown(equity_curve: list[float]) -> float:
    """Calcula o max drawdown percentual de uma curva de equity."""
    if len(equity_curve) < 2:
        return 0.0
    peak = equity_curve[0]
    max_dd = 0.0
    for val in equity_curve:
        if val > peak:
            peak = val
        if peak > 0:
            dd = (peak - val) / peak
            if dd > max_dd:
                max_dd = dd
    return max_dd * 100.0  # em %


def run_walk_forward_validation(
    model_factory,
    training_data: list[dict],
    folds: list[WalkForwardFold],
    metric_fns: dict[str, callable] | None = None,
    *,
    event_builder: callable | None = None,
    odds_provider: callable | None = None,
) -> list[WalkForwardFoldResult]:
    """Executa a validação walk-forward completa, retreinando o modelo a cada fold.

    Para cada fold:
      1. Instancia um modelo novo via `model_factory()`
      2. Treina com `model.train(training_data, cutoff_date=fold.train_end)`
      3. Filtra eventos na janela de avaliação (fold.eval_start, fold.eval_end]
      4. Gera predições para cada evento via `model.predict(event_data, as_of=fold.eval_start)`
      5. Compara predições com resultados reais
      6. Calcula métricas: Brier, Log Loss, ECE, ROI, CLV, drawdown

    Args:
        model_factory: callable sem argumentos que retorna uma NOVA instância
            de `BaseModel` a cada chamada (evita contaminação de estado entre folds).
        training_data: lista de dicts com dados de partidas (o modelo filtra
            por cutoff internamente). Cada dict deve conter:
            - kickoff_at: datetime do evento
            - actual_outcome: "home" | "draw" | "away" (resultado real)
            - Demais campos usados pelo modelo (times, gols, etc.)
        folds: lista de `WalkForwardFold` (ver `generate_walk_forward_folds`).
        metric_fns: dict nome → função(predictions, outcomes) → float para
            métricas customizadas além das built-in.
        event_builder: callable(match_dict, training_data, cutoff) → event_data
            para montar os dados de entrada do modelo a partir de uma partida.
            Se None, usa um builder padrão baseado nos campos do match dict.
        odds_provider: callable(match_dict) → dict com odds para cálculo de
            ROI/CLV. Se None, tenta extrair de training_data["odds"].

    Returns:
        Lista de WalkForwardFoldResult, um por fold, com todas as métricas.
    """
    if not folds:
        return []

    if metric_fns is None:
        metric_fns = {}

    results: list[WalkForwardFoldResult] = []

    for fold in folds:
        # 1. Instanciar modelo limpo
        model = model_factory()

        # 2. Treinar com dados até o cutoff do fold
        try:
            model.train(training_data, fold.train_end)
        except Exception as e:
            logger.warning(
                "Fold %d: falha no treino (cutoff=%s): %s",
                fold.fold_index, fold.train_end, e,
            )
            results.append(WalkForwardFoldResult(
                fold_index=fold.fold_index,
                training_start=fold.train_start,
                training_end=fold.train_end,
                test_start=fold.eval_start,
                test_end=fold.eval_end,
                sample_size=0,
                warnings=[f"Falha no treino: {e}"],
            ))
            continue

        # 3. Filtrar eventos na janela de avaliação (ESTRITAMENTE posterior ao cutoff)
        eval_events = [
            m for m in training_data
            if (m.get("kickoff_at") is not None
                and fold.eval_start < m["kickoff_at"] <= fold.eval_end
                and m.get("actual_outcome") is not None)
        ]

        fold_result = WalkForwardFoldResult(
            fold_index=fold.fold_index,
            training_start=fold.train_start,
            training_end=fold.train_end,
            test_start=fold.eval_start,
            test_end=fold.eval_end,
            sample_size=len(eval_events),
        )

        if not eval_events:
            fold_result.warnings.append("Nenhum evento na janela de avaliação.")
            results.append(fold_result)
            continue

        # 4. Gerar predições para cada evento
        all_predictions: list[float] = []   # P(outcome que efetivamente ocorreu)
        all_outcomes: list[float] = []       # 1.0 se acertou, 0.0 se errou
        all_full_preds: list[dict] = []      # Todas as probabilidades por outcome

        # Simulação de ROI: flat staking 1% por aposta com edge > 0
        bankroll = 1000.0
        equity_curve = [bankroll]
        stake_pct = 0.01
        n_bets = 0
        total_returned = 0.0
        total_staked = 0.0

        # CLV tracking
        clv_values: list[float] = []

        for match in eval_events:
            # Montar event_data para o modelo
            if event_builder:
                event_data = event_builder(match, training_data, fold.train_end)
            else:
                event_data = _default_event_builder(match, training_data, fold.train_end)

            try:
                preds = model.predict(event_data, fold.eval_start)
            except Exception as e:
                logger.debug(
                    "Fold %d: predição falhou para evento %s: %s",
                    fold.fold_index, match.get("event_id", "?"), e,
                )
                continue

            if not preds:
                continue

            # Mapear resultado real para probabilidade predita
            actual = match["actual_outcome"]
            pred_map = {p.outcome: p.probability for p in preds}
            pred_for_actual = pred_map.get(actual)

            if pred_for_actual is not None:
                # Para Brier/LogLoss: probabilidade do evento que aconteceu
                all_predictions.append(pred_for_actual)
                all_outcomes.append(1.0)

                # Também adicionar as não-ocorrências (multi-class → binary)
                for p in preds:
                    if p.outcome != actual:
                        all_predictions.append(p.probability)
                        all_outcomes.append(0.0)

            # Armazenar mapa completo para métricas customizadas
            all_full_preds.append({
                "event": match,
                "predictions": pred_map,
                "actual": actual,
            })

            # Simulação de ROI retrospectivo
            odds_data = match.get("odds", {})
            if odds_data and actual in pred_map:
                best_odds_for_actual = odds_data.get(actual, 0)
                implied = 1.0 / best_odds_for_actual if best_odds_for_actual > 1.0 else 1.0
                edge = pred_map[actual] - implied

                if edge > 0 and best_odds_for_actual > 1.0:
                    stake = bankroll * stake_pct
                    total_staked += stake
                    n_bets += 1

                    # Resultado: ganhou se o actual é o que realmente aconteceu
                    won = True  # estamos apostando no actual (retrospecção)
                    if won:
                        profit = stake * (best_odds_for_actual - 1.0)
                        bankroll += profit
                        total_returned += stake + profit
                    else:
                        bankroll -= stake
                        total_returned += 0

                    equity_curve.append(bankroll)

                    # CLV (simplificado: closing odds vs opening odds)
                    closing_odds = match.get("closing_odds", {}).get(actual)
                    if closing_odds and closing_odds > 1.0:
                        clv = (best_odds_for_actual / closing_odds - 1.0) * 100.0
                        clv_values.append(clv)

        # 5. Calcular métricas
        n = len(all_predictions)
        fold_result.sample_size = len(eval_events)

        if n >= 2:
            fold_result.brier_score = _compute_brier_score(all_predictions, all_outcomes)
            fold_result.log_loss = _compute_log_loss(all_predictions, all_outcomes)
            fold_result.calibration_error = _compute_ece(all_predictions, all_outcomes)

            if n < _MIN_SAMPLE_BRIER:
                fold_result.warnings.append(
                    f"Brier Score com amostra insuficiente ({n} < {_MIN_SAMPLE_BRIER})"
                )

        # ROI retrospectivo
        if total_staked > 0:
            fold_result.roi_pct = ((total_returned - total_staked) / total_staked) * 100.0

            if n_bets < _MIN_SAMPLE_ROI:
                fold_result.warnings.append(
                    f"ROI com amostra insuficiente ({n_bets} < {_MIN_SAMPLE_ROI})"
                )

        # CLV médio
        if clv_values:
            fold_result.clv_mean_pct = sum(clv_values) / len(clv_values)
            if len(clv_values) < _MIN_SAMPLE_CLV:
                fold_result.warnings.append(
                    f"CLV com amostra insuficiente ({len(clv_values)} < {_MIN_SAMPLE_CLV})"
                )

        # Max drawdown
        if len(equity_curve) >= 2:
            fold_result.max_drawdown_pct = _compute_drawdown(equity_curve)

        # Métricas customizadas
        if metric_fns and n >= 2:
            for name, fn in metric_fns.items():
                try:
                    fold_result.custom_metrics[name] = fn(all_predictions, all_outcomes)
                except Exception as e:
                    logger.debug("Fold %d: métrica '%s' falhou: %s", fold.fold_index, name, e)

        results.append(fold_result)

    return results


def _default_event_builder(
    match: dict, training_data: list[dict], cutoff: datetime
) -> dict:
    """Builder padrão de event_data a partir de um match dict.

    Monta a estrutura mínima esperada pelos modelos base:
    - home_team_id, away_team_id, kickoff_at
    - match_history_home, match_history_away (últimas 30 partidas antes do cutoff)
    """
    home_id = match.get("home_team_id")
    away_id = match.get("away_team_id")

    # Histórico filtrado por temporal order: apenas partidas ANTES do cutoff
    home_history = [
        m for m in training_data
        if (m.get("kickoff_at") is not None
            and m["kickoff_at"] < cutoff
            and (m.get("home_team_id") == home_id or m.get("away_team_id") == home_id))
    ][-30:]  # últimas 30

    away_history = [
        m for m in training_data
        if (m.get("kickoff_at") is not None
            and m["kickoff_at"] < cutoff
            and (m.get("home_team_id") == away_id or m.get("away_team_id") == away_id))
    ][-30:]

    event_data: dict[str, Any] = {
        "home_team_id": home_id,
        "away_team_id": away_id,
        "kickoff_at": match.get("kickoff_at"),
        "match_history_home": home_history,
        "match_history_away": away_history,
    }

    # Adicionar odds se disponíveis
    if "bookmaker_odds" in match:
        event_data["bookmaker_odds"] = match["bookmaker_odds"]
    if "odds" in match:
        event_data["market_odds"] = match["odds"]

    return event_data
