"""Motor de cálculo de value bets — probabilidade justa, edge, EV e edge score.

Este pacote contém a matemática pura (sem I/O, sem dependência de banco de
dados) usada tanto pelos endpoints em `app/api/value.py`/`app/api/odds.py`
quanto pelo backtesting (`app/api/backtest.py`) — reaproveitar a mesma
implementação garante que a simulação histórica avalia exatamente a mesma
lógica usada em produção.
"""
