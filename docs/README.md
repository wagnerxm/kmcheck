# Documentação do KM Check

## Sobre o projeto

O **KM Check** é uma PWA de campo para documentação fotográfica de rodovias federais brasileiras. O app captura fotos com legenda gravada na imagem contendo rodovia, KM interpolado (SNV/DNIT), OAE, coordenadas GPS e data/hora. Funciona offline no iPhone (Safari) e Android (Chrome) após instalação na tela inicial.

**Arquitetura:** arquivo único `index.html` (~2.860 linhas) com HTML, CSS e JS inline — sem build, bundler, framework ou dependências de runtime no cliente.

---

## Objetivo desta documentação

Registrar decisões de arquitetura, algoritmos, fluxos de dados e comportamentos do app de forma que qualquer desenvolvedor ou agente de IA consiga:

- Entender o funcionamento sem ler as ~2.860 linhas do `index.html`
- Localizar rapidamente onde cada funcionalidade está implementada
- Realizar manutenções e evoluções sem introduzir regressões
- Conhecer as restrições permanentes do projeto (zero dependências, arquivo único, offline-first)

---

## Estrutura da documentação

```
docs/
├── README.md                          ← este arquivo (índice geral)
├── 01-arquitetura/                    ← visão geral, evolução e histórico
│   ├── arquitetura.md
│   ├── roadmap.md
│   └── changelog.md
├── 02-camera/                         ← captura de fotos e configurações
│   ├── camera.md
│   └── configuracoes.md
├── 03-geolocalizacao/                 ← GPS e interpolação de KM
│   ├── algoritmos.md
│   ├── gps.md
│   └── km.md
├── 04-interface/                      ← telas, navegação e temas
│   ├── componentes.md
│   └── interface.md
├── 05-dados/                          ← armazenamento, importação/exportação e offline
│   ├── database.md
│   ├── exportacao.md
│   └── offline.md
├── 06-qualidade/                      ← testes e verificação
│   └── testes.md
├── 07-gerenciamento/                  ← backlog e planejamento
│   └── backlog.md
└── 08-ia/                             ← (reservada para documentação de IA)
```

---

## Índice de documentos

### 01 — Arquitetura

| Documento | Descrição |
|-----------|-----------|
| [arquitetura.md](01-arquitetura/arquitetura.md) | Visão geral da arquitetura: mapa de arquivos, organização do JS, objetos de estado (`S`, `CFG`), fluxo de dados e Web APIs utilizadas. |
| [roadmap.md](01-arquitetura/roadmap.md) | Direções de evolução priorizadas: exportação em lote, relatório PDF, mapa, backup, testes automatizados e sincronização com nuvem. |
| [changelog.md](01-arquitetura/changelog.md) | Registro de todas as funcionalidades implementadas até o cache atual. Referência para auditorias e rastreabilidade. |

### 02 — Câmera

| Documento | Descrição |
|-----------|-----------|
| [camera.md](02-camera/camera.md) | Estrutura DOM da câmera, formatos de captura (1:1, 4:3, 16:9), detecção de tilt por acelerômetro, fluxo de captura, layout em paisagem e controles (flash, frontal, obturador). |
| [configuracoes.md](02-camera/configuracoes.md) | Três abas de configurações (Câmera / Logo / Legenda): todos os controles com IDs, tipos de valor e defaults. |

### 03 — Geolocalização

| Documento | Descrição |
|-----------|-----------|
| [gps.md](03-geolocalizacao/gps.md) | `watchPosition`, parâmetros de precisão, estado do GPS, legenda ao vivo, alerta de distância do eixo e wake lock. |
| [km.md](03-geolocalizacao/km.md) | Algoritmo `findKm` (projeção perpendicular com correção de cosseno), `kmToCoord`, detecção de OAEs e conversão para estaca rodoviária. |
| [algoritmos.md](03-geolocalizacao/algoritmos.md) | Documentação detalhada de todos os algoritmos de geolocalização: entradas, processamento, saídas, limitações e pontos de risco. |

### 04 — Interface

| Documento | Descrição |
|-----------|-----------|
| [interface.md](04-interface/interface.md) | Quatro telas (`scr-bases`, `scr-cam`, `scr-query`, `scr-settings`) + dois overlays, navegação, componentes reutilizáveis, tema Dark Glass e tema claro, otimizações Android. |
| [componentes.md](04-interface/componentes.md) | Documentação detalhada de 25 componentes visuais e funcionais: estados, comportamento iOS/Android, orientação, dependências e regras de alteração. |

### 05 — Dados

| Documento | Descrição |
|-----------|-----------|
| [database.md](05-dados/database.md) | Schema do IndexedDB (stores `bases` e `photos`), todas as chaves `localStorage` com tipos e defaults, schema Supabase (`pontos_rodovia`, `historico_fotos`). |
| [exportacao.md](05-dados/exportacao.md) | Cinco fontes de importação de rodovias (SNV, shapefile, ZIP, KMZ, CSV), parser de shapefile embutido, estrutura EXIF das fotos e mecanismo de salvamento por plataforma. |
| [offline.md](05-dados/offline.md) | Estratégias do Service Worker (rede-primeiro / cache-primeiro), versionamento de cache (`kmcheck-vNNN`), o que funciona offline e mecanismo de atualização. |

### 06 — Qualidade

| Documento | Descrição |
|-----------|-----------|
| [testes.md](06-qualidade/testes.md) | Estratégia de testes (manual + preview), limitações do ambiente headless, checklist por área, dispositivos-alvo, áreas de risco (iOS/Android) e recomendações para testes automatizados. |

### 07 — Gerenciamento

| Documento | Descrição |
|-----------|-----------|
| [backlog.md](07-gerenciamento/backlog.md) | Bugs conhecidos, melhorias funcionais e técnicas priorizadas, dívida técnica e itens recentemente concluídos. |

### 08 — IA

Pasta reservada para documentação relacionada a integrações ou funcionalidades de inteligência artificial. Sem conteúdo no momento.

---

## Guia rápido: qual documento consultar

| Tarefa | Documento |
|--------|-----------|
| Entender a estrutura geral do projeto | [arquitetura.md](01-arquitetura/arquitetura.md) |
| Alterar a câmera, obturador ou preview | [camera.md](02-camera/camera.md) |
| Modificar configurações do usuário | [configuracoes.md](02-camera/configuracoes.md) |
| Debugar GPS ou cálculo de KM | [gps.md](03-geolocalizacao/gps.md), [km.md](03-geolocalizacao/km.md) |
| Entender algoritmos de geolocalização em detalhe | [algoritmos.md](03-geolocalizacao/algoritmos.md) |
| Alterar telas, navegação ou tema | [interface.md](04-interface/interface.md) |
| Entender um componente específico da UI | [componentes.md](04-interface/componentes.md) |
| Modificar banco de dados ou localStorage | [database.md](05-dados/database.md) |
| Alterar importação/exportação de dados | [exportacao.md](05-dados/exportacao.md) |
| Entender o funcionamento offline | [offline.md](05-dados/offline.md) |
| Testar o app ou verificar uma alteração | [testes.md](06-qualidade/testes.md) |
| Consultar bugs e melhorias pendentes | [backlog.md](07-gerenciamento/backlog.md) |
| Planejar próximas funcionalidades | [roadmap.md](01-arquitetura/roadmap.md) |
| Verificar o que já foi implementado | [changelog.md](01-arquitetura/changelog.md) |

---

## Convenções da documentação

- **Idioma:** português do Brasil (pt-BR), consistente com o código e a interface do app.
- **Referências a código:** indicar nomes de funções, variáveis e IDs exatamente como aparecem no `index.html`.
- **Links internos:** usar caminhos relativos entre documentos (ex.: `../06-qualidade/testes.md`).
- **Alterações relevantes** no app devem ser registradas no [changelog.md](01-arquitetura/changelog.md).

---

**Última atualização:** 2026-08-06
