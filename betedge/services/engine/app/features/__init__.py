"""Camada de features do Motor Estatístico.

`registry.py` define o catálogo de features disponíveis (nome, descrição,
função de cálculo, janela temporal de disponibilidade). `batch.py` computa
features em lote para treino de modelos; `on_demand.py` computa o vetor de
features de um único evento no momento da predição.
"""
