# Changelog

Registro de alterações do KM Check. O versionamento do cache (`kmcheck-vNNN` em `sw.js`) é incrementado a cada deploy.

---

## Versão atual: cache v158

**Data do último build dos dados:** 2026-07-31 (SNV 202607a)

---

## Julho 2026

### Câmera e captura

- **Tilt por acelerômetro (vetor de gravidade):** substituiu o giroscópio (`beta`/`gamma`) que sofria de gimbal lock ao fotografar o chão/céu. A detecção agora usa `DeviceMotionEvent.accelerationIncludingGravity` com histerese de 15°.
- **Layout em paisagem:** quando o bloqueio de orientação do iPhone está desligado, a barra inferior move para a lateral direita (como a câmera nativa). Máscara preta cobre o rearranjo durante o giro.
- **Dica de bloqueio de orientação:** diálogo estilo alerta iOS aparece quando a página gira para paisagem, sugerindo ativar o bloqueio na Central de Controle. Opção "Não mostrar" persistida.
- **Som de obturador:** dois "clicks" mecânicos curtos via Web Audio API (ruído filtrado com envelope rápido), substituindo o "bip" senoidal anterior.
- **Vibração dupla (Android):** `navigator.vibrate([40,25,40])` — dois toques curtos, mais perceptíveis que um só.
- **Piscada do obturador:** animação preta de 180ms (`#camflashfx`) como feedback visual.
- **Galeria interna:** fotos registradas salvas em IndexedDB, visualização com swipe (touch events com inércia e elástico nas bordas).
- **Seletor de proporção na câmera:** botões 1:1 / 4:3 / 16:9 diretamente na tela da câmera (acima da barra inferior), sincronizado com a configuração.
- **Flash/lanterna:** controle via `track.applyConstraints({advanced:[{torch}]})`.
- **Câmera frontal:** botão de troca com espelhamento (`scaleX(-1)`).

### Legenda e metadados

- **EXIF completo nas fotos:** GPS (lat/lon/altitude/precisão), data/hora, descrição, sem dependências externas.
- **6 estilos de coordenadas:** decimal, decimal com rótulo, compacto, DMS, DMS com rótulo, graus e minutos decimais.
- **4 estilos de data:** curta, curta+hora, extensa, extensa+hora.
- **Estaca rodoviária:** conversão `km → Est. NNN+R` (1 estaca = 20m), exibida na legenda e no hero card.
- **Negrito configurável:** opção de peso bold na legenda.
- **Cor configurável:** branco, amarelo, verde, laranja ou preto.
- **Opacidade configurável:** slider 30-100% para legenda e logo separadamente.
- **Marca discreta:** "KM CHECK · SNV/DNIT" no canto oposto ao da legenda.

### Importação de dados

- **Shapefile parser embutido:** lê .shp + .dbf sem bibliotecas externas, com acesso por fatias (`File.slice`) para arquivos grandes (>90 MB).
- **ZIP do DNIT:** descompacta com `fflate` e importa shapefile ou KML interno.
- **KMZ/KML aprimorado:** extração robusta de atributos via `ExtendedData` e `description` com regex.
- **CSV/TXT aprimorado:** detecção automática de separadores, vírgula decimal brasileira, classificação inteligente de colunas.
- **Download direto do SNV:** tenta dados pré-processados (JSONs locais) antes de consultar o GeoServer.
- **Filtro de KM:** permite baixar apenas um trecho (KM inicial/final) da rodovia.

### Logo da empresa

- **Remoção de fundo v2:** mediana das bordas para detectar cor, feather de 1px, defringe (remoção de halo), opção de vazar áreas internas.
- **Preview em tempo real:** slider de tolerância + checkbox de holes com atualização ao vivo sobre fundo quadriculado.
- **Posição configurável:** 4 cantos, com opacidade e tamanho ajustáveis.

### Interface

- **Tema claro:** fundo claro com cartões pretos sólidos (opacos, sem blur). Degradê gelo no fundo.
- **Dark Glass Premium:** superfícies translúcidas com blur, ondas SVG decorativas, sombras internas brilhantes.
- **Dock flutuante:** navegação estilo iOS com botão grande da câmera.
- **Grid cards:** atalhos rápidos na tela inicial (Configurações, Gestão de Eixo).
- **Abas nas configurações:** Câmera / Logo / Legenda.
- **Diálogo de serviço + contrato:** acessível pelo botão "i" na câmera, com lista rolável em ordem alfabética.
- **Serviços padrão:** lista built-in (Roçada, Limpeza, Placa, etc.) com possibilidade de remover e adicionar.

### Performance

- **Android:** desabilitado `backdrop-filter` em todas as superfícies, ondas SVG decorativas e transições supérfluas. Resolução "Máxima" limitada a 1080p.
- **Throttle do acelerômetro:** ~15 Hz (64ms) em vez dos 60 Hz padrão.
- **paintGps otimizado:** atualiza texto sem recriar DOM (evita reflow/flicker no Android).
- **Wake Lock:** tela acesa com rede de segurança (reativação em visibilitychange, pointerdown e setInterval de 15s).

### Pipeline de dados

- **Workflow diário (`update-snv.yml`):** baixa shapefile do DNIT Cloud, gera JSONs em `data/rodovias/`, commit automático.
- **Workflow mensal (`sync-dnit.yml`):** sincroniza dados para Supabase via Playwright.
- **364 rodovias pré-processadas** em `data/rodovias/` com `index.json`.

### Infraestrutura

- **GitHub Pages:** deploy automático ao dar push em `main`.
- **Service Worker v158:** rede-primeiro para documento e dados, cache-primeiro para assets.
- **Manifesto PWA:** `display: standalone`, `orientation: portrait`.

---

## Convenção de versionamento

- O número do cache em `sw.js` (`kmcheck-vNNN`) é a referência de versão
- Incrementado a cada push que altera o app
- A versão semântica no cabeçalho (`Versão 1.0.0`) é informativa
