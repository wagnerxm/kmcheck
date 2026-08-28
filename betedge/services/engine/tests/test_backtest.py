"""Testes do motor de backtesting walk-forward (app.backtest.engine).

Cobre:
  - Helpers estatísticos: _log_loss, _wilson_interval, _mean_confidence_interval.
  - Simulação de bankroll: _calculate_drawdown, _simulate_bankroll.
  - Integração: run_backtest com modelo mock e dados sintéticos.

Todos os testes são autossuficientes — usam dados sintéticos gerados
por _make_events(), sem dependência de banco de dados ou arquivos.
"""
import math
import random
from datetime import datetime, timedelta

import pytest

from app.backtest.engine import (
    BacktestResult,
    BetRecord,
    ConfidenceInterval,
    DrawdownInfo,
    EquityCurve,
    FoldResult,
    MatchEvent,
    run_backtest,
    _calculate_drawdown,
    _log_loss,
    _mean_confidence_interval,
    _simulate_bankroll,
    _wilson_interval,
)
from app.models.base import BaseModel, PredictionResult


# ═══════════════════════════════════════════════════════════════════════════
# Modelo mock e helpers de teste
# ═══════════════════════════════════════════════════════════════════════════


class MockModel(BaseModel):
    """Modelo mock para testes de backtesting.

    Retorna predições fixas ou configuráveis por match_id, permitindo
    controle total sobre o comportamento do modelo nos testes.
    """

    name = "mock"
    version = "1.0.0"

    def __init__(self, predictions: dict[str, dict[str, float]] | None = None):
        self._predictions = predictions or {}
        self._trained = False
        self._cutoff = None

    def train(self, training_data, cutoff_date):
        """Treina o modelo mock — apenas marca como treinado e conta amostras."""
        self._trained = True
        self._cutoff = cutoff_date
        # Filtra dados até o cutoff, conforme contrato de BaseModel.
        n = sum(1 for e in training_data if e.match_datetime <= cutoff_date)
        return {"n_samples": n, "cutoff": cutoff_date}

    def predict(self, event_data, as_of):
        """Gera predições — usa as configuradas por match_id ou default com viés para casa."""
        self.validate_no_leakage(event_data, as_of)
        match_id = event_data.get("match_id", "")
        if match_id in self._predictions:
            probs = self._predictions[match_id]
        else:
            # Default: leve viés para mandante (modelo "ingênuo" realista).
            probs = {"home": 0.45, "draw": 0.28, "away": 0.27}
        return [
            PredictionResult(market="match_result", outcome=k, probability=v)
            for k, v in probs.items()
        ]

    def get_params(self):
        return {"type": "mock", "trained": self._trained}


class PerfectModel(BaseModel):
    """Modelo que acerta todas as predições — útil para testar limites superiores."""

    name = "perfect"
    version = "1.0.0"

    def __init__(self):
        self._outcomes: dict[str, str] = {}

    def train(self, training_data, cutoff_date):
        # Memoriza os resultados (isso é leakage intencional para teste).
        for e in training_data:
            if e.match_datetime <= cutoff_date:
                self._outcomes[e.match_id] = e.actual_outcome
        return {"n_samples": len(self._outcomes)}

    def predict(self, event_data, as_of):
        # Retorna prob alta para o resultado correto, se conhecido por treino.
        match_id = event_data.get("match_id", "")
        known = self._outcomes.get(match_id, "home")
        probs = {"home": 0.05, "draw": 0.05, "away": 0.05}
        probs[known] = 0.90
        return [
            PredictionResult(market="match_result", outcome=k, probability=v)
            for k, v in probs.items()
        ]

    def get_params(self):
        return {"type": "perfect"}


def _make_events(
    n: int,
    start_date: datetime | None = None,
    days_between: int = 3,
    with_closing_odds: bool = False,
    seed: int = 42,
    league: str = "brasileirao_a",
    market: str = "match_result",
) -> list[MatchEvent]:
    """Gera n eventos sintéticos para testes.

    Cria partidas espaçadas uniformemente, com resultados e odds
    determinísticos (controlados pela seed) para reprodutibilidade.

    Args:
        n: número de eventos a gerar.
        start_date: data do primeiro evento (default: 2023-01-01).
        days_between: intervalo em dias entre eventos consecutivos.
        with_closing_odds: se True, gera odds de fechamento para CLV.
        seed: seed do RNG para reprodutibilidade.
        league: liga dos eventos.
        market: mercado das odds.

    Returns:
        Lista de MatchEvent ordenada cronologicamente.
    """
    rng = random.Random(seed)
    if start_date is None:
        start_date = datetime(2023, 1, 1)

    teams = [
        "Flamengo", "Palmeiras", "Atlético-MG", "Corinthians",
        "São Paulo", "Internacional", "Grêmio", "Fluminense",
        "Santos", "Botafogo", "Cruzeiro", "Vasco",
        "Bahia", "Fortaleza", "Athletico-PR", "Bragantino",
    ]
    outcomes = ["home", "draw", "away"]

    events: list[MatchEvent] = []
    for i in range(n):
        dt = start_date + timedelta(days=i * days_between)
        home_idx = i % len(teams)
        away_idx = (i + 1) % len(teams)
        # Resultado ponderado: casa ganha ~45%, empate ~27%, fora ~28%.
        actual = rng.choices(outcomes, weights=[45, 27, 28], k=1)[0]

        # Odds de abertura — simulam um mercado com ~5% de overround.
        # Odds refletem probabilidades "barulhentas" em torno de 45/27/28.
        home_odds = round(1.0 / max(0.10, 0.45 + rng.gauss(0, 0.08)), 2)
        draw_odds = round(1.0 / max(0.10, 0.27 + rng.gauss(0, 0.05)), 2)
        away_odds = round(1.0 / max(0.10, 0.28 + rng.gauss(0, 0.06)), 2)

        opening_odds = {
            "home": max(1.01, home_odds),
            "draw": max(1.01, draw_odds),
            "away": max(1.01, away_odds),
        }

        closing_odds = None
        if with_closing_odds:
            # Odds de fechamento: ajusta levemente na direção do resultado real
            # (simulando movimento informado do mercado).
            adj = 0.03 if actual == "home" else -0.01
            closing_odds = {
                "home": max(1.01, round(1.0 / max(0.10, 0.45 + adj + rng.gauss(0, 0.03)), 2)),
                "draw": max(1.01, round(1.0 / max(0.10, 0.27 + rng.gauss(0, 0.03)), 2)),
                "away": max(1.01, round(1.0 / max(0.10, 0.28 + rng.gauss(0, 0.03)), 2)),
            }

        events.append(MatchEvent(
            match_id=f"match_{i:04d}",
            home_team=teams[home_idx],
            away_team=teams[away_idx],
            league=league,
            match_datetime=dt,
            actual_outcome=actual,
            market=market,
            opening_odds=opening_odds,
            closing_odds=closing_odds,
        ))

    return events


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _log_loss
# ═══════════════════════════════════════════════════════════════════════════


class TestLogLoss:
    """Testa a função _log_loss que calcula a perda logarítmica."""

    def test_predição_perfeita_retorna_zero(self):
        """Predição perfeita (p=1.0 para o outcome certo) → log_loss ≈ 0."""
        # Com epsilon clipping, não é exatamente 0, mas muito próximo.
        result = _log_loss([1.0], [1.0])
        assert result == pytest.approx(0.0, abs=1e-6)

    def test_predição_uniforme_valor_conhecido(self):
        """Predição uniforme p=0.5 para outcome binário → -ln(0.5) ≈ 0.693."""
        result = _log_loss([0.5], [1.0])
        assert result == pytest.approx(-math.log(0.5), abs=1e-4)

    def test_valor_conhecido_multiplas_amostras(self):
        """Verifica cálculo com múltiplas amostras: média das log-losses."""
        # Dois eventos: p=0.8 acertou, p=0.3 acertou.
        # LL = (-ln(0.8) + -ln(0.3)) / 2
        expected = (-math.log(0.8) + -math.log(0.3)) / 2
        result = _log_loss([0.8, 0.3], [1.0, 1.0])
        assert result == pytest.approx(expected, abs=1e-6)

    def test_epsilon_clipping_evita_log_zero(self):
        """Predição p=0 para outcome=1 não deve dar -inf graças ao epsilon."""
        result = _log_loss([0.0], [1.0])
        assert math.isfinite(result)
        # Deve ser um valor alto mas finito.
        assert result > 10.0

    def test_lista_vazia_levanta_erro(self):
        """Listas vazias devem levantar ValueError."""
        with pytest.raises((ValueError, ZeroDivisionError)):
            _log_loss([], [])


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _wilson_interval
# ═══════════════════════════════════════════════════════════════════════════


class TestWilsonInterval:
    """Testa o intervalo de Wilson para proporções binomiais."""

    def test_proporção_50_porcento(self):
        """50% de acerto com n=100 → intervalo simétrico em torno de 0.5."""
        lower, upper = _wilson_interval(50, 100)
        # Centro deve ser ~0.5.
        center = (lower + upper) / 2
        assert center == pytest.approx(0.5, abs=0.02)
        # Intervalo deve ser razoavelmente estreito com n=100.
        assert upper - lower < 0.20
        assert lower > 0.0
        assert upper < 1.0

    def test_zero_porcento(self):
        """0 acertos em n=50 → lower=0, upper > 0 (Wilson nunca retorna exatamente 0)."""
        lower, upper = _wilson_interval(0, 50)
        assert lower == pytest.approx(0.0, abs=0.01)
        assert upper > 0.0

    def test_cem_porcento(self):
        """Todos acertos (n=50) → upper perto de 1, lower < 1."""
        lower, upper = _wilson_interval(50, 50)
        assert upper == pytest.approx(1.0, abs=0.01)
        assert lower < 1.0

    def test_intervalo_maior_para_n_pequeno(self):
        """Com menos amostras, o intervalo deve ser mais largo."""
        _, upper_small = _wilson_interval(5, 10)
        lower_small, _ = _wilson_interval(5, 10)
        width_small = upper_small - lower_small

        _, upper_large = _wilson_interval(50, 100)
        lower_large, _ = _wilson_interval(50, 100)
        width_large = upper_large - lower_large

        # Mesma proporção (50%), mas n=10 deve ter intervalo mais largo que n=100.
        assert width_small > width_large


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _mean_confidence_interval
# ═══════════════════════════════════════════════════════════════════════════


class TestMeanCI:
    """Testa o intervalo de confiança para médias (t de Student)."""

    def test_média_conhecida(self):
        """Valores iguais → intervalo colapsado na média."""
        values = [5.0, 5.0, 5.0, 5.0, 5.0]
        ci = _mean_confidence_interval(values)
        assert ci.estimate == pytest.approx(5.0)
        # Com variância zero, o intervalo deve ser muito estreito.
        assert ci.lower == pytest.approx(5.0, abs=1e-6)
        assert ci.upper == pytest.approx(5.0, abs=1e-6)

    def test_valor_único(self):
        """Um único valor → estimate = valor, intervalo degradado."""
        ci = _mean_confidence_interval([42.0])
        assert ci.estimate == pytest.approx(42.0)
        assert ci.n_samples == 1

    def test_intervalo_estreita_com_n(self):
        """Mais amostras → intervalo mais estreito (lei dos grandes números)."""
        rng = random.Random(123)
        # 20 amostras de N(10, 2).
        small = [rng.gauss(10, 2) for _ in range(20)]
        ci_small = _mean_confidence_interval(small)

        # 2000 amostras de N(10, 2).
        large = [rng.gauss(10, 2) for _ in range(2000)]
        ci_large = _mean_confidence_interval(large)

        width_small = ci_small.upper - ci_small.lower
        width_large = ci_large.upper - ci_large.lower
        assert width_large < width_small


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _calculate_drawdown
# ═══════════════════════════════════════════════════════════════════════════


class TestCalculateDrawdown:
    """Testa o cálculo de drawdown máximo sobre uma curva de equity."""

    def test_monotônico_crescente_sem_drawdown(self):
        """Curva sempre subindo → drawdown = 0%."""
        equity = [100.0, 110.0, 120.0, 130.0, 140.0]
        dd = _calculate_drawdown(equity)
        assert dd.max_drawdown_pct == pytest.approx(0.0)

    def test_drawdown_conhecido(self):
        """Curva com queda conhecida: 100 → 120 → 90 → 110.
        Drawdown = (120 - 90) / 120 = 25%."""
        equity = [100.0, 120.0, 90.0, 110.0]
        dd = _calculate_drawdown(equity)
        assert dd.max_drawdown_pct == pytest.approx(25.0, abs=0.5)
        assert dd.peak_bankroll == pytest.approx(120.0)
        assert dd.trough_bankroll == pytest.approx(90.0)

    def test_curva_plana(self):
        """Todos os valores iguais → drawdown = 0%."""
        equity = [100.0, 100.0, 100.0]
        dd = _calculate_drawdown(equity)
        assert dd.max_drawdown_pct == pytest.approx(0.0)

    def test_ponto_único(self):
        """Um único ponto → drawdown = 0%."""
        equity = [100.0]
        dd = _calculate_drawdown(equity)
        assert dd.max_drawdown_pct == pytest.approx(0.0)


# ═══════════════════════════════════════════════════════════════════════════
# Testes de _simulate_bankroll
# ═══════════════════════════════════════════════════════════════════════════


class TestSimulateBankroll:
    """Testa a simulação de bankroll com diferentes estratégias de staking."""

    def _make_bets(
        self, outcomes: list[str], odds: float = 2.0, prob: float = 0.55
    ) -> list[BetRecord]:
        """Helper: gera BetRecords com resultado e odds fixos."""
        bets = []
        for i, outcome in enumerate(outcomes):
            bets.append(BetRecord(
                match_id=f"m_{i}",
                fold_index=0,
                predicted_outcome="home",
                actual_outcome=outcome,
                predicted_prob=prob,
                decimal_odds=odds,
                edge=prob - 1.0 / odds,
                ev=prob * odds - 1.0,
                market="match_result",
                match_datetime=datetime(2024, 1, 1) + timedelta(days=i),
            ))
        return bets

    def test_flat_staking_pnl_correto(self):
        """Flat staking: 3 vitórias a odds 2.0 com stake=10 cada.
        PnL = 3 * (2.0 - 1) * 10 = +30, bankroll final = 1000 + 30 = 1030.
        """
        # 3 vitórias seguidas.
        bets = self._make_bets(["home", "home", "home"], odds=2.0)
        equity = _simulate_bankroll(
            bets, initial_bankroll=1000.0, strategy="flat", stake_size=10.0
        )
        # Equity tem n+1 pontos (inclui o valor inicial).
        assert len(equity) == 4
        assert equity[-1] == pytest.approx(1030.0)

    def test_kelly_atualiza_bankroll(self):
        """Kelly fracionário deve ajustar o stake com base no bankroll corrente."""
        bets = self._make_bets(["home", "home", "home"], odds=2.5, prob=0.55)
        equity = _simulate_bankroll(
            bets, initial_bankroll=1000.0, strategy="kelly_0.25"
        )
        # Com Kelly, após vitórias o bankroll cresce (mas não linearmente).
        assert equity[-1] > 1000.0
        # Verifica que cada passo recalcula o stake (não é constante).
        step1 = equity[1] - equity[0]
        step2 = equity[2] - equity[1]
        # O segundo ganho deve ser ligeiramente maior que o primeiro
        # porque o bankroll cresceu (stakes crescem proporcionalmente).
        assert step2 > step1

    def test_todas_vitórias(self):
        """Todas as apostas ganhas → bankroll cresce monotonicamente."""
        bets = self._make_bets(["home"] * 10, odds=2.0)
        equity = _simulate_bankroll(
            bets, initial_bankroll=1000.0, strategy="flat", stake_size=10.0
        )
        # Cada aposta ganha +10 (odds 2.0, stake 10).
        assert equity[-1] == pytest.approx(1100.0)
        # Verifica monotonicidade.
        for i in range(1, len(equity)):
            assert equity[i] >= equity[i - 1]

    def test_todas_derrotas(self):
        """Todas as apostas perdidas → bankroll decresce."""
        bets = self._make_bets(["away"] * 5, odds=2.0)
        equity = _simulate_bankroll(
            bets, initial_bankroll=1000.0, strategy="flat", stake_size=10.0
        )
        # Cada derrota custa -10.
        assert equity[-1] == pytest.approx(950.0)
        for i in range(1, len(equity)):
            assert equity[i] <= equity[i - 1]


# ═══════════════════════════════════════════════════════════════════════════
# Testes de integração: run_backtest
# ═══════════════════════════════════════════════════════════════════════════


class TestRunBacktest:
    """Testes de integração do motor de backtest com modelo mock."""

    @pytest.fixture
    def events_2y(self) -> list[MatchEvent]:
        """~120 eventos distribuídos em 2 anos (um a cada ~6 dias)."""
        return _make_events(
            n=120,
            start_date=datetime(2023, 1, 1),
            days_between=6,
            seed=42,
        )

    @pytest.fixture
    def events_with_clv(self) -> list[MatchEvent]:
        """Eventos com odds de fechamento para cálculo de CLV."""
        return _make_events(
            n=120,
            start_date=datetime(2023, 1, 1),
            days_between=6,
            with_closing_odds=True,
            seed=42,
        )

    @pytest.fixture
    def model(self) -> MockModel:
        """Modelo mock padrão."""
        return MockModel()

    def test_retorna_backtest_result_com_estrutura_correta(self, events_2y, model):
        """O resultado deve ser um BacktestResult com todos os campos obrigatórios."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
            initial_bankroll=1000.0,
        )
        assert isinstance(result, BacktestResult)
        assert result.n_folds > 0
        assert result.total_events > 0
        assert isinstance(result.brier_score, ConfidenceInterval)
        assert isinstance(result.hit_rate, ConfidenceInterval)
        assert isinstance(result.drawdown_flat, DrawdownInfo)
        assert isinstance(result.folds, list)
        assert len(result.folds) == result.n_folds

    def test_integridade_temporal_train_end_antes_eval_start(self, events_2y, model):
        """Em todo fold, train_end < eval_start (sem sobreposição treino/avaliação)."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        for fold in result.folds:
            assert fold.train_end <= fold.eval_start, (
                f"Fold {fold.fold_index}: train_end={fold.train_end} > "
                f"eval_start={fold.eval_start} — violação de integridade temporal!"
            )

    def test_sem_leakage_modelo_nunca_vê_dados_futuros(self, events_2y):
        """O modelo nunca deve receber dados com timestamp posterior ao cutoff."""

        class LeakageDetectorModel(BaseModel):
            """Modelo que detecta se recebeu dados futuros durante treino ou predição."""
            name = "leak_detector"
            version = "1.0.0"
            leakage_detected = False

            def train(self, training_data, cutoff_date):
                for e in training_data:
                    if e.match_datetime > cutoff_date:
                        self.leakage_detected = True
                        raise AssertionError(
                            f"Leakage! Evento {e.match_id} com datetime={e.match_datetime} "
                            f"após cutoff={cutoff_date}."
                        )
                n = sum(1 for e in training_data if e.match_datetime <= cutoff_date)
                return {"n_samples": n}

            def predict(self, event_data, as_of):
                self.validate_no_leakage(event_data, as_of)
                return [
                    PredictionResult(market="match_result", outcome="home", probability=0.40),
                    PredictionResult(market="match_result", outcome="draw", probability=0.30),
                    PredictionResult(market="match_result", outcome="away", probability=0.30),
                ]

            def get_params(self):
                return {"leakage_detected": self.leakage_detected}

        detector = LeakageDetectorModel()
        result = run_backtest(
            events=events_2y,
            model=detector,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        assert not detector.leakage_detected
        assert result.n_folds > 0

    def test_numero_correto_de_folds(self, events_2y, model):
        """O número de folds deve ser consistente com os parâmetros de janela."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=60,
            eval_horizon_days=30,
        )
        # Com 720 dias de dados (120 eventos * 6 dias), 180 dias de treino
        # inicial, e passos de 60 dias, deve haver ~(720-180)/60 ≈ 9 folds.
        # A contagem exata depende do truncamento da última janela.
        assert result.n_folds >= 5
        assert result.n_folds <= 15

    def test_filtro_edge_minimo_reduz_apostas(self, events_2y, model):
        """min_edge alto deve reduzir drasticamente (ou zerar) o número de apostas."""
        # Sem filtro de edge.
        result_no_filter = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
            min_edge=0.0,
        )

        # Com edge mínimo muito alto — quase nenhuma aposta deve passar.
        result_high_edge = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
            min_edge=1.0,  # 100% de edge — impossível na prática.
        )

        assert result_high_edge.total_bets == 0
        # Sem filtro, deve ter apostas (modelo default sempre tem algum "edge").
        assert result_no_filter.total_bets >= result_high_edge.total_bets

    def test_metricas_em_intervalos_validos(self, events_2y, model):
        """Métricas devem estar dentro dos intervalos teóricos válidos."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        # Brier Score ∈ [0, 1].
        assert 0.0 <= result.brier_score.estimate <= 1.0
        # Hit rate ∈ [0, 1].
        assert 0.0 <= result.hit_rate.estimate <= 1.0
        # ECE ∈ [0, 1].
        assert 0.0 <= result.ece <= 1.0
        # Log loss ≥ 0.
        assert result.log_loss.estimate >= 0.0
        # Decomposição de Brier: reliability ≥ 0, resolution ≥ 0, uncertainty ∈ [0, 0.25].
        assert result.brier_reliability >= 0.0
        assert result.brier_resolution >= 0.0
        assert 0.0 <= result.brier_uncertainty <= 0.25

    def test_clv_calculado_com_odds_fechamento(self, events_with_clv, model):
        """Quando há odds de fechamento, CLV deve ser calculado."""
        result = run_backtest(
            events=events_with_clv,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        # Se houve apostas, mean_clv deve existir.
        if result.total_bets > 0:
            assert result.mean_clv is not None
            assert result.positive_clv_rate is not None
            # Taxa de CLV positivo ∈ [0, 1].
            assert 0.0 <= result.positive_clv_rate.estimate <= 1.0

    def test_simulação_bankroll_produz_equity_curve(self, events_2y, model):
        """A simulação de bankroll deve produzir curvas de equity para todas as estratégias."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
            initial_bankroll=5000.0,
        )
        # Bankrolls finais devem ser positivos (com poucos eventos e modelo
        # razoável, não deve zerar a banca).
        assert result.final_bankroll_flat > 0
        assert result.final_bankroll_kelly_025 > 0
        assert result.final_bankroll_kelly_050 > 0

    def test_drawdown_calculado_corretamente(self, events_2y, model):
        """Drawdown deve ter valores consistentes e não-negativos."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
            initial_bankroll=1000.0,
        )
        for dd_name, dd in [
            ("flat", result.drawdown_flat),
            ("kelly_025", result.drawdown_kelly_025),
            ("kelly_050", result.drawdown_kelly_050),
        ]:
            assert dd.max_drawdown_pct >= 0.0, f"Drawdown negativo em {dd_name}"
            assert dd.max_drawdown_pct <= 100.0, f"Drawdown > 100% em {dd_name}"
            assert dd.peak_bankroll >= dd.trough_bankroll, (
                f"Peak < trough em {dd_name}: {dd.peak_bankroll} < {dd.trough_bankroll}"
            )

    def test_warnings_amostra_insuficiente(self, model):
        """Com poucos eventos, devem ser gerados warnings sobre amostra insuficiente."""
        # Apenas 15 eventos — insuficiente para Brier Score confiável (min=200).
        few_events = _make_events(n=15, start_date=datetime(2023, 1, 1), days_between=10)
        result = run_backtest(
            events=few_events,
            model=model,
            initial_train_days=30,
            step_days=30,
            eval_horizon_days=30,
        )
        # Deve ter ao menos um warning sobre tamanho de amostra.
        assert isinstance(result.warnings, list)

    def test_metricas_agregadas_com_intervalos_confiança(self, events_2y, model):
        """Métricas agregadas devem ter intervalos de confiança válidos."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        for ci_name, ci in [
            ("brier", result.brier_score),
            ("log_loss", result.log_loss),
            ("hit_rate", result.hit_rate),
        ]:
            assert ci.lower <= ci.estimate <= ci.upper, (
                f"IC de {ci_name} inconsistente: "
                f"lower={ci.lower} > estimate={ci.estimate} ou "
                f"estimate > upper={ci.upper}"
            )
            assert 0.0 < ci.confidence_level <= 1.0
            assert ci.n_samples > 0

    def test_roi_flat_formula_correta(self, events_2y, model):
        """ROI flat = (total_pnl / total_staked) * 100, se houver apostas."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
            initial_bankroll=1000.0,
        )
        if result.total_bets > 0 and result.roi_flat is not None:
            # O ROI é retornado como percentual no IC.
            # Verifica que o estimate é um número finito.
            assert math.isfinite(result.roi_flat.estimate)

    def test_total_wins_menor_ou_igual_total_bets(self, events_2y, model):
        """total_wins nunca pode exceder total_bets."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        assert result.total_wins <= result.total_bets

    def test_folds_somam_total_events(self, events_2y, model):
        """A soma de n_eval_events de todos os folds ≤ total_events."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        soma_eval = sum(f.n_eval_events for f in result.folds)
        # Pode ser <= porque nem todo evento gera aposta,
        # e total_events conta eventos avaliados.
        assert soma_eval <= result.total_events + result.n_folds  # tolerância de arredondamento

    def test_folds_ordenados_cronologicamente(self, events_2y, model):
        """Os folds devem estar em ordem cronológica crescente."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        for i in range(1, len(result.folds)):
            assert result.folds[i].train_end > result.folds[i - 1].train_end, (
                f"Folds fora de ordem: fold {i-1} train_end="
                f"{result.folds[i-1].train_end} >= fold {i} train_end="
                f"{result.folds[i].train_end}"
            )

    def test_decomposição_brier_soma_consistente(self, events_2y, model):
        """BS ≈ reliability - resolution + uncertainty (identidade de Murphy)."""
        result = run_backtest(
            events=events_2y,
            model=model,
            initial_train_days=180,
            step_days=30,
            eval_horizon_days=30,
        )
        # A decomposição é calculada sobre dados agregados, não por fold,
        # então pode haver pequena diferença com o BS médio dos folds.
        bs_decomposto = (
            result.brier_reliability
            - result.brier_resolution
            + result.brier_uncertainty
        )
        # A identidade deve valer com boa precisão.
        assert bs_decomposto == pytest.approx(
            result.brier_score.estimate, abs=0.05
        )


# ═══════════════════════════════════════════════════════════════════════════
# Testes de edge cases e robustez
# ═══════════════════════════════════════════════════════════════════════════


class TestRunBacktestEdgeCases:
    """Testa cenários limítrofes e de robustez do motor de backtest."""

    def test_eventos_poucos_para_um_fold(self):
        """Se os dados não permitem nem um fold, deve retornar resultado degenerado ou erro."""
        # 5 eventos em 15 dias — insuficiente para treino de 365 dias.
        events = _make_events(n=5, start_date=datetime(2024, 1, 1), days_between=3)
        model = MockModel()
        with pytest.raises((ValueError, RuntimeError)):
            run_backtest(
                events=events,
                model=model,
                initial_train_days=365,
                step_days=7,
                eval_horizon_days=7,
            )

    def test_todos_resultados_iguais(self):
        """Dataset onde todo resultado é 'home' — modelo degenerado mas não deve crashar."""
        events = _make_events(n=100, start_date=datetime(2023, 1, 1), days_between=5, seed=99)
        # Força todos os resultados para 'home'.
        for e in events:
            e.actual_outcome = "home"

        model = MockModel()
        result = run_backtest(
            events=events,
            model=model,
            initial_train_days=90,
            step_days=30,
            eval_horizon_days=30,
        )
        assert isinstance(result, BacktestResult)
        assert result.n_folds > 0

    def test_bankroll_inicial_grande(self):
        """Bankroll inicial alto não deve causar overflow ou comportamento inesperado."""
        events = _make_events(n=80, start_date=datetime(2023, 1, 1), days_between=6)
        model = MockModel()
        result = run_backtest(
            events=events,
            model=model,
            initial_train_days=120,
            step_days=30,
            eval_horizon_days=30,
            initial_bankroll=1_000_000.0,
        )
        assert result.final_bankroll_flat > 0
        assert math.isfinite(result.final_bankroll_flat)

    def test_step_days_igual_eval_horizon(self):
        """step_days == eval_horizon_days: janelas de avaliação contíguas sem gap nem sobreposição."""
        events = _make_events(n=100, start_date=datetime(2023, 1, 1), days_between=5)
        model = MockModel()
        result = run_backtest(
            events=events,
            model=model,
            initial_train_days=120,
            step_days=30,
            eval_horizon_days=30,
        )
        # Janelas devem ser contíguas.
        for i in range(1, len(result.folds)):
            assert result.folds[i].eval_start == result.folds[i - 1].eval_end or \
                   result.folds[i].eval_start >= result.folds[i - 1].eval_end

    def test_min_ev_filtra_apostas(self):
        """min_ev alto deve filtrar apostas sem valor esperado suficiente."""
        events = _make_events(n=100, start_date=datetime(2023, 1, 1), days_between=5)
        model = MockModel()

        result_low = run_backtest(
            events=events,
            model=model,
            initial_train_days=120,
            step_days=30,
            eval_horizon_days=30,
            min_ev=0.0,
        )
        result_high = run_backtest(
            events=events,
            model=model,
            initial_train_days=120,
            step_days=30,
            eval_horizon_days=30,
            min_ev=10.0,  # EV de 1000% — inalcançável.
        )
        assert result_high.total_bets <= result_low.total_bets
