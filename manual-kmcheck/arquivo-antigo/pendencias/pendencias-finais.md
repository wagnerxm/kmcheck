# KM Check — Pendencias Finais

## Screenshots capturadas automaticamente (10)

| Codigo | Descricao | Status |
|---|---|---|
| IMG-001 | Tela Inicial (tema claro, sem dados) | Capturada |
| IMG-003 | Tela Inicial (tema escuro) | Capturada |
| IMG-050 | Configuracoes > Camera (parte 1) | Capturada |
| IMG-051 | Configuracoes > Camera (parte 2 - scroll) | Capturada |
| IMG-052 | Configuracoes > Logo (sem logo) | Capturada |
| IMG-054 | Configuracoes > Legenda (parte 1) | Capturada |
| IMG-055 | Configuracoes > Legenda (parte 2 - scroll) | Capturada |
| IMG-056 | Configuracoes > Legenda (parte 3 - scroll) | Capturada |
| IMG-060 | Gestao de Eixo (sem rodovias) | Capturada |
| IMG-060b | Gestao de Eixo (secao importar) | Capturada |
| IMG-070 | Consulta (vazia) | Capturada |

## Screenshots pendentes (requerem dispositivo real) (28)

### Tela Inicial
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-002 | Tela Inicial com dados reais | GPS + rodovia instalada |
| IMG-003b | Tela Inicial tema escuro com dados | GPS + rodovia + tema escuro |

### Permissoes
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-010 | Permissao de localizacao | Primeiro acesso no celular |
| IMG-011 | Permissao de camera | Primeiro acesso a camera |
| IMG-012 | Permissao de movimento (iOS) | iPhone, primeiro acesso |

### Camera
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-020 | Camera vertical | GPS + rodovia + camera |
| IMG-021 | Camera horizontal | GPS + rodovia + girar celular |
| IMG-022 | Camera com LD selecionado | Camera aberta |
| IMG-023 | Camera com LE selecionado | Camera aberta |
| IMG-024 | Camera com servico selecionado | Camera + servico cadastrado |
| IMG-025 | Camera com flash ativo | Camera + flash |
| IMG-026 | Camera formato 1:1 | Camera aberta |
| IMG-027 | Camera formato 16:9 | Camera aberta |
| IMG-028 | Camera com alerta de distancia | GPS + distancia > 300m |

### Dialogos
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-030 | Seletor de servico | Camera + servicos cadastrados |
| IMG-031 | Seletor de contrato | Camera + contratos cadastrados |

### Galeria
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-040 | Galeria com foto | Pelo menos 1 foto capturada |

### Configuracoes
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-053 | Logo com logo configurada | Imagem importada |
| IMG-057 | Dialogo de recorte de fundo | Selecao de imagem |

### Gestao de Eixo
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-061 | Gestao com rodovias instaladas | Rodovia baixada |
| IMG-062 | Download em progresso | Internet + download ativo |
| IMG-063 | Selecao de rodovias (import) | Shapefile importado |
| IMG-064 | Identificacao CSV | CSV importado |

### Consulta
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-071 | Consulta com resultados | Coordenadas + rodovia |
| IMG-072 | KM para Coordenada | Rodovia instalada + KM |

### Foto resultante
| Codigo | Descricao | Requisito |
|---|---|---|
| IMG-080 | Foto com legenda completa | Captura em campo real |
| IMG-081 | Foto com logo | Captura com logo configurada |

## Limitacoes encontradas

1. **Servidor de preview**: o servidor local (`serve -s`) opera em modo SPA e redireciona rotas nao encontradas para index.html, impedindo preview direto do manual HTML na mesma porta
2. **DOCX**: nao foi possivel gerar arquivo .docx neste ambiente sem biblioteca dedicada. O manual HTML pode ser aberto no Word/LibreOffice e salvo como DOCX
3. **PDF**: nao foi possivel gerar PDF diretamente. O manual HTML inclui estilos `@media print` e botao "Gerar PDF" para exportar via funcao de impressao do navegador
4. **Screenshots de camera/GPS**: impossivel capturar em ambiente desktop (sem hardware)
5. **Mockups de fotos com camera**: placeholders inseridos no manual nos pontos que dependem de capturas reais

## Procedimento para completar as pendencias

1. Abra o manual HTML (`manual-kmcheck/manual-kmcheck.html`) em um navegador
2. Exporte como PDF usando Ctrl+P > "Salvar como PDF" ou o botao "Gerar PDF"
3. Para DOCX: abra o HTML no Word e salve como .docx
4. Capture as 28 screenshots pendentes em dispositivo real seguindo o plano em `levantamento/plano-de-capturas.md`
5. Salve as capturas em `screenshots-originais/` com os nomes padronizados
6. Para inserir no manual: edite o arquivo `build-manual.js` adicionando as novas imagens, ou edite o HTML diretamente

## O aplicativo NAO foi alterado

Nenhuma modificacao foi realizada no codigo do aplicativo (index.html, sw.js, manifest.webmanifest ou qualquer outro arquivo do app) durante a producao deste manual.
