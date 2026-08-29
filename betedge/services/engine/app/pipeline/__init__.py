"""Pipeline orquestrador do PREDIQ — executa o fluxo end-to-end.

odds_history → feature builder → modelos → ensemble →
model_predictions → value engine → value_opportunities →
grading → model_performance

Ver PIPELINE_CONTRACT.md v1.0.0 para o contrato completo.
"""
