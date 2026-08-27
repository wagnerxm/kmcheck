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

  /** Abre um projeto existente (.brlegal2 ou pasta). */
  abrirProjeto: () => ipcRenderer.invoke('openProject'),

  /** Salva o projeto corrente (mesmo caminho ou "Salvar como"). */
  salvarProjeto: (dados) => ipcRenderer.invoke('saveProject', dados),

  /* ===== Importação / Exportação ===== */

  /** Importa dados do SNV/DNIT para alimentar o projeto. */
  importarSNV: (opcoes) => ipcRenderer.invoke('importSNV', opcoes),

  /** Exporta volume(s) em PDF. */
  exportarPDF: (opcoes) => ipcRenderer.invoke('exportPDF', opcoes),

  /** Exporta planilhas do Volume II em XLSX. */
  exportarXLSX: (opcoes) => ipcRenderer.invoke('exportXLSX', opcoes),

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
    ];
    if (canaisPermitidos.includes(canal)) {
      ipcRenderer.on(canal, (_evento, ...args) => callback(...args));
    }
  },
});
