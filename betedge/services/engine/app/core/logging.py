"""Configuração de logging estruturado (JSON) do Motor Estatístico.

Logs em JSON facilitam a ingestão por ferramentas de observabilidade
(CloudWatch, Datadog, Loki, etc.) sem parsing frágil de texto livre.
"""
import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from app.core.config import settings

# Campos padrão do LogRecord que NÃO devem ser duplicados no JSON de saída
# (já são cobertos por chaves explícitas como "level", "message", "logger").
_RESERVED_RECORD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "taskName",
}


class JSONFormatter(logging.Formatter):
    """Formata cada LogRecord como uma linha JSON única."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        # Campos extras passados via logger.info(..., extra={...}) entram
        # diretamente no JSON, permitindo correlação (ex.: event_id, model_id).
        for key, value in record.__dict__.items():
            if key not in _RESERVED_RECORD_ATTRS and not key.startswith("_"):
                payload.setdefault(key, value)

        return json.dumps(payload, default=str, ensure_ascii=False)


def setup_logging() -> None:
    """Configura o logger raiz da aplicação. Deve ser chamado uma única vez no boot."""
    root_logger = logging.getLogger()
    root_logger.handlers.clear()

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JSONFormatter())
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.DEBUG if settings.DEBUG else logging.INFO)

    # Bibliotecas de terceiros tendem a ser verbosas demais em INFO/DEBUG.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
