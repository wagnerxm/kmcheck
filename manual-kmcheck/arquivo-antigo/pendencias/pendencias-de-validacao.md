# KM Check — Pendências de Validação

## Funcionalidades que não puderam ser testadas neste ambiente

O levantamento foi realizado em ambiente desktop (navegador Chrome via Claude Code). As seguintes funcionalidades dependem de hardware ou contexto que só existem em dispositivo móvel real.

---

### 1. Câmera e captura de foto
- **Status**: Não testável em desktop
- **Motivo**: `getUserMedia` requer câmera real; o navegador embutido não possui dispositivo de vídeo
- **O que ficou pendente**:
  - Abertura da câmera (frontal e traseira)
  - Legenda ao vivo sobreposta ao frame da câmera
  - Rotação automática da legenda via acelerômetro
  - Captura com diferentes proporções (1:1, 4:3, 16:9)
  - Flash/lanterna
  - Efeito de captura (flash branco, vibração, som)
  - Gravação de legenda/logo/EXIF no JPEG final
  - Nome do arquivo resultante
  - Download automático (Android) e compartilhamento (iOS)

### 2. GPS e localização
- **Status**: Não testável em desktop
- **Motivo**: Sem GPS real; coordenadas simuladas por geolocalização IP são imprecisas e não ativam a lógica de projeção ponto-segmento
- **O que ficou pendente**:
  - Atualização em tempo real de BR/KM/coordenadas na tela inicial
  - Projeção ao eixo mais próximo (`findKm`)
  - Alerta de distância ao eixo (⚠ na legenda)
  - Detecção automática de OAE
  - Botão "Usar GPS" na consulta

### 3. Acelerômetro / DeviceMotion
- **Status**: Não testável em desktop
- **Motivo**: Sem sensor de movimento
- **O que ficou pendente**:
  - Detecção de inclinação do celular
  - Rotação da legenda na câmera
  - Diálogo de permissão de movimento no iOS

### 4. Vibração tátil
- **Status**: Não testável em desktop
- **Motivo**: `navigator.vibrate` existe no Chrome desktop mas não produz efeito
- **O que ficou pendente**:
  - Vibração tátil no disparo (Android)

### 5. Fluxo de compartilhamento
- **Status**: Não testável em desktop
- **Motivo**: `navigator.share` não disponível no Chrome desktop (retorna `undefined`)
- **O que ficou pendente**:
  - Menu de compartilhamento nativo no iOS
  - Preservação do nome do arquivo ao compartilhar via WhatsApp, Drive, etc.

### 6. Instalação como PWA
- **Status**: Parcialmente testável
- **Motivo**: Manifest e Service Worker foram verificados, mas o fluxo real de instalação requer dispositivo móvel
- **O que ficou pendente**:
  - "Adicionar à tela inicial" no Android Chrome
  - "Adicionar à Tela de Início" no iOS Safari
  - Splash screen durante abertura
  - Comportamento standalone (sem barra de endereço)

### 7. Download real do SNV/DNIT
- **Status**: Parcialmente testável
- **Motivo**: O servidor WFS externo pode ser acessado em desktop, mas a verificação completa do fluxo (parsing, armazenamento IndexedDB, exibição na lista) não foi exercitada end-to-end
- **O que ficou pendente**:
  - Download com paginação real de rodovias grandes
  - Filtro por faixa de KM
  - Fallback de JSON local vs WFS ao vivo

### 8. Logo com recorte de fundo
- **Status**: Não testável em desktop
- **Motivo**: O diálogo `#dlg-logo` requer seleção de imagem e processamento Canvas
- **O que ficou pendente**:
  - Recorte automático de fundo
  - Ajuste de tolerância e "vazar áreas internas"
  - Preview e salvamento da logo
  - Logo na legenda ao vivo e na foto final

### 9. Importação de arquivos
- **Status**: Não testável em desktop (via browser embutido)
- **Motivo**: O input file não pode ser acionado programaticamente no navegador embutido
- **O que ficou pendente**:
  - Seleção de Shapefile (.shp + .dbf)
  - Descompactação de ZIP
  - Parse de KMZ/KML
  - Parse de CSV/TXT/TSV
  - Diálogos de seleção de rodovias (`#dlg-kmz`, `#dlg-csv`)

---

## Funcionalidades confirmadas em desktop

As seguintes funcionalidades foram verificadas diretamente:

| Funcionalidade | Status |
|---|---|
| Navegação entre telas (Home, Configurações, Gestão, Consulta) | Confirmada |
| Abas de configuração (Câmera, Logo, Legenda) | Confirmada |
| Todos os controles de configuração (selects, checkboxes, ranges) | Confirmada |
| Persistência de configurações em localStorage | Confirmada |
| Tema claro / escuro (toggle e visual) | Confirmada |
| Tela de consulta (campos, botões, layout) | Confirmada |
| Tela de gestão de eixo (layout, seletores UF/BR) | Confirmada |
| Crédito "Desenvolvido por Wagner Machado" (visível apenas na Home) | Confirmada |
| Borda verde no botão da câmera | Confirmada |
| Configurações padrão no primeiro acesso (`kc-defaults-v1`) | Confirmada (via código) |
| Service Worker registrado e cache ativo | Confirmada |

---

## Recomendação

Para validação completa, é necessário testar em:
1. **iPhone** (Safari / PWA standalone) — verificar permissões, share, safe area, acelerômetro
2. **Android** (Chrome / PWA standalone) — verificar download direto, vibração, tema claro, backdrop-filter desativado
3. Ambos com **GPS ativo** em rodovia instalada — verificar identificação de KM em tempo real
