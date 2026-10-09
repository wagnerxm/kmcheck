# KM Check — Telas e Funcionalidades

## Estrutura geral

O KM Check é um PWA (Progressive Web App) de arquivo único (`index.html`, ~2700 linhas). Todo o HTML, CSS e JavaScript residem em um único arquivo, sem framework externo. O app funciona offline após a primeira carga.

---

## 1. Telas principais

### 1.1 Tela Inicial (Home)
- **ID**: `scr-cam`
- **Caminho**: tela padrão ao abrir o app
- **Finalidade**: exibir informações em tempo real de localização e rodovia
- **Elementos**:
  - Header: logo KM Check, versão ("Versão 1.0.0"), botão de consulta (lupa)
  - Cartão hero com:
    - Ícone SVG estilizado do KM (`#kmsign`)
    - Nome da BR (ex.: `BR-101`) — em negrito, cor verde `#b7d92d`
    - KM atual (ex.: `KM 91,850`)
    - Estaca correspondente (ex.: `Est. 4592+5`)
    - Latitude e Longitude em tempo real
  - Cartão "Configurações" → navega para `scr-settings`
  - Cartão "Gestão de Eixo" → navega para `scr-bases`
  - Botão central da câmera com borda verde (`rgba(183,217,45,.7)`) → abre `openCam()`
  - Texto "Registrar evidência" abaixo do botão
  - Crédito "Desenvolvido por Wagner Machado" (fixo no rodapé, visível apenas nesta tela)
- **Estados**:
  - Sem GPS: campos de latitude/longitude mostram "—"
  - Sem rodovia baixada: campos BR/KM/Estaca mostram "—"
  - Com GPS e rodovia: dados preenchidos em tempo real

### 1.2 Tela de Configurações
- **ID**: `scr-settings`
- **Caminho**: Tela Inicial → cartão "Configurações" | Câmera → botão engrenagem
- **Finalidade**: ajustar câmera, logo, legenda e comportamento do app
- **Abas**: Câmera, Logo, Legenda (navegação por abas `.settab`)

#### 1.2.1 Aba Câmera (`tab-cam`)
**Seção "Qualidade"**:
| Controle | Tipo | Opções | Padrão inicial |
|---|---|---|---|
| Resolução (`cfg-res`) | select | Máxima disponível, 2 MP (1080p), 4 MP (1440p), 8 MP (2160p) | 2 MP (1080p) |
| Qualidade (`cfg-qual`) | select | Máxima (0.95), Alta (0.92), Média (0.85), Econômica (0.75) | Máxima |
| Formato (`cfg-format`) | select | 1:1, 4:3, 16:9 | 4:3 |
| Alerta sonoro (`cfg-soundalert`) | checkbox | — | Ativado |

**Seção "Comportamento após o disparo"**:
| Controle | Tipo | Padrão inicial |
|---|---|---|
| Aceitação automática (`cfg-autoaccept`) | checkbox | Ativado |
| Envio automático para a galeria (`cfg-autosave`) | checkbox | Ativado |

**Seção "Aparência"**:
| Controle | Tipo | Padrão inicial |
|---|---|---|
| Tema claro (`cfg-lighttheme`) | checkbox | Ativado |

#### 1.2.2 Aba Logo (`tab-logo`)
**Seção "Logo da empresa"**:
- Botão "Escolher logo" (`#logo-add`) — abre seletor de imagem
- Botão "Remover" (`#logo-del`) — remove logo salva
- Miniatura da logo selecionada (`#logo-thumb`)
- Texto explicativo: "A logo é gravada na foto. O fundo é recortado automaticamente na hora de escolher."

**Seção "Ajustes"**:
| Controle | Tipo | Opções | Padrão |
|---|---|---|---|
| Posição (`cfg-logopos`) | select | Superior esquerdo, Superior direito, Inferior esquerdo, Inferior direito | Superior esquerdo |
| Opacidade (`cfg-logoop`) | range | 20–100% | 100% |
| Tamanho (`cfg-logosz`) | range | 50–180% | 100% |

#### 1.2.3 Aba Legenda (`tab-leg`)
**Seção "Legenda"**:
| Controle | Tipo | Opções | Padrão inicial |
|---|---|---|---|
| Posição (`cfg-legpos`) | select | Inferior esquerdo, Inferior direito, Superior esquerdo, Superior direito | Inferior esquerdo |
| Tamanho (`cfg-legsz`) | select | Pequena (90%), Média (115%), Grande (150%), Extra grande (200%) | Grande (150%) |
| Cor (`cfg-legcolor`) | select | Branco, Amarelo, Verde, Laranja, Preto | Branco |
| Negrito (`cfg-legbold`) | checkbox | — | Ativado |
| Opacidade (`cfg-legop`) | range | 30–100% | 100% |

**Seção "Conteúdo"**:
| Controle | Tipo | Padrão inicial |
|---|---|---|
| Exibir estaca (`cfg-estaca`) | checkbox | Ativado |
| Nome da OAE (`cfg-oae`) | checkbox | Ativado |
| Coordenadas (`cfg-coord`) | checkbox | Ativado |
| Estilo das coordenadas (`cfg-coordstyle`) | select (6 formatos) | -6,077710, -37,891500 |
| Precisão do GPS (`cfg-acc`) | checkbox | Desativado |
| Formato da data (`cfg-datestyle`) | select (4 formatos) | DD/MM/AAAA, HH:MM |

**Seção "Descrição de serviços"**:
- Lista de serviços cadastrados (`#svclist`)
- Campo de texto + botão "Adicionar" (`#svc-new`, `#svc-add`)
- Texto: "Serviços cadastrados aparecem para escolha rápida na câmera."

**Seção "Contratos"**:
- Lista de contratos cadastrados (`#ctlist`)
- Campo de texto + botão "Adicionar" (`#ct-new`, `#ct-add`)
- Texto: "Contratos cadastrados aparecem para escolha rápida na câmera."

**Seção "Alerta"**:
- Distância máxima ao eixo (m) antes de alertar (`#cfg-maxdist`) — campo numérico, padrão 300m

### 1.3 Tela de Gestão de Eixo
- **ID**: `scr-bases`
- **Caminho**: Tela Inicial → cartão "Gestão de Eixo"
- **Finalidade**: baixar/importar/gerenciar rodovias

**Seção "Rodovias Baixadas"**:
- Lista de rodovias instaladas (`#baselist`)
- Cada item mostra BR/UF, km range, nº de pontos, botão remover
- Estado vazio: "Nenhuma rodovia baixada. Importe o KMZ do SNV/DNIT ou um CSV com o eixo."

**Seção "Adicionar Rodovia"**:
- Label "Baixar do SNV (DNIT)"
- Select UF (`#dl-uf`) — todos os 27 estados
- Select BR (`#dl-br`) — lista por UF + opção "Outra BR…"
- Campo "Número da BR" (`#dl-br-custom`) — visível quando "Outra BR…" selecionada
- Campos KM inicial/final (`#dl-kmi`, `#dl-kmf`) — opcionais
- Botão "Baixar" (`#dl-go`)
- Status (`#dl-status`): "Deixe em branco para baixar a rodovia inteira. Requer internet só neste momento — depois funciona offline."

**Seção "Importe um arquivo"** (título fora do cartão):
- Botão "Importar arquivo (Shapefile, ZIP, KMZ ou CSV)" (`#btn-import`)
- Input file oculto (`#filein`) — aceita `.kmz,.kml,.csv,.txt,.tsv,.zip,.shp,.dbf,.shx`
- Texto explicativo sobre cada formato aceito

### 1.4 Tela de Consulta
- **ID**: `scr-query`
- **Caminho**: Tela Inicial → ícone lupa (header)
- **Finalidade**: converter coordenadas em KM e vice-versa

**Seção "Coordenada → KM"**:
- Textarea para colar coordenadas (`#q-coords`) — aceita colagem do Excel
- Contador de pontos detectados (`#q-count`)
- Botão "Calcular KM" (`#q-run`)
- Botão "Usar GPS" (`#q-gps`) — insere coordenada GPS atual
- Tabela de resultados (`#q-tbody`) — colunas: LAT, LONG, BR, KM, DIST
- Botão "Copiar resultado (colar no Excel)" (`#q-copy`)

**Seção "KM → Coordenada"**:
- Select de rodovia (`#k-base`)
- Campo KM (`#k-km`)
- Botão "Localizar coordenada" (`#k-run`)
- Resultado em texto (`#k-out`)

---

## 2. Overlays de tela cheia (fora do sistema de telas)

### 2.1 Câmera (`#camwrap`)
- **Caminho**: Tela Inicial → botão câmera | botão "Registrar evidência"
- **Finalidade**: capturar foto com legenda embutida

**Barra superior (`#camtopbar`)**:
- Botão voltar (`#camback`)
- Botão trocar câmera (`#camflip`)

**Área central**:
- Vídeo da câmera (`#camvideo`) em `#camstage`
- Seletor de proporção (`#camratio`): botões 1:1, 4:3, 16:9
- Botões LD/LE (lado da pista)
- Botão "i" (`#caminfo`) — abre diálogo de serviço/contrato
- Camada de legenda ao vivo (`#liveplate`) sobre o frame
- Camada de logo ao vivo (`#camlogo`) sobre o frame

**Barra inferior (`#cambar2`)**:
- Botão configurações (`#cam-settings`)
- Botão flash (`#cam-flash`)
- Botão obturador (`#shutter`) — 84px, centro branco 64px
- Botão galeria (`#cam-gallery`)

**Efeito de captura**: flash branco (`#camflashfx`), vibração (Android), som de obturador (sintetizado via WebAudio)

### 2.2 Galeria (`#gallerywrap`)
- **Caminho**: Câmera → botão galeria
- **Finalidade**: visualizar fotos capturadas

- Botão fechar (`#gal-close`)
- Imagem em tela cheia (`#gal-img`)
- Legenda: "N / Total · nome_do_arquivo.jpg" (`#gal-caption`)
- Navegação por swipe (touch) com animação elástica nas bordas

---

## 3. Diálogos modais (`<dialog>`)

### 3.1 Seletor de serviço/contrato (`#dlg-svc`)
- **Caminho**: Câmera → botão "i"
- Seção "Serviço": lista rolável de serviços cadastrados + campo para adicionar novo
- Seção "Contrato": lista rolável de contratos cadastrados + campo para adicionar novo
- Botão "Fechar"

### 3.2 Seletor de rodovias do import (`#dlg-kmz`)
- **Caminho**: importação de Shapefile/KMZ com múltiplas rodovias
- Lista de rodovias encontradas com checkboxes
- Botões "Cancelar" e "Instalar selecionadas"

### 3.3 Identificação de rodovia CSV (`#dlg-csv`)
- **Caminho**: importação de arquivo CSV/TXT
- Campos BR e UF (pré-preenchidos via regex do nome do arquivo)
- Botões "Cancelar" e "Instalar"

### 3.4 Recorte de fundo da logo (`#dlg-logo`)
- **Caminho**: Configurações → Logo → Escolher logo
- Preview do recorte automático de fundo
- Checkbox "Vazar áreas internas do fundo"
- Slider "Tolerância do recorte" (0–80, padrão 32)
- Botões "Cancelar", "Usar original", "Usar recorte"

---

## 4. Funcionalidades confirmadas

### 4.1 GPS e localização
- `watchPosition` com alta precisão ativada
- Atualização contínua de posição (1s no iOS, 2s no Android quando na câmera)
- Cálculo de KM mais próximo via projeção ponto-segmento em todas as rodovias instaladas
- Alerta visual (⚠) quando distância ao eixo > limite configurado (padrão 300m)
- Coordenadas exibidas na tela inicial e na legenda

### 4.2 Câmera
- Câmera traseira e frontal (com espelhamento)
- 3 proporções de captura: 1:1, 4:3, 16:9
- Flash/lanterna (quando suportado pelo hardware)
- Rotação automática da legenda/logo por sensor de movimento (acelerômetro)
- Alerta sonoro sintetizado via WebAudio (sem arquivo de áudio)
- Vibração tátil no disparo (apenas Android)
- Aceitação e envio automáticos configuráveis

### 4.3 Legenda na foto
- Queimada diretamente no JPEG via Canvas
- Formato com até 4 linhas: BR/KM/lado/estaca, contrato/serviço/OAE, coordenadas, data/hora
- Posição, tamanho, cor, negrito e opacidade configuráveis
- Prévia ao vivo na câmera (WYSIWYG)
- Marca d'água discreta "KM CHECK · SNV/DNIT" no canto oposto

### 4.4 EXIF
- Metadados GPS (lat/lon/altitude/precisão) embutidos no JPEG
- Data/hora originais
- Descrição (texto da legenda em ASCII)
- Make/Model/Software = "KM Check"/"PWA"
- Construção manual do segmento APP1 TIFF (sem biblioteca externa)

### 4.5 Salvamento e compartilhamento
- Nome personalizado do arquivo: `BR-XXX_UF - KM nnn,nnn LD HHMMSS.jpg`
- Android: download direto via `<a download>`
- iOS: `navigator.share` (menu nativo)
- Fallback: download via anchor
- Salva também na galeria interna (IndexedDB)

### 4.6 Download de rodovias
- Primeiro tenta JSON pré-carregado local (`data/rodovias/BR-xxx-UF.json`, 364 arquivos)
- Fallback: WFS ao vivo do DNIT (`geoservicos.inde.gov.br`)
- Paginação automática (1000 features/página)
- Filtro por UF, BR e faixa de KM
- Sem limite de quantidade de rodovias

### 4.7 Importação de arquivos
- **Shapefile** (.shp + .dbf + .shx opcional): parser binário nativo, filtra eixo principal (`sg_tipo_tr='B'`)
- **ZIP**: descompactação via fflate, detecta shapefile ou KML interno
- **KMZ/KML**: descompactação + parse XML de Placemarks/LineStrings
- **CSV/TXT/TSV**: parse flexível com suporte a vírgula decimal brasileira e colagem do Excel

### 4.8 OAEs (pontes/viadutos)
- 55 estruturas pré-cadastradas (estado do RN)
- Detecção automática quando o GPS indica posição "sobre" a estrutura
- Nome da OAE aparece automaticamente na legenda

### 4.9 Consulta
- Coordenada → KM: colagem em lote, múltiplos formatos, resultado em tabela copiável
- KM → Coordenada: busca reversa em rodovia instalada
- Botão GPS: insere coordenada atual

### 4.10 Tema
- Claro (padrão) e Escuro
- Fundo claro com cartões escuros (design híbrido)
- Transição suave, sem flash
- Meta theme-color dinâmico para status bar

### 4.11 Offline
- Service worker com cache network-first para documento e dados, cache-first para assets
- IndexedDB para rodovias e fotos
- localStorage para configurações, logo, contratos, serviços
- Funciona completamente offline após download inicial de rodovias

---

## 5. Funcionalidades declaradas mas não confirmáveis em desktop

- `CFG.preview` — getter declarado mas não consumido no código atual
- `#gpsline` — referenciado no handler de erro do GPS mas o elemento não existe no HTML atual
- `CFG.autoaccept` / `CFG.autosave` — checkboxes existem mas o fluxo de captura sempre salva/compartilha
