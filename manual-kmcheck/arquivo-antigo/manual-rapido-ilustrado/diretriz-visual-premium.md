# KM Check — Diretriz Visual Premium
## Guia Visual do Usuario — Padrao Grafico Oficial v2

---

## 1. Contexto de Uso

O PDF sera visualizado **em tela de celular** (5.0" a 6.7").
Isso significa que o usuario fara pinch-to-zoom na pagina A4.
Toda decisao de escala parte dessa premissa:

- Fontes devem ser legiveis **apos zoom de 2x a 3x** em tela de 6"
- Linhas e setas devem permanecer visiveis e nitidas em qualquer nivel de zoom
- O mockup deve ser grande o suficiente para que o usuario identifique cada botao
- Espacos em branco sao descanso visual, nao desperdicio

---

## 2. Paleta de Cores

### Cores Principais

| Funcao | Cor | Hex | Uso |
|--------|-----|-----|-----|
| Institucional | Azul-marinho | `#0B1D3A` | Titulos, cabecalhos, badges, fundo da capa |
| Apoio | Azul | `#1B4F8A` | Linhas de chamada, setas, bordas de destaque |
| Destaque funcional | Verde-limao | `#C8D830` | Apenas botoes de acao principal (shutter, Baixar, Calcular) |
| Fundo pagina | Branco | `#FFFFFF` | Fundo de todas as paginas de conteudo |
| Fundo caixa | Cinza-neve | `#F5F6F8` | Fundo das caixas explicativas |
| Borda caixa | Cinza-medio | `#DDE1E8` | Borda sutil das caixas explicativas |
| Texto principal | Grafite | `#2A3040` | Corpo de texto, descricoes |
| Texto secundario | Cinza | `#6B7385` | Subtitulos, legendas, rodape |
| Sombra | Azul-sombra | `rgba(11,29,58,0.06)` | Sombras suaves em caixas e mockup |

### Regras de Uso

- **Verde-limao** nunca em textos, nunca em fundo de caixas. Apenas em: ponta de seta do botao principal, borda de caixa do botao principal, ou preenchimento do badge de acao principal.
- **Azul** e a cor das setas e linhas de chamada em todo o documento.
- **Azul-marinho** e reservado para titulos, cabecalho e capa.
- **Grafite** e a unica cor de texto corpo. Nunca usar preto puro (#000).
- Fundo da pagina e sempre branco puro. Sem gradientes, sem texturas.

---

## 3. Tipografia

### Familia Tipografica

```
Primaria: 'Segoe UI', system-ui, -apple-system, sans-serif
Fallback: 'Helvetica Neue', Arial, sans-serif
```

Nao usar fontes decorativas, serifadas ou monoespacadas.

### Escala Tipografica

| Elemento | Tamanho | Peso | Cor | Letter-spacing |
|----------|---------|------|-----|----------------|
| Titulo da capa | 42px | 700 (Bold) | Branco | -0.5px |
| Subtitulo da capa | 16px | 400 (Regular) | Branco 80% | 3px |
| Titulo da pagina | 24px | 700 (Bold) | Azul-marinho | -0.3px |
| Subtitulo da pagina | 13px | 400 (Regular) | Cinza `#6B7385` | 0.2px |
| Titulo da caixa | 13px | 700 (Bold) | Grafite `#2A3040` | 0 |
| Texto da caixa | 12px | 400 (Regular) | Grafite `#2A3040` | 0 |
| Rodape | 9px | 400 (Regular) | Cinza `#6B7385` | 0.5px |
| Label de mockup | 10px | 600 (Semibold) | Azul-marinho | 1px |

### Regras

- Titulos de pagina: `text-wrap: balance`
- Textos de caixa: maximo 2 linhas. Se nao cabe em 2 linhas, reescrever mais curto.
- Nenhum texto em caixa alta (UPPERCASE) exceto labels de mockup e subtitulo da capa.
- Line-height padrao: 1.5 para textos, 1.2 para titulos.

---

## 4. Formato da Pagina

### Dimensoes

| Propriedade | Valor |
|-------------|-------|
| Formato | A4 vertical (210mm x 297mm) |
| Margem superior | 16mm |
| Margem inferior | 14mm |
| Margem lateral | 18mm |
| Area util | 174mm x 267mm |
| Cabecalho | 16mm de altura (titulo + subtitulo) |
| Rodape | 8mm de altura |
| Area de conteudo | 174mm x 243mm |

### Zonas da Pagina

```
┌──────────────────────────────────┐
│  MARGEM SUPERIOR (16mm)          │
│  ┌────────────────────────────┐  │
│  │  CABECALHO                 │  │
│  │  Titulo da Tela            │  │
│  │  Subtitulo descritivo      │  │
│  ├────────────────────────────┤  │
│  │                            │  │
│  │                            │  │
│  │  AREA DE CONTEUDO          │  │
│  │                            │  │
│  │  Mockup centralizado       │  │
│  │  + caixas com setas        │  │
│  │                            │  │
│  │                            │  │
│  │                            │  │
│  ├────────────────────────────┤  │
│  │  RODAPE                    │  │
│  │  KM Check · Guia Visual    │  │
│  └────────────────────────────┘  │
│  MARGEM INFERIOR (14mm)          │
└──────────────────────────────────┘
```

---

## 5. Mockup do Smartphone

### Especificacao do Frame

| Propriedade | Valor |
|-------------|-------|
| Largura do frame | 260px |
| Proporcao | 9:19.5 (375:812 escalado) |
| Altura resultante | ~564px |
| Border-radius | 36px |
| Borda | 3px solid `#2A3040` |
| Sombra | `0 16px 48px rgba(11,29,58,0.12), 0 4px 12px rgba(11,29,58,0.06)` |
| Fundo interno | `#000` (preenche cantos arredondados) |
| Notch | Largura 90px, altura 22px, border-radius inferior 16px, fundo `#000` |

### Posicionamento

- **Centralizado horizontalmente** na area de conteudo
- **Deslocamento vertical**: topo do mockup a 30mm do cabecalho (permite caixas acima se necessario)
- O mockup ocupa **55% a 65% da altura da area de conteudo**
- A tela dentro do mockup deve ser **perfeitamente legivel** quando o usuario faz zoom de 2x no celular

### Regras Visuais

- Sem logos Apple, Samsung ou qualquer marca
- Sem botoes fisicos laterais
- Notch generico centralizado (apenas forma escura, sem camera/speaker)
- Screenshot encaixada perfeitamente dentro do frame, sem bordas internas visiveis
- O screenshot deve ser do tema claro do app (exceto na pagina de comparacao de temas)

---

## 6. Setas e Linhas de Chamada

### Principio Fundamental

> Cada seta sai de um ponto no mockup e termina em uma caixa explicativa.
> O leitor segue a seta com os olhos para entender "isto faz aquilo".
> Nenhum numero, nenhum intermediario.

### Especificacao Tecnica

| Propriedade | Valor |
|-------------|-------|
| Espessura da linha | 1.5px |
| Cor da linha | Azul `#1B4F8A` com 70% opacidade |
| Estilo | Solida (nao tracejada, nao pontilhada) |
| Terminacao no mockup | Circulo preenchido (dot) de 5px, cor Azul `#1B4F8A` |
| Terminacao na caixa | Sem ponta (a linha encontra a borda da caixa) |
| Cor especial para acao principal | Verde-limao `#C8D830` (apenas 1 seta por pagina, no maximo) |

### Tipos de Trajetoria (em ordem de preferencia)

1. **Reta horizontal**: quando a caixa esta alinhada horizontalmente com o elemento
2. **L-shape (angulo 90°)**: sai horizontal do mockup, vira vertical ate a caixa (ou vice-versa)
3. **Curva suave**: quando nao ha espaco para L-shape sem cruzar outras linhas

### Regras de Roteamento

- Setas **nunca cruzam** outras setas
- Setas **nunca atravessam** o corpo do mockup (saem pela lateral mais proxima)
- Setas do lado esquerdo do mockup → caixas posicionadas a esquerda
- Setas do lado direito do mockup → caixas posicionadas a direita
- Distancia minima entre o mockup e a caixa: 12px
- Distancia minima entre duas setas paralelas: 8px
- O ponto de ancoragem (dot) deve estar **exatamente** sobre o botao/campo alvo

### Implementacao SVG

```html
<!-- Exemplo de seta reta com dot -->
<svg class="connectors" viewBox="0 0 700 900">
  <!-- Dot de ancoragem no mockup -->
  <circle cx="350" cy="200" r="4" fill="#1B4F8A"/>
  <!-- Linha ate a caixa -->
  <line x1="350" y1="200" x2="540" y2="200"
        stroke="#1B4F8A" stroke-width="1.5" opacity="0.7"/>
</svg>

<!-- Exemplo de seta L-shape -->
<svg class="connectors" viewBox="0 0 700 900">
  <circle cx="280" cy="350" r="4" fill="#1B4F8A"/>
  <polyline points="280,350 160,350 160,310"
           stroke="#1B4F8A" stroke-width="1.5" opacity="0.7"
           fill="none"/>
</svg>

<!-- Seta de destaque (acao principal) -->
<svg class="connectors" viewBox="0 0 700 900">
  <circle cx="350" cy="750" r="5" fill="#C8D830"/>
  <line x1="350" y1="750" x2="540" y2="750"
        stroke="#C8D830" stroke-width="2" opacity="0.85"/>
</svg>
```

---

## 7. Caixas Explicativas

### Especificacao

| Propriedade | Valor |
|-------------|-------|
| Largura | 150px a 180px (fixa por pagina, consistente) |
| Padding | 10px 12px |
| Border-radius | 10px |
| Fundo | `#F5F6F8` (cinza-neve) |
| Borda | 1px solid `#DDE1E8` |
| Sombra | `0 2px 8px rgba(11,29,58,0.06)` |
| Titulo | 13px, Bold, Grafite `#2A3040` |
| Texto | 12px, Regular, Grafite `#2A3040`, line-height 1.5 |

### Caixa de Destaque (acao principal — max 1 por pagina)

| Propriedade | Valor |
|-------------|-------|
| Borda | 1.5px solid `#C8D830` |
| Fundo | `#F9FAF0` (branco esverdeado muito sutil) |
| Demais propriedades | Identicas a caixa padrao |

### Regras de Conteudo

- **Titulo**: nome da funcao em 1 a 3 palavras (ex: "Resolucao", "Lado da Via", "Disparar Foto")
- **Texto**: explicacao em **no maximo 2 linhas** (ex: "Define a qualidade em megapixels da foto capturada.")
- Se a explicacao nao cabe em 2 linhas, **reescreva mais curto**
- Sem numeracao, sem badges, sem icones dentro da caixa
- Sem ":" apos o titulo (o peso bold ja diferencia)

### Exemplos de Textos Curtos

| Titulo | Texto |
|--------|-------|
| Resolucao | Define os megapixels da foto. Maior = mais detalhe. |
| Formato | Proporcao da foto: 1:1, 4:3 ou 16:9. |
| Registrar Evidencia | Abre a camera para capturar foto com legenda automatica. |
| Baixar Rodovia | Importa dados do SNV/DNIT. Requer internet apenas neste momento. |
| Calcular KM | Converte coordenadas coladas em KM da rodovia mais proxima. |
| Opacidade | Transparencia da legenda. Deslize para ajustar de 0% a 100%. |
| Lado da Via | Escolha LD (direito) ou LE (esquerdo) antes de fotografar. |
| Tema | Alterna entre visual claro e escuro. Nao afeta a foto. |

---

## 8. Cabecalho da Pagina

### Estrutura

```
Titulo da Tela
Frase curta sobre a finalidade
```

### Especificacao

| Elemento | Estilo |
|----------|--------|
| Titulo | 24px, Bold, Azul-marinho `#0B1D3A` |
| Subtitulo | 13px, Regular, Cinza `#6B7385`, margin-top 4px |
| Alinhamento | Esquerda |
| Margem inferior | 14px ate o conteudo |

### Regras

- **Sem numero de capitulo** (nem visivel, nem em badge)
- Titulo deve ser o nome da tela como o usuario ve no app (ex: "Tela Inicial", "Configuracoes da Camera")
- Subtitulo e uma frase util, nao descricao tecnica
  - Bom: "Ajuste qualidade, formato e comportamento da captura"
  - Ruim: "Opcoes de configuracao da aba Camera do modulo de Configuracoes"

---

## 9. Rodape da Pagina

### Estrutura

```
KM Check · Guia Visual do Usuario                              3
```

### Especificacao

| Elemento | Estilo |
|----------|--------|
| Texto | 9px, Regular, Cinza `#6B7385` |
| Numero da pagina | 9px, Semibold, Cinza `#6B7385`, alinhado a direita |
| Separador superior | Linha 1px `#E8EBF0`, margin-bottom 6px |
| Alinhamento | Justify (texto esquerda, numero direita) |

---

## 10. Modelo de Composicao — Pagina Padrao Anotada

### Layout de Referencia (1 pagina = 1 tela do app)

```
┌──────────────────────────────────────────────┐
│                                              │
│  Tela Inicial                                │
│  Painel principal com posicao e atalhos      │
│                                              │
│  ┌──────────┐          ┌────────────────┐    │
│  │ Placa KM │──────────│  ╭──────────╮  │    │
│  │ KM atual │          │  │  ▄▄▄▄    │  │    │
│  │ via GPS  │          │  │  ████    │  │    │
│  └──────────┘     ●────│  │  KM     │  │    │
│                        │  │         │  │    │
│  ┌──────────┐          │  │  ┌──┐┌──┐│  │    │
│  │Configura-│──────────│  │  │⚙ ││🛣 ││  │    │
│  │coes      │     ●────│  │  └──┘└──┘│  │    │
│  └──────────┘          │  │         │  │    │
│                        │  │   📷    │  │────┐│
│                        │  ╰──────────╯  │   ││
│                        └────────────────┘   ││
│                                     ┌───────┘│
│                              ┌──────┴───────┐│
│                              │Registrar     ││
│                              │Evidencia     ││
│                              │Abre a camera ││
│                              │com legenda.  ││
│                              └──────────────┘│
│                                              │
│  ── ── ── ── ── ── ── ── ── ── ── ── ── ──  │
│  KM Check · Guia Visual do Usuario        3  │
└──────────────────────────────────────────────┘
```

Neste modelo:
- O mockup esta centralizado e ocupa ~60% da altura
- 4 caixas explicativas posicionadas dos lados esquerdo e direito
- Cada caixa tem uma linha reta ou L-shape conectando ao ponto exato
- A caixa de "Registrar Evidencia" tem borda verde-limao (acao principal)
- Sem numeros em nenhum lugar

### Distribuicao de Caixas

| Posicao | Lado preferencial |
|---------|-------------------|
| Elementos do topo do mockup (logo, busca, voltar) | Caixas no topo, dos lados |
| Elementos do meio (cards, campos) | Caixas alinhadas horizontalmente |
| Elementos do rodape (botao principal, barra inferior) | Caixas abaixo ou ao lado inferior |

Regra de ouro: **a caixa deve estar na mesma faixa vertical que o elemento alvo**. Se o botao esta a 60% de altura no mockup, a caixa deve estar a ~60% de altura na pagina.

---

## 11. Paginas Especiais

### Capa

| Propriedade | Valor |
|-------------|-------|
| Fundo | Gradiente `linear-gradient(160deg, #0B1D3A, #0F2847, #1B4F8A)` |
| Logo | SVG centralizado, 90px, fundo branco com border-radius 22px |
| Titulo | 42px Bold, branco, centralizado |
| Subtitulo | 16px Regular, branco 80%, uppercase, letter-spacing 3px |
| Elemento diferencial | Mockup do Home screen flutuando ao lado, levemente inclinado (rotate -5deg), escala 0.6, opacidade 90% |
| CTA inferior | "Uma pagina por tela. Direto ao ponto." — 13px, branco 60% |

### Pagina de Navegacao (Mapa Visual)

- Nao segue o layout padrao de mockup+setas
- Layout especial: 4 mockups menores (180px) dispostos em grid 2x2
- Setas curvas entre os mockups indicando fluxo de navegacao
- Labels nos fluxos: "toque Configuracoes", "toque lupa", "toque camera"

### Pagina de Temas (Comparacao)

- Layout especial: 2 mockups lado a lado (220px cada)
- Seta curva entre eles com label "Configuracoes > Aparencia"
- Sem caixas explicativas — apenas labels "Tema Claro" e "Tema Escuro" e 1 frase cada

### Pagina de Dicas

- Layout de cards (grid 2x3)
- Cada card: icone SVG + titulo bold + 2 linhas de texto
- Card "Primeiro Uso" em destaque: largura total, fundo azul-marinho, texto branco
- Sem mockup, sem setas

---

## 12. Regras de Consistencia

### Obrigatorias em Todas as Paginas

| Regra | Descricao |
|-------|-----------|
| Mesmo tamanho de mockup | 260px de largura em todas as paginas com mockup |
| Mesmo estilo de caixa | Border-radius, sombra, padding identicos |
| Mesmo estilo de seta | Espessura, cor, opacidade identicos |
| Mesmo cabecalho | Titulo 24px Bold + subtitulo 13px Regular |
| Mesmo rodape | Posicao, fonte, separador identicos |
| Maximo 5-6 setas | Se a tela tem mais elementos, dividir em 2 paginas |
| 1 destaque verde por pagina | Apenas o elemento de acao principal recebe cor verde |

### Proibicoes

| Nao fazer | Por que |
|-----------|---------|
| Numeros circulares nos callouts | Cria aparencia de checklist tecnico |
| Linhas tracejadas ou pontilhadas | Transmitem provisoriedade |
| Setas cruzando outras setas | Poluicao visual, confusao |
| Setas atravessando o mockup | Encobre a tela |
| Texto com mais de 2 linhas na caixa | Perde a objetividade |
| Caixas com icones ou emojis | Poluicao visual |
| Mais de 1 caixa verde por pagina | Dilui o destaque |
| Fundo colorido nas paginas | Compete com o mockup |
| Gradientes nas caixas | Aspecto datado |
| Bordas grossas | Peso visual excessivo |

---

## 13. Estrutura de Paginas Planejada

| # | Pagina | Tipo | Setas |
|---|--------|------|-------|
| 0 | Capa | Especial | 0 |
| 1 | Navegacao do app | Mapa visual | 4 fluxos |
| 2 | Tela Inicial | Padrao anotada | 5 |
| 3 | Camera (parte 1 — viewfinder e controles laterais) | Padrao anotada | 5 |
| 4 | Camera (parte 2 — barra inferior e legenda) | Padrao anotada | 4 |
| 5 | Configuracoes da Camera | Padrao anotada | 5 |
| 6 | Configuracoes da Legenda | Padrao anotada | 4 |
| 7 | Gestao de Eixo — Download | Padrao anotada | 4 |
| 8 | Gestao de Eixo — Importacao | Padrao anotada | 3 |
| 9 | Consulta de Coordenadas | Padrao anotada | 4 |
| 10 | Temas e Aparencia | Comparacao | 1 fluxo |
| 11 | Dicas Rapidas | Cards | 0 |

Total: 12 paginas (era 10, agora dividindo Camera e Gestao em 2 cada)

---

## 14. Checklist de Validacao por Pagina

Antes de finalizar cada pagina, verificar:

- [ ] Mockup esta com 260px de largura?
- [ ] Todas as setas saem de um ponto exato no mockup?
- [ ] Nenhuma seta cruza outra?
- [ ] Nenhuma seta atravessa o mockup?
- [ ] Cada caixa tem no maximo 2 linhas de texto?
- [ ] Existe no maximo 1 caixa com borda verde?
- [ ] Nao ha numeros circulares?
- [ ] Cabecalho segue o padrao (titulo + subtitulo)?
- [ ] Rodape esta presente e consistente?
- [ ] A pagina tem no maximo 5-6 caixas?
- [ ] O texto e legivel em celular com zoom de 2x?

---

*Diretriz Visual Premium — KM Check Guia Visual do Usuario v2*
*Documento de referencia para producao do novo PDF*
