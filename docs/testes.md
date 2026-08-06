# Testes

## Visão geral

O KM Check atualmente **não possui uma suíte de testes automatizados**. A verificação é feita manualmente em dispositivos reais e via preview do browser. Este documento descreve as estratégias de teste recomendadas e os procedimentos manuais em uso.

---

## Teste via preview (desenvolvimento)

### Configuração

O projeto tem um `launch.json` para o preview:

```json
{
  "name": "kmcheck",
  "runtimeExecutable": "npx",
  "runtimeArgs": ["serve", "."],
  "port": 3456
}
```

### Limitações do preview

| Funcionalidade | Testável no preview | Observação |
|---|---|---|
| Layout e CSS | ✅ | Verificar dimensões via `getBoundingClientRect()` |
| Navegação entre telas | ✅ | Clicar botões, verificar classes `.on` |
| Geometria da câmera | ✅ | Simular viewport + chamar `layoutOverlays()` |
| Importação de arquivos | ✅ | Arrastar ou selecionar arquivos |
| GPS real | ❌ | Sem acesso a `watchPosition` em headless |
| Câmera real | ❌ | Sem acesso a `getUserMedia` em headless |
| Inclinação (tilt) | ❌ | Sem `DeviceMotionEvent` em headless |
| Flash | ❌ | Sem track de vídeo |
| Share API | ❌ | Sem `navigator.share` em headless |

### Simulação de viewport

Para testar o layout da câmera no preview:

```js
// Simular iPhone em paisagem
resize_window({ width: 844, height: 390 });

// Verificar geometria
javascript_tool('usefulRect()');
javascript_tool('document.getElementById("camrot").getBoundingClientRect()');
```

---

## Testes manuais em dispositivos

### Checklist para cada release

#### Câmera

- [ ] Abrir câmera (traseira e frontal)
- [ ] Trocar proporção (1:1, 4:3, 16:9)
- [ ] Tirar foto em retrato
- [ ] Tirar foto em paisagem (bloqueio desligado)
- [ ] Verificar legenda na foto (texto, posição, cor, tamanho)
- [ ] Verificar logo na foto (posição, opacidade, tamanho)
- [ ] Verificar rotação dos botões ao deitar o celular
- [ ] Flash liga/desliga
- [ ] Som de obturador
- [ ] Vibração (Android)
- [ ] Piscada de obturador
- [ ] Salvar foto (menu nativo iOS / download Android)

#### GPS e KM

- [ ] GPS inicia ao abrir o app
- [ ] KM atualiza andando de carro
- [ ] Estaca atualiza junto
- [ ] Alerta de distância (> 300m do eixo)
- [ ] Nome da OAE aparece ao passar sobre uma ponte
- [ ] Coordenadas na legenda (todos os 6 formatos)

#### Rodovias

- [ ] Baixar rodovia pelo SNV (escolher UF + BR)
- [ ] Importar shapefile (.shp + .dbf)
- [ ] Importar ZIP do DNIT
- [ ] Importar KMZ
- [ ] Importar CSV
- [ ] Remover rodovia instalada
- [ ] Baixar com filtro de KM (inicial/final)

#### Consulta

- [ ] Coordenada → KM (colar do Excel, ponto por GPS)
- [ ] KM → Coordenada
- [ ] Copiar resultado para Excel

#### Configurações

- [ ] Alterar resolução, qualidade, formato
- [ ] Upload de logo + recorte de fundo
- [ ] Ajustar posição, opacidade e tamanho da logo
- [ ] Ajustar posição, cor, tamanho e opacidade da legenda
- [ ] Adicionar/remover serviços
- [ ] Adicionar/remover contratos
- [ ] Alternar LD/LE na câmera
- [ ] Selecionar serviço/contrato na câmera (botão "i")
- [ ] Tema claro/escuro

#### Offline

- [ ] Desligar internet → app continua funcionando
- [ ] GPS + KM + câmera funcionam offline
- [ ] Fotos são salvas offline
- [ ] Voltar online → app atualiza na próxima abertura

#### Dispositivos alvo

| Dispositivo | Navegador | Prioridade |
|---|---|---|
| iPhone (qualquer) | Safari PWA | ⭐ Alta |
| Android (qualquer) | Chrome PWA | ⭐ Alta |
| Desktop | Chrome | Baixa (dev/teste) |

---

## Áreas de risco (requerem atenção especial)

### iOS/Safari

- `DeviceMotionEvent.requestPermission()` pode falhar silenciosamente se chamado fora de um gesto
- `navigator.share` exige ser chamado dentro do toque do obturador (síncrono)
- Wake Lock pode não funcionar em versões antigas
- O app pode não atualizar sem fechar completamente (app switcher)
- `screen.orientation.lock('portrait')` não funciona no Safari

### Android

- `backdrop-filter` trava em GPUs fracas → desabilitado por `[data-android]`
- Resolução "Máxima" pode travar → limitada a 1080p no Android
- `navigator.vibrate` requer interação do usuário
- Auto-play do vídeo pode falhar → `video.play()` forçado

### Gimbal lock (resolvido)

O uso do acelerômetro (gravidade) em vez de giroscópio (beta/gamma) resolveu a instabilidade ao fotografar o chão/céu. Testes devem incluir fotos apontando para baixo.

---

## Testes futuros recomendados

### Unitários

A lógica de geometria (`findKm`, `kmToCoord`, `estacaDe`, `formatCoord`) é pura (sem DOM) e ideal para testes unitários:

```js
// Exemplo de testes possíveis
assert(estacaDe(12.345) === 'Est. 617+5');
assert(fkm(409.12) === '409,120');
assert(findKm(-6.077, -37.891).br === 'BR-226');
```

### E2E

Com Playwright ou similar, seria possível testar:

- Navegação entre telas
- Importação de arquivos (shapefile, CSV)
- Consulta Coordenada → KM
- Renderização de configurações

### Visual

Comparação de screenshots (Playwright + Percy/Argos) para detectar regressões visuais no tema claro/escuro e nos diferentes formatos de câmera.
