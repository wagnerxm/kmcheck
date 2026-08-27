/**
 * main.js — Processo principal do Electron para o BR-Legal 2.
 *
 * Cria a janela da aplicação, registra handlers IPC e gerencia
 * diálogos nativos de arquivo (abrir/salvar projeto, exportações).
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/* Flag --dev habilita DevTools na inicialização */
const isDev = process.argv.includes('--dev');

let mainWindow = null;

/* ===== Janela principal ===== */

function criarJanela() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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
    /* Ícone — usar o mesmo do KM Check por ora */
    // icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

    /* Estrutura de pastas padrão */
    const pastas = [
      'Projeto Básico/Volume I/Arquivos Editáveis',
      'Projeto Básico/Volume I/PDF',
      'Projeto Básico/Volume II/Arquivos Editáveis',
      'Projeto Básico/Volume II/PDF',
      'Projeto Básico/Volume III/Arquivos Editáveis',
      'Projeto Básico/Volume III/PDF',
      'Projeto Executivo/Volume IV/Arquivos Editáveis',
      'Projeto Executivo/Volume IV/PDF',
      'Projeto Executivo/Volume V/Arquivos Editáveis',
      'Projeto Executivo/Volume V/PDF',
    ];

    for (const p of pastas) {
      fs.mkdirSync(path.join(raiz, p), { recursive: true });
    }

    /* Salva metadados do projeto */
    const meta = {
      versao: '0.1.0',
      nome: dados.nome,
      lote: dados.lote,
      br: dados.br,
      uf: dados.uf,
      kmInicio: dados.kmInicio,
      kmFim: dados.kmFim,
      contratada: dados.contratada,
      criadoEm: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(raiz, 'projeto.brlegal2.json'),
      JSON.stringify(meta, null, 2),
      'utf-8'
    );

    return { ok: true, caminho: raiz, meta };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * openProject — Abre um projeto existente (arquivo .brlegal2.json).
 */
ipcMain.handle('openProject', async () => {
  try {
    const resultado = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir projeto BR-Legal 2',
      filters: [
        { name: 'Projeto BR-Legal 2', extensions: ['brlegal2.json'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (resultado.canceled) return { ok: false, motivo: 'cancelado' };

    const arquivo = resultado.filePaths[0];
    const conteudo = fs.readFileSync(arquivo, 'utf-8');
    const meta = JSON.parse(conteudo);

    return { ok: true, caminho: path.dirname(arquivo), meta };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * saveProject — Salva dados do projeto no arquivo .brlegal2.json.
 */
ipcMain.handle('saveProject', async (_evento, dados) => {
  try {
    let caminho = dados.caminho;
    if (!caminho) {
      const resultado = await dialog.showSaveDialog(mainWindow, {
        title: 'Salvar projeto BR-Legal 2',
        defaultPath: 'projeto.brlegal2.json',
        filters: [
          { name: 'Projeto BR-Legal 2', extensions: ['brlegal2.json'] },
        ],
      });
      if (resultado.canceled) return { ok: false, motivo: 'cancelado' };
      caminho = resultado.filePath;
    }

    fs.writeFileSync(caminho, JSON.stringify(dados.meta, null, 2), 'utf-8');
    mainWindow.webContents.send('projeto-salvo', caminho);
    return { ok: true, caminho };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
});

/**
 * importSNV — Placeholder para importação de dados SNV/DNIT.
 */
ipcMain.handle('importSNV', async (_evento, opcoes) => {
  /* TODO: integrar com os dados do SNV do KM Check */
  return { ok: false, motivo: 'Importação SNV ainda não implementada.' };
});

/**
 * exportPDF — Placeholder para exportação em PDF.
 */
ipcMain.handle('exportPDF', async (_evento, opcoes) => {
  /* TODO: gerar PDFs dos volumes */
  return { ok: false, motivo: 'Exportação PDF ainda não implementada.' };
});

/**
 * exportXLSX — Placeholder para exportação em XLSX.
 */
ipcMain.handle('exportXLSX', async (_evento, opcoes) => {
  /* TODO: gerar planilhas XLSX do Volume II */
  return { ok: false, motivo: 'Exportação XLSX ainda não implementada.' };
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
