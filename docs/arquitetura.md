# Arquitetura do KM Check

## Visão geral

O KM Check é um **Progressive Web App (PWA)** de campo para documentação fotográfica de rodovias federais. O app tira fotos com uma **legenda gravada dentro da imagem** contendo rodovia, KM interpolado do SNV/DNIT, OAE, coordenadas GPS e data/hora. Funciona **100% offline** no iPhone (Safari) e Android (Chrome) depois de instalado na tela inicial.

**URL de produção:** https://wagnerxm.github.io/kmcheck/

---

## Princípio de design: arquivo único

Todo o app reside em um **único arquivo `index.html`** (~2.860 linhas) com HTML, CSS e JS inline. Não há bundler, framework, transpilador nem etapa de build. Editar o app = editar `index.html`.

Essa decisão é intencional:

- **Zero dependências de runtime** no cliente — funciona abrindo o arquivo direto.
- **Deploy trivial** — push em `main` → GitHub Pages publica automaticamente.
- **Offline robusto** — o Service Worker cacheia um único documento.
- **Sem surpresas** — não há configurações de build que possam quebrar.

---

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | O app inteiro (HTML + CSS + JS inline). |
| `sw.js` | Service Worker. Cache `kmcheck-vNNN`. Rede-primeiro para o documento, cache-primeiro para assets. |
| `manifest.v143.webmanifest` | Manifesto PWA (`display: standalone`, `orientation: portrait`). |
| `fflate.js` | Biblioteca de zip (leitura de KMZ e shapefiles ZIP). |
| `carlito-400.woff2`, `carlito-700.woff2` | Fonte Carlito (métrica compatível com Calibri) via `@font-face`. |
| `icon-192.png`, `icon-512.png` | Ícones PWA (192×192 e 512×512). |
| `apple-touch-icon.png` | Ícone para a tela inicial do iPhone. |
| `logo-header.png` / `logo-header.jpg` | Logo do cabeçalho. |
| `data/rodovias/*.json` | 364 rodovias (`BR-xxx-UF.json`) + `index.json`. Geometria do SNV pré-processada. **Gerado automaticamente — nunca editar à mão.** |
| `scripts/fetch-snv-wfs.mjs` | Script Node que baixa o shapefile do DNIT Cloud e gera os JSONs em `data/rodovias/`. |
| `scripts/sync-dnit.mjs` | Script Node + Playwright que sincroniza dados do DNIT para o Supabase. |
| `scripts/rodovias.json` | Lista de referência de rodovias para os scripts. |
| `scripts/supabase_schema.sql` | Schema do banco Supabase (tabelas `pontos_rodovia` e `historico_fotos`). |
| `.github/workflows/update-snv.yml` | Workflow diário (06:00 UTC) que atualiza os JSONs das rodovias. |
| `.github/workflows/sync-dnit.yml` | Workflow mensal (dia 1, 06:00 UTC) que sincroniza para o Supabase. |
| `manual-kmcheck/` | Manual do usuário, mockups, screenshots. Documentação, não faz parte do app. |

---

## Organização do JavaScript (dentro de `index.html`)

O código JS está organizado em blocos sequenciais, delimitados por comentários `/* ===== nome ===== */`:

```
┌─────────────────────────────────────────────┐
│ Dados embutidos (OAES)                      │  OAEs do contrato (pontes/viadutos)
├─────────────────────────────────────────────┤
│ Estado (S, CFG)                             │  Estado runtime + config (localStorage)
├─────────────────────────────────────────────┤
│ IndexedDB                                   │  CRUD de bases/rodovias e fotos
├─────────────────────────────────────────────┤
│ Geometria                                   │  findKm, kmToCoord, findOae, haversine
├─────────────────────────────────────────────┤
│ Formatação                                  │  fkm, fc, formatCoord, formatDateLine
├─────────────────────────────────────────────┤
│ Navegação                                   │  goToScreen, botões, toast
├─────────────────────────────────────────────┤
│ Lista de bases                              │  renderBases, download WFS
├─────────────────────────────────────────────┤
│ Importação                                  │  Shapefile, KMZ/KML, CSV
├─────────────────────────────────────────────┤
│ GPS                                         │  watchPosition, paintGps, legendLines
├─────────────────────────────────────────────┤
│ Contratos                                   │  CRUD contratos (localStorage)
├─────────────────────────────────────────────┤
│ Logo                                        │  Upload, remoção de fundo, recorte
├─────────────────────────────────────────────┤
│ Câmera                                      │  getUserMedia, tilt, layout, captura
├─────────────────────────────────────────────┤
│ EXIF                                        │  Montagem e injeção de metadados EXIF
├─────────────────────────────────────────────┤
│ Consulta                                    │  Coordenada→KM e KM→Coordenada
├─────────────────────────────────────────────┤
│ Ajustes                                     │  Bindings das configurações
├─────────────────────────────────────────────┤
│ Descrição de serviços                       │  CRUD serviços (localStorage)
├─────────────────────────────────────────────┤
│ Tema                                        │  Claro/escuro
├─────────────────────────────────────────────┤
│ Boot                                        │  Inicialização, wakeLock, SW register
└─────────────────────────────────────────────┘
```

---

## Estado da aplicação

### `S` — estado runtime (em memória)

```js
const S = {
  bases: [],         // rodovias carregadas do IndexedDB
  pos: null,         // última posição GPS {lat, lon, acc, alt, t}
  fix: null,         // resultado do findKm mais recente
  watchId: null,     // ID do watchPosition
  stream: null,      // MediaStream da câmera
  facing: 'environment', // câmera traseira ou frontal
  lastBlob: null,    // último blob da foto capturada
  tilt: 0,           // ângulo da interface (0, 90 ou -90)
  sensorTilt: 0      // ângulo bruto do acelerômetro
};
```

### `CFG` — configurações (getters sobre localStorage)

Todas as preferências são lidas do `localStorage` via getters no objeto `CFG`. Chaves seguem o padrão `kc-*` (ex.: `kc-res`, `kc-qual`, `kc-theme`).

---

## Fluxo de dados

```
GPS (watchPosition)
        │
        ▼
   S.pos (lat, lon, acc)
        │
        ├──▶ findKm(lat, lon) ──▶ S.fix (km, dist, br, uf)
        │
        ├──▶ paintGps() ──▶ Atualiza hero card (tela inicial)
        │
        └──▶ legendLines() ──▶ Texto da legenda ao vivo na câmera
                                    │
                                    ▼
                              burnLegend() ──▶ Gravado no canvas da foto
```

---

## Tecnologias e APIs web utilizadas

| API | Uso |
|---|---|
| `navigator.geolocation.watchPosition` | Posição GPS em tempo real |
| `navigator.mediaDevices.getUserMedia` | Acesso à câmera |
| `DeviceMotionEvent` | Detecção de inclinação do aparelho |
| `Canvas 2D` | Captura da foto e gravação da legenda |
| `IndexedDB` | Armazenamento de bases/rodovias e fotos |
| `localStorage` | Preferências do usuário (chaves `kc-*`) |
| `Service Worker` | Cache offline e atualização automática |
| `Web Share API` | Compartilhamento nativo da foto (iOS) |
| `Screen Wake Lock` | Manter a tela acesa durante o uso |
| `Screen Orientation` | Tentativa de travar em retrato |
| `ImageTrack.applyConstraints` | Controle do flash/lanterna |

---

## Convenções de código

- **Idioma:** todo o código e comentários em **pt-BR**.
- **Estilo:** denso, inline, sem módulos — segue o estilo já existente no arquivo.
- **Comentários:** explicam o **porquê** (não o quê), sobretudo workarounds de iOS/Android.
- **Sem dependências:** não introduzir libs no cliente nem etapa de build.
- **Dados gerados:** nunca editar `data/rodovias/*` à mão — é saída do pipeline SNV.
