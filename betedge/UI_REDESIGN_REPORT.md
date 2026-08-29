# UI_REDESIGN_REPORT.md — PREDIQ Mobile Redesign

**Data:** 2026-08-29  
**Commit:** `feat(web): redesign PREDIQ mobile experience with premium sports analytics UI`  
**Branch:** `claude/sports-betting-stats-platform-qrp7y8`

---

## 1. Resumo

Redesign completo do frontend PREDIQ: de um tema emerald/quant-trading para uma identidade visual premium de análise esportiva com acento **vermelho** (#DC2626), tipografia condensada esportiva (Barlow Condensed), fundos profundamente escuros e navegação mobile-first com bottom nav.

**Nenhuma lógica quantitativa foi alterada.** Python permanece a fonte única de verdade para todas as métricas (Edge, EV, Brier, CLV, ECE, Índice PREDIQ, Kelly, etc.). TypeScript apenas consome, transforma DTO, formata e renderiza.

---

## 2. Design Tokens Alterados

### `packages/config/tailwind-preset.js`

| Token | Antes (Emerald) | Depois (Red) |
|-------|-----------------|--------------|
| `primary` | `#10b981` (emerald-500) | `#DC2626` (red-600) — escala completa 50-900 |
| `success` | _(não existia)_ | `#22C55E` (green-500) — apenas para valores positivos |
| `background` | `#020617` (slate-950) | `#09090B` (zinc-950) |
| `background.surface` | `#0f172a` (slate-900) | `#141416` |
| `background.elevated` | _(não existia)_ | `#1C1C1F` |
| `card` | `rgba(30,41,59,0.5)` | `rgba(24,24,27,0.85)` — mais opaco |
| `card.border` | `rgba(51,65,85,0.5)` | `rgba(255,255,255,0.07)` |
| `card.hover` | _(não existia)_ | `rgba(255,255,255,0.04)` |
| `foreground.muted` | slate-300 | `#A1A1AA` (zinc-400) |
| `foreground.subtle` | slate-500 | `#52525B` (zinc-600) |
| `font-display` | _(não existia)_ | `var(--font-barlow), sans-serif` |
| `fontSize.display-*` | _(não existiam)_ | xl(3rem), lg(2.25rem), md(1.5rem), sm(1.125rem) |
| Shadows | glow-primary emerald | glow-primary red, glow-success green |
| Animações | _(não existiam)_ | fade-in-up, scale-in, gauge-fill, slide-up |

### `apps/web/src/app/globals.css`

- CSS custom properties atualizadas (todas as triplas RGB)
- Adicionado `--success: 34 197 94`
- Gradiente do body: glow vermelho ao invés de emerald
- Scrollbar reduzida de 10px para 6px
- Novas classes utilitárias: `.card-premium`, `.card-accent`, `.filter-chip`, `.filter-chip-active`, `.pb-safe`, `.interactive`
- Shimmer do skeleton usa rgba branco ao invés de slate

---

## 3. Componentes Criados (11 novos)

| Componente | Arquivo | Função |
|------------|---------|--------|
| `SectionHeader` | `components/ui/section-header.tsx` | Barra indicadora vermelha + título uppercase + ação opcional |
| `SportFilter` | `components/ui/sport-filter.tsx` | Chips de filtro por esporte, scroll horizontal |
| `DateSelector` | `components/ui/date-selector.tsx` | Seletor de data horizontal (7 dias), pt-BR |
| `ConfidenceGauge` | `components/ui/confidence-gauge.tsx` | Gauge SVG vertical tipo termômetro (0-100) |
| `PrediqScoreGauge` | `components/ui/prediq-score-gauge.tsx` | Gauge SVG donut ring, 3 tamanhos (sm/md/lg) |
| `MetricCard` | `components/ui/metric-card.tsx` | Card de métrica, 3 variantes (default/accent/compact) |
| `OpportunityHero` | `components/ui/opportunity-hero.tsx` | Card hero com glow accent, edge em fonte display |
| `OpportunityRow` | `components/ui/opportunity-row.tsx` | Linha de oportunidade, responsivo |
| `EmptyState` | `components/ui/empty-state.tsx` | Estado vazio com ícone + título + descrição |
| `StatusBadge` | `components/ui/status-badge.tsx` | Badge CVA (collecting/active/inactive/warning/error) |
| `BottomNav` | `components/layout/bottom-nav.tsx` | Navegação inferior fixa, 5 itens, oculta em desktop |

---

## 4. Componentes e Layouts Atualizados (8 existentes)

| Arquivo | Mudanças |
|---------|----------|
| `app/(app)/layout.tsx` | Adicionado BottomNav, pb-24 mobile, footer oculto no mobile |
| `components/layout/topbar.tsx` | BetEdge→PREDIQ, badge Pro, removida busca |
| `components/layout/sidebar.tsx` | BetEdge→PREDIQ, font-display, primary-400→primary |
| `components/layout/stat-card.tsx` | Trend up: text-primary-400→text-success |
| `components/layout/placeholder-page.tsx` | text-primary-400→text-primary |
| `components/ui/card.tsx` | Base class: glass→card-premium |
| `components/ui/badge.tsx` | Adicionada variante `success`, default atualizado |
| `app/(auth)/layout.tsx` | BetEdge→PREDIQ, glass→card-premium |

---

## 5. Telas Modificadas

### 5.1 Dashboard (`app/(app)/dashboard/`)

**Reescrito por completo.** Novo `client.tsx` com:
- Saudação por horário ("Bom dia/Boa tarde/Boa noite, Analista")
- Título "OPORTUNIDADES" em Barlow Condensed display-xl
- `SportFilter` com filtros de esporte
- `DateSelector` com calendário horizontal 7 dias
- `OpportunityHero` para a melhor oportunidade
- 3 `MetricCard`: Valor Esperado, Melhor Odd, Score (PrediqScoreGauge)
- Lista "Top Oportunidades" com `OpportunityRow`
- Seção "Movimento das Odds" (placeholder para gráfico)
- "Desempenho do Modelo": Brier, CLV, ECE, Confiança
- Estados: loading (spinner), erro (danger card), vazio (EmptyState)
- Dados reais via `/api/model-audit` e `/api/shadow-lab?view=overview`

### 5.2 Odds Comparison (`app/(app)/odds-comparison/client.tsx`)

Migração de cores:
- `text-primary-400` → `text-primary` (elementos interativos/ativos)
- Overround baixo (≤4%) → `text-success` (valor positivo)
- Odd subiu → `text-success`
- Odd caiu → `text-danger`

### 5.3 Model Audit (`app/(app)/model-audit/client.tsx`)

Migração de cores:
- `text-primary-400` → `text-primary` (ícones de seção, dropdown ativos)
- Edge positivo (≥5%) → `text-success`
- EV positivo → `text-success`
- Overround baixo → `text-success`
- "Acertadas" (won) → `text-success` com `bg-success/10`
- Win Rate > 50% → `text-success`
- MetricCell (Brier, CLV, ROI, etc.) "bom" → `text-success`
- Pipeline step "done" → `text-success`

### 5.4 Shadow Lab (`app/(app)/shadow-lab/client.tsx`)

Migração de cores — a mais extensa:
- `text-emerald-400` → `text-success` (valores positivos, critérios atendidos)
- `text-amber-400` → `text-warning` (valores intermediários)
- `text-red-400` → `text-danger` (valores ruins)
- `text-muted-foreground` → `text-foreground-muted`
- Classes com `dark:` prefix → removidas (tema único escuro)
- `border-amber-*` / `border-green-*` / `border-zinc-*` → design system tokens
- `bg-amber-*` / `bg-green-*` / `bg-zinc-*` → design system tokens
- Recharts hex colors:
  - `#10b981` (emerald) → `#22C55E` (success green) para curva de equity
  - `#10b981` → `#DC2626` (primary red) para curva de calibração
  - `#0f172a` (slate-900) → `#141416` (surface) para tooltip background
  - `rgba(51,65,85,*)` → `rgba(39,39,42,0.6)` para grid
  - `#94a3b8` (slate-400) → `#A1A1AA` (zinc-400) para axis ticks
  - `#64748b` (slate-500) → `#52525B` (zinc-600) para labels
  - `rgba(148,163,184,*)` → `rgba(161,161,170,*)` para reference lines
  - `#e2e8f0` (slate-200) → `#FAFAFA` (zinc-50) para tooltip text

---

## 6. Responsividade

| Breakpoint | Comportamento |
|------------|---------------|
| Mobile (<lg) | Bottom nav visível, sidebar oculta, layout vertical, colunas de tabela menos essenciais ocultas |
| Desktop (≥lg) | Sidebar visível, bottom nav oculta, tabelas com todas as colunas |
| Safe area | `pb-safe` no BottomNav para iPhone (home indicator) |

---

## 7. Estados de UI

| Estado | Implementação |
|--------|---------------|
| **Loading** | `Loader2` spinner com texto em pt-BR |
| **Erro** | Card com ícone `AlertCircle` e mensagem |
| **Vazio** | `EmptyState` com ícone contextual + título + descrição |
| **Skeleton** | Componentes `Skeleton` com shimmer atualizado |

---

## 8. Verificações Executadas

| Verificação | Resultado |
|------------|-----------|
| TypeScript check (`tsc --noEmit`) | ✅ Apenas warning de deprecação `baseUrl` (pré-existente) |
| Python test suite (`pytest tests/`) | ✅ **874 passed**, 2 xfailed, 0 failures |
| Convergência Py/TS (`test_convergence_py_ts.py`) | ✅ **7/7 passed** |
| Lint (`next lint`) | ⚠️ Não executável — falha de resolução de `@betedge/config/eslint-preset` (pré-existente, lockfile corrompido) |
| Frontend tests (vitest) | ⚠️ Não executável — node_modules não instalados (lockfile corrompido) |

### Garantias quantitativas confirmadas pelos testes de convergência:

1. `test_ts_files_exist` — arquivos TS essenciais presentes ✅
2. `test_zero_forbidden_quantitative_implementations` — zero implementações quantitativas proibidas no TS ✅
3. `test_no_vig_removal_in_any_ts_file` — nenhuma remoção de vig no TS ✅
4. `test_no_shin_implementation_in_tsx` — nenhuma implementação de Shin no TSX ✅
5. `test_no_metric_calculations_in_api_routes` — nenhum cálculo de métricas em API routes ✅
6. `test_odds_ts_no_quantitative_exports` — nenhum export quantitativo em odds.ts ✅
7. `test_convergence_summary` — resumo de convergência OK ✅

---

## 9. Fontes Adicionadas

| Fonte | Uso | Pesos | Carregamento |
|-------|-----|-------|--------------|
| Barlow Condensed | Títulos display (font-display) | 600, 700, 800 | `next/font/google` com variável CSS `--font-barlow` |
| Inter | Body text (existente) | Variável | `next/font/google` |

---

## 10. Arquivos Não Alterados

- **Python engine** (`services/engine/`) — intacto
- **API routes** (`apps/web/src/app/api/`) — intacto
- **Dados de rodovias** (`data/rodovias/`) — intacto (projeto KMCheck)
- **Service worker** (`sw.js`) — intacto (projeto KMCheck)
- **Shadow Mode config/pipeline** — intacto
- **Supabase schema/migrations** — intacto
