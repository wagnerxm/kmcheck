"""Calibração pós-hoc de probabilidades — ajusta modelos para que as
probabilidades preditas reflitam melhor as frequências reais observadas.

Técnicas implementadas:

- **Platt scaling** (regressão logística 1D): ajusta sigmóide `1/(1+exp(-(a*f+b)))`
  sobre as log-odds do modelo, aprendendo 2 parâmetros (a, b) por máxima
  verossimilhança sobre um conjunto de validação temporal. Eficaz quando a
  descalibração é monotônica e suave (overconfidence uniforme, por ex.).

- **Isotonic regression**: ajuste não-paramétrico monotônico — "step function"
  que mapeia probabilidades preditas → frequências observadas de forma
  livre (sem assumir forma funcional). Mais flexível que Platt, mas
  precisa de mais dados para evitar overfitting em bins com poucas amostras.

- **Temperature scaling**: caso especial de Platt com `a = 1/T, b = 0` —
  apenas um parâmetro (temperatura T), que uniformemente "suaviza" (T > 1)
  ou "aguça" (T < 1) as probabilidades do modelo. Útil para redes neurais
  ou qualquer modelo cuja descalibração principal é sobre/sub-confiança
  uniforme; preserva a ordenação das probabilidades.

Todas as técnicas são treinadas sobre um conjunto de validação TEMPORAL
(posterior ao treino do modelo-base) para evitar vazamento de dados.
"""
