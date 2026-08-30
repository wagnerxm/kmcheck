"""Task de treino de modelo — executada de forma assíncrona pelo worker Python.

Disparada por `POST /models/{model_id}/retrain` no Motor Estatístico (ver
`services/engine/app/api/models_api.py::retrain_model`), que apenas publica
esta task no Celery e retorna o `job_id` imediatamente — o treino em si
(potencialmente demorado: otimização numérica, validação walk-forward)
acontece aqui, fora do request-response da API.

Nota de arquitetura: este worker roda como serviço separado do Motor
Estatístico (containers distintos). Ele não importa diretamente as classes
de `services/engine/app/models/*` — em produção, a implementação completa
desta task deve reutilizar essa lógica via um pacote Python compartilhado
(publicado internamente) ou, alternativamente, chamar de volta o Motor
Estatístico via API interna. Este scaffold apenas documenta o contrato.
"""
from datetime import datetime
from typing import Any

from celery_app import celery_app


@celery_app.task(
    name="tasks.train_model",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def train_model(
    self,
    model_id: str,
    cutoff_date_iso: str,
    hyperparameters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Treina (ou retreina) um modelo até `cutoff_date_iso` (inclusive) e persiste o artefato.

    Args:
        model_id: identificador do modelo a treinar (ex.: "dixon_coles", "gradient_boost_btts").
        cutoff_date_iso: data de corte do treino, em formato ISO 8601. Nenhum
            dado posterior a esta data deve influenciar o treino (regra
            central do projeto — ver `app.models.base.BaseModel.train`).
        hyperparameters: override opcional de hiperparâmetros do modelo.

    Returns:
        dict com o resumo do treino: métricas, caminho do artefato salvo,
        timestamp de conclusão.

    TODO(fase 1):
        1. Carregar a classe do modelo a partir de `model_id` (registro de
           modelos disponíveis, espelhando `app/models/` do Motor Estatístico).
        2. Carregar os dados de treino (via conexão direta ao Postgres ou
           via um endpoint interno de exportação de dataset).
        3. Instanciar o modelo, aplicar `hyperparameters` se fornecido, e
           chamar `model.train(training_data, cutoff_date=cutoff_date)`.
        4. Rodar validação walk-forward (`app.validation.walk_forward`) para
           reportar métricas honestas de performance fora da amostra.
        5. Serializar o modelo treinado em `MODEL_STORAGE_PATH` e registrar a
           nova versão na tabela `model_versions`.
    """
    cutoff_date = datetime.fromisoformat(cutoff_date_iso)

    self.update_state(state="STARTED", meta={"model_id": model_id, "cutoff_date": cutoff_date_iso})

    raise NotImplementedError(
        f"Treino do modelo '{model_id}' (cutoff={cutoff_date.isoformat()}, "
        f"hyperparameters={hyperparameters}) será implementado na Fase 1."
    )
