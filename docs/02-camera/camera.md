# Câmera

## Visão geral

A tela da câmera (`#camwrap`) é uma interface fullscreen que replica a experiência da câmera nativa do celular. O vídeo da câmera ocupa a área útil, com uma camada de legenda/logo por cima que gira acompanhando a orientação do aparelho.

---

## Estrutura do DOM

```
#camwrap (fullscreen, z-index:50)
├── #camtopbar            Barra superior (Voltar + Trocar câmera)
├── #camstage             Palco do vídeo
│   ├── #camrot           Área útil (recortada pelo formato)
│   │   └── #camvideo     Elemento <video> com o stream
│   ├── #camframe         Camada da legenda/logo (gira com o aparelho)
│   │   ├── #camlogo      Logo da empresa
│   │   └── #liveplate    Legenda ao vivo (texto dinâmico)
│   └── #camflashfx       Efeito de piscada do obturador
├── #camratio             Seletor de proporção (1:1 / 4:3 / 16:9)
├── #cambar2              Barra inferior (obturador + botões)
│   ├── .cbleft           LD, LE, Serviço (i)
│   ├── #shutter          Botão do obturador
│   └── .cbright          Config, Flash, Galeria
└── #cammask              Máscara preta durante o giro
```

---

## Formatos de foto

O seletor de proporção (`#camratio`) permite escolher entre:

| Formato | Proporção (retrato) | Uso típico |
|---|---|---|
| 1:1 | Quadrado | Relatórios, redes sociais |
| 4:3 | 3:4 | Padrão de câmera digital |
| 16:9 | 9:16 | Paisagem, visão ampla |

O formato é armazenado em `localStorage` como `kc-format`. A área útil (`#camrot`) é recalculada por `usefulRect()` e o vídeo preenche com `object-fit: cover`.

---

## Inclinação (tilt)

### Problema

Quando o celular é girado para paisagem, a interface da câmera precisa acompanhar — os ícones dos botões e a legenda devem continuar "em pé" em relação ao mundo real.

### Solução: vetor de gravidade

O app usa o **acelerômetro** (`DeviceMotionEvent.accelerationIncludingGravity`) em vez de `beta`/`gamma` do giroscópio, porque:

- `gamma` sofre de **gimbal lock**: ao mirar a câmera para o chão/céu, a leitura escorrega e oscila.
- A componente da gravidade no plano da tela (x, y) não depende do pitch da câmera — só de como o aparelho está girado.

A função `tiltFromGravity(ax, ay, current)` determina o ângulo: `0` (retrato), `90` (deitado à esquerda) ou `-90` (deitado à direita). Nunca inverte (180°).

### Histerese

Para evitar oscilação na fronteira entre retrato e paisagem, há uma margem de **15°** a favor do estado atual (`HYST`).

### iOS vs Android

- **iOS (Safari):** reporta `accelerationIncludingGravity` com **sinal invertido** (bug do WebKit). O código nega `g.x` e `g.y` no iOS.
- **iOS:** requer `DeviceMotionEvent.requestPermission()` — pedido feito **antes** do `await` da câmera, porque o gesto de toque do usuário expira rápido.
- **Android:** segue a especificação e não precisa de negação.

### Fluxo

```
DeviceMotionEvent (acelerômetro)
        │
        ▼
  tiltFromGravity() → S.sensorTilt
        │
        ▼
   refreshTilt() → S.tilt = sensorTilt - screenTilt (desconta rotação da página)
        │
        ▼
   applyTilt() → rotate() nos botões + layoutOverlays() na legenda
```

---

## Captura da foto

Ao tocar no obturador (`#shutter`):

1. **Feedback imediato** (antes do processamento):
   - Piscada preta (`#camflashfx` — animação de 180ms)
   - Vibração dupla (Android: `navigator.vibrate([40,25,40])`)
   - Som de obturador (Web Audio API: dois "clicks" mecânicos curtos)

2. **Criação do canvas:**
   - Dimensões = resolução do stream de vídeo
   - Recorte conforme o formato escolhido (1:1, 4:3, 16:9)
   - Rotação conforme `S.tilt` (foto sai "em pé")
   - Espelhamento se câmera frontal

3. **Gravação da legenda** (`burnLegend`):
   - Texto (BR, KM, coordenadas, data, serviço, contrato) no canto configurado
   - Logo da empresa no canto configurado
   - Marca discreta "KM CHECK · SNV/DNIT" no canto oposto ao da legenda

4. **Injeção de EXIF** (`buildExifApp1` + `insertExif`):
   - GPS (latitude, longitude, altitude, precisão)
   - Data/hora (DateTimeOriginal, DateTimeDigitized)
   - Descrição (texto da legenda)
   - Orientation = 1 (normal, pixels já em pé)

5. **Salvamento** (`saveAndShare`):
   - **Android:** download direto (`<a download>`)
   - **iOS:** `navigator.share({files: [file]})` → menu nativo "Salvar Imagem"
   - **Galeria interna:** salva em IndexedDB (`photos` store) em paralelo

---

## Layout em paisagem

Quando a tela gira para paisagem (iPhone com bloqueio desativado):

- A barra inferior move para a **lateral direita** (via CSS `@media (orientation: landscape)`)
- A barra superior vira coluna à esquerda
- O palco e o vídeo mantêm a mesma lógica
- Uma **máscara preta** (`#cammask`) cobre o rearranjo instantaneamente e revela com fade

---

## Botões da câmera

| Botão | ID | Função |
|---|---|---|
| LD | `#cam-ld` | Marca "Lado Direito" na legenda |
| LE | `#cam-le` | Marca "Lado Esquerdo" na legenda |
| i | `#cam-svc` | Abre diálogo de serviço + contrato |
| ⚙ | `#cam-settings` | Vai para configurações (sai da câmera) |
| ⚡ | `#cam-flash` | Liga/desliga flash (torch via `applyConstraints`) |
| 🖼 | `#cam-gallery` | Abre galeria de fotos registradas |

---

## Galeria interna

- Fotos salvas em IndexedDB (object store `photos`, auto-increment)
- Navegação por **swipe** (touch events com inércia e elástico nas bordas)
- Animação de transição com `translateX` e `transitionend`
