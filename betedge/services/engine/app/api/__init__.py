"""Agregação de todos os routers da API do Motor Estatístico.

`app/main.py` importa apenas `api_router` deste módulo, mantendo o
registro de rotas centralizado num único lugar.
"""
from fastapi import APIRouter

from app.api import backtest, health, models_api, odds, predictions, validation, value

api_router = APIRouter()

# `health` fica fora do prefixo /api porque é consultado por probes de
# infraestrutura (liveness/readiness) que não devem exigir API key.
api_router.include_router(health.router, tags=["health"])

api_router.include_router(predictions.router, prefix="/predictions", tags=["predictions"])
api_router.include_router(value.router, prefix="/value", tags=["value"])
api_router.include_router(models_api.router, prefix="/models", tags=["models"])
api_router.include_router(backtest.router, prefix="/backtest", tags=["backtest"])
api_router.include_router(odds.router, prefix="/odds", tags=["odds"])
api_router.include_router(validation.router, prefix="/validation", tags=["validation"])

__all__ = ["api_router"]
