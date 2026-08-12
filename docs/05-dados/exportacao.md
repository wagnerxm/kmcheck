# Exportação e Importação

## Visão geral

O KM Check suporta múltiplos formatos de entrada para dados de rodovias e exporta fotos com metadados EXIF completos.

---

## Importação de rodovias

### Fontes de dados

| Fonte | Formato | Prioridade | Descrição |
|---|---|---|---|
| **Download direto** | JSON pré-processado / WFS | ⭐ Preferida | Seleciona UF + BR e baixa do SNV |
| **Shapefile oficial** | .shp + .dbf (+ .shx opcional) | ⭐ Mais confiável | Arquivo oficial do DNIT Cloud |
| **ZIP do DNIT** | .zip contendo .shp + .dbf | ⭐ Mais confiável | Mesmo que acima, compactado |
| **KMZ/KML** | .kmz ou .kml | Boa | Exportado do VGeo/Google Earth |
| **CSV/TXT** | .csv, .txt, .tsv | Básica | Tabela com colunas KM, LAT, LONG |

### Download direto do SNV

Fluxo do botão "Baixar" na tela de rodovias (`#dl-go`):

1. **Tenta dados pré-processados** — busca `./data/rodovias/BR-{br}-{uf}.json`
   - Esses JSONs estão no repositório, atualizados diariamente pelo workflow
   - Se encontra, usa diretamente (mais rápido, funciona sem CORS)
2. **Fallback: GeoServer do DNIT** — consulta WFS do GeoServicos/INDE
   - Descobre a layer SNV mais recente (`GetCapabilities`)
   - Baixa por paginação (1000 features por vez)
   - Filtra por BR, UF e tipo `'B'` (eixo principal)
3. **Filtragem de KM** — se o usuário especificou KM inicial/final, filtra os trechos
4. **Monta o objeto base** — `wfsToBase()` converte features GeoJSON em arrays lat/lon/km

### Shapefile (.shp + .dbf)

O parser é **embutido no app** (sem bibliotecas externas):

- `readDbfBuf(buf)` — lê o .dbf (latin1) e extrai os registros
- `readShxOffsets(buf)` — lê o .shx para acesso randômico ao .shp
- `parseShpRecord(buf)` — extrai pontos de um registro PolyLine/Polygon
- `readShpSequential(buf)` — fallback sem .shx (varredura sequencial)

**Importante:** o parser processa via `File.slice()` (fatias), sem carregar o .shp inteiro na memória — necessário porque o arquivo nacional passa de 90 MB.

Apenas trechos do tipo `'B'` (eixo principal) são importados. Trechos acessórios têm KM próprio e não servem para interpolação.

### KMZ/KML

1. Se `.kmz`: descompacta com `fflate` e extrai o `.kml` interno
2. Faz parse do XML com `DOMParser`
3. Para cada `<Placemark>` com `<LineString>`:
   - Extrai atributos de `ExtendedData` (SimpleData/Data) e `description`
   - Identifica KM inicial/final, BR e UF por padrões regex
4. Agrupa segmentos por BR/UF
5. Apresenta diálogo (`#dlg-kmz`) para o usuário escolher quais instalar

### CSV/TXT

A função `parseCoordLines(text)` é robusta:

- Aceita separadores: tab, ponto-e-vírgula, espaço, vírgula
- Aceita vírgula decimal brasileira (`-6,077710`)
- Classifica automaticamente os números em lat, lon e km:
  - **Longitude:** valor entre -75 e -32
  - **Latitude:** valor entre -35 e 6 (preferindo negativos com casas decimais)
  - **KM:** restante (positivo, com decimais)
- Aceita colagem direta do Excel

Após o parse, abre o diálogo `#dlg-csv` para o usuário identificar a rodovia (BR e UF).

---

## Instalação de rodovias

Todos os formatos convergem para `installFromSegs(key, segs, fonte)`:

1. Ordena segmentos por KM inicial
2. Para cada segmento, calcula KM por **comprimento de arco** (distância acumulada entre vértices)
3. Monta o objeto base com arrays `lat[]`, `lon[]`, `km[]`
4. Salva no IndexedDB via `dbPut()`
5. Atualiza `S.bases` e `renderBases()`

---

## Exportação de fotos

### Formato de saída

- **JPEG** com qualidade configurável (padrão 0.95)
- **EXIF embutido** (GPS, data/hora, descrição)
- **Legenda gravada** dentro da imagem (texto + logo)

### Nome do arquivo

Padrão: `{legenda} {HHMMSS}.jpg`

Exemplo: `BR-226RN - KM 409,120 LD 143521.jpg`

### Metadados EXIF

O app monta um segmento EXIF (APP1) completo sem dependências:

| Tag EXIF | Conteúdo |
|---|---|
| ImageDescription | Texto da legenda (ASCII) |
| Make | `KM Check` |
| Model | `PWA` |
| Software | `KM Check` |
| DateTime | Data/hora da captura |
| DateTimeOriginal | Idem |
| ExifVersion | `0230` |
| ColorSpace | sRGB |
| GPSLatitude | Latitude em DMS |
| GPSLongitude | Longitude em DMS |
| GPSAltitude | Altitude (se disponível) |
| GPSTimeStamp | Hora UTC |
| GPSDateStamp | Data UTC |
| GPSHPositioningError | Precisão em metros |
| Orientation | 1 (normal) |

O EXIF é injetado logo após o marcador SOI do JPEG (`insertExif`).

### Salvamento

| Plataforma | Mecanismo |
|---|---|
| **iOS** | `navigator.share({files: [file]})` → menu nativo "Salvar Imagem" |
| **Android** | `<a download>` → download direto para a pasta de downloads |
| **Desktop/outros** | `<a download>` fallback |

A foto também é salva na galeria interna (IndexedDB `photos`).

---

## Fluxo de dados das rodovias

```
                    ┌─────────────────────┐
                    │  DNIT Cloud / WFS   │
                    │  (shapefile / GeoJSON)│
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  fetch-snv-wfs.mjs  │  ← Workflow diário
                    │  (Node.js)          │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  data/rodovias/     │  ← JSONs no repositório
                    │  BR-xxx-UF.json     │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼───────┐  ┌────▼────┐  ┌────────▼────────┐
    │  Download direto │  │ KMZ/KML │  │ Shapefile / CSV  │
    │  (app, online)   │  │ (local) │  │ (local)          │
    └─────────┬───────┘  └────┬────┘  └────────┬────────┘
              │               │                │
              └───────────────┼────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  installFromSegs() │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │  IndexedDB (bases) │
                    └───────────────────┘
```
