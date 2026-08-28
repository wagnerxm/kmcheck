"""Estratégias de validação temporal dos modelos do BetEdge.

Dados esportivos são inerentemente sequenciais no tempo — validação
aleatória (k-fold clássico) vaza informação futura para o passado e
superestima a qualidade real dos modelos em produção. Os módulos aqui
implementam apenas esquemas de validação que respeitam a ordem cronológica.
"""
