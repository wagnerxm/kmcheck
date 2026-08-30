"""Cliente Redis compartilhado pela aplicação.

Usado para cache de predições/odds já calculadas (evitar reprocessar o mesmo
evento a cada request) e, futuramente, como broker do Celery para as tasks
de treino/backtest executadas pelos workers Python.
"""
import logging
from collections.abc import AsyncGenerator

from redis.asyncio import ConnectionPool, Redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# Pool único reaproveitado por toda a aplicação — evita reabrir conexão TCP
# a cada request. max_connections generoso pois o serviço pode ter várias
# rotas concorrentes lendo cache de odds/predições.
_redis_pool: ConnectionPool = ConnectionPool.from_url(
    settings.REDIS_URL,
    max_connections=50,
    decode_responses=True,
)

_redis_client: Redis | None = None


def get_redis_client() -> Redis:
    """Retorna (criando se necessário) o cliente Redis singleton do processo."""
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis(connection_pool=_redis_pool)
    return _redis_client


async def get_redis() -> AsyncGenerator[Redis, None]:
    """Dependency do FastAPI para injetar o cliente Redis nas rotas."""
    yield get_redis_client()


async def connect_redis() -> None:
    """Faz um PING de verificação no startup da aplicação (fail-fast)."""
    client = get_redis_client()
    await client.ping()
    logger.info("Conexão com o Redis verificada com sucesso.")


async def disconnect_redis() -> None:
    """Fecha o pool de conexões do Redis no shutdown da aplicação."""
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
    await _redis_pool.disconnect()
    logger.info("Pool de conexões do Redis encerrado.")
