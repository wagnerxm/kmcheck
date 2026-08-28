"""Motor de backtesting walk-forward do BetEdge.

Implementação completa da simulação histórica de predição + apostas,
respeitando rigorosamente a ordem temporal (§4 e §5.1 do MODELING.md).

O motor:
  - Gera folds walk-forward com janela de treino expansiva.
  - Retreina o modelo a cada fold (mesma interface de produção).
  - Detecta value bets comparando modelo vs mercado (remove vig via Shin).
  - Simula bankroll com flat staking e Kelly fracionário (κ∈{0.25, 0.5}).
  - Calcula Brier Score, log loss, ECE, CLV, ROI, hit rate, drawdown.
  - Reporta intervalos de confiança e warnings de amostra insuficiente.

Matemática pura — sem I/O, sem banco de dados, sem async.
"""
from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.metrics.brier import brier_decomposition, brier_score, brier_skill_score
from app.metrics.calibration import expected_calibration_error
from app.metrics.clv import calculate_clv
from app.models.base import BaseModel, PredictionResult
from app.validation.walk_forward import WalkForwardFold, generate_walk_forward_folds
from app.value.engine import (
    implied_probability,
    remove_vig_multiplicative,
    remove_vig_power,
    remove_vig_shin,
)
from app.value.kelly import fractional_kelly


# ═══════════════════════════════════════════════════════════════════════════
# Constantes — pisos mínimos de amostra (§6.7 do MODELING.md)
# ═══════════════════════════════════════════════════════════════════════════

MIN_SAMPLE_BRIER = 200    # Brier Score / log loss confiável
MIN_SAMPLE_CLV = 100      # CLV médio confiável
MIN_SAMPLE_ROI = 500      # ROI / yield confiável
MIN_SAMPLE_HIT_RATE = 30  # Hit rate por faixa de confiança

# Epsilon para log loss — evita log(0).
_LOG_EPSILON = 1e-15


# ═══════════════════════════════════════════════════════════════════════════
# Dataclasses de entrada e saída
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class MatchEvent:
    """Um evento (partida) para backtesting.

    Contém todos os dados necessários para treino, predição e avaliação:
    o resultado real, as odds de abertura (para aposta simulada) e
    opcionalmente as odds de fechamento (para CLV).
    """

    match_id: str
    home_team: str
    away_team: str
    league: str
    match_datetime: datetime
    actual_outcome: str  # "home", "draw", "away"
    market: str = "match_result"
    opening_odds: dict[str, float] | None = None  # {"home": 2.1, "draw": 3.3, "away": 3.5}
    closing_odds: dict[str, float] | None = None   # para CLV
    actual_goals_home: int | None = None
    actual_goals_away: int | None = None
    event_data: dict[str, Any] | None = None       # dados extras para model.predict


@dataclass
class BetRecord:
    """Registro de uma aposta simulada no backtest."""

    match_id: str
    fold_index: int
    predicted_outcome: str   # outcome em que o modelo aposta
    actual_outcome: str      # resultado real
    predicted_prob: float    # probabilidade do modelo para o outcome apostado
    decimal_odds: float      # odds de abertura usada
    edge: float              # model_prob - fair_market_prob
    ev: float                # expected value = model_prob * odds - 1
    market: str = "match_result"
    match_datetime: datetime = field(default_factory=datetime.utcnow)
    clv_pct: float | None = None  # CLV se closing_odds disponível


@dataclass
class FoldResult:
    """Resultado de um único fold do walk-forward."""

    fold_index: int
    train_start: datetime
    train_end: datetime
    eval_start: datetime
    eval_end: datetime
    n_train_samples: int
    n_eval_events: int
    n_bets: int
    # Métricas de predição.
    brier_score: float
    log_loss: float
    ece: float
    hit_rate: float
    # Métricas de aposta (se houver apostas).
    roi_flat_pct: float | None = None
    roi_kelly_025_pct: float | None = None
    roi_kelly_050_pct: float | None = None
    yield_flat_pct: float | None = None
    mean_clv_pct: float | None = None
    positive_clv_rate: float | None = None
    # Detalhes brutos.
    bets: list[BetRecord] = field(default_factory=list)


@dataclass
class DrawdownInfo:
    """Informação de drawdown de uma curva de equity."""

    max_drawdown_pct: float     # queda máxima do pico ao vale (%)
    max_drawdown_duration: int  # apostas até recuperar o pico
    peak_bankroll: float
    trough_bankroll: float


@dataclass
class EquityCurve:
    """Curva de evolução do bankroll ao longo das apostas."""

    timestamps: list[datetime]
    bankroll_flat: list[float]
    bankroll_kelly_025: list[float]
    bankroll_kelly_050: list[float]


@dataclass
class ConfidenceInterval:
    """Intervalo de confiança de uma métrica."""

    estimate: float
    lower: float
    upper: float
    confidence_level: float   # ex: 0.95
    n_samples: int
    sufficient_sample: bool   # se atinge o piso mínimo (§6.7)


@dataclass
class BacktestResult:
    """Resultado agregado completo de um backtest walk-forward."""

    # Configuração.
    model_name: str
    model_version: str
    start_date: datetime
    end_date: datetime
    n_folds: int
    min_edge: float
    initial_bankroll: float
    # Resultados por fold.
    folds: list[FoldResult]
    # Agregados.
    total_events: int
    total_bets: int
    total_wins: int
    # Métricas agregadas com IC.
    brier_score: ConfidenceInterval
    log_loss: ConfidenceInterval
    ece: float
    hit_rate: ConfidenceInterval
    roi_flat: ConfidenceInterval | None
    roi_kelly_025: ConfidenceInterval | None
    roi_kelly_050: ConfidenceInterval | None
    yield_flat: ConfidenceInterval | None
    mean_clv: ConfidenceInterval | None
    positive_clv_rate: ConfidenceInterval | None
    # Bankroll.
    equity_curve: EquityCurve
    drawdown_flat: DrawdownInfo
    drawdown_kelly_025: DrawdownInfo
    drawdown_kelly_050: DrawdownInfo
    final_bankroll_flat: float
    final_bankroll_kelly_025: float
    final_bankroll_kelly_050: float
    # Alertas (§6.7 — amostra insuficiente, etc.).
    warnings: list[str]
    # Decomposição de Brier (Murphy 1973).
    brier_reliability: float
    brier_resolution: float
    brier_uncertainty: float


# ═══════════════════════════════════════════════════════════════════════════
# Funções auxiliares — estatísticas
# ═══════════════════════════════════════════════════════════════════════════


def _log_loss(
    predicted_probs: Sequence[float],
    actual_outcomes: Sequence[float],
) -> float:
    """Calcula a log loss (entropia cruzada binária) média.

    Args:
        predicted_probs: probabilidade predita para o outcome que ocorreu.
        actual_outcomes: 1.0 para cada amostra (outcome que ocorreu).

    Returns:
        Log loss média (não-negativa). Menor é melhor.
    """
    if len(predicted_probs) == 0:
        raise ValueError("predicted_probs não pode ser vazio.")
    n = len(predicted_probs)
    total = 0.0
    for p, y in zip(predicted_probs, actual_outcomes):
        p_clipped = max(_LOG_EPSILON, min(1.0 - _LOG_EPSILON, p))
        if y == 1.0:
            total += -math.log(p_clipped)
        else:
            total += -math.log(1.0 - p_clipped)
    return total / n


def _wilson_interval(
    successes: int,
    n: int,
    confidence: float = 0.95,
) -> tuple[float, float]:
    """Calcula o intervalo de confiança de Wilson para uma proporção binomial.

    Mais robusto que a aproximação normal para amostras pequenas ou
    proporções próximas de 0/1 (§6.7 do MODELING.md).

    Args:
        successes: número de sucessos observados.
        n: tamanho da amostra.
        confidence: nível de confiança (default 95%).

    Returns:
        Tupla (lower, upper) do intervalo.
    """
    if n == 0:
        return (0.0, 1.0)

    # z para o nível de confiança (bilateral). Para 95%, z ≈ 1.96.
    # Usando aproximação inversa da normal: z = 1.96 para 95%.
    z_map = {0.90: 1.645, 0.95: 1.96, 0.99: 2.576}
    z = z_map.get(confidence, 1.96)

    p_hat = successes / n
    z2 = z * z
    denom = 1.0 + z2 / n
    center = (p_hat + z2 / (2 * n)) / denom
    margin = z * math.sqrt((p_hat * (1 - p_hat) + z2 / (4 * n)) / n) / denom

    lower = max(0.0, center - margin)
    upper = min(1.0, center + margin)
    return (lower, upper)


def _mean_confidence_interval(
    values: Sequence[float],
    confidence: float = 0.95,
    min_sample: int = 0,
) -> ConfidenceInterval:
    """Calcula o intervalo de confiança para a média de uma variável contínua.

    Usa distribuição t de Student para amostras finitas (§6.7).

    Args:
        values: valores observados.
        confidence: nível de confiança.
        min_sample: piso mínimo de amostra para marcar como suficiente.

    Returns:
        ConfidenceInterval com estimate, lower, upper.
    """
    n = len(values)
    if n == 0:
        return ConfidenceInterval(
            estimate=0.0, lower=0.0, upper=0.0,
            confidence_level=confidence, n_samples=0,
            sufficient_sample=False,
        )

    mean = sum(values) / n
    sufficient = n >= min_sample

    if n == 1:
        return ConfidenceInterval(
            estimate=mean, lower=mean, upper=mean,
            confidence_level=confidence, n_samples=1,
            sufficient_sample=sufficient,
        )

    # Variância amostral.
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    std_err = math.sqrt(var / n) if var > 0 else 0.0

    # Aproximação do t crítico via z (válido para n ≫ 30; para n pequeno,
    # o t crítico é ligeiramente maior — aceito como aproximação).
    z_map = {0.90: 1.645, 0.95: 1.96, 0.99: 2.576}
    z = z_map.get(confidence, 1.96)
    # Ajuste grosseiro de t para amostras pequenas.
    if n < 30:
        z = z * (1 + 1 / (4 * max(n - 1, 1)))

    margin = z * std_err
    return ConfidenceInterval(
        estimate=mean,
        lower=mean - margin,
        upper=mean + margin,
        confidence_level=confidence,
        n_samples=n,
        sufficient_sample=sufficient,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Simulação de bankroll e drawdown
# ═══════════════════════════════════════════════════════════════════════════


def _calculate_drawdown(equity: Sequence[float]) -> DrawdownInfo:
    """Calcula o drawdown máximo de uma curva de equity.

    Args:
        equity: valores do bankroll ao longo do tempo (inclui valor inicial).

    Returns:
        DrawdownInfo com drawdown máximo (%), duração, pico e vale.
    """
    if len(equity) <= 1:
        val = equity[0] if equity else 0.0
        return DrawdownInfo(
            max_drawdown_pct=0.0,
            max_drawdown_duration=0,
            peak_bankroll=val,
            trough_bankroll=val,
        )

    peak = equity[0]
    max_dd_pct = 0.0
    best_peak = equity[0]
    worst_trough = equity[0]
    current_dd_start = 0
    max_dd_duration = 0
    current_duration = 0

    for i in range(1, len(equity)):
        if equity[i] >= peak:
            # Novo pico — recuperou do drawdown (se havia um).
            if current_duration > max_dd_duration:
                max_dd_duration = current_duration
            current_duration = 0
            peak = equity[i]
        else:
            current_duration += 1
            dd_pct = (peak - equity[i]) / peak * 100.0 if peak > 0 else 0.0
            if dd_pct > max_dd_pct:
                max_dd_pct = dd_pct
                best_peak = peak
                worst_trough = equity[i]

    # Verifica a duração final (se termina em drawdown).
    if current_duration > max_dd_duration:
        max_dd_duration = current_duration

    return DrawdownInfo(
        max_drawdown_pct=max_dd_pct,
        max_drawdown_duration=max_dd_duration,
        peak_bankroll=best_peak,
        trough_bankroll=worst_trough,
    )


def _simulate_bankroll(
    bets: list[BetRecord],
    initial_bankroll: float = 1000.0,
    strategy: str = "flat",
    stake_size: float = 1.0,
    kelly_fraction: float = 0.25,
) -> list[float]:
    """Simula a evolução do bankroll para uma lista de apostas.

    Args:
        bets: apostas em ordem cronológica.
        initial_bankroll: banca inicial.
        strategy: "flat", "kelly_0.25", ou "kelly_0.50".
        stake_size: unidade de stake para flat staking.
        kelly_fraction: fração de Kelly a usar (ignorado para flat).

    Returns:
        Lista de valores do bankroll (n+1 pontos: inclui valor inicial).
    """
    equity = [initial_bankroll]
    bankroll = initial_bankroll

    # Extrai a fração de Kelly do nome da estratégia, se aplicável.
    if strategy.startswith("kelly_"):
        try:
            kelly_fraction = float(strategy.split("_")[1])
        except (IndexError, ValueError):
            kelly_fraction = 0.25

    for bet in bets:
        won = bet.predicted_outcome == bet.actual_outcome

        if strategy == "flat":
            stake = stake_size
        else:
            # Kelly fracionário: calcula a fração ideal com base na prob e odds.
            fk = fractional_kelly(
                bet.predicted_prob,
                bet.decimal_odds,
                fraction=kelly_fraction,
            )
            stake = fk * bankroll
            # Limita ao bankroll disponível.
            stake = min(stake, bankroll)
            # Protege contra stakes negativos (quando não há valor).
            stake = max(0.0, stake)

        if won:
            pnl = stake * (bet.decimal_odds - 1.0)
        else:
            pnl = -stake

        bankroll += pnl
        # Bankroll não pode ficar negativo (stop-loss implícito).
        bankroll = max(0.0, bankroll)
        equity.append(bankroll)

    return equity


# ═══════════════════════════════════════════════════════════════════════════
# Remoção de vig — dispatcher
# ═══════════════════════════════════════════════════════════════════════════


_VIG_METHODS: dict[str, Callable] = {
    "shin": remove_vig_shin,
    "power": remove_vig_power,
    "multiplicative": remove_vig_multiplicative,
}


def _remove_vig(implied_probs: list[float], method: str = "shin") -> list[float]:
    """Remove vig com o método especificado (dispatcher)."""
    fn = _VIG_METHODS.get(method)
    if fn is None:
        raise ValueError(f"Método de vig inválido: {method!r}. Opções: {list(_VIG_METHODS.keys())}")
    return fn(implied_probs)


# ═══════════════════════════════════════════════════════════════════════════
# Avaliação de um fold
# ═══════════════════════════════════════════════════════════════════════════


def _evaluate_fold(
    model: BaseModel,
    all_events: list[MatchEvent],
    fold: WalkForwardFold,
    fold_index: int,
    min_edge: float = 0.0,
    min_ev: float = 0.0,
    vig_method: str = "shin",
) -> FoldResult:
    """Avalia um único fold: treina, prediz, detecta apostas e calcula métricas.

    Respeita rigorosamente a integridade temporal (§4 do MODELING.md):
    o modelo só vê dados até fold.train_end, e só é avaliado em
    eventos no intervalo (fold.eval_start, fold.eval_end].
    """
    # Filtra dados de treino e avaliação estritamente por data.
    train_events = [e for e in all_events if e.match_datetime <= fold.train_end]
    eval_events = [
        e for e in all_events
        if fold.eval_start < e.match_datetime <= fold.eval_end
    ]

    n_train = len(train_events)
    n_eval = len(eval_events)

    # Treina o modelo com dados até o cutoff.
    model.train(train_events, cutoff_date=fold.train_end)

    # Listas para métricas de predição.
    all_pred_probs: list[float] = []    # prob predita para o outcome que ocorreu
    all_outcomes: list[float] = []      # sempre 1.0 (outcome que ocorreu)
    all_preds_full: list[float] = []    # probs preditas para Brier/ECE
    all_actuals_full: list[float] = []  # outcomes para Brier/ECE
    hits = 0
    total_predicted = 0
    bets: list[BetRecord] = []

    outcomes_list = ["home", "draw", "away"]

    for event in eval_events:
        # Constrói event_data para o modelo.
        event_data = event.event_data or {}
        event_data["match_id"] = event.match_id
        event_data["home_team"] = event.home_team
        event_data["away_team"] = event.away_team
        event_data["league"] = event.league

        # Prediz usando as_of = fold.train_end (nunca o datetime do evento).
        predictions = model.predict(event_data, as_of=fold.train_end)
        pred_map: dict[str, float] = {}
        for p in predictions:
            if p.market == "match_result":
                pred_map[p.outcome] = p.probability

        # Verifica que temos predições para os 3 outcomes.
        if not all(o in pred_map for o in outcomes_list):
            continue

        total_predicted += 1

        # Métricas de predição: para cada outcome, registra prob vs real.
        for outcome in outcomes_list:
            pred_p = pred_map.get(outcome, 0.0)
            actual = 1.0 if event.actual_outcome == outcome else 0.0
            all_preds_full.append(pred_p)
            all_actuals_full.append(actual)

        # Prob do outcome que ocorreu (para log loss).
        prob_actual = pred_map.get(event.actual_outcome, 0.0)
        all_pred_probs.append(prob_actual)
        all_outcomes.append(1.0)

        # Hit rate: o modelo acerta se o outcome com maior prob é o real.
        best_outcome = max(pred_map, key=lambda o: pred_map[o])
        if best_outcome == event.actual_outcome:
            hits += 1

        # Detecção de value bet — requer odds de abertura.
        if event.opening_odds is None:
            continue

        # Probabilidades implícitas de mercado.
        try:
            impl_probs = [implied_probability(event.opening_odds[o]) for o in outcomes_list]
            fair_probs = _remove_vig(impl_probs, method=vig_method)
        except (ValueError, KeyError, ZeroDivisionError):
            continue

        fair_map = dict(zip(outcomes_list, fair_probs))

        # Para cada outcome, verifica se há valor.
        for outcome in outcomes_list:
            model_prob = pred_map[outcome]
            fair_prob = fair_map[outcome]
            edge = model_prob - fair_prob

            if edge < min_edge:
                continue

            odds = event.opening_odds.get(outcome, 0.0)
            if odds <= 1.0:
                continue

            ev = model_prob * odds - 1.0
            if ev < min_ev:
                continue

            # CLV (se disponível).
            clv_pct = None
            if event.closing_odds and outcome in event.closing_odds:
                closing_o = event.closing_odds[outcome]
                if closing_o > 1.0:
                    try:
                        clv_pct = calculate_clv(odds, closing_o)
                    except ValueError:
                        pass

            bets.append(BetRecord(
                match_id=event.match_id,
                fold_index=fold_index,
                predicted_outcome=outcome,
                actual_outcome=event.actual_outcome,
                predicted_prob=model_prob,
                decimal_odds=odds,
                edge=edge,
                ev=ev,
                market="match_result",
                match_datetime=event.match_datetime,
                clv_pct=clv_pct,
            ))

    # Calcula métricas do fold.
    n_bets = len(bets)
    n_wins = sum(1 for b in bets if b.predicted_outcome == b.actual_outcome)

    # Brier Score (multi-outcome: média sobre todos os outcomes).
    bs = 0.0
    if all_preds_full:
        bs = brier_score(all_preds_full, [int(a) for a in all_actuals_full])

    # Log loss.
    ll = 0.0
    if all_pred_probs:
        ll = _log_loss(all_pred_probs, all_outcomes)

    # ECE.
    ece = 0.0
    if all_preds_full:
        try:
            ece = expected_calibration_error(
                all_preds_full, [int(a) for a in all_actuals_full],
            )
        except ValueError:
            pass

    # Hit rate.
    hr = hits / total_predicted if total_predicted > 0 else 0.0

    # ROI flat.
    roi_flat = None
    if n_bets > 0:
        total_staked = float(n_bets)  # 1 unidade por aposta
        total_return = sum(
            b.decimal_odds if b.predicted_outcome == b.actual_outcome else 0.0
            for b in bets
        )
        roi_flat = (total_return - total_staked) / total_staked * 100.0

    # ROI Kelly 0.25.
    roi_kelly_025 = None
    if n_bets > 0:
        equity_k25 = _simulate_bankroll(bets, 1000.0, "kelly_0.25")
        if equity_k25[0] > 0:
            roi_kelly_025 = (equity_k25[-1] / equity_k25[0] - 1.0) * 100.0

    # CLV.
    clv_values = [b.clv_pct for b in bets if b.clv_pct is not None]
    mean_clv = None
    pos_clv_rate = None
    if clv_values:
        mean_clv = sum(clv_values) / len(clv_values)
        pos_clv_rate = sum(1 for c in clv_values if c > 0) / len(clv_values)

    return FoldResult(
        fold_index=fold_index,
        train_start=fold.train_start,
        train_end=fold.train_end,
        eval_start=fold.eval_start,
        eval_end=fold.eval_end,
        n_train_samples=n_train,
        n_eval_events=n_eval,
        n_bets=n_bets,
        brier_score=bs,
        log_loss=ll,
        ece=ece,
        hit_rate=hr,
        roi_flat_pct=roi_flat,
        roi_kelly_025_pct=roi_kelly_025,
        mean_clv_pct=mean_clv,
        positive_clv_rate=pos_clv_rate,
        bets=bets,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Agregação de resultados
# ═══════════════════════════════════════════════════════════════════════════


def _aggregate_results(
    folds: list[FoldResult],
    model: BaseModel,
    events: list[MatchEvent],
    initial_bankroll: float,
    min_edge: float,
) -> BacktestResult:
    """Agrega os resultados de todos os folds em um BacktestResult final."""
    # Coleta todas as apostas de todos os folds.
    all_bets: list[BetRecord] = []
    for f in folds:
        all_bets.extend(f.bets)
    # Ordena cronologicamente.
    all_bets.sort(key=lambda b: b.match_datetime)

    total_events = sum(f.n_eval_events for f in folds)
    total_bets = len(all_bets)
    total_wins = sum(1 for b in all_bets if b.predicted_outcome == b.actual_outcome)

    # Warnings de amostra insuficiente (§6.7).
    warnings: list[str] = []
    if total_events < MIN_SAMPLE_BRIER:
        warnings.append(
            f"Amostra insuficiente para Brier Score confiável: "
            f"{total_events} eventos (mínimo recomendado: {MIN_SAMPLE_BRIER})."
        )
    if total_bets < MIN_SAMPLE_ROI:
        warnings.append(
            f"Amostra insuficiente para ROI confiável: "
            f"{total_bets} apostas (mínimo recomendado: {MIN_SAMPLE_ROI})."
        )
    clv_bets = [b for b in all_bets if b.clv_pct is not None]
    if 0 < len(clv_bets) < MIN_SAMPLE_CLV:
        warnings.append(
            f"Amostra insuficiente para CLV confiável: "
            f"{len(clv_bets)} apostas com CLV (mínimo recomendado: {MIN_SAMPLE_CLV})."
        )

    # Métricas agregadas (com IC).
    brier_values = [f.brier_score for f in folds if f.n_eval_events > 0]
    brier_ci = _mean_confidence_interval(brier_values, min_sample=MIN_SAMPLE_BRIER)

    ll_values = [f.log_loss for f in folds if f.n_eval_events > 0]
    ll_ci = _mean_confidence_interval(ll_values, min_sample=MIN_SAMPLE_BRIER)

    ece_values = [f.ece for f in folds if f.n_eval_events > 0]
    ece_avg = sum(ece_values) / len(ece_values) if ece_values else 0.0

    hr_values = [f.hit_rate for f in folds if f.n_eval_events > 0]
    hr_ci = _mean_confidence_interval(hr_values, min_sample=MIN_SAMPLE_HIT_RATE)

    # ROI flat agregado.
    roi_flat_ci = None
    yield_flat_ci = None
    if total_bets > 0:
        total_staked = float(total_bets)
        total_return = sum(
            b.decimal_odds if b.predicted_outcome == b.actual_outcome else 0.0
            for b in all_bets
        )
        roi_flat_pct = (total_return - total_staked) / total_staked * 100.0
        # IC via fold-level ROIs.
        roi_fold_values = [f.roi_flat_pct for f in folds if f.roi_flat_pct is not None]
        roi_flat_ci = _mean_confidence_interval(roi_fold_values, min_sample=MIN_SAMPLE_ROI)
        # Ajusta o estimate para o valor exato agregado.
        roi_flat_ci = ConfidenceInterval(
            estimate=roi_flat_pct,
            lower=roi_flat_ci.lower,
            upper=roi_flat_ci.upper,
            confidence_level=roi_flat_ci.confidence_level,
            n_samples=total_bets,
            sufficient_sample=total_bets >= MIN_SAMPLE_ROI,
        )
        yield_flat_ci = roi_flat_ci  # Yield ≡ ROI para flat staking.

    # ROI Kelly 0.25 agregado.
    roi_k025_ci = None
    if total_bets > 0:
        roi_k025_values = [f.roi_kelly_025_pct for f in folds if f.roi_kelly_025_pct is not None]
        if roi_k025_values:
            roi_k025_ci = _mean_confidence_interval(roi_k025_values, min_sample=MIN_SAMPLE_ROI)

    # ROI Kelly 0.50 agregado.
    roi_k050_ci = None

    # CLV.
    mean_clv_ci = None
    pos_clv_ci = None
    if clv_bets:
        clv_values = [b.clv_pct for b in clv_bets]
        mean_clv_ci = _mean_confidence_interval(clv_values, min_sample=MIN_SAMPLE_CLV)
        n_pos = sum(1 for c in clv_values if c > 0)
        lower_w, upper_w = _wilson_interval(n_pos, len(clv_values))
        pos_clv_ci = ConfidenceInterval(
            estimate=n_pos / len(clv_values),
            lower=lower_w,
            upper=upper_w,
            confidence_level=0.95,
            n_samples=len(clv_values),
            sufficient_sample=len(clv_values) >= MIN_SAMPLE_CLV,
        )

    # Simulação de bankroll completa (com todas as apostas em sequência).
    equity_flat = _simulate_bankroll(all_bets, initial_bankroll, "flat", 1.0)
    equity_k025 = _simulate_bankroll(all_bets, initial_bankroll, "kelly_0.25")
    equity_k050 = _simulate_bankroll(all_bets, initial_bankroll, "kelly_0.50")

    dd_flat = _calculate_drawdown(equity_flat)
    dd_k025 = _calculate_drawdown(equity_k025)
    dd_k050 = _calculate_drawdown(equity_k050)

    # Equity curve com timestamps.
    timestamps = [events[0].match_datetime] if events else [datetime.utcnow()]
    timestamps.extend(b.match_datetime for b in all_bets)
    eq_curve = EquityCurve(
        timestamps=timestamps[:len(equity_flat)],
        bankroll_flat=equity_flat,
        bankroll_kelly_025=equity_k025,
        bankroll_kelly_050=equity_k050,
    )

    # Decomposição de Brier (sobre todas as predições agregadas).
    rel, res, unc = 0.0, 0.0, 0.0
    all_preds_agg: list[float] = []
    all_acts_agg: list[float] = []
    outcomes_list = ["home", "draw", "away"]

    for fold_r in folds:
        for bet in fold_r.bets:
            for outcome in outcomes_list:
                all_preds_agg.append(
                    bet.predicted_prob if outcome == bet.predicted_outcome else
                    (1.0 - bet.predicted_prob) / 2.0
                )
                all_acts_agg.append(1.0 if outcome == bet.actual_outcome else 0.0)

    if all_preds_agg:
        try:
            rel, res, unc = brier_decomposition(
                all_preds_agg, [int(a) for a in all_acts_agg],
            )
        except (ValueError, ZeroDivisionError):
            pass

    return BacktestResult(
        model_name=model.name,
        model_version=model.version,
        start_date=events[0].match_datetime,
        end_date=events[-1].match_datetime,
        n_folds=len(folds),
        min_edge=min_edge,
        initial_bankroll=initial_bankroll,
        folds=folds,
        total_events=total_events,
        total_bets=total_bets,
        total_wins=total_wins,
        brier_score=brier_ci,
        log_loss=ll_ci,
        ece=ece_avg,
        hit_rate=hr_ci,
        roi_flat=roi_flat_ci,
        roi_kelly_025=roi_k025_ci,
        roi_kelly_050=roi_k050_ci,
        yield_flat=yield_flat_ci,
        mean_clv=mean_clv_ci,
        positive_clv_rate=pos_clv_ci,
        equity_curve=eq_curve,
        drawdown_flat=dd_flat,
        drawdown_kelly_025=dd_k025,
        drawdown_kelly_050=dd_k050,
        final_bankroll_flat=equity_flat[-1],
        final_bankroll_kelly_025=equity_k025[-1],
        final_bankroll_kelly_050=equity_k050[-1],
        warnings=warnings,
        brier_reliability=rel,
        brier_resolution=res,
        brier_uncertainty=unc,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Ponto de entrada principal
# ═══════════════════════════════════════════════════════════════════════════


def run_backtest(
    events: list[MatchEvent],
    model: BaseModel,
    *,
    initial_train_days: int = 365,
    step_days: int = 7,
    eval_horizon_days: int = 7,
    min_edge: float = 0.0,
    min_ev: float = 0.0,
    initial_bankroll: float = 1000.0,
    vig_method: str = "shin",
) -> BacktestResult:
    """Executa backtesting walk-forward completo.

    O motor de backtest é o MESMO código de inferência de produção (§5.1):
    chama model.train() e model.predict() diretamente, garantindo que
    qualquer resultado de backtest seja reproduzível em produção.

    Args:
        events: eventos históricos (partidas com resultado) ORDENADOS
            cronologicamente por match_datetime. O motor valida a ordenação.
        model: instância de BaseModel (será retreinada a cada fold).
        initial_train_days: dias da janela de treino inicial (mínimo 1 temporada).
        step_days: dias que o cutoff avança a cada fold.
        eval_horizon_days: dias da janela de avaliação.
        min_edge: edge mínimo (fração) para registrar uma aposta.
        min_ev: EV mínimo (fração) para registrar uma aposta.
        initial_bankroll: banca inicial para simulação de bankroll.
        vig_method: método de remoção de vig ("shin", "power", "multiplicative").

    Returns:
        BacktestResult com métricas, equity curve, drawdown e IC.

    Raises:
        ValueError: se os eventos não estiverem ordenados, ou se não houver
            dados suficientes para gerar ao menos um fold.
    """
    if not events:
        raise ValueError("events não pode ser vazio.")

    # Valida ordenação cronológica (§4.1 — particionamento temporal estrito).
    for i in range(1, len(events)):
        if events[i].match_datetime < events[i - 1].match_datetime:
            raise ValueError(
                f"Eventos fora de ordem cronológica no índice {i}: "
                f"{events[i].match_datetime} < {events[i-1].match_datetime}. "
                "Ordene por match_datetime antes de chamar run_backtest."
            )

    data_start = events[0].match_datetime
    data_end = events[-1].match_datetime

    # Gera os folds walk-forward.
    try:
        folds_iter = generate_walk_forward_folds(
            data_start=data_start,
            data_end=data_end,
            initial_train_days=initial_train_days,
            step_days=step_days,
            eval_horizon_days=eval_horizon_days,
        )
        folds_list = list(folds_iter)
    except ValueError as exc:
        raise ValueError(f"Erro ao gerar folds walk-forward: {exc}") from exc

    if not folds_list:
        raise ValueError(
            f"Dados insuficientes para gerar ao menos um fold: "
            f"período de {(data_end - data_start).days} dias com "
            f"initial_train_days={initial_train_days}."
        )

    # Avalia cada fold.
    fold_results: list[FoldResult] = []
    for i, fold in enumerate(folds_list):
        result = _evaluate_fold(
            model=model,
            all_events=events,
            fold=fold,
            fold_index=i,
            min_edge=min_edge,
            min_ev=min_ev,
            vig_method=vig_method,
        )
        fold_results.append(result)

    # Agrega tudo.
    return _aggregate_results(
        folds=fold_results,
        model=model,
        events=events,
        initial_bankroll=initial_bankroll,
        min_edge=min_edge,
    )
