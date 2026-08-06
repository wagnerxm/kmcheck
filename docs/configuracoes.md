# Configurações

## Visão geral

A tela de configurações (`#scr-settings`) é organizada em **3 abas** com controles visuais (seletores, switches, sliders):

- **Câmera** — qualidade, comportamento pós-disparo, aparência
- **Logo** — logo da empresa (upload, posição, opacidade, tamanho)
- **Legenda** — posição, cor, tamanho, conteúdo exibido, serviços, contratos

Todas as preferências são salvas no `localStorage` com prefixo `kc-*` e refletem na câmera em **tempo real** (sem precisar reabrir).

---

## Aba Câmera (`#tab-cam`)

### Qualidade

| Configuração | ID | Valores | Padrão | Descrição |
|---|---|---|---|---|
| Resolução | `#cfg-res` | Máxima, 2 MP (1080p), 4 MP (1440p), 8 MP (2160p) | 2 MP (1080p) | Resolução do stream de vídeo |
| Qualidade | `#cfg-qual` | Máxima (0.95), Alta (0.92), Média (0.85), Econômica (0.75) | Máxima (0.95) | Qualidade JPEG da foto salva |
| Formato | `#cfg-format` | 1:1, 4:3, 16:9 | 4:3 | Proporção da foto (sincronizado com o seletor na câmera) |
| Alerta sonoro | `#cfg-soundalert` | on/off | on | Som de obturador ao capturar |

> **Nota Android:** quando a resolução é "Máxima" no Android, o app limita internamente a 1080p para evitar travamento (GPU mais fraca).

### Comportamento após o disparo

| Configuração | ID | Padrão | Descrição |
|---|---|---|---|
| Aceitação automática | `#cfg-autoaccept` | on | Aceita a foto sem confirmação |
| Envio automático | `#cfg-autosave` | on | Salva a foto automaticamente |

### Aparência

| Configuração | ID | Padrão | Descrição |
|---|---|---|---|
| Tema claro | `#cfg-lighttheme` | on | Alterna entre tema escuro e claro |

---

## Aba Logo (`#tab-logo`)

### Upload da logo

1. O usuário toca em "Escolher logo"
2. Seleciona uma imagem do dispositivo
3. A imagem é redimensionada (máx. 1000px)
4. Abre o diálogo de **recorte de fundo** (`#dlg-logo`):
   - Preview sobre fundo quadriculado (checker)
   - Slider de tolerância (5-80)
   - Checkbox "Vazar áreas internas" (holes)
   - Opções: Cancelar / Usar original / Usar recorte

### Algoritmo de remoção de fundo

A função `removeBackground(src, tol, holes)`:

1. Detecta a cor de fundo pela **mediana dos pixels das bordas**
2. Calcula distância de cor de cada pixel ao fundo
3. **Modo holes:** todo pixel na cor do fundo vira transparente
4. **Modo conservador:** só o fundo conectado às bordas (flood fill)
5. Aplica **feather de 1px** na fronteira (borda suave)
6. Remove **halo** (defringe) nos pixels de transição

A logo final é salva como data URL PNG no `localStorage` (`kc-logo`).

### Ajustes da logo

| Configuração | ID | Valores | Padrão | Descrição |
|---|---|---|---|---|
| Posição | `#cfg-logopos` | Superior esquerdo, Superior direito, Inferior esquerdo, Inferior direito | Superior esquerdo | Canto onde a logo aparece na foto |
| Opacidade | `#cfg-logoop` | 20-100% | 100% | Opacidade da logo |
| Tamanho | `#cfg-logosz` | 50-180% | 100% | Tamanho relativo da logo |

---

## Aba Legenda (`#tab-leg`)

### Aparência

| Configuração | ID | Valores | Padrão | Descrição |
|---|---|---|---|---|
| Posição | `#cfg-legpos` | Inferior esquerdo, Inferior direito, Superior esquerdo, Superior direito | Inferior esquerdo | Canto da legenda |
| Tamanho | `#cfg-legsz` | Pequena (90%), Média (115%), Grande (150%), Extra grande (200%) | Grande (150%) | Tamanho do texto |
| Cor | `#cfg-legcolor` | Branco, Amarelo, Verde, Laranja, Preto | Branco | Cor do texto gravado |
| Negrito | `#cfg-legbold` | on/off | on | Peso do texto |
| Opacidade | `#cfg-legop` | 30-100% | 100% | Opacidade do texto |

### Conteúdo

| Configuração | ID | Padrão | Descrição |
|---|---|---|---|
| Exibir estaca | `#cfg-estaca` | on | Estaca correspondente ao KM |
| Nome da OAE | `#cfg-oae` | on | Nome da ponte/viaduto quando próximo |
| Coordenadas | `#cfg-coord` | on | Lat/long na legenda |
| Estilo das coordenadas | `#cfg-coordstyle` | Decimal | Formato das coordenadas (6 opções) |
| Precisão do GPS | `#cfg-acc` | off | Margem de erro (±m) |
| Formato da data | `#cfg-datestyle` | Curta + hora | Formato da data/hora (4 opções) |

### Descrição de serviços

Lista de serviços cadastrados para seleção rápida na câmera. Vem com uma lista padrão:

```
Roçada, Limpeza, Placa, Defensa, Pintura,
Drenagem, Ponte, Marco quilométrico, Outros
```

O usuário pode adicionar novos serviços ou remover os existentes. Serviços removidos da lista padrão são rastreados em `kc-svc-removed` para não reaparecerem.

### Contratos

Lista de contratos cadastrados (ex.: `14 00546/2025`). O contrato ativo aparece na segunda linha da legenda.

### Alerta de distância

| Configuração | ID | Padrão | Descrição |
|---|---|---|---|
| Distância máxima | `#cfg-maxdist` | 300m | Distância máxima ao eixo antes de alertar |

---

## Sincronização com a câmera

Todas as alterações refletem imediatamente na prévia da câmera via `refreshLive()`:

```
Alteração de configuração
        │
        ▼
  localStorage.setItem(...)
        │
        ▼
  refreshLive()
        │
        ├── layoutOverlays()   (posição/tamanho da legenda e logo)
        └── paintGps()         (texto da legenda)
```
