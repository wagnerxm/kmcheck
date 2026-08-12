# Algoritmos de Geolocalização

Documentação detalhada dos algoritmos de geolocalização implementados no KM Check. Cada seção descreve exclusivamente o que existe no código-fonte (`index.html`), com referências de linha.

---

## Sumário

1. [Localização do usuário (`startGps`)](#1-localização-do-usuário)
2. [watchPosition e parâmetros](#2-watchposition-e-parâmetros)
3. [Cálculo de distância (haversine planar)](#3-cálculo-de-distância)
4. [Projeção perpendicular sobre o eixo (`findKm`)](#4-projeção-perpendicular-sobre-o-eixo)
5. [Correção de cosseno da latitude](#5-correção-de-cosseno-da-latitude)
6. [Identificação do segmento rodoviário](#6-identificação-do-segmento-rodoviário)
7. [Cálculo do KM](#7-cálculo-do-km)
8. [Conversão KM → coordenada (`kmToCoord`)](#8-conversão-km--coordenada)
9. [Estaca rodoviária (`estacaDe`)](#9-estaca-rodoviária)
10. [Identificação de OAE (`findOae`)](#10-identificação-de-oae)
11. [Atualização da legenda (`paintGps` / `legendLines`)](#11-atualização-da-legenda)
12. [Tratamento de erro e ausência de GPS](#12-tratamento-de-erro-e-ausência-de-gps)
13. [Limites, tolerâncias e premissas](#13-limites-tolerâncias-e-premissas)

---

## 1. Localização do usuário

### Finalidade

Iniciar o rastreamento contínuo da posição GPS do dispositivo.

### Entrada

Nenhuma (usa a API nativa `navigator.geolocation`).

### Processamento

1. Verifica se já existe um watch ativo (`S.watchId != null`) ou se a API não está disponível.
2. Registra `watchPosition` com callbacks de sucesso e erro.
3. No sucesso, popula `S.pos` com `{lat, lon, acc, alt, t}` e dispara `findKm` + `paintGps`.
4. No erro, exibe mensagem no elemento `#gpsline`.

### Saída

- `S.pos` — objeto com latitude, longitude, precisão (metros), altitude e timestamp.
- `S.watchId` — ID do watcher para cancelamento futuro.

### Arquivo e função

`index.html`, função `startGps()` (linha 1585).

### Limitações conhecidas

- Não há função `stopGps()` no código; o watcher permanece ativo enquanto o app estiver aberto.
- Se a permissão for negada pelo sistema operacional, a mensagem de erro é genérica.

### Pontos de risco

- Em alguns dispositivos Android, o GPS pode travar sem chamar nenhum callback. O `timeout` de 20 s mitiga parcialmente, mas não há retry automático.

---

## 2. watchPosition e parâmetros

### Finalidade

Configurar o nível de precisão e os limites temporais do GPS.

### Parâmetros utilizados

```js
{
  enableHighAccuracy: true,  // solicita GPS real (não torre/Wi-Fi)
  maximumAge: 1000,          // aceita posição em cache de até 1 s
  timeout: 20000             // aguarda no máximo 20 s por uma leitura
}
```

### Arquivo e função

`index.html`, dentro de `startGps()` (linha 1587–1594).

### Limitações conhecidas

- `enableHighAccuracy: true` consome mais bateria; não há opção de modo econômico no app.
- `maximumAge: 1000` é curto — em cenários com sinal fraco, pode resultar em mais chamadas ao callback de erro.

### Pontos de risco

- Em iOS, o Safari pode pedir permissão a cada sessão do PWA se o usuário não concedeu "Sempre permitir".

---

## 3. Cálculo de distância

### Finalidade

Converter a diferença angular (graus) entre o ponto GPS e o ponto projetado no eixo em uma distância métrica.

### Entrada

- `best.d2` — quadrado da distância planar (em graus², já corrigida pelo cosseno na longitude).

### Processamento

A distância é calculada na etapa final de `findKm`:

```js
const dist = Math.sqrt(best.d2) * D2R * R;
```

Onde:
- `D2R = Math.PI / 180` — fator de conversão graus → radianos.
- `R = 6371008.8` — raio médio da Terra em metros.

Essa fórmula é uma **aproximação plana**: trata a distância em graus como um arco do grande círculo, válida para distâncias curtas (< 10 km), que é o caso de uso (o usuário está próximo ao eixo da rodovia).

### Saída

- `dist` — distância em metros entre o ponto GPS e o ponto mais próximo do eixo.

### Arquivo e função

`index.html`, dentro de `findKm()` (linha 1015).

### Limitações conhecidas

- Não é a fórmula de Haversine completa, mas uma linearização. O erro cresce com a distância, porém para o uso típico (< 1 km do eixo) é desprezível.
- A distância calculada é a distância 2D (não considera diferença de altitude).

### Pontos de risco

- Para rodovias em latitudes muito altas (próximas dos polos), a correção de cosseno introduziria distorção significativa. Não se aplica ao Brasil (latitudes entre -35° e 6°).

---

## 4. Projeção perpendicular sobre o eixo (`findKm`)

### Finalidade

Determinar o KM rodoviário mais provável para uma posição GPS, encontrando o ponto mais próximo sobre a polilinha do eixo da rodovia.

### Entrada

- `lat` (number) — latitude do ponto GPS.
- `lon` (number) — longitude do ponto GPS.
- `S.bases` (array) — todas as rodovias instaladas no app.

### Processamento

O algoritmo opera por **força bruta** sobre todos os segmentos de todas as rodovias:

1. Para cada rodovia (`b` em `S.bases`) e cada par consecutivo de vértices `(i, i+1)`:
   - Define o segmento `A→B` como `(ax, ay) → (bx, by)` com coordenadas lat/lon.
   - Calcula os deltas com correção de cosseno na longitude:
     ```
     dx = (bx - ax) × cos(lat)    // delta X corrigido
     dy = by - ay                  // delta Y (latitude, sem correção)
     ```
   - Calcula o vetor do ponto A ao ponto GPS `(px, py)`:
     ```
     ex = (px - ax) × cos(lat)
     ey = py - ay
     ```
   - Projeta o ponto GPS sobre o segmento usando produto escalar:
     ```
     t = (ex·dx + ey·dy) / (dx² + dy²)
     t = clamp(t, 0, 1)           // limita ao segmento
     ```
   - Calcula o vetor residual (distância²):
     ```
     fx = ex - t·dx
     fy = ey - t·dy
     d² = fx² + fy²
     ```
   - Se `d²` é o menor encontrado até agora, registra como `best`.

2. Após varrer todos os segmentos, interpola o KM no segmento vencedor:
   ```
   km = km[i] + t × (km[i+1] - km[i])
   ```

3. Interpola a coordenada do ponto projetado:
   ```
   axLat = lat[i] + t × (lat[i+1] - lat[i])
   axLon = lon[i] + t × (lon[i+1] - lon[i])
   ```

### Saída

Objeto `{km, dist, br, uf, axLat, axLon}` ou `null` se `S.bases` estiver vazio.

| Campo   | Tipo   | Descrição |
|---------|--------|-----------|
| `km`    | number | KM interpolado no eixo |
| `dist`  | number | Distância em metros até o eixo |
| `br`    | string | Código da rodovia (ex.: `"BR-226"`) |
| `uf`    | string | UF (ex.: `"RN"`) |
| `axLat` | number | Latitude do ponto projetado no eixo |
| `axLon` | number | Longitude do ponto projetado no eixo |

### Arquivo e função

`index.html`, função `findKm(lat, lon)` (linhas 996–1018).

### Limitações conhecidas

- **Complexidade O(N):** varre todos os vértices de todas as rodovias instaladas. Com 364 rodovias instaladas, a polilinha total pode ter centenas de milhares de vértices. Na prática, o usuário instala poucas rodovias (1–5), e a frequência do GPS (~1 Hz) torna o custo aceitável.
- **Sem indexação espacial:** não há R-tree, quadtree ou grade. Todos os segmentos são testados a cada atualização de GPS.
- **Projeção plana:** a projeção sobre o segmento é feita no espaço grau × grau corrigido pelo cosseno, não em projeção UTM. A precisão é suficiente para o caso de uso (distâncias curtas).

### Pontos de risco

- Se duas rodovias se cruzam e o usuário está próximo da interseção, o resultado será a rodovia com o segmento geometricamente mais próximo, sem considerar qual rodovia o usuário está percorrendo.
- Segmentos de comprimento zero (`L2 === 0`) são ignorados (`continue`), o que é correto.

---

## 5. Correção de cosseno da latitude

### Finalidade

Compensar a convergência dos meridianos em latitudes diferentes do equador, para que a distância em graus de longitude represente proporcionalmente a distância métrica real.

### Processamento

Em `findKm`, o cosseno é calculado uma vez por rodovia:

```js
const cos = Math.cos(lat * D2R);
```

E aplicado a todas as componentes X (longitude):

```js
dx = (bx - ax) * cos;   // delta do segmento
ex = (px - ax) * cos;    // delta do ponto
```

A componente Y (latitude) não recebe correção, pois 1° de latitude ≈ 111 km em qualquer ponto da Terra.

### Premissas

- O `cos` usa a **latitude do ponto GPS**, não a média do segmento. Isso é uma simplificação válida porque o ponto GPS e o segmento estão próximos (< 1 km).
- No território brasileiro (latitudes -35° a 6°), o cosseno varia de 0.82 a 1.00, o que gera erro máximo de ~0.3% no pior caso (extremo sul do RS).

### Arquivo e função

`index.html`, dentro de `findKm()` (linhas 999, 1002).

Também aplicado em `installFromSegs` na interpolação por comprimento de arco (linha 1501):

```js
const cos = Math.cos(pts[i][1] * D2R);
const dx = (pts[i][0] - pts[i-1][0]) * cos, dy = pts[i][1] - pts[i-1][1];
```

### Pontos de risco

- Nenhum risco prático para o Brasil. A aproximação falha apenas em latitudes > 80° (regiões polares).

---

## 6. Identificação do segmento rodoviário

### Finalidade

Determinar em qual segmento da polilinha o ponto GPS se projeta mais próximo.

### Processamento

Não há uma função separada — a identificação acontece dentro de `findKm`:

1. O loop interno (`for(let i=0; ...)`) percorre todos os pares de vértices consecutivos.
2. O objeto `best` armazena `{d2, t, i, b}`:
   - `i` — índice do vértice inicial do segmento vencedor.
   - `b` — referência à rodovia.
   - `t` — posição no segmento (0 = vértice `i`, 1 = vértice `i+1`).
3. Se nenhuma rodovia está instalada (`S.bases` vazio), retorna `null`.

### Arquivo e função

`index.html`, dentro de `findKm()` (linhas 998–1011).

### Limitações conhecidas

- A escolha é puramente geométrica. Não há memória do segmento anterior (não há "snap" para evitar pulos entre rodovias paralelas).

---

## 7. Cálculo do KM

### Finalidade

Interpolar o KM rodoviário exato no ponto projetado, a partir dos KMs conhecidos nos vértices do segmento.

### Processamento

Interpolação linear simples usando o parâmetro `t` da projeção:

```js
const km = b.km[i] + t * (b.km[i+1] - b.km[i]);
```

O array `b.km[]` é montado durante a instalação da rodovia (`installFromSegs`), onde o KM de cada vértice é calculado por **comprimento de arco**:

1. Para cada segmento de importação (`s` com `kmi` e `kmf`):
   - Calcula distâncias acumuladas entre vértices consecutivos (com correção de cosseno).
   - Distribui o KM proporcionalmente ao comprimento percorrido:
     ```
     km[i] = kmi + (kmf - kmi) × (acumulado[i] / total)
     ```
2. O resultado é um array monótono por trecho (mas pode não ser globalmente monótono se os trechos não forem contíguos).

### Saída

- `km` (number) — KM interpolado com precisão de metros (3 casas decimais na exibição).

### Arquivo e função

- Interpolação no GPS: `findKm()`, linha 1014.
- Montagem do array de KMs: `installFromSegs()`, linhas 1492–1517.

### Limitações conhecidas

- A interpolação é linear entre vértices. Se a polilinha tem vértices esparsos em curvas, o KM pode ter um erro de dezenas de metros na curva interna vs externa.
- Depende da qualidade dos dados de entrada (shapefiles do DNIT). KMs oficiais podem diferir da geometria real.

---

## 8. Conversão KM → coordenada (`kmToCoord`)

### Finalidade

Dado um KM, encontrar a coordenada (lat, lon) correspondente no eixo de uma rodovia específica.

### Entrada

- `base` — objeto da rodovia (com arrays `lat[]`, `lon[]`, `km[]`).
- `km` (number) — KM a converter.

### Processamento

1. Percorre os pares consecutivos do array `km[]`.
2. Para cada par, calcula `lo = min(km[i], km[i+1])` e `hi = max(km[i], km[i+1])`.
3. Se o KM solicitado está no intervalo `[lo, hi]`:
   - Calcula `t = (km - km[i]) / (km[i+1] - km[i])`.
   - Interpola: `lat = lat[i] + t × (lat[i+1] - lat[i])`, idem para `lon`.
   - Retorna `{lat, lon}`.
4. Se não encontra, retorna `null`.

### Saída

Objeto `{lat, lon}` ou `null` se o KM estiver fora da faixa instalada.

### Arquivo e função

`index.html`, função `kmToCoord(base, km)` (linhas 1019–1029).

### Limitações conhecidas

- Retorna o **primeiro** intervalo que contém o KM. Se houver segmentos sobrepostos (KM duplicado), retornará o primeiro encontrado na ordem do array.
- O uso de `min/max` no teste `[lo, hi]` garante que funciona com trechos em sentido decrescente de KM. Porém, o `t` é calculado sem `min/max`, então em trechos decrescentes o `t` resulta em valor negativo ou > 1. **Necessita validação técnica:** verificar se na prática os dados do SNV sempre produzem trechos com KM crescente, tornando esse caso teórico.

### Pontos de risco

- Usado na tela de Consulta (`#k-run`). Se o KM está fora da faixa, a interface exibe mensagem de erro com os limites (`kmMin`–`kmMax`).

---

## 9. Estaca rodoviária (`estacaDe`)

### Finalidade

Converter um KM em notação de estaca rodoviária (padrão brasileiro: 1 estaca = 20 metros).

### Entrada

- `km` (number) — KM a converter.

### Processamento

```js
const m = km * 1000;              // converte KM para metros
const est = Math.floor(m / 20);   // número da estaca (inteiro)
const resto = m - est * 20;       // resto em metros
return `Est. ${est}+${Math.round(resto)}`;
```

### Saída

String no formato `"Est. NNN+R"`. Exemplo: KM 12,345 → `"Est. 617+5"`.

### Arquivo e função

`index.html`, função `estacaDe(km)` (linhas 1653–1658).

### Limitações conhecidas

- O resto é arredondado com `Math.round`, perdendo a fração de metro. A notação padrão DNIT pode usar decimais no resto (ex.: `Est. 617+5,00`). O código atual simplifica para inteiro.
- Não há validação para KM negativo (não ocorre na prática com dados do SNV).

---

## 10. Identificação de OAE (`findOae`)

### Finalidade

Verificar se o usuário está **sobre** ou **próximo** de uma Obra de Arte Especial (ponte, viaduto, pontilhão).

### Entrada

- `br` (string) — código da rodovia (ex.: `"BR-226"`).
- `uf` (string) — UF (ex.: `"RN"`).
- `km` (number) — KM atual do usuário.

### Processamento

1. Percorre o array `OAES` (55 OAEs embutidas no código, linha 943).
2. Para cada OAE da mesma BR e UF:
   - Calcula `half = (extensão_em_km / 2) + 0.03`:
     - A extensão é dividida por 1000 (metros → km), depois por 2 (metade).
     - Soma 0.03 km (30 m) como **margem de tolerância**.
   - Calcula `d = |km_usuario - km_oae|`.
   - Se `d ≤ half`: modo **`"sobre"`** (o usuário está sobre a OAE).
   - Se `d ≤ 1.0 km` (e não está "sobre"): modo **`"prox"`** (próximo da OAE).
   - Em cada modo, guarda a OAE com menor `d` (mais próxima).

3. Retorna a OAE "sobre" (prioridade) ou a "próxima", ou `null`.

### Saída

Objeto `{o, d, mode}` ou `null`.

| Campo  | Tipo   | Descrição |
|--------|--------|-----------|
| `o`    | object | Dados da OAE (`nome`, `br`, `uf`, `km`, `ext`, `larg`, `mun`) |
| `d`    | number | Distância em KM do centro da OAE |
| `mode` | string | `"sobre"` ou `"prox"` |

### Arquivo e função

`index.html`, função `findOae(br, uf, km)` (linhas 1030–1040).

### Limitações conhecidas

- As OAEs são embutidas como constante (`OAES`), não vêm do banco de dados. Atualizar a lista requer editar o código-fonte.
- A lista atual contém apenas OAEs de contratos específicos no RN (BR-110, BR-226, BR-304, BR-405). Outras rodovias não têm OAEs cadastradas.
- A margem de 30 m (`0.03 km`) é fixa e não configurável.

### Pontos de risco

- OAEs com extensões muito pequenas (< 10 m) podem ter a zona "sobre" dominada pela margem de 30 m, indicando "sobre" quando o usuário está a ~35 m do centro.

---

## 11. Atualização da legenda (`paintGps` / `legendLines`)

### Finalidade

Montar e exibir a legenda ao vivo na tela da câmera e na tela inicial, refletindo a posição GPS em tempo real.

### Entrada

- `S.pos` — posição GPS atual.
- `S.fix` — resultado de `findKm` mais recente.
- `CFG` — configurações do usuário (estilo de coordenada, data, estaca, distância máxima, etc.).

### Processamento

#### `buildInfo()` (linha 1640)

Monta um objeto `info` a partir do estado ao vivo:

```js
{data, hora, dt, src:'gps', lat?, lon?, acc?, br?, uf?, km?, dist?}
```

#### `legendLines(info)` (linha 1659)

Monta um array de strings `L[]` representando as linhas da legenda:

1. **Linha 1 (rodovia + KM):** `"BR-226/RN - KM 409,120"`.
   - Acrescenta lado (`LD`/`LE`) se configurado (`getSide()`).
   - Acrescenta estaca se `CFG.estaca` ativo.
   - Acrescenta `⚠` se `dist > CFG.maxdist`.
2. **Linha 2 (contrato + serviço):** ex.: `"CT 00803/2024 - Roçada"`.
   - Se não há serviço selecionado e `CFG.oae` está ativo, tenta usar o nome da OAE (apenas modo `"sobre"`).
3. **Linha 3 (coordenadas):** formatada por `formatCoord()` conforme `CFG.coordstyle`.
   - Opcionalmente com precisão: `(±12m)`.
4. **Linha 4 (data/hora):** formatada por `formatDateLine()` conforme `CFG.datestyle`.

Retorna `{L, err}`, onde `err = true` se a distância excede o limite.

#### `paintGps()` (linha 1604)

Atualiza a interface:

1. **Tela inicial:** KM grande (`#kmbig`), coordenadas (`#latval`, `#lonval`), placa BR (`#sign-br`, `#sign-km`), rodovia (`#herobr`), estaca (`#heroestaca`).
2. **Legenda da câmera (`#liveplate`):** atualiza texto **sem recriar o DOM** (evita reflow/flicker no Android). Compara o conteúdo de cada `<div>` filho com o texto novo e só altera se mudou.
3. Aplica classe `.err` se a distância excede o limite.
4. Aplica classe `.bold` se `CFG.legbold` está ativo.

### Arquivo e função

`index.html`:
- `buildInfo()` — linha 1640.
- `legendLines(info)` — linha 1659.
- `paintGps()` — linha 1604.

### Limitações conhecidas

- A legenda da câmera é atualizada a cada tick do GPS (~1 Hz). Em cenários com GPS instável, pode gerar flicker visual rápido mesmo com a otimização de DOM.
- A ordem e composição das linhas é fixa no código, sem possibilidade de customização pelo usuário.

---

## 12. Tratamento de erro e ausência de GPS

### Finalidade

Garantir que o app continue funcional quando o GPS não está disponível ou retorna erro.

### Cenários tratados

| Cenário | Tratamento | Localização |
|---------|------------|-------------|
| API `geolocation` ausente | `startGps` retorna sem fazer nada | Linha 1586 |
| Watcher já ativo | `startGps` retorna (evita watcher duplicado) | Linha 1586 |
| Callback de erro do GPS | Exibe `"GPS indisponível: {mensagem}"` em `#gpsline` | Linha 1592 |
| `S.pos` é `null` (sem leitura ainda) | `paintGps` não atualiza KM/coordenadas; legenda mostra `"—"` | Linhas 1606–1621 |
| `S.fix` é `null` (sem rodovia instalada) | KM exibe `"—"`, placa BR exibe `"—"`, estaca vazia | Linhas 1617–1621 |
| Distância > `CFG.maxdist` | Classe `.errc` no KM, `⚠` na legenda, flag `err = true` | Linhas 1609, 1666 |
| Consulta sem rodovia instalada | Toast: `"Instale uma rodovia primeiro."` | Linha 2703 |
| Botão GPS na consulta sem posição | Toast: `"Aguardando posição do GPS…"` | Linha 2726 |

### Arquivo e função

`index.html`, funções `startGps()`, `paintGps()`, e handlers de consulta.

### Limitações conhecidas

- Não há retry automático após erro de GPS. O watcher continua ativo e tentará novamente na próxima leitura do sistema.
- Não há indicador visual de que o GPS está "buscando" (estado entre iniciar e receber a primeira posição).
- Não há timeout para "GPS parou de atualizar" (posição antiga continua exibida indefinidamente).

### Pontos de risco

- Se o GPS retorna erro seguido de sucesso rapidamente, a mensagem de erro pisca e some. Não há log persistente.

---

## 13. Limites, tolerâncias e premissas

### Constantes globais

| Constante | Valor | Descrição | Linha |
|-----------|-------|-----------|-------|
| `R` | `6371008.8` | Raio médio da Terra em metros (WGS-84 mean radius) | 995 |
| `D2R` | `Math.PI / 180` | Fator graus → radianos | 995 |

### Tolerâncias configuráveis

| Parâmetro | Chave localStorage | Default | Descrição |
|-----------|--------------------|---------|-----------|
| Distância máxima do eixo | `kc-maxdist` | `300` m | Acima disso, legenda mostra `⚠` e KM fica vermelho |

### Tolerâncias fixas no código

| Parâmetro | Valor | Contexto | Linha |
|-----------|-------|----------|-------|
| Margem da OAE | `0.03 km` (30 m) | Adicionada a cada lado da extensão da OAE | 1034 |
| Raio de proximidade OAE | `1.0 km` | Distância máxima para modo `"prox"` | 1037 |
| `maximumAge` do GPS | `1000 ms` | Posição em cache aceita por até 1 s | 1594 |
| `timeout` do GPS | `20000 ms` | Tempo máximo de espera por uma leitura | 1594 |
| Frequência do GPS | ~1 Hz | Determinada pelo sistema operacional, não pelo app | — |
| Estaca | `20 m` | 1 estaca = 20 metros (padrão DNIT) | 1655 |

### Premissas adotadas

1. **O usuário está próximo do eixo** — a correção de cosseno usa a latitude do ponto GPS, não a do segmento. A proximidade garante que a diferença é desprezível.

2. **Poucas rodovias instaladas** — a busca por força bruta (`findKm`) tem custo proporcional ao total de vértices. O app foi projetado para uso com 1–5 rodovias instaladas simultaneamente.

3. **Território brasileiro** — latitudes entre -35° e 6°, onde a aproximação planar com cosseno é precisa. O app não foi testado para outros países.

4. **Dados do SNV são confiáveis** — os KMs dos vértices das polilinhas vêm do shapefile oficial do DNIT (atualizado diariamente pelo workflow). O app não valida a coerência interna dos dados.

5. **Polilinha contínua por rodovia** — após a instalação, os segmentos são ordenados por KM e concatenados em arrays únicos (`lat[]`, `lon[]`, `km[]`). Lacunas entre trechos geram interpolação linear sobre o vazio, que pode produzir KMs incorretos em regiões sem dados.

6. **Projeção cartográfica** — o app opera diretamente em WGS-84 (lat/lon) com correção de cosseno, não em projeção UTM. Isso simplifica o código mas impede cálculos geodésicos de alta precisão.

---

## Diagrama de fluxo geral

```
watchPosition (GPS do dispositivo)
       │
       ▼
  S.pos = {lat, lon, acc, alt, t}
       │
       ▼
  S.bases vazio? ──sim──▶ S.fix = null
       │                      │
      não                     │
       │                      │
       ▼                      │
   findKm(lat, lon)           │
       │                      │
       ├── para cada base     │
       │   ├── para cada segmento (i, i+1)
       │   │   ├── corrige cos(lat) na longitude
       │   │   ├── projeta perpendicularmente
       │   │   └── guarda se d² < best.d²
       │   └── próxima base
       │                      │
       ▼                      │
  S.fix = {km, dist, br, uf, axLat, axLon}
       │                      │
       ▼◀─────────────────────┘
   paintGps()
       │
       ├── atualiza tela inicial (KM, coordenadas, placa, estaca)
       │
       ├── buildInfo() → legendLines(info)
       │   ├── linha 1: BR/UF - KM + lado + estaca + ⚠
       │   ├── linha 2: contrato - serviço (ou OAE)
       │   ├── linha 3: coordenadas formatadas
       │   └── linha 4: data/hora
       │
       └── atualiza #liveplate (sem recriar DOM)
```
