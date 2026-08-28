"""Configuração do SQLAlchemy assíncrono (engine + fábrica de sessões).

O Motor Estatístico é majoritariamente leitor: consulta dados de eventos, odds
históricas e features já materializadas por outros serviços (ETL/workers).
Escritas ficam restritas a predições geradas e resultados de backtest.
"""
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Base declarativa compartilhada por todos os modelos ORM do serviço."""


# pool_pre_ping evita usar conexões mortas após o Postgres reciclar/derrubar
# conexões ociosas (comum em ambientes gerenciados como RDS/Supabase).
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency do FastAPI: entrega uma sessão por request e garante o fechamento."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


@asynccontextmanager
async def db_session_ctx() -> AsyncGenerator[AsyncSession, None]:
    """Context manager para uso fora de requests HTTP (tasks do Celery, scripts)."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def connect_db() -> None:
    """Verifica conectividade com o banco no startup da aplicação (fail-fast)."""
    from sqlalchemy import text

    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    logger.info("Conexão com o banco de dados verificada com sucesso.")


async def disconnect_db() -> None:
    """Fecha o pool de conexões no shutdown da aplicação."""
    await engine.dispose()
    logger.info("Pool de conexões com o banco de dados encerrado.")
