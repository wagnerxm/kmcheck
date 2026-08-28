# BetEdge — Arquitetura do Sistema

> **Status:** documento vivo. Descreve a arquitetura de referência da plataforma BetEdge — SaaS de
> inteligência estatística aplicada a apostas esportivas (futebol, mercado pré-jogo).
>
> **Princípio inegociável do produto:** o BetEdge **não inventa palpites com "conhecimento" de LLM**.
> Toda probabilidade, todo edge e todo score exibidos ao usuário são o resultado de dados estruturados,
> cálculo matemático e modelos estatísticos reprodutíveis. A IA generativa (Claude) entra **depois** do
> número já existir, só para explicá-lo em linguagem natural — nunca para produzi-lo.

---

## Sumário

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Frontend (Next.js)](#2-frontend-nextjs)
3. [Backend — BFF (Next.js API Routes)](#3-backend--bff-nextjs-api-routes)
4. [Backend — Motor Estatístico (FastAPI)](#4-backend--motor-estatístico-fastapi)
5. [Pipeline de Dados](#5-pipeline-de-dados)
6. [Value Engine](#6-value-engine)
7. [Cache e Performance](#7-cache-e-performance)
8. [Background Jobs](#8-background-jobs)
9. [Integração com Claude API](#9-integração-com-claude-api)
10. [Segurança](#10-segurança)
11. [Observabilidade](#11-observabilidade)
12. [Deploy e Infraestrutura](#12-deploy-e-infraestrutura)
13. [Decisões Técnicas e Trade-offs](#13-decisões-técnicas-e-trade-offs)
14. [Diretório do Projeto (Estrutura Completa)](#14-diretório-do-projeto-estrutura-completa)

---

## 1. Visão Geral da Arquitetura

### 1.1. Diagrama de alto nível

```
                                   ┌───────────────────────────┐
                                   │        USUÁRIO (web)       │
                                   └──────────────┬─────────────┘
                                                  │ HTTPS / WSS
                                                  ▼
                        ┌─────────────────────────────────────────────┐
                        │        FRONTEND — Next.js (Vercel)           │
                        │  App Router · React Server Components ·      │
                        │  TanStack Query · Zustand · SSE client        │
                        └───────────────┬───────────────┬──────────────┘
                                        │               │
                         REST/JSON (BFF)│               │ SSE (updates ao vivo)
                                        ▼               ▼
                        ┌─────────────────────────────────────────────┐
                        │   BFF — Next.js API Routes (mesmo deploy)     │
                        │   Auth (Supabase) · Rate limit · Cache HTTP · │
                        │   Orquestração · Agregação de respostas       │
                        └───────┬───────────────┬───────────┬──────────┘
                                │               │           │
                     REST/JSON │       SQL/RPC  │     Redis │ (cache, pub/sub)
                                ▼               ▼           ▼
              ┌──────────────────────┐ ┌───────────────┐ ┌─────────────────┐
              │  MOTOR ESTATÍSTICO    │ │   SUPABASE     │ │      REDIS       │
              │  Python · FastAPI     │ │  (PostgreSQL   │ │  cache · filas   │
              │  Pandas/NumPy/Sklearn │ │  + Auth + RLS  │ │  pub/sub (SSE)   │
              │  XGBoost/LightGBM     │ │  + Realtime)   │ │                  │
              └───────────┬───────────┘ └───────┬────────┘ └────────┬─────────┘
                          │                     │                   │
                          │ lê features/odds    │                   │
                          ▼                     ▼                   ▼
              ┌───────────────────────────────────────────────────────────────┐
              │                    WORKERS EM BACKGROUND                       │
              │  Node/BullMQ: coleta de odds, notificações, alertas            │
              │  Python/Celery: treino de modelo, backtest, feature compute    │
              └───────────────┬─────────────────────────────┬─────────────────┘
                              │                              │
                              ▼                              ▼
              ┌──────────────────────────┐     ┌─────────────────────────────┐
              │   SportsGameOdds (odds)   │     │  Claude API (Anthropic)      │
              │   The Odds API (fallback) │     │  só para texto explicativo   │
              └──────────────────────────┘     └─────────────────────────────┘
```

### 1.2. Estrutura de monorepo (Turborepo)

O BetEdge é organizado como **monorepo gerenciado pelo Turborepo**, com `pnpm` como gerenciador de
pacotes (workspaces nativos + lockfile determinístico). A ideia central é: **um repositório, múltiplos
serviços deployáveis independentemente**, compartilhando tipos, contratos e configuração.

```
apps/web            → Next.js (frontend + BFF, um único deploy na Vercel)
services/engine      → FastAPI (motor estatístico, deploy próprio em container)
services/workers/node    → BullMQ workers (deploy próprio em container)
services/workers/python  → Celery workers (deploy próprio em container)
packages/types       → tipos TypeScript compartilhados (gerados a partir do contrato OpenAPI do engine)
packages/utils        → funções puras compartilhadas (formatação de odds, datas, moeda)
packages/config        → eslint, tsconfig, tailwind config base
supabase             → migrations, edge functions, seed
```

O `turbo.json` define pipelines (`build`, `lint`, `test`, `typecheck`) com cache de build local e
remoto (Vercel Remote Cache), garantindo que só o que mudou seja reconstruído em CI. Cada app/serviço
tem seu próprio `package.json` (ou `requirements.txt`/`pyproject.toml` para os serviços Python), mas o
monorepo garante que uma mudança de contrato (ex.: um campo novo em `EdgeScore`) seja sentida em
compile-time por quem consome, não descoberta em produção.

### 1.3. Limites de serviço e responsabilidades

| Serviço | Responsabilidade | Não faz |
|---|---|---|
| **`apps/web`** (Next.js) | Renderização de UI, autenticação de sessão, BFF (agregação/orquestração de chamadas), cache HTTP de borda, streaming de atualizações via SSE para o browser | Não calcula probabilidades, não acessa modelos estatísticos diretamente, não fala com provedores de odds |
| **`services/engine`** (FastAPI) | Feature engineering, treino/inferência de modelos, cálculo de probabilidade justa, Value Engine (edge, EV, Edge Score), validação walk-forward, backtesting | Não serve HTML, não autentica usuário final, não fala com Claude |
| **`services/workers/node`** | Polling de odds nos provedores externos, disparo de notificações/alertas, jobs leves e de I/O intensivo | Não roda modelos de ML pesados |
| **`services/workers/python`** | Treino de modelo agendado, backtest em lote, recomputação de features históricas, jobs de CPU intensivo | Não fala com o usuário final, não expõe HTTP público |
| **Supabase (Postgres)** | Fonte da verdade: dados de jogos, odds históricas (append-only), features, previsões, contas de usuário, RLS | Não processa lógica de negócio complexa (mantido deliberadamente "burro") |
| **Redis** | Cache de leitura, filas (BullMQ), pub/sub para SSE, rate limiting distribuído | Não é armazenamento durável de registro |
| **Claude API** | Geração de texto explicativo a partir de dados já calculados | Nunca gera número, probabilidade, odd ou EV |

### 1.4. Padrões de comunicação

- **Browser ↔ BFF:** REST/JSON via `fetch` (React Server Components fazem fetch direto no servidor
  quando possível; Client Components usam TanStack Query contra as API Routes).
- **Browser ↔ BFF (tempo real):** **Server-Sent Events (SSE)** em vez de WebSocket bidirecional — o
  fluxo é essencialmente unidirecional (servidor → cliente: nova odd, movimento de linha, novo
  alerta), então SSE é mais simples de operar atrás de CDN/edge, reconecta automaticamente no browser
  e não exige infraestrutura de WebSocket dedicada. WebSocket fica reservado como opção futura caso
  surja necessidade de push bidirecional real (ex.: chat colaborativo), mas a arquitetura já isola
  esse ponto atrás de um hook único (`useRealtimeChannel`) para trocar o transporte sem tocar em
  componentes de UI.
- **BFF ↔ Motor Estatístico:** REST/JSON, contrato OpenAPI versionado (`/v1/...`), autenticado por
  chave de serviço interna (não é a mesma auth do usuário final).
- **BFF ↔ Supabase:** SDK oficial (`@supabase/supabase-js`) usando o **service role** para leituras
  agregadas de servidor, e o **cliente anônimo com JWT do usuário** para operações que devem respeitar
  Row Level Security (favoritos, alertas, configurações).
- **Workers ↔ Redis/Postgres:** BullMQ fala com Redis; Celery fala com Redis (broker) e Postgres
  (resultado/estado via SQLAlchemy).
- **Engine ↔ Postgres:** SQLAlchemy + `asyncpg`, leitura de odds/features e escrita de previsões e
  métricas de modelo.

---

## 2. Frontend (Next.js)

### 2.1. Estrutura do App Router

O frontend usa **Next.js 14+ com App Router**, priorizando **React Server Components (RSC)** para
tudo que é leitura de dados (menos JS no cliente, menos round-trips), e **Client Components** apenas
onde há interatividade (filtros, gráficos, tabelas com ordenação client-side, SSE).

```
apps/web/src/app/
├── (auth)/
│   ├── login/page.tsx
│   ├── cadastro/page.tsx
│   └── recuperar-senha/page.tsx
├── (app)/                          ← grupo de rotas autenticadas, com layout compartilhado
│   ├── layout.tsx                  ← shell (sidebar, topbar, provider de auth/query)
│   ├── dashboard/page.tsx
│   ├── top-picks/page.tsx
│   ├── value-finder/page.tsx
│   ├── odds-scanner/page.tsx
│   ├── line-movement/
│   │   ├── page.tsx
│   │   └── [eventId]/page.tsx
│   ├── odds-comparison/[eventId]/page.tsx
│   ├── ai-analyst/[eventId]/page.tsx
│   ├── jogos/
│   │   ├── page.tsx
│   │   └── [eventId]/page.tsx
│   ├── campeonatos/
│   │   ├── page.tsx
│   │   └── [leagueId]/page.tsx
│   ├── estatisticas/
│   │   ├── times/[teamId]/page.tsx
│   │   └── jogadores/[playerId]/page.tsx
│   ├── model-lab/
│   │   ├── page.tsx
│   │   └── [modelId]/page.tsx
│   ├── performance/page.tsx
│   ├── favoritos/page.tsx
│   ├── alertas/page.tsx
│   └── configuracoes/page.tsx
├── api/                             ← BFF, ver seção 3
├── layout.tsx                       ← layout raiz (fonte, tema, providers globais)
└── globals.css
```

Cada rota segue o padrão: `page.tsx` (Server Component, faz o fetch inicial), `loading.tsx`
(skeleton), `error.tsx` (boundary local) e, quando a página precisa de interatividade pesada, um
`*-client.tsx` colocado ao lado que recebe os dados iniciais via props (hydration) e assume a partir
daí com TanStack Query.

### 2.2. Descrição das telas

| Rota | Propósito |
|---|---|
| **Dashboard** | Visão consolidada do dia: número de oportunidades abertas, resumo de performance recente, jogos em destaque, alertas disparados |
| **Top Picks** | Ranking das melhores oportunidades do dia por Edge Score, com filtros por liga, mercado e faixa de odd |
| **Value Finder** | Busca dirigida por valor: usuário define critérios (edge mínimo, EV mínimo, mercado, liga) e o motor retorna as oportunidades que batem o filtro |
| **Odds Scanner** | Varredura em tempo real de todas as odds monitoradas, com destaque para as que mudaram nos últimos minutos |
| **Line Movement** | Histórico de movimento de linha de um evento/mercado específico, com gráfico de série temporal (odd × tempo) |
| **Odds Comparison** | Comparação lado a lado das odds entre casas para o mesmo mercado/evento (quando múltiplas fontes estiverem ativas) |
| **AI Analyst** | Análise textual gerada pelo Claude a partir dos dados já calculados de um evento (ver seção 9) |
| **Jogos** | Lista e detalhe de partidas (pré-jogo), com todas as métricas e probabilidades calculadas |
| **Campeonatos** | Navegação por liga/competição: tabela, calendário, força relativa dos times |
| **Estatísticas** | Perfis estatísticos de times e jogadores (histórico, forma, xG, médias) |
| **Model Lab** | Página avançada para usuários "power": comparação de modelos, métricas de calibração, performance por modelo |
| **Performance** | Tracking de resultado das recomendações passadas do BetEdge (ROI, hit rate, CLV) |
| **Favoritos** | Times, ligas e mercados marcados como favoritos pelo usuário, com feed dedicado |
| **Alertas** | Configuração e histórico de alertas (edge acima de X, movimento de linha, jogo de time favorito) |
| **Configurações** | Perfil, preferências de odd (decimal/fracionária/americana), unidades de stake, integrações, notificações |

### 2.3. Arquitetura de componentes (atomic design adaptado)

```
components/
├── ui/            ← shadcn/ui (átomos: Button, Input, Badge, Dialog, Table, Tooltip...)
├── charts/         ← moléculas de visualização (Recharts): LineMovementChart, ProbabilityBar,
│                     EdgeScoreGauge, CalibrationPlot, ROIChart
├── odds/           ← moléculas de domínio de odds: OddCell, OddsMovementTag, MarketSelector,
│                     BookmakerBadge
├── events/         ← organismos de domínio de eventos: EventCard, EventHeader, EventMarketsTable,
│                     MatchTimeline
└── layout/         ← organismos de shell: Sidebar, Topbar, PageHeader, EmptyState, FilterBar
```

Regra de dependência: `ui` não conhece domínio nenhum (reutilizável em qualquer produto);
`charts`/`odds`/`events` podem depender de `ui` e de `packages/types`, mas não umas das outras a não
ser por composição explícita na página; páginas (`app/**/page.tsx`) compõem organismos, nunca acessam
`ui` diretamente para montar layout de tela.

### 2.4. Gerenciamento de estado

- **Estado de servidor (dados vindos da API):** **TanStack Query** (React Query) em todo Client
  Component. Chaves de query padronizadas por domínio (`['events', eventId]`,
  `['value-finder', filters]`, `['line-movement', eventId, marketId]`). `staleTime` calibrado por tipo
  de dado: odds ativas (segundos), estatísticas históricas (minutos/horas), metadados de liga/time
  (dia). Invalidação dirigida por evento SSE (ver 2.5) em vez de polling agressivo sempre que possível.
- **Estado de cliente (UI local, preferências, filtros voláteis):** **Zustand**, com stores pequenos e
  escopados por feature (`useValueFinderFiltersStore`, `useOddsFormatStore`,
  `useSidebarStore`) — evita um único store global gigante. Persistência seletiva via
  `zustand/middleware persist` (localStorage) para preferências como formato de odd e tema.
- Regra prática: **se o dado existe no banco, é TanStack Query; se o dado só existe na tela, é
  Zustand (ou `useState` local quando nem precisa ser compartilhado).**

### 2.5. Atualizações em tempo real (SSE)

O BFF expõe um endpoint `GET /api/stream/events` (Route Handler com `ReadableStream`) que mantém uma
conexão SSE por sessão de browser. O servidor assina canais Redis pub/sub (publicados pelos workers
Node quando uma nova odd chega ou um alerta dispara) e repassa o evento ao cliente como uma mensagem
SSE tipada:

```
event: odds.updated
data: {"eventId":"evt_123","marketId":"1x2","bookmaker":"betX","odds":{"home":1.85,"draw":3.4,"away":4.2},"ts":"..."}

event: alert.triggered
data: {"alertId":"al_456","eventId":"evt_123","reason":"edge_above_threshold","edgeScore":78}
```

No cliente, um `RealtimeProvider` único (em `app/(app)/layout.tsx`) abre a conexão via `EventSource`,
faz o parse e despacha para: (a) invalidação seletiva de queries do TanStack Query cujas chaves batem
com o `eventId`/`marketId` do evento, e (b) uma store Zustand de notificações (para os toasts de
alerta). Reconexão automática do `EventSource` cuida de queda de rede; o servidor reenvia o
`lastEventId` perdido lendo o backlog recente do Redis Stream (não um Pub/Sub puro — ver seção 7) para
não perder eventos durante um blip curto de conexão.

---

## 3. Backend — BFF (Next.js API Routes)

O BFF (Backend-for-Frontend) roda **no mesmo deploy do Next.js**, como Route Handlers em `app/api/**`.
Ele nunca contém lógica estatística — sua função é: autenticar, validar, orquestrar chamadas ao
Motor Estatístico e ao Supabase, agregar respostas no formato que a UI consome, cachear, e aplicar
rate limiting.

### 3.1. Autenticação com Supabase Auth

- Login via e-mail/senha e OAuth (Google) usando `@supabase/ssr`, com sessão em cookies HTTP-only
  (`sb-access-token` / `sb-refresh-token`), compatível com Server Components e Route Handlers.
- Middleware do Next.js (`middleware.ts`) roda em toda requisição de página do grupo `(app)`: lê o
  cookie de sessão, tenta refresh silencioso se expirado, e redireciona para `/login` se inválido.
- Toda Route Handler sensível chama um helper `getServerSession()` que devolve o usuário autenticado
  (ou lança 401). Endpoints internos chamados pelo próprio servidor (ex.: pré-carregar dados em RSC)
  usam o client Supabase autenticado com o JWT do usuário, para que **RLS decida o que é visível** —
  o BFF não reimplementa autorização em código quando o banco já pode garantir isso.
- Rotas administrativas (poucas: gestão de planos, flags de feature) exigem `role = admin` verificado
  contra uma tabela `profiles`, checada explicitamente na Route Handler além do RLS.

### 3.2. Organização das rotas de API

```
app/api/
├── events/
│   ├── route.ts                     GET  lista/filtra eventos
│   └── [eventId]/route.ts           GET  detalhe de evento (agrega engine + supabase)
├── value-finder/route.ts             GET  proxy filtrado para o Value Engine
├── top-picks/route.ts                GET  ranking do dia (cacheado)
├── odds/
│   ├── scanner/route.ts              GET  snapshot de odds monitoradas
│   └── comparison/[eventId]/route.ts GET  odds lado a lado por casa
├── line-movement/[eventId]/route.ts  GET  série histórica de uma linha
├── ai-analyst/[eventId]/route.ts     POST  dispara análise Claude (ver seção 9)
├── models/
│   ├── route.ts                      GET  lista modelos registrados (Model Lab)
│   └── [modelId]/performance/route.ts GET métricas de calibração/desempenho
├── performance/route.ts              GET  ROI/hit-rate/CLV do usuário ou global
├── favorites/route.ts                GET/POST/DELETE
├── alerts/
│   ├── route.ts                      GET/POST  regras de alerta do usuário
│   └── [alertId]/route.ts            PATCH/DELETE
├── settings/route.ts                 GET/PATCH preferências do usuário
├── stream/events/route.ts            GET  SSE (ver 2.5)
└── webhooks/
    └── sportsgameodds/route.ts       POST recebe push do provedor (se disponível) — validação de assinatura
```

Convenções: todo handler valida entrada com **Zod** (schemas compartilhados de `packages/types` quando
fazem sentido em ambos os lados), devolve erros num formato padronizado
`{ error: { code, message } }`, e nunca repassa stack trace ou detalhe interno ao cliente.

### 3.3. Rate limiting

Implementado com Redis (algoritmo *sliding window* via `@upstash/ratelimit` ou implementação própria
com `ZADD`/`ZREMRANGEBYSCORE`), aplicado em duas camadas:

- **Por usuário autenticado:** limites por plano (ex.: plano free = 60 req/min nas rotas de leitura
  pesada como `value-finder` e `odds/scanner`; plano pro = limite maior).
- **Por IP, em rotas públicas** (`login`, `cadastro`, `webhooks`): proteção contra brute-force e abuso,
  limite mais agressivo (ex.: 10 req/min).

Middleware dedicado (`lib/rate-limit.ts`) é chamado no início de cada Route Handler sensível; ao
estourar o limite, devolve `429` com header `Retry-After`. Rotas de leitura cacheada (Top Picks,
Dashboard) sofrem menos pressão porque a maioria das requisições é servida pelo cache antes de chegar
à lógica de rate limit "cara".

### 3.4. Pipeline de middleware

Ordem de execução por requisição de API:

```
1. next.js middleware.ts     → resolve sessão, refresh de token, redirect se preciso (só páginas)
2. Route Handler entry       → withAuth()      → garante usuário autenticado (ou 401)
3.                            → withRateLimit() → checa limite (ou 429)
4.                            → withValidation(schema) → valida body/query com Zod (ou 400)
5.                            → handler de negócio → orquestra chamadas (engine/supabase/redis)
6.                            → withCache()     → grava resultado no cache quando aplicável
7.                            → resposta padronizada
```

Esses `with*` são *higher-order functions* compostas explicitamente em cada rota (não um framework de
middleware mágico), para manter rastreável o que cada endpoint realmente aplica.

### 3.5. Estratégia de cache de resposta

- **Cache de borda (Vercel/CDN)** para rotas verdadeiramente públicas e de baixa cardinalidade (quase
  nenhuma no BetEdge, já que tudo é por usuário/sessão — usado principalmente para assets estáticos).
- **Cache em Redis, chave por parâmetros normalizados**, para respostas caras de calcular mas iguais
  entre usuários (Top Picks do dia, tabela de campeonato, perfil estatístico de time). TTL curto
  (30–120s) para dados que mudam com odds ao vivo; TTL longo (horas) para dados históricos/estáticos.
- **`stale-while-revalidate` no header HTTP** das Route Handlers que servem dado quase-estático, para
  que o Next.js/CDN sirva a versão em cache imediatamente enquanto revalida em background.
- Detalhe completo de invalidação está na seção 7.

---

## 4. Backend — Motor Estatístico (FastAPI)

O `services/engine` é o coração quantitativo do produto: um serviço **Python/FastAPI** stateless (no
sentido de não guardar sessão de usuário) cuja única fonte de verdade é o Postgres (via Supabase) para
dados de entrada, e cujo output são números — probabilidades, edges, scores — nunca texto.

### 4.1. Arquitetura do serviço

```
services/engine/app/
├── api/                 ← routers FastAPI, versionados (/v1/...)
│   ├── predictions.py    POST /v1/predictions/{event_id}     → roda pipeline de predição
│   ├── value.py          GET  /v1/value/opportunities         → Value Engine (seção 6)
│   ├── models.py         GET  /v1/models · /v1/models/{id}    → Model Registry
│   ├── backtest.py       POST /v1/backtest                    → dispara backtest assíncrono
│   └── health.py         GET  /v1/health, /v1/ready
├── models/               ← implementações de modelo (interface comum, ver 4.4)
│   ├── poisson.py
│   ├── dixon_coles.py
│   ├── elo.py
│   ├── logistic.py
│   ├── gradient_boost.py
│   ├── xg_model.py
│   ├── market_consensus.py
│   └── ensemble.py
├── features/             ← feature engineering (ver 4.3)
├── validation/           ← walk-forward, cross-validation temporal (ver 4.7)
├── metrics/              ← Brier score, log loss, calibração, ROI simulado
└── core/                 ← config, conexão de banco, logging, exceptions, dependências FastAPI
```

Cada router FastAPI é fino: valida entrada com **Pydantic**, delega para uma camada de *service*
(`app/core/services/*.py`) que orquestra features → modelo → pós-processamento, e devolve um schema
Pydantic de saída (que também gera o OpenAPI consumido para gerar tipos TypeScript em
`packages/types`).

### 4.2. Model Registry

Todo modelo treinado é registrado numa tabela `model_registry` (Postgres) com:

```
model_id (uuid) · nome · tipo (poisson|dixon_coles|elo|logistic|xgboost|lightgbm|ensemble)
versão (semver) · hiperparâmetros (jsonb) · features_usadas (jsonb, lista) 
data_treino · janela_dados_treino (from/to) · métricas_validação (jsonb: brier, log_loss, calibration)
artefato_uri (caminho do binário serializado, ex.: storage do Supabase ou S3-compatible)
status (staging|production|archived) · ativo (bool)
```

O registry permite que múltiplas versões do mesmo tipo de modelo coexistam (ex.: `xgboost v1.3.0` em
produção e `xgboost v1.4.0` em staging, sendo comparados lado a lado antes de promoção). Promoção de
`staging` para `production` é uma ação explícita (via CLI interna ou painel do Model Lab), nunca
automática — mesmo quando o backtest mostra melhora, para permitir revisão humana da mudança de
comportamento do modelo.

### 4.3. Pipeline de feature engineering

Features são computadas em duas velocidades:

- **Features "batch" (recalculadas por job agendado, seção 8):** médias móveis de gols/xG por time
  (últimos 5/10 jogos, mandante/visitante separado), força ofensiva/defensiva relativa (base para
  Poisson/Dixon-Coles), rating Elo corrente, forma recente (pontos últimos N jogos), descanso entre
  jogos, histórico de confronto direto. Persistidas em `features_snapshot` com timestamp de cálculo —
  **nunca sobrescritas**, sempre um novo snapshot, para permitir auditoria e reprodutibilidade exata
  de uma predição passada.
- **Features "on-demand" (calculadas na hora da predição):** derivadas simples a partir do snapshot
  batch mais recente disponível **antes do horário do jogo** (ex.: diferença de rating Elo entre os
  times, razão de forma). Isso é o que entra de fato no vetor de features do modelo — nunca se lê o
  snapshot mais recente do banco sem checar a data de corte, exatamente para evitar vazamento (4.5).

Todo pipeline de features é uma função pura e testável: `compute_features(event, as_of: datetime) ->
FeatureVector`, parametrizada pelo instante de corte, o que é o que torna a prevenção de vazamento
verificável em teste automatizado (gerar features "como se fosse" uma data no passado e comparar com o
que estava de fato disponível naquele momento).

### 4.4. Pipeline de predição

```
Evento (event_id, kickoff_time)
        │
        ▼
compute_features(event, as_of=now)             → FeatureVector
        │
        ▼
para cada modelo ativo em produção no Model Registry:
        modelo.predict(FeatureVector) → probabilidades brutas (home/draw/away, over/under, btts...)
        │
        ▼
ensemble.combine(predições_de_cada_modelo, pesos_do_registry) → probabilidade "fair" consolidada
        │
        ▼
normalização (garante soma = 1 por mercado 1x2, tratamento de mercados de 2 vias)
        │
        ▼
persistência em `predictions` (append, versionado por model_id + timestamp)
        │
        ▼
      Value Engine (seção 6) consome essa saída junto com as odds de mercado
```

Cada implementação de modelo (`models/*.py`) segue uma interface comum (`BaseModel` em
`app/models/base.py`) com `fit(training_data)`, `predict(features) -> Probabilities` e
`serialize()/deserialize()`, o que permite ao ensemble tratar Poisson, Dixon-Coles, Elo, regressão
logística, XGBoost/LightGBM e o modelo baseado em xG de forma uniforme, e permite adicionar um novo
modelo sem tocar no pipeline de predição.

O **`market_consensus.py`** é tratado como "mais um modelo" no ensemble: ele deriva uma probabilidade
implícita a partir da odd média do mercado (remoção de overround, seção 6), servindo tanto como sinal
de entrada para o ensemble (o mercado é, historicamente, um preditor forte) quanto como baseline de
comparação para medir se os modelos próprios agregam informação (ver `metrics/`).

### 4.5. Prevenção de vazamento de dados (data leakage)

Vazamento é o risco mais crítico de um motor de predição esportiva — é fácil, sem querer, treinar ou
prever usando informação que só existiria *depois* do resultado. Mecanismos aplicados:

1. **Corte temporal obrigatório (`as_of`) em toda função de feature.** Não existe caminho de código
   que leia "o dado mais recente" sem passar uma data de corte explícita.
2. **Separação física de tabelas "fato" vs. "resultado".** Estatísticas de um jogo (placar, xG
   realizado, cartões) só entram na tabela de features de jogos *futuros* depois de o jogo em questão
   ter terminado — nunca são usadas nas features do próprio jogo que as gerou.
3. **Testes automatizados de vazamento** (`tests/test_no_leakage.py`): para uma amostra de eventos
   passados, o teste recomputa features com `as_of` = horário do kickoff e verifica que nenhum valor
   incorpora informação posterior (checagem cruzada de timestamps de origem dos dados agregados).
4. **Walk-forward validation por padrão** (4.7) em vez de K-fold aleatório, que por natureza vaza
   informação futura para trás no tempo em séries temporais.
5. **Revisão de correlação suspeita:** qualquer feature nova candidata passa por um checklist manual —
   "essa informação existia, de fato, antes do apito inicial, no formato em que está sendo lida?" —
   antes de entrar em produção.

### 4.6. Versionamento de modelo

Segue **versionamento semântico aplicado ao comportamento do modelo**, não só ao código:

- **MAJOR:** mudança de arquitetura ou de espaço de features (ex.: adicionar dado de lesões muda o
  contrato de entrada) — quebra comparabilidade direta com versões anteriores.
- **MINOR:** retrain com mais dados ou ajuste de hiperparâmetro que melhora métrica de validação sem
  mudar a interface do modelo.
- **PATCH:** correção de bug no pipeline que não devia alterar o resultado esperado, mas alterou.

O artefato binário (via `joblib`/`pickle` para sklearn-like, formato nativo para XGBoost/LightGBM) é
armazenado com nome incluindo hash do commit + versão, e o `model_registry` aponta para ele — nunca se
sobrescreve um artefato já publicado.

### 4.7. Infraestrutura de validação walk-forward

Para respeitar a natureza temporal dos dados esportivos (não se pode "embaralhar" jogos no tempo),
toda validação de modelo usa **walk-forward** (expanding ou rolling window):

```
Janela 1: treina em [2019-01 .. 2022-06] → valida em [2022-07 .. 2022-09]
Janela 2: treina em [2019-01 .. 2022-09] → valida em [2022-10 .. 2022-12]
Janela 3: treina em [2019-01 .. 2022-12] → valida em [2023-01 .. 2023-03]
...
```

Cada janela produz métricas (Brier score, log loss, calibração — ver `metrics/`) que são agregadas
para dar o desempenho "fora da amostra, no tempo" do modelo — o número que de fato importa, já que em
produção o modelo sempre prevê o futuro a partir do passado. A infraestrutura (`validation/walk_forward.py`)
é parametrizável (tamanho de janela, passo, expanding vs. rolling) e é o mesmo código usado tanto para
validação pré-promoção de modelo quanto para os jobs periódicos de backtest do Model Lab (seção 8),
garantindo que o número mostrado ao usuário avançado no Model Lab é gerado pelo mesmo mecanismo que
decide se um modelo é promovido.

---

## 5. Pipeline de Dados

### 5.1. Fluxo de coleta de odds a partir do SportsGameOdds

```
┌────────────────────┐
│  BullMQ scheduler    │  cron interno (repeatable job) dispara "odds:poll" a cada N minutos
└──────────┬───────────┘  (N varia por proximidade do kickoff — ver 5.4)
           ▼
┌────────────────────────────┐
│  Worker Node — odds-poller  │
│  chama SportsGameOdds API   │
└──────────┬───────────────────┘
           ▼
  resposta bruta do provedor (JSON específico do SportsGameOdds)
           │
           ▼
┌──────────────────────────────┐
│  Normalização (mapping layer) │  converte formato do provedor → schema interno BetEdge
└──────────┬─────────────────────┘
           ▼
  registro normalizado: { event_external_id, market, bookmaker, odds[], captured_at }
           │
           ├──► resolve/mapeia event_external_id → event_id interno (tabela de mapeamento)
           │
           ▼
┌──────────────────────────────┐
│  Escrita append-only          │  INSERT em odds_history (nunca UPDATE) — ver 5.3
└──────────┬─────────────────────┘
           ▼
  publica evento no Redis (pub/sub / stream) → SSE (seção 2.5) e invalidação de cache (seção 7)
```

### 5.2. Normalização e mapeamento de dados

Provedores de odds têm nomenclatura e identificadores próprios (times, ligas, mercados). A camada de
normalização (`services/workers/node/src/normalize/`) resolve isso em três etapas:

1. **Mapeamento de entidade:** tabelas `team_provider_mapping`, `league_provider_mapping`,
   `event_provider_mapping` associam o ID externo do provedor ao ID interno canônico do BetEdge. Um
   time/liga nova detectada (ID externo sem mapeamento) entra numa fila de revisão
   (`unmapped_entities`) em vez de criar duplicata silenciosa.
2. **Mapeamento de mercado:** um dicionário versionado traduz os nomes de mercado do provedor
   (`h2h`, `spreads`, `totals`, nomenclatura própria do SportsGameOdds) para o vocabulário interno
   (`1x2`, `over_under_2_5`, `btts`, `asian_handicap`, ...), incluindo tratamento de "handle" (linha)
   quando o mercado tem parâmetro contínuo (ex.: over/under 2.5 vs. 3.0).
3. **Normalização de formato de odd:** tudo é convertido e persistido em **odd decimal** internamente
   (formato mais simples para cálculo matemático); a conversão para fracionária/americana acontece
   só na camada de apresentação (frontend), respeitando a preferência do usuário (seção 2, Configurações).

A arquitetura já reserva o mesmo mapeamento para **The Odds API** como fonte secundária: a interface
`OddsProvider` (`fetchOdds(): NormalizedOdds[]`) é implementada por `SportsGameOddsProvider` (ativo) e
por `TheOddsApiProvider` (implementado, mas desligado por *feature flag* até ativação formal como
fallback), ambos convergindo para o mesmo schema normalizado antes de tocar o banco — trocar ou somar
fonte não exige mudança em nenhuma camada downstream (normalização, storage, Value Engine).

### 5.3. Estratégia de armazenamento append-only

`odds_history` **nunca sofre UPDATE ou DELETE** em operação normal. Cada leitura de odds vira uma nova
linha:

```sql
odds_history (
  id              bigserial primary key,
  event_id        uuid not null references events(id),
  bookmaker       text not null,
  market          text not null,
  outcome         text not null,        -- 'home' | 'draw' | 'away' | 'over' | 'under' ...
  line            numeric,               -- parâmetro do mercado, quando aplicável (ex.: 2.5)
  odd_decimal     numeric not null,
  captured_at     timestamptz not null default now(),
  source          text not null          -- 'sportsgameodds' | 'theoddsapi'
)
```

Índice composto em `(event_id, market, bookmaker, captured_at)` sustenta tanto a leitura do "valor
atual" (último `captured_at` por chave) quanto a série temporal completa usada em Line Movement. O
"snapshot atual" é uma **view materializada** (`odds_current`, refrescada a cada nova escrita relevante
ou por job leve) para não forçar toda leitura de "odd de agora" a fazer `DISTINCT ON` numa tabela que
cresce indefinidamente.

Motivo da escolha (detalhado também na seção 13): a mesma tabela serve, sem transformação, tanto o
Line Movement (a query já É a série temporal) quanto a auditoria retroativa (reproduzir exatamente
que odd existia no instante em que uma predição foi feita, essencial para o Value Engine e para medir
CLV — *closing line value* — na seção Performance).

### 5.4. Agendamento (cron jobs de polling)

Frequência de polling é **dinâmica em função da proximidade do kickoff**, para equilibrar
atualidade da odd contra custo de chamadas ao provedor e carga no banco:

| Janela até o kickoff | Frequência de poll |
|---|---|
| > 48h | a cada 6h |
| 6h – 48h | a cada 1h |
| 1h – 6h | a cada 15min |
| < 1h | a cada 2–5min |

Implementado como um job repetível do BullMQ (`odds:scheduler`) que roda a cada minuto, consulta quais
eventos entram em qual janela, e enfileira jobs individuais `odds:poll:{eventId}` com a granularidade
correta — em vez de um único poll monolítico "buscar tudo", o que permite retry e observabilidade por
evento.

### 5.5. Tratamento de erro e retry

- **Retry com backoff exponencial + jitter** no worker (`bullmq` `attempts` + `backoff: exponential`),
  padrão 5 tentativas, para falhas transitórias de rede/rate-limit do provedor.
- **Circuit breaker** por provedor: após N falhas consecutivas, o provedor é marcado "degradado" por
  um período (Redis, chave com TTL); novas tentativas de poll são suspensas e, se o fallback (The Odds
  API) estiver habilitado, o scheduler passa a usá-lo temporariamente.
- **Dead-letter queue:** jobs que esgotam as tentativas vão para uma fila `odds:poll:failed`,
  monitorada (seção 11) e revisável manualmente — nunca falham silenciosamente.
- **Validação de schema na resposta do provedor** (Zod no worker Node) antes de normalizar: uma
  resposta malformada é rejeitada e logada com o payload bruto anexado, em vez de gerar dado
  corrompido no banco.
- **Idempotência:** cada job de poll carrega um `idempotencyKey` (event+bookmaker+janela de tempo)
  para que um retry acidental não gere duas linhas para a mesma leitura de odd.

---

## 6. Value Engine

O Value Engine é a peça que transforma "modelo prevê X%" + "mercado oferece odd Y" em uma
**oportunidade classificada e pontuada**. Roda dentro do `services/engine` (não no BFF), pois depende
diretamente do output do pipeline de predição.

### 6.1. Fluxo de cálculo

```
odd de mercado (decimal, já sem margem própria removida)
        │
        ▼
① probabilidade implícita = 1 / odd
        │  (por outcome; somada aos demais outcomes do mesmo mercado dá o overround/margem da casa)
        ▼
② remoção de overround → probabilidade implícita "limpa"
        (método padrão: normalização proporcional — cada implícita dividida pela soma de todas;
         método alternativo disponível: Shin's method, para mercados com overround muito assimétrico)
        ▼
③ probabilidade "fair" (do Value Engine) = saída do ensemble de modelos (seção 4.4)
        ▼
④ edge = probabilidade_fair − probabilidade_implícita_limpa
        ▼
⑤ EV (valor esperado) por unidade apostada:
        EV = (probabilidade_fair × (odd_mercado − 1)) − (1 − probabilidade_fair)
        │    → EV > 0 significa que, no longo prazo e se o modelo estiver calibrado, a aposta é +EV
        ▼
⑥ Edge Score (0–100) — ver 6.2
        ▼
⑦ classificação de oportunidade — ver 6.3
```

### 6.2. Fórmula do Edge Score (0–100)

O Edge Score é um **índice proprietário composto**, desenhado para não ser só "edge bruto", porque
edge sozinho pode ser artefato de amostra pequena ou de um único modelo destoante. Fórmula de
referência:

```
EdgeScore = 100 × clamp01(
      w1 × norm(edge)
    + w2 × confidence_factor
    + w3 × consensus_factor
    + w4 × liquidity_factor
    - w5 × volatility_penalty
)

onde:
  norm(edge)            = edge normalizado numa faixa razoável (ex.: edge de 0% → 0, edge de 15%+ → 1,
                           com saturação para não deixar edges "irreais" dominarem o score)
  confidence_factor      = função da incerteza do modelo líder (intervalo de confiança da predição;
                           menor variância entre janelas de walk-forward → maior confiança)
  consensus_factor        = grau de concordância entre os modelos do ensemble (seção 6.4) — 
                           todos os modelos apontando o mesmo lado do value aumenta o score,
                           divergência forte entre eles reduz
  liquidity_factor        = proxy de quão "líquido"/confiável é o mercado (nº de casas cotando o
                           mesmo mercado, estabilidade recente da odd)
  volatility_penalty      = penalidade quando a linha está se movendo muito rápido (odd instável = 
                           maior risco de que o "value" já não exista no momento da aposta)
  w1..w5                  = pesos calibrados por validação histórica (ver Model Lab), somando 1
                           antes da penalidade
```

O Edge Score não é uma probabilidade nem um EV — é um **ranking de confiabilidade da oportunidade**,
pensado para ordenar Top Picks e para servir de filtro no Value Finder. Os pesos `w1..w5` ficam
versionados junto ao Model Registry (não fixos em código), permitindo recalibração sem deploy.

### 6.3. Classificação de oportunidades

| Faixa de Edge Score | Rótulo | Uso na UI |
|---|---|---|
| 85–100 | **Elite** | Destaque máximo em Top Picks, elegível a alerta push por padrão |
| 70–84 | **Forte** | Aparece em Top Picks, badge de destaque |
| 50–69 | **Moderada** | Listada no Value Finder, sem destaque automático |
| 30–49 | **Marginal** | Só aparece com filtro explícito ("mostrar marginais") |
| < 30 ou EV ≤ 0 | **Sem valor** | Não listada como oportunidade (mas o dado de probabilidade/odd continua disponível na tela do jogo) |

A classificação é reavaliada a cada novo ciclo de odds (seção 5.4) e a cada nova predição — uma
oportunidade pode subir/descer de faixa conforme a linha se move ou o modelo é re-executado com dado
mais fresco, e essa transição é o que alimenta o Line Movement e os Alertas.

### 6.4. Mecanismo de consenso de modelos

O `ensemble.py` (seção 4.4) não faz apenas uma média simples. O consenso é medido e exposto como
sinal próprio:

- **Peso por modelo:** cada modelo do registry tem um peso no ensemble, calibrado pela performance
  walk-forward recente (modelos com melhor Brier score recente pesam mais — recalibração periódica,
  não estática).
- **Grau de concordância:** calcula-se a dispersão das probabilidades entre os modelos individuais
  para o mesmo outcome (ex.: desvio padrão entre Poisson, Elo, XGBoost e Market Consensus para "vitória
  do mandante"). Baixa dispersão = alta concordância = `consensus_factor` alto no Edge Score.
- **Modelo "árbitro" (Market Consensus):** por ser historicamente um preditor forte, grandes
  divergências do ensemble próprio em relação ao consenso de mercado são tratadas como sinal de
  atenção (não descartadas automaticamente, mas o `consensus_factor` reflete essa tensão), evitando
  que o produto superestime edges que na verdade refletem um modelo mal calibrado.
- Todo o detalhamento por modelo (probabilidade individual, peso, contribuição) fica disponível na
  tela **Model Lab**, para transparência e para o usuário avançado auditar de onde veio um Edge Score.

---

## 7. Cache e Performance

### 7.1. Camadas de cache Redis

| Camada | Conteúdo | TTL típico | Chave |
|---|---|---|---|
| **L1 — Snapshot de odds atuais** | Última leitura por evento/mercado/casa (espelha `odds_current`) | 30–60s | `odds:current:{eventId}:{market}` |
| **L2 — Predição corrente** | Última saída do pipeline de predição por evento | 2–5min | `pred:{eventId}` |
| **L3 — Oportunidades (Value Engine)** | Resultado já classificado, usado por Top Picks/Value Finder | 30–60s | `value:opps:{filtersHash}` |
| **L4 — Agregados de leitura pesada** | Top Picks do dia, tabela de campeonato, perfil estatístico de time | 1–15min | `agg:top-picks:{date}`, `agg:league:{leagueId}` |
| **L5 — Sessão/rate limit** | Contadores de rate limit, sessões de curta duração | segundos–minutos | `rl:{userId}:{route}` |
| **Streams (não cache, mas Redis)** | Backlog recente de eventos para replay de SSE | alguns minutos (`XTRIM`) | `stream:events` |

### 7.2. Estratégia de invalidação

- **Invalidação orientada a evento**, não só TTL: quando um worker grava nova odd (`odds_history`),
  ele publica em `stream:events` **e** ativamente deleta/atualiza as chaves L1/L3 afetadas
  (`odds:current:{eventId}:*`, `value:opps:*` relacionados) — o TTL curto é uma rede de segurança, não
  o mecanismo primário.
- **Invalidação em cascata controlada:** uma nova predição (L2) invalida L3 (oportunidades derivadas
  dela), que por sua vez pode invalidar L4 (Top Picks). Implementado como uma função
  `invalidate(eventId)` central no `services/engine`/worker, evitando invalidação espalhada e
  inconsistente pelo código.
- **`stale-while-revalidate`** nas rotas do BFF cacheadas: serve o valor expirado imediatamente e
  dispara revalidação em background, mantendo p95 de latência baixo mesmo em cache miss.

### 7.3. Otimização de consultas ao banco

- **Índices compostos** alinhados aos padrões de acesso reais (`odds_history(event_id, market,
  bookmaker, captured_at desc)`, `predictions(event_id, model_id, created_at desc)`).
- **View materializada `odds_current`** (7.1) evita `DISTINCT ON`/`window function` cara em toda
  leitura de "odd de agora".
- **Paginação por keyset** (não `OFFSET`) nas listagens grandes (Odds Scanner, histórico de Line
  Movement), para performance estável independente da profundidade da página.
- **Particionamento por data** (partição mensal) planejado para `odds_history` e `predictions` assim
  que o volume justificar — a estrutura append-only já é compatível com particionamento nativo do
  Postgres sem mudança de schema lógico.
- **Connection pooling** via `Supavisor`/PgBouncer (built-in do Supabase) para lidar com o número de
  conexões simultâneas de BFF + Engine + Workers sem esgotar conexões diretas do Postgres.

### 7.4. CDN e assets estáticos

- Deploy do frontend na **Vercel**, que já serve assets estáticos (`_next/static`, imagens, fontes)
  via CDN global com cache imutável (hash no nome do arquivo).
- Imagens de escudo de time/liga servidas via `next/image` com otimização automática (redimensionamento,
  formato moderno) e cache de borda.
- Gráficos (Recharts) são renderizados client-side — não há custo de CDN neles além do bundle JS, que
  é code-split por rota (App Router já faz isso por padrão) para não pesar o carregamento inicial do
  Dashboard com o código de páginas menos acessadas (Model Lab, por exemplo).

---

## 8. Background Jobs

### 8.1. Workers Node.js (BullMQ)

Rodam em `services/workers/node`, conectados ao mesmo Redis usado para cache/pub-sub (filas isoladas
por prefixo de nome para não colidir com chaves de cache).

| Fila | Responsabilidade | Gatilho |
|---|---|---|
| `odds:scheduler` | Decide quais eventos precisam de novo poll (seção 5.4) e enfileira `odds:poll:*` | Repetível, a cada 1min |
| `odds:poll:{eventId}` | Busca odds no provedor, normaliza, grava append-only, publica invalidação | Enfileirado pelo scheduler |
| `alerts:evaluate` | Reavalia regras de alerta do usuário contra o estado atual de odds/Edge Score | Disparado por evento de nova odd/predição |
| `notifications:dispatch` | Envia notificação (e-mail/push) quando um alerta dispara | Enfileirado por `alerts:evaluate` |
| `cache:warm` | Pré-aquece L4 (Top Picks, agregados de liga) fora do caminho de requisição do usuário | Cron, a cada poucos minutos |

Cada fila tem **concorrência configurada por tipo de job** (I/O-bound como `odds:poll` roda com
concorrência mais alta; jobs que escrevem em cascata no banco, mais conservadora), **retries com
backoff** (seção 5.5) e é monitorada via **Bull Board** (painel web read-only, protegido por auth,
montado como rota interna) mostrando filas ativas, falhas e atraso.

### 8.2. Workers Python (Celery)

Rodam em `services/workers/python`, broker Redis (fila separada por nome das do BullMQ), backend de
resultado em Postgres.

| Tarefa | Responsabilidade | Agendamento |
|---|---|---|
| `train_model` | Re-treina um modelo do registry com dado mais recente, registra nova versão em `staging` | Cron semanal/quinzenal por tipo de modelo (configurável) |
| `run_backtest` | Executa validação walk-forward completa (seção 4.7) sobre um modelo/período, grava métricas | Disparado manualmente (Model Lab) ou após todo `train_model` |
| `compute_features_batch` | Recalcula o snapshot de features batch (seção 4.3) para todos os times/ligas ativos | Cron diário, após atualização de resultados de jogos |
| `recompute_clv` | Recalcula *Closing Line Value* das recomendações passadas comparando odd no momento da recomendação vs. odd de fechamento | Cron diário |
| `cleanup_old_snapshots` | Arquiva/compacta snapshots de features muito antigos que não são mais referenciados por auditoria ativa | Cron mensal |

`train_model` e `run_backtest` são as tarefas mais pesadas (CPU/memória) — rodam com fila dedicada e
concorrência baixa (1–2 workers), possivelmente em máquina com mais recursos que os workers Node,
justamente por isso serem isoladas em serviço próprio (ver decisão na seção 13.2).

### 8.3. Agendamento e monitoramento de jobs

- **Agendamento:** repeatable jobs do BullMQ para a parte Node; **Celery Beat** para a parte Python —
  cada stack usa o scheduler nativo do seu próprio ecossistema em vez de um orquestrador externo
  genérico, mantendo a operação de cada serviço autocontida.
- **Monitoramento:** Bull Board (Node) e Flower (Celery) expostos como rotas internas autenticadas;
  métricas-chave (tamanho de fila, taxa de falha, tempo de job) exportadas também para o stack de
  observabilidade (seção 11) para alertar quando uma fila cresce além do normal (indício de provedor
  fora do ar ou worker travado).
- **Alertas operacionais** (diferentes dos alertas de produto do usuário): time de engenharia é
  notificado (Slack/e-mail via job de sistema) quando a dead-letter queue de odds cresce, quando um
  `train_model` falha, ou quando a fila de `odds:poll` acumula atraso acima de um limiar.

---

## 9. Integração com Claude API

### 9.1. Guardrails estritos

Esta é a regra mais importante de todo o produto e está refletida em código, não só em prompt:

> **O Claude nunca recebe a tarefa de "prever" nada.** Ele recebe um payload estruturado, já
> **completo**, com todos os números finais (probabilidades, odds, edge, EV, Edge Score, features
> relevantes) calculados pelo Motor Estatístico, e sua única função é **redigir texto explicativo**
> sobre esses números — nunca gerar, ajustar ou "arredondar por intuição" nenhum valor numérico.

Mecanismos que tornam isso estrutural, não apenas uma instrução de prompt:

1. **Separação de serviço:** a chamada ao Claude vive inteiramente no BFF (`app/api/ai-analyst/**`) e
   **não tem acesso de rede** ao Motor Estatístico nem ao banco além do payload que o próprio BFF já
   buscou e passou. O Claude não tem uma "tool" para consultar odds ou rodar modelo — arquiteturalmente
   impossível dele fazer essa chamada.
2. **Schema de saída estruturado:** a resposta do Claude é solicitada em JSON com um schema fixo
   (`{ resumo, fatores_a_favor[], fatores_contra[], observacao_de_risco }`) — **nenhum campo numérico**
   faz parte desse schema. Qualquer número que o texto cite deve ser um dos números que já vieram no
   input (o prompt instrui explicitamente a só citar os valores fornecidos, nunca calcular novos).
3. **Validação pós-resposta:** antes de exibir ao usuário, o texto retornado passa por uma checagem
   simples (regex/parse) que sinaliza se aparecem números que não constam no payload de entrada
   (ex.: uma probabilidade "% " que não bate com nenhum valor fornecido); ocorrências disparam log de
   auditoria para revisão — o texto ainda pode ser exibido com uma nota, mas o caso é investigado.
4. **Persistência do payload de entrada junto com a resposta:** toda chamada grava
   `{input_payload, output_text, model, timestamp}` em `ai_analysis_log`, permitindo auditoria completa
   de que número foi mostrado ao Claude e o que ele escreveu a partir disso.

### 9.2. Templates de prompt para análise de partida

Prompt de sistema (resumido) fixa o papel e os limites:

```
Você é um redator de análises esportivas do BetEdge. Você recebe dados JÁ CALCULADOS sobre uma
partida (probabilidades, odds, edge, Edge Score, features). Sua tarefa é exclusivamente explicar
em português, de forma clara e objetiva, o que esses números significam.

Regras rígidas:
- NUNCA gere, estime, ajuste ou infira um número que não esteja explicitamente no payload de entrada.
- Se quiser citar um número, cite exatamente o valor fornecido, sem arredondar de forma diferente do
  já formatado.
- Não faça previsão própria nem opine sobre o resultado além do que os dados fornecidos sustentam.
- Responda estritamente no schema JSON solicitado.
```

O prompt de usuário injeta o payload estruturado (probabilidades do ensemble, odd de mercado, edge,
EV, Edge Score, top features contribuintes, forma recente dos times, resultado do confronto direto) —
tudo já formatado como o motor calculou, sem texto livre nem opinião prévia. Templates ficam
versionados em `apps/web/src/lib/ai/prompts/` (não hardcoded inline na Route Handler), permitindo
ajuste de tom/formato sem tocar em lógica de negócio.

### 9.3. Rate limiting e controle de custo

- **Limite por usuário/plano:** número de análises Claude geradas por dia é limitado por plano
  (ex.: plano free = poucas análises/dia; plano pro = mais ou ilimitado dentro de um teto operacional).
- **Cache de resposta:** a análise de um evento é cacheada (Redis, TTL de minutos a poucas horas,
  invalidada se o payload de entrada mudar de forma relevante — ex.: Edge Score mudou de faixa) — o
  mesmo evento pedido por múltiplos usuários no mesmo período reaproveita a mesma chamada.
- **Modelo dimensionado ao caso de uso:** por ser geração de texto curto e estruturado (não raciocínio
  aberto), o serviço usa um modelo da família Claude adequado a custo/latência para essa tarefa,
  reservando modelo mais robusto apenas se a qualidade textual justificar — decisão revisada
  periodicamente contra métricas de satisfação/qualidade percebida.
- **Orçamento diário monitorado:** contador agregado de tokens/custo por dia (Redis + log persistente),
  com alerta operacional se a projeção do dia ultrapassar o teto definido — proteção contra loop de
  chamada indevida ou pico anômalo de uso.

### 9.4. Input/output estruturado

Contrato de entrada (`AiAnalystInput`, também em `packages/types` para consistência com o frontend):

```ts
type AiAnalystInput = {
  event: { home: string; away: string; league: string; kickoff: string };
  market: string;                          // ex.: "1x2"
  modelProbabilities: { outcome: string; probability: number }[];
  marketOdds: { outcome: string; odd: number; bookmaker: string }[];
  edge: number;
  ev: number;
  edgeScore: number;
  topFeatures: { name: string; value: number; contribution: number }[];
  recentForm: { team: string; last5: string }[]; // ex.: "W-W-D-L-W"
  headToHead: { date: string; result: string }[];
};

type AiAnalystOutput = {
  resumo: string;
  fatoresAFavor: string[];
  fatoresContra: string[];
  observacaoDeRisco: string;
  geradoEm: string;
  modeloClaudeUsado: string;
};
```

---

## 10. Segurança

### 10.1. Autenticação e autorização

- **Autenticação:** Supabase Auth (e-mail/senha + OAuth Google), tokens JWT curtos com refresh
  automático, cookies HTTP-only (`secure`, `sameSite=lax`) — token nunca exposto a JavaScript no
  browser.
- **Autorização:** **Row Level Security (RLS)** no Postgres é a linha de defesa primária para dados
  por usuário (favoritos, alertas, configurações, histórico pessoal de performance): policies
  garantem que `auth.uid() = user_id` em toda tabela com dado pessoal, independentemente de qualquer
  bug de autorização em código de aplicação.
- Dados **não pessoais** (odds, predições, features) são de leitura pública para qualquer usuário
  autenticado (o produto vende acesso à análise, não segrega dado de mercado por usuário), mas escrita
  nessas tabelas é restrita a **service role**, nunca ao client anônimo/usuário.
- Rotas administrativas exigem checagem explícita de `role = admin` além do RLS (defesa em
  profundidade — seção 3.1).

### 10.2. Gestão de chaves de API para serviços externos

- Chaves de provedores externos (SportsGameOdds, The Odds API, Claude API) vivem **exclusivamente**
  como variáveis de ambiente dos serviços que as usam (workers Node para provedores de odds, BFF para
  Claude) — **nunca** chegam ao bundle do frontend nem a qualquer resposta de API pública.
- Cofre de segredos gerenciado pela plataforma de deploy (Vercel Environment Variables, e equivalente
  no serviço de container escolhido para engine/workers — Railway/Fly.io *secrets*), sem segredo em
  texto plano no repositório; `.env.example` documenta as chaves esperadas sem valores reais.
- Rotação de chave planejada (não automática ainda): chaves críticas (Claude, provedor de odds
  principal) têm processo documentado de rotação, e o design de configuração (uma chave por variável
  de ambiente, sem hardcode) já suporta troca sem deploy de código.
- Webhook do provedor de odds (se usado, seção 3.2) valida assinatura/segredo compartilhado antes de
  processar qualquer payload recebido.

### 10.3. Rate limiting

Detalhado na seção 3.3 (BFF) — reforçado aqui como controle de segurança, não só de performance:
protege contra scraping do produto (extração maciça de Top Picks/Value Finder por terceiros),
brute-force de login, e abuso de custo (chamadas à Claude API e ao provedor de odds pago).

### 10.4. Validação de entrada

- **Zod** em toda fronteira de entrada no lado Node (Route Handlers do BFF, payloads recebidos por
  workers) — nada é confiado sem schema.
- **Pydantic** cumpre o mesmo papel no lado Python (FastAPI valida automaticamente por contrato de
  endpoint; Celery tasks validam payload de entrada explicitamente antes de processar).
- Nenhuma query SQL é montada por concatenação de string — SQLAlchemy (Python) e o client do Supabase/
  query builder (Node) parametrizam tudo, eliminando a classe de vulnerabilidade de SQL injection por
  padrão de uso.
- Sanitização de saída de texto livre (ex.: nome de time vindo de provedor externo) antes de qualquer
  renderização, e o texto gerado pelo Claude (seção 9) é tratado como conteúdo não confiável para fins
  de renderização (nunca `dangerouslySetInnerHTML` direto — renderizado como texto/Markdown sanitizado).

---

## 11. Observabilidade

### 11.1. Estratégia de logging

- **Log estruturado (JSON)** em todos os serviços — frontend/BFF (Next.js), engine (FastAPI, via
  `structlog` ou equivalente), workers Node e Python — com campos padronizados
  (`timestamp, service, level, requestId/jobId, userId?, message, context`).
- **`requestId`/`traceId` propagado** de ponta a ponta: gerado no BFF na entrada da requisição,
  repassado como header ao chamar o Motor Estatístico, e usado em toda linha de log relacionada àquela
  requisição — permite reconstruir o caminho completo de uma chamada problemática entre serviços.
- Logs de jobs de background incluem `jobId`, fila, tentativa (`attempt`) e duração — essenciais para
  diagnosticar retries e dead-letter (seção 5.5/8).

### 11.2. Rastreamento de erros

- Client de rastreamento de erros (ex.: Sentry) integrado no frontend (erros de render/hidratação,
  falhas de fetch não tratadas), no BFF (exceções não capturadas em Route Handlers) e no Motor
  Estatístico (exceções em pipeline de predição/feature) — cada evento carrega o `traceId` para
  correlação cruzada com os logs estruturados.
- Erros de negócio esperados (ex.: 400 de validação) são **diferenciados** de erros inesperados
  (500) na taxonomia de rastreamento, para que o alerta operacional não vire ruído.

### 11.3. Monitoramento de performance

- **APM/latência** por rota do BFF e por endpoint do Motor Estatístico (p50/p95/p99), com atenção
  especial às rotas no caminho crítico de UX (Top Picks, Odds Scanner, SSE de eventos).
- **Métricas de fila** (BullMQ/Celery): profundidade, taxa de processamento, taxa de falha, tempo médio
  de job — expostas via painel (Bull Board/Flower) e também enviadas ao stack de métricas para alerta.
- **Métricas de banco:** tempo de query lenta (via `pg_stat_statements`, acessível pelo painel do
  Supabase), tamanho de tabela (acompanhamento do crescimento de `odds_history`/`predictions`,
  relevante para a decisão de particionamento — seção 7.3).
- **Métricas de cache:** hit rate por camada Redis (seção 7.1) — hit rate caindo é sinal de
  invalidação excessiva ou TTL mal calibrado.

### 11.4. Dashboards de performance de modelo

Distintos de métricas de infraestrutura — são métricas de **qualidade estatística**, alimentando
diretamente a tela **Model Lab** e um painel interno equivalente para o time de dados:

- **Calibração:** gráfico de calibração (probabilidade prevista vs. frequência observada), por modelo
  e por versão, atualizado conforme resultados reais de jogos entram no sistema.
- **Brier score e log loss** ao longo do tempo, por modelo, comparados contra o baseline de mercado
  (`market_consensus`) — o modelo só é considerado agregando valor real se supera esse baseline de
  forma consistente nas janelas walk-forward.
- **ROI/hit-rate simulado** das recomendações de cada modelo (aplicando a mesma classificação de
  oportunidade da seção 6.3 retroativamente), separado do ROI real do usuário (seção Performance, que
  reflete escolhas efetivas do usuário, não só o que o modelo teria sugerido).
- **CLV (Closing Line Value):** para toda recomendação emitida, compara a odd no momento da
  recomendação com a odd de fechamento do mercado — métrica padrão da indústria para saber se o
  "value" identificado era real e sustentado, independente de o resultado do jogo em si ter batido.
- Esses dashboards são recalculados pelos jobs `run_backtest`/`recompute_clv` (seção 8.2) e servidos ao
  frontend via `/v1/models/{id}/performance` (seção 4.1) — nunca calculados ad-hoc na renderização da
  página, para garantir que o número exibido é sempre o mesmo processo auditável de cálculo.

---

## 12. Deploy e Infraestrutura

### 12.1. Docker Compose para desenvolvimento local

`docker/docker-compose.dev.yml` sobe o ambiente completo localmente, para que qualquer desenvolvedor
tenha paridade com produção sem depender de serviços externos pagos durante o dia a dia:

```yaml
services:
  postgres:        # Postgres local (espelha Supabase para dev; migrations via supabase CLI)
  redis:           # Redis local (cache, filas, pub/sub)
  engine:          # FastAPI, build a partir de services/engine/Dockerfile, hot-reload em dev
  worker-node:     # BullMQ workers, hot-reload via ts-node-dev/tsx watch
  worker-python:   # Celery worker, hot-reload via watchdog/celery --autoreload equivalente
  flower:          # painel de monitoramento do Celery (dev/staging apenas)
  # apps/web roda via `pnpm dev` fora do compose (melhor DX do Next.js local),
  # apontando para os serviços acima via .env.local
```

`docker-compose.yml` (base) define os serviços "de produção-like" (imagens buildadas, sem
bind-mount de código, sem hot-reload) — usado para testar build final localmente e como referência
para o deploy em container fora da Vercel. `docker-compose.dev.yml` estende a base com bind-mounts,
hot-reload e serviços auxiliares de debug (Flower, Bull Board).

### 12.2. Opções de deploy em produção

| Componente | Plataforma | Motivo |
|---|---|---|
| `apps/web` (Next.js, frontend + BFF) | **Vercel** | Integração nativa com Next.js (RSC, streaming, edge functions), CDN global, preview deploy por PR |
| `services/engine` (FastAPI) | **Railway** ou **Fly.io** | Serviço Python de longa duração, precisa de container persistente (não serverless-friendly pelo custo de cold start de libs como XGBoost/sklearn) |
| `services/workers/node` (BullMQ) | **Railway** ou **Fly.io** | Processo de longa duração (worker), não é request/response — não cabe no modelo serverless da Vercel |
| `services/workers/python` (Celery) | **Railway** ou **Fly.io** | Mesma razão do worker Node; pode escalar independentemente para picos de treino/backtest |
| Postgres + Auth + Storage | **Supabase (managed)** | Ver decisão detalhada na seção 13.6 |
| Redis | **Upstash** (serverless-friendly) ou Redis gerenciado na mesma plataforma dos workers | Latência baixa a partir de Vercel edge e dos workers; modelo de cobrança por uso adequado ao tráfego variável de cache |

A escolha entre Railway e Fly.io é deliberadamente mantida **não travada** — ambos suportam deploy via
Dockerfile (já presente em cada serviço), o que torna a migração entre eles uma mudança de
configuração de infraestrutura, não de código.

### 12.3. Pipeline de CI/CD

```
Push / PR
   │
   ▼
GitHub Actions
   ├─ turbo run lint typecheck test --filter=[affected]   ← só roda no que mudou (cache Turborepo)
   ├─ testes Python (pytest) para services/engine e workers/python
   ├─ build de cada app/serviço afetado
   └─ (em PR) preview deploy automático:
         apps/web        → Vercel Preview Deployment
         services/*      → ambiente de preview no provedor de container (quando suportado) ou
                            build-only (validação de imagem) se preview dinâmico não estiver configurado
   │
   ▼ (merge em main)
Deploy de produção
   ├─ apps/web            → Vercel produção (automático no merge)
   ├─ services/engine     → build + push de imagem, deploy no Railway/Fly.io
   ├─ services/workers/*  → idem
   └─ supabase/migrations → aplicadas via `supabase db push` (etapa controlada, não automática em
                             todo merge — requer aprovação explícita no pipeline para mudanças de schema)
```

Gate de qualidade obrigatório antes de merge: lint, typecheck, testes unitários (incluindo os testes
de prevenção de vazamento, seção 4.5) e testes de contrato entre BFF e Engine (o schema OpenAPI do
engine é validado contra os tipos gerados em `packages/types`, evitando dessincronia silenciosa).

### 12.4. Gestão de ambientes

- **`development`** (local, via Docker Compose + `pnpm dev`), **`preview`** (por PR, dados de teste/
  projeto Supabase de staging), **`production`**.
- `.env.example` na raiz documenta toda variável necessária, por serviço, sem valores reais:

```
# apps/web
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENGINE_API_URL=
ENGINE_API_KEY=
ANTHROPIC_API_KEY=
REDIS_URL=

# services/engine
DATABASE_URL=
REDIS_URL=
ENGINE_API_KEY=            # mesma chave validada pelo BFF ao chamar o engine

# services/workers/node
SPORTSGAMEODDS_API_KEY=
THEODDSAPI_API_KEY=        # presente mas não obrigatoriamente ativo (feature flag)
REDIS_URL=
DATABASE_URL=

# services/workers/python
DATABASE_URL=
REDIS_URL=
MODEL_ARTIFACT_STORAGE_URL=
```

- Projeto **Supabase separado por ambiente** (dev/staging/produção) — nunca dado de produção acessível
  a partir de preview deploy, e migrations são aplicadas na mesma sequência em todos os ambientes via
  o diretório versionado `supabase/migrations`.

---

## 13. Decisões Técnicas e Trade-offs

### 13.1. Por que monorepo com Turborepo

Frontend, BFF, motor estatístico e workers compartilham contratos de dados (o formato de uma
`Prediction`, de uma `Opportunity`, de um `AiAnalystInput`) que mudam junto conforme o produto evolui.
Um monorepo com Turborepo permite: (a) tipos TypeScript compartilhados sempre sincronizados entre
frontend e BFF (`packages/types`), (b) build incremental e cacheado — só reconstrói/testa o que
realmente mudou, essencial à medida que o número de serviços cresce, (c) um único PR pode alterar
contrato + consumidores atomicamente, em vez de coordenar releases entre repositórios separados.
Trade-off aceito: pipeline de CI um pouco mais complexo (precisa saber filtrar "o que foi afetado") e
todos os times trabalham no mesmo repositório — considerado aceitável no estágio atual do produto,
onde o acoplamento entre frontend/BFF/engine é alto o suficiente para que múltiplos repositórios
gerarem mais fricção (PRs coordenados, versionamento de contrato) do que benefício de isolamento.

### 13.2. Por que um serviço Python separado (não tudo em Node)

O ecossistema de ciência de dados relevante para o produto — Pandas, NumPy, Scikit-learn, XGBoost,
LightGBM, além de bibliotecas estatísticas para Poisson/Dixon-Coles — é **Python-nativo** e não tem
equivalente maduro em Node com o mesmo nível de performance, documentação e comunidade. Tentar
reimplementar ou usar bindings frágeis em Node introduziria risco técnico desnecessário na parte mais
sensível do produto (o cálculo em si). Isolar isso em `services/engine` também permite **escalar e
fazer deploy do motor estatístico independentemente** do frontend/BFF (cargas de trabalho muito
diferentes: BFF é I/O-bound e de baixa latência por requisição; treino/backtest é CPU-bound e pode
rodar minutos). Trade-off aceito: dois runtimes em produção (Node + Python), mais superfície de
operação — mitigado por contrato OpenAPI versionado e testes de contrato em CI (seção 12.3).

### 13.3. Por que o padrão BFF

O frontend precisa compor dados de múltiplas fontes (Supabase diretamente para dados de usuário via
RLS, Motor Estatístico para predições/value, Redis para estado em tempo real) em formatos otimizados
para cada tela. Expor o Motor Estatístico diretamente ao browser exigiria replicar autenticação,
autorização e rate limiting nele (duplicando lógica que já existe no lado Next.js) e acoplaria o
frontend ao formato de resposta "cru" do engine, dificultando evoluir um lado sem o outro. O BFF
concentra: autenticação de sessão, agregação/formatação para UI, cache de borda e rate limiting por
usuário — o Motor Estatístico permanece um serviço interno, mais simples de proteger (só aceita
chamadas do BFF com chave de serviço) e mais livre para evoluir seu próprio contrato interno sem
quebrar o browser do usuário final.

### 13.4. Por que append-only para `odds_history`

Já detalhado na seção 5.3 — reforçando o trade-off: armazenar cada leitura como linha nova custa mais
espaço em disco do que manter só "a odd atual" com UPDATE in-place, mas **compra três coisas
essenciais ao produto**: (1) Line Movement é uma leitura direta da tabela, sem precisar de tabela de
histórico separada e potencialmente dessincronizada; (2) reprodutibilidade exata — qualquer predição/
Edge Score passado pode ser auditado contra a odd que existia exatamente naquele instante; (3) cálculo
de CLV (seção 11.4), que depende de comparar a odd no momento da recomendação com a odd de fechamento,
ambas precisando existir como registros históricos imutáveis. O custo de espaço é mitigado por
particionamento por data (seção 7.3) e por arquivamento futuro de dados muito antigos.

### 13.5. Por que Redis (em vez de alternativas)

Redis cobre, com uma única peça de infraestrutura, três necessidades do produto que crescem juntas:
**cache de leitura** (seção 7), **fila de jobs** (BullMQ, seção 8.1) e **pub/sub para tempo real** (SSE,
seção 2.5). Alternativas como usar só Postgres para fila (`LISTEN/NOTIFY` + tabela de jobs) evitariam
uma peça de infra a mais, mas sacrificariam a performance de fila sob carga e a simplicidade de TTL
automático de cache que o Redis dá de graça. Memcached resolveria só a parte de cache, forçando uma
segunda peça de infra para fila/pub-sub de qualquer forma. Dado que BullMQ (ecossistema Node maduro
para fila) já exige Redis como dependência, consolidar cache e pub/sub na mesma instância é a escolha
de menor superfície operacional total.

### 13.6. Por que Supabase (em vez de Postgres "cru")

O produto precisa de Postgres relacional de qualquer forma (dado estruturado, relações fortes entre
evento/odd/predição/usuário). Supabase entrega, sobre um Postgres real e sem lock-in de dado
proprietário (é Postgres puro, exportável a qualquer momento): **Auth pronta** (evita construir e
manter fluxo de autenticação, reset de senha, OAuth do zero), **RLS como camada de autorização de
dado** (seção 10.1, reduz superfície de bug de autorização em código de aplicação), **Realtime**
(disponível como opção adicional/futura complementar ao SSE via Redis para casos onde faça sentido
assinar mudança de tabela diretamente), e um painel administrativo pronto para inspeção de dado em
desenvolvimento. Trade-off aceito: dependência de uma plataforma gerenciada (mitigada pelo fato de ser
Postgres padrão por baixo — migração para Postgres autogerenciado é uma mudança de infraestrutura, não
de schema ou de lógica de aplicação, se algum dia for necessária).

### 13.7. Por que SportsGameOdds como fonte primária

SportsGameOdds foi escolhido como provedor primário por cobertura de mercados e ligas relevantes ao
público-alvo do produto e por modelo de custo adequado ao estágio atual. A arquitetura, no entanto,
**nunca assume uma fonte única como verdade estrutural**: a interface `OddsProvider` (seção 5.2) e o
schema normalizado de odds são desenhados desde o início para múltiplas fontes, com **The Odds API já
implementada como fonte secundária** (código presente, ativação por feature flag), permitindo tanto
failover automático (circuit breaker, seção 5.5) quanto, no futuro, comparação de odds entre múltiplas
casas de fato provenientes de provedores diferentes (reforçando a própria tela Odds Comparison). Trocar
ou adicionar fonte primária no futuro é uma decisão de configuração/negócio, não uma reescrita de
arquitetura.

---

## 14. Diretório do Projeto (Estrutura Completa)

```
betedge/
├── apps/
│   └── web/                              # Next.js — frontend + BFF
│       ├── src/
│       │   ├── app/
│       │   │   ├── (auth)/
│       │   │   │   ├── login/page.tsx
│       │   │   │   ├── cadastro/page.tsx
│       │   │   │   └── recuperar-senha/page.tsx
│       │   │   ├── (app)/
│       │   │   │   ├── layout.tsx
│       │   │   │   ├── dashboard/page.tsx
│       │   │   │   ├── top-picks/page.tsx
│       │   │   │   ├── value-finder/page.tsx
│       │   │   │   ├── odds-scanner/page.tsx
│       │   │   │   ├── line-movement/
│       │   │   │   │   ├── page.tsx
│       │   │   │   │   └── [eventId]/page.tsx
│       │   │   │   ├── odds-comparison/[eventId]/page.tsx
│       │   │   │   ├── ai-analyst/[eventId]/page.tsx
│       │   │   │   ├── jogos/
│       │   │   │   │   ├── page.tsx
│       │   │   │   │   └── [eventId]/page.tsx
│       │   │   │   ├── campeonatos/
│       │   │   │   │   ├── page.tsx
│       │   │   │   │   └── [leagueId]/page.tsx
│       │   │   │   ├── estatisticas/
│       │   │   │   │   ├── times/[teamId]/page.tsx
│       │   │   │   │   └── jogadores/[playerId]/page.tsx
│       │   │   │   ├── model-lab/
│       │   │   │   │   ├── page.tsx
│       │   │   │   │   └── [modelId]/page.tsx
│       │   │   │   ├── performance/page.tsx
│       │   │   │   ├── favoritos/page.tsx
│       │   │   │   ├── alertas/page.tsx
│       │   │   │   └── configuracoes/page.tsx
│       │   │   ├── api/
│       │   │   │   ├── events/route.ts
│       │   │   │   ├── events/[eventId]/route.ts
│       │   │   │   ├── value-finder/route.ts
│       │   │   │   ├── top-picks/route.ts
│       │   │   │   ├── odds/scanner/route.ts
│       │   │   │   ├── odds/comparison/[eventId]/route.ts
│       │   │   │   ├── line-movement/[eventId]/route.ts
│       │   │   │   ├── ai-analyst/[eventId]/route.ts
│       │   │   │   ├── models/route.ts
│       │   │   │   ├── models/[modelId]/performance/route.ts
│       │   │   │   ├── performance/route.ts
│       │   │   │   ├── favorites/route.ts
│       │   │   │   ├── alerts/route.ts
│       │   │   │   ├── alerts/[alertId]/route.ts
│       │   │   │   ├── settings/route.ts
│       │   │   │   ├── stream/events/route.ts
│       │   │   │   └── webhooks/sportsgameodds/route.ts
│       │   │   ├── layout.tsx
│       │   │   └── globals.css
│       │   ├── components/
│       │   │   ├── ui/                   # shadcn/ui
│       │   │   ├── charts/
│       │   │   ├── odds/
│       │   │   ├── events/
│       │   │   └── layout/
│       │   ├── lib/
│       │   │   ├── supabase/             # clients (server/browser), helpers de sessão
│       │   │   ├── ai/prompts/           # templates de prompt do Claude (seção 9)
│       │   │   ├── rate-limit.ts
│       │   │   ├── cache.ts
│       │   │   ├── engine-client.ts      # client tipado para o Motor Estatístico
│       │   │   └── odds-format.ts        # decimal/fracionária/americana
│       │   ├── hooks/
│       │   │   ├── useRealtimeChannel.ts
│       │   │   ├── useValueFinder.ts
│       │   │   └── ...
│       │   ├── stores/                   # Zustand
│       │   ├── types/
│       │   └── styles/
│       ├── public/
│       ├── middleware.ts
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
├── services/
│   ├── engine/                            # Python FastAPI — Motor Estatístico
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── predictions.py
│   │   │   │   ├── value.py
│   │   │   │   ├── models.py
│   │   │   │   ├── backtest.py
│   │   │   │   └── health.py
│   │   │   ├── models/
│   │   │   │   ├── base.py
│   │   │   │   ├── poisson.py
│   │   │   │   ├── dixon_coles.py
│   │   │   │   ├── elo.py
│   │   │   │   ├── logistic.py
│   │   │   │   ├── gradient_boost.py
│   │   │   │   ├── xg_model.py
│   │   │   │   ├── market_consensus.py
│   │   │   │   └── ensemble.py
│   │   │   ├── features/
│   │   │   │   ├── batch.py
│   │   │   │   ├── on_demand.py
│   │   │   │   └── registry.py
│   │   │   ├── validation/
│   │   │   │   ├── walk_forward.py
│   │   │   │   └── cross_validation.py
│   │   │   ├── metrics/
│   │   │   │   ├── calibration.py
│   │   │   │   ├── brier.py
│   │   │   │   └── clv.py
│   │   │   └── core/
│   │   │       ├── config.py
│   │   │       ├── db.py
│   │   │       ├── logging.py
│   │   │       └── deps.py
│   │   ├── tests/
│   │   │   ├── test_no_leakage.py
│   │   │   ├── test_models/
│   │   │   └── test_value_engine.py
│   │   ├── requirements.txt
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   └── workers/
│       ├── node/                          # BullMQ
│       │   ├── src/
│       │   │   ├── queues/
│       │   │   │   ├── oddsScheduler.ts
│       │   │   │   ├── oddsPoll.ts
│       │   │   │   ├── alertsEvaluate.ts
│       │   │   │   ├── notificationsDispatch.ts
│       │   │   │   └── cacheWarm.ts
│       │   │   ├── providers/
│       │   │   │   ├── OddsProvider.ts             # interface
│       │   │   │   ├── SportsGameOddsProvider.ts
│       │   │   │   └── TheOddsApiProvider.ts
│       │   │   ├── normalize/
│       │   │   │   ├── mapEntities.ts
│       │   │   │   └── mapMarkets.ts
│       │   │   └── index.ts
│       │   ├── package.json
│       │   └── Dockerfile
│       └── python/                        # Celery
│           ├── tasks/
│           │   ├── train_model.py
│           │   ├── run_backtest.py
│           │   ├── compute_features_batch.py
│           │   ├── recompute_clv.py
│           │   └── cleanup_old_snapshots.py
│           ├── celery_app.py
│           ├── requirements.txt
│           └── Dockerfile
├── packages/
│   ├── types/                             # tipos TS compartilhados (gerados do OpenAPI do engine + manuais)
│   │   ├── src/
│   │   │   ├── events.ts
│   │   │   ├── predictions.ts
│   │   │   ├── value.ts
│   │   │   ├── ai-analyst.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── utils/                             # funções puras compartilhadas
│   │   ├── src/
│   │   │   ├── odds.ts                    # conversão decimal/fracionária/americana
│   │   │   ├── date.ts
│   │   │   └── format.ts
│   │   └── package.json
│   └── config/                            # eslint, tsconfig, tailwind base
│       ├── eslint-preset.js
│       ├── tsconfig.base.json
│       └── tailwind-preset.js
├── supabase/
│   ├── migrations/
│   ├── functions/                         # Edge Functions (ex.: webhook leve, tarefa pontual)
│   └── seed.sql
├── docker/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── Dockerfiles/                       # Dockerfiles auxiliares/compartilhados, se necessário
├── ARCHITECTURE.md
├── DATABASE.md
├── MODELING.md
├── ROADMAP.md
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
└── .env.example
```

### 14.1. Notas sobre a estrutura

- `packages/types` é o ponto de sincronização entre o contrato OpenAPI do `services/engine` e o
  TypeScript do frontend/BFF — um script (`pnpm generate:types`, rodado em CI e localmente) gera os
  tipos base a partir do schema OpenAPI exposto por `services/engine`; tipos que não vêm do engine
  (ex.: `AiAnalystOutput`, entidades só de UI) são mantidos manualmente ao lado.
- `DATABASE.md`, `MODELING.md` e `ROADMAP.md` (citados na raiz) são documentos complementares a este:
  `DATABASE.md` detalha o schema completo do Postgres (tabelas, colunas, índices, policies de RLS);
  `MODELING.md` detalha as formulações matemáticas de cada modelo estatístico (Poisson, Dixon-Coles,
  Elo, etc.) e do Value Engine com mais profundidade acadêmica do que este documento; `ROADMAP.md`
  organiza a evolução do produto por fase.
- Cada serviço com `Dockerfile` próprio é buildável e deployável isoladamente — nenhum serviço depende
  de outro estar no mesmo container ou máquina, condição necessária para a estratégia de deploy
  multi-plataforma descrita na seção 12.2.
