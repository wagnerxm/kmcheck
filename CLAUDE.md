# KM Check — guia para agentes

App de campo (PWA) para documentação fotográfica de rodovias. Tira foto com uma **legenda gravada
dentro da imagem**: rodovia, KM interpolado do SNV/DNIT, OAE, coordenadas GPS e data/hora. Funciona
**offline** no iPhone (Safari) e no Android (Chrome) depois de instalado na tela inicial.

- **Idioma:** todo o produto e os comentários de código são em **pt-BR**.
- **Repositório:** `wagnerxm/kmcheck` — branch `main`.
- **Publicação:** GitHub Pages → https://wagnerxm.github.io/kmcheck/ (deploy automático ao dar push em `main`; leva ~1–3 min, às vezes mais).

## Arquitetura

O app é um **único arquivo** `index.html` (~5.200 linhas) com **HTML + CSS + JS tudo inline**. Não há
build, bundler, framework nem dependências de runtime no cliente. Editar o app = editar `index.html`.

| Arquivo | Papel |
|---|---|
| `index.html` | O app inteiro (HTML, CSS e JS inline). |
| `sw.js` | Service worker. Cache `kmcheck-vNNN`. **Rede-primeiro com limite de 4 s** (cai para o cache com sinal fraco) para o documento e `data/rodovias`, **cache-primeiro** para assets. APIs externas (servidor SNV, GeoServer) não passam pelo SW. |
| `manifest.v143.webmanifest` | Manifesto PWA (`display: standalone`, `orientation: portrait`). |
| `fflate.js` | Biblioteca de zip (import/export de bases). |
| `icon-192/512.png`, `apple-touch-icon.png`, `logo-kmcheck.png` | Ícones/PWA e logo do cabeçalho (`logo-kmcheck.png`, alta resolução; `logo-header.png` é a antiga, mantida só para aparelhos com cache velho). |
| `data/rodovias/*.json` | 363 rodovias (`BR-xxx-UF.json`) + `index.json`. Geometria do SNV para interpolar o KM pelo GPS. **Gerado automaticamente** — não editar à mão. |
| `scripts/` | Scripts Node (Node 20+, ESM): `fetch-snv-wfs.mjs` (DNIT→JSON) e `sync-dnit.mjs` (Playwright→Supabase). |
| `.github/workflows/` | `update-snv.yml` (diário 06:00 UTC) e `sync-dnit.yml` (mensal). |
| `manual/` | Manual do usuário **dentro do app** (`index.html` + `img/`). **Gerado** por `manual-kmcheck/estudio/manual-web.mjs` — não editar à mão. O SW guarda num cache próprio (`kmcheck-manual`), baixado só na 1ª abertura. |
| `manual-kmcheck/` | Estúdio do manual (prints, textos, geradores, prévias) e a versão web publicada. |
| `financemind/` | **Finance Mind**, outro app (PWA offline de finanças pessoais) hospedado na subpasta, com `sw.js`/manifest próprios (`financemind-vN`; subir o número a cada alteração). A raiz `sw.js` o ignora. Não faz parte do KM Check. |
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

- **Modo de testes:** recursos novos entram com a classe `.so-teste` (escondidos). 7 toques seguidos na versão do cabeçalho ligam/desligam só naquele aparelho (`kc-teste` no localStorage; aparece "· TESTE" na versão). Para liberar a todos, tirar a classe.
- **Estado:** `S` (runtime) e `CFG` (config, muitos campos são *getters* que leem do `localStorage`, chaves `kc-*`).
- **Armazenamento:** bases/rodovias no **IndexedDB**; preferências no **localStorage** (`kc-*`).

## Fluxo de desenvolvimento

1. Preview: `preview_start` com nome **`kmcheck`** (serve a pasta na porta 3456). Para inspecionar o
   layout da câmera, simule a viewport (ex.: 844×390 paisagem, 390×844 retrato) e use `javascript_tool`
   para chamar `layoutOverlays()`, `usefulRect()`, etc. A câmera real não abre no preview headless,
   mas a **geometria** (dimensões, posições) é verificável assim.
2. Verifique sem erros de JS (`read_console_messages`) e cheque `getBoundingClientRect()` das áreas-chave.

## Deploy e versionamento — **IMPORTANTE**

- **Versão para o usuário e lojas:** `VERSAO_APP` no topo do `sw.js` (ex.: `1.0.0`). Aparece na tela, no manual e é o versionName do Android. Só muda quando sai versão nova nas lojas, e só com o OK do Wagner.
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

## App de iPhone — gerar e enviar no Mac (App Store)

O app de iPhone é o mesmo `index.html`, embalado pelo Capacitor 8.5.3 em **`mobile/ios`** (projeto pronto e
testado: compila no Xcode 26.3 e abre no simulador; só iPhone, só retrato, assinatura **automática**,
Version `1.0.0`, Build = número do cache do `sw.js`). Conta Apple Developer: a do André (time dele no Xcode).
Material da loja: textos em `mobile/loja/ios/textos-app-store.txt` (copiar e colar) e as 6 capturas 1290×2796
em `mobile/loja/ios/tela-1..6.png`. Detalhes, riscos de rejeição e roteiro de teste: `mobile/ios-preparo/LEIA-ME.md`.

**Roteiro no Mac** (Xcode 26+, Node 22+, Apple ID do André já em Xcode › Settings › Accounts — login e senha
são da pessoa, nunca do Claude):
1. `cd mobile && npm ci && npm run sync:ios` (copia o app para `ios/App/App/public` e ajusta os pacotes).
2. Arquivar: `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath build/App.xcarchive -allowProvisioningUpdates DEVELOPMENT_TEAM=<time do André> archive`
   (o Team ID aparece em Xcode › Settings › Accounts, ou em developer.apple.com › Membership). Alternativa:
   `npx cap open ios`, escolher o Team em Signing & Capabilities e Product › Archive.
3. App Store Connect › Apps › **+** › Novo app: iOS, nome `KM Check` (se em uso: `KM Check Rodovias`),
   Português (Brasil), ID do pacote `br.com.kmcheck.app`, SKU `kmcheck-ios`.
4. Enviar: `xcodebuild -exportArchive -archivePath build/App.xcarchive -exportPath build/ipa -allowProvisioningUpdates -exportOptionsPlist <plist com method=app-store-connect, destination=upload, teamID, signingStyle=automatic>`
   (ou Organizer › Distribute App › App Store Connect). Em 5–30 min o build aparece no TestFlight.
5. TestFlight interno no iPhone → testar o roteiro da seção 9 do LEIA-ME.
6. Preencher a ficha com `textos-app-store.txt` e as capturas; escolher o build; **enviar para revisão só com o
   OK explícito do André ou do Wagner**.

**Limites para quem trabalha no Mac:** não alterar o código do app (`index.html`, `sw.js`, `mobile/ios/**`) nem
dar push — o repositório é do Wagner (`wagnerxm/kmcheck`). Se algo precisar mudar no app, descreva o erro e a
correção proposta para o Wagner fazer. Não criar contas, não digitar senhas, não aceitar contratos nem enviar
para revisão sem o OK da pessoa.

## Domínios com skill dedicada (`.claude/skills/`)

- **kmcheck-master** — visão geral e como trabalhar no projeto.
- **camera-mobile** — tela da câmera: orientação/inclinação, layout, captura da foto e legenda.
- **android-performance** — ajustes de performance específicos de Android.
- **ios-safari-pwa** — peculiaridades e *workarounds* do Safari/PWA no iPhone.
- **snv-data-pipeline** — scripts e workflows que baixam/processam os dados do SNV/DNIT.
- **deploy-release** — versionamento do service worker e publicação no GitHub Pages.
