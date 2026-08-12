# Roadmap

## Visão geral

Este roadmap reflete direções naturais de evolução identificadas a partir do estado atual do código, da arquitetura e do caso de uso do KM Check.

---

## Prioridade alta (impacto direto no campo)

### 🎯 Exportação em lote das fotos

**Problema:** Atualmente cada foto é salva individualmente. Em um dia de campo, o usuário pode tirar 50-200 fotos e precisa enviá-las ao escritório de forma organizada.

**Solução proposta:** Botão "Exportar todas" na galeria que gera um ZIP com:
- Fotos organizadas por rodovia e data
- Planilha CSV com metadados (BR, KM, lat, lon, data/hora, serviço, contrato)
- Possibilidade de filtrar por data ou rodovia

### 🎯 Relatório fotográfico automático

**Problema:** Após o campo, o engenheiro precisa montar um relatório (geralmente em Word/PDF) com as fotos legendadas.

**Solução proposta:** Geração de relatório PDF diretamente no app, com:
- Fotos em sequência de KM
- Dados da legenda em tabela
- Cabeçalho com contrato, rodovia e data

### 🎯 Melhorias na galeria interna

- Zoom com pinch na foto
- Exclusão de fotos
- Compartilhamento individual da galeria
- Filtros por data/rodovia
- Contador de fotos por sessão

---

## Prioridade média (qualidade de vida)

### 📍 Mapa de visualização

Exibir as rodovias instaladas em um mapa (Leaflet/OpenLayers com tiles offline) mostrando:
- Posição atual do usuário
- KM ao longo do eixo
- Localização das OAEs
- Fotos já tiradas (pins no mapa)

### 📍 Múltiplos contratos ativos

Permitir selecionar mais de um contrato ou alternar rapidamente entre contratos sem ir nas configurações.

### 📍 Campos customizados na legenda

Permitir ao usuário adicionar linhas customizadas na legenda (ex.: nome do fiscal, número da ordem de serviço, observações).

### 📍 Backup e restauração

Exportar/importar todas as configurações + rodovias + fotos em um único arquivo de backup, para:
- Migrar entre dispositivos
- Recuperar dados em caso de perda

---

## Prioridade baixa (evolução futura)

### 🔧 Testes automatizados

Adicionar testes unitários para a lógica de geometria e formatação, e testes E2E com Playwright para fluxos críticos. Ver [testes.md](../06-qualidade/testes.md) para detalhes.

### 🔧 Sincronização com nuvem

Usar o Supabase (já configurado no schema) para:
- Sincronizar fotos entre dispositivos
- Backup automático
- Compartilhamento com a equipe

### 🔧 Modo noturno da câmera

Ajustar brilho/contraste da prévia da câmera em condições de pouca luz. Útil para inspeções noturnas em pontes.

### 🔧 Waypoints e rotas

Permitir ao usuário marcar pontos de interesse ao longo da rodovia e criar rotas de inspeção.

### 🔧 Suporte a rodovias estaduais

Atualmente o app foca em BRs (rodovias federais com dados do SNV/DNIT). Expandir para rodovias estaduais exigiria novas fontes de dados geoespaciais.

---

## Restrições permanentes

Estas decisões de design não devem mudar:

- **Arquivo único** — o app é um único `index.html` sem build/bundler
- **Zero dependências de runtime** — não introduzir bibliotecas no cliente
- **Offline first** — toda funcionalidade core deve funcionar sem internet
- **Dados do SNV** — `data/rodovias/` é gerado automaticamente, nunca editado à mão
- **Idioma pt-BR** — interface e comentários em português do Brasil
