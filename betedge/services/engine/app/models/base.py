"""Classe base abstrata para todos os modelos estatísticos do BetEdge.

Todo modelo — estatístico clássico (Poisson, Dixon-Coles, Elo), de machine
learning (XGBoost, LightGBM, regressão logística) ou de consenso de mercado —
implementa esta interface, permitindo que `app.models.ensemble.EnsembleModel`
e a API (`app/api/predictions.py`, `app/api/models_api.py`) tratem qualquer
modelo de forma uniforme.

Regra de ouro do projeto: **nunca vazar dados futuros**. Todo `train` recebe
um `cutoff_date` e todo `predict` recebe um `as_of` — nenhum modelo pode
usar, direta ou indiretamente (via features derivadas), informação posterior
a essas datas. Ver `app/validation/walk_forward.py` e `tests/test_no_leakage.py`.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class PredictionResult:
    """Resultado de uma predição de modelo para um único (mercado, resultado)."""

    market: str
    outcome: str
    probability: float
    confidence: float | None = None
    features_used: dict[str, Any] | None = None


@dataclass
class TrainingReport:
    """Resumo do que aconteceu durante `train`, retornado para logging/auditoria."""

    model_name: str
    model_version: str
    cutoff_date: datetime
    n_samples: int
    trained_at: datetime = field(default_factory=datetime.utcnow)
    metrics: dict[str, float] = field(default_factory=dict)
    hyperparameters: dict[str, Any] = field(default_factory=dict)


class BaseModel(ABC):
    """Classe base para todos os modelos estatísticos do BetEdge.

    Atributos de classe/instância esperados nas subclasses:
        name: identificador curto e estável do modelo (ex.: "dixon_coles").
        version: versão semântica do modelo (ex.: "1.0.0"), incrementada a
            cada mudança relevante de metodologia ou hiperparâmetros padrão.
    """

    name: str
    version: str

    @abstractmethod
    def train(self, training_data: Any, cutoff_date: datetime) -> dict:
        """Treina o modelo com dados até `cutoff_date` (inclusive).

        Implementações DEVEM filtrar `training_data` para excluir qualquer
        registro com timestamp posterior a `cutoff_date` antes de ajustar
        parâmetros — mesmo que o chamador já tenha pré-filtrado, o modelo
        reforça a garantia (defesa em profundidade contra leakage).

        Retorna um dicionário de métricas/summary do treino (ex.: log-verossimilhança
        final, número de amostras, hiperparâmetros efetivamente usados).
        """
        ...

    @abstractmethod
    def predict(self, event_data: dict, as_of: datetime) -> list[PredictionResult]:
        """Gera predições para um evento usando apenas dados disponíveis até `as_of`.

        `event_data` deve conter tudo que o modelo precisa (times/atletas,
        estatísticas recentes, contexto do confronto). Implementações DEVEM
        chamar `validate_no_leakage` (ou equivalente) antes de calcular a
        predição final.
        """
        ...

    @abstractmethod
    def get_params(self) -> dict:
        """Retorna os hiperparâmetros/parâmetros ajustados atuais do modelo.

        Usado tanto para serialização (persistir junto ao artefato do modelo)
        quanto para exibição em `GET /models/{model_id}/performance`.
        """
        ...

    def validate_no_leakage(self, event_data: dict, as_of: datetime) -> bool:
        """Verifica que nenhuma feature em `event_data` usa informação posterior a `as_of`.

        Implementação de referência: percorre campos de timestamp conhecidos
        (chaves terminadas em `"_at"`/`"_date"`, ou `"timestamp"`, `"as_of"`)
        e garante que nenhum é posterior a `as_of`.

        Exceção: `kickoff_at` é o horário agendado do evento sendo previsto —
        naturalmente no futuro em relação ao cutoff de treino. Não é dado
        histórico que possa vazar informação futura.

        Modelos com estruturas de dados mais ricas (ex.: séries temporais
        aninhadas) devem sobrescrever este método com uma checagem mais
        específica em vez de apenas confiar na implementação genérica.
        """
        # `kickoff_at` é metadado do evento a prever, não feature histórica
        _EXEMPT_KEYS = {"kickoff_at"}
        for key, value in event_data.items():
            if not isinstance(value, datetime):
                continue
            if key in _EXEMPT_KEYS:
                continue
            if key.endswith(("_at", "_date")) or key in {"timestamp", "as_of"}:
                if value > as_of:
                    return False
        return True
