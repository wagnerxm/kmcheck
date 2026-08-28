"""Configuração da aplicação Celery do worker Python do BetEdge.

Este worker é o braço "pesado" do processamento assíncrono: treino de
modelos estatísticos/ML, execução de backtests e computação de features em
lote — tudo trabalho demorado demais para rodar dentro do request-response
do Motor Estatístico (FastAPI), que apenas ENFILEIRA essas tasks
(ver `app/api/models_api.py::retrain_model`, `app/api/backtest.py::run_backtest`)
e consulta o resultado de forma assíncrona.
"""
import os

from celery import Celery
from celery.signals import setup_logging as celery_setup_logging_signal

# Redis serve tanto de broker (fila de tasks) quanto de result backend
# (armazenamento do resultado/status de cada task) — suficiente para o
# volume desta fase do projeto; migrar o backend para Postgres/RabbitMQ é
# uma otimização futura caso o throughput exija.
BROKER_URL = os.environ.get("CELERY_BROKER_URL", os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", BROKER_URL)

celery_app = Celery(
    "betedge_workers",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
    include=[
        "tasks.train_model",
        "tasks.run_backtest",
        "tasks.compute_features_batch",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # Tasks de treino/backtest podem demorar minutos — não aceitamos o
    # comportamento padrão de "ack antes de executar" (perderia a task se o
    # worker morresse no meio do processamento).
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Tempo máximo de uma task antes do worker ser encerrado à força — evita
    # que um bug de loop infinito em um treino trave o worker indefinidamente.
    task_time_limit=60 * 60,  # 1 hora
    task_soft_time_limit=55 * 60,
)


@celery_setup_logging_signal.connect
def _configure_celery_logging(**kwargs) -> None:
    """Reaproveita a configuração de logging estruturado (JSON) em vez do padrão do Celery.

    Evita duas configurações de logging divergentes entre o Motor Estatístico
    (FastAPI) e este worker — ambos devem produzir logs no mesmo formato para
    facilitar correlação em observabilidade.
    """
    import logging
    import sys

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


if __name__ == "__main__":
    celery_app.start()
