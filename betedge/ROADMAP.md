# BetEdge — Roadmap de Desenvolvimento

> Plataforma SaaS de inteligência estatística aplicada a apostas esportivas (foco inicial: futebol,
> mercado pré-jogo).

**Stack:** Next.js + TypeScript + Tailwind + shadcn/ui (frontend) · FastAPI + Python (motor
estatístico) · Supabase/PostgreSQL (banco) · Redis (cache/filas).

---

## Visão Geral

### Filosofia

**Construir certo é mais importante que construir rápido.** BetEdge lida com dinheiro (decisões de
aposta dos usuários) e com credibilidade estatística — um bug de integridade de dados ou um vazamento
temporal em um modelo (*data leakage*) não é um detalhe técnico, é a diferença entre um produto
confiável e um produto que engana o usuário sem querer. Por isso, a ordem de prioridade do projeto,
do mais para o menos importante, é:

1. **Arquitetura** — decisões estruturais (schema, contratos de API, separação de responsabilidades)
   custam caro para desfazer depois. Investir tempo aqui nas fases iniciais economiza retrabalho
   multiplicado nas fases seguintes.
2. **Integridade de dados** — odds, resultados e features usados por modelos precisam ser corretos,
   auditáveis e nunca sobrescritos silenciosamente. Histórico é *append-only* por padrão.
3. **Rastreabilidade** — toda predição, toda odd, todo cálculo de valor precisa ser reconstruível:
   qual versão do modelo gerou aquele número, com quais dados, em que momento.
4. **Testes** — cada fase só é considerada concluída com testes automatizados cobrindo o que foi
   entregue. Não há "vamos testar depois".
5. **Qualidade estatística** — modelos calibrados, validados com metodologia correta (walk-forward,
   sem vazamento temporal), antes de otimizar por sofisticação.
6. **Velocidade de desenvolvimento** — importa, mas nunca às custas dos itens acima.

### Princípios de execução

- **Cada fase entrega um incremento funcional e testável.** Ao final de qualquer fase, existe algo
  que roda de ponta a ponta (mesmo que pequeno), não apenas peças soltas.
- **Nenhuma fase depende de trabalho inacabado de uma fase futura.** Dependências são sempre
  "para trás": a Fase N pode assumir que tudo da Fase 0..N-1 está pronto e testado, nunca o contrário.
  Quando algo futuro precisa ser "preparado com antecedência" (ex.: arquitetura para uma segunda fonte
  de odds), isso é modelado como uma interface/placeholder na fase atual, não como uma dependência
  para frente.
- **Fases são sequenciais em intenção, mas algumas podem sobrepor na prática.** A ordem numerada é a
  ordem de *valor* e *risco* (fundação antes de features, dados antes de UI polida, modelos simples
  antes de ensemble). Times com mais de uma pessoa podem paralelizar fases adjacentes que não
  compartilham arquivos críticos (ex.: Fase 3 — UI — pode começar em paralelo com o fim da Fase 2 —
  Pipeline de Odds — desde que a Fase 3 consuma dados mockados/seed até a pipeline real estar pronta).
  Isso está marcado explicitamente em cada fase na seção "Pode sobrepor com".
- **Escopo futuro fica no backlog, não no código.** Recursos de fases futuras (ex.: xG, segunda fonte
  de odds, outros esportes) recebem uma interface pronta quando fizer sentido arquitetural, mas a
  implementação em si só entra quando a fase chegar.

### Definition of Done (DoD) — aplica-se a toda fase

Uma fase só é considerada **concluída** quando, simultaneamente:

- [ ] O entregável descrito roda de ponta a ponta em ambiente local (Docker Compose) e no ambiente
      de staging/preview.
- [ ] Os testes definidos para a fase existem, passam e rodam no CI (não apenas localmente).
- [ ] Não há regressão nos testes das fases anteriores (suíte completa verde).
- [ ] Migrations de banco (quando houver) têm `up` e `down` testados.
- [ ] Variáveis de ambiente novas estão documentadas em `.env.example`.
- [ ] Código novo tem tipagem completa (TypeScript sem `any` não justificado; Python com type hints +
      mypy/pyright limpo).
- [ ] Lint e format aplicados (`eslint`/`prettier` no frontend, `ruff`/`black` no backend Python).
- [ ] PR revisado (mesmo que autorrevisão em times pequenos) com checklist da fase anexado.
- [ ] Documentação mínima atualizada (README do pacote afetado + `CLAUDE.md` do projeto, se a fase
      alterar convenções de arquitetura).
- [ ] Nenhum dado sensível (chaves de API, credenciais) commitado — checagem automatizada no CI
      (`gitleaks` ou similar) passa.

### Linha do tempo resumida

| Fase | Nome | Semanas | Esforço estimado |
|---|---|---|---|
| 0 | Fundação e Infraestrutura | 1–2 | 1,5–2 semanas-pessoa |
| 1 | Modelo de Dados Core | 2–3 | 1–1,5 semanas-pessoa |
| 2 | Pipeline de Coleta de Odds | 3–5 | 2–2,5 semanas-pessoa |
| 3 | Interface Base e Navegação | 5–7 | 2 semanas-pessoa |
| 4 | Cálculos de Probabilidade e Mercado | 7–9 | 1,5–2 semanas-pessoa |
| 5 | Modelos Estatísticos v1 | 9–13 | 3,5–4 semanas-pessoa |
| 6 | Modelos Avançados e Ensemble | 13–17 | 3,5–4 semanas-pessoa |
| 7 | Value Engine Completo | 17–19 | 1,5–2 semanas-pessoa |
| 8 | Line Movement e Histórico | 19–21 | 1,5–2 semanas-pessoa |
| 9 | Performance e Métricas | 21–24 | 2,5–3 semanas-pessoa |
| 10 | IA Analyst (Claude API) | 24–26 | 1,5–2 semanas-pessoa |
| 11 | Alertas e Favoritos | 26–28 | 1,5–2 semanas-pessoa |
| 12 | Backtesting Avançado | 28–30 | 1,5–2 semanas-pessoa |
| 13 | Estatísticas e Dados de Times | 30–32 | 1,5–2 semanas-pessoa |
| 14 | Polimento e Produção | 32–36 | 3–4 semanas-pessoa |
| 15 | Expansão Futura | Backlog | — |

Estimativas assumem **1 desenvolvedor full-stack sênior** dedicado, com apoio pontual de
design/produto. Com 2 desenvolvedores trabalhando em paralelo em fases que permitem sobreposição
(ver "Pode sobrepor com" em cada fase), o cronograma total pode encurtar em ~25–30%.

---

## Fase 0 — Fundação e Infraestrutura (Semana 1–2)

**Objetivo:** ambiente de desenvolvimento reprodutível e esqueleto do projeto rodando, sem nenhuma
funcionalidade de negócio ainda.

**Pode sobrepor com:** nenhuma (é a base de tudo).

### Escopo

- **Monorepo com Turborepo**
  - Estrutura `apps/web` (Next.js), `apps/api` (FastAPI), `packages/ui` (componentes shadcn
    compartilhados), `packages/types` (tipos TS compartilhados), `packages/config` (eslint/tsconfig
    base).
  - `turbo.json` com pipelines de `build`, `dev`, `lint`, `test`, `type-check`.
- **Scaffold Next.js**
  - App Router, TypeScript estrito (`strict: true`), Tailwind CSS configurado, shadcn/ui instalado
    (`components.json`, tema base).
  - Estrutura de pastas inicial: `app/`, `components/`, `lib/`, `hooks/`, `types/`.
- **Scaffold FastAPI**
  - Estrutura de pacote Python (`src/betedge_api/`), Pydantic v2 para schemas, roteador básico
    (`/health`), configuração via `pydantic-settings`.
  - Gerenciador de dependências: `uv` ou `poetry` (escolher um e documentar por quê).
- **Docker Compose local**
  - Serviços: `postgres` (imagem oficial, ou `supabase/postgres` para paridade com Supabase),
    `redis`, `api` (FastAPI com reload), opcionalmente `web` (Next.js dev).
  - Volumes nomeados para persistência de dados locais entre restarts.
- **Projeto Supabase**
  - Criação do projeto (dev + staging, produção só na Fase 14).
  - Configuração de Auth (provedores: e-mail/senha no mínimo; OAuth Google como stretch).
  - Chaves de serviço/anon documentadas (nunca commitadas).
- **Infraestrutura de migrations**
  - Ferramenta: Supabase CLI (`supabase migration new`) para manter migrations versionadas em
    `supabase/migrations/`, aplicáveis tanto em Supabase gerenciado quanto em Postgres local puro.
  - Primeira migration: tabelas mínimas de fundação — `profiles` (perfil de usuário ligado a
    `auth.users`), e nada além disso ainda (o schema completo é a Fase 1).
- **CI/CD (GitHub Actions)**
  - Workflow `ci.yml`: em cada PR — `lint` (eslint + ruff), `type-check` (`tsc --noEmit` +
    `mypy`/`pyright`), `test` (unitários das duas stacks, mesmo que vazios/triviais nesta fase).
  - Cache de dependências (`node_modules`, `.venv`/`uv` cache) para builds rápidos.
  - Workflow separado `deploy-preview.yml` (Vercel para o front; Fly.io/Railway/Render para a API) —
    pode ficar como placeholder documentado se o provedor de deploy ainda não estiver decidido.
- **Gestão de variáveis de ambiente**
  - `.env.example` na raiz e em cada app, cobrindo: `DATABASE_URL`, `SUPABASE_URL`,
    `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `NEXT_PUBLIC_API_URL`.
  - Validação de env obrigatória no boot (Next.js via `@t3-oss/env-nextjs` ou similar; FastAPI via
    `pydantic-settings` com campos obrigatórios).
- **Autenticação básica**
  - Login, registro e sessão via Supabase Auth no frontend (`@supabase/ssr`).
  - Middleware do Next.js protegendo rotas autenticadas.
  - Endpoint de exemplo na API validando o JWT do Supabase (prova de que backend e frontend
    compartilham a mesma fonte de identidade).
- **Documentação do projeto**
  - `CLAUDE.md` (ou `AGENTS.md`) na raiz do repositório `betedge`, no mesmo espírito do usado no
    projeto KM Check: visão geral, arquitetura, convenções, fluxo de deploy — para orientar tanto
    humanos quanto agentes de IA que trabalharem no código depois.
  - `README.md` com instruções de setup local (`docker compose up`, comandos de dev).

### Entregável

Aplicação vazia rodando localmente via `docker compose up` (Postgres + Redis + API), com Next.js
conectado ao Supabase, fluxo de login/registro funcionando, e pipeline de CI verde no GitHub.

### Testes

- Fluxo de auth: registro cria usuário, login retorna sessão válida, rota protegida rejeita usuário
  não autenticado (teste E2E mínimo com Playwright, ou teste de integração direto contra a API do
  Supabase Auth).
- Conexão com banco verificada: teste de integração que sobe o Postgres do Docker Compose e roda a
  migration inicial com sucesso.
- Pipeline de CI roda todos os steps (lint, type-check, test) e falha corretamente quando um deles é
  quebrado propositalmente (teste de sanidade do próprio CI).

### Riscos específicos da fase

- Escolher provedor de deploy tarde demais pode atrasar a Fase 14 — decidir ao menos a *direção*
  (Vercel + Fly.io/Railway, por exemplo) já nesta fase, mesmo sem configurar produção.

---

## Fase 1 — Modelo de Dados Core (Semana 2–3)

**Objetivo:** schema completo do banco de dados, populado com dados de referência (seed), e tipagem
TypeScript gerada automaticamente a partir dele.

**Pode sobrepor com:** parte final da Fase 0 (CI/infra), início da Fase 2 (definição de contratos de
API pode começar em paralelo).

### Escopo

- **Migrations completas — ~22 tabelas.** Organizar em domínios claros dentro de
  `supabase/migrations/`, cada migration com nome descritivo e numerado. Domínios sugeridos:
  - **Catálogo:** `sports`, `leagues`, `seasons`, `teams`, `venues`.
  - **Eventos:** `events` (partidas), `event_results`.
  - **Mercado:** `bookmakers` (com campo de indicação de autorização SPA — Secretaria de Prêmios e
    Apostas — no Brasil), `market_types`, `market_selections`.
  - **Odds:** `odds_snapshot_current` (última odd conhecida por bookmaker×evento×mercado×seleção,
    mutável) e `odds_history` (série temporal append-only, particionada — ver abaixo).
  - **Modelos:** `model_registry` (versão, hiperparâmetros, metadata), `model_predictions`
    (append-only, referencia `model_registry`), `model_performance_snapshots`.
  - **Valor:** `value_opportunities` (materialização periódica do cálculo de edge/EV — a lógica de
    cálculo em si é da Fase 4/7, aqui só a tabela).
  - **Usuário:** `profiles`, `user_favorites`, `user_alerts`, `alert_triggers_log`.
  - **Auditoria:** `data_quality_flags`, `ingestion_runs` (log de execuções da pipeline de coleta).
  - Ajustar a lista exata durante a modelagem — 22 é uma estimativa de referência do domínio descrito
    nas fases seguintes; o que importa é que cada entidade citada no roadmap tenha uma tabela clara.
- **Políticas RLS (Row Level Security)**
  - Tabelas de catálogo/mercado/modelo: leitura pública (ou por assinatura, dependendo do plano —
    placeholder de coluna `requires_plan` desde já, mesmo que billing só chegue na Fase 14).
  - Tabelas de usuário (`user_favorites`, `user_alerts`): RLS restrita ao `auth.uid()` do próprio
    usuário.
  - Tabelas de sistema (`ingestion_runs`, `model_registry`): sem acesso público, apenas
    `service_role`.
- **Seed data**
  - `sports`: pelo menos futebol (`soccer`) como registro inicial, estrutura pronta para outros
    esportes (Fase 15).
  - `leagues`: principais campeonatos-alvo do MVP (definir lista com o time de produto — sugestão:
    Brasileirão Série A/B, principais ligas europeias, Libertadores).
  - `bookmakers`: casas de apostas relevantes ao mercado brasileiro, com campo booleano/enum de
    situação junto à SPA e link para a fonte da informação (auditável, não hardcoded sem origem).
  - `market_types`: 1X2 (moneyline 3-way), Over/Under (linhas comuns), Ambas Marcam (BTTS),
    Hándicap Asiático — o mínimo para as fases de valor fazerem sentido.
- **Funções e triggers utilitários**
  - Trigger de `updated_at` automático nas tabelas mutáveis.
  - Função de validação que impede `UPDATE`/`DELETE` em tabelas append-only (`odds_history`,
    `model_predictions`) — só `INSERT` é permitido, reforçando a garantia de integridade/auditoria a
    nível de banco, não só de aplicação.
  - Função de cálculo de idade de snapshot (`is_stale(updated_at, threshold_minutes)`) usada depois
    pela UI para marcar odds desatualizadas.
- **Tipos TypeScript gerados**
  - `supabase gen types typescript` integrado ao script de build/dev (`packages/types`), nunca escrito
    à mão para as tabelas do banco.
- **Rotas CRUD básicas**
  - Endpoints mínimos na API FastAPI para as entidades de catálogo (leitura) — prova de que a API
    consegue ler o schema tipado. CRUD completo só onde fizer sentido (ex.: `user_favorites` só chega
    na Fase 11, mas a tabela já existe desde já).
- **Materialized views**
  - View para "próximos jogos com odds recentes" (usada pela Fase 3).
  - View para "última odd por bookmaker" (evita repetir a lógica de `DISTINCT ON` em todo lugar).
- **Índices e particionamento de `odds_history`**
  - Particionamento por intervalo de tempo (mensal, via `pg_partman` ou partições manuais) — a tabela
    é a que mais cresce do sistema e precisa de plano de escala desde o desenho inicial.
  - Índices compostos em `(event_id, market_type_id, bookmaker_id, recorded_at)`.

### Entregável

Schema completo aplicado em Supabase (dev/staging), populado com seed, tipos TS sincronizados no
monorepo, endpoints de leitura funcionando.

### Testes

- `migration up` e `migration down` executam sem erro em banco limpo (teste automatizado no CI que
  sobe um Postgres efêmero e roda a sequência completa de migrations).
- Políticas RLS verificadas: teste que autentica como usuário A e confirma que não enxerga/altera
  dados de usuário B; teste que confirma que `service_role` tem acesso irrestrito.
- Operações CRUD básicas passam (criar, ler entidades de catálogo via API).
- Teste que tenta `UPDATE` em `odds_history` e `model_predictions` e confirma que é rejeitado pelo
  banco (prova da garantia append-only).

---

## Fase 2 — Pipeline de Coleta de Odds (Semana 3–5)

**Objetivo:** odds fluindo automaticamente para o banco, com histórico sendo construído de forma
confiável.

**Pode sobrepor com:** Fase 3 pode começar com dados mockados/seed enquanto esta fase amadurece; o
contrato de dados (schema já definido na Fase 1) é o que permite esse paralelismo.

### Escopo

- **Integração com SportsGameOdds API**
  - Cliente HTTP tipado (Python) com autenticação, tratamento de paginação e de erros HTTP.
  - Mapeamento de escopo: quais ligas/eventos puxar, respeitando o seed da Fase 1.
- **Camada de normalização de dados**
  - Mapeamento de IDs externos (times, ligas, eventos, casas de apostas da API) para as entidades
    internas — tabela de `external_id_mapping` (ou colunas dedicadas) para permitir reconciliação
    quando a fonte muda um identificador.
  - Tratamento de nomes divergentes (fuzzy matching assistido/curado manualmente para casos
    ambíguos, nunca silenciosamente automático sem log).
- **Worker de coleta (BullMQ)**
  - Fila dedicada para "coletar odds de evento X".
  - Idempotência: reprocessar o mesmo job não deve duplicar linhas em `odds_history`.
- **Jobs agendados (cron)**
  - Polling de odds a cada 15–30 min para partidas futuras (janela configurável), com frequência
    maior conforme o evento se aproxima do horário de início (ex.: a cada 5 min na última hora) —
    documentar a política exata como configuração, não código hardcoded.
- **Inserção append-only em `odds_history`**
  - Toda leitura da API que representa uma odd nova ou alterada gera uma linha nova em
    `odds_history`; nunca sobrescreve.
- **Manutenção do snapshot atual (`odds_snapshot_current`)**
  - Upsert do valor mais recente por chave `(event, market, selection, bookmaker)`, sempre derivado
    do que acabou de entrar em `odds_history` (nunca escrito direto, para não haver dessincronia).
- **Tratamento de erro, retries e dead-letter queue**
  - Retry com backoff exponencial para falhas transitórias (timeout, 5xx).
  - Fila de dead-letter para falhas persistentes, com alerta e painel de inspeção mínimo (mesmo que
    só uma query, sem UI ainda).
- **Gestão de rate limit da API**
  - Respeitar limites documentados do provedor; fila com controle de taxa (ex.: `bottleneck` no
    Node, ou limitador próprio no Python) para nunca estourar a cota.
- **Checagens de qualidade de dados**
  - Odd fora de faixa plausível (ex.: decimal < 1.0, ou overround absurdo) gera registro em
    `data_quality_flags` em vez de ser descartada silenciosamente — decisão de negócio: guardar com
    flag é mais seguro que perder o dado.
  - Detecção de duplicidade (mesmo evento/mercado/seleção/bookmaker/valor no mesmo minuto) evitada
    por constraint + lógica de deduplicação no worker.
- **Arquitetura para fonte secundária (The Odds API)**
  - Interface `OddsProvider` (Protocol/ABC em Python) já definida, com `SportsGameOddsProvider`
    implementando-a. Segunda implementação **não** entra nesta fase — só a interface, para que a
    Fase 15 seja um plug-in, não um redesenho.

### Entregável

Odds sendo coletadas automaticamente em intervalo regular, `odds_history` crescendo de forma
consistente, `odds_snapshot_current` sempre refletindo o último valor conhecido.

### Testes

- Teste de integração com API mockada (`respx`/`responses` ou similar) cobrindo: resposta de sucesso,
  erro 429 (rate limit), erro 5xx, resposta malformada.
- Checagem de integridade: rodar o worker duas vezes sobre o mesmo payload e confirmar que
  `odds_history` não duplica (teste de idempotência).
- Teste de detecção de duplicados e de valores fora de faixa (gera flag, não quebra a pipeline).
- Teste de ponta a ponta local: subir o worker contra a API mockada por alguns ciclos e verificar que
  o snapshot atual bate com a última entrada do histórico.

---

## Fase 3 — Interface Base e Navegação (Semana 5–7)

**Objetivo:** casca de UI funcional, navegável, exibindo dados reais (ou seed realista, se a Fase 2
ainda estiver em andamento).

**Pode sobrepor com:** parte final da Fase 2 (consumindo dados de seed até a pipeline real estar
pronta).

### Escopo

- **Layout:** navegação lateral (sidebar) fixa em desktop, colapsável/drawer em mobile; header com
  identidade do usuário e indicador de status da última coleta de odds.
- **Tema escuro como padrão** — paleta definida via tokens Tailwind/CSS variables, com suporte
  estrutural a tema claro (mesmo que não seja o foco do MVP).
- **Dashboard (esqueleto)** — cards de resumo (jogos hoje, oportunidades ativas — placeholder até a
  Fase 7), lista de próximos jogos.
- **Página Jogos** — listagem de próximas partidas com odds resumidas (melhor odd por mercado
  principal), filtro por liga/data.
- **Página Campeonatos** — listagem das ligas do seed, com contagem de jogos futuros.
- **Página Odds Comparison** — visão lado a lado das odds de todas as casas para um evento
  selecionado, por mercado.
- **Página Odds Scanner** — tabela densa com todas as odds disponíveis (evento × mercado × casa),
  pensada para varredura rápida (usuário avançado), com paginação/virtualização desde o início (a
  tabela cresce rápido).
- **Filtro e busca básicos** — por liga, por time, por data, aplicados de forma consistente nas
  páginas acima.
- **Selo de casa autorizada SPA** — badge visual reaproveitando o campo de `bookmakers` criado na
  Fase 1.
- **Estados de carregamento, erro e vazio** — padronizados como componentes reutilizáveis
  (`packages/ui`), aplicados em todas as páginas desta fase (nada de tela em branco silenciosa).

### Entregável

Aplicação navegável mostrando dados reais de odds (ou seed), com todas as páginas listadas
renderizando corretamente em desktop e mobile.

### Testes

- Testes de componente (Testing Library) para os estados de loading/erro/vazio.
- Testes de renderização de página com dados mockados (snapshot ou assertions de conteúdo-chave).
- Checagem de layout responsivo em pelo menos 3 breakpoints (mobile, tablet, desktop) — visual ou via
  Playwright com viewport variável.

---

## Fase 4 — Cálculos de Probabilidade e Mercado (Semana 7–9)

**Objetivo:** motor de probabilidade implícita/justa e detecção básica de valor.

**Pode sobrepor com:** nada anterior de forma relevante — depende de odds reais fluindo (Fase 2) e de
UI para exibir (Fase 3), então começa limpa depois das duas.

### Escopo

- **Probabilidade implícita** a partir de odds decimais (`1 / odd`), calculada no motor Python.
- **Overround por mercado** — soma das probabilidades implícitas de todas as seleções de um mercado
  menos 1 (a "margem da casa").
- **Probabilidade justa (fair probability)** — múltiplos métodos implementados e testáveis
  isoladamente:
  - Multiplicativo (normalização simples pela soma).
  - Power (ajuste por expoente que resolve o overround).
  - Shin (modelo que separa margem de *insider trading* do overround, mais realista para mercados
    grandes).
- **Probabilidade de consenso de mercado** — média (ponderada por liquidez/relevância da casa, quando
  disponível) das probabilidades justas entre bookmakers, para um "preço justo de mercado" de
  referência.
- **Página Value Finder (v1)** — lista eventos onde a probabilidade do modelo (placeholder até a Fase
  5 existir — usar consenso de mercado com defasagem, ou marcador "em breve", para não expor número
  falso) diverge significativamente do mercado.
- **Detecção básica de oportunidade** — `edge > limiar configurável`, sem ranqueamento sofisticado
  ainda (isso é a Fase 7).
- **Exibição de probabilidade na UI** — cards de odds e página de detalhe do evento passam a mostrar
  probabilidade implícita e justa lado a lado com a odd decimal.

### Entregável

Motor de probabilidade funcionando, com Value Finder mostrando divergências calculadas a partir de
dados reais de mercado (mesmo sem modelo próprio ainda).

### Testes

- Testes unitários para cada fórmula (implícita, overround, multiplicativo, power, Shin), com casos
  conhecidos calculados à mão/manualmente verificados (ex.: mercado 2 vias com overround simétrico
  tem solução fechada verificável).
- Casos de teste de "valor conhecido": conjunto de odds sintéticas onde o edge esperado é calculado
  manualmente e comparado ao output do sistema.
- Teste de regressão: overround calculado sempre soma corretamente de volta a 100% após a correção
  pelo método justo escolhido (invariante matemático).

---

## Fase 5 — Modelos Estatísticos v1 (Semana 9–13)

**Objetivo:** primeiros modelos estatísticos próprios gerando predições calibradas.

**Pode sobrepor com:** nada — é a fase mais sensível a vazamento de dados temporais, precisa da
pipeline de dados (Fase 2) e do schema de `model_predictions` (Fase 1) totalmente estáveis antes de
começar.

### Escopo

- **Pipeline de feature engineering (Python)** — geração de features a partir de `events`,
  `event_results` e histórico agregado (forma recente, médias de gols, etc.), com **integridade
  temporal estrita**: nenhuma feature de um jogo pode usar dados que só existiriam depois do horário
  daquele jogo.
- **Preparação de dados com corte temporal** — utilitário central (`as_of(date)`) usado por toda
  feature/modelo, para impedir que qualquer código acidentalmente "veja o futuro".
- **Modelo Poisson** — gols de cada time modelados como processos de Poisson independentes,
  parâmetros de ataque/defesa por time.
- **Modelo Dixon-Coles** — extensão do Poisson que corrige a correlação em placares baixos (0-0, 1-0,
  0-1, 1-1) e adiciona decaimento temporal (jogos recentes pesam mais).
- **Sistema de rating Elo** — adaptado a futebol (ajuste por gols de diferença, mando de campo,
  margem de vitória).
- **Versionamento e registro de modelos** — toda execução de treino gera uma entrada em
  `model_registry` com hiperparâmetros, hash dos dados de treino, timestamp — nunca sobrescreve uma
  versão anterior.
- **Armazenamento de predições (`model_predictions`, append-only)** — cada predição referencia a
  versão exata do modelo que a gerou.
- **Infraestrutura de validação walk-forward** — treino sempre em dados anteriores ao ponto de
  avaliação, avançando a janela no tempo (nunca k-fold aleatório, que vazaria informação futura).
- **Rastreamento básico de performance do modelo** — cálculo simples de acurácia/Brier Score sobre o
  conjunto de validação walk-forward (métricas completas são a Fase 9; aqui é o mínimo para saber se
  o modelo está minimamente calibrado).
- **Endpoint de API** — `GET /events/{id}/predictions` retornando predições de todos os modelos
  ativos para o evento.
- **Página Model Lab (v1)** — seleção de modelo, visualização de predições, comparação lado a lado com
  a probabilidade de mercado (Fase 4).

### Entregável

Três modelos funcionando (Poisson, Dixon-Coles, Elo), produzindo predições calibradas e versionadas,
visíveis na página Model Lab.

### Testes

- Testes unitários de cada modelo com dados sintéticos de resultado conhecido (ex.: time muito mais
  forte deve receber probabilidade de vitória muito maior).
- Backtest em dados históricos reais (ou conjunto histórico curado), comparando distribuição prevista
  vs. resultados observados.
- Teste de calibração (reliability curve simplificada): entre os jogos onde o modelo previu ~60% de
  vitória, a frequência observada de vitória deve estar próxima de 60%.
- **Teste de não-vazamento de dados** — verificação automatizada de que nenhuma feature usada para
  prever o jogo em `data_x` usa registros com timestamp posterior a `data_x` (crítico, tratado como
  bug de severidade máxima se falhar).

---

## Fase 6 — Modelos Avançados e Ensemble (Semana 13–17)

**Objetivo:** suíte completa de modelos com combinação em ensemble.

**Pode sobrepor com:** nada — depende diretamente da infraestrutura de modelagem da Fase 5 estar
madura e testada.

### Escopo

- **Modelo de Regressão Logística** — como baseline linear interpretável, sobre as features da Fase
  5.
- **Modelo XGBoost/LightGBM** — modelo não linear com maior poder preditivo, mesmo pipeline de
  features + walk-forward.
- **Modelo baseado em xG** — arquitetura pronta (interface `XGModel` e pipeline de features
  compatível), mas **fonte de dados de xG ainda em aberto** — implementação plugável quando a fonte
  for definida/contratada (documentar isso explicitamente como dependência externa, não como bloqueio
  da fase).
- **Ensemble (combinação ponderada)** — combina as saídas dos modelos anteriores, com pesos
  inicialmente definidos por performance no walk-forward (não arbitrários).
- **Exibição de consenso entre modelos** — na UI, mostrar não só a predição do ensemble mas o grau de
  concordância entre os modelos individuais.
- **Score de confiança a partir da concordância dos modelos** — quanto mais os modelos individuais
  concordam entre si, maior a confiança atribuída à predição do ensemble.
- **Pipeline de tuning de hiperparâmetros (otimização bayesiana)** — usando `optuna` ou similar,
  rodando sobre o mesmo esquema de validação walk-forward (nunca otimizar sobre o conjunto de teste
  final).
- **SHAP values para interpretabilidade** — aplicado aos modelos de ML (XGBoost/LightGBM/Logística),
  exposto na API para consumo da UI.
- **Model Lab (v2)** — comparação entre modelos, visualização de importância de features, visão de
  concordância/discordância do ensemble.

### Entregável

Suíte completa de modelos (5 implementados + xG como interface pronta) com ensemble funcionando e
superando modelos individuais em métricas de validação.

### Testes

- Cada modelo novo com backtest independente (mesma metodologia da Fase 5).
- Teste comparativo: ensemble deve superar (ou no mínimo empatar com margem estatística) o melhor
  modelo individual em Brier Score/Log Loss no conjunto de validação walk-forward.
- Teste de estabilidade de importância de features (SHAP): rodando o mesmo modelo em janelas de
  validação adjacentes, a ordem relativa das features mais importantes não deve variar drasticamente
  (sinal de overfitting se variar).
- Teste de regressão do pipeline de tuning: hiperparâmetros encontrados não pioram o resultado em
  relação à configuração anterior conhecida.

---

## Fase 7 — Value Engine Completo (Semana 17–19)

**Objetivo:** cálculo completo de edge/EV/Edge Score e ranqueamento de oportunidades.

**Pode sobrepor com:** nada — consome diretamente os modelos da Fase 5/6 e as probabilidades de
mercado da Fase 4.

### Escopo

- **Cálculo de Edge** — `model_prob - fair_market_prob`, por seleção/mercado/evento.
- **Cálculo de Expected Value (EV)** — `(model_prob × odd) - 1`, usando a melhor odd disponível entre
  casas.
- **Edge Score (0–100)** — fórmula proprietária combinando edge, EV, confiança do modelo (concordância
  do ensemble, Fase 6) e quantidade/qualidade de casas cobrindo aquele mercado — documentar a fórmula
  exata em `docs/` do projeto, versionada (mudanças na fórmula afetam histórico e precisam ser
  rastreáveis, assim como versões de modelo).
- **Classificação e ranqueamento de oportunidades** — materializado em `value_opportunities`,
  recalculado nos ciclos de atualização de odds/predições.
- **Página Top Picks** — melhores oportunidades ranqueadas por Edge Score.
- **Dashboard totalmente populado** — métricas de valor reais substituindo os placeholders da Fase 3.
- **Value Finder (v2, com filtros avançados)** — edge mínimo, EV mínimo, mercados, ligas.
- **Card de oportunidade completo**, exibindo: evento, horário, liga, mercado, seleção, melhor odd,
  casa correspondente, odd média, probabilidade implícita, probabilidade justa, probabilidade do
  modelo, edge, EV, Edge Score, confiança, última atualização, número de casas cobrindo o mercado.

### Entregável

Pipeline completo de detecção e apresentação de valor, do cálculo bruto até o card final na UI.

### Testes

- Teste de consistência do Edge Score: mesma entrada sempre produz o mesmo score (determinístico,
  sem aleatoriedade escondida).
- Teste de estabilidade de ranqueamento: pequenas variações de odds não devem causar reordenação
  drástica e injustificada do Top Picks (sensibilidade controlada).
- Teste de UI: todos os campos exigidos aparecem corretamente no card de oportunidade, inclusive nos
  estados de dado parcial (ex.: só uma casa cobrindo o mercado).

---

## Fase 8 — Line Movement e Histórico (Semana 19–21)

**Objetivo:** rastreamento e visualização de movimento de linha (odds ao longo do tempo).

**Pode sobrepor com:** Fase 9 pode começar em paralelo assim que o histórico de odds/predições tiver
volume suficiente — as duas fases consomem o mesmo tipo de dado histórico mas produzem visões
diferentes.

### Escopo

- **Página Line Movement** com gráficos interativos (Recharts) — evolução da odd de uma
  seleção/mercado ao longo do tempo, por casa de apostas.
- **Sparklines de movimento de odds** nos cards de oportunidade/listagem (mini-gráfico de tendência).
- **Reconstrução de odds históricas** a partir de `odds_history` — consultas otimizadas (usando os
  índices/partições da Fase 1) para não pesar no banco em produção.
- **Comparação linha de abertura vs. atual vs. fechamento** — campos derivados de `odds_history`
  (primeira e última entrada por evento×mercado×seleção×casa, mais o valor mais recente).
- **Detecção de steam moves** — movimento rápido e simultâneo em múltiplas casas, indicador de
  "dinheiro esperto" entrando no mercado.
- **Alertas de reverse line movement** — quando a linha se move contra o lado que está recebendo mais
  volume aparente de apostas (heurística baseada em direção da odd vs. sinal esperado).
- **Visualização de série temporal por evento × mercado** — componente reutilizável usado tanto na
  página dedicada quanto no detalhe do evento.

### Entregável

Rastreamento e visualização completos de movimento de linha, incluindo detecção de sinais de "sharp
money".

### Testes

- Testes de renderização de gráfico com diferentes formatos de dado (poucos pontos, muitos pontos,
  série com gaps, série de uma casa só).
- Teste de acurácia de detecção de movimento: dado um conjunto sintético de série de odds com um
  steam move conhecido, o detector deve identificá-lo; dado um conjunto de ruído normal, não deve
  gerar falso positivo.

---

## Fase 9 — Performance e Métricas (Semana 21–24)

**Objetivo:** avaliação completa e rastreamento de performance dos modelos.

**Pode sobrepor com:** Fase 8 (ver acima). Também pode sobrepor parcialmente com o início da Fase 10,
já que a IA Analyst da Fase 10 pode consumir métricas desta fase assim que estiverem disponíveis, mas
o desenvolvimento em si deve aguardar esta fase estar concluída para ter dados confiáveis para
explicar.

### Escopo

- **Cálculo e rastreamento de Brier Score** — por modelo, por período, por mercado.
- **Cálculo de Log Loss** — complementar ao Brier Score, mais sensível a erros de alta confiança.
- **Erro de Calibração (ECE)** com curvas de confiabilidade (reliability curves) visuais.
- **Rastreamento de Closing Line Value (CLV)** — comparação entre a odd no momento da "aposta
  hipotética" (quando a oportunidade foi sinalizada) e a odd de fechamento; métrica padrão da
  indústria para avaliar qualidade de picks independente do resultado final do jogo.
- **Hit Rate por faixa de confiança** — agrupando predições por bucket de probabilidade/Edge Score e
  medindo taxa de acerto real em cada faixa.
- **Simulação retrospectiva de ROI** — stake flat e critério de Kelly, sobre o histórico de
  oportunidades identificadas, deixando claro que é simulação retrospectiva (não é dinheiro real, não
  é garantia de resultado futuro).
- **Análise de drawdown** — maior sequência de perdas simuladas, drawdown máximo, duração.
- **Página Performance** com dashboards completos, comparação entre modelos, quebra por
  temporada/liga.
- **Avisos de tamanho de amostra** — qualquer métrica calculada sobre poucos eventos precisa deixar
  isso visualmente explícito (evitar que o usuário confie em uma taxa de acerto calculada sobre 8
  jogos como se fosse robusta).

### Entregável

Dashboard completo de analytics de performance, cobrindo todas as métricas acima, para todos os
modelos e para o ensemble.

### Testes

- Cálculos de métrica verificados contra datasets conhecidos com resultado esperado calculado à mão
  (Brier Score, Log Loss e ECE têm fórmulas fechadas fáceis de conferir manualmente em casos
  pequenos).
- Testes de renderização de gráfico (reliability curve, equity curve, drawdown) com dados de borda
  (zero eventos, um evento, série constante).
- Teste de que avisos de amostra pequena aparecem corretamente abaixo do limiar configurado e somem
  acima dele.

---

## Fase 10 — IA Analyst (Claude API) (Semana 24–26)

**Objetivo:** análise textual gerada por IA, fundamentada nos dados já calculados pelo sistema.

**Pode sobrepor com:** nada crítico — depende de Fases 4–9 estarem maduras, já que a IA só explica
dados que o sistema já produziu; começar antes disso arrisca a IA "preencher lacunas" com informação
não verificada.

### Escopo

- **Integração com a API da Claude** — feita **exclusivamente no backend** (FastAPI); a chave de API
  nunca é exposta ao cliente.
- **Preparação estruturada de dados para os prompts** — montagem de um payload determinístico (JSON)
  com os números relevantes (odds, probabilidades, edge, performance do modelo, movimento de linha)
  que serve de única fonte de fatos para o prompt.
- **Geração de análise de partida** — briefing pré-jogo textual, gerado a partir do payload acima.
- **Explicação do consenso entre modelos** — texto que descreve, em linguagem natural, por que os
  modelos concordam ou divergem (sem inventar números novos).
- **Explicação de oportunidade de valor** — por que aquele edge existe, com base nos dados fornecidos.
- **Página AI Analyst** — exibição das análises geradas, associadas ao evento/oportunidade.
- **Rate limiting e controle de custo** — limite de gerações por usuário/plano, orçamento diário
  monitorado.
- **Cache de análises geradas** — a mesma combinação de evento + dados-base não deve gerar uma nova
  chamada à API a cada visualização; invalidar cache quando os dados subjacentes mudam de forma
  relevante (nova odd significativa, novo modelo rodado).
- **Guardrails rígidos** — a Claude **nunca gera números por conta própria**, apenas explica dados já
  calculados e fornecidos no prompt; validação pós-geração (ex.: checagem de que números citados no
  texto batem com os números do payload) antes de exibir ao usuário.
- **Disclaimers de jogo responsável** — presentes em toda saída da IA, de forma consistente e visível,
  não apenas em rodapé genérico da página.

### Entregável

Página AI Analyst funcionando, produzindo análises de qualidade fundamentadas nos dados reais do
sistema, com custo e uso controlados.

### Testes

- **Testes de guardrail** — casos onde se verifica que a IA não fabrica estatísticas: comparar números
  citados no texto gerado contra o payload de entrada, falhar o teste (e bloquear a exibição) se
  houver divergência.
- Revisão de qualidade de output — processo definido (mesmo que manual/amostral no início) para
  avaliar clareza e correção das análises geradas.
- Verificação de rate limit — teste que confirma que o limite configurado é respeitado e que o
  usuário recebe mensagem clara ao atingi-lo.
- Teste de cache — mesma entrada não dispara nova chamada à API; entrada com dado-base alterado
  dispara.

---

## Fase 11 — Alertas e Favoritos (Semana 26–28)

**Objetivo:** funcionalidades de personalização para o usuário.

**Pode sobrepor com:** Fase 12 (Backtesting) — ambas consomem a mesma base de dados histórica sem
dependência direta entre si, então podem ser desenvolvidas por pessoas diferentes em paralelo.

### Escopo

- **Sistema de favoritos** — eventos, times e ligas, usando a tabela `user_favorites` já existente
  desde a Fase 1.
- **UI de criação de alerta** — condições configuráveis: limiar de edge, movimento de odds, grau de
  concordância entre modelos.
- **Motor de avaliação de alertas** — worker em background (reaproveitando a infraestrutura de filas
  da Fase 2) que avalia condições de alerta a cada ciclo de atualização de dados.
- **Entrega de notificação** — e-mail, notificação in-app, push (push como stretch goal se o tempo
  apertar — priorizar e-mail e in-app primeiro).
- **Histórico de alertas** — registro de quando cada alerta disparou e com quais dados.
- **Página Favoritos.**
- **Página Alertas** — criação, edição, histórico.

### Entregável

Sistema de alertas e favoritos funcionando de ponta a ponta, incluindo entrega de notificação.

### Testes

- Teste de acurácia de disparo: condições sintéticas de alerta configuradas, dados simulados que
  devem e não devem disparar, confirmação de que só os casos corretos disparam.
- Teste de entrega de notificação (mock do provedor de e-mail/push).
- Testes de CRUD de favoritos (adicionar, remover, listar, isolado por usuário via RLS).

---

## Fase 12 — Backtesting Avançado (Semana 28–30)

**Objetivo:** backtesting completo e validação walk-forward com interface de self-service.

**Pode sobrepor com:** Fase 11 (ver acima).

### Escopo

- **Motor de backtesting (Python)** — generalização da infraestrutura de validação walk-forward já
  usada internamente desde a Fase 5, agora exposta como serviço configurável.
- **Executor de validação walk-forward** — parametrizável por usuário avançado (via UI) em vez de só
  interno ao time de dados.
- **Configuração de backtest** — intervalo de datas, modelo, mercado, estratégia de stake.
- **Visualização de resultados** — equity curve, gráfico de drawdown, métricas ao longo do tempo
  (reaproveitando componentes de gráfico da Fase 8/9).
- **Comparação de backtests** — modelo A vs. modelo B no mesmo período.
- **Integração ao Model Lab.**
- **Exportação de resultados** — CSV/JSON, para o usuário levar os dados para fora da plataforma.

### Entregável

Backtesting self-service com resultados abrangentes, integrado ao Model Lab.

### Testes

- Cenários de backtest conhecidos (dados sintéticos com resultado esperado calculável) produzem o
  resultado esperado.
- **Verificação de integridade temporal** — mesma checagem rigorosa da Fase 5, agora aplicada também
  aos backtests configurados livremente pelo usuário (o motor de self-service não pode abrir uma
  brecha para vazamento que o pipeline interno já evita).

---

## Fase 13 — Estatísticas e Dados de Times (Semana 30–32)

**Objetivo:** páginas de estatísticas de times e jogadores.

**Pode sobrepor com:** pode começar em paralelo com o fim da Fase 12, já que consome majoritariamente
dados de catálogo/resultados (Fase 1/2), não de modelos ou backtesting.

### Escopo

- **Coleta e agregação de estatísticas de time** — gols marcados/sofridos, forma recente, desempenho
  em casa/fora, por competição.
- **Estatísticas de jogador** — condicionado à disponibilidade de fonte de dados (avaliar
  custo/cobertura antes de comprometer o escopo; documentar como dependência externa se não houver
  fonte viável ainda).
- **Página Estatísticas** — estatísticas de time, tabelas de classificação, guias de forma.
- **Comparação cabeça a cabeça (H2H)** entre dois times.
- **Página de detalhe do time** — estatísticas, forma, próximos jogos, predições dos modelos para
  esses jogos.
- **Página de detalhe da liga** — classificação, líderes estatísticos, melhores oportunidades da liga
  (reaproveitando Top Picks filtrado).

### Entregável

Seção de estatísticas completa e rica, integrada às páginas de time/liga.

### Testes

- Testes de acurácia de agregação (dado um conjunto de resultados conhecido, os totais/médias
  calculados batem com o esperado).
- Teste de performance de página (tempo de carregamento dentro do orçamento definido nos KPIs).

---

## Fase 14 — Polimento e Produção (Semana 32–36)

**Objetivo:** aplicação pronta para produção.

**Pode sobrepor com:** nada de funcional novo — esta fase deliberadamente não adiciona features, só
endurece o que já existe. Pode começar itens de segurança/monitoramento em paralelo com o fim da
Fase 13, já que são ortogonais a estatísticas de time.

### Escopo

- **Otimização de performance** — lazy loading de rotas/componentes pesados, tabelas virtualizadas
  (Odds Scanner, Line Movement), otimização de queries lentas identificadas em profiling real.
- **SEO e meta tags** — páginas públicas (landing, marketing) com metadata completo, sitemap,
  Open Graph.
- **Error boundaries e degradação graciosa** — nenhuma falha de um widget derruba a página inteira.
- **Polimento de responsividade** — revisão completa mobile/tablet de todas as páginas construídas nas
  fases anteriores.
- **Auditoria de acessibilidade (WCAG 2.1 AA)** — contraste, navegação por teclado, leitores de tela
  nos fluxos principais.
- **Auditoria de segurança** — revisão de chaves de API, políticas RLS (revisão completa, não só das
  tabelas novas), validação de entrada em todos os endpoints públicos.
- **Rate limiting em todos os endpoints públicos** — não só nos endpoints de IA (Fase 10), estendido a
  toda a API.
- **Monitoramento e alerting** — Sentry (erros de frontend/backend) e uma solução de métricas/uptime
  (Datadog ou equivalente mais barato/adequado ao estágio do produto).
- **Landing page / página de marketing.**
- **Integração de assinatura/cobrança (Stripe)** — planos, período de teste, portal de gestão de
  assinatura.
- **Termos de uso e política de privacidade.**
- **Página de jogo responsável e verificação de idade** — requisito não negociável para uma plataforma
  de apostas, tratado como item de compliance, não apenas de UX.
- **Teste de carga** — validação de que a aplicação sustenta a carga esperada de lançamento.
- **Documentação de deploy** — runbook de produção, rollback, variáveis de ambiente de produção.

### Entregável

Aplicação pronta para produção, com billing, compliance, monitoramento e performance validados.

### Testes

- Suíte de testes E2E cobrindo os fluxos críticos (cadastro → assinatura → uso das páginas principais
  → cancelamento).
- Scan de segurança (dependências vulneráveis, headers HTTP, exposição de chaves).
- Resultados de teste de carga documentados (throughput e latência sob carga-alvo).
- Auditoria de acessibilidade com relatório de aprovação (ferramenta automatizada + revisão manual
  dos fluxos principais).

---

## Fase 15 — Expansão Futura (Backlog)

Itens sem cronograma fixo, priorizados conforme demanda de usuários e capacidade do time após o
lançamento (Fase 14):

- **Esportes adicionais** (basquete, tênis) — reaproveitando a estrutura genérica de `sports`
  desenhada desde a Fase 1.
- **Fontes de odds adicionais** — implementação concreta de `The Odds API` sobre a interface
  `OddsProvider` já preparada na Fase 2.
- **Rastreamento de odds ao vivo (live)** — preparação arquitetural primeiro (a diferença de volume e
  latência entre pré-jogo e live é grande o suficiente para merecer desenho próprio antes de
  implementar).
- **Aplicativo mobile (React Native)** — reaproveitando `packages/types` e lógica de domínio
  compartilhável do monorepo.
- **Funcionalidades sociais** — picks compartilhados, leaderboard de performance entre usuários.
- **Calculadoras avançadas de stake** — Kelly fracionário configurável, staking por unidade,
  simuladores de banca.
- **Integração com bot de Telegram/Discord** — alertas (Fase 11) entregues também nesses canais.
- **Capacidade white-label** — multi-tenant para revenda da plataforma sob outra marca.
- **Suporte a múltiplos idiomas** — internacionalização da UI (o produto nasce em pt-BR).

---

## Dependências Externas e Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **Confiabilidade e rate limits da API SportsGameOdds** | Alto — é a fonte primária de odds; instabilidade afeta todo o produto | Retries/backoff e dead-letter queue desde a Fase 2; monitorar SLA da API; interface `OddsProvider` pronta para trocar/adicionar fonte sem redesenho |
| **Qualidade dos dados dos provedores de odds** | Médio-Alto — dado ruim vira predição ruim, vira produto não confiável | Checagens de qualidade e flags desde a Fase 2 (nunca descartar silenciosamente); auditoria contínua de `data_quality_flags` |
| **Disponibilidade de dados de futebol por liga** | Médio — cobertura desigual entre campeonatos pode limitar o valor do produto em ligas menores | Priorizar ligas com melhor cobertura de dados no seed (Fase 1); ser transparente na UI sobre cobertura por liga |
| **Custo da API da Claude em escala** | Médio — pode crescer rápido com base de usuários | Cache agressivo (Fase 10), rate limit por plano, monitorar custo por usuário ativo desde o primeiro dia de produção |
| **Limites do plano Supabase (free/pro)** | Médio — `odds_history` cresce rápido, pode estourar limites de storage/linhas antes do esperado | Particionamento desde a Fase 1; monitorar crescimento real vs. projeção; plano de upgrade de tier definido com antecedência, não reativo |
| **Disponibilidade e custo de dados de xG** | Baixo-Médio (afeta só a Fase 6, não bloqueia o core) | Modelo de xG desenhado como plugável desde a Fase 6; lançar sem ele é aceitável, decisão já prevista no roadmap |
| **Mudança de regulação de apostas no Brasil (SPA)** | Médio — o produto depende de contexto regulatório | Campo de status SPA na tabela `bookmakers` desde a Fase 1 já isola essa informação como dado, não como constante no código — fácil de atualizar |

---

## KPIs do Projeto

Critérios de sucesso mensuráveis por fase. Servem tanto para avaliar "pronto" quanto para detectar
regressão ao longo do tempo.

### Cobertura de testes (alvo por fase, a partir da Fase 1)

| Área | Alvo |
|---|---|
| Lógica de cálculo (probabilidade, edge, EV, métricas de performance) — Python | ≥ 90% |
| Modelos estatísticos (Fases 5–6) — casos de calibração/backtest | 100% dos modelos com backtest documentado |
| Rotas de API (FastAPI) | ≥ 80% |
| Componentes de UI críticos (cards de oportunidade, tabelas densas, formulários) | ≥ 70% |
| E2E dos fluxos principais (auth, navegação, criação de alerta, assinatura) | 100% dos fluxos críticos cobertos a partir da Fase 14 |

### Benchmarks de performance

| Métrica | Alvo |
|---|---|
| Time to First Byte (TTFB) das páginas principais | < 200 ms (p75, produção) |
| Largest Contentful Paint (LCP) | < 2,5 s (p75) |
| Tempo de resposta da API — endpoints de leitura (odds, eventos) | < 300 ms (p95) |
| Tempo de resposta da API — endpoints de predição/cálculo de valor | < 1,5 s (p95) |
| Tabela Odds Scanner — renderização inicial com dataset completo | < 1 s até interativo |
| Latência do ciclo de coleta de odds (job → dado disponível na API) | < 2 min |

### Métricas de qualidade de dados

| Métrica | Alvo |
|---|---|
| Taxa de odds flagueadas como fora de faixa (`data_quality_flags`) | < 0,5% das inserções |
| Taxa de duplicidade detectada em `odds_history` | 0% (constraint de banco garante) |
| Cobertura de eventos com pelo menos 3 casas de apostas | ≥ 80% dos eventos das ligas priorizadas |
| Atraso médio entre atualização real da odd e captura pelo sistema | < 15 min (dentro da janela de polling configurada) |

### Metas de calibração de modelo

| Métrica | Alvo |
|---|---|
| Brier Score (modelos individuais, validação walk-forward) | Deve superar o baseline de mercado (probabilidade implícita vig-removida) |
| Expected Calibration Error (ECE) | < 0,05 no conjunto de validação |
| Ensemble vs. melhor modelo individual | Ensemble não pode ser pior que o melhor individual isolado (idealmente supera) |
| Closing Line Value médio das oportunidades sinalizadas (Fase 9 em diante) | Positivo e estatisticamente distinguível de zero, com amostra mínima documentada antes de qualquer alegação de edge real |

---

## Convenções para quem for executar este roadmap

- Todo o produto (UI, comentários de código, documentação) é em **pt-BR**, assim como este roadmap.
- Cada fase, ao ser concluída, deve gerar uma entrada de changelog e — quando alterar convenções de
  arquitetura — atualização do `CLAUDE.md`/`AGENTS.md` do projeto, no mesmo espírito de manutenção
  contínua de documentação usado no projeto KM Check.
- "Terminar rápido" nunca é motivo para pular a seção de Testes de uma fase. Se o prazo apertar, o
  primeiro corte é de escopo (itens do backlog da Fase 15 sempre podem esperar), nunca da suíte de
  testes ou da integridade de dados.
