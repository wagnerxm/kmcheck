# Interpolação de KM

## Visão geral

O KM Check interpola o quilômetro rodoviário a partir de coordenadas GPS, usando a geometria do eixo das rodovias federais (dados do SNV/DNIT). O cálculo é inteiramente local — não depende de servidor nem de internet.

---

## Dados de entrada

Cada rodovia instalada (`S.bases[]`) contém arrays paralelos:

```js
{
  id: 'BR-226/RN',
  br: 'BR-226',
  uf: 'RN',
  fonte: 'SNV 202607a',
  kmMin: 280.000,
  kmMax: 421.100,
  lat: [float, float, ...],   // latitudes dos vértices
  lon: [float, float, ...],   // longitudes dos vértices
  km:  [float, float, ...]    // quilometragem de cada vértice
}
```

Os vértices formam uma **polilinha** representando o eixo da rodovia. Cada segmento (vértice `i` → vértice `i+1`) tem um KM inicial e final.

---

## Algoritmo: `findKm(lat, lon)`

### Passo a passo

1. Para cada rodovia instalada e cada segmento (par de vértices consecutivos):
   - Projeta o ponto GPS perpendicularmente sobre o segmento (projeção escalar `t` limitada a [0, 1])
   - Calcula a distância² ao ponto projetado
2. Seleciona o segmento com menor distância²
3. Interpola o KM linearmente: `km = km[i] + t × (km[i+1] - km[i])`
4. Calcula a distância real em metros: `dist = √(d²) × π/180 × R_terra`

### Detalhes matemáticos

A projeção usa **coordenadas geográficas com correção de cosseno** para compensar a convergência dos meridianos:

```js
const cos = Math.cos(lat * D2R);  // fator de escala para a longitude
const dx = (bx - ax) * cos;      // Δlon corrigido
const dy = by - ay;               // Δlat (sem correção)
```

O parâmetro `t` da projeção é clamped: `t < 0 → 0`, `t > 1 → 1` — garante que o ponto mais próximo esteja dentro do segmento.

### Resultado

```js
{
  km: 409.120,        // quilômetro interpolado
  dist: 12.3,         // distância ao eixo em metros
  br: 'BR-226',
  uf: 'RN',
  axLat: -6.077500,   // coordenada projetada no eixo
  axLon: -37.891200
}
```

---

## Algoritmo: `kmToCoord(base, km)`

Operação inversa — dado um KM, encontra a coordenada no eixo:

1. Percorre os segmentos procurando aquele que contém o KM
2. Interpola lat/lon linearmente dentro do segmento
3. Retorna `{lat, lon}` ou `null` se fora da faixa

---

## OAEs (Obras de Arte Especiais)

O array `OAES` (embutido no `index.html`) contém pontes e viadutos do contrato. A função `findOae(br, uf, km)` verifica se o usuário está:

- **Sobre** uma OAE: distância ≤ metade da extensão + 30m → modo `'sobre'`
- **Próximo** de uma OAE: distância ≤ 1 km → modo `'prox'`

O nome da OAE aparece na legenda quando detectado (configurável em `kc-oae`).

---

## Estaca rodoviária

A função `estacaDe(km)` converte KM em estaca (unidade rodoviária brasileira):

```
1 estaca = 20 metros
km 12,345 → 12345 m → Est. 617+5
```

Formato: `Est. NNN+R` onde `NNN` = número da estaca e `R` = resto em metros.

---

## Consulta interativa (tela `#scr-query`)

### Coordenada → KM

- O usuário cola coordenadas no textarea (aceita vírgula decimal, tab, colagem do Excel)
- `parseCoordLines()` identifica automaticamente lat, lon e km opcionais
- `findKm()` é chamado para cada ponto → resultado em tabela com cores:
  - Verde (`.okc`): KM encontrado, distância OK
  - Amarelo (`.warnc`): KM encontrado, mas distância > limiar
  - Vermelho (`.errc`): sem eixo compatível
- Botão "Copiar resultado" gera TSV para colar no Excel

### KM → Coordenada

- O usuário seleciona a rodovia e digita o KM
- `kmToCoord()` retorna a coordenada correspondente

---

## Performance

O algoritmo é O(n) no número total de vértices de todas as rodovias instaladas. Para o caso típico (1-5 rodovias, cada uma com ~20-50 trechos), a busca é virtualmente instantânea. Não há estrutura de indexação espacial (R-tree, etc.) — a simplicidade é preferida dado o volume de dados.
