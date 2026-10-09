# KM Check — Capacidade de Geração do Manual

## 1. Screenshots automáticas (via navegador embutido)

### Possível
- Telas estáticas: Home (sem dados), Configurações (3 abas completas), Gestão de Eixo (layout), Consulta (vazia)
- Total estimado: **8 capturas** automáticas (de 36 planejadas)

### Não possível
- Qualquer tela que envolva câmera, GPS ativo, galeria com fotos, diálogos de importação, permissões do navegador
- Total: **28 capturas** requerem dispositivo real

### Qualidade
- Resolução do navegador embutido: viewport configurável (mobile 375×812, tablet 768×1024, desktop 1280×800)
- Formato: PNG via screenshot do browser pane
- As capturas mostram a interface real do app, não mockups

---

## 2. Mockups estilo iPhone

### Possibilidade
- **Sim, é possível gerar mockups** com moldura de iPhone via HTML/CSS
- Técnica: `<div>` com border-radius, notch, e barra de status simulada envolvendo screenshot real ou HTML renderizado do app
- O resultado pode ser publicado como Artifact (página web interativa) ou exportado como imagem

### Limitações
- Sem frame de dispositivo real (foto de iPhone) — o CSP do Artifact bloqueia imagens externas
- Moldura é gerada via CSS puro (border-radius, sombras, notch via pseudo-elements)
- Para mockups com foto de cena real + iPhone, seria necessário composição externa (Figma, Photoshop)

### Recomendação
- Usar mockups CSS para o manual digital (web/PDF)
- Para material de marketing com foto real do dispositivo, usar ferramenta externa

---

## 3. Geração de DOCX

### Possibilidade
- **Parcialmente possível** via código JavaScript inline no Artifact
- Bibliotecas como `docx.js` podem ser embarcadas inline (sem CDN)
- Alternativa: gerar HTML bem formatado que o usuário salva como DOCX via Word/LibreOffice

### Limitações
- Sem biblioteca externa via CDN (CSP do Artifact bloqueia)
- Precisaria embutir a biblioteca inteira como código inline — viável mas aumenta complexidade
- Tabelas, formatação, cabeçalhos: possível via HTML → DOCX
- Imagens embutidas: possível via data URIs

### Recomendação prática
- Gerar o manual como **HTML bem formatado** (Artifact)
- O usuário pode abrir no Word/LibreOffice e salvar como DOCX
- Ou: gerar Markdown que pode ser convertido via Pandoc ou similar

---

## 4. Geração de PDF

### Possibilidade
- **Sim**, via `window.print()` com CSS `@media print`
- O Artifact pode incluir estilos otimizados para impressão
- O navegador nativo converte para PDF via "Salvar como PDF"

### Limitações
- Quebras de página precisam ser gerenciadas via CSS (`page-break-before`, `page-break-after`)
- Headers/footers do navegador aparecem (podem ser desativados pelo usuário nas opções de impressão)
- Sem controle pixel-perfeito sobre margem e layout de página

### Recomendação prática
- Projetar o HTML do manual com `@media print` desde o início
- Incluir botão "Gerar PDF" que chama `window.print()`
- Para resultado profissional: exportar HTML → PDF via ferramenta externa (wkhtmltopdf, Puppeteer)

---

## 5. Resumo de capacidades

| Capacidade | Viável? | Método | Qualidade |
|---|---|---|---|
| Screenshots automáticas (telas estáticas) | Sim | Browser pane screenshot | Boa (resolução configurável) |
| Screenshots com câmera/GPS | Não | Requer celular real | — |
| Mockup estilo iPhone (CSS) | Sim | HTML/CSS com moldura | Boa para digital |
| Mockup com foto real de iPhone | Não | Requer Figma/Photoshop | — |
| Manual em HTML | Sim | Artifact | Excelente |
| Manual em Markdown | Sim | Arquivo .md | Boa |
| Exportar para DOCX | Parcial | HTML → abrir no Word | Aceitável |
| Exportar para PDF | Sim | HTML + @media print | Boa |
| Manual interativo (navegável) | Sim | Artifact com JS | Excelente |

---

## 6. Recomendação para a segunda etapa

1. **Formato principal**: HTML interativo (Artifact) — melhor experiência, navegável, responsivo, com busca
2. **Formato secundário**: PDF via `@media print` — para distribuição offline e impressão
3. **Screenshots**: combinar as 8 automáticas com as 28 manuais (fornecidas pelo desenvolvedor)
4. **Mockups iPhone**: gerar via CSS para as telas principais (Home, Câmera, Configurações)
5. **Estrutura do manual**: índice navegável, seções por funcionalidade, capturas inline, dicas e avisos
