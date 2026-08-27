/**
 * main.js — Processo principal do Electron para o BR-Legal 2.
 *
 * Cria a janela da aplicação, registra handlers IPC e gerencia
 * diálogos nativos de arquivo (abrir/salvar projeto, exportações).
 * Inclui:
 *  - Criação de estrutura de pastas conforme 5 volumes DNIT
 *  - Importação de rodovias do SNV (arquivos JSON)
 *  - Salvar/abrir projetos (.brlegal2.json) com sinais e geometria
 *  - Exportação CSV, DXF, PDF (via printToPDF) e XLSX (futuro)
 *  - Menu nativo com atalhos de teclado
 *  - Drag & drop de arquivos JSON do SNV
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/* Flag --dev habilita DevTools na inicialização */
const isDev = process.argv.includes('--dev');

let mainWindow = null;

/** Caminho do projeto corrente (pasta raiz) — null se nenhum aberto */
let projetoAtual = null;
/** Caminho do arquivo .brlegal2.json do projeto */
let arquivoProjeto = null;

/* ===== Janela principal ===== */

function criarJanela() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BR-Legal 2 — Projeto de Sinalização',
    backgroundColor: '#1A1F2B',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    /* Ícone — usar PNG se disponível */
    // icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  /* Abrir links externos no navegador do sistema */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  criarMenu();
}

app.whenReady().then(criarJanela);

/* macOS: recriar janela ao clicar no dock se não houver nenhuma aberta */
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) criarJanela();
});

/* Fechar app ao fechar todas as janelas (exceto macOS) */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ===== Menu nativo ===== */

function criarMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Novo Projeto',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu-acao', 'novoProjeto'),
        },
        {
          label: 'Abrir Projeto...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-acao', 'abrirProjeto'),
        },
        { type: 'separator' },
        {
          label: 'Salvar',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu-acao', 'salvar'),
        },
        {
          label: 'Salvar Como...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu-acao', 'salvarComo'),
        },
        { type: 'separator' },
        {
          label: 'Importar SNV/DNIT...',
          click: () => mainWindow?.webContents.send('menu-acao', 'importarSNV'),
        },
        { type: 'separator' },
        {
          label: 'Exportar',
          submenu: [
            {
              label: 'Projeto (JSON)',
              click: () => mainWindow?.webContents.send('menu-acao', 'exportarJSON'),
            },
            {
              label: 'Planilhas (CSV)',
              click: () => mainWindow?.webContents.send('menu-acao', 'exportarCSV'),
            },
            {
              label: 'Desenho (DXF)',
              click: () => mainWindow?.webContents.send('menu-acao', 'exportarDXF'),
            },
            {
              label: 'Relatório (PDF)',
              click: () => mainWindow?.webContents.send('menu-acao', 'exportarPDF'),
            },
          ],
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        {
          label: 'Desfazer',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu-acao', 'desfazer'),
        },
        {
          label: 'Refazer',
          accelerator: 'CmdOrCtrl+Y',
          click: () => mainWindow?.webContents.send('menu-acao', 'refazer'),
        },
        { type: 'separator' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar Tudo' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        {
          label: 'Planta de Sinalização',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.send('menu-acao', 'irPlanta'),
        },
        {
          label: 'Quantitativos',
          accelerator: 'F6',
          click: () => mainWindow?.webContents.send('menu-acao', 'irQuantitativos'),
        },
        {
          label: 'Memorial Descritivo',
          accelerator: 'F7',
          click: () => mainWindow?.webContents.send('menu-acao', 'irMemorial'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Ferramentas do Desenvolvedor' },
        { role: 'togglefullscreen', label: 'Tela Cheia' },
        { role: 'zoomIn', label: 'Aumentar Zoom' },
        { role: 'zoomOut', label: 'Diminuir Zoom' },
        { role: 'resetZoom', label: 'Zoom Padrão' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Manual DNIT — Sinalização',
          click: () => shell.openExternal('https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-manuais/vigentes/743_manual_sinalizacao_rodoviaria.pdf'),
        },
        {
          label: 'Sobre',
          click: () => {
            dialog.showMessageBoxSync(mainWindow, {
              type: 'info',
              title: 'Sobre — BR-Legal 2',
              message: 'BR-Legal 2 — Projeto de Sinalização Rodoviária',
              detail: 'Versão 0.2.0\nAplicativo para elaboração de projetos de sinalização\nconforme normas DNIT/CONTRAN.\n\nDesenvolvido para uso em projetos BR-LEGAL fase 2.',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/* ===== Handlers IPC ===== */

/**
 * createProject — Cria estrutura de pastas de um novo projeto BR-Legal 2.
 * Recebe { nome, lote, br, uf, kmInicio, kmFim, contratada, destino }.
 */
ipcMain.handle('createProject', async (_evento, dados) => {
  try {
    /* Deixa o usuário escolher a pasta-destino se não veio no payload */
    let destino = dados.destino;
    if (!destino) {
      const resultado = await dialog.showOpenDialog(mainWindow, {
        title: 'Escolha a pasta para o novo projeto',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (resultado.canceled) return { ok: false, motivo: 'cancelado' };
      destino = resultado.filePaths[0];
    }

    const raiz = path.join(destino, dados.nome || 'Projeto BR-LEGAL 2');

    /* Estrutura de pastas padrão — 5 volumes conforme DNIT */
    const pastas = [
      'Volume I - Projeto Basico/Apresentacao',
      'Volume I - Projeto Basico/Memorial de Estudos',
      'Volume I - Projeto Basico/Arquivos Editaveis',
      'Volume I - Projeto Basico/PDF',
      'Volume II - Inventario/Planilhas Editaveis',
      'Volume II - Inventario/PDF',
      'Volume III - Pranchas/DWG',
      'Volume III - Pranchas/PDF',
      'Volume IV - Projeto Executivo/Memorial Descritivo',
      'Volume IV - Projeto Executivo/Desenhos',
      'Volume IV - Projeto Executivo/Arquivos Editaveis',
      'Volume IV - Projeto Executivo/PDF',
      'Volume V - Orcamento/Quantitativos',
      'Volume V - Orcamento/Planilha Orcamentaria',
      'Volume V - Orcamento/PDF',
      'Dados SNV',
      'Fotos',
    ];

    for (const p of pastas) {
      fs.mkdirSync(path.join(raiz, p), { recursive: true });
    }

    /* Salva metadados do projeto */
    const meta = {
      versao: '0.2.0',
      nome: dados.nome,
      lote: dados.lote,
      br: dados.br,
      uf: dados.uf,
      kmInicio: dados.kmInicio,
      kmFim: dados.kmFim,
      contratada: dados.contratada,
      contrato: dados.contrato || '',
      dataInicio: dados.dataInicio || '',
      rt: dados.rt || '',
      criadoEm: new Date().toISOString(),
    };

    const arqMeta = path.join(raiz, 'projeto.brlegal2.json');
    fs.writeFileSync(arqMeta, JSON.stringify(meta, null, 2), 'utf-8');

    projetoAtual = raiz;
    arquivoProjeto = arqMeta;

    /* Atualizar título da janela */
    mainWindow.setTitle('BR-Legal 2 — ' + (meta.nome || meta.br || 'Novo Projeto'));

    return { ok: true, caminho: raiz, meta };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * openProject — Abre um projeto existente (arquivo .brlegal2.json).
 * Lê o JSON completo incluindo rodovia, sinaisColocados e dados das planilhas.
 */
ipcMain.handle('openProject', async () => {
  try {
    const resultado = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir projeto BR-Legal 2',
      filters: [
        { name: 'Projeto BR-Legal 2', extensions: ['json'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    const arquivo = resultado.filePaths[0];
    const conteudo = fs.readFileSync(arquivo, 'utf-8');
    const dados = JSON.parse(conteudo);

    projetoAtual = path.dirname(arquivo);
    arquivoProjeto = arquivo;

    /* Compatibilidade: projeto pode ter 'meta' no topo ou dados planos */
    const meta = dados.meta || dados.projeto || dados;

    mainWindow.setTitle('BR-Legal 2 — ' + (meta.nome || meta.br || path.basename(arquivo)));

    return {
      ok: true,
      caminho: projetoAtual,
      meta,
      rodovia: dados.rodovia || null,
      sinaisColocados: dados.sinaisColocados || [],
      dados: dados.dados || {},
    };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * saveProject — Salva o projeto completo (metadados, rodovia, sinais, planilhas).
 * Recebe { caminho?, meta, rodovia, sinaisColocados, dados }.
 */
ipcMain.handle('saveProject', async (_evento, payload) => {
  try {
    let destino = payload.caminho || arquivoProjeto;

    if (!destino) {
      /* Salvar como — escolher local */
      const resultado = await dialog.showSaveDialog(mainWindow, {
        title: 'Salvar projeto BR-Legal 2',
        defaultPath: (payload.meta?.nome || 'projeto').replace(/\s+/g, '-') + '.brlegal2.json',
        filters: [
          { name: 'Projeto BR-Legal 2', extensions: ['json'] },
        ],
      });
      if (resultado.canceled) return { ok: false, motivo: 'cancelado' };
      destino = resultado.filePath;
    }

    const projetoCompleto = {
      versao: '0.2.0',
      salvoEm: new Date().toISOString(),
      meta: payload.meta || {},
      projeto: payload.meta || {},
      rodovia: payload.rodovia || null,
      sinaisColocados: payload.sinaisColocados || [],
      dados: payload.dados || {},
    };

    fs.writeFileSync(destino, JSON.stringify(projetoCompleto, null, 2), 'utf-8');

    projetoAtual = path.dirname(destino);
    arquivoProjeto = destino;

    mainWindow.setTitle('BR-Legal 2 — ' + (payload.meta?.nome || payload.meta?.br || 'Projeto'));
    mainWindow.webContents.send('projeto-salvo', destino);

    return { ok: true, caminho: destino };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * saveProjectAs — Forçar "Salvar como" (novo local).
 */
ipcMain.handle('saveProjectAs', async (_evento, payload) => {
  try {
    const resultado = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar projeto BR-Legal 2 como...',
      defaultPath: (payload.meta?.nome || 'projeto').replace(/\s+/g, '-') + '.brlegal2.json',
      filters: [
        { name: 'Projeto BR-Legal 2', extensions: ['json'] },
      ],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    const destino = resultado.filePath;

    const projetoCompleto = {
      versao: '0.2.0',
      salvoEm: new Date().toISOString(),
      meta: payload.meta || {},
      projeto: payload.meta || {},
      rodovia: payload.rodovia || null,
      sinaisColocados: payload.sinaisColocados || [],
      dados: payload.dados || {},
    };

    fs.writeFileSync(destino, JSON.stringify(projetoCompleto, null, 2), 'utf-8');

    projetoAtual = path.dirname(destino);
    arquivoProjeto = destino;

    mainWindow.setTitle('BR-Legal 2 — ' + (payload.meta?.nome || 'Projeto'));
    mainWindow.webContents.send('projeto-salvo', destino);

    return { ok: true, caminho: destino };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * importSNV — Importar dados de rodovia do SNV/DNIT.
 *
 * 1. Abre diálogo para selecionar arquivo(s) JSON.
 * 2. Lê o JSON e devolve ao renderer para processamento de geometria.
 * 3. Opcionalmente copia para a pasta Dados SNV do projeto.
 */
ipcMain.handle('importSNV', async (_evento, opcoes) => {
  try {
    /* Se veio um caminho direto, lê o arquivo */
    if (opcoes?.caminho) {
      const conteudo = fs.readFileSync(opcoes.caminho, 'utf-8');
      const json = JSON.parse(conteudo);
      return {
        ok: true,
        rodovia: json,
        nomeArquivo: path.basename(opcoes.caminho),
      };
    }

    /* Diálogo para escolher arquivo(s) JSON do SNV */
    const resultado = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar rodovia — SNV/DNIT',
      filters: [
        { name: 'Rodovia SNV (JSON)', extensions: ['json'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    const arquivo = resultado.filePaths[0];
    const conteudo = fs.readFileSync(arquivo, 'utf-8');
    const json = JSON.parse(conteudo);

    /* Validar estrutura básica do SNV */
    if (!json.segments || !Array.isArray(json.segments) || json.segments.length === 0) {
      return {
        ok: false,
        motivo: 'Arquivo inválido — não contém a estrutura SNV esperada (array "segments").',
      };
    }

    /* Copiar para pasta do projeto se houver um projeto aberto */
    if (projetoAtual) {
      const pastaSNV = path.join(projetoAtual, 'Dados SNV');
      if (fs.existsSync(pastaSNV)) {
        const destino = path.join(pastaSNV, path.basename(arquivo));
        try {
          fs.copyFileSync(arquivo, destino);
        } catch (_) {
          /* Não é crítico — ignora erro de cópia */
        }
      }
    }

    return {
      ok: true,
      rodovia: json,
      nomeArquivo: path.basename(arquivo),
    };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * listSNVFiles — Lista rodovias disponíveis no repositório de dados.
 * Busca em: dados SNV do projeto, e na pasta data/rodovias do KM Check.
 */
ipcMain.handle('listSNVFiles', async () => {
  const arquivos = [];

  /* 1. Pasta do projeto */
  if (projetoAtual) {
    const pastaSNV = path.join(projetoAtual, 'Dados SNV');
    if (fs.existsSync(pastaSNV)) {
      const lista = fs.readdirSync(pastaSNV).filter(f => f.endsWith('.json'));
      for (const f of lista) {
        arquivos.push({
          nome: f.replace('.json', ''),
          caminho: path.join(pastaSNV, f),
          fonte: 'projeto',
        });
      }
    }
  }

  /* 2. Repositório KM Check local (se estiver ao lado do br-legal-2) */
  const kmcheckData = path.resolve(__dirname, '..', 'data', 'rodovias');
  if (fs.existsSync(kmcheckData)) {
    try {
      const indexPath = path.join(kmcheckData, 'index.json');
      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        for (const rodovia of index) {
          const arq = path.join(kmcheckData, rodovia.file || rodovia.arquivo || (rodovia.br + '-' + rodovia.uf + '.json'));
          if (fs.existsSync(arq)) {
            arquivos.push({
              nome: rodovia.br + '-' + rodovia.uf,
              br: rodovia.br,
              uf: rodovia.uf,
              caminho: arq,
              fonte: 'kmcheck',
            });
          }
        }
      } else {
        /* Sem index.json — listar todos os JSONs */
        const lista = fs.readdirSync(kmcheckData).filter(f => f.endsWith('.json') && f !== 'index.json');
        for (const f of lista) {
          arquivos.push({
            nome: f.replace('.json', ''),
            caminho: path.join(kmcheckData, f),
            fonte: 'kmcheck',
          });
        }
      }
    } catch (_) { /* ignora erros ao ler kmcheck */ }
  }

  return { ok: true, arquivos };
});

/**
 * exportPDF — Exporta a vista atual (ou memorial) em PDF.
 * Usa o printToPDF do Electron para renderizar a página.
 */
ipcMain.handle('exportPDF', async (_evento, opcoes) => {
  try {
    const nomeDefault = opcoes?.nome || 'BR-Legal-2-Relatorio';

    const resultado = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar PDF',
      defaultPath: nomeDefault + '.pdf',
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    /* printToPDF com configurações de engenharia */
    const pdfData = await mainWindow.webContents.printToPDF({
      landscape: opcoes?.paisagem !== false,
      marginsType: 1, /* margens mínimas */
      pageSize: opcoes?.tamanho || 'A3',
      printBackground: true,
      printSelectionOnly: false,
      scaleFactor: opcoes?.escala || 100,
    });

    fs.writeFileSync(resultado.filePath, pdfData);

    /* Copiar para pasta do projeto se existe */
    if (projetoAtual) {
      const pastaPDF = path.join(projetoAtual, 'Volume IV - Projeto Executivo', 'PDF');
      if (fs.existsSync(pastaPDF)) {
        try {
          fs.copyFileSync(resultado.filePath, path.join(pastaPDF, path.basename(resultado.filePath)));
        } catch (_) {}
      }
    }

    return { ok: true, caminho: resultado.filePath };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * exportXLSX — Exporta planilhas do Volume II.
 * Sem dependência externa, gera CSV por enquanto.
 * TODO: integrar xlsx-populate ou exceljs para XLSX real.
 */
ipcMain.handle('exportXLSX', async (_evento, opcoes) => {
  try {
    const dados = opcoes?.dados;
    if (!dados || Object.keys(dados).length === 0) {
      return { ok: false, motivo: 'Nenhuma planilha preenchida para exportar.' };
    }

    const resultado = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolha a pasta para salvar as planilhas',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    const pasta = resultado.filePaths[0];
    const arquivosGerados = [];

    for (const [chave, registros] of Object.entries(dados)) {
      if (!registros || registros.length === 0) continue;

      /* Gerar CSV com BOM UTF-8 e separador ; (compatível com Excel BR) */
      const colunas = Object.keys(registros[0]);
      let csv = '﻿'; /* BOM UTF-8 */
      csv += colunas.join(';') + '\n';
      for (const reg of registros) {
        csv += colunas.map(c => {
          let val = reg[c] ?? '';
          val = String(val).replace(/"/g, '""');
          if (val.includes(';') || val.includes('"') || val.includes('\n')) {
            val = '"' + val + '"';
          }
          return val;
        }).join(';') + '\n';
      }

      const nomeArq = chave.replace(/[^a-zA-Z0-9_-]/g, '_') + '.csv';
      const caminhoArq = path.join(pasta, nomeArq);
      fs.writeFileSync(caminhoArq, csv, 'utf-8');
      arquivosGerados.push(caminhoArq);
    }

    return { ok: true, pasta, arquivos: arquivosGerados };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * exportFile — Exporta um texto genérico para arquivo.
 * Usado para DXF, JSON, CSV, TXT etc.
 */
ipcMain.handle('exportFile', async (_evento, opcoes) => {
  try {
    const resultado = await dialog.showSaveDialog(mainWindow, {
      title: opcoes?.titulo || 'Salvar arquivo',
      defaultPath: opcoes?.nomeDefault || 'arquivo.txt',
      filters: opcoes?.filtros || [{ name: 'Todos os arquivos', extensions: ['*'] }],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    fs.writeFileSync(resultado.filePath, opcoes.conteudo, 'utf-8');

    return { ok: true, caminho: resultado.filePath };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * readFile — Lê um arquivo do disco (para importação genérica).
 */
ipcMain.handle('readFile', async (_evento, opcoes) => {
  try {
    if (opcoes?.caminho) {
      const conteudo = fs.readFileSync(opcoes.caminho, 'utf-8');
      return { ok: true, conteudo, caminho: opcoes.caminho };
    }

    const resultado = await dialog.showOpenDialog(mainWindow, {
      title: opcoes?.titulo || 'Abrir arquivo',
      filters: opcoes?.filtros || [{ name: 'Todos os arquivos', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    const conteudo = fs.readFileSync(resultado.filePaths[0], 'utf-8');
    return { ok: true, conteudo, caminho: resultado.filePaths[0] };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * openFolder — Abre uma pasta no explorador de arquivos do SO.
 */
ipcMain.handle('openFolder', async (_evento, caminho) => {
  try {
    const alvo = caminho || projetoAtual;
    if (!alvo) return { ok: false, motivo: 'Nenhuma pasta para abrir.' };
    shell.openPath(alvo);
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * getProjectPath — Retorna o caminho do projeto corrente.
 */
ipcMain.handle('getProjectPath', async () => {
  return { caminho: projetoAtual, arquivo: arquivoProjeto };
});

/* ===== Diálogos genéricos ===== */

ipcMain.handle('dialogOpen', async (_evento, opcoes) => {
  const resultado = await dialog.showOpenDialog(mainWindow, opcoes || {});
  return resultado;
});

ipcMain.handle('dialogSave', async (_evento, opcoes) => {
  const resultado = await dialog.showSaveDialog(mainWindow, opcoes || {});
  return resultado;
});
