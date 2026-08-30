"""Motor de cálculo de value bets — probabilidade justa, edge, EV, edge score e Kelly.

Este pacote contém a matemática pura (sem I/O, sem dependência de banco de
dados) usada tanto pelos endpoints em `app/api/value.py`/`app/api/odds.py`
quanto pelo backtesting (`app/api/backtest.py`) — reaproveitar a mesma
implementação garante que a simulação histórica avalia exatamente a mesma
lógica usada em produção.

Módulos:
    engine.py       — probabilidade implícita, remoção de vig, edge, EV,
                      Edge Score (7 componentes, §7.5), compressão logística,
                      otimização de pesos via regressão de CLV.
    kelly.py        — critério de Kelly (pleno e fracionário) para
                      dimensionamento de stake.
    opportunity.py  — pipeline de detecção de oportunidades de valor:
                      conecta predições + odds → oportunidades pontuadas.
"""
