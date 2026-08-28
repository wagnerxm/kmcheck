"""Closing Line Value (CLV) — mede se a odd obtida na aposta era melhor que a odd de fechamento.

Conceito
---------
CLV é considerada, na literatura de apostas esportivas quantitativas, o
melhor preditor de longo prazo de lucratividade de um apostador — mais
confiável que o resultado individual de qualquer aposta (que é dominado por
variância de curto prazo). A intuição: se você consistentemente consegue
odds melhores do que a odd de fechamento do mercado (o consenso final, mais
informado, do "dinheiro esperto"), você está sistematicamente identificando
valor antes do mercado se ajustar.

Definição planejada
---------------------
Para uma aposta feita em `prediction_odds` (odds decimais no momento da
aposta) e a odd de fechamento correspondente `closing_odds`:

    CLV_pct = (prediction_odds / closing_odds - 1) * 100

CLV_pct > 0 significa que a odd obtida era melhor (mais alta) que a de
fechamento — sinal positivo, mesmo que a aposta acabe perdendo. CLV_pct < 0
é o oposto: o mercado se moveu contra a própria avaliação inicial.

Uma forma equivalente, em termos de probabilidade implícita (útil para
comparar apostas com odds decimais muito diferentes em magnitude), usa as
probabilidades implícitas justas (ver `app.value.engine.implied_probability`
+ remoção de vig) em vez das odds cruas:

    CLV_prob = fair_prob_closing - fair_prob_at_bet_time

Este módulo é um scaffold — depende de dados de odds de fechamento
historicamente persistidos (ainda não modelados neste esqueleto da Fase 0).
"""
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class CLVResult:
    """Resultado do CLV de uma única aposta."""

    prediction_odds: float
    closing_odds: float
    clv_pct: float


def calculate_clv(prediction_odds: float, closing_odds: float) -> float:
    """Calcula o CLV percentual de uma aposta individual.

        CLV_pct = (prediction_odds / closing_odds - 1) * 100

    Args:
        prediction_odds: odds decimais obtidas no momento da aposta.
        closing_odds: odds decimais de fechamento do mercado para o mesmo
            evento/mercado/resultado.

    Returns:
        CLV em pontos percentuais. Positivo = odd obtida melhor que o
        fechamento (bom sinal); negativo = mercado se moveu contra a aposta.
    """
    if prediction_odds <= 1.0 or closing_odds <= 1.0:
        raise ValueError("Odds decimais devem ser maiores que 1.0.")
    return (prediction_odds / closing_odds - 1.0) * 100.0


def aggregate_clv(predictions_with_closing: Sequence[tuple[float, float]]) -> dict[str, float]:
    """Agrega o CLV de várias apostas em estatísticas resumo.

    Args:
        predictions_with_closing: sequência de pares
            `(prediction_odds, closing_odds)`, um por aposta avaliada.

    Returns:
        dict com `mean_clv_pct`, `positive_clv_rate` (fração de apostas com
        CLV > 0) e `n_bets`.

    TODO(fase 1): estender para receber também `stake`/`bankroll` por aposta
    e calcular CLV ponderado por volume apostado, além de segmentar por
    mercado/liga/casa de apostas — depende do schema de odds históricas
    ainda não definido nesta fase do projeto.
    """
    raise NotImplementedError("Agregação de CLV será implementada na Fase 1, junto ao schema de odds históricas.")
