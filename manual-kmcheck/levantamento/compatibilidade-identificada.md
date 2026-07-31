# KM Check — Compatibilidade Identificada

## 1. Plataformas

### iPhone (iOS / Safari WebKit)
- **Detecção**: `_isIOS` — UA contém "iPad", "iPhone" ou "iPod", ou Mac com touchscreen
- **Backdrop-filter**: efeitos de blur/glass ativados (GPU potente)
- **Acelerômetro**: sinal invertido (bug WebKit), corrigido no código; requer `DeviceMotionEvent.requestPermission()` a partir do iOS 13
- **Resolução de câmera**: usa resolução máxima do hardware quando selecionada
- **GPS na câmera**: atualização a cada 1000ms
- **Vibração no disparo**: não suportada pelo Safari; ignorada silenciosamente
- **Salvar/compartilhar**: `navigator.share({files})` abre menu nativo do iOS (Salvar Imagem, AirDrop, etc.)
- **Safe area**: `env(safe-area-inset-top/bottom)` ativo para notch e home indicator
- **Theme-color**: `<meta name="theme-color">` controla cor da barra de status e da safe area inferior em PWA standalone
- **PWA**: suportado via `apple-mobile-web-app-capable`, `apple-touch-icon`

### Android (Chrome / WebView)
- **Detecção**: `_isAndroid` — UA contém "Android"; atributo `data-android` no `<html>` definido no `<head>`
- **Backdrop-filter**: desativado via CSS `[data-android]` por questões de desempenho GPU
- **Acelerômetro**: sinal conforme a especificação W3C; sem necessidade de permissão especial
- **Resolução de câmera**: forçada a 1080p quando "Máxima" selecionada (quirks de driver)
- **GPS na câmera**: atualização a cada 2000ms
- **Vibração no disparo**: `navigator.vibrate([40,25,40])` — funciona
- **Salvar/compartilhar**: download direto via `<a download>` (Web Share API inconsistente no Android Chrome para arquivos)
- **Safe area**: CSS aplicado mas geralmente 0 (sem notch na maioria)
- **Theme-color**: `<meta name="theme-color">` controla cor da barra de status
- **PWA**: suportado via manifest.webmanifest

### Desktop (navegador)
- **Funcionalidade parcial**: interface completa visível, sem GPS real nem câmera
- **Salvar/compartilhar**: fallback para download via anchor
- **Útil para**: configurações, gestão de eixo (download/import), consultas KM

## 2. Navegadores

| Recurso | Chrome (Android) | Safari (iOS) | Chrome (desktop) | Firefox | Edge |
|---|---|---|---|---|---|
| Service Worker | Sim | Sim | Sim | Sim | Sim |
| getUserMedia | Sim | Sim | Sim | Sim | Sim |
| DeviceMotion | Sim (sem permissão) | Sim (com permissão) | Não aplicável | Sim | Sim |
| navigator.share | Sim (limitado) | Sim | Não | Não | Não |
| navigator.vibrate | Sim | Não | Sim | Sim | Sim |
| Torch/Flash | Sim (se suportado) | Sim (se suportado) | N/A | Sim | Sim |
| IndexedDB | Sim | Sim | Sim | Sim | Sim |
| CSS custom props | Sim | Sim | Sim | Sim | Sim |

## 3. PWA (Progressive Web App)

### Manifest
- `display`: standalone
- `orientation`: portrait
- `background_color`: #f1f2f3 (tema claro)
- `theme_color`: #f1f2f3
- `start_url`: ./
- `scope`: ./
- Ícones: 192px e 512px (`any maskable`)

### Service Worker
- Cache: `kmcheck-v136`
- **Assets pré-cacheados**: index.html, fflate.js, manifest.webmanifest, icon-192.png, icon-512.png, apple-touch-icon.png, logo-header.png
- **Estratégia para documento e dados de rodovia**: network-first (sempre busca versão nova quando online, fallback para cache offline)
- **Estratégia para demais assets**: cache-first (rápido, raramente muda)
- **Registro**: apenas via HTTP/HTTPS (protegido contra `file://`)

### Instalação
- **Android**: Chrome oferece "Adicionar à tela inicial" automaticamente quando critérios de PWA são atendidos
- **iOS**: Safari → botão compartilhar → "Adicionar à Tela de Início"
- Splash screen usa `background_color` do manifest

## 4. Funcionamento offline

| Funcionalidade | Offline | Observação |
|---|---|---|
| Abrir o app | Sim | Service worker serve do cache |
| GPS e localização | Sim | API nativa do dispositivo |
| Identificar rodovia/KM | Sim | Dados em IndexedDB |
| Capturar foto | Sim | Câmera nativa + Canvas |
| Legenda na foto | Sim | Calculada localmente |
| Salvar na galeria interna | Sim | IndexedDB |
| Compartilhar/baixar foto | Sim | Não depende de rede |
| Consulta Coord→KM | Sim | Dados locais |
| Consulta KM→Coord | Sim | Dados locais |
| Baixar rodovia do SNV | Não | Requer internet |
| Importar arquivo local | Sim | Leitura local |
| Atualizar app | Não | Requer internet |

## 5. Armazenamento local

| Mecanismo | Conteúdo | Persistência |
|---|---|---|
| localStorage | Todas as configurações (~20 chaves `kc-*`), tema, lado (LD/LE), serviços (JSON), contratos (JSON), logo (dataURL), flags | Permanente (até limpar dados do navegador) |
| IndexedDB `kmcheck` v2 | Store `bases`: geometria das rodovias; Store `photos`: fotos capturadas (blobs) | Permanente |
| Service Worker Cache | Shell do app + assets estáticos | Gerenciado pelo SW, atualizado por versão |

## 6. Diferenças visuais entre temas

| Elemento | Tema Claro | Tema Escuro |
|---|---|---|
| Fundo da página | Gradiente claro (#f7f7f5 → #f1f2f3) | Sólido escuro (#0a0c0e) |
| Cartões | Preto sólido (#121212) com brilho | Glass escuro com blur (iOS) ou opaco (Android) |
| Texto do cartão | Branco | Branco |
| Texto da página | Escuro (#1c2333) | Claro (#eef1f6) |
| Botões (gold) | Azul-cinza escuro (#3b4559) | Verde-limão (#b7d92d) |
| Status bar (meta) | #f1f2f3 | #0a0c0e |
