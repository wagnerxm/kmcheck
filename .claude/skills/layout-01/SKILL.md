# Layout 01 — Design system para apps de campo DNIT

Use este design system ao criar novos apps PWA de campo para o DNIT.
O estilo é: **cards escuros glassmórficos sobre fundo claro quente**, com acento verde-limão,
tipografia do sistema Apple/Inter com labels uppercase espaçados, dock flutuante em pill escuro,
e header/nav translúcidos com blur.

---

## Paleta de cores

### Fundo (shell claro quente)
```
--bg: #f4f4f2
html background: linear-gradient(180deg, #f7f7f5 0%, #f1f2f3 100%)
body color: #1c2333
```

### Superfícies escuras (cards, painéis)
```
--panel: #121212        /* card principal */
--panel2: #1a1a1a       /* botões, inputs */
#0b0d0f                 /* inputs, headers de tabela */
#2a2d31                 /* header de tabela */
rgba(24,26,28,.88)      /* dock pill */
```

### Acento (verde-limão / gold)
```
--gold: #b7d92d         /* acento principal */
--gold2: #c9e463        /* variante mais clara */
--goldDim: rgba(183,217,45,.15)  /* fill sutil */
rgba(183,217,45,.35)    /* sombra FAB */
rgba(183,217,45,.3)     /* brilho logo, borda destaque */
#5a7a14 / #6a7d1a       /* texto sobre fundo gold */
--goldText: #0d0f08     /* texto escuro sobre gold */
```

### Status
```
--ok: #4caf50           /* verde — positivo/conforme */
--okBg: rgba(76,175,80,.12)
--nc: #ef5350           /* vermelho — negativo/não conforme */
--ncBg: rgba(239,83,80,.12)
--na: #9e9e9e           /* cinza — neutro/não aplicável */
--naBg: rgba(158,158,158,.10)
--warn: #d9a22b         /* âmbar — alerta */
```

### Texto
```
--text: #ffffff          /* primário sobre escuro */
--mut: #a0a0a0           /* muted sobre escuro */
--mutLight: #6a6a6a      /* muted sobre claro */
rgba(255,255,255,.45)    /* secundário sobre escuro */
rgba(255,255,255,.3)     /* terciário sobre escuro */
```

### Bordas e linhas
```
--line: rgba(255,255,255,.10)       /* divisor sobre escuro */
--glassBorder: rgba(255,255,255,.14) /* borda card escuro */
--glassRimTop: rgba(255,255,255,.12) /* rim superior inset */
--glassRimBot: rgba(255,255,255,.04) /* rim inferior inset */
rgba(0,0,0,.06)                      /* hairlines sobre claro */
```

---

## Tipografia

### Font stack
```css
--sans: -apple-system, 'SF Pro Display', 'SF Pro Text',
        'Inter Variable', Inter, 'DM Sans', Helvetica, sans-serif;
```

### Escala de tamanhos (px)
| Uso | Tamanho | Peso | Extras |
|-----|---------|------|--------|
| Micro-label (header sub) | 7.5–8 | 600 | uppercase, letter-spacing .14–.18em |
| Nav label, hint, legenda | 9 | 500–600 | uppercase, letter-spacing .1em |
| Field label, badge, seção | 10 | 600–700 | uppercase, letter-spacing .14–.2em |
| Corpo card, tabela | 11–12 | 400–600 | — |
| Título card, nome | 13–14 | 700–800 | letter-spacing -.01em |
| Input, botão | 15 | 600 | — |
| Logo, modal título | 17 | 800 | letter-spacing -.01em |
| Heading resultado | 18 | 800 | — |
| Stat valor | 22 | 800 | tabular-nums |
| Hero número | 38 | 800 | tabular-nums |

### Padrões de texto
- **Labels uppercase**: `text-transform: uppercase` + `letter-spacing .1–.2em` + `font-weight 600–700` + `font-size 8–10px`
- **Números tabulares**: `font-variant-numeric: tabular-nums` em stats, KMs, cálculos
- **Headings apertados**: `letter-spacing: -.01em`

---

## Efeitos de vidro (glassmorfismo)

### 1. Vidro claro (header, nav)
```css
background: rgba(244,244,242,.82);
backdrop-filter: blur(20px) saturate(150%);
-webkit-backdrop-filter: blur(20px) saturate(150%);
box-shadow: 0 1px 0 rgba(0,0,0,.06);
```

### 2. Vidro escuro (dock pill)
```css
background:
  linear-gradient(135deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,.02) 55%),
  rgba(24,26,28,.88);
backdrop-filter: blur(20px) saturate(150%);
-webkit-backdrop-filter: blur(20px) saturate(150%);
border-radius: 999px;
box-shadow:
  inset 0 1.5px 0 rgba(255,255,255,.12),
  inset 0 -1px 0 rgba(255,255,255,.04),
  0 14px 34px rgba(0,0,0,.45);
```

### 3. Card escuro (sem blur, com gradientes especulares)
```css
background:
  linear-gradient(135deg, rgba(255,255,255,.07) 0%, transparent 30%),
  linear-gradient(200deg, transparent 55%, rgba(255,255,255,.03) 60%, transparent 68%),
  #121212;
border: 1px solid rgba(255,255,255,.14);
border-radius: 26px;
box-shadow:
  inset 0 1px 0 rgba(255,255,255,.12),
  0 20px 45px rgba(0,0,0,.22),
  0 8px 18px rgba(0,0,0,.12);
```

### 4. Modal overlay
```css
background: rgba(0,0,0,.5);
backdrop-filter: blur(8px);
-webkit-backdrop-filter: blur(8px);
```

---

## Layout do app shell

```
html, body { height: 100%; overflow: hidden; overscroll-behavior: none }

#app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Header — sticky no topo, vidro claro */
header.top {
  flex-shrink: 0;
  position: sticky; top: 0; z-index: 30;
  padding: calc(12px + env(safe-area-inset-top,0px)) 20px 10px;
  /* vidro claro */
}

/* Main — área rolável */
main {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px;
}

/* Nav — flex item na base, vidro claro envolvendo pill escuro */
nav {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom,0px));
  z-index: 40;
  /* vidro claro */
}
nav .dock {
  display: flex; gap: 4px;
  /* vidro escuro pill */
}
```

### Navegação por telas
```css
.screen { display: none }
.screen.on { display: block; animation: scrIn .18s ease-out }
@keyframes scrIn { from { opacity: 0 } to { opacity: 1 } }
```

---

## Componentes

### Botão padrão (`.btn`)
```css
.btn {
  background: var(--panel2);
  color: var(--text);
  border: 1px solid var(--glassBorder);
  border-radius: 999px;          /* pill */
  padding: 15px 18px;
  font-size: 15px; font-weight: 600;
  width: 100%;
  transition: filter .15s;
}
.btn:active { filter: brightness(1.15) }
```

**Variantes:**
- `.btn.gold` — fundo `var(--gold)`, cor `#0d0f08`, peso 700 (CTA principal)
- `.btn.ghost` — fundo transparente, borda `rgba(255,255,255,.08)`, cor `var(--mut)`
- `.btn.danger` — fundo transparente, borda `rgba(239,83,80,.3)`, cor `var(--nc)`

### FAB (botão de ação flutuante)
```css
.fab {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--gold); color: #0d0f08;
  font-size: 24px; font-weight: 700;
  box-shadow: 0 4px 14px rgba(183,217,45,.35);
}
.fab:active { transform: scale(.9) }
```

### Card escuro
```css
.card {
  /* vidro escuro card (seção 3 acima) */
  padding: 22px;
  margin-bottom: 14px;
  color: var(--text);
}
```

### Stat tile (3 colunas)
```css
.stat-box {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  /* vidro escuro card */
  border-radius: 20px; padding: 14px 8px;
}
.stat-box .val { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums }
.stat-box .lbl { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .14em; color: var(--mut) }
```

### Input em contexto escuro
```css
input, select {
  background: #0b0d0f;
  border: 1px solid rgba(255,255,255,.07);
  color: #fff;
  border-radius: 14px;
  padding: 14px 16px;
  font-size: 15px;
}
input:focus { border-color: var(--gold); outline: none }
```

### Botão de nav (dentro do dock)
```css
nav .dock button {
  background: none; border: none;
  color: var(--mut);
  font-size: 9px; letter-spacing: .1em; text-transform: uppercase;
  padding: 8px 14px; border-radius: 999px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
nav .dock button.on {
  color: #0d0f08;
  background: var(--gold);
}
/* Ícones SVG: 20×20, stroke, sem fill */
nav .dock button svg {
  width: 20px; height: 20px;
  stroke: currentColor; fill: none;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}
```

---

## Safe areas (iOS notch/home indicator)
```css
/* Header: padding-top inclui notch */
padding: calc(12px + env(safe-area-inset-top, 0px)) 20px 10px;

/* Nav: padding-bottom inclui home indicator */
padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));

/* Viewport meta obrigatória */
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
```

---

## PWA (service worker e manifest)

### Service worker (`sw.js`)
- Cache nomeado com versão: `const CACHE = 'nome-app-vNNN'`
- **Rede-primeiro** para o documento (index.html / navegação)
- **Cache-primeiro** para assets (ícones, manifest)
- **Sempre incrementar** a versão ao alterar o app

### Manifest
```json
{
  "name": "Nome do App",
  "short_name": "App",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#b7d92d",
  "background_color": "#f4f4f2"
}
```

---

## Como usar esta skill

Ao pedir para criar um novo app neste design system, diga:
> "Faça no layout/design do PATO Desempenho"

Ou, se copiar esta pasta `.claude/skills/pato-design-system/` para outro repositório,
a skill ficará disponível automaticamente naquele projeto.

### Checklist de aplicação
1. ✅ Fundo claro quente `#f4f4f2` com gradiente sutil
2. ✅ Cards escuros `#121212` com gradientes especulares (não blur)
3. ✅ Header e nav com vidro claro translúcido + blur
4. ✅ Dock: pill escuro flutuante dentro do nav claro
5. ✅ Acento verde-limão `#b7d92d` para CTAs e estado ativo
6. ✅ Labels uppercase com letter-spacing generoso
7. ✅ Font stack do sistema (SF Pro / Inter)
8. ✅ Border-radius generoso (26px cards, 999px pills)
9. ✅ Rim highlights (inset box-shadow) nos cards e dock
10. ✅ Safe areas para iOS (env() no padding)
11. ✅ Single-file PWA: HTML + CSS + JS inline, sem build
12. ✅ Service worker com versionamento de cache
