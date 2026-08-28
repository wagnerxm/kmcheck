"""Configuração central do Motor Estatístico, carregada via variáveis de ambiente/.env.

Usamos pydantic-settings para validar tipos na inicialização — preferimos falhar
rápido no boot do container a descobrir uma variável ausente em produção.
"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configurações da aplicação, lidas de variáveis de ambiente ou de um arquivo .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # --- Metadados da aplicação ---
    APP_NAME: str = "BetEdge Motor Estatístico"
    ENV: str = "development"
    DEBUG: bool = False

    # --- Banco de dados (Postgres via SQLAlchemy async + asyncpg) ---
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://betedge:betedge@localhost:5432/betedge",
        description="DSN assíncrono do Postgres (dialeto asyncpg).",
    )

    # --- Redis (cache de predições, filas de suporte, rate limiting) ---
    REDIS_URL: str = Field(
        default="redis://localhost:6379/0",
        description="URL de conexão do Redis.",
    )

    # --- Segurança: comunicação BFF -> Engine é autenticada por API key ---
    ENGINE_API_KEY: str = Field(
        default="changeme-dev-key",
        description="Chave usada pelo BFF para autenticar chamadas a este serviço.",
    )

    # --- CORS: origens do frontend autorizadas a chamar a API diretamente ---
    CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000"],
        description="Lista de origens (schema+host+porta) liberadas no CORS.",
    )

    # --- Armazenamento de artefatos de modelo treinado ---
    MODEL_STORAGE_PATH: str = Field(
        default="/app/models_storage",
        description="Diretório onde os modelos treinados (pesos, params) são persistidos.",
    )

    # --- Celery / workers Python (treino de modelo, backtests) ---
    CELERY_BROKER_URL: str | None = None
    CELERY_RESULT_BACKEND: str | None = None

    @property
    def celery_broker_url(self) -> str:
        """Usa o próprio Redis como broker do Celery quando não configurado à parte."""
        return self.CELERY_BROKER_URL or self.REDIS_URL

    @property
    def celery_result_backend(self) -> str:
        return self.CELERY_RESULT_BACKEND or self.REDIS_URL


@lru_cache
def get_settings() -> Settings:
    """Cache simples de singleton — evita reler/revalidar o .env a cada request."""
    return Settings()


settings = get_settings()
