# Dockerfile multi-stage do Motor Estatístico (FastAPI).
# Stage 1 instala as dependências em um venv isolado; Stage 2 copia apenas
# o venv pronto + código da aplicação, mantendo a imagem final enxuta.

# ---------- Stage 1: build de dependências ----------
FROM python:3.11-slim AS builder

# Pacotes de build necessários para compilar dependências nativas
# (xgboost, lightgbm, psycopg2-binary, etc.).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cria um venv dedicado para copiarmos apenas ele no stage final.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ---------- Stage 2: imagem final de execução ----------
FROM python:3.11-slim AS runtime

# libgomp1 é necessária em runtime para xgboost/lightgbm (OpenMP).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash betedge

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY app ./app

# Diretório onde os modelos treinados (.pkl/.json) são persistidos.
RUN mkdir -p /app/models_storage && chown -R betedge:betedge /app

USER betedge

EXPOSE 8000

# --proxy-headers porque o serviço fica atrás do BFF/ingress da BetEdge.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
