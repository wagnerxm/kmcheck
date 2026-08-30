# Dockerfile do worker Python (Celery) do BetEdge — treino de modelos,
# backtests e computação de features em lote.

FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash betedge

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

WORKDIR /app
COPY celery_app.py ./
COPY tasks ./tasks

USER betedge

# Sem porta exposta — este serviço não atende HTTP, apenas consome jobs do
# broker Redis. `-A celery_app` referencia a instância definida em celery_app.py.
CMD ["celery", "-A", "celery_app", "worker", "--loglevel=info"]
