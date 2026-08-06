# KM Check — guia para agentes

App de campo (PWA) para documentação fotográfica de rodovias. Tira foto com uma **legenda gravada
dentro da imagem**: rodovia, KM interpolado do SNV/DNIT, OAE, coordenadas GPS e data/hora. Funciona
**offline** no iPhone (Safari) e no Android (Chrome) depois de instalado na tela inicial.

- **Idioma:** todo o produto e os comentários de código são em **pt-BR**.
- **Repositório:** `wagnerxm/kmcheck` — branch `main`.
- **Publicação:** GitHub Pages → https://wagnerxm.github.io/kmcheck/ (deploy automático ao dar push em `main`; leva ~1–3 min, às vezes mais).

## Arquitetura

O app é um **único arquivo** `index.html` (~2.860 linhas) com **HTML + CSS + JS tudo inline**. Não há
build, bundler, framework nem dependências de runtime no cliente. Editar o app = editar `index.html`.

| Arquivo | Papel |
|---|---|
| `index.html` | O app inteiro (HTML, CSS e JS inline). |
| `sw.js` | Service worker. Cache `kmcheck-vNNN`. **Rede-primeiro** para o documento, **cache-primeiro** para assets. |
| `manifest.webmanifest` / `manifest.v143.webmanifest` | Manifesto PWA (`display: standalone`, `orientation: portrait`). |
| `fflate.js` | Biblioteca de zip (import/export de bases). |
| `carlito-400/700.woff2` | Fonte Carlito (métrica compatível com Calibri) — embutida via `@font-face`. |
| `icon-192/512.png`, `apple-touch-icon.png`, `logo-header.*` | Ícones/PWA e logo. |
| `data/rodovias/*.json` | 364 rodovias (`BR-xxx-UF.json`) + `index.json`. Geometria do SNV para interpolar o KM pelo GPS. **Gerado automaticamente** — não editar à mão. |
| `scripts/` | Scripts Node (Node 20+, ESM): `fetch-snv-wfs.mjs` (DNIT→JSON) e `sync-dnit.mjs` (Playwright→Supabase). |
| `.github/workflows/` | `update-snv.yml` (diário 06:00 UTC) e `sync-dnit.yml` (mensal). |
| `manual-kmcheck/` | Manual do usuário, mockups, screenshots, PDFs. Documentação, não faz parte do app. |
| `.claude/launch.json` | Config de preview (`npx serve` na porta 3456). |

## Telas (`#scr-*`)

- **`scr-bases`** — tela inicial: bases/rodovias, GPS ao vivo, KM acompanhando o carro, importar rodovias.
- **`scr-cam`** (`#camwrap`) — câmera em tela cheia: preview do vídeo, camada de legenda/logo (`#camframe`), seletor de proporção (1:1 / 4:3 / 16:9), obturador, giro pela inclinação do aparelho.
- **`scr-query`** — consulta de rodovias.
- **`scr-settings`** — ajustes: legenda, logo, resolução/formato da câmera, distância de alerta, **descrição de serviços**, **contratos**, tema claro/escuro.

## Organização do JS (dentro de `index.html`)

Blocos marcados por comentários `/* ===== nome ===== */`: dados embutidos, estado (`S`, `CFG`),
IndexedDB (bases), geometria (interpolação de KM, haversine), formatação, navegação, lista de bases,
importação, GPS (`watchPosition`), contratos, logo, **câmera**, consulta, ajustes, descrição de
serviços, tema, boot.

- **Estado:** `S` (runtime) e `CFG` (config, muitos campos são *getters* que leem do `localStorage`, chaves `kc-*`).
- **Armazenamento:** bases/rodovias no **IndexedDB**; preferências no **localStorage** (`kc-*`).

## Fluxo de desenvolvimento

1. Preview: `preview_start` com nome **`kmcheck`** (serve a pasta na porta 3456). Para inspecionar o
   layout da câmera, simule a viewport (ex.: 844×390 paisagem, 390×844 retrato) e use `javascript_tool`
   para chamar `layoutOverlays()`, `usefulRect()`, etc. A câmera real não abre no preview headless,
   mas a **geometria** (dimensões, posições) é verificável assim.
2. Verifique sem erros de JS (`read_console_messages`) e cheque `getBoundingClientRect()` das áreas-chave.

## Deploy e versionamento — **IMPORTANTE**

- **Toda** alteração no app exige **subir o número do cache** em `sw.js` (`const CACHE = 'kmcheck-vNNN'`),
  senão os aparelhos continuam servindo a versão antiga do cache. Incremente sempre (v158 → v159 → …).
- Depois do push, o GitHub Pages leva alguns minutos. Para confirmar que publicou, cheque a 1ª linha de
  `https://wagnerxm.github.io/kmcheck/sw.js` (deve mostrar a `vNNN` nova). Um monitor que faz *poll* do
  `sw.js` é o jeito confiável de saber quando saiu.
- No iPhone o app instalado às vezes só troca de versão fechando de vez (app switcher) e reabrindo —
  não sugerir remover/reinstalar (perde os dados do `localStorage`).
- **Sempre dar push em `main` após uma mudança pedida** (não precisa perguntar).

## Convenções

- Escreva no mesmo estilo do arquivo: denso, inline, **comentários em pt-BR explicando o PORQUÊ** das
  partes não óbvias (sobretudo os *workarounds* de iOS/Android).
- Não introduza dependências no cliente nem etapa de build. O app tem que continuar rodando abrindo o
  `index.html`.
- Não edite `data/rodovias/*` à mão — é saída do pipeline do SNV.

## Domínios com skill dedicada (`.claude/skills/`)

- **kmcheck-master** — visão geral e como trabalhar no projeto.
- **camera-mobile** — tela da câmera: orientação/inclinação, layout, captura da foto e legenda.
- **android-performance** — ajustes de performance específicos de Android.
- **ios-safari-pwa** — peculiaridades e *workarounds* do Safari/PWA no iPhone.
- **snv-data-pipeline** — scripts e workflows que baixam/processam os dados do SNV/DNIT.
- **deploy-release** — versionamento do service worker e publicação no GitHub Pages.
