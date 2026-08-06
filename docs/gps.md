# GPS

## Visão geral

O KM Check usa o GPS do celular para rastrear a posição em tempo real, interpolar o KM da rodovia mais próxima e atualizar a legenda da câmera automaticamente — tudo localmente, sem servidor.

---

## Inicialização

O GPS é iniciado pela função `startGps()`, chamada em dois momentos:

1. **Boot do app** — assim que a página carrega (dentro da IIFE de boot)
2. **Abertura da câmera** — `openCam()` chama `startGps()` para garantir

```js
navigator.geolocation.watchPosition(callback, error, {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 20000
});
```

### Parâmetros

- **`enableHighAccuracy: true`** — força o GPS real (não Wi-Fi/cell tower), essencial para precisão de campo.
- **`maximumAge: 1000`** — aceita posição em cache de até 1 segundo (evita atraso, sem usar dado velho demais).
- **`timeout: 20000`** — espera até 20s por um fix (celulares em campo podem demorar na primeira leitura).

---

## Estado do GPS

Cada leitura atualiza `S.pos`:

```js
S.pos = {
  lat: number,   // latitude (graus decimais)
  lon: number,   // longitude (graus decimais)
  acc: number,   // precisão em metros (±)
  alt: number,   // altitude (pode ser null)
  t: number      // timestamp (Date.now())
};
```

E dispara o cálculo de `S.fix` (resultado do `findKm`) — ver [km.md](km.md).

---

## Atualização da interface

A função `paintGps()` é chamada:

- A cada nova posição do GPS (callback do `watchPosition`)
- Periodicamente via `setInterval` enquanto a câmera está aberta (1s no iOS, 2s no Android)

### Elementos atualizados

| Elemento | ID | Conteúdo |
|---|---|---|
| KM grande (hero) | `#kmbig` | `409,120` (ou `—` sem fix) |
| Rodovia (hero) | `#herobr` | `BR-226/RN` |
| Estaca | `#heroestaca` | `Est. 20456+0` |
| Latitude | `#latval` | `-6,077710` |
| Longitude | `#lonval` | `-37,891500` |
| Placa KM | `#sign-br`, `#sign-km` | SVG da placa rodoviária |
| Legenda ao vivo | `#liveplate` | Texto completo na câmera |

---

## Legenda ao vivo

A função `buildInfo()` monta as informações para a legenda a partir do GPS:

```js
{
  data: '06/08/2026',
  hora: '14:35',
  dt: Date,
  src: 'gps',
  lat: -6.077710,
  lon: -37.891500,
  acc: 5,          // precisão em metros
  br: 'BR-226',
  uf: 'RN',
  km: 409.120,
  dist: 12         // distância ao eixo em metros
}
```

A função `legendLines(info)` formata isso em linhas de texto:

```
BR-226/RN - KM 409,120  LD · Est. 20456+0
14 00546/2025 - Ponte sobre o Rio Apodi
-6,077710, -37,891500 (±5m)
06/08/2026, 14:35
```

---

## Alerta de distância

Quando `dist > CFG.maxdist` (padrão: 300m), o app indica que o celular está longe demais do eixo da rodovia:

- O KM grande fica vermelho (classe `.errc`)
- A legenda recebe um `⚠` no final da primeira linha
- O `#liveplate` recebe a classe `.err` (primeira linha fica `#ff9d8a`)

O limiar é configurável na tela de Ajustes (`#cfg-maxdist`).

---

## Tela sempre acesa

Para acompanhar o KM andando no carro sem o celular apagar, o app usa a **Screen Wake Lock API**:

```js
navigator.wakeLock.request('screen')
```

- Adquirido no boot, ao voltar de background e a cada toque
- Rede de segurança: `setInterval` de 15s tenta readquirir se foi liberado
- iOS 16.4+ e Android suportam; em versões anteriores, simplesmente não faz nada

---

## Formato das coordenadas

O app oferece 6 estilos de coordenadas (configurável em `kc-coordstyle`):

| Estilo | Exemplo |
|---|---|
| `decimal` (padrão) | `-6,077710, -37,891500` |
| `decimal_label` | `Lat -6,077710  Long -37,891500` |
| `compact` | `-6,077710 -37,891500` |
| `dms` | `6°04'39,8"S 37°53'29,4"O` |
| `dms_label` | `Lat 6°04'39,8"S  Long 37°53'29,4"O` |
| `gmd` | `6°04,663'S 37°53,490'O` |

---

## Formato da data

4 estilos de data (configurável em `kc-datestyle`):

| Estilo | Exemplo |
|---|---|
| `curta` | `06/08/2026` |
| `curta_hora` (padrão) | `06/08/2026, 14:35` |
| `extensa` | `6 de agosto de 2026` |
| `extensa_hora` | `6 de agosto de 2026 às 14:35` |
