"""Computação de features em lote — usada no treino de modelos (`train`).

Diferente de `app.features.on_demand` (um evento por vez, latência baixa),
este módulo é otimizado para throughput: calcula features para muitos
eventos históricos de uma vez, iterando sobre o histórico com janela
estritamente temporal (anti-leakage).

O pipeline de features em lote é o coração do treino do GradientBoostModel:
dado um histórico de partidas, ele monta a matriz X (features) e o vetor y
(labels) para cada time em cada partida, respeitando a ordem cronológica
para que nenhuma feature use informação posterior ao kickoff da partida.
"""
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from app.features.registry import FeatureSpec, registry


def _build_team_context(
    team_id: str,
    as_of: datetime,
    match_history: list[dict],
    opponent_id: str | None = None,
    elo_ratings: dict[str, float] | None = None,
    is_home: bool = True,
) -> dict[str, Any]:
    """Monta o dicionário de contexto para as funções de computação de features.

    O match_history passado aqui já deve conter APENAS partidas anteriores a
    `as_of` — a filtragem temporal é feita no caller (compute_match_features /
    compute_batch_features) para garantir anti-leakage.
    """
    return {
        "team_id": team_id,
        "as_of": as_of,
        "match_history": match_history,
        "opponent_id": opponent_id,
        "elo_ratings": elo_ratings or {},
        "is_home": is_home,
    }


def _get_team_history(
    team_id: str,
    matches: list[dict],
    before: datetime,
) -> list[dict]:
    """Retorna partidas do time anteriores a `before`, do mais recente ao mais antigo.

    Filtragem temporal estrita: `kickoff_at < before` (exclusivo) para nunca
    incluir a partida sendo predita. Ordenação decrescente por kickoff_at.
    """
    team_matches = [
        m for m in matches
        if (m["home_team_id"] == team_id or m["away_team_id"] == team_id)
        and m["kickoff_at"] < before
    ]
    team_matches.sort(key=lambda m: m["kickoff_at"], reverse=True)
    return team_matches


def compute_match_features(
    match: dict,
    all_matches: list[dict],
    feature_names: list[str] | None = None,
    elo_ratings: dict[str, float] | None = None,
) -> dict[str, dict[str, float | None]]:
    """Calcula features para ambos os times de uma partida específica.

    Retorna {"home": {feat_name: valor, ...}, "away": {feat_name: valor, ...}}.
    Cada feature é computada usando APENAS partidas anteriores ao kickoff
    da partida em questão — nunca a própria partida.
    """
    names = feature_names or registry.names()
    kickoff = match["kickoff_at"]
    home_id = match["home_team_id"]
    away_id = match["away_team_id"]

    result: dict[str, dict[str, float | None]] = {"home": {}, "away": {}}

    for side, team_id, is_home in [("home", home_id, True), ("away", away_id, False)]:
        opp_id = away_id if side == "home" else home_id
        history = _get_team_history(team_id, all_matches, before=kickoff)

        context = _build_team_context(
            team_id=team_id,
            as_of=kickoff,
            match_history=history,
            opponent_id=opp_id,
            elo_ratings=elo_ratings,
            is_home=is_home,
        )

        for name in names:
            spec = registry.get(name)
            try:
                value = spec.compute_fn(context)
            except Exception:
                value = None
            result[side][name] = value

    return result


def compute_batch_features(
    events: list[dict] | pd.DataFrame,
    feature_names: list[str] | None = None,
    cutoff_date: datetime | None = None,
    elo_ratings: dict[str, float] | None = None,
) -> pd.DataFrame:
    """Calcula um DataFrame de features para um conjunto de eventos históricos.

    Para cada partida, gera DUAS linhas (uma para cada time: mandante e
    visitante), com colunas para cada feature + metadados (event_idx,
    team_id, opponent_id, is_home, label).

    Args:
        events: lista de dicts ou DataFrame com partidas (deve conter
            home_team_id, away_team_id, home_goals, away_goals, kickoff_at).
        feature_names: subconjunto do catálogo a calcular. Se None, todas.
        cutoff_date: filtra partidas para kickoff_at <= cutoff_date ANTES
            de calcular — barreira anti-leakage no treino em lote.
        elo_ratings: ratings Elo vigentes (opcional, para feature elo_diff).

    Returns:
        DataFrame com colunas: event_idx, team_id, opponent_id, is_home,
        label (1=vitória, 0.5=empate, 0=derrota), + uma coluna por feature.
    """
    # Converte DataFrame para lista de dicts se necessário.
    if isinstance(events, pd.DataFrame):
        matches = events.to_dict("records")
    else:
        matches = list(events)

    # Filtragem anti-leakage (defesa em profundidade).
    if cutoff_date is not None:
        matches = [m for m in matches if m["kickoff_at"] <= cutoff_date]

    if not matches:
        raise ValueError("Nenhuma partida disponível após filtragem por cutoff_date.")

    # Ordena cronologicamente para montar histórico de forma correta.
    matches.sort(key=lambda m: m["kickoff_at"])

    names = feature_names or registry.names()
    # Valida que todas as features pedidas existem no catálogo.
    for name in names:
        registry.get(name)

    rows: list[dict[str, Any]] = []

    for idx, match in enumerate(matches):
        kickoff = match["kickoff_at"]
        home_id = match["home_team_id"]
        away_id = match["away_team_id"]
        home_goals = match["home_goals"]
        away_goals = match["away_goals"]

        for side, team_id, is_home in [("home", home_id, True), ("away", away_id, False)]:
            opp_id = away_id if side == "home" else home_id

            # Histórico do time: partidas anteriores ao kickoff desta partida.
            history = _get_team_history(team_id, matches, before=kickoff)

            context = _build_team_context(
                team_id=team_id,
                as_of=kickoff,
                match_history=history,
                opponent_id=opp_id,
                elo_ratings=elo_ratings,
                is_home=is_home,
            )

            # Label: resultado do ponto de vista do time.
            gf = home_goals if side == "home" else away_goals
            ga = away_goals if side == "home" else home_goals
            if gf > ga:
                label = 1.0    # vitória
            elif gf == ga:
                label = 0.5    # empate
            else:
                label = 0.0    # derrota

            row: dict[str, Any] = {
                "event_idx": idx,
                "team_id": team_id,
                "opponent_id": opp_id,
                "is_home": float(is_home),
                "label": label,
                "kickoff_at": kickoff,
            }

            for name in names:
                spec = registry.get(name)
                try:
                    value = spec.compute_fn(context)
                except Exception:
                    value = None
                row[name] = value

            rows.append(row)

    return pd.DataFrame(rows)


def validate_batch_no_leakage(features: pd.DataFrame, cutoff_date: datetime) -> bool:
    """Confere que nenhuma linha do DataFrame de features usa dados posteriores a `cutoff_date`.

    Verificação complementar a `BaseModel.validate_no_leakage`, aplicada em
    lote logo após `compute_batch_features` e antes de qualquer `model.train`.
    """
    if "kickoff_at" not in features.columns:
        return True
    return bool((features["kickoff_at"] <= cutoff_date).all())
