# Componentes de Interface

Documentação dos componentes visuais e funcionais do KM Check, baseada exclusivamente no código-fonte (`index.html`).

---

## Sumário

1. [Cabeçalho (`header.top`)](#1-cabeçalho)
2. [Hero Card (`.heroPhoto`)](#2-hero-card)
3. [Dock flutuante (`nav`)](#3-dock-flutuante)
4. [Botão de captura — câmera (`#nav-cam`)](#4-botão-de-captura--câmera)
5. [Botão de retorno (`#header-back` / `#camback`)](#5-botão-de-retorno)
6. [Alternância de câmera (`#camflip`)](#6-alternância-de-câmera)
7. [Botões LD e LE (`#cam-ld` / `#cam-le`)](#7-botões-ld-e-le)
8. [Botão de serviços (`#cam-svc`)](#8-botão-de-serviços)
9. [Botão de configurações na câmera (`#cam-settings`)](#9-botão-de-configurações-na-câmera)
10. [Galeria (`#gallerywrap`)](#10-galeria)
11. [Flash (`#cam-flash`)](#11-flash)
12. [Legenda ao vivo (`#liveplate`)](#12-legenda-ao-vivo)
13. [Obturador (`#shutter`)](#13-obturador)
14. [Seletor de proporção (`#camratio`)](#14-seletor-de-proporção)
15. [Dialogs (`<dialog>`)](#15-dialogs)
16. [Toast (`#toast`)](#16-toast)
17. [Campos de formulário](#17-campos-de-formulário)
18. [Seletores de lista (`.ct-item`)](#18-seletores-de-lista)
19. [Grid Cards (`.gridcards`)](#19-grid-cards)
20. [Abas de configurações (`.settabs`)](#20-abas-de-configurações)
21. [Overlays (`#camwrap` / `#cammask`)](#21-overlays)
22. [Telas vazias (`.empty`)](#22-telas-vazias)
23. [Mensagens de erro](#23-mensagens-de-erro)
24. [Barra inferior da câmera (`#cambar2`)](#24-barra-inferior-da-câmera)
25. [Piscada do obturador (`#camflashfx`)](#25-piscada-do-obturador)

---

## 1. Cabeçalho

### Finalidade

Barra fixa superior com logo, versão, botão voltar e acesso à consulta.

### Localização no código

- **HTML:** `<header class="top">` (linhas 446–452).
- **CSS:** classe `header.top` (linhas 96–104).
- **JS:** `goToScreen()` alterna visibilidade do botão voltar e do logo (linhas 1090–1108).

### Estados possíveis

| Estado | Condição | Visual |
|--------|----------|--------|
| **Tela inicial** | `scr-cam` ativo | Logo visível, botão voltar oculto |
| **Tela secundária** | `scr-bases`, `scr-query`, `scr-settings` | Logo oculto, botão voltar visível |
| **Câmera aberta** | `openCam()` ativo | Header inteiro oculto (`display:none`) |

### Comportamento no iOS

- Respeita `env(safe-area-inset-top)` para não colidir com o notch/Dynamic Island.
- `backdrop-filter: blur(20px) saturate(150%)` cria efeito translúcido.

### Comportamento no Android

- `[data-android]` remove `backdrop-filter` e aplica `background: var(--glassbg2)` opaco para evitar travamento de GPU.

### Comportamento vertical/horizontal

- Sem alteração de layout entre orientações. O cabeçalho é ocultado quando a câmera está aberta, então a rotação não o afeta.

### Dependências

- Logo: imagem `logo-header.png`.
- Botão consulta (`#search-toggle`): navega para `scr-query`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter `position: sticky; top: 0; z-index: 30`.
- Respeitar `env(safe-area-inset-top)` no padding-top.
- Não adicionar `backdrop-filter` em versão Android.

---

## 2. Hero Card

### Finalidade

Cartão principal da tela inicial que exibe a leitura GPS ao vivo: placa da rodovia (SVG), KM interpolado, estaca rodoviária e coordenadas.

### Localização no código

- **HTML:** `<div class="card hero heroPhoto">` (linhas 522–546).
- **CSS:** classes `.hero`, `.heroPhoto`, `.herotop`, `.herokm`, `.heroroad`, `.heroestaca`, `.herostats` (linhas 159–188).
- **JS:** `paintGps()` atualiza conteúdo textual (linhas 1604–1637).

### Estados possíveis

| Estado | Condição | Visual |
|--------|----------|--------|
| **Sem GPS** | `S.pos === null` | KM, coordenadas e placa exibem `"—"` |
| **GPS sem rodovia** | `S.pos` existe, `S.fix === null` | Coordenadas exibidas, KM e placa `"—"` |
| **GPS com rodovia** | `S.fix` existe, `dist ≤ maxdist` | KM, estaca, placa e coordenadas preenchidos |
| **Fora do eixo** | `S.fix.dist > CFG.maxdist` | KM recebe classe `.errc` (cor vermelha) |

### Elementos internos

| ID | Conteúdo |
|----|----------|
| `#kmsign` | SVG da placa rodoviária (BR + KM) |
| `#sign-br` | Texto BR na placa (ex.: `BR-226`) |
| `#sign-km` | Texto KM na placa (ex.: `409`) |
| `#kmbig` | KM interpolado grande (ex.: `409,120`) |
| `#herobr` | Rodovia/UF (ex.: `BR-226/RN`) |
| `#heroestaca` | Estaca rodoviária (ex.: `Est. 20456+0`) |
| `#latval` | Latitude formatada |
| `#lonval` | Longitude formatada |

### Comportamento no iOS

- Ondas SVG decorativas (pseudo-elemento `::after`) no fundo. Gradiente premium.

### Comportamento no Android

- Ondas SVG desabilitadas (`[data-android] .card::before` com `display:none`).
- Sem `backdrop-filter`.

### Comportamento vertical/horizontal

- Sem alteração específica; o hero card está na tela inicial que é oculta quando a câmera abre.

### Dependências

- `paintGps()` — chamado a cada tick do GPS.
- `S.pos`, `S.fix` — estado global.
- Funções `fkm()`, `fc()`, `estacaDe()`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Atualizar texto sem recriar DOM (evitar reflow/flicker).
- Manter `position: relative; z-index: 1` nos elementos de conteúdo para ficarem acima do `::after`.

---

## 3. Dock flutuante

### Finalidade

Navegação inferior estilo iOS com botão grande da câmera no centro.

### Localização no código

- **HTML:** `<nav class="nav2 nav1">` (linhas 801–806).
- **CSS:** classe `nav` (linhas 111–136).
- **JS:** `goToScreen()` controla visibilidade (linha 1100).

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Tela inicial** | Visível — apenas botão de câmera |
| **Tela secundária** | Oculto (`display:none`) |
| **Câmera aberta** | Oculto (`display:none`) |

### Comportamento no iOS

- Glass premium com blur + saturação. `env(safe-area-inset-bottom)` respeita a barra Home.

### Comportamento no Android

- `backdrop-filter` removido. Background opaco `rgba(24,26,28,.92)`.

### Comportamento vertical/horizontal

- Sem alteração. O dock é oculto na câmera, que é o único contexto onde a orientação muda.

### Dependências

- `openCam()` — vinculado ao `#nav-cam`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter `z-index: 40` (abaixo da câmera `z-index: 50`).
- Manter `position: fixed; bottom` com `env(safe-area-inset-bottom)`.
- Classe `nav1` transforma em layout vertical centralizado (apenas botão de câmera).

---

## 4. Botão de captura — câmera

### Finalidade

Botão grande proeminente que abre a câmera fullscreen.

### Localização no código

- **HTML:** `<button id="nav-cam" class="camnav">` (linha 803).
- **CSS:** `nav button.camnav` (linhas 121–130).
- **JS:** `document.getElementById('nav-cam').onclick = openCam` (linha 1119).

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Normal** | Borda verde (`rgba(183,217,45,.7)`), ícone de câmera branco |
| **Pressionado** | `transform: scale(1.02)` |

### Comportamento no iOS

- Glass premium com blur. Ícone de câmera em SVG.

### Comportamento no Android

- Sem `backdrop-filter`. Background opaco.

### Comportamento vertical/horizontal

- O dock é oculto na câmera, sem rotação.

### Dependências

- `openCam()`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter padding `18px` (maior que os demais botões do dock).
- Manter borda verde para destaque visual.

---

## 5. Botão de retorno

### Finalidade

Navegar de volta à tela inicial. Existe em dois contextos: cabeçalho geral e câmera.

### Localização no código

| Contexto | ID | HTML | JS |
|----------|----|------|-----|
| **Cabeçalho** | `#header-back` | Linha 447 | Linhas 1112–1117 |
| **Câmera** | `#camback` | Linha 814 | Linha 2197 |

### Estados possíveis

**Cabeçalho (`#header-back`):**

| Estado | Condição | Visual |
|--------|----------|--------|
| **Oculto** | Tela inicial (`scr-cam`) | `display: none` |
| **Visível** | Qualquer outra tela | Ícone `<` + texto "Voltar" |
| **Retorno à câmera** | `settingsFromCam === true` e tela de config ativa | Em vez de `goToScreen`, chama `openCam()` |

**Câmera (`#camback`):**

| Estado | Visual |
|--------|--------|
| **Normal** | Ícone `<` translúcido na barra superior |

### Comportamento no iOS

- O `#camback` respeita `env(safe-area-inset-top)` via padding do `#camtopbar`.

### Comportamento no Android

- Sem diferenças visuais além da ausência de blur.

### Comportamento vertical/horizontal

- **Paisagem:** o `#camtopbar` muda para coluna vertical (`flex-direction: column`) à esquerda; o botão voltar fica no topo da coluna.

### Dependências

- `closeCam()`, `goToScreen()`, flag `settingsFromCam`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter o fluxo `settingsFromCam` para retornar diretamente à câmera quando configurações foram abertas de dentro dela.

---

## 6. Alternância de câmera

### Finalidade

Trocar entre câmera traseira (`environment`) e frontal (`user`).

### Localização no código

- **HTML:** `<button id="camflip" class="topbtn">` (linha 815).
- **CSS:** `.topbtn` (linhas 259–261).
- **JS:** linha 2198.

### Estados possíveis

| Estado | Condição |
|--------|----------|
| **Traseira** | `S.facing === 'environment'` |
| **Frontal** | `S.facing === 'user'` — vídeo espelhado (`scaleX(-1)`) |

### Processamento

Ao clicar: fecha a câmera instantaneamente (`closeCam(true)`), inverte `S.facing`, e reabre (`openCam()`).

### Comportamento no iOS

- Funciona normalmente. A troca é imperceptível graças ao `closeCam(true)` sem animação.

### Comportamento no Android

- Sem diferenças.

### Comportamento vertical/horizontal

- **Paisagem:** ícone se posiciona abaixo do voltar na coluna esquerda.

### Dependências

- `closeCam(true)`, `openCam()`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter `closeCam(true)` (instantâneo) para evitar flash preto durante a troca.

---

## 7. Botões LD e LE

### Finalidade

Indicar se a foto está sendo tirada no Lado Direito (LD) ou Lado Esquerdo (LE) da rodovia. Informação gravada na legenda.

### Localização no código

- **HTML:** `<button class="cbtn cbtag cbmini" id="cam-ld">LD</button>` e `<button ... id="cam-le">LE</button>` (linhas 836–837).
- **CSS:** `.cbtn`, `.cbmini`, `.on` (linhas 322–329).
- **JS:** `getSide()`, `paintTags()`, handlers de click (linhas 2279–2291).

### Estados possíveis

| Estado | Visual | Valor em localStorage |
|--------|--------|----------------------|
| **Nenhum selecionado** | Ambos sem destaque | `kc-side` vazio |
| **LD ativo** | `#cam-ld` com `.on` (fundo verde) | `kc-side = 'LD'` |
| **LE ativo** | `#cam-le` com `.on` (fundo verde) | `kc-side = 'LE'` |

### Comportamento toggle

Clicar no botão já ativo desativa (volta a vazio). Apenas um pode estar ativo por vez.

### Comportamento no iOS

- Os ícones giram pelo acelerômetro (CSS `transform: rotate(...)` aplicada pelo JS em todos `.cbtn` e `.topbtn`).

### Comportamento no Android

- Transições desabilitadas (`[data-android] .cbtn { transition: none }`).

### Comportamento vertical/horizontal

- **Paisagem:** os botões ficam em coluna vertical na lateral esquerda da barra inferior.

### Dependências

- `paintTags()`, `paintGps()` — atualiza a legenda ao alternar.
- `getSide()` — lido por `legendLines()` para montar a linha 1.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter o toggle exclusivo (LD ou LE, nunca ambos).
- Manter a persistência em `kc-side`.

---

## 8. Botão de serviços

### Finalidade

Abrir o diálogo de seleção rápida de serviço e contrato diretamente da câmera.

### Localização no código

- **HTML:** `<button class="cbtn cbtag cbmini" id="cam-svc">i</button>` (linha 838).
- **JS:** handler abre `#dlg-svc` via `.showModal()` (linha 2323).

### Estados possíveis

| Estado | Visual | Condição |
|--------|--------|----------|
| **Sem seleção** | Sem destaque | Nem serviço nem contrato selecionado |
| **Com seleção** | `.on` (fundo verde) | `getSvcSel()` ou `getContract()` não vazio |

### Comportamento no iOS

- O `<dialog>` abre com `::backdrop` translúcido.

### Comportamento no Android

- `backdrop-filter` removido no `<dialog>`.

### Comportamento vertical/horizontal

- O botão acompanha a barra inferior; em paisagem, fica na coluna vertical esquerda.

### Dependências

- `renderSvcGrid()`, `renderContracts2()`, `paintTags()`, `paintGps()`.
- `#dlg-svc` (`<dialog>` de serviço/contrato).

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter sincronização entre as listas de serviços no diálogo e na tela de configurações.

---

## 9. Botão de configurações na câmera

### Finalidade

Acesso rápido à tela de configurações sem fechar definitivamente a câmera.

### Localização no código

- **HTML:** `<button class="cbtn cbmini" id="cam-settings">` (linha 842).
- **JS:** handler fecha a câmera e abre configurações com flag `settingsFromCam = true` (linha 2379).

### Estados possíveis

- Único estado: sempre visível na barra inferior da câmera.

### Comportamento especial

Ao retornar via botão voltar, se `settingsFromCam === true`, o app reabre a câmera em vez de voltar à tela inicial.

### Comportamento no iOS/Android

- Sem diferenças de comportamento.

### Comportamento vertical/horizontal

- **Paisagem:** fica na coluna vertical direita da barra inferior.

### Dependências

- `closeCam()`, `goToScreen('scr-settings')`, flag `settingsFromCam`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter o fluxo de retorno via `settingsFromCam`.

---

## 10. Galeria

### Finalidade

Visualizar fotos já registradas pelo app, armazenadas no IndexedDB (`photos`). Suporte a swipe com inércia.

### Localização no código

- **HTML:** `<div id="gallerywrap">` (linhas 890–896).
- **CSS:** `#gallerywrap` (linhas 360–365).
- **JS:** `openGallery()`, `paintGalPhoto()`, touch events para swipe (linhas 2417–2486).

### Estados possíveis

| Estado | Condição | Visual |
|--------|----------|--------|
| **Fechada** | `display: none` | Não visível |
| **Aberta** | Classe `.on` adicionada | Overlay fullscreen preto |
| **Sem fotos** | `galPhotos.length === 0` | Toast: "Nenhuma foto registrada ainda." |

### Elementos internos

| ID | Função |
|----|--------|
| `#gal-close` | Botão voltar (fechar galeria) |
| `#gal-stage` | Container do swipe |
| `#gal-img` | Imagem da foto atual |
| `#gal-caption` | Contador + nome (`"3 / 15 · BR-226RN - KM 409,120 143521.jpg"`) |

### Swipe

- **Touch events** no `#gal-stage`: `touchstart`, `touchmove`, `touchend`.
- **Inércia:** velocidade (`vx`) calculada durante o arrasto; se `|vx| > 0.4`, avança/recua mesmo com pouco deslocamento.
- **Elástico:** na primeira e última foto, o arrasto é amortecido (`dx *= 0.3`).
- **Transição:** classe `.gal-anim` controla a transição CSS.
- **Threshold:** `20%` da largura do stage.

### Comportamento no iOS

- `#gal-close` com `backdrop-filter: blur(20px)`.

### Comportamento no Android

- `#gal-close` sem blur, background opaco `rgba(16,16,16,.92)`.

### Comportamento vertical/horizontal

- Sem tratamento especial. O overlay cobre toda a tela em ambas orientações.

### Dependências

- `getAllPhotos()` (IndexedDB), `savePhotoToGallery()`.

### Problemas conhecidos

- Não há zoom (pinch-to-zoom) — listado no backlog como F1.
- Não há exclusão de fotos — listado no backlog como F2.

### Regras para alterações

- Manter `z-index: 51` (acima da câmera `z-index: 50`).
- Manter touch events `{passive: true}` para performance de scroll.
- `URL.createObjectURL` deve ser revogado após uso para evitar vazamento de memória. **Necessita validação técnica:** verificar se há `URL.revokeObjectURL` no código atual.

---

## 11. Flash

### Finalidade

Ativar/desativar a lanterna (torch) do dispositivo via API de constraints do vídeo.

### Localização no código

- **HTML:** `<button class="cbtn cbmini" id="cam-flash">` (linha 843).
- **JS:** `initFlashSupport()`, `paintFlashIcon()`, handler de click (linhas 2382–2403).

### Estados possíveis

| Estado | Condição | Visual |
|--------|----------|--------|
| **Desligado** | `flashOn === false` | Botão sem destaque |
| **Ligado** | `flashOn === true` | Classe `.on` (fundo verde) |
| **Não suportado** | `flashSupported === false` | Toast: "Este aparelho/navegador não permite controlar o flash pelo app." |

### Processamento

```js
track.applyConstraints({ advanced: [{ torch: flashOn }] });
```

### Comportamento no iOS

- Safari geralmente **não suporta** `torch` — o botão aparece mas exibe toast ao clicar.

### Comportamento no Android

- Funciona na maioria dos dispositivos Chrome. `getCapabilities().torch` detecta suporte.

### Comportamento vertical/horizontal

- **Paisagem:** fica na coluna vertical direita.

### Dependências

- `S.stream` — stream da câmera deve estar ativo.
- `initFlashSupport()` — chamado em `openCam()` após obter o stream.

### Problemas conhecidos

- No iOS/Safari, a API de torch não é exposta, resultando sempre em "não suportado".

### Regras para alterações

- Sempre detectar suporte via `getCapabilities()` antes de tentar ativar.
- `initFlashSupport()` deve ser chamado a cada `openCam()` (o track muda ao trocar câmera).

---

## 12. Legenda ao vivo

### Finalidade

Exibir em tempo real sobre o preview da câmera as informações que serão gravadas na foto.

### Localização no código

- **HTML:** `<div id="liveplate">` (linha 824), dentro de `#camframe`.
- **CSS:** `#liveplate` e filhos `.l1`, `.l2` (linhas 307–310).
- **JS:** `paintGps()` atualiza conteúdo (linhas 1623–1637), `styleLivePlate()` e `layoutOverlays()` posicionam.

### Conteúdo (gerado por `legendLines`)

| Linha | Conteúdo | Exemplo |
|-------|----------|---------|
| L1 | BR/UF – KM + lado + estaca + alerta | `BR-226/RN - KM 409,120 LD · Est. 20456+0` |
| L2 | Contrato – Serviço (ou OAE) | `CT 00803/2024 - Roçada` |
| L3 | Coordenadas | `-6,077710, -37,891500 (±12m)` |
| L4 | Data/hora | `06/08/2026, 14:35` |

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Normal** | Texto branco com sombra |
| **Erro (fora do eixo)** | Classe `.err` — L1 fica com cor `#ff9d8a` |
| **Negrito** | Classe `.bold` — `font-weight: 700` |

### Comportamento no iOS/Android

- **Android:** `paintGps()` atualiza texto **sem recriar o DOM** (compara `textContent` de cada `<div>` filho e só altera se mudou). Evita reflow/flicker.
- Estilização (cor, opacidade, tamanho, posição) vem de `styleLivePlate()`, que lê `CFG`.

### Comportamento vertical/horizontal

- O `#camframe` (container da legenda + logo) gira pelo acelerômetro (`transform: rotate()`). A legenda fica "em pé" em relação ao mundo real, independente da orientação do celular.

### Dependências

- `buildInfo()`, `legendLines()`, `styleLivePlate()`, `layoutOverlays()`.
- `CFG`: `legpos`, `legcolor`, `legop`, `legsz`, `legbold`, `coord`, `coordstyle`, `datestyle`, `estaca`, `acc`, `oae`, `maxdist`.

### Problemas conhecidos

- Em GPS instável, o texto pode mudar rapidamente. A otimização de DOM mitiga o flicker visual.

### Regras para alterações

- **Nunca recriar o DOM a cada tick** — sempre comparar e atualizar apenas os textos que mudaram.
- Manter `pointer-events: none` no `#liveplate`.
- Respeitar a ordem das linhas (BR/KM, serviço, coordenadas, data).

---

## 13. Obturador

### Finalidade

Capturar a foto com todos os metadados (legenda, logo, EXIF).

### Localização no código

- **HTML:** `<button id="shutter">` (linha 840).
- **CSS:** `#shutter` (linhas 330–336).
- **JS:** handler de click (linhas 2224–2276).

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Normal** | Botão grande com pseudo-elemento `::before` (círculo branco interno) |
| **Pressionado** | `transform: scale(1.04)` |
| **Câmera carregando** | Toast: "Câmera ainda carregando…" |

### Feedback ao disparo

1. **Piscada** — `#camflashfx` animação de 180ms (preto rápido).
2. **Vibração** (Android) — `navigator.vibrate([40, 25, 40])` (dois toques).
3. **Som** — `playShutterSound()` se `CFG.soundalert` ativo (ruído filtrado via Web Audio).

### Processamento

1. Verifica `video.videoWidth` (câmera pronta).
2. Calcula recorte baseado na proporção (`CFG.format`).
3. Desenha no canvas com rotação compensada pelo tilt.
4. `burnLegend()` grava legenda no canvas.
5. `toDataURL('image/jpeg', CFG.qual)` → bytes.
6. `insertExif()` injeta EXIF GPS.
7. `saveAndShare()` salva/compartilha.

### Comportamento no iOS

- `navigator.share({files:[file]})` abre menu nativo "Salvar Imagem".
- Vibração não disponível (limitação do Safari).

### Comportamento no Android

- `<a download>` salva diretamente na pasta de downloads.
- Vibração dupla funciona.

### Comportamento vertical/horizontal

- A rotação do tilt (`S.tilt`) é compensada no canvas para que a foto saia "em pé".

### Dependências

- `buildInfo()`, `legendLines()`, `burnLegend()`, `buildExifApp1()`, `insertExif()`, `saveAndShare()`, `playShutterSound()`.
- `S.stream`, `S.tilt`, `S.sensorTilt`, `CFG.format`, `CFG.qual`, `CFG.soundalert`.

### Problemas conhecidos

- Processamento síncrono (`toDataURL`) pode causar jank perceptível em resoluções altas.

### Regras para alterações

- Manter o feedback (flash + vibração + som) **antes** do processamento pesado do canvas.
- Nunca mover o `toDataURL` para depois do feedback visual — o retorno tátil deve ser imediato.

---

## 14. Seletor de proporção

### Finalidade

Escolher a proporção da foto (1:1, 4:3, 16:9) diretamente na tela da câmera.

### Localização no código

- **HTML:** `<div id="camratio">` com 3 `<button class="ratiobtn">` (linhas 829–833).
- **CSS:** `#camratio`, `.ratiobtn` (linhas 265–271).
- **JS:** `paintRatioSel()` destaca o ativo, handlers trocam `CFG.format` (via `localStorage`).

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Ativo** | Classe `.on` (fundo verde, texto escuro) |
| **Inativo** | Texto branco semitransparente |

### Comportamento no iOS/Android

- Sem diferenças.

### Comportamento vertical/horizontal

- **Paisagem:** muda para `flex-direction: column` e posiciona entre a coluna esquerda e o palco.

### Dependências

- `CFG.format` (localStorage `kc-format`).
- `layoutOverlays()` — recalcula a área útil da câmera ao trocar.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter valores `data-fmt` como `"1:1"`, `"3:4"`, `"9:16"` (invertidos em relação ao rótulo visual).

---

## 15. Dialogs

### Finalidade

Janelas modais nativas (`<dialog>`) para interações que requerem foco.

### Localização no código

| ID | Finalidade | HTML |
|----|-----------|------|
| `#dlg-svc` | Seleção de serviço e contrato na câmera | Linhas 852–868 |
| `#dlg-rotlock` | Dica de bloqueio de orientação (iPhone) | Linhas 872–887 |
| `#dlg-kmz` | Escolher BRs de um KMZ importado | Linhas 900–907 |
| `#dlg-csv` | Identificar rodovia de um CSV | Linhas 910–921 |
| `#dlg-logo` | Recorte de fundo da logo | Linhas 924–936 |

### Estados possíveis

| Estado | Método |
|--------|--------|
| **Fechado** | Estado padrão |
| **Aberto** | `.showModal()` — foco modal, `::backdrop` escurece o fundo |

### Comportamento no iOS

- `::backdrop` com blur e transparência.

### Comportamento no Android

- `[data-android] dialog` sem `backdrop-filter`, background opaco.
- `[data-android] dialog::backdrop` sem blur.

### Comportamento vertical/horizontal

- Sem tratamento especial. Dialogs centralizam automaticamente.

### `#dlg-rotlock` — comportamento especial

- Aparece **apenas** quando a página gira para paisagem (prova de que o bloqueio do iPhone está desligado).
- Opção "Não mostrar" persiste em `kc-rotlock-never`.

### Dependências

- Cada dialog tem seus próprios botões de ação/cancelar.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Sempre usar `<dialog>` nativo e `.showModal()` (não `display`/`visibility`).
- Respeitar os estilos Android (sem blur).

---

## 16. Toast

### Finalidade

Mensagem efêmera não-intrusiva na parte inferior da tela.

### Localização no código

- **HTML:** `<div class="toast" id="toast">` (linha 938).
- **CSS:** `.toast` (linhas 432–433).
- **JS:** `function toast(msg, ms)` (linha 1120).

### Implementação

```js
function toast(msg, ms) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), ms || 2600);
}
```

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Oculto** | `opacity: 0` (padrão) |
| **Visível** | Classe `.on` → `opacity: 1`, transição de 250ms |

### Estilo

- Posição fixa, centralizada horizontalmente, `bottom: 96px + safe-area`.
- Fundo escuro translúcido com borda verde, `border-radius: 999px` (pílula).
- `z-index: 60` (acima de tudo exceto `#cammask`).

### Comportamento no iOS

- Com blur.

### Comportamento no Android

- Sem blur, background opaco.

### Comportamento vertical/horizontal

- Sem tratamento específico.

### Dependências

- Nenhuma.

### Problemas conhecidos

- Toasts consecutivos rápidos: o segundo substitui o texto do primeiro e reinicia o timer. Não há fila.

### Regras para alterações

- Manter duração padrão de 2600ms.
- Manter `max-width: 88vw` para telas estreitas.
- Não empilhar toasts; usar um único elemento.

---

## 17. Campos de formulário

### Finalidade

Inputs, selects e textareas para configurações e importação de dados.

### Localização no código

- **CSS:** `input[type=text], input[type=number], textarea, select` (linhas 225–229).
- **HTML:** distribuídos pelas telas `scr-bases`, `scr-query`, `scr-settings`.

### Estilo base

- Fundo `#0b0d0f`, borda `rgba(255,255,255,.07)`, `border-radius: 14px`.
- Foco: borda verde `rgba(183,217,45,.5)`.
- Font: `var(--mono)`, 15px.

### Tipos usados

| Tipo | Exemplos de IDs |
|------|-----------------|
| `text` | `#dl-br-custom`, `#svc-new`, `#ct-new`, `#csv-br`, `#csv-uf` |
| `number` | `#cfg-maxdist` |
| `textarea` | `#q-coords` |
| `select` | `#dl-uf`, `#dl-br`, `#cfg-res`, `#cfg-qual`, `#cfg-format`, `#cfg-legpos`, `#cfg-legcolor`, etc. |
| `range` | `#cfg-logoop`, `#cfg-logosz`, `#cfg-legop`, `#logo-tol` |
| `checkbox` | `#cfg-soundalert`, `#cfg-autoaccept`, `#cfg-autosave`, `#cfg-lighttheme`, `#cfg-estaca`, `#cfg-oae`, `#cfg-coord`, `#cfg-acc`, `#cfg-legbold` |
| `file` | `#filein`, `#logoin` |

### Comportamento no iOS/Android

- `inputmode="decimal"` e `inputmode="numeric"` abrem teclados específicos.
- Sem diferenças visuais além do tema do sistema.

### Comportamento vertical/horizontal

- Sem tratamento específico; campos estão em telas que não rotacionam.

### Dependências

- Cada campo está vinculado a uma chave `kc-*` em localStorage.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter `border-radius: 14px` consistente.
- Manter `accent-color: var(--gold)` para checkboxes e ranges.

---

## 18. Seletores de lista

### Finalidade

Listas de itens selecionáveis com radio-button visual (dot) para serviços, contratos e rodovias.

### Localização no código

- **CSS:** `.ct-item`, `.ct-item.sel`, `.dot` (linhas 237–246).
- **JS:** `renderContracts()`, `renderContracts2()`, `renderSvcGrid()`, `renderServices()`.

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Normal** | Dot: borda cinza, vazio. Texto: cor padrão |
| **Selecionado** | Classe `.sel` — dot: borda verde, preenchido verde com sombra. Texto: verde bold |

### Elementos internos

| Classe | Conteúdo |
|--------|----------|
| `.dot` | Radio visual (18×18px, circular) |
| `.num` | Nome/número do item |
| `.del` | Botão "remover" (aparece dentro de cada item) |

### Rolagem interna

- `#svclist, #ctlist` com `max-height: 168px; overflow-y: auto` — a partir de ~3 itens, rola dentro do cartão.
- `.pk-list` (dentro do diálogo `#dlg-svc`) com `max-height: 150px`.

### Comportamento no iOS/Android

- Sem diferenças.

### Comportamento vertical/horizontal

- Sem tratamento específico.

### Dependências

- LocalStorage: `kc-services`, `kc-svcsel`, `kc-contracts`, `kc-contract`, `kc-svc-removed`.
- Array constante `SVC_PADRAO` (serviços padrão built-in).

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter a lista em ordem alfabética (`.sort((a,b) => a.localeCompare(b, 'pt', ...))`).
- Serviços padrão removidos devem ir para `kc-svc-removed`, não ser apagados do array.

---

## 19. Grid Cards

### Finalidade

Atalhos rápidos na tela inicial em grid 2 colunas (Configurações, Gestão de Eixo).

### Localização no código

- **HTML:** `<div class="gridcards">` (linhas 548–561).
- **CSS:** `.gridcards`, `.gcard`, `.gbadge`, `.gtitle`, `.glink`, `.garrow` (linhas 189–208).
- **JS:** `data-goto` handler (linha 1110).

### Elementos internos

| Elemento | Função |
|----------|--------|
| `.gbadge` | Ícone circular com SVG |
| `.gtitle` | Título do atalho |
| `.glink` | Subtítulo descritivo |
| `.garrow` | Seta decorativa (SVG) |

### Comportamento no iOS

- Glass premium com ondas SVG decorativas (`::after`).

### Comportamento no Android

- Sem blur, ondas desabilitadas (`[data-android] .gcard::after { display: none }`).

### Comportamento vertical/horizontal

- Sem tratamento específico; grid está na tela inicial (não rotaciona).

### Dependências

- `goToScreen()` via `data-goto`.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter `grid-template-columns: 1fr 1fr` para simetria visual.
- Usar `border-radius: 26px` (arredondamento generoso).

---

## 20. Abas de configurações

### Finalidade

Organizar configurações em 3 painéis: Câmera, Logo e Legenda.

### Localização no código

- **HTML:** `<div class="settabs">` com 3 `<button class="settab">` (linhas 569–582).
- **HTML:** 3 `<div class="settabpane">` com IDs `tab-cam`, `tab-logo`, `tab-leg` (linhas 585–795).
- **JS:** handler que alterna classes `.on` (linhas 2740–2744).

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Ativa** | Classe `.on` no botão e no painel correspondente |
| **Inativa** | Sem classe `.on`; painel oculto |

### Comportamento no iOS/Android

- Sem diferenças.

### Comportamento vertical/horizontal

- Sem tratamento específico.

### Dependências

- Atributo `data-tab` vincula o botão ao ID do painel.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter a correspondência `data-tab` ↔ ID do painel.

---

## 21. Overlays

### Finalidade

Camadas fullscreen que cobrem a interface.

### `#camwrap` — Overlay da câmera

- **HTML:** linha 811.
- **CSS:** `z-index: 50`, fundo preto, `position: fixed; inset: 0` (linhas 250–252).
- **Animação:** `camIn` (fade in 200ms), `camOut` (fade out 150ms).
- **Paisagem:** muda para `flex-direction: row` (barras nas laterais).

### `#cammask` — Máscara de rotação

- **HTML:** linha 848.
- **CSS:** `z-index: 70`, fundo preto, `opacity: 0` por padrão (linha 279).
- **JS:** `_maskRotation()` ativa opacidade 1 instantaneamente e revela com fade após o layout assentar (linhas 1936–1944+).
- **Propósito:** cobre toda a câmera durante o rearranjo do giro da página, para que o reflow aconteça invisível.

### Comportamento no iOS

- `_maskRotation` é disparada por `orientationchange` e `screen.orientation.change`.

### Comportamento no Android

- Mesma lógica, disparada pelos mesmos eventos.

### Problemas conhecidos

- O timing da máscara (fade reveal) é empírico. Em dispositivos lentos, pode revelar antes do layout assentar.

### Regras para alterações

- `#cammask` deve ter o `z-index` mais alto (70, acima de tudo).
- Não usar transição na ativação (preto instantâneo); usar fade apenas na revelação.

---

## 22. Telas vazias

### Finalidade

Feedback visual quando uma lista não tem itens.

### Localização no código

- **CSS:** `.empty` (linha 247).
- **JS:** usado em `renderContracts2()` e `renderContracts()` quando a lista está vazia.

### Estilo

```css
.empty {
  color: var(--mut);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
  padding: 18px 8px;
}
```

### Exemplo

```html
<p class="empty">Nenhum contrato cadastrado.<br>Adicione abaixo o número do contrato.</p>
```

### Comportamento no iOS/Android

- Sem diferenças.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter texto orientativo (não apenas "Vazio").

---

## 23. Mensagens de erro

### Finalidade

Indicar estados de erro ou atenção na interface.

### Tipos implementados

| Mecanismo | Visual | Exemplo |
|-----------|--------|---------|
| **Classe `.errc`** | Cor vermelha (`var(--err)`) | KM grande fora do eixo |
| **Classe `.warnc`** | Cor amarela (`var(--warn)`) | KM na consulta com distância alta |
| **Classe `.okc`** | Cor verde (`var(--ok)`) | KM na consulta dentro do limite |
| **Toast** | Mensagem efêmera | "Câmera negada", "GPS indisponível" |
| **Texto inline** | Texto direto no elemento | `#gpsline`: "GPS indisponível: {msg}" |
| **`⚠` na legenda** | Ícone de alerta na linha L1 | Quando `dist > CFG.maxdist` |
| **`.err` no liveplate** | L1 com cor `#ff9d8a` | Legenda da câmera fora do eixo |
| **Texto na consulta** | `"sem eixo"` (colspan 3) | Consulta sem rodovia correspondente |

### Localização no código

- CSS: `.errc`, `.warnc`, `.okc` (variáveis globais).
- JS: `paintGps()` (linhas 1609–1611), `legendLines()` (linha 1666), consulta (linhas 2709–2711).

### Comportamento no iOS/Android

- Sem diferenças.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Usar as variáveis CSS `--err`, `--warn`, `--ok` (nunca cores hardcoded).
- Erros de GPS devem ser exibidos no `#gpsline`, não como toast.

---

## 24. Barra inferior da câmera

### Finalidade

Container fixo abaixo do preview da câmera com os controles de captura.

### Localização no código

- **HTML:** `<div id="cambar2">` (linhas 834–846).
- **CSS:** `#cambar2` (linhas 312–316).

### Layout

Grid de 3 colunas: `1fr auto 1fr`.

| Coluna | Classe | Conteúdo |
|--------|--------|----------|
| Esquerda | `.cbside.cbleft` | LD, LE, Serviço (i) |
| Centro | — | Obturador (`#shutter`) |
| Direita | `.cbside.cbright` | Configurações, Flash, Galeria |

### Comportamento no iOS

- Background `#141414` opaco (sem blur, decisão de design).
- `env(safe-area-inset-bottom)` no padding inferior.

### Comportamento no Android

- `[data-android] #cambar2` sem blur (redundante, já opaco).

### Comportamento vertical/horizontal

- **Paisagem:** muda para grid vertical (`grid-template-rows: 1fr auto 1fr`), barra à direita, safe-area à direita.

### Dependências

- Todos os botões internos (LD, LE, serviço, obturador, settings, flash, galeria).

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter o obturador centralizado (coluna `auto`).
- Respeitar `env(safe-area-inset-bottom)` em retrato e `env(safe-area-inset-right)` em paisagem.
- Botões menores (`.cbmini` 40×40px) para o obturador (84×84px) ser o foco.

---

## 25. Piscada do obturador

### Finalidade

Feedback visual instantâneo ao capturar a foto — a tela pisca preta por 180ms.

### Localização no código

- **HTML:** `<div id="camflashfx">` (linha 826).
- **CSS:** `#camflashfx`, animação `@keyframes camflash` (linhas 274–280).
- **JS:** ativado no handler do obturador (linhas 2228–2229).

### Estados possíveis

| Estado | Visual |
|--------|--------|
| **Inativo** | `opacity: 0`, `pointer-events: none` |
| **Ativo** | Classe `.on` → animação `camflash` de 180ms (preto → transparente) |

### Comportamento no iOS/Android

- Sem diferenças.

### Comportamento vertical/horizontal

- `position: absolute; inset: 0` — cobre toda a área do palco.

### Dependências

- Classe `.on` removida e readicionada com `void el.offsetWidth` para forçar restart da animação.

### Problemas conhecidos

- Nenhum registrado.

### Regras para alterações

- Manter duração curta (~180ms) para não atrapalhar o fluxo.
- Manter `z-index: 60` (acima do preview e da legenda).
- Manter `pointer-events: none`.
