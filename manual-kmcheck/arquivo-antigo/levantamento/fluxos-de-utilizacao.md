# KM Check — Fluxos de Utilização

## Fluxo 1 — Primeiro acesso

1. Usuário abre o app pela primeira vez (navegador ou PWA)
2. Script no `<head>` detecta tema (padrão: claro) e plataforma (Android/iOS)
3. Configurações iniciais são aplicadas automaticamente (`kc-defaults-v1`):
   - Resolução 1080p, Qualidade Máxima, Formato 4:3
   - Alerta sonoro ativado, Aceitação e envio automáticos
   - Legenda: Grande, Negrito, Estaca ativada, Precisão GPS desativada
   - Tema claro
4. Tela inicial é exibida com campos BR/KM/Lat/Lon vazios ("—")
5. Navegador solicita permissão de localização (GPS)
6. Se concedida: campos preenchem em tempo real (se rodovia baixada)
7. Se negada: campos permanecem vazios, app funciona sem GPS

## Fluxo 2 — Instalar rodovia (download do SNV)

1. Tela Inicial → cartão "Gestão de Eixo"
2. Seção "Adicionar Rodovia" com seletores UF e BR
3. Usuário seleciona UF (ex.: RN) e BR (ex.: BR-101)
4. Opcionalmente define KM inicial e KM final
5. Clica em "Baixar"
6. App tenta carregar JSON local pré-carregado (`data/rodovias/BR-101-RN.json`)
7. Se não disponível: faz download via WFS do DNIT (requer internet)
8. Status atualizado em tempo real ("Conectando...", "Baixando página 1/N...")
9. Rodovia aparece na lista "Rodovias Baixadas"
10. A partir deste momento, GPS identifica KM automaticamente nesta rodovia

## Fluxo 3 — Instalar rodovia (importação de arquivo)

### 3A — Shapefile (.shp + .dbf)
1. Tela de Gestão de Eixo → "Importar arquivo"
2. Seleciona os dois arquivos (.shp e .dbf) juntos
3. App faz parse binário nativo (sem biblioteca externa)
4. Filtra apenas eixo principal (`sg_tipo_tr='B'`)
5. Abre diálogo `#dlg-kmz` com rodovias encontradas e checkboxes
6. Usuário seleciona quais instalar → "Instalar selecionadas"

### 3B — ZIP do DNIT Cloud
1. Mesmo caminho → seleciona arquivo .zip
2. App descompacta via fflate
3. Detecta .shp + .dbf internos → segue fluxo 3A

### 3C — KMZ/KML (VGeo)
1. Mesmo caminho → seleciona arquivo .kmz ou .kml
2. App descompacta (KMZ) e faz parse XML
3. Extrai Placemarks/LineStrings com dados de BR/UF/KM
4. Abre diálogo de seleção → instala

### 3D — CSV/TXT
1. Mesmo caminho → seleciona arquivo .csv, .txt ou .tsv
2. App faz parse flexível (aceita vírgula decimal, colagem do Excel)
3. Identifica colunas KM, LAT, LON automaticamente
4. Abre diálogo `#dlg-csv` para confirmar BR e UF
5. Usuário confirma → "Instalar"

## Fluxo 4 — Captura de foto com legenda

1. Tela Inicial → botão câmera (centro inferior)
2. Navegador solicita permissão de câmera (primeira vez)
3. Câmera abre em tela cheia com legenda ao vivo sobreposta
4. Usuário pode:
   - Selecionar proporção (1:1 / 4:3 / 16:9)
   - Selecionar lado da pista (LD / LE)
   - Abrir seletor de serviço/contrato (botão "i")
   - Ligar/desligar flash
   - Trocar câmera (frontal/traseira)
   - Acessar configurações (engrenagem)
   - Abrir galeria
5. Pressiona botão obturador
6. Efeitos imediatos: flash branco, vibração (Android), som (se ativado)
7. Canvas recorta a imagem na proporção selecionada
8. Legenda é queimada no JPEG (posição/tamanho/cor configurados)
9. Logo (se configurada) é queimada na foto
10. EXIF é injetado (GPS, data/hora, descrição)
11. Arquivo nomeado: `BR-XXX_UF - KM nnn,nnn LD HHMMSS.jpg`
12. Android: download automático | iOS: menu de compartilhamento nativo
13. Foto salva na galeria interna (IndexedDB)

## Fluxo 5 — Selecionar serviço e contrato na câmera

1. Com a câmera aberta → botão "i"
2. Diálogo abre com duas seções: Serviço e Contrato
3. **Serviço**: lista com serviços padrão + cadastrados; toque seleciona/deseleciona
4. **Contrato**: lista de contratos cadastrados; toque seleciona/deseleciona
5. Pode adicionar novo serviço ou contrato direto no diálogo
6. Fechar diálogo → seleção aparece na legenda ao vivo (linha 2)
7. Tags LD/LE/Serviço visíveis na interface da câmera

## Fluxo 6 — Configurar logo da empresa

1. Configurações → aba Logo → "Escolher logo"
2. Seleciona imagem do dispositivo
3. App abre diálogo de recorte automático de fundo (`#dlg-logo`)
4. Usuário ajusta tolerância e opção de "vazar áreas internas"
5. Escolhe "Usar recorte" ou "Usar original"
6. Logo salva em localStorage (como dataURL)
7. Preview exibida na aba Logo
8. Logo aparece na prévia ao vivo da câmera e é queimada nas fotos

## Fluxo 7 — Consulta Coordenada → KM

1. Tela Inicial → ícone lupa (canto superior direito)
2. Tela de Consulta com textarea
3. Cola coordenadas do Excel (uma linha por ponto)
4. Contador mostra "N pontos detectados"
5. Clica "Calcular KM"
6. Tabela exibe: LAT, LONG, BR, KM, DIST (cores: verde/amarelo/vermelho)
7. "Copiar resultado" → TSV na área de transferência → colar no Excel

## Fluxo 8 — Consulta KM → Coordenada

1. Tela de Consulta → seção inferior
2. Seleciona rodovia instalada no dropdown
3. Digita o KM (aceita vírgula decimal)
4. Clica "Localizar coordenada"
5. Exibe Latitude e Longitude correspondentes

## Fluxo 9 — Visualizar galeria

1. Câmera aberta → botão galeria (canto inferior direito)
2. Galeria abre em tela cheia com a foto mais recente
3. Swipe esquerda/direita para navegar entre fotos
4. Legenda mostra "N / Total · nome_arquivo.jpg"
5. Botão voltar fecha a galeria

## Fluxo 10 — Trocar tema

1. Configurações → aba Câmera → seção "Aparência"
2. Toggle "Tema claro"
3. Ativado: fundo claro, cartões escuros, status bar clara
4. Desativado: fundo escuro, cartões escuros com blur (iOS) ou opacos (Android)
5. Mudança imediata, sem recarregar

## Fluxo 11 — Detecção automática de OAE

1. Rodovia com OAEs cadastradas deve estar instalada (ex.: BR-226/RN)
2. GPS ativo e obtendo posição
3. Quando o veículo passa sobre uma ponte/viaduto cadastrado:
   - `findOae` detecta posição "sobre" a estrutura (dentro da extensão + 30m de buffer)
   - Nome da OAE substitui automaticamente o campo de serviço na legenda
   - Ex.: "Ponte sobre o Rio Apodi-Mossoró"
4. Funciona apenas se nenhum serviço manual estiver selecionado

## Fluxo 12 — Alerta de distância ao eixo

1. GPS ativo e rodovia instalada
2. `findKm` calcula distância perpendicular ao eixo
3. Se distância > limite configurado (padrão 300m):
   - Símbolo ⚠ aparece na linha do KM na legenda
   - Cor da legenda ao vivo muda para vermelho/alarme (`#ff9d8a`)
4. Foto capturada registra o ⚠ permanentemente na legenda
