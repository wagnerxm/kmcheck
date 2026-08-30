"""Dependencies compartilhadas do FastAPI (injetadas via `Depends(...)`)."""
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db as _get_db
from app.core.redis import get_redis as _get_redis
from app.core.security import API_KEY_HEADER, is_valid_api_key

# Reexportados para que as rotas importem tudo de `app.core.deps`.
get_db = _get_db
get_redis = _get_redis


async def verify_api_key(
    x_engine_api_key: Annotated[str | None, Header(alias=API_KEY_HEADER)] = None,
) -> None:
    """Garante que a chamada veio do BFF autenticado, não da internet aberta.

    Levanta 401 quando a chave está ausente ou incorreta. Usado como
    dependency global (ver `app/main.py`) em todos os routers de negócio.
    """
    if not is_valid_api_key(x_engine_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Chave de API inválida ou ausente.",
        )


DbSession = Annotated[AsyncSession, Depends(get_db)]
RedisClient = Annotated[Redis, Depends(get_redis)]
