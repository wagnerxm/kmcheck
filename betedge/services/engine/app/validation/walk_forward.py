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
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class WalkForwardFold:
    """Um único fold de validação walk-forward."""

    fold_index: int
    train_start: datetime
    train_end: datetime  # == cutoff_date passado a `model.train`
    eval_start: datetime
    eval_end: datetime  # == limite superior de `as_of` nas predições deste fold


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


def run_walk_forward_validation(
    model_factory,
    training_data,
    folds: list[WalkForwardFold],
    metric_fns: dict[str, callable],
) -> list[dict]:
    """Executa a validação walk-forward completa, retreinando o modelo a cada fold.

    Args:
        model_factory: callable sem argumentos que retorna uma NOVA instância
            de `BaseModel` a cada chamada (evita contaminação de estado entre folds).
        training_data: dataset completo (filtragem por `cutoff_date` é
            responsabilidade de `model.train`, conforme o contrato de `BaseModel`).
        folds: lista de `WalkForwardFold` (ver `generate_walk_forward_folds`).
        metric_fns: dict nome_da_métrica -> função(predictions, outcomes) -> float,
            tipicamente vindas de `app.metrics.brier`/`app.metrics.calibration`.

    Returns:
        Lista de dicts, um por fold, com o índice do fold e o valor de cada métrica.

    TODO(fase 1/2): para cada fold, instanciar o modelo via `model_factory`,
    chamar `model.train(training_data, cutoff_date=fold.train_end)`, gerar
    predições para todos os eventos em `(fold.eval_start, fold.eval_end]` via
    `model.predict(evento, as_of=fold.eval_start)`, e aplicar `metric_fns`
    comparando predições com os resultados reais observados.
    """
    raise NotImplementedError("Execução completa da validação walk-forward será implementada na Fase 1/2.")
