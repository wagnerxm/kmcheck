"""Verificação de API key para a comunicação BFF -> Motor Estatístico.

O Motor Estatístico não é exposto diretamente à internet: apenas o BFF
(Backend for Frontend) o consome, autenticando cada chamada com uma chave
estática compartilhada, enviada no header `X-Engine-Api-Key`.
"""
import hmac

from app.core.config import settings

API_KEY_HEADER = "X-Engine-Api-Key"


def is_valid_api_key(candidate: str | None) -> bool:
    """Compara a chave recebida com a configurada, em tempo constante.

    Usamos `hmac.compare_digest` para evitar timing attacks — comparação
    ingênua com `==` vaza informação sobre quantos caracteres coincidem.
    """
    if not candidate:
        return False
    return hmac.compare_digest(candidate, settings.ENGINE_API_KEY)
