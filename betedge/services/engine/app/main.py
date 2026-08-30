"""Ponto de entrada da aplicação FastAPI do Motor Estatístico do BetEdge.

Responsável por: montar os routers da API, configurar CORS, e gerenciar o
ciclo de vida (conectar/desconectar banco e Redis) via `lifespan`.
"""
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import settings
from app.core.db import connect_db, disconnect_db
from app.core.deps import verify_api_key
from app.core.logging import setup_logging
from app.core.redis import connect_redis, disconnect_redis

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Gerencia startup/shutdown: garante que dependências externas estão de pé
    antes de aceitar tráfego, e as libera de forma limpa ao encerrar.
    """
    logger.info("Iniciando %s...", settings.APP_NAME)
    await connect_db()
    await connect_redis()
    logger.info("Motor Estatístico pronto para receber requisições.")

    yield

    logger.info("Encerrando %s...", settings.APP_NAME)
    await disconnect_redis()
    await disconnect_db()
    logger.info("Encerramento concluído.")


app = FastAPI(
    title="BetEdge Motor Estatístico",
    description=(
        "Serviço interno responsável por gerar predições estatísticas de eventos "
        "esportivos, calcular oportunidades de valor (value bets) a partir da "
        "comparação entre probabilidade do modelo e probabilidade justa de mercado, "
        "e executar backtests de modelos e estratégias de aposta. "
        "Consumido exclusivamente pelo BFF da plataforma (comunicação servidor-a-servidor)."
    ),
    version="0.1.0",
    contact={"name": "Equipe BetEdge"},
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)

# Em produção o Motor Estatístico só é chamado pelo BFF (servidor-a-servidor),
# mas mantemos CORS configurável para permitir chamadas diretas do frontend
# em ambientes de desenvolvimento/staging.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Todas as rotas de negócio exigem a API key do BFF; `/health` é registrado
# fora deste `include_router` (ver app/api/__init__.py) para ficar acessível
# a probes de infraestrutura sem autenticação.
app.include_router(api_router, prefix="/api", dependencies=[Depends(verify_api_key)])

# Health check também exposto na raiz, sem prefixo /api e sem exigir API key,
# para simplificar a configuração de liveness/readiness probes.
from app.api import health  # noqa: E402 — import tardio para evitar ciclo com api_router

app.include_router(health.router, tags=["health"])


@app.get("/", tags=["health"], summary="Ping raiz do serviço")
async def root() -> dict[str, str]:
    """Endpoint simples para confirmar que o serviço está no ar."""
    return {"service": settings.APP_NAME, "status": "ok"}
