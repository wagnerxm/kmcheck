# Interface

## Visão geral

A interface do KM Check segue um estilo **"Dark Glass Premium"** — superfícies translúcidas com efeito de vidro (`backdrop-filter: blur`), cantos arredondados e gradientes sutis. Também oferece um **tema claro** com cartões escuros sobre fundo claro.

---

## Telas

O app tem 4 telas principais, controladas pela função `goToScreen(id)`:

| Tela | ID | Descrição |
|---|---|---|
| **Início** | `#scr-cam` | Tela principal: hero card com KM ao vivo, atalhos rápidos |
| **Rodovias** | `#scr-bases` | Gestão de rodovias: download, importação, lista |
| **Consulta** | `#scr-query` | Conversão Coordenada→KM e KM→Coordenada |
| **Configurações** | `#scr-settings` | Câmera, logo, legenda, serviços, contratos |

Além disso, há duas telas fullscreen sobrepostas:

| Tela | ID | Descrição |
|---|---|---|
| **Câmera** | `#camwrap` | Câmera fullscreen com legenda ao vivo |
| **Galeria** | `#gallerywrap` | Visualizador de fotos com swipe |

---

## Navegação

### Dock flutuante

A navegação principal é um **dock flutuante** centralizado na parte inferior (estilo iOS):

```
┌──────────────────────────────────────┐
│           📷 Registrar evidência     │  ← Botão grande da câmera
└──────────────────────────────────────┘
```

Na tela inicial, só aparece o botão grande da câmera. Nas demais telas, o dock é escondido e aparece o botão "Voltar" no cabeçalho.

### Atalhos (grid cards)

Na tela inicial, dois cards em grid dão acesso rápido:

- **Configurações** → `#scr-settings`
- **Gestão de Eixo** → `#scr-bases`

### Consulta

O botão de lupa no cabeçalho (`#search-toggle`) leva à tela de consulta.

---

## Componentes visuais

### Card (`.card`)

Superfície principal com efeito de vidro:

- Fundo translúcido com `backdrop-filter: blur(22px)`
- Borda `1px solid` com opacidade
- Cantos arredondados (`border-radius: 32px`)
- Sombra interna brilhante no topo + sombra externa
- Onda SVG decorativa no fundo (pseudoelemento `::before`)
- Animação de escala ao tocar (`:active`)

### Grid Card (`.gcard`)

Versão compacta do card para o grid 2×2 na tela inicial.

### Hero Card (`.hero`, `.heroPhoto`)

Card especial na tela inicial que exibe os dados do GPS ao vivo:

- Placa KM estilizada em SVG (`#kmsign`)
- Nome da rodovia, KM grande, estaca
- Latitude e longitude
- Fundo com gradiente escuro e onda SVG

### Botões

| Classe | Estilo |
|---|---|
| `.btn` | Botão padrão, border-radius pill |
| `.btn.gold` | Fundo verde-limão, texto escuro |
| `.btn.ghost` | Transparente, borda sutil |
| `.btn.small` | Versão compacta |

### Toast

Notificação flutuante centralizada na parte inferior (`.toast`). Aparece com `opacity: 1` e some após ~2.6s.

### Diálogos (`<dialog>`)

Modais nativos do HTML com estilo glass:

- `#dlg-svc` — Seleção de serviço + contrato (câmera)
- `#dlg-rotlock` — Dica de bloqueio de orientação
- `#dlg-kmz` — Seleção de rodovias na importação
- `#dlg-csv` — Identificação de rodovia do CSV
- `#dlg-logo` — Recorte de fundo da logo

---

## Tema claro/escuro

### Variáveis CSS

O tema é controlado por variáveis CSS no `:root`:

```css
:root {                              /* tema escuro (padrão) */
  --bg: #0a0c0e;
  --panel: #141719;
  --gold: #b7d92d;
  --text: #eef1f6;
  /* ... */
}

:root[data-theme="light"] {          /* tema claro */
  --bg: #f4f4f2;
  --panel: #f8fafc;
  --gold: #3b4559;
  --text: #1c2333;
  /* ... */
}
```

### Inversão no tema claro

No tema claro, **os cards ficam escuros** (inversão intencional):

```css
:root[data-theme="light"] .card {
  --panel: #101010;
  --text: #ffffff;
  background: #121212;               /* opaco, sem blur */
}
```

Isso cria um contraste forte: fundo claro com cartões pretos sólidos.

### Detecção e persistência

- O tema é salvo em `localStorage` como `kc-theme`
- Na abertura, um script no `<head>` aplica o tema **antes** do CSS carregar (evita flash)
- A troca é instantânea via `data-theme` no `<html>`

---

## Android: otimizações

O atributo `[data-android]` (detectado via user agent) desabilita:

- `backdrop-filter` em todas as superfícies (GPU fraca trava com blur)
- Ondas SVG decorativas nos cards (`:before`, `:after`)
- Transições nos botões da câmera
- Transições suaves no frame da câmera (reduzidas para 150ms)

---

## Acessibilidade

- `prefers-reduced-motion`: desabilita todas as transições e animações
- Botões com `aria-label` para leitores de tela
- `-webkit-tap-highlight-color: transparent` remove o flash azul padrão do WebKit
- `viewport-fit: cover` respeita safe areas (notch, home indicator)
- Safe area insets em `padding` do cabeçalho, navegação e barra da câmera

---

## Tipografia

| Família | Uso |
|---|---|
| `-apple-system, 'SF Pro', Inter, ...` | Interface geral (sans-serif do sistema) |
| `Arial, Helvetica, sans-serif` | Legenda gravada na foto |
| `Carlito` (woff2) | Disponível mas não usada na interface atual |

---

## Responsividade

- Layout flexbox vertical (`#app → header + main + nav`)
- `main` com `overflow-y: auto` e padding para o dock
- Cards com `max-width` implícito pelo padding da seção
- Câmera: adaptação total a retrato/paisagem via JS (`layoutOverlays`)
