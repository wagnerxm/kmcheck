# BetEdge — Modelagem Estatística

**Documento de referência técnica e metodológica do motor estatístico/ML**
Versão do documento: 1.0.0 · Última revisão: 2026-08-28

---

## Sumário

1. [Princípios Fundamentais](#1-princípios-fundamentais)
2. [Modelos Implementados](#2-modelos-implementados)
3. [Feature Engineering](#3-feature-engineering)
4. [Prevenção de Data Leakage](#4-prevenção-de-data-leakage)
5. [Validação e Backtesting](#5-validação-e-backtesting)
6. [Métricas de Performance](#6-métricas-de-performance)
7. [Value Engine (cálculos detalhados)](#7-value-engine-cálculos-detalhados)
8. [Pipeline de Predição](#8-pipeline-de-predição)
9. [Treinamento e Retreinamento](#9-treinamento-e-retreinamento)
10. [Limitações e Disclaimers](#10-limitações-e-disclaimers)

---

## 1. Princípios Fundamentais

O motor estatístico do BetEdge existe para produzir probabilidades **pré-jogo** de futebol que sejam
defensáveis matematicamente, auditáveis a qualquer momento e — acima de tudo — **bem calibradas**. Os
quatro princípios abaixo não são aspiracionais: eles são requisitos de arquitetura que restringem como
cada modelo é construído, versionado e servido.

### 1.1 Reprodutibilidade

Toda predição gerada pela plataforma deve ser reconstituível byte-a-byte a partir de três coordenadas
imutáveis, gravadas junto com a própria predição:

```
prediction = f(model_version, features_version, training_data_cutoff)
```

- **`model_version`** — hash/tag do artefato do modelo (pesos, hiperparâmetros, código de inferência).
  Segue versionamento semântico (`poisson-2.3.1`, `xgb-1x2-4.0.0`).
- **`features_version`** — schema versionado das features usadas no momento da predição (ver
  [§3.7](#37-versionamento-de-features)). Uma mudança na definição de uma feature (ex.: janela de forma
  de 5 para 10 jogos) **sempre** gera uma nova `features_version`, nunca sobrescreve a antiga.
- **`training_data_cutoff`** — timestamp exato (UTC) até o qual dados de partidas foram usados no
  treino/calibração do modelo. Nenhum dado com `match_datetime > training_data_cutoff` pode ter
  participado do fit.

Nenhuma predição é servida sem esses três campos persistidos. Isso permite (a) auditoria externa,
(b) depuração de regressões de performance, e (c) comparação justa entre versões de modelo (A/B testing,
§9.4).

### 1.2 Integridade Temporal

**Nenhuma informação posterior ao apito inicial (kickoff) da partida-alvo pode alcançar o cálculo da
probabilidade pré-jogo daquela partida.** Isso vale para:

- Features computadas (forma, xG médio, rating Elo) — todas devem usar apenas jogos com
  `match_datetime < target_kickoff`.
- Dados de mercado (odds) — apenas cotações capturadas antes do kickoff podem ser usadas como feature
  ou como benchmark de "mercado justo" pré-jogo.
- Escalações/lineups — só entram como feature se disponíveis e capturadas antes do apito (tipicamente
  ~60 min antes), e disparam **re-predição**, nunca retroagem sobre a predição original (§8.4).

A integridade temporal é a linha de defesa mais crítica contra *data leakage* e é tratada em detalhe na
Seção 4.

### 1.3 Auditabilidade

Uma predição, uma vez gerada e persistida, é **imutável**. Ela nunca é "corrigida" ou substituída
silenciosamente. Quando novas informações justificam uma nova estimativa (movimento de linha
significativo, escalação confirmada), o sistema cria um **novo registro de predição** vinculado ao
mesmo `match_id`, com seu próprio timestamp de geração e sua própria cadeia de proveniência
(`model_version` + `features_version` + `training_data_cutoff`). O histórico completo de predições de
uma partida é preservado, permitindo reconstruir "o que o modelo sabia e quando".

Consequências de arquitetura:

- Tabela de predições é *append-only* (sem `UPDATE`/`DELETE` em produção; correções passam por
  *soft-delete* com auditoria).
- Cada predição carrega um `generated_at` e um `superseded_by` opcional, apontando para a predição
  seguinte da mesma partida, se houver.
- Métricas de performance (Brier, log loss, CLV) são sempre calculadas contra a predição que estava
  **vigente em cada instante**, não retroativamente contra a última versão.

### 1.4 Calibração acima de Acurácia

Um modelo que "acerta muito" mas atribui 80% de probabilidade a resultados que ocorrem 55% das vezes é
**inútil e perigoso** para apostas — ele gera falsos positivos de valor (edges que não existem). O
BetEdge otimiza e seleciona modelos primariamente por:

1. **Calibração** (ECE/MCE, curva de confiabilidade — §6.3) — "quando o modelo diz 30%, o evento
   acontece ~30% das vezes?"
2. **Log loss** (§6.2) — penaliza fortemente confiança alta e errada, é a função objetivo primária de
   treino para os modelos discriminativos.
3. **Brier score** (§6.1) — métrica de erro quadrático probabilístico, decomponível em confiabilidade +
   resolução + incerteza.

*Hit rate* (§6.5) é reportado por transparência e para comunicação com usuários, mas **nunca** é usado
como critério de seleção de modelo isoladamente — um modelo pode ter hit rate alto simplesmente por
prever sempre o favorito óbvio, sem gerar qualquer edge real sobre o mercado.

---

## 2. Modelos Implementados

O BetEdge mantém um portfólio de modelos heterogêneos — estatísticos clássicos, ratings, aprendizado de
máquina supervisionado e o próprio consenso de mercado — combinados por um ensemble (§2.8). A
diversidade de abordagens é deliberada: modelos com vieses diferentes, quando corretamente ponderados,
produzem uma estimativa de consenso mais robusta e uma medida útil de incerteza (discordância entre
modelos, usada no Edge Score, §7.5).

### 2.1 Poisson (Independente)

**Fundamento matemático.** O número de gols de cada equipe em uma partida é modelado como uma variável
aleatória de Poisson independente:

```
Gols_casa  ~ Poisson(λ_casa)
Gols_fora  ~ Poisson(λ_fora)
```

As taxas esperadas (λ) são decompostas em força de ataque, força de defesa do adversário e fator de
mando de campo:

```
λ_casa = ataque_casa × defesa_fora × vantagem_mando × μ
λ_fora = ataque_fora × defesa_casa × μ
```

onde `μ` é a média geral de gols da liga (constante de normalização) e `vantagem_mando > 1` captura o
efeito sistemático de jogar em casa.

**Parâmetros.** Para cada equipe `i` da liga: `ataque_i` (propensão ofensiva relativa à média da liga) e
`defesa_i` (propensão a sofrer gols, relativa à média da liga). Restrição de identificabilidade:

```
∏ ataque_i = 1        (ou, em log-escala, Σ log(ataque_i) = 0)
∏ defesa_i = 1
```

Mais um parâmetro escalar de vantagem de mando (`γ = vantagem_mando`), estimado por liga (ligas com
público mais influente tendem a `γ` maior).

**Estimação (MLE).** Os parâmetros são estimados por máxima verossimilhança sobre o histórico de
resultados da liga, maximizando:

```
L(α, β, γ) = Π_partidas  [ Poisson(x_casa; λ_casa) × Poisson(x_fora; λ_fora) ]
```

onde `α = {ataque_i}`, `β = {defesa_i}`. Na prática, otimiza-se o log-likelihood negativo via
gradiente (L-BFGS), pois a Poisson pertence à família exponencial e a log-verossimilhança é côncava em
`(log α, log β, log γ)`, garantindo convergência a um ótimo global bem comportado.

**Mercados derivados.**

- **1X2**: soma da massa de probabilidade conjunta sobre a grade de placares.

  ```
  P(casa vence)  = Σ_{h > a} Poisson(h; λ_casa) × Poisson(a; λ_fora)
  P(empate)      = Σ_{h = a} Poisson(h; λ_casa) × Poisson(a; λ_fora)
  P(fora vence)  = Σ_{h < a} Poisson(h; λ_casa) × Poisson(a; λ_fora)
  ```

  truncado em `h, a ∈ [0, N]` com `N = 10` (probabilidade residual acima de 10 gols é desprezível e
  redistribuída proporcionalmente).

- **Over/Under X.5 gols**: seja `Total = Gols_casa + Gols_fora`. Como soma de duas Poisson
  independentes é Poisson(`λ_casa + λ_fora`):

  ```
  P(Over X.5) = 1 − Σ_{k=0}^{⌊X⌋} Poisson(k; λ_casa + λ_fora)
  ```

- **BTTS (Ambas Marcam)**:

  ```
  P(BTTS = Sim) = (1 − e^{−λ_casa}) × (1 − e^{−λ_fora})
  P(BTTS = Não) = 1 − P(BTTS = Sim)
  ```

- **Grade de placar correto**: matriz `P(h, a) = Poisson(h; λ_casa) × Poisson(a; λ_fora)` para todo
  `(h, a)` na grade — usada diretamente para odds de placar exato e como insumo para handicaps
  asiáticos (§2.1, Asian Handicap abaixo) e team totals.

- **Asian Handicap / Team Totals**: computados por integração direta sobre a mesma grade conjunta
  `P(h, a)`, aplicando a linha de handicap ou o total da equipe a cada célula e somando/redistribuindo
  massa de probabilidade em linhas com push (handicaps inteiros).

**Limitações.** A suposição central — independência entre `Gols_casa` e `Gols_fora` — é empiricamente
violada, sobretudo em placares baixos: jogos 0-0 e 1-1 ocorrem com frequência ligeiramente maior do que
o modelo prevê, e 1-0/0-1 têm padrão de correlação negativa sutil (dinâmica tática de "segurar o
resultado" quando um time sai na frente). O modelo de Poisson puro tende a **subestimar empates** e
**desalinhar levemente as probabilidades de placares 0-0, 1-0, 0-1, 1-1** — exatamente a lacuna que o
Dixon-Coles (§2.2) foi desenhado para corrigir. Além disso, Poisson puro não pondera jogos recentes mais
que antigos (a menos que se restrinja a janela de treino), não captura tendência/momentum, e é sensível
a mudanças estruturais na equipe (transferências, técnico) não refletidas no histórico usado.

**Mercados aplicáveis:** 1X2, Over/Under, BTTS, Team Totals, Asian Handicap, placar correto.

---

### 2.2 Dixon-Coles

**Fundamento matemático.** Dixon & Coles (1997) estendem o modelo de Poisson duplo introduzindo uma
função de correção `τ` aplicada exclusivamente aos placares de baixa contagem (0-0, 1-0, 0-1, 1-1), onde
a suposição de independência do Poisson puro mais falha:

```
P_DC(h, a) = τ(h, a; λ_casa, λ_fora, ρ) × Poisson(h; λ_casa) × Poisson(a; λ_fora)
```

com

```
τ(0, 0) = 1 − λ_casa·λ_fora·ρ
τ(0, 1) = 1 + λ_casa·ρ
τ(1, 0) = 1 + λ_fora·ρ
τ(1, 1) = 1 − ρ
τ(h, a) = 1                    para todo h ≥ 2 ou a ≥ 2
```

**Parâmetro ρ (rho).** Captura a dependência residual entre gols de casa e fora após controlar por
ataque/defesa/mando. Tipicamente `ρ < 0` no futebol (correlação negativa fraca), refletindo o padrão
observado de empates 0-0/1-1 mais frequentes e resultados 1-0/0-1 levemente menos frequentes do que a
independência pura preveria. `ρ` é estimado conjuntamente com os parâmetros de ataque/defesa/mando por
máxima verossimilhança (ou reestimado periodicamente sobre um painel de ligas, já que seu valor é
relativamente estável entre campeonatos de perfil tático semelhante).

**Ponderação temporal (decaimento exponencial).** A principal contribuição prática de Dixon-Coles é
ponderar cada partida do histórico pela sua recência, dando mais peso a jogos recentes na estimação dos
parâmetros de ataque/defesa (que mudam ao longo do tempo — forma, elenco, técnico):

```
φ_t = exp(−ξ · Δt)
```

onde `Δt` é o tempo decorrido (em dias) entre a partida histórica e a data de referência da estimação, e
`ξ` (xi) é o parâmetro de decaimento, tipicamente calibrado por validação cruzada temporal na faixa de
`ξ ∈ [0.0005, 0.005]` (meia-vida efetiva entre ~4 e ~40 meses). Quanto maior `ξ`, mais o modelo
"esquece" resultados antigos e reage a mudanças recentes de forma — trade-off clássico
viés/variância.

**Estimação (pseudo-verossimilhança maximizada).** A função objetivo é a log-verossimilhança ponderada:

```
ℓ(α, β, γ, ρ) = Σ_t  φ_t · [ log Poisson(x_casa,t; λ_casa,t) + log Poisson(x_fora,t; λ_fora,t) + log τ(x_casa,t, x_fora,t; ρ) ]
```

maximizada numericamente (BFGS/L-BFGS-B), com as mesmas restrições de identificabilidade de Poisson
(§2.1). Chama-se "pseudo-verossimilhança" porque `τ` não define uma distribuição conjunta bivariada
formalmente consistente para todos os pontos (é uma correção local), mas o procedimento de otimização é
padrão na literatura e amplamente validado empiricamente.

**Vantagem sobre Poisson puro.** Melhora mensurável no ajuste da massa de probabilidade exatamente nos
placares mais frequentes e mais apostados: 0-0, 1-0, 0-1 e 1-1. Isso se traduz em melhor calibração para
mercados de placar exato, BTTS e Under 1.5/2.5 gols, onde a distribuição de baixa contagem domina o
resultado.

**Mercados aplicáveis:** os mesmos de Poisson (1X2, Over/Under, BTTS, Team Totals, Asian Handicap,
placar correto), com precisão superior nos mercados sensíveis a placares baixos.

---

### 2.3 Sistema de Rating Elo

**Fundamento matemático.** Adaptação do sistema Elo (originalmente xadrez) para futebol, tratando cada
partida como um evento de atualização de rating entre dois "jogadores" (equipes). A probabilidade de
vitória é derivada da diferença de rating por uma função logística:

```
E_casa = 1 / (1 + 10^(−(R_casa + H − R_fora) / 400))
```

onde `R_casa`, `R_fora` são os ratings correntes e `H` é o **bônus de mando de campo** somado ao rating
do time da casa antes do cálculo (tipicamente equivalente a 60–100 pontos Elo, calibrado por liga).

**Atualização pós-jogo.**

```
R_casa' = R_casa + K · (S_casa − E_casa)
R_fora'  = R_fora  + K · (S_fora  − E_fora)
```

onde `S_casa ∈ {0, 0.5, 1}` é o resultado real (derrota, empate, vitória) e `K` é o **fator K**, que
controla a velocidade de ajuste do rating. `E_fora = 1 − E_casa` no caso binário; para a extensão de
três resultados, ver abaixo.

**Rating inicial.** Times novos na base (promovidos, ligas recém-incorporadas) entram com rating igual
à média da divisão de destino, ajustado por um fator de incerteza inicial mais alto (K efetivamente
maior nas primeiras N partidas, análogo ao "provisional rating" do sistema Glicko) até acumular
histórico suficiente.

**Fatores K diferenciados por camada de liga.** O `K` não é único — reflete quanto uma única partida
deve mover o rating:

| Camada de liga | K típico | Justificativa |
|---|---|---|
| Top 5 europeu (elite) | 20 | Alta previsibilidade, muitos jogos, ajuste conservador |
| Segundas divisões / ligas médias | 30 | Maior volatilidade de elenco entre janelas |
| Ligas menores / copas nacionais | 40 | Amostra menor, elencos mais instáveis, maior ruído aceito |
| Partidas de mata-mata / finais | multiplicador ×1.5 sobre o K-base | Maior peso informacional por jogo decisivo |

**Extensão para três resultados (1X2).** A probabilidade binária `E_casa` (vitória vs. não-vitória) é
convertida em três probabilidades (casa/empate/fora) por meio de um modelo auxiliar — tipicamente uma
regressão logística ordinal calibrada sobre `(R_casa − R_fora + H)` como preditor único, ou por
inferência de um parâmetro de "largura de empate" à la Elo-com-empates (Hvattum & Arntzen, 2010):

```
P(empate)      = f(|R_casa + H − R_fora|)      — decrescente na diferença absoluta de rating
P(casa vence)  = E_casa · (1 − P(empate))  ajustado por reponderação
P(fora vence)  = 1 − P(casa vence) − P(empate)
```

Os parâmetros de `f` são recalibrados periodicamente por liga via máxima verossimilhança sobre o
histórico de resultados reais vs. diferenças de rating observadas.

**Rastreamento histórico.** Cada atualização de rating é persistida com timestamp e `match_id` de
origem, formando uma série temporal completa por equipe — essencial tanto para a integridade temporal
(§1.2: o rating usado em uma predição é sempre o valor **anterior** ao kickoff daquela partida) quanto
para features derivadas (tendência de rating nos últimos N jogos, volatilidade do rating).

**Mercados aplicáveis:** primariamente 1X2 e Dupla Chance (soma de pares de probabilidades); usado
também como **feature de força relativa** de entrada para os modelos de regressão logística (§2.4) e
gradient boosting (§2.5).

---

### 2.4 Regressão Logística (Ordinal/Multinomial)

**Fundamento matemático.** Para 1X2, o BetEdge usa regressão logística multinomial (softmax) com classe
de referência "empate", modelando:

```
P(y = k | x) = exp(β_k · x) / Σ_{j ∈ {casa, empate, fora}} exp(β_j · x)
```

Alternativamente, para mercados naturalmente ordinais (ex.: faixas de handicap, Over/Under com múltiplas
linhas), emprega-se regressão logística ordinal (proportional-odds model), que assume razões de chances
constantes entre categorias ordenadas — mais parcimoniosa quando a suposição é razoável, testada por
Brant test antes do uso em produção.

**Conjunto de features.** Vetor `x` tipicamente inclui (ver Seção 3 para catálogo completo):

- **Forma recente**: pontos por jogo nos últimos 5/10 jogos (separado por mando de campo).
- **Confronto direto (H2H)**: histórico de resultados entre as duas equipes (janela de N confrontos
  mais recentes, com decaimento temporal).
- **Splits casa/fora**: desempenho da equipe da casa jogando em casa e da equipe visitante jogando fora,
  isoladamente (não misturado com o desempenho geral).
- **Dias de descanso**: intervalo desde o último jogo de cada equipe (fadiga, congestionamento de
  calendário).
- **Posição na tabela / pontos / saldo de gols**: força relativa corrente na competição.
- **Diferença de rating Elo** (§2.3) como feature agregadora de força.
- **xG médio recente** (§2.6) para/contra.

**Regularização.** L2 (ridge) é o padrão para estabilidade numérica em presença de features
correlacionadas (ex.: posição na tabela e pontos, ou rating Elo e forma recente são redundantes até
certo ponto). L1 (lasso) é usada em rodadas de seleção de features para zerar coeficientes de variáveis
com baixo poder preditivo incremental, reduzindo o vetor de entrada antes de treinar o modelo de
produção com L2. O hiperparâmetro de força de regularização (`λ` ou seu inverso `C`) é escolhido por
validação cruzada temporal (§5.2), nunca por validação aleatória k-fold (que vazaria informação futura).

**Seleção de features e importância.** Além do L1 para seleção, importância de features na regressão
logística é lida diretamente dos coeficientes padronizados (features normalizadas para média 0,
desvio-padrão 1 antes do fit, tornando os `β` comparáveis em magnitude) e validada por remoção
incremental (*ablation*): cada feature é removida isoladamente e o impacto no log loss de validação é
medido — features cuja remoção não degrada o log loss além de um limiar são candidatas a descarte.

**Papel no ensemble.** A regressão logística serve como modelo **linear e interpretável**, contraponto
aos modelos de árvore (§2.5) — sua simplicidade a torna menos propensa a overfitting em ligas com
histórico curto, e seus coeficientes servem como checagem de sanidade ("o modelo aprendeu que forma
recente e vantagem de mando pesam na direção certa?") antes de confiar em modelos mais opacos.

**Mercados aplicáveis:** 1X2, Dupla Chance, Draw No Bet (via renormalização das probabilidades casa/fora
excluindo o empate).

---

### 2.5 Gradient Boosting (XGBoost / LightGBM)

**Fundamento.** Ensemble aditivo de árvores de decisão rasas, treinadas sequencialmente para corrigir o
erro residual (gradiente da função de perda) das árvores anteriores:

```
F_M(x) = Σ_{m=1}^{M} η · h_m(x)
```

onde cada `h_m` é uma árvore ajustada ao gradiente negativo da função de perda em relação às previsões
correntes, e `η` (learning rate/shrinkage) controla o tamanho do passo. Para 1X2, a função de perda é a
log loss multiclasse (softmax); para Over/Under e BTTS, log loss binária.

**Estratégia de tuning de hiperparâmetros (otimização Bayesiana).** Em vez de grid search exaustivo
(caro e ineficiente em espaço de alta dimensão), o BetEdge usa otimização Bayesiana (Tree-structured
Parzen Estimator, via Optuna) para buscar a combinação de hiperparâmetros que minimiza o log loss médio
em validação cruzada temporal:

| Hiperparâmetro | Espaço de busca típico | Papel |
|---|---|---|
| `max_depth` | 3–8 | Profundidade máxima da árvore — controla complexidade/overfitting |
| `learning_rate` (η) | 0.01–0.2 (log-scale) | Tamanho do passo de cada árvore |
| `n_estimators` | 100–2000 (com early stopping) | Número de árvores; limitado por parada antecipada |
| `min_child_weight` / `min_data_in_leaf` | 1–50 | Peso/contagem mínima por folha — regularização contra overfit em amostras pequenas |
| `subsample` | 0.6–1.0 | Fração de linhas amostradas por árvore (bagging) |
| `colsample_bytree` | 0.5–1.0 | Fração de features amostradas por árvore |
| `reg_alpha` (L1) / `reg_lambda` (L2) | 0–10 (log-scale) | Regularização nos pesos das folhas |

A busca Bayesiana roda tipicamente 100–300 trials, cada trial avaliado pela média do log loss nas dobras
de validação temporal (§5.2), com *pruning* precoce de trials claramente inferiores (algoritmo de
Hyperband/ASHA) para economizar cômputo.

**Pipeline de feature engineering.** Ver Seção 3 para o catálogo completo. Diferente da regressão
logística, o gradient boosting captura interações não-lineares entre features automaticamente (ex.:
"vantagem de forma só importa quando o confronto direto é historicamente equilibrado"), então o pipeline
inclui deliberadamente features "cruas" (sem produtos/interações manuais) e deixa o modelo de árvore
descobrir interações relevantes — reduzindo engenharia manual e risco de overfitting a interações
espúrias.

**SHAP values para interpretabilidade.** Cada predição de produção é acompanhada, sob demanda, de
valores SHAP (SHapley Additive exPlanations) por feature, decompondo a predição em:

```
f(x) = φ_0 + Σ_i φ_i
```

onde `φ_0` é o valor esperado base (probabilidade média da liga) e cada `φ_i` é a contribuição marginal
daquela feature para a predição específica, computada via TreeSHAP (algoritmo exato e eficiente para
modelos de árvore, custo polinomial em vez de exponencial). Isso alimenta:

- Explicações legíveis por humanos ("o modelo favorece o time da casa principalmente por: forma recente
  +0.08, vantagem de mando +0.05, H2H −0.02").
- Detecção de *drift* de importância de features ao longo do tempo (uma feature que subitamente domina
  todas as predições pode indicar um bug de pipeline).
- Auditoria de viés (garantir que nenhuma feature proxy problemática domine sistematicamente).

**Prevenção de overfitting.** Camadas de defesa combinadas:

1. **Early stopping** sobre uma partição de validação temporal separada (não usada no tuning de
   hiperparâmetros) — a árvore para de crescer quando o log loss de validação para de melhorar por N
   rodadas.
2. **Regularização L1/L2** nos pesos das folhas (`reg_alpha`, `reg_lambda`).
3. **Subsample/colsample** (bagging de linhas e colunas por árvore), reduzindo variância.
4. **Profundidade limitada** (`max_depth` ≤ 8) — árvores rasas generalizam melhor em dados esportivos
   ruidosos.
5. **Validação cruzada temporal estrita** (nunca k-fold aleatório — ver §4 e §5.2) para toda decisão de
   hiperparâmetro, seleção de features ou critério de parada.

**Validação cruzada com splits exclusivamente temporais.** Este é um ponto não-negociável: **nenhuma**
dobra de validação do gradient boosting usa amostragem aleatória. Toda dobra respeita
`treino: [t0, t1) → validação: [t1, t2)` com `t1 < t2` estritamente crescente (ver §5.1–5.2). Embaralhar
partidas aleatoriamente entre treino e validação vazaria informação de forma futura para o treino
(mesma equipe aparecendo em ambos os conjuntos com jogos adjacentes no tempo), inflando artificialmente
a performance de validação.

**Mercados aplicáveis:** 1X2, Over/Under (múltiplas linhas), BTTS, Team Totals, Draw No Bet, Dupla
Chance, Asian Handicap (via modelo auxiliar sobre a distribuição de diferença de gols).

---

### 2.6 Modelo baseado em xG (Expected Goals)

**xG como feature primária.** Expected Goals quantifica a qualidade agregada das chances de gol geradas
por uma equipe em uma partida, com base na probabilidade histórica de conversão de chutes com
características semelhantes (posição, ângulo, tipo de assistência, parte do corpo, se é pênalti, etc.).
O BetEdge não recalcula xG a partir de dados de eventos brutos (shot maps) — consome xG **pré-calculado**
de provedores de dados estruturados, tratando-o como uma feature de entrada de alta qualidade, não como
um modelo próprio de geração de xG.

**xG a favor/contra, médias móveis.** Para cada equipe, mantém-se:

```
xG_favor_janela_N  = média móvel do xG gerado pela equipe nos últimos N jogos
xG_contra_janela_N = média móvel do xG concedido pela equipe nos últimos N jogos
```

com janelas paralelas de N = 5 e N = 10 jogos (curto prazo captura forma recente; longo prazo captura
nível de base mais estável), e variantes separadas por mando de campo (xG em casa vs. xG fora).

**Métricas de qualidade de chute.** Complementares ao xG agregado:

- **xG por chute** (`xG / número de finalizações`) — proxy de qualidade vs. volume de criação.
- **xGOT** (Expected Goals on Target), quando disponível — refina xG considerando apenas chutes no alvo,
  reduzindo ruído de finalizações claramente fora.
- **Diferença xG − Gols reais** (finishing over/underperformance) — usada como sinal de regressão à
  média: equipes com gols reais consistentemente acima do xG tendem a regredir, e vice-versa. Este é um
  dos preditores mais robustos de reversão de forma na literatura de apostas esportivas.

**Requisitos e fontes de dados.** xG de qualidade aceitável exige cobertura de dados de eventos (shot
maps) de provedor confiável, com granularidade mínima de posição do chute, tipo de jogada e parte do
corpo. Ligas com cobertura de xG incompleta ou inexistente (tipicamente divisões inferiores e ligas de
menor visibilidade comercial) **não recebem features de xG** — o pipeline detecta ausência de dados de
xG por liga e degrada automaticamente para o conjunto de features sem xG, sem quebrar o modelo (ver
tratamento de valores ausentes em §3 e §10).

**Modelo de regressão sobre features de xG.** Duas abordagens convivem no BetEdge:

1. **xG como insumo de λ para Poisson/Dixon-Coles**: em vez de (ou além de) gols reais, `λ_casa` e
   `λ_fora` podem ser reestimados usando xG histórico como variável de treino (um "Poisson sobre xG"),
   suavizando o ruído inerente à contagem de gols reais (eventos raros e de alta variância) em favor de
   uma métrica de criação de chances mais estável estatisticamente.
2. **xG como feature de entrada para regressão logística/gradient boosting**: `xG_favor`, `xG_contra` e
   suas variantes entram no vetor `x` junto às demais features de forma, H2H, etc. (§2.4, §2.5),
   permitindo que o modelo aprenda o peso relativo do xG frente a outros sinais.

**Mercados aplicáveis:** 1X2, Over/Under, BTTS, Team Totals — especialmente forte como sinal antecedente
de mudança de forma (equipes "azaradas" por baixo aproveitamento de xG tendem a melhorar resultados nas
rodadas seguintes, e vice-versa).

---

### 2.7 Consenso de Mercado (Mercado Sem Vig)

O consenso de mercado não é um modelo estatístico no sentido tradicional — é a extração da probabilidade
"justa" implícita nas odds de múltiplas casas de apostas, **após remover a margem da casa (overround)**.
Funciona como **modelo de benchmark**: a literatura acadêmica e a experiência prática de mercados
eficientes mostram que odds de fechamento (closing odds), agregadas entre casas líquidas, são um dos
melhores preditores conhecidos de probabilidade real — superar esse benchmark de forma consistente é a
verdadeira prova de valor preditivo de um modelo proprietário.

**Por que remover o overround.** A soma das probabilidades implícitas de todos os resultados de um
mercado (1X2, por exemplo) é sempre maior que 1 — a diferença é a margem da casa:

```
overround = Σ_k (1 / odds_k) − 1
```

Essa margem precisa ser removida antes de tratar as odds como probabilidades "verdadeiras" de mercado.
O BetEdge implementa quatro métodos, cada um com pressupostos distintos sobre **como** a casa distribui
sua margem entre os resultados:

**a) Normalização multiplicativa.** Método mais simples: divide cada probabilidade implícita pela soma
total.

```
p_fair,k = (1 / odds_k) / Σ_j (1 / odds_j)
```

*Pressuposto*: a margem é distribuída proporcionalmente entre todos os resultados. Rápido e robusto, mas
sistematicamente impreciso em mercados com forte favoritismo (subestima levemente a probabilidade do
favorito e superestima o azarão — ver método Shin abaixo).

**b) Normalização aditiva.** Subtrai o excesso de overround igualmente (em pontos percentuais) de cada
resultado, proporcionalmente ao número de resultados:

```
p_fair,k = (1 / odds_k) − (overround / n)
```

com `n` = número de resultados do mercado. Menos usado em produção (pode gerar probabilidades negativas
em mercados com odds muito díspares), mantido para comparação/pesquisa.

**c) Método da potência (power method).** Encontra um expoente `k` tal que as probabilidades implícitas
elevadas a `k` somem exatamente 1:

```
p_fair,i = (1 / odds_i)^k     onde k resolve   Σ_i (1 / odds_i)^k = 1
```

Resolvido numericamente (bisseção/Newton) por não ter forma fechada geral. Captura melhor que a
multiplicativa o padrão empírico de "favorito-azarão" (favorite-longshot bias), no qual a casa tende a
embutir mais margem proporcional nos azarões do que nos favoritos.

**d) Método Shin.** Baseado em Shin (1991, 1993), modela explicitamente a presença de apostadores
informados (*insider trading*) no mercado, estimando um parâmetro `z` (proporção da massa de apostas
atribuível a informação privilegiada) que resolve o sistema:

```
p_fair,i = [ √(z² + 4·(1−z)·π_i²/Σπ) − z ] / (2·(1−z))
```

onde `π_i = 1/odds_i` são as probabilidades implícitas brutas. `z` é estimado numericamente de modo que
`Σ p_fair,i = 1`. O método Shin é geralmente considerado o **mais teoricamente fundamentado** para
mercados com overround alto e viés favorito-azarão pronunciado (é o método de referência em boa parte da
literatura acadêmica de eficiência de mercado esportivo), mas é computacionalmente mais custoso e mais
sensível a odds de baixa qualidade (poucas casas, mercados finos).

**Quando usar cada método.**

| Método | Quando é apropriado |
|---|---|
| Multiplicativo | Mercados líquidos, baixo overround (< 4%), uso como fallback rápido e como baseline de comparação |
| Aditivo | Raramente em produção; referência acadêmica/comparativa |
| Potência | Mercados com overround moderado a alto (4–8%) e favoritismo claro (odds de 1X2 muito assimétricas) |
| Shin | Mercados de elite (1X2, Over/Under de ligas top) onde overround é alto o suficiente para o viés favorito-azarão ser material, e há odds de múltiplas casas de referência para estimar `z` com estabilidade |

Em produção, o BetEdge computa **os quatro métodos em paralelo** por partida/mercado e usa o método Shin
como probabilidade "justa" de mercado padrão para o cálculo de edge (§7), mantendo os demais como
diagnóstico e para o indicador de eficiência de mercado usado no Edge Score (§7.5).

**Este é o "modelo de mercado"** — o piso de comparação obrigatório para qualquer modelo proprietário: um
modelo só é considerado para produção se, em backtesting, bater consistentemente o log loss e a
calibração do consenso de mercado sem vig na mesma amostra (ver §5, §9.3).

---

### 2.8 Ensemble Ponderado

**Combinando saídas de modelos.** Cada modelo individual (§2.1–2.7, exceto o consenso de mercado, que
entra como um "modelo" a mais no ensemble) produz um vetor de probabilidades por mercado. O ensemble
final é uma combinação desses vetores:

```
p_ensemble = Σ_m  w_m · p_m         com   Σ_m w_m = 1,  w_m ≥ 0
```

**Otimização de pesos (minimização de log loss em validação).** Os pesos `w_m` não são fixados
manualmente — são otimizados para minimizar o log loss agregado em um conjunto de validação
estritamente posterior ao treino de cada modelo individual (nunca a mesma partição usada para treinar ou
tunar os modelos base, evitando "vazamento de ensemble"):

```
w* = argmin_w  −(1/T) Σ_t log( Σ_m w_m · p_{m,t,y_t} )     sujeito a  Σ_m w_m = 1,  w_m ≥ 0
```

Resolvido por otimização convexa restrita (a log-verossimilhança de uma mistura logarítmica é côncava
nos pesos sob a restrição de simplex), tipicamente via gradiente projetado ou SLSQP. Os pesos são
reotimizados a cada ciclo de retreino (§9.1), permitindo que o ensemble se adapte se um modelo
específico começar a performar sistematicamente melhor ou pior.

**Stacking vs. média simples vs. média ponderada.**

- **Média simples** (`w_m = 1/M` para todo `m`): baseline robusto, útil quando os modelos têm
  performance historicamente parecida e não há dados suficientes para estimar pesos com confiança
  (ligas com histórico curto).
- **Média ponderada** (pesos otimizados por log loss, acima): o padrão de produção — captura que
  modelos como Dixon-Coles ou gradient boosting tendem a superar Poisson puro ou regressão logística
  simples na maioria das ligas com dados suficientes.
- **Stacking (meta-modelo)**: um modelo de segundo nível (tipicamente regressão logística regularizada,
  para manter interpretabilidade e evitar overfitting em cima do overfitting) recebe as probabilidades
  de cada modelo base **mais features de contexto** (liga, tamanho de amostra disponível, nível de
  discordância entre modelos) como entrada e aprende uma combinação não necessariamente linear/estável.
  Usado seletivamente nas ligas com maior volume histórico, onde há dados suficientes para treinar o
  meta-modelo sem overfitting; para ligas menores, o BetEdge usa a média ponderada mais simples (menos
  parâmetros, mais robusta a pouco dado).

**Ajuste dinâmico de pesos por performance recente.** Além da reotimização periódica em lote (§9.1), o
sistema mantém um **fator de decaimento de confiança** por modelo, baseado no log loss desse modelo nas
últimas N predições resolvidas (rolling window), permitindo que um modelo cujo desempenho recente
degradou (ex.: por mudança de padrão da liga, lesão de jogadores-chave não capturada nas features) tenha
seu peso reduzido entre ciclos completos de retreino, sem esperar o próximo retreino em lote:

```
w_m^{ajustado} ∝ w_m · exp(−κ · logloss_recente_m)
```

renormalizado para somar 1, com `κ` controlando a sensibilidade do ajuste dinâmico (calibrado para
reagir a degradação real sem introduzir instabilidade excessiva de curto prazo).

**Intervalos de confiança a partir da discordância entre modelos.** A dispersão das probabilidades
individuais `p_m` em torno da média do ensemble é usada como proxy de incerteza epistêmica da predição:

```
σ²_ensemble = Σ_m w_m · (p_m − p_ensemble)²
```

Um `σ²_ensemble` baixo indica que os modelos concordam (maior confiança na predição); um valor alto
indica discordância estrutural (ex.: o modelo de mercado diverge fortemente do Dixon-Coles), que é
tratado como sinal de cautela — tanto na comunicação ao usuário quanto como componente do Edge Score
(§7.5, "confiança do modelo").

---

## 3. Feature Engineering

Todas as features usadas por qualquer modelo (exceto Poisson/Dixon-Coles puros, que consomem apenas
histórico de gols) são catalogadas em um **registro central de features** (feature store), com nome,
tipo, janela temporal, fonte de dado e — criticamente — o **momento em que a feature se torna
disponível** relativo ao kickoff (usado para a auditoria de leakage, §4.2).

### 3.1 Features Temporais (forma, sequências, descanso)

| Feature | Descrição |
|---|---|
| `forma_pts_N` | Pontos por jogo nos últimos N jogos (N ∈ {3, 5, 10}), 3/1/0 por vitória/empate/derrota |
| `forma_pts_N_mando` | Idem, restrito a jogos no mesmo mando de campo (casa jogando em casa / fora jogando fora) |
| `sequencia_vitorias` | Número de vitórias consecutivas até o jogo anterior |
| `sequencia_invencibilidade` | Jogos consecutivos sem derrota |
| `sequencia_sem_sofrer_gol` | Jogos consecutivos com clean sheet |
| `dias_descanso` | Dias corridos desde o último jogo oficial da equipe |
| `jogos_ultimos_14_dias` | Contagem de partidas nos últimos 14 dias (proxy de congestionamento de calendário/fadiga) |
| `viagem_km_estimada` | Distância aproximada da última partida (fora) até o estádio da partida atual, quando aplicável |

### 3.2 Features de Força (posição, pontos, saldo)

| Feature | Descrição |
|---|---|
| `posicao_tabela` | Posição corrente na tabela da competição |
| `pontos_por_jogo_temporada` | Aproveitamento médio na temporada corrente |
| `saldo_gols_temporada` | Saldo de gols acumulado na temporada |
| `distancia_pontos_z1` / `_rebaixamento` | Distância em pontos da zona de classificação/rebaixamento (proxy de pressão/motivação) |
| `rating_elo` | Rating Elo corrente (§2.3) |
| `rating_elo_tendencia_10` | Variação do rating Elo nos últimos 10 jogos |

### 3.3 Features de Confronto Direto (H2H)

| Feature | Descrição |
|---|---|
| `h2h_pts_medio_N` | Pontos médios obtidos pela equipe da casa nos últimos N confrontos diretos (com decaimento temporal) |
| `h2h_gols_media_marcados/sofridos` | Média de gols marcados/sofridos nos confrontos diretos recentes |
| `h2h_btts_freq` | Frequência histórica de ambas equipes marcarem nos confrontos diretos |
| `h2h_jogos_disponiveis` | Contagem de confrontos diretos disponíveis na janela — usado para *shrinkage* (poucos confrontos → menos peso na feature, regressão em direção à média da liga) |

### 3.4 Features de Split Casa/Fora

| Feature | Descrição |
|---|---|
| `ataque_casa_janela_N` | Força de ataque da equipe mandante, apenas em jogos em casa |
| `defesa_fora_janela_N` | Força de defesa da equipe visitante, apenas em jogos fora |
| `pct_vitorias_casa` / `pct_vitorias_fora` | Taxa histórica de vitórias por mando, na temporada e nas últimas N temporadas |

### 3.5 Features Baseadas em xG

Ver detalhamento completo em §2.6: `xG_favor_janela_N`, `xG_contra_janela_N`, `xG_por_chute`,
`xG_menos_gols_reais` (finishing over/underperformance), variantes por mando de campo.

### 3.6 Features Derivadas de Mercado

| Feature | Descrição | Disponibilidade |
|---|---|---|
| `odds_fechamento_1x2` | Odds de fechamento (últimas antes do kickoff), agregadas entre casas de referência | Só disponível **após** o fechamento — usada como feature apenas em modelos de re-avaliação pós-fechamento, nunca na predição pré-jogo inicial (ver §4) |
| `movimento_linha` | Variação percentual da odds entre abertura e momento da predição | Disponível continuamente antes do kickoff; usada com cautela e sempre com timestamp de captura |
| `overround_mercado` | Overround agregado — proxy de quão "afiado"/líquido é o mercado para aquela partida | Disponível continuamente |
| `dispersao_entre_casas` | Desvio-padrão das odds entre casas de apostas para o mesmo resultado — proxy de incerteza de mercado | Disponível continuamente |

Features de mercado exigem cuidado redobrado de leakage: a odds de **fechamento** só existe depois que o
mercado fecha, então nunca pode alimentar a predição pré-jogo "oficial" gerada horas/dias antes — apenas
predições de re-avaliação geradas próximas ao kickoff podem legitimamente usá-la (§8.4), e mesmo assim
com o timestamp de captura estritamente anterior ao kickoff real.

### 3.7 Versionamento de Features

Cada feature no registro central tem um `feature_id` estável e um `schema_version`. Mudanças que alteram
o **valor computado** de uma feature existente (ex.: mudar a janela de forma de 5 para 10 jogos, mudar o
método de decaimento temporal do H2H) **sempre** incrementam o `schema_version` e geram uma nova
`features_version` agregada (§1.1) — nunca sobrescrevem silenciosamente o valor histórico de uma feature
já usada em predições passadas. Isso garante que:

- Predições antigas continuam reprodutíveis com a definição de feature vigente na época.
- Comparações de performance entre `features_version` diferentes são possíveis e usadas no processo de
  seleção de modelo (§9.3).
- Adição de uma feature nova não quebra modelos treinados com o schema anterior (features ausentes em
  versões antigas são tratadas como ausentes, nunca como zero implícito).

---

## 4. Prevenção de Data Leakage

Data leakage — o vazamento de informação futura (relativa ao momento da predição) para dentro do
processo de treino ou de cálculo de features — é o risco metodológico mais grave em modelagem preditiva
esportiva, porque **infla artificialmente as métricas de backtesting sem que o modelo tenha qualquer
poder preditivo real em produção**. O BetEdge trata isso como requisito de primeira classe, não como
detalhe de implementação.

### 4.1 Particionamento Temporal Estrito

Toda partição de dados (treino/validação/teste, dobras de validação cruzada, conjunto de tuning de
hiperparâmetros) respeita uma regra única e não-negociável:

```
para toda partição P_treino e P_avaliação:
    max(match_datetime em P_treino) < min(match_datetime em P_avaliação)
```

Nenhum embaralhamento aleatório de partidas entre treino e avaliação é permitido em nenhuma etapa do
pipeline — nem no fit dos modelos base, nem no tuning de hiperparâmetros, nem na otimização de pesos do
ensemble (§2.8), nem na validação de calibração (§6.3).

### 4.2 Linha do Tempo de Disponibilidade das Features

Cada feature no registro central (§3.7) carrega um atributo `disponivel_em`, definindo exatamente quando
aquele dado existe no mundo real, relativo ao kickoff:

| Categoria de feature | Disponível a partir de |
|---|---|
| Forma, H2H, splits casa/fora, posição na tabela, Elo | Imediatamente após o jogo anterior relevante ser encerrado — tipicamente dias/semanas antes do kickoff |
| xG histórico (jogos passados) | Após o processamento do provedor de dados do jogo em questão (tipicamente algumas horas após o apito final daquele jogo passado) |
| Escalação confirmada (lineup) | ~45–75 min antes do kickoff da partida-alvo |
| Odds de abertura | No momento em que a casa de apostas abre o mercado (dias antes, varia por casa) |
| Odds de fechamento | **No kickoff**, por definição — nunca disponível antes |
| Resultado da partida, xG da partida-alvo, estatísticas pós-jogo | Após o apito final — **nunca** utilizáveis como feature da própria partida |

O pipeline de geração de features consulta essa tabela em tempo de computação: para uma predição gerada
no instante `t_pred` referente a uma partida com kickoff `t_kickoff`, **nenhuma** feature cujo
`disponivel_em` seja posterior a `t_pred` é incluída no vetor — o valor é tratado como ausente (e
tratado por imputação/modelo tolerante a ausência, nunca preenchido com o valor real "do futuro").

### 4.3 Gestão do Corte de Dados de Treino (`training_data_cutoff`)

Todo processo de treino declara explicitamente um `training_data_cutoff` (§1.1) antes de qualquer
consulta ao banco de dados de partidas. A consulta de construção do dataset de treino é parametrizada
por esse cutoff e auditada — testes automatizados (§4.5) verificam que nenhuma linha do dataset de treino
resultante tem `match_datetime ≥ training_data_cutoff`. O cutoff nunca é "hoje" implícito — é sempre um
valor explícito persistido, para que o processo seja reprodutível mesmo se executado novamente meses
depois.

### 4.4 Armadilhas Comuns de Leakage em Dados de Futebol

Lista de padrões de vazamento especificamente conhecidos no domínio, ativamente verificados em revisão
de código e em testes automatizados:

1. **Estatísticas de temporada "até a data" calculadas incorretamente**: agregar `posicao_tabela` ou
   `pontos_por_jogo_temporada` usando **todos** os jogos da temporada em vez de apenas os jogos
   anteriores à partida em questão. Erro clássico ao usar tabelas de classificação já consolidadas de
   fontes externas sem filtrar por data.
2. **Normalização/scaling ajustado no dataset completo**: normalizar features (ex.: z-score) usando
   média/desvio-padrão calculados sobre treino+validação+teste juntos, em vez de ajustar o scaler
   apenas no treino e aplicá-lo (transform-only) nas demais partições.
3. **Rating Elo recalculado retroativamente com todo o histórico**: se o rating de uma equipe em uma
   data `t` for recomputado usando uma rodada de fit que "vê" resultados posteriores a `t` (ex.:
   suavização bidirecional ou reotimização de parâmetros globais como `K` usando o histórico completo),
   o rating em `t` deixa de refletir apenas informação disponível em `t`. O BetEdge recomputa o rating
   Elo de forma estritamente sequencial e forward-only.
4. **Confronto direto (H2H) incluindo o próprio jogo-alvo**: erro de índice comum ao construir a janela
   de H2H — garantir exclusão explícita do `match_id` da partida sendo predita.
4. **Vazamento por entidade correlacionada (mesmo técnico, mesmo elenco em outra competição)**: dados de
   uma equipe B fortemente correlacionada (ex.: equipe B em outra divisão com o mesmo elenco de base,
   comum em ligas de reservas) podem carregar informação indireta se não tratados com o mesmo rigor
   temporal.
5. **Odds "atuais" usadas como se fossem "de abertura"**: para partidas históricas, é fácil obter
   acidentalmente a odds mais recente disponível na API do provedor (que pode já refletir movimento
   pós-informação) em vez da odds efetivamente vigente no timestamp de referência do backtest.
6. **Escalação usada em predição "pré-jogo padrão"**: a predição pré-jogo principal (gerada
   tipicamente D-1 ou mais cedo) não pode usar escalação confirmada — isso só é legítimo na re-predição
   de proximidade ao kickoff (§8.4), rotulada e versionada separadamente.
7. **Reindexação de temporada cruzando o corte**: ao construir janelas de "forma dos últimos N jogos"
   próximas ao início de uma temporada, incluir acidentalmente jogos de pré-temporada/amistosos não
   comparáveis, ou vice-versa, ignorar jogos da temporada anterior de forma inconsistente entre features.

### 4.5 Protocolo de Validação para Detectar Leakage

Antes de qualquer modelo novo ir a produção, passa por uma bateria de testes de detecção de leakage:

1. **Teste de performance implausível**: log loss ou Brier score no conjunto de teste
   *significativamente* melhor do que o benchmark de mercado sem vig (§2.7) é tratado como bandeira
   vermelha, não como vitória — investigado antes de aceito (mercados eficientes tornam superação
   consistente e grande do consenso de mercado estatisticamente improvável; ver §10).
2. **Teste de embaralhamento temporal (shuffle test)**: reordenar aleatoriamente o timestamp de
   avaliação das features (mantendo o resultado real) e verificar que a performance do modelo **cai**
   — se a performance se mantém igual mesmo com timestamps embaralhados, é sinal de que alguma feature
   não é de fato sensível ao tempo (possível vazamento de agregado global).
3. **Auditoria de `disponivel_em` automatizada**: pipeline de CI que varre o registro de features e
   falha o build se qualquer feature usada em um modelo de produção não tiver seu `disponivel_em`
   documentado e verificado contra a data de kickoff em uma amostra de partidas de teste.
4. **Teste de importância suspeita**: features com importância desproporcionalmente alta (via SHAP,
   §2.5) que não têm justificativa causal/futebolística plausível são investigadas manualmente antes de
   aceitas — importância anômala é um dos sinais mais confiáveis de leakage sutil.
5. **Replay histórico ponta-a-ponta**: para uma amostra de partidas passadas, o pipeline completo é
   executado "como se fosse" a data da partida (`training_data_cutoff` = D-1 daquela partida específica)
   e a predição resultante é comparada à predição realmente persistida na época — divergências
   inexplicadas indicam inconsistência entre o pipeline de backtest e o pipeline de produção.

---

## 5. Validação e Backtesting

### 5.1 Walk-Forward Validation (Validação com Janela Expansiva)

O protocolo primário de avaliação de qualquer modelo antes de ir a produção é *walk-forward validation*
com janela de treino expansiva:

```
Iteração 1: treino = [t0, t1)         →  avaliação = [t1, t1+step)
Iteração 2: treino = [t0, t1+step)    →  avaliação = [t1+step, t1+2·step)
Iteração 3: treino = [t0, t1+2·step)  →  avaliação = [t1+2·step, t1+3·step)
...
```

A cada iteração, o modelo é **retreinado do zero** (ou incrementalmente, no caso do Elo — §9.1) apenas
com dados anteriores ao início da janela de avaliação daquela iteração, e avaliado exclusivamente no
período seguinte, nunca antes visto.

**Tamanho mínimo da janela de treino.** Definido por liga, proporcional à necessidade de dados para
estimar parâmetros de ataque/defesa (Poisson/Dixon-Coles) ou treinar modelos de árvore com
generalização razoável. Piso operacional: mínimo de **uma temporada completa** (ou equivalente em número
de partidas, para ligas com calendário irregular/copas) antes da primeira janela de avaliação — janelas
de treino menores que isso produzem estimativas de ataque/defesa por equipe com variância excessiva.

**Tamanho do passo (step size).** Retreino semanal para os modelos estatísticos leves (Poisson,
Dixon-Coles, Elo — computacionalmente baratos, se beneficiam de estar sempre atualizados com a rodada
mais recente) e retreino mensal completo para os modelos de gradient boosting/regressão logística
(computacionalmente mais caros e menos sensíveis a uma única rodada adicional de dados) — ver detalhamento
completo do cronograma em §9.1.

**Período de avaliação fora da amostra.** O período de avaliação de cada iteração nunca se sobrepõe ao
próximo período de treino de forma antecipada — cada partida é avaliada exatamente uma vez, na iteração
em que estava estritamente no futuro relativo ao treino daquela iteração. O backtest de aceitação de um
modelo novo cobre tipicamente **as últimas 2–3 temporadas** por liga, agregando o log loss/Brier de todas
as iterações walk-forward.

**Detalhes de implementação.** O motor de backtest é o **mesmo código de inferência de produção**
(nunca uma reimplementação paralela) — o backtest chama a mesma função `predict(match_id,
training_data_cutoff)` que a produção chamaria, garantindo que qualquer resultado de backtest seja
genuinamente reproduzível em produção e eliminando uma classe inteira de bugs de "backtest otimista"
(código de avaliação sutilmente diferente do código de produção).

### 5.2 Validação Cruzada Temporal

**Adaptação do TimeSeriesSplit para dados esportivos.** O `TimeSeriesSplit` padrão (usado por exemplo em
scikit-learn) assume observações uniformemente espaçadas — inadequado para futebol, onde a densidade de
jogos varia fortemente ao longo do ano (pausas de inverno em ligas europeias, janelas de seleções,
período de férias). O BetEdge adapta o conceito para dobras delimitadas por **datas de calendário**
(não por índice de linha), garantindo que cada dobra de validação cubra um intervalo de tempo real
consistente (ex.: um mês corrido), independentemente de quantas partidas caem nesse intervalo.

**Fronteiras de temporada.** Dobras de validação cruzada respeitam fronteiras de temporada como
pontos de corte preferenciais quando possível — avaliar um modelo justamente na transição de temporada
(quando elencos mudam substancialmente por transferências) é o cenário mais informativo sobre robustez
do modelo a mudança estrutural, então essas dobras recebem peso extra na decisão final de aceitação de
modelo, mesmo sendo tipicamente as de pior performance (esperado e aceitável).

**Considerações específicas por liga.** Ligas com calendário fechado e regular (a maioria das ligas
europeias de pontos corridos) seguem o protocolo padrão acima. Competições de mata-mata, copas
continentais e ligas com formato irregular (grupos + eliminatórias, temporada partida no calendário
civil como em ligas sul-americanas) recebem tratamento de dobra customizado — por exemplo, tratando cada
fase de grupos e cada fase eliminatória como estratos separados de avaliação, já que a dinâmica
competitiva (motivação, rotação de elenco) difere sistematicamente entre fases.

---

## 6. Métricas de Performance

### 6.1 Brier Score

Erro quadrático médio entre a probabilidade prevista e o resultado binário observado:

```
BS = (1/T) Σ_{t=1}^{T} Σ_{k} (p_{t,k} − o_{t,k})²
```

onde `o_{t,k} ∈ {0, 1}` indica se o resultado `k` ocorreu na partida `t` (soma sobre todos os resultados
possíveis do mercado — para 1X2, `k ∈ {casa, empate, fora}`). Varia de 0 (predição perfeita) a 2 (para
mercados de 3 categorias; o pior caso teórico depende do número de categorias). **Quanto menor, melhor.**

**Decomposição (Murphy, 1973).** O Brier Score se decompõe em três componentes interpretáveis:

```
BS = Confiabilidade − Resolução + Incerteza
```

- **Confiabilidade** (menor é melhor): mede o quão distante, em média, a frequência observada está da
  probabilidade prevista, dentro de cada faixa de probabilidade prevista (bins) — essencialmente a base
  matemática por trás da curva de calibração (§6.3).
- **Resolução** (maior é melhor): mede o quanto as previsões do modelo variam entre diferentes
  condições/partidas em relação à taxa base geral — um modelo que sempre prevê a taxa base (ex.: sempre
  33/33/33 em 1X2) tem resolução zero, mesmo perfeitamente "calibrado" na média.
- **Incerteza**: variância inerente ao próprio fenômeno (taxa base de ocorrência de cada resultado na
  amostra) — não depende do modelo, é uma propriedade da distribuição de resultados observada.

Um bom modelo minimiza confiabilidade **e** maximiza resolução — não basta estar "calibrado na média"
prevendo sempre a taxa base; é preciso discriminar entre partidas diferentes mantendo a calibração.

**Comparação com baseline de mercado.** Todo relatório de Brier Score de um modelo é acompanhado do
Brier Score do consenso de mercado sem vig (§2.7) na mesma amostra exata, expresso como *Brier Skill
Score*:

```
BSS = 1 − (BS_modelo / BS_mercado)
```

`BSS > 0` indica superação do mercado; `BSS ≤ 0` indica que o modelo não adiciona valor sobre o
benchmark — critério direto de aceitação/rejeição de modelo em produção (§9.3).

**Brier Score por mercado.** Reportado separadamente para 1X2, Over/Under (por linha), BTTS, Asian
Handicap (por linha) e Team Totals — a performance de um modelo tipicamente **não** é uniforme entre
mercados (ex.: Dixon-Coles tende a se sair relativamente melhor em BTTS/Under do que em Asian Handicap de
linhas altas), e decisões de qual modelo alimenta qual mercado no ensemble (pesos por mercado, não um
único peso global) dependem dessa quebra.

### 6.2 Log Loss (Entropia Cruzada)

```
LogLoss = −(1/T) Σ_{t=1}^{T} Σ_{k} o_{t,k} · log(p_{t,k})
```

equivalente ao negativo da log-verossimilhança média sob o modelo. **Quanto menor, melhor**; mínimo
teórico 0 (predição perfeita e correta com probabilidade 1).

**Sensibilidade a erros confiantes.** A penalidade do log loss cresce **sem limite** conforme a
probabilidade atribuída ao resultado real se aproxima de zero (`log(p) → −∞` quando `p → 0`) — um modelo
que atribui 2% de probabilidade a um resultado que efetivamente ocorre é punido muito mais severamente
do que a diferença linear (98% de erro vs. um erro de, digamos, 60%) sugeriria. Essa propriedade é
exatamente o que torna o log loss adequado como métrica primária para um produto de apostas: **um modelo
"overconfident" que erra é o pior cenário possível** para um usuário decidindo stake com base na
probabilidade informada, e o log loss captura esse risco de forma proporcionalmente correta, ao contrário
do Brier Score (que penaliza de forma quadrática, mais branda).

**Por que é a métrica de otimização primária.** Além da propriedade acima, log loss é a função objetivo
natural de treino para todos os modelos discriminativos do portfólio (regressão logística, gradient
boosting com perda softmax/logística) — otimizar diretamente a métrica de avaliação final evita
descasamento entre o que o modelo aprende a minimizar e o que o sistema usa para julgá-lo. É também
*proper scoring rule* estritamente própria (assim como o Brier Score): a estratégia ótima para minimizar
o log loss esperado é reportar a probabilidade verdadeira, nunca uma probabilidade distorcida
estrategicamente — propriedade essencial para confiar que os modelos não têm incentivo estatístico a
"exagerar" confiança para parecer melhores em outras métricas.

### 6.3 Erro de Calibração (ECE / MCE)

**Expected Calibration Error (ECE).** Mede a diferença média, ponderada pelo tamanho de cada faixa de
probabilidade, entre a probabilidade prevista e a frequência real observada:

```
ECE = Σ_{b=1}^{B}  (n_b / T) · | acc(b) − conf(b) |
```

onde as predições são agrupadas em `B` faixas (*bins*, tipicamente B = 10, larguras de 10 pontos
percentuais cada), `n_b` é o número de predições na faixa `b`, `conf(b)` é a probabilidade média prevista
na faixa `b`, e `acc(b)` é a frequência real observada de acerto na faixa `b`.

**Estratégia de binning.** O BetEdge usa duas estratégias em paralelo:

- **Largura fixa** (*equal-width*): faixas de 10 pontos percentuais fixos (`[0,10%), [10,20%), ...`) —
  mais intuitiva para leitura de diagrama de confiabilidade, mas sensível a faixas com poucas amostras
  quando a distribuição de probabilidades previstas é concentrada.
- **Frequência igual** (*equal-frequency*/quantis): faixas ajustadas para conter aproximadamente o mesmo
  número de predições cada — estatisticamente mais robusta quando a maioria das predições se concentra
  em uma faixa estreita (comum em mercados com favoritos claros), evitando bins quase vazios que
  produziriam `acc(b)` instável (alta variância na estimativa).

Ambas são reportadas; a versão de frequência igual é a usada para decisões de aceitação de modelo
(menos sensível a artefato de binning), a de largura fixa para visualização (diagrama de confiabilidade).

**Diagrama de confiabilidade (curva de calibração).** Gráfico com `conf(b)` no eixo X e `acc(b)` no eixo
Y para cada bin — um modelo perfeitamente calibrado produz pontos exatamente sobre a diagonal
`y = x`. Pontos sistematicamente abaixo da diagonal em probabilidades altas indicam **overconfidence**
(o modelo diz 70% mas o evento ocorre menos que isso); pontos acima indicam **underconfidence**. O
tamanho de cada ponto no diagrama é proporcional a `n_b`, e cada ponto carrega intervalo de confiança
binomial (Wilson) para comunicar a incerteza estatística de bins com poucas amostras.

**Maximum Calibration Error (MCE).**

```
MCE = max_b | acc(b) − conf(b) |
```

Captura o **pior caso** entre as faixas, em vez da média ponderada do ECE — relevante porque um modelo
pode ter ECE baixo globalmente mas estar seriamente descalibrado justamente na faixa de probabilidade
mais relevante para decisão de aposta (tipicamente as faixas de maior confiança, 65–85%, onde a maioria
dos "value bets" recomendados se concentra). O BetEdge monitora MCE por faixa de forma independente do
ECE agregado, com alerta automático se MCE de qualquer faixa ultrapassar um limiar operacional.

### 6.4 Closing Line Value (CLV)

**Definição.** CLV mede se a probabilidade (ou odds implícita) do modelo, no momento em que a
oportunidade foi identificada, era **mais precisa** do que a odds de fechamento do mercado — a odds
vigente imediatamente antes do kickoff, amplamente reconhecida na literatura e na prática profissional
de apostas como o melhor estimador disponível de probabilidade real (mercados líquidos incorporam toda
informação pública e boa parte da informação privada disponível até aquele ponto).

**Metodologia de cálculo.** Para uma aposta/oportunidade identificada na odds `odds_entrada`, com odds
de fechamento subsequente `odds_fechamento` no mesmo resultado:

```
CLV (%) = (odds_entrada / odds_fechamento − 1) × 100
```

`CLV > 0` significa que a odds obtida na entrada era **melhor** (mais alta) do que a odds de fechamento —
ou seja, o mercado se moveu na direção que confirma a avaliação do modelo entre o momento da entrada e o
fechamento. Equivalentemente, em termos de probabilidade implícita sem vig (§7.2) de ambos os momentos:

```
CLV_prob (p.p.) = p_fair,fechamento − p_fair,entrada
```

(probabilidade implícita justa no fechamento maior do que na entrada, para o resultado apostado, indica
o mesmo fenômeno em termos de probabilidade em vez de odds decimais).

**Por que CLV é o padrão-ouro de avaliação de modelo de apostas.** Diferente de hit rate ou mesmo ROI
retrospectivo (§6.6), que são fortemente dominados por variância de curto prazo (resultados de partidas
individuais são eventos de alta aleatoriedade), CLV é observável **imediatamente** (não é preciso esperar
o resultado da partida) e mede diretamente se o modelo identificou informação/ineficiência que o mercado
subsequentemente incorporou. Uma série longa de CLV positivo consistente é a evidência mais forte
disponível de que um modelo tem poder preditivo genuíno e não é apenas "sorte" de variância de resultado
— é a métrica usada academicamente e profissionalmente como proxy mais confiável de habilidade preditiva
real, precisamente porque neutraliza a variância de resultado de partida individual.

**Acompanhamento de CLV ao longo do tempo.** Toda oportunidade sinalizada pelo Value Engine (§7) tem seu
CLV calculado automaticamente assim que a odds de fechamento correspondente é capturada (job assíncrono
disparado no kickoff de cada partida). CLV médio e sua distribuição são reportados:

- Agregado por modelo (qual modelo do ensemble gera as recomendações com melhor CLV médio).
- Agregado por mercado (1X2 vs. Over/Under vs. Asian Handicap etc.).
- Agregado por faixa de Edge Score (§7.5) — validação direta de que scores mais altos correlacionam com
  CLV mais positivo, essencial para confiar no próprio Edge Score como produto.
- Em série temporal (rolling 30/90 dias) — para detectar degradação de performance do modelo antes que
  ela se reflita em métricas de resultado de mais longo prazo (que exigem amostras maiores para
  significância estatística, §6.7).

### 6.5 Hit Rate

```
HitRate = (Predições corretas) / (Total de predições avaliadas)
```

onde "correta" tipicamente significa que o resultado de maior probabilidade prevista pelo modelo
coincidiu com o resultado real (para 1X2) ou que o lado indicado como "valor" cobriu (para
handicap/over-under).

**Por que é insuficiente isoladamente.** Hit rate ignora completamente a **magnitude** da probabilidade
atribuída — um modelo que prevê 90% para o favorito de um confronto historicamente desequilibrado (e
acerta na maioria das vezes, como esperado, simplesmente por refletir a taxa base) tem hit rate alto sem
qualquer sofisticação preditiva. Hit rate também não distingue entre um erro "por pouco" (34% vs. 33%
vs. 33%, resultado saiu no segundo colocado) e um erro grosseiro (80% de confiança no resultado errado).
Um modelo pode ter hit rate idêntico a outro e ser **estritamente pior** em calibração e log loss — hit
rate nunca é usado isoladamente como critério de seleção de modelo (§1.4).

**Quebra por faixa de confiança.** Para ser minimamente útil, hit rate é sempre reportado segmentado por
faixa de probabilidade prevista (as mesmas faixas do ECE, §6.3):

| Faixa de probabilidade prevista | Hit rate esperado (se calibrado) |
|---|---|
| 30–40% | ~30–40% |
| 50–60% | ~50–60% |
| 70–80% | ~70–80% |
| 80%+ | ~80%+ |

Essa quebra, cruzada com o diagrama de confiabilidade (§6.3), é o formato correto de comunicar hit rate:
não como número único, mas como evidência (ou contra-evidência) de calibração por faixa.

### 6.6 ROI Retrospectivo

**Simulação de retorno sobre investimento.** Para cada oportunidade sinalizada historicamente pelo Value
Engine (§7), simula-se o resultado de tê-la apostado, sob diferentes esquemas de stake:

**Stake fixo (flat staking).** Cada aposta recebe o mesmo valor nominal (ex.: 1 unidade):

```
ROI_flat = ( Σ_apostas retorno_aposta − Σ_apostas stake_aposta ) / Σ_apostas stake_aposta
```

com `retorno_aposta = stake × odds` se a aposta ganhou, `0` se perdeu.

**Critério de Kelly.** Dimensiona o stake como fração da banca proporcional ao edge percebido,
maximizando o crescimento logarítmico esperado da banca no longo prazo:

```
f* = (b·p − q) / b = p − (1 − p)/b = (p·(b+1) − 1) / b
```

onde `b = odds_decimal − 1` (odds líquida), `p` é a probabilidade estimada pelo modelo, e `q = 1 − p`.
Na prática, o BetEdge simula e reporta variantes de **Kelly fracionário** (`f = κ · f*`, tipicamente
`κ ∈ {0.25, 0.5}`), já que o Kelly pleno é extremamente sensível a erro de estimação de `p` — um pequeno
viés otimista em `p` leva o Kelly pleno a apostas superdimensionadas e drawdowns severos; Kelly
fracionário é o padrão prático recomendado na literatura e o único exibido como "sugestão de stake" na
interface do produto (nunca Kelly pleno).

**Análise de drawdown.** Toda simulação de ROI é acompanhada de:

- **Máximo drawdown** — maior queda percentual da banca simulada do pico ao vale subsequente, medida
  crítica de risco que o ROI médio isoladamente não comunica.
- **Duração do drawdown** — quantas apostas/dias até a banca simulada recuperar o pico anterior.
- **Curva de equity** — evolução acumulada da banca simulada ao longo do tempo, sempre plotada junto ao
  ROI, nunca reportada como número único isolado (um ROI positivo alto pode mascarar um caminho de altíssima
  variância com drawdown severo no meio do período).

**Cálculo de yield.** Métrica padrão da indústria de apostas, equivalente ao ROI expresso especificamente
em relação ao volume total apostado (idêntico ao ROI de flat staking quando o stake é constante, mas
reportado separadamente por convenção de mercado e para comparabilidade direta com benchmarks externos):

```
Yield (%) = (Lucro líquido / Volume total apostado) × 100
```

**Avisos obrigatórios de interpretação.** Toda simulação de ROI/yield exibida no produto vem acompanhada
de: (a) o intervalo de confiança da estimativa (§6.7), (b) o aviso de que resultados passados não
garantem resultados futuros (§10), e (c) a informação de que odds simuladas retrospectivamente podem não
refletir liquidez/limites reais disponíveis no momento histórico da oportunidade (viés otimista de
simulação — a odds capturada pode não ter sido praticável no volume assumido).

### 6.7 Tamanho de Amostra e Significância Estatística

**Tamanhos mínimos de amostra.** Dada a variância inerente a resultados de futebol (mesmo um modelo
genuinamente melhor que o mercado só supera o acaso de forma estatisticamente detectável após um volume
substancial de observações), o BetEdge define pisos mínimos de amostra antes de qualquer métrica de
performance (ROI, hit rate, CLV agregado) ser exibida como "confiável" na interface:

| Métrica | Amostra mínima recomendada | Justificativa |
|---|---|---|
| Log loss / Brier Score | ≥ 200 partidas | Estimativa razoavelmente estável de erro médio por partida |
| CLV médio | ≥ 100 oportunidades | CLV tem variância menor que resultado de aposta, converge mais rápido |
| ROI / Yield | ≥ 500 apostas simuladas | Alta variância de resultado binário por aposta exige amostra grande para intervalo de confiança útil |
| Hit rate por faixa de confiança | ≥ 30 predições por faixa | Abaixo disso, intervalo de confiança binomial é largo demais para informar decisão |

Abaixo desses pisos, a interface sinaliza explicitamente "amostra insuficiente" em vez de reportar um
número pontual sem contexto — evitando a percepção enganosa de precisão em métricas estatisticamente
instáveis.

**Intervalos de confiança.** Toda métrica agregada reportada (hit rate, ROI, CLV médio, Brier Score) vem
acompanhada de intervalo de confiança (95%, salvo indicação contrária):

- Proporções (hit rate): intervalo de Wilson (mais robusto que a aproximação normal simples em amostras
  pequenas ou proporções próximas de 0/1).
- Médias contínuas (CLV médio, ROI): intervalo baseado em erro padrão da média com correção de
  autocorrelação quando aplicável (apostas na mesma rodada/liga não são estritamente independentes —
  usa-se erro padrão robusto a cluster, agrupado por rodada, quando o volume permite estimá-lo).

**Quando confiar/desconfiar da performance de um modelo.** Regras operacionais:

1. Performance em amostra abaixo do piso mínimo (tabela acima) nunca é usada isoladamente para decisão
   de promoção/rebaixamento de modelo no ensemble (§9.3) — apenas para monitoramento informal.
2. Um resultado de backtest "bom demais" (superação grande e consistente do benchmark de mercado — ver
   §4.5, item 1) é tratado com **mais** suspeita, não menos, dado quão eficientes tendem a ser os
   mercados de futebol de ligas top — a probabilidade a priori de um modelo genuinamente superar o
   mercado por margem grande é baixa, então tal resultado exige investigação de leakage antes de
   aceito.
3. Comparações entre modelos usam sempre a **mesma amostra exata** (mesmas partidas, mesmo período) —
   nunca comparar Brier Score de um modelo em um período com o de outro modelo em período diferente,
   mesmo que ambos "pareçam" grandes o suficiente isoladamente.

---

## 7. Value Engine (cálculos detalhados)

O Value Engine é o componente que transforma probabilidades de modelo e odds de mercado em
recomendações de oportunidade ("value bets"), com um score de priorização (Edge Score). Ele opera
**depois** da geração de probabilidades pelo ensemble (§2.8) — é estritamente um módulo de comparação
modelo-vs-mercado e cálculo de valor esperado, não um modelo preditivo em si.

### 7.1 Probabilidade Implícita

Para uma odd decimal `d`:

```
implied_probability = 1 / d
```

Base de todo o restante do Value Engine. Notar que a soma das probabilidades implícitas de todos os
resultados de um mercado excede 1 (overround) — daí a necessidade da remoção descrita a seguir.

### 7.2 Remoção do Overround

```
overround = Σ_k (1 / odds_k) − 1
```

Os métodos de remoção — multiplicativo, aditivo, potência e Shin — estão detalhados em §2.7. A saída
dessa etapa é a **probabilidade de mercado justa** (`p_fair_mercado`) usada como referência de comparação
para o cálculo de edge (§7.3). O BetEdge usa o método Shin como padrão de produção para o Value Engine,
com fallback para o método da potência quando não há odds de casas suficientes para estimar `z` com
estabilidade (mínimo de 3 casas de referência simultâneas).

### 7.3 Edge

```
edge = p_modelo − p_fair_mercado
```

`edge > 0` indica que o modelo atribui probabilidade **maior** ao resultado do que o mercado, após
remoção de margem — a condição necessária (mas não suficiente isoladamente, ver Edge Score, §7.5) para
uma oportunidade de valor. `edge` é expresso tanto em pontos percentuais absolutos quanto, quando útil
para comparação entre mercados de probabilidade base muito diferente, em termos relativos
(`edge_relativo = edge / p_fair_mercado`).

### 7.4 Valor Esperado (Expected Value)

Usando a odds efetivamente disponível para apostar (`odds_disponivel`, tipicamente a melhor odds entre
casas monitoradas para aquele resultado) e a probabilidade do **modelo** (não a de mercado — o EV mede o
retorno esperado *segundo a crença do modelo*):

```
expected_value = (p_modelo × odds_disponivel) − 1
```

Expresso como fração do stake (`EV = 0.05` significa +5% de retorno esperado por unidade apostada,
segundo o modelo). `EV > 0` é a condição formal de "aposta de valor positivo" segundo a crença do modelo
— mas, criticamente, um `EV` positivo só é confiável na medida em que `p_modelo` é uma estimativa
confiável (calibrada) da probabilidade real, o que é exatamente o motivo de todo o aparato de calibração
e validação das seções 5–6 existir antes de qualquer número aqui ser exibido ao usuário como
recomendação.

### 7.5 Edge Score (0–100)

O Edge Score é a métrica proprietária de priorização de oportunidades do BetEdge — um único número em
escala 0–100 que combina edge bruto com um conjunto de fatores de qualidade/confiança, para que
oportunidades sejam ordenadas não apenas pela magnitude do edge, mas pela **confiabilidade** desse edge.
Um edge grande gerado por um modelo pouco calibrado, em um mercado ilíquido, com amostra histórica
pequena, é sistematicamente menos confiável que um edge menor, porém corroborado por múltiplos modelos
concordantes, em mercado líquido, com histórico robusto.

**Componentes do score.** Sete fatores, cada um normalizado para `[0, 1]` antes da combinação:

| Símbolo | Fator | Descrição | Direção |
|---|---|---|---|
| `E` | Magnitude do edge | `edge` (§7.3) normalizado por uma função de compressão (ver abaixo) | Maior edge → maior score |
| `C` | Confiança do modelo | Inverso da discordância entre modelos do ensemble (`1 − σ²_ensemble` normalizado — ver §2.8) | Modelos mais concordantes → maior score |
| `M` | Eficiência de mercado | Indicador inverso de quão "afiado" é o mercado para aquele evento (baseado em overround, número de casas cotando, dispersão entre casas — §3.6) | Mercado menos eficiente/mais disperso → maior score (mais espaço para edge genuíno) |
| `N` | Tamanho de amostra histórica | Volume de dados históricos relevantes disponíveis para a liga/confronto (partidas na liga, confrontos H2H, cobertura de xG) | Mais dados → maior score |
| `K` | Qualidade de calibração | ECE recente do modelo/mercado específico que gerou a predição (§6.3), na liga em questão | Melhor calibração recente → maior score |
| `L` | Movimento de linha | Direção do movimento de odds desde a abertura até o momento da avaliação, relativo à direção do edge do modelo | Movimento **confirmando** a direção do modelo → maior score; movimento **contrário** → penaliza |
| `B` | Cobertura de casas | Número de casas de apostas oferecendo odds compatíveis (dentro de uma banda de tolerância) com a odds usada no cálculo | Mais casas concordando na odds → maior score (reduz risco de odds-erro/preço isolado desatualizado) |

**Fórmula de combinação.**

```
EdgeScore = 100 × [ w_E·f(E) + w_C·C + w_M·M + w_N·N + w_K·K + w_L·L + w_B·B ]
```

sujeito a `Σ w_i = 1`, `w_i ≥ 0`. Os pesos `w_i` são calibrados (não arbitrários) por regressão do
próprio CLV realizado (§6.4) contra os sete componentes, sobre o histórico de oportunidades sinalizadas:

```
w* = argmin_w  Σ_oportunidades ( CLV_realizado − Σ_i w_i · componente_i )²    sujeito a  Σw_i = 1, w_i ≥ 0
```

ou seja, o Edge Score é literalmente treinado para **prever CLV realizado** a partir de seus componentes
— a escolha de pesos não é uma opinião de produto, é uma regressão validada sobre o histórico observado,
reotimizada no mesmo ciclo de retreino do ensemble (§9.1). Isso fecha o círculo metodológico: a métrica
de priorização de oportunidades (Edge Score) é otimizada contra a métrica reconhecida como padrão-ouro de
avaliação de habilidade preditiva (CLV), não contra hit rate ou ROI de curto prazo.

**Função de compressão do edge bruto, `f(E)`.** Edge bruto não é usado linearmente — magnitudes de edge
muito grandes (> 15–20 p.p.) são estatisticamente mais prováveis de refletir erro de modelo/dado do que
oportunidade genuína (mercados de futebol de ligas cobertas raramente apresentam ineficiências dessa
magnitude — ver §4.5, item 1, e §10), então `f` aplica compressão logística:

```
f(E) = 1 / (1 + exp(−a·(E − E0)))
```

com `E0` (ponto de inflexão) calibrado próximo à magnitude de edge histórico tipicamente confirmada por
CLV positivo (tipicamente na faixa de 3–6 p.p.), e `a` controlando a suavidade — de forma que edges muito
acima do range historicamente confiável não continuem elevando o score proporcionalmente (achatamento
que funciona como salvaguarda contra excesso de confiança em outliers de edge, que são desproporcionalmente
mais associados a erro de dado/modelo do que a valor real).

**Uso do score.** `EdgeScore ≥ 70` é o piso operacional padrão para uma oportunidade aparecer na seção de
destaque do produto ("Top Oportunidades"); scores entre 40–70 aparecem na listagem completa com o
detalhamento dos sete componentes visível (permitindo ao usuário entender **por que** o score é o que é,
alinhado ao princípio de auditabilidade, §1.3); scores abaixo de 40 não são destacados como recomendação
ativa, apenas informativos.

---

## 8. Pipeline de Predição

### 8.1 Fluxo Passo a Passo

```
┌──────────────────┐   ┌────────────────────┐   ┌───────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│  1. Dados brutos  │──▶│ 2. Computação de   │──▶│ 3. Inferência dos  │──▶│ 4. Ensemble       │──▶│ 5. Value Engine +    │
│  (jogos, odds,    │   │    features        │   │    modelos base    │   │    (combinação    │   │    detecção de       │
│  xG, escalações)  │   │  (respeitando       │   │  (Poisson, DC,     │   │    ponderada +    │   │    oportunidade      │
│                    │   │   disponivel_em)    │   │   Elo, LogReg,     │   │    intervalo de   │   │  (edge, EV,          │
│                    │   │                     │   │   GBM, xG-model,   │   │    confiança)     │   │   Edge Score)        │
│                    │   │                     │   │   mercado sem vig) │   │                    │   │                      │
└──────────────────┘   └────────────────────┘   └───────────────────┘   └──────────────────┘   └─────────────────────┘
```

1. **Ingestão de dados brutos**: resultados de partidas, odds (múltiplas casas), estatísticas de evento
   (xG), calendário, e (quando aplicável e disponível a tempo) escalações — cada registro com timestamp
   de captura.
2. **Computação de features**: para o `match_id` alvo e um `t_pred` específico, o feature store calcula
   o vetor de features consultando apenas dados com `disponivel_em ≤ t_pred` (§4.2). O vetor resultante é
   persistido junto com sua `features_version`.
3. **Inferência dos modelos base**: cada modelo (§2.1–2.7) recebe o vetor de features (ou histórico bruto
   de gols, no caso de Poisson/Dixon-Coles) e produz sua distribuição de probabilidade por mercado.
4. **Combinação por ensemble**: pesos correntes (§2.8) combinam as saídas em `p_ensemble` por mercado,
   junto com o intervalo de confiança derivado da discordância entre modelos.
5. **Value Engine**: para cada mercado e cada odds monitorada, calcula-se overround/probabilidade justa
   de mercado, edge, EV e Edge Score (§7); oportunidades acima do piso de score configurado são
   sinalizadas.

Toda a cadeia acima é registrada com os identificadores de proveniência (§1.1) e o resultado final —
probabilidades por mercado, componentes do Edge Score, e a lista de oportunidades sinalizadas — é
persistido de forma imutável (§1.3).

### 8.2 Timing: Quando as Predições Rodam Relativo ao Kickoff

| Momento | Evento | Descrição |
|---|---|---|
| D-3 a D-1 (varia por liga) | **Predição pré-jogo inicial** | Assim que o calendário da rodada é confirmado e há odds de abertura suficientes para o Value Engine operar. Esta é a predição "oficial" primária de cada partida. |
| Contínuo entre a predição inicial e o kickoff | **Monitoramento de movimento de odds** | Job contínuo rastreia odds de múltiplas casas; alimenta a feature `movimento_linha` e o componente `L` do Edge Score em qualquer re-predição subsequente. |
| ~60–75 min antes do kickoff | **Janela de escalação confirmada** | Quando disponível, escalações confirmadas disparam potencial re-predição (§8.4). |
| Kickoff (`t_kickoff`) | **Captura de odds de fechamento** | Snapshot final de odds de todas as casas monitoradas, usado para cálculo de CLV (§6.4) de todas as predições/oportunidades daquela partida. |
| Após o apito final | **Ingestão de resultado** | Resultado real, estatísticas pós-jogo e xG da partida entram no pipeline de ingestão — nunca retroagem sobre a predição já persistida (§1.3), apenas alimentam o histórico para partidas futuras e o cálculo de métricas de performance (§6). |

### 8.3 Latência e Frequência de Atualização

Predições pré-jogo iniciais são geradas em lote, tipicamente uma vez por dia (job noturno) cobrindo
todas as partidas com calendário confirmado nas próximas 72 horas — não há necessidade de latência de
tempo real nessa etapa, já que não há apostas ao vivo no escopo do produto (pré-jogo apenas). O
monitoramento de movimento de odds, por outro lado, roda em ciclo curto (minutos) para capturar
movimentos de linha relevantes a tempo de disparar re-predição antes do kickoff.

### 8.4 Gatilhos de Re-predição

Uma predição pré-jogo já publicada pode ser **suplementada** por uma nova predição (nunca substituída
silenciosamente — §1.3) quando:

1. **Movimento de odds significativo**: variação da odds implícita agregada (multi-casas) acima de um
   limiar configurável (tipicamente > 8–10% de variação na probabilidade implícita sem vig desde a
   predição anterior) — indica que o mercado incorporou informação nova (lesão relevante, mudança de
   contexto competitivo) que pode justificar reavaliação, mesmo sem uma feature estruturada capturando
   diretamente essa informação.
2. **Confirmação de escalação**: quando a escalação titular é confirmada (tipicamente 45–75 min antes do
   kickoff) e diverge de forma material da expectativa usada implicitamente na predição inicial (ex.:
   ausência de jogadores-chave identificados por um modelo auxiliar de importância de jogador), uma
   re-predição incorpora a informação de escalação como feature adicional.
3. **Correção de dado**: em caso raro de erro de dado identificado retroativamente (ex.: resultado de
   jogo histórico corrigido pela fonte, calendário alterado), uma re-predição é disparada para partidas
   cujas features dependiam do dado corrigido — sempre como novo registro versionado, com o registro
   anterior marcado como `superseded_by`, nunca apagado.

Cada re-predição é um novo registro completo (nova `generated_at`, mesmas ou atualizadas
`model_version`/`features_version`/`training_data_cutoff`), preservando a cadeia de auditoria completa
por partida.

---

## 9. Treinamento e Retreinamento

### 9.1 Cronograma de Treinamento

| Modelo | Frequência de retreino completo | Atualização incremental |
|---|---|---|
| Elo | — (não há "retreino em lote" no sentido tradicional) | **Diária** — rating atualizado partida a partida, imediatamente após cada resultado ser ingerido |
| Poisson / Dixon-Coles | **Semanal** | N/A — reestimação completa de ataque/defesa/`ρ`/`ξ` a cada ciclo, sobre a janela de dados corrente |
| Regressão Logística | **Semanal** (refit dos coeficientes) | N/A |
| Gradient Boosting (XGBoost/LightGBM) | **Semanal** (refit completo das árvores) | N/A — árvores de boosting não se prestam a atualização incremental leve sem risco de deriva |
| Modelo baseado em xG | **Semanal**, acoplado ao ciclo de gradient boosting/regressão que o consome | Dados de xG são incorporados assim que o provedor os disponibiliza (tipicamente horas após cada partida) |
| Consenso de mercado sem vig | **Contínuo** (recalculado a cada nova captura de odds) | N/A — não há "treino", é um cálculo determinístico sobre odds correntes |
| Pesos do Ensemble | **Semanal**, no mesmo ciclo dos modelos base — mais ajuste dinâmico contínuo entre ciclos (§2.8) | Ajuste dinâmico de decaimento de confiança roda continuamente conforme resultados são resolvidos |

O retreino semanal é deliberadamente acoplado ao calendário de rodadas da maioria das ligas cobertas
(uma rodada completa por semana, tipicamente), garantindo que cada retreino incorpore uma rodada
completa de resultados novos antes da próxima leva de predições.

### 9.2 Frequência de Tuning de Hiperparâmetros

Diferente do retreino de parâmetros (pesos/coeficientes/árvores, que roda semanalmente sobre a mesma
configuração de hiperparâmetros), a **busca de hiperparâmetros** (§2.5) é uma operação mais custosa e
roda em cadência mais espaçada:

- **Mensal**, como processo padrão de manutenção, para capturar deriva lenta na configuração ótima
  conforme o volume de dados disponível cresce.
- **Sob demanda**, disparado manualmente quando uma mudança estrutural relevante ocorre (nova liga
  incorporada com volume de dados suficiente, mudança de fonte de dado de xG, adição de uma família nova
  de features) que plausivelmente desloca a configuração ótima anterior.

Toda nova configuração de hiperparâmetros resultante de uma rodada de tuning passa pelo mesmo protocolo
de aceitação de modelo (§9.3) antes de substituir a configuração em produção — tuning não promove
automaticamente a produção.

### 9.3 Critérios de Seleção de Modelo

Um modelo (ou uma nova configuração de hiperparâmetros, ou uma nova versão de features) só substitui a
versão de produção corrente se, no backtest walk-forward (§5.1) sobre o período de avaliação padrão:

1. **Log loss** igual ou melhor que a versão corrente, com significância estatística mínima (intervalo
   de confiança não sobreposto de forma trivial — §6.7).
2. **Não pior em calibração** (ECE) que a versão corrente, na amostra de avaliação — melhora de log loss
   às custas de calibração pior é rejeitada por padrão (viola o princípio §1.4).
3. **Bate o Brier Skill Score do consenso de mercado sem vig** (`BSS > 0`, §6.1) na mesma amostra — um
   candidato que não supera o benchmark de mercado não é promovido, independentemente de superar a
   versão anterior do próprio BetEdge (evita "otimizar contra si mesmo" sem progresso real).
4. **Passa pela bateria de detecção de leakage** (§4.5) sem alertas não resolvidos.
5. **CLV médio positivo** (ou não-negativo, dependendo do mercado e volume disponível) nas oportunidades
   simuladas retrospectivamente que o candidato teria sinalizado.

### 9.4 Framework de Teste A/B para Modelos Novos

Modelos/configurações candidatas que passam nos critérios de backtest (§9.3) não substituem
imediatamente 100% do tráfego de produção. Em vez disso:

1. **Fase de sombra (shadow mode)**: o candidato roda em paralelo à produção, gerando predições que são
   persistidas e avaliadas (CLV, log loss) mas **não exibidas** ao usuário nem usadas pelo Value Engine —
   validação final de que o comportamento em dados verdadeiramente novos (não apenas backtest histórico)
   confirma o backtest.
2. **Fase de rollout parcial**: após um período mínimo de sombra sem divergência preocupante do
   backtest, o candidato passa a alimentar uma fração do tráfego real (tipicamente por liga ou por
   mercado, não por usuário — já que o produto não tem componente de personalização por usuário nas
   probabilidades), com monitoramento reforçado de CLV realizado.
3. **Promoção completa ou rollback**: decisão formal, baseada nos mesmos critérios do §9.3 aplicados
   agora a dados de produção real (não apenas backtest), com poder estatístico suficiente (§6.7) antes de
   decidir. Um candidato em rollout parcial que degrada métricas é revertido automaticamente por regra
   de circuito (kill switch) caso o log loss em produção exceda um limiar de degradação relativo à
   versão anterior por N predições consecutivas.

### 9.5 Política de Aposentadoria de Modelo

Um modelo é removido do portfólio ativo do ensemble (mantendo seu histórico para fins de auditoria, nunca
apagado — §1.3) quando:

- Seu peso no ensemble (§2.8) permanece próximo de zero de forma consistente por múltiplos ciclos de
  reotimização, indicando que não contribui informação incremental aos demais modelos.
- É substituído por uma nova geração/versão do mesmo tipo de modelo que domina em todos os critérios do
  §9.3 (ex.: nova versão de gradient boosting com feature set expandido supera a anterior em toda liga
  coberta).
- Dependência de dado descontinuada (ex.: fonte de xG específica descontinuada e não substituída) torna o
  modelo inoperável para parte relevante da cobertura de ligas.

---

## 10. Limitações e Disclaimers

### 10.1 Mercados Onde os Modelos São Menos Confiáveis

- **Placar exato**: por natureza um mercado de altíssima granularidade (dezenas de resultados possíveis
  com probabilidades individuais baixas), sensível a qualquer imprecisão nos parâmetros de
  Poisson/Dixon-Coles — erros pequenos em `λ` se propagam amplificados para células específicas da
  grade. Tratado com cautela redobrada na comunicação de confiança ao usuário.
- **Linhas de Asian Handicap muito assimétricas ou pouco líquidas**: quando poucas casas cotam uma linha
  específica, o consenso de mercado sem vig (§2.7) perde robustez estatística (poucas observações para
  estimar `z` no método Shin, por exemplo), reduzindo a confiabilidade tanto do benchmark de comparação
  quanto do próprio Edge Score (componente `B`, cobertura de casas).
- **Competições com poucos jogos históricos por temporada** (mata-mata continentais, fases de grupos
  curtas): o piso mínimo de amostra (§6.7) frequentemente não é atingido, e os modelos operam com maior
  incerteza epistêmica — refletida no intervalo de confiança do ensemble (§2.8), mas ainda assim menos
  confiável do que ligas de pontos corridos com histórico extenso.
- **Início de temporada / pós-janela de transferências relevante**: mudanças estruturais de elenco não
  totalmente refletidas no histórico recente tornam features de forma e rating menos informativas até
  que um volume mínimo de jogos da temporada corrente se acumule.

### 10.2 Requisitos Mínimos de Dado por Liga

Uma liga só recebe cobertura completa (todos os modelos, todos os mercados, Edge Score habilitado) se
atender simultaneamente:

- Histórico mínimo de resultados equivalente a ≥ 2 temporadas completas (ou volume de partidas
  equivalente) para estimação estável de parâmetros de ataque/defesa e treino do gradient boosting.
- Cobertura de odds de ≥ 3 casas de apostas de referência, com atualização de linha capturada em
  frequência suficiente para o monitoramento de movimento de linha (§3.6, §8.2).
- Quando cobertura de xG não está disponível para a liga, os modelos que dependem de xG como feature
  primária (§2.6) são desabilitados para essa liga especificamente, e o ensemble é reotimizado sem esse
  componente (peso redistribuído entre os demais modelos) — nunca com xG ausente silenciosamente
  imputado como zero ou média global, o que introduziria viés sistemático.

Ligas abaixo desses pisos recebem cobertura parcial (tipicamente apenas Poisson/Dixon-Coles/Elo, que
exigem menos dado estrutural) ou nenhuma cobertura, sinalizado explicitamente na interface do produto.

### 10.3 Vieses Conhecidos

- **Viés de favorito-azarão (favorite-longshot bias)**: presente tanto no mercado bruto (parcialmente
  corrigido pelos métodos de remoção de overround, §2.7) quanto potencialmente herdado pelos próprios
  modelos se o histórico de treino refletir esse padrão sem correção — monitorado especificamente via
  quebra de calibração (§6.3) por faixa de probabilidade, com atenção redobrada nos extremos (< 15% e
  > 85%).
- **Viés de sobrevivência em dados de xG**: provedores de xG tendem a ter cobertura historicamente mais
  completa e mais longa para ligas/equipes de maior visibilidade comercial, potencialmente introduzindo
  assimetria de qualidade de feature entre ligas cobertas.
- **Viés de disponibilidade de escalação**: nem todas as ligas/casas de apostas fornecem escalação
  confirmada com a mesma antecedência ou confiabilidade — a re-predição por escalação (§8.4) está
  estruturalmente mais disponível para ligas de elite, criando assimetria de "frescor" de informação
  incorporada entre ligas.
- **Autocorrelação de erro entre modelos correlacionados**: modelos que compartilham a mesma fonte de
  dado subjacente (ex.: qualquer modelo consumindo xG do mesmo provedor) não são estatisticamente
  independentes entre si — o intervalo de confiança de discordância do ensemble (§2.8) subestima a
  incerteza real na medida em que os modelos base compartilham vieses correlacionados de fonte de dado,
  não apenas de metodologia.

### 10.4 Aviso de Desempenho Passado

> **Desempenho passado não garante resultado futuro.** Toda métrica de performance apresentada neste
> documento e no produto — Brier Score, log loss, CLV, ROI retrospectivo, hit rate — é uma medida
> histórica, calculada sobre dados e condições de mercado passados. Mercados esportivos são dinâmicos:
> a eficiência do mercado, a disponibilidade de dados, o comportamento de outras equipes e apostadores, e
> a própria composição das equipes mudam continuamente. Nenhuma probabilidade, Edge Score ou
> recomendação de valor gerada pela plataforma constitui garantia de resultado, e todo uso dessas
> informações para decisão de aposta é de responsabilidade exclusiva do usuário. O BetEdge não presta
> aconselhamento financeiro nem garante retorno sobre qualquer stake.

Este aviso é exibido de forma proeminente em qualquer superfície do produto onde métricas de performance
retrospectiva (ROI, yield, CLV agregado) sejam apresentadas, não apenas neste documento de referência.

---

*Fim do documento. Para dúvidas de implementação específicas de cada modelo, consultar o código-fonte do
motor estatístico e os testes de regressão de leakage referenciados na Seção 4.5.*
