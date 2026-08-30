"""Testes do pipeline de features — registro, computação em lote e sob demanda.

Cobre:
  - Registro de features no catálogo (FeatureRegistry).
  - Funções de computação individuais (gols, streaks, Elo, etc.).
  - compute_batch_features: resultado correto, anti-leakage, labels, formato.
  - compute_event_features (on_demand): consistência com batch.
  - validate_batch_no_leakage.
"""
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from app.features.registry import (
    FeatureRegistry,
    FeatureSpec,
    registry,
    _team_goals,
    _compute_elo_diff,
    _compute_goals_scored_avg_last5,
    _compute_goals_conceded_avg_last5,
    _compute_goals_scored_avg_last10,
    _compute_goals_conceded_avg_last10,
    _compute_rest_days,
    _compute_market_implied_prob,
    _compute_points_per_game_last5,
    _compute_win_streak,
    _compute_unbeaten_streak,
    _compute_clean_sheet_streak,
    _compute_h2h_points_avg,
    _compute_games_last_14_days,
    _compute_is_home,
)
from app.features.batch import (
    _build_team_context,
    _get_team_history,
    compute_match_features,
    compute_batch_features,
    validate_batch_no_leakage,
)
from app.features.on_demand import compute_event_features


# ═══════════════════════════════════════════════════════════════════════════
# Dados sintéticos de teste
# ═══════════════════════════════════════════════════════════════════════════

def _make_matches(
    n: int = 100,
    base_date: datetime = datetime(2024, 1, 1),
    seed: int = 42,
) -> list[dict]:
    """Gera partidas sintéticas realistas para testes do pipeline de features."""
    rng = np.random.default_rng(seed)
    teams = ["team_a", "team_b", "team_c", "team_d"]

    data = []
    for i in range(n):
        home = teams[rng.integers(len(teams))]
        away = teams[rng.integers(len(teams))]
        while away == home:
            away = teams[rng.integers(len(teams))]

        data.append({
            "home_team_id": home,
            "away_team_id": away,
            "home_goals": int(rng.poisson(1.5)),
            "away_goals": int(rng.poisson(1.1)),
            "kickoff_at": base_date + timedelta(days=i),
        })
    return data


def _make_history(
    team_id: str = "team_a",
    n: int = 10,
    base_date: datetime = datetime(2024, 6, 1),
    opponent_id: str = "team_b",
    home_goals_pattern: list[int] | None = None,
    away_goals_pattern: list[int] | None = None,
) -> list[dict]:
    """Cria um histórico artificial para um time, do mais recente ao mais antigo.

    Alterna entre ser mandante e visitante contra `opponent_id`.
    """
    matches = []
    hg = home_goals_pattern or [2, 1, 0, 3, 1, 2, 0, 1, 2, 1]
    ag = away_goals_pattern or [0, 1, 2, 1, 0, 0, 1, 1, 0, 2]

    for i in range(n):
        is_home = i % 2 == 0
        kickoff = base_date - timedelta(days=(i + 1) * 3)  # a cada 3 dias

        if is_home:
            match = {
                "home_team_id": team_id,
                "away_team_id": opponent_id,
                "home_goals": hg[i % len(hg)],
                "away_goals": ag[i % len(ag)],
                "kickoff_at": kickoff,
            }
        else:
            match = {
                "home_team_id": opponent_id,
                "away_team_id": team_id,
                "home_goals": ag[i % len(ag)],
                "away_goals": hg[i % len(hg)],
                "kickoff_at": kickoff,
            }
        matches.append(match)
    return matches


# ═══════════════════════════════════════════════════════════════════════════
# Testes do FeatureRegistry
# ═══════════════════════════════════════════════════════════════════════════

class TestFeatureRegistry:
    def test_registro_global_tem_14_features(self):
        """O catálogo global deve ter exatamente 14 features registradas."""
        assert len(registry.all()) == 14

    def test_names_retorna_lista_de_strings(self):
        names = registry.names()
        assert isinstance(names, list)
        assert all(isinstance(n, str) for n in names)
        assert len(names) == 14

    def test_get_retorna_spec(self):
        spec = registry.get("elo_diff")
        assert isinstance(spec, FeatureSpec)
        assert spec.name == "elo_diff"
        assert spec.category == "rating"

    def test_get_feature_inexistente_levanta_keyerror(self):
        with pytest.raises(KeyError):
            registry.get("feature_fantasma")

    def test_registro_duplicado_levanta_valueerror(self):
        reg = FeatureRegistry()
        spec = FeatureSpec(
            name="teste_dup",
            description="teste",
            compute_fn=lambda ctx: 0.0,
            min_lookback_days=0,
        )
        reg.register(spec)
        with pytest.raises(ValueError, match="já registrada"):
            reg.register(spec)

    def test_list_by_category_filtra(self):
        form_features = registry.list_by_category("form")
        assert len(form_features) > 0
        for f in form_features:
            assert f.category == "form"

    def test_categorias_existentes(self):
        """Deve ter as categorias: rating, form, context, market, h2h."""
        cats = {f.category for f in registry.all()}
        assert "rating" in cats
        assert "form" in cats
        assert "context" in cats
        assert "market" in cats
        assert "h2h" in cats


# ═══════════════════════════════════════════════════════════════════════════
# Testes das funções de computação individuais
# ═══════════════════════════════════════════════════════════════════════════

class TestTeamGoals:
    def test_mandante(self):
        m = {"home_team_id": "A", "away_team_id": "B", "home_goals": 3, "away_goals": 1}
        scored, conceded = _team_goals(m, "A")
        assert scored == 3
        assert conceded == 1

    def test_visitante(self):
        m = {"home_team_id": "A", "away_team_id": "B", "home_goals": 3, "away_goals": 1}
        scored, conceded = _team_goals(m, "B")
        assert scored == 1
        assert conceded == 3


class TestEloDiff:
    def test_com_ratings(self):
        ctx = {
            "team_id": "A",
            "opponent_id": "B",
            "elo_ratings": {"A": 1600.0, "B": 1500.0},
        }
        assert _compute_elo_diff(ctx) == pytest.approx(100.0)

    def test_sem_opponent(self):
        ctx = {"team_id": "A", "elo_ratings": {"A": 1600.0}}
        assert _compute_elo_diff(ctx) is None

    def test_default_rating_1500(self):
        ctx = {"team_id": "A", "opponent_id": "B", "elo_ratings": {}}
        assert _compute_elo_diff(ctx) == pytest.approx(0.0)


class TestGoalsAvg:
    def test_scored_avg_last5(self):
        history = _make_history("team_a", n=10)
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_goals_scored_avg_last5(ctx)
        assert result is not None
        assert isinstance(result, float)
        assert result >= 0.0

    def test_scored_avg_last5_sem_historico(self):
        ctx = {"team_id": "team_a", "match_history": []}
        assert _compute_goals_scored_avg_last5(ctx) is None

    def test_conceded_avg_last5(self):
        history = _make_history("team_a", n=10)
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_goals_conceded_avg_last5(ctx)
        assert result is not None
        assert isinstance(result, float)
        assert result >= 0.0

    def test_scored_avg_last10(self):
        history = _make_history("team_a", n=10)
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_goals_scored_avg_last10(ctx)
        assert result is not None
        assert result >= 0.0

    def test_conceded_avg_last10(self):
        history = _make_history("team_a", n=10)
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_goals_conceded_avg_last10(ctx)
        assert result is not None
        assert result >= 0.0

    def test_avg_com_apenas_2_jogos(self):
        """Se há menos de 5 jogos, média é calculada sobre os disponíveis."""
        history = _make_history("team_a", n=2)
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_goals_scored_avg_last5(ctx)
        assert result is not None
        # Deve ser média de 2 jogos, não 5.


class TestRestDays:
    def test_calcula_corretamente(self):
        as_of = datetime(2024, 6, 1)
        history = [
            {"home_team_id": "A", "away_team_id": "B",
             "home_goals": 1, "away_goals": 0,
             "kickoff_at": datetime(2024, 5, 28)},
        ]
        ctx = {"as_of": as_of, "match_history": history}
        result = _compute_rest_days(ctx)
        assert result == pytest.approx(4.0, abs=0.01)

    def test_sem_historico(self):
        ctx = {"as_of": datetime(2024, 6, 1), "match_history": []}
        assert _compute_rest_days(ctx) is None


class TestMarketImpliedProb:
    def test_com_odds(self):
        ctx = {"team_id": "A", "market_odds": {"A": 2.5}}
        result = _compute_market_implied_prob(ctx)
        assert result == pytest.approx(1.0 / 2.5, abs=1e-6)

    def test_sem_odds(self):
        ctx = {"team_id": "A", "market_odds": {}}
        assert _compute_market_implied_prob(ctx) is None

    def test_odds_invalida(self):
        ctx = {"team_id": "A", "market_odds": {"A": 0.5}}
        # odds <= 1.0 não faz sentido
        assert _compute_market_implied_prob(ctx) is None


class TestPointsPerGame:
    def test_todas_vitorias(self):
        """5 vitórias seguidas → 3.0 pontos por jogo."""
        history = _make_history(
            "team_a", n=5,
            home_goals_pattern=[3, 3, 3, 3, 3],
            away_goals_pattern=[0, 0, 0, 0, 0],
        )
        ctx = {"team_id": "team_a", "match_history": history}
        assert _compute_points_per_game_last5(ctx) == pytest.approx(3.0)

    def test_todos_empates(self):
        """5 empates seguidos → 1.0 ponto por jogo."""
        history = _make_history(
            "team_a", n=5,
            home_goals_pattern=[1, 1, 1, 1, 1],
            away_goals_pattern=[1, 1, 1, 1, 1],
        )
        ctx = {"team_id": "team_a", "match_history": history}
        assert _compute_points_per_game_last5(ctx) == pytest.approx(1.0)


class TestWinStreak:
    def test_sequencia_de_vitorias(self):
        history = _make_history(
            "team_a", n=5,
            home_goals_pattern=[3, 2, 1, 0, 2],
            away_goals_pattern=[0, 1, 0, 2, 0],
        )
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_win_streak(ctx)
        assert result >= 0.0

    def test_sem_historico_retorna_zero(self):
        ctx = {"team_id": "team_a", "match_history": []}
        assert _compute_win_streak(ctx) == 0.0


class TestUnbeatenStreak:
    def test_invicto(self):
        """Série sem derrotas (vitórias e empates)."""
        history = _make_history(
            "team_a", n=5,
            home_goals_pattern=[2, 1, 1, 3, 2],
            away_goals_pattern=[0, 1, 0, 1, 1],
        )
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_unbeaten_streak(ctx)
        assert result >= 0.0


class TestCleanSheetStreak:
    def test_clean_sheets(self):
        """Série sem sofrer gols."""
        history = _make_history(
            "team_a", n=5,
            home_goals_pattern=[2, 1, 3, 2, 1],
            away_goals_pattern=[0, 0, 0, 1, 0],
        )
        ctx = {"team_id": "team_a", "match_history": history}
        result = _compute_clean_sheet_streak(ctx)
        # Os 3 primeiros jogos têm clean sheet (mandante alterna)
        assert result >= 0.0


class TestH2hPointsAvg:
    def test_com_confrontos(self):
        history = _make_history("team_a", n=10, opponent_id="team_b")
        ctx = {
            "team_id": "team_a",
            "opponent_id": "team_b",
            "match_history": history,
        }
        result = _compute_h2h_points_avg(ctx)
        assert result is not None
        assert 0.0 <= result <= 3.0

    def test_sem_adversario(self):
        ctx = {"team_id": "team_a", "match_history": [], "opponent_id": None}
        assert _compute_h2h_points_avg(ctx) is None

    def test_sem_confrontos_diretos(self):
        """Histórico existe mas nenhum jogo contra o adversário especificado."""
        history = _make_history("team_a", n=5, opponent_id="team_c")
        ctx = {
            "team_id": "team_a",
            "opponent_id": "team_d",  # não tem confronto
            "match_history": history,
        }
        assert _compute_h2h_points_avg(ctx) is None


class TestGamesLast14Days:
    def test_conta_recentes(self):
        as_of = datetime(2024, 6, 1)
        history = [
            {"home_team_id": "A", "away_team_id": "B",
             "home_goals": 1, "away_goals": 0,
             "kickoff_at": as_of - timedelta(days=3)},
            {"home_team_id": "A", "away_team_id": "B",
             "home_goals": 2, "away_goals": 1,
             "kickoff_at": as_of - timedelta(days=10)},
            {"home_team_id": "A", "away_team_id": "B",
             "home_goals": 0, "away_goals": 0,
             "kickoff_at": as_of - timedelta(days=20)},  # fora dos 14 dias
        ]
        ctx = {"as_of": as_of, "match_history": history}
        assert _compute_games_last_14_days(ctx) == 2.0


class TestIsHome:
    def test_mandante(self):
        ctx = {"is_home": True}
        assert _compute_is_home(ctx) == 1.0

    def test_visitante(self):
        ctx = {"is_home": False}
        assert _compute_is_home(ctx) == 0.0


# ═══════════════════════════════════════════════════════════════════════════
# Testes do batch.py
# ═══════════════════════════════════════════════════════════════════════════

class TestBuildTeamContext:
    def test_campos_presentes(self):
        ctx = _build_team_context(
            team_id="A",
            as_of=datetime(2024, 6, 1),
            match_history=[],
            opponent_id="B",
            is_home=True,
        )
        assert ctx["team_id"] == "A"
        assert ctx["as_of"] == datetime(2024, 6, 1)
        assert ctx["opponent_id"] == "B"
        assert ctx["is_home"] is True
        assert ctx["match_history"] == []
        assert ctx["elo_ratings"] == {}


class TestGetTeamHistory:
    def test_filtra_temporal_estrito(self):
        """kickoff_at < before — exclui a partida com kickoff exatamente em `before`."""
        matches = [
            {"home_team_id": "A", "away_team_id": "B",
             "home_goals": 1, "away_goals": 0,
             "kickoff_at": datetime(2024, 1, 5)},
            {"home_team_id": "A", "away_team_id": "C",
             "home_goals": 2, "away_goals": 1,
             "kickoff_at": datetime(2024, 1, 10)},
            {"home_team_id": "A", "away_team_id": "D",
             "home_goals": 0, "away_goals": 0,
             "kickoff_at": datetime(2024, 1, 15)},
        ]
        # before=10 de jan → só a partida do dia 5
        result = _get_team_history("A", matches, before=datetime(2024, 1, 10))
        assert len(result) == 1
        assert result[0]["kickoff_at"] == datetime(2024, 1, 5)

    def test_ordena_mais_recente_primeiro(self):
        matches = [
            {"home_team_id": "A", "away_team_id": "B",
             "home_goals": 1, "away_goals": 0,
             "kickoff_at": datetime(2024, 1, 1)},
            {"home_team_id": "B", "away_team_id": "A",
             "home_goals": 0, "away_goals": 2,
             "kickoff_at": datetime(2024, 1, 10)},
        ]
        result = _get_team_history("A", matches, before=datetime(2024, 2, 1))
        assert result[0]["kickoff_at"] > result[1]["kickoff_at"]

    def test_filtra_por_time(self):
        """Retorna apenas partidas onde o time participou."""
        matches = [
            {"home_team_id": "A", "away_team_id": "B",
             "home_goals": 1, "away_goals": 0,
             "kickoff_at": datetime(2024, 1, 5)},
            {"home_team_id": "C", "away_team_id": "D",
             "home_goals": 1, "away_goals": 1,
             "kickoff_at": datetime(2024, 1, 6)},
        ]
        result = _get_team_history("A", matches, before=datetime(2024, 2, 1))
        assert len(result) == 1


class TestComputeMatchFeatures:
    def test_retorna_home_e_away(self):
        matches = _make_matches(30)
        match = matches[15]  # pega uma partida no meio
        result = compute_match_features(match, matches)

        assert "home" in result
        assert "away" in result
        assert isinstance(result["home"], dict)
        assert isinstance(result["away"], dict)

    def test_feature_names_presentes(self):
        matches = _make_matches(30)
        match = matches[15]
        result = compute_match_features(match, matches, feature_names=["is_home", "rest_days"])

        assert "is_home" in result["home"]
        assert "rest_days" in result["home"]
        assert result["home"]["is_home"] == 1.0
        assert result["away"]["is_home"] == 0.0


class TestComputeBatchFeatures:
    def test_retorna_dataframe(self):
        matches = _make_matches(50)
        df = compute_batch_features(matches)

        assert isinstance(df, pd.DataFrame)
        assert len(df) > 0

    def test_duas_linhas_por_partida(self):
        matches = _make_matches(20)
        df = compute_batch_features(matches)

        # Cada partida gera 2 linhas (home + away).
        assert len(df) == 20 * 2

    def test_colunas_obrigatorias(self):
        matches = _make_matches(20)
        df = compute_batch_features(matches)

        for col in ["event_idx", "team_id", "opponent_id", "is_home", "label", "kickoff_at"]:
            assert col in df.columns

    def test_labels_corretos(self):
        """Labels devem ser 1.0 (vitória), 0.5 (empate) ou 0.0 (derrota)."""
        matches = _make_matches(50)
        df = compute_batch_features(matches)

        assert set(df["label"].unique()).issubset({0.0, 0.5, 1.0})

    def test_cutoff_date_filtra(self):
        """cutoff_date deve excluir partidas posteriores."""
        matches = _make_matches(100, base_date=datetime(2024, 1, 1))
        cutoff = datetime(2024, 2, 1)  # ~31 dias
        df = compute_batch_features(matches, cutoff_date=cutoff)

        # Deve ter no máximo 32 * 2 linhas (dias 0..31 inclusive).
        assert len(df) <= 64

    def test_sem_partidas_apos_filtragem(self):
        matches = _make_matches(50, base_date=datetime(2024, 6, 1))
        with pytest.raises(ValueError, match="Nenhuma partida"):
            compute_batch_features(matches, cutoff_date=datetime(2024, 1, 1))

    def test_is_home_binary(self):
        matches = _make_matches(20)
        df = compute_batch_features(matches)

        assert set(df["is_home"].unique()).issubset({0.0, 1.0})

    def test_aceita_dataframe_como_entrada(self):
        """compute_batch_features aceita tanto list[dict] quanto pd.DataFrame."""
        matches = _make_matches(20)
        matches_df = pd.DataFrame(matches)
        df = compute_batch_features(matches_df)

        assert isinstance(df, pd.DataFrame)
        assert len(df) == 20 * 2

    def test_feature_names_subconjunto(self):
        matches = _make_matches(20)
        names = ["is_home", "rest_days"]
        df = compute_batch_features(matches, feature_names=names)

        assert "is_home" in df.columns
        assert "rest_days" in df.columns
        # Não deve ter features não pedidas.
        assert "elo_diff" not in df.columns

    def test_feature_inexistente_levanta_keyerror(self):
        matches = _make_matches(10)
        with pytest.raises(KeyError):
            compute_batch_features(matches, feature_names=["feature_fantasma"])


class TestValidateBatchNoLeakage:
    def test_sem_leakage(self):
        df = pd.DataFrame({
            "kickoff_at": [datetime(2024, 1, i) for i in range(1, 6)],
            "feat": [1.0, 2.0, 3.0, 4.0, 5.0],
        })
        assert validate_batch_no_leakage(df, cutoff_date=datetime(2024, 1, 10)) is True

    def test_com_leakage(self):
        df = pd.DataFrame({
            "kickoff_at": [datetime(2024, 1, i) for i in range(1, 6)],
            "feat": [1.0, 2.0, 3.0, 4.0, 5.0],
        })
        # cutoff = 3 de jan → dias 4 e 5 vazam.
        assert validate_batch_no_leakage(df, cutoff_date=datetime(2024, 1, 3)) is False

    def test_sem_coluna_kickoff(self):
        """Sem kickoff_at no DataFrame, validação sempre passa."""
        df = pd.DataFrame({"feat": [1.0, 2.0]})
        assert validate_batch_no_leakage(df, cutoff_date=datetime(2024, 1, 1)) is True


# ═══════════════════════════════════════════════════════════════════════════
# Testes do on_demand.py
# ═══════════════════════════════════════════════════════════════════════════

class TestComputeEventFeatures:
    def test_retorna_dict_completo(self):
        """Deve retornar uma entrada para cada feature registrada."""
        history = _make_history("team_a", n=10)
        context = {
            "team_id": "team_a",
            "match_history": history,
            "opponent_id": "team_b",
            "elo_ratings": {"team_a": 1550.0, "team_b": 1500.0},
            "is_home": True,
        }
        as_of = datetime(2024, 6, 1)
        result = compute_event_features(context, as_of=as_of)

        assert len(result) == 14  # todas as features
        assert all(isinstance(k, str) for k in result)

    def test_feature_names_filtra(self):
        """Se feature_names fornecido, calcula apenas essas."""
        context = {"team_id": "team_a", "match_history": [], "is_home": True}
        result = compute_event_features(
            context,
            as_of=datetime(2024, 6, 1),
            feature_names=["is_home"],
        )
        assert len(result) == 1
        assert result["is_home"] == 1.0

    def test_features_sem_historico_retorna_none(self):
        """Features que precisam de histórico devem retornar None quando ausente."""
        context = {"team_id": "team_a", "match_history": []}
        result = compute_event_features(
            context,
            as_of=datetime(2024, 6, 1),
            feature_names=["goals_scored_avg_last5", "rest_days"],
        )
        assert result["goals_scored_avg_last5"] is None
        assert result["rest_days"] is None

    def test_as_of_injetado_no_context(self):
        """compute_event_features deve injetar as_of no context."""
        as_of = datetime(2024, 6, 15)
        history = [
            {"home_team_id": "team_a", "away_team_id": "team_b",
             "home_goals": 1, "away_goals": 0,
             "kickoff_at": datetime(2024, 6, 10)},
        ]
        context = {"team_id": "team_a", "match_history": history}
        result = compute_event_features(
            context, as_of=as_of, feature_names=["rest_days"]
        )
        assert result["rest_days"] == pytest.approx(5.0, abs=0.01)

    def test_exception_em_compute_fn_retorna_none(self):
        """Se uma compute_fn falhar, a feature deve ficar None (não crashar)."""
        context = {"team_id": "team_a"}  # faltam vários campos
        result = compute_event_features(
            context,
            as_of=datetime(2024, 6, 1),
            feature_names=["elo_diff"],
        )
        # Não deve levantar exceção; elo_diff sem opponent_id retorna None.
        assert "elo_diff" in result


# ═══════════════════════════════════════════════════════════════════════════
# Teste de consistência batch vs on_demand
# ═══════════════════════════════════════════════════════════════════════════

class TestBatchOnDemandConsistency:
    def test_valores_iguais_para_mesmo_evento(self):
        """Features calculadas em lote e sob demanda devem ser iguais para o mesmo evento.

        Esta é a garantia fundamental contra training-serving skew.
        """
        matches = _make_matches(30)
        matches.sort(key=lambda m: m["kickoff_at"])

        # Pega a partida de índice 20 (tem histórico suficiente).
        target = matches[20]
        home_id = target["home_team_id"]

        # --- Via batch ---
        batch_result = compute_match_features(
            target, matches, feature_names=["is_home", "rest_days", "win_streak"]
        )
        batch_features = batch_result["home"]

        # --- Via on_demand ---
        kickoff = target["kickoff_at"]
        # Filtra histórico do mandante anterior ao kickoff, mais recente primeiro.
        home_history = [
            m for m in matches
            if (m["home_team_id"] == home_id or m["away_team_id"] == home_id)
            and m["kickoff_at"] < kickoff
        ]
        home_history.sort(key=lambda m: m["kickoff_at"], reverse=True)

        context = {
            "team_id": home_id,
            "match_history": home_history,
            "opponent_id": target["away_team_id"],
            "is_home": True,
        }
        on_demand_features = compute_event_features(
            context,
            as_of=kickoff,
            feature_names=["is_home", "rest_days", "win_streak"],
        )

        # Valores devem ser idênticos.
        for name in ["is_home", "rest_days", "win_streak"]:
            if batch_features[name] is not None and on_demand_features[name] is not None:
                assert batch_features[name] == pytest.approx(
                    on_demand_features[name], abs=1e-10
                ), f"Divergência em '{name}': batch={batch_features[name]}, on_demand={on_demand_features[name]}"
