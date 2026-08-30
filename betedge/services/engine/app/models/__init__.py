"""Modelos estatísticos do Motor Estatístico do BetEdge.

Todo modelo concreto herda de `app.models.base.BaseModel` e implementa
`train`, `predict` e `get_params`. Isso garante uma interface uniforme para
o `app.models.ensemble.EnsembleModel` combinar predições de fontes distintas
(estatísticas puras, machine learning e consenso de mercado).
"""
