# Backlog

## Visão geral

Lista de melhorias, correções e tarefas técnicas identificadas a partir do código atual. Organizado por área e prioridade.

---

## 🐛 Bugs conhecidos

| # | Área | Descrição | Impacto |
|---|---|---|---|
| B1 | iOS | O app pode não atualizar sem fechar completamente no app switcher | Médio — usuário fica na versão antiga |
| B2 | iOS | `screen.orientation.lock('portrait')` não funciona no Safari | Baixo — tratado com dica de bloqueio manual |
| B3 | Android | Resolução "Máxima" pode travar em alguns dispositivos | Baixo — fallback para 1080p já implementado |

---

## ✨ Melhorias de funcionalidade

| # | Área | Descrição | Prioridade |
|---|---|---|---|
| F1 | Galeria | Zoom com pinch (pinch-to-zoom) nas fotos | Alta |
| F2 | Galeria | Exclusão de fotos da galeria interna | Alta |
| F3 | Galeria | Exportação em lote (ZIP com fotos + CSV) | Alta |
| F4 | Câmera | Preview da foto antes de salvar (quando autoaccept = off) | Média |
| F5 | Legenda | Campos customizados na legenda (texto livre) | Média |
| F6 | Legenda | Segunda linha customizável (além de serviço/contrato) | Média |
| F7 | Consulta | Consulta reversa em lote (vários KMs de uma vez) | Média |
| F8 | Rodovias | Mapa de visualização das rodovias instaladas | Média |
| F9 | Exportação | Relatório fotográfico em PDF | Média |
| F10 | Config | Backup/restauração de configurações | Baixa |
| F11 | Config | Perfis de configuração (trocar entre setups) | Baixa |
| F12 | Câmera | Modo noturno (ajuste de brilho/contraste) | Baixa |

---

## 🔧 Melhorias técnicas

| # | Área | Descrição | Prioridade |
|---|---|---|---|
| T1 | Testes | Testes unitários para `findKm`, `kmToCoord`, `estacaDe`, `formatCoord` | Média |
| T2 | Testes | Testes E2E com Playwright (navegação, importação, consulta) | Média |
| T3 | Performance | Indexação espacial (R-tree) para muitas rodovias instaladas | Baixa |
| T4 | Código | Documentação inline dos parâmetros das funções principais | Baixa |
| T5 | Deploy | Monitor automático que avisa quando o deploy finalizou | Baixa |
| T6 | Dados | Suporte a rodovias estaduais (novas fontes de dados) | Baixa |

---

## 📋 Dívida técnica

| # | Área | Descrição | Prioridade |
|---|---|---|---|
| D1 | Código | Arquivo `index.html` com ~2.860 linhas — considerar split em módulos ES inline | Baixa |
| D2 | CSS | Variáveis de glass duplicadas entre tema claro e escuro | Baixa |
| D3 | LocalStorage | Logo salva como data URL pode exceder a cota (~5 MB) em logos grandes | Baixa |

---

## ✅ Recentemente concluído

| # | Área | Descrição | Data |
|---|---|---|---|
| ✅ | Câmera | Tilt por acelerômetro (vetor de gravidade) — resolve gimbal lock | 2026-07 |
| ✅ | Câmera | Layout em paisagem (bloqueio desligado) | 2026-07 |
| ✅ | Câmera | Som de obturador (Web Audio, clicks mecânicos) | 2026-07 |
| ✅ | Câmera | Galeria interna com swipe | 2026-07 |
| ✅ | Import | Shapefile parser embutido (sem libs) | 2026-07 |
| ✅ | EXIF | Metadados GPS completos nas fotos | 2026-07 |
| ✅ | Config | Remoção de fundo da logo (feather + defringe) | 2026-07 |
| ✅ | Legenda | 6 estilos de coordenadas | 2026-07 |
| ✅ | Legenda | 4 estilos de data | 2026-07 |
| ✅ | Legenda | Estaca rodoviária | 2026-07 |
| ✅ | Rodovias | Download direto do SNV (dados pré-processados) | 2026-07 |
| ✅ | Pipeline | Workflow diário de atualização dos JSONs | 2026-07 |
| ✅ | UI | Tema claro com cartões escuros | 2026-07 |
| ✅ | Android | Desabilitar backdrop-filter para performance | 2026-07 |

---

## Como priorizar

1. **Alta:** impacta o fluxo de trabalho diário do usuário em campo
2. **Média:** melhora a experiência mas tem workaround
3. **Baixa:** nice-to-have, não bloqueia o uso atual
