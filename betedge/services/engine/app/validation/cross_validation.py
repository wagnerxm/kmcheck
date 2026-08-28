"""Validação cruzada temporal (blocked time-series cross-validation).

Diferença em relação a `app.validation.walk_forward`
-------------------------------------------------------
O walk-forward simula o retreino contínuo em produção (janela expansiva,
avaliação sempre logo após o corte). A validação cruzada temporal aqui é
mais próxima de um k-fold "adaptado ao tempo": particiona o histórico em K
blocos cronológicos contíguos e, para cada bloco k, treina com todos os
blocos anteriores a k e avalia apenas no bloco k — sem nunca usar blocos
posteriores no treino. É mais barata computacionalmente que o walk-forward
de passo fino (menos retreinos), sendo útil para tuning de hiperparâmetros
onde retreinar a cada `step_days` seria proibitivo.

Formalmente, com K blocos B_1, ..., B_K ordenados cronologicamente:

    fold k (k = 2, ..., K):  treino = B_1 ∪ ... ∪ B_{k-1}     avaliação = B_k

Note que não existe fold para k=1 (não há bloco anterior para treinar).
Um "gap" opcional entre o fim do treino e o início da avaliação
(`gap_days`) simula o atraso realista entre o corte de dados de treino e a
disponibilização do modelo em produção.
"""
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class TemporalCVFold:
    """Um fold de validação cruzada temporal (blocos cronológicos contíguos)."""

    fold_index: int
    train_start: datetime
    train_end: datetime
    eval_start: datetime
    eval_end: datetime


def generate_temporal_cv_folds(
    data_start: datetime,
    data_end: datetime,
    n_blocks: int,
    gap_days: int = 0,
) -> Iterator[TemporalCVFold]:
    """Particiona `[data_start, data_end]` em `n_blocks` blocos cronológicos e gera os folds.

    Args:
        data_start: início do histórico disponível.
        data_end: fim do histórico disponível.
        n_blocks: número de blocos cronológicos (K). Gera K-1 folds
            (o primeiro bloco nunca é usado como avaliação, só como treino).
        gap_days: dias de intervalo entre o fim do treino e o início da
            avaliação em cada fold (simula latência de deploy do modelo).

    Yields:
        `TemporalCVFold` em ordem cronológica.
    """
    if n_blocks < 2:
        raise ValueError("n_blocks deve ser >= 2 (é preciso ao menos 1 bloco de treino e 1 de avaliação).")
    if data_start >= data_end:
        raise ValueError("data_start deve ser anterior a data_end.")
    if gap_days < 0:
        raise ValueError("gap_days não pode ser negativo.")

    total_days = (data_end - data_start).days
    block_days = total_days // n_blocks
    if block_days <= 0:
        raise ValueError("Período total de dados é curto demais para o número de blocos solicitado.")

    block_boundaries = [data_start + timedelta(days=block_days * i) for i in range(n_blocks)]
    block_boundaries.append(data_end)

    for k in range(1, n_blocks):
        train_end = block_boundaries[k]
        eval_start = train_end + timedelta(days=gap_days)
        eval_end = block_boundaries[k + 1] if k + 1 < len(block_boundaries) else data_end
        if eval_start >= eval_end:
            continue  # gap grande demais para o bloco restante — pula o fold

        yield TemporalCVFold(
            fold_index=k - 1,
            train_start=data_start,
            train_end=train_end,
            eval_start=eval_start,
            eval_end=eval_end,
        )


def run_temporal_cross_validation(
    model_factory,
    training_data,
    folds: list[TemporalCVFold],
    metric_fns: dict[str, callable],
) -> list[dict]:
    """Executa a validação cruzada temporal completa, retreinando o modelo a cada fold.

    Mesma assinatura conceitual de `app.validation.walk_forward.run_walk_forward_validation`
    — ver aquele docstring para o contrato esperado de `model_factory`/`metric_fns`.

    TODO(fase 1/2): implementar o laço de treino/avaliação por fold.
    """
    raise NotImplementedError("Execução completa da validação cruzada temporal será implementada na Fase 1/2.")
