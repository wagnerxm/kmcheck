"""Shadow Mode v1 do pipeline PREDIQ.

Operação automatizada de validação prospectiva: executa o pipeline diariamente,
persiste previsões em shadow_predictions (append-only), captura closing odds,
faz grading automático após resultado, e calcula métricas agregadas.

Nenhuma previsão poderá ser modificada após o início do evento (kickoff_at).
Nenhum dinheiro real é utilizado.
"""
