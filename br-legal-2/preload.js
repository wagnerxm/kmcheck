/**
 * preload.js — Script de pré-carregamento do Electron.
 *
 * Expõe ao renderer (index.html) apenas os métodos IPC necessários,
 * isolando o Node do contexto da página via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  /* ===== Projeto ===== */

  /** Cria um novo projeto BR-Legal 2 no caminho escolhido pelo usuário. */
  criarProjeto: (dados) => ipcRenderer.invoke('createProject', dados),

  /** Abre um projeto existente (.brlegal2.json ou pasta). */
  abrirProjeto: () => ipcRenderer.invoke('openProject'),

  /** Salva o projeto corrente (mesmo caminho). */
  salvarProjeto: (dados) => ipcRenderer.invoke('saveProject', dados),

  /** Salva o projeto em um novo local ("Salvar como"). */
  salvarProjetoComo: (dados) => ipcRenderer.invoke('saveProjectAs', dados),

  /** Retorna o caminho do projeto corrente. */
  obterCaminhoProjeto: () => ipcRenderer.invoke('getProjectPath'),

  /* ===== Importação / Exportação ===== */

  /** Importa dados do SNV/DNIT (arquivo JSON de rodovia). */
  importarSNV: (opcoes) => ipcRenderer.invoke('importSNV', opcoes),

  /** Lista rodovias SNV disponíveis (no projeto e no KM Check). */
  listarSNV: () => ipcRenderer.invoke('listSNVFiles'),

  /** Exporta relatório em PDF (usa printToPDF do Electron). */
  exportarPDF: (opcoes) => ipcRenderer.invoke('exportPDF', opcoes),

  /** Exporta planilhas do Volume II em CSV (futuro XLSX). */
  exportarXLSX: (opcoes) => ipcRenderer.invoke('exportXLSX', opcoes),

  /** Exporta um texto genérico para arquivo (DXF, JSON, CSV, TXT). */
  exportarArquivo: (opcoes) => ipcRenderer.invoke('exportFile', opcoes),

  /** Lê um arquivo do disco. */
  lerArquivo: (opcoes) => ipcRenderer.invoke('readFile', opcoes),

  /** Abre uma pasta no explorador de arquivos do SO. */
  abrirPasta: (caminho) => ipcRenderer.invoke('openFolder', caminho),

  /* ===== Diálogos ===== */

  /** Abre diálogo nativo para selecionar arquivo(s). */
  selecionarArquivo: (opcoes) => ipcRenderer.invoke('dialogOpen', opcoes),

  /** Abre diálogo nativo para escolher onde salvar. */
  selecionarDestino: (opcoes) => ipcRenderer.invoke('dialogSave', opcoes),

  /* ===== Eventos do main → renderer ===== */

  /** Escuta eventos enviados pelo processo principal. */
  onEvento: (canal, callback) => {
    /* Filtra canais permitidos para evitar escutas indevidas */
    const canaisPermitidos = [
      'projeto-aberto',
      'projeto-salvo',
      'erro',
      'progresso',
      'menu-acao',
    ];
    if (canaisPermitidos.includes(canal)) {
      ipcRenderer.on(canal, (_evento, ...args) => callback(...args));
    }
  },
});
