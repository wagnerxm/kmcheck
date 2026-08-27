/**
 * modelo-dados.js — Esquemas de dados do Volume II do BR-Legal 2.
 *
 * Define as 15 planilhas (cadastros + necessidades) do Volume II do
 * Projeto Básico, cada uma com suas colunas, tipos e validações.
 *
 * Tipos de coluna:
 *   'texto'     — texto livre
 *   'numero'    — numérico (inteiro ou decimal)
 *   'km'        — quilometragem (000,0 a 999,9)
 *   'lista'     — seleção de lista (opções definidas em `opcoes`)
 *   'booleano'  — sim/não
 *   'data'      — data (YYYY-MM-DD)
 *   'coordenada'— coordenada geográfica (graus decimais)
 *   'foto'      — referência a arquivo fotográfico
 *
 * Referência: Edital BR-Legal 2, Anexo I — Modelo de Planilhas (DNIT).
 */

'use strict';

/* ===== Opções reutilizáveis ===== */

const LADOS = ['Esquerdo', 'Direito', 'Ambos', 'Canteiro central'];
const SENTIDOS = ['Crescente', 'Decrescente', 'Ambos'];
const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];
const CONSERVACAO = ['Bom', 'Regular', 'Ruim', 'Péssimo', 'Inexistente'];
const SIM_NAO = ['Sim', 'Não'];

/* ===== Esquemas ===== */

const MODELO_DADOS = {

  /* ---------------------------------------------------------------
   * 1 — Características Físicas e Operacionais
   * --------------------------------------------------------------- */
  caracteristicasFisicas: {
    id: 1,
    titulo: 'Características Físicas e Operacionais',
    arquivo: '1_Caracteristicas Fisicas e Operacionais',
    colunas: [
      { campo: 'rodovia',         nome: 'Rodovia',               tipo: 'texto',   largura: 100 },
      { campo: 'uf',              nome: 'UF',                    tipo: 'lista',   opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',        nome: 'KM Início',             tipo: 'km',      largura: 80 },
      { campo: 'kmFim',           nome: 'KM Fim',                tipo: 'km',      largura: 80 },
      { campo: 'extensao',        nome: 'Extensão (km)',          tipo: 'numero',  decimais: 3, largura: 90 },
      { campo: 'pista',           nome: 'Tipo de Pista',         tipo: 'lista',   opcoes: ['Simples', 'Dupla', 'Múltipla'], largura: 100 },
      { campo: 'faixas',          nome: 'Nº de Faixas',          tipo: 'numero',  min: 1, max: 8, largura: 70 },
      { campo: 'larguraFaixa',    nome: 'Largura Faixa (m)',     tipo: 'numero',  decimais: 2, largura: 90 },
      { campo: 'acostamento',     nome: 'Acostamento',           tipo: 'lista',   opcoes: SIM_NAO, largura: 80 },
      { campo: 'larguraAcost',    nome: 'Larg. Acost. (m)',      tipo: 'numero',  decimais: 2, largura: 90 },
      { campo: 'canteiro',        nome: 'Canteiro Central',      tipo: 'lista',   opcoes: SIM_NAO, largura: 80 },
      { campo: 'revestimento',    nome: 'Revestimento',          tipo: 'lista',   opcoes: ['Asfalto', 'Concreto', 'Paralelepípedo', 'Terra', 'Cascalho'], largura: 100 },
      { campo: 'classeVia',      nome: 'Classe da Via',          tipo: 'lista',   opcoes: ['0', 'I-A', 'I-B', 'II', 'III', 'IV-A', 'IV-B'], largura: 80 },
      { campo: 'velocidadeOp',    nome: 'Vel. Operacional (km/h)', tipo: 'numero', min: 20, max: 120, largura: 90 },
      { campo: 'velocidadeReg',   nome: 'Vel. Regulamentada (km/h)', tipo: 'numero', min: 20, max: 120, largura: 90 },
      { campo: 'relevo',          nome: 'Relevo',                tipo: 'lista',   opcoes: ['Plano', 'Ondulado', 'Montanhoso', 'Escarpado'], largura: 90 },
      { campo: 'travessiaUrbana', nome: 'Travessia Urbana',      tipo: 'lista',   opcoes: SIM_NAO, largura: 80 },
      { campo: 'localidade',      nome: 'Localidade',            tipo: 'texto',   largura: 150 },
      { campo: 'observacoes',     nome: 'Observações',           tipo: 'texto',   largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 2 — Dados de Contagem de Tráfego
   * --------------------------------------------------------------- */
  contagemTrafego: {
    id: 2,
    titulo: 'Dados de Contagem de Tráfego',
    arquivo: '2_Dados de Contagem de Trafego',
    colunas: [
      { campo: 'rodovia',      nome: 'Rodovia',            tipo: 'texto',  largura: 100 },
      { campo: 'uf',           nome: 'UF',                 tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'postoCont',    nome: 'Posto de Contagem',  tipo: 'texto',  largura: 120 },
      { campo: 'km',           nome: 'KM',                 tipo: 'km',     largura: 80 },
      { campo: 'sentido',      nome: 'Sentido',            tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'anoRef',       nome: 'Ano de Referência',  tipo: 'numero', min: 2000, max: 2050, largura: 80 },
      { campo: 'vmd',          nome: 'VMD',                tipo: 'numero', largura: 80, descricao: 'Volume Médio Diário' },
      { campo: 'vmdAnual',     nome: 'VMDA',               tipo: 'numero', largura: 80, descricao: 'Volume Médio Diário Anual' },
      { campo: 'percComercial',nome: '% Comercial',        tipo: 'numero', decimais: 1, min: 0, max: 100, largura: 80 },
      { campo: 'fator_FV',     nome: 'Fator FV',           tipo: 'numero', decimais: 4, largura: 80 },
      { campo: 'nivelServico', nome: 'Nível de Serviço',   tipo: 'lista',  opcoes: ['A','B','C','D','E','F'], largura: 70 },
      { campo: 'fonte',        nome: 'Fonte',              tipo: 'texto',  largura: 150 },
      { campo: 'observacoes',  nome: 'Observações',        tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 3.1 a 3.4 — Cadastro da Sinalização Horizontal
   * --------------------------------------------------------------- */
  cadastroSH1: {
    id: 3.1,
    titulo: 'Cadastro SH — Linhas Longitudinais',
    arquivo: '3.1_Cadastro da Sinalizacao Horizontal SH1',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',           tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',                tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',         tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',            tipo: 'km',     largura: 80 },
      { campo: 'sentido',     nome: 'Sentido',           tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'lado',        nome: 'Lado',              tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'codigoSH',    nome: 'Código SH',         tipo: 'texto',  largura: 80, descricao: 'Ex.: LFO-1, LMS-2, LBO' },
      { campo: 'cor',         nome: 'Cor',               tipo: 'lista',  opcoes: ['Amarela', 'Branca'], largura: 70 },
      { campo: 'tipo',        nome: 'Tipo',              tipo: 'lista',  opcoes: ['Contínua', 'Seccionada', 'Dupla contínua', 'Contínua/seccionada'], largura: 120 },
      { campo: 'largura',     nome: 'Largura (m)',        tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'material',    nome: 'Material',          tipo: 'lista',  opcoes: ['Tinta', 'Termoplástico a quente', 'Termoplástico spray', 'Plástico a frio'], largura: 120 },
      { campo: 'conservacao', nome: 'Estado',             tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'retroRef',    nome: 'Retrorref. (mcd/lx/m²)', tipo: 'numero', decimais: 0, largura: 90 },
      { campo: 'foto',        nome: 'Foto',              tipo: 'foto',   largura: 60 },
      { campo: 'observacoes', nome: 'Observações',       tipo: 'texto',  largura: 200 },
    ],
  },
  cadastroSH2: {
    id: 3.2,
    titulo: 'Cadastro SH — Linhas Transversais',
    arquivo: '3.2_Cadastro da Sinalizacao Horizontal SH2',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',          nome: 'KM',              tipo: 'km',     largura: 80 },
      { campo: 'sentido',     nome: 'Sentido',         tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'codigoSH',    nome: 'Código SH',       tipo: 'texto',  largura: 80 },
      { campo: 'tipoFaixa',   nome: 'Tipo',            tipo: 'lista',  opcoes: ['LRE', 'LDA', 'FTP-1', 'FTP-2', 'MFR'], largura: 80 },
      { campo: 'largura',     nome: 'Largura (m)',      tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'comprimento', nome: 'Comprimento (m)',  tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'material',    nome: 'Material',        tipo: 'lista',  opcoes: ['Tinta', 'Termoplástico a quente', 'Termoplástico spray', 'Plástico a frio'], largura: 120 },
      { campo: 'conservacao', nome: 'Estado',           tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'foto',        nome: 'Foto',            tipo: 'foto',   largura: 60 },
      { campo: 'observacoes', nome: 'Observações',     tipo: 'texto',  largura: 200 },
    ],
  },
  cadastroSH3: {
    id: 3.3,
    titulo: 'Cadastro SH — Marcações e Símbolos',
    arquivo: '3.3_Cadastro da Sinalizacao Horizontal SH3',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',          nome: 'KM',              tipo: 'km',     largura: 80 },
      { campo: 'sentido',     nome: 'Sentido',         tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'faixa',       nome: 'Faixa',           tipo: 'numero', min: 1, max: 8, largura: 60 },
      { campo: 'codigoSH',    nome: 'Código SH',       tipo: 'texto',  largura: 80 },
      { campo: 'tipo',        nome: 'Tipo',            tipo: 'lista',  opcoes: ['Seta', 'Legenda', 'Símbolo', 'Marcação de área'], largura: 100 },
      { campo: 'descricao',   nome: 'Descrição',       tipo: 'texto',  largura: 150 },
      { campo: 'material',    nome: 'Material',        tipo: 'lista',  opcoes: ['Tinta', 'Termoplástico a quente', 'Termoplástico spray', 'Plástico a frio'], largura: 120 },
      { campo: 'conservacao', nome: 'Estado',           tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'foto',        nome: 'Foto',            tipo: 'foto',   largura: 60 },
      { campo: 'observacoes', nome: 'Observações',     tipo: 'texto',  largura: 200 },
    ],
  },
  cadastroSH4: {
    id: 3.4,
    titulo: 'Cadastro SH — Dispositivos Auxiliares (tachas, tachões)',
    arquivo: '3.4_Cadastro da Sinalizacao Horizontal SH4',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',       tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',          tipo: 'km',     largura: 80 },
      { campo: 'lado',        nome: 'Lado',            tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'dispositivo', nome: 'Dispositivo',     tipo: 'lista',  opcoes: ['Tacha mono amarela', 'Tacha mono branca', 'Tacha bidi amarela', 'Tacha bidi branca', 'Tacha vermelha', 'Tachão'], largura: 140 },
      { campo: 'quantidade',  nome: 'Quantidade',      tipo: 'numero', min: 0, largura: 80 },
      { campo: 'espacamento', nome: 'Espaçamento (m)', tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'conservacao', nome: 'Estado',           tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'foto',        nome: 'Foto',            tipo: 'foto',   largura: 60 },
      { campo: 'observacoes', nome: 'Observações',     tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 4.1–4.2 — Cadastro da Sinalização Vertical
   * --------------------------------------------------------------- */
  cadastroSV1: {
    id: 4.1,
    titulo: 'Cadastro SV — Placas',
    arquivo: '4.1_Cadastro da Sinalizacao Vertical SV1',
    colunas: [
      { campo: 'rodovia',      nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',           nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',           nome: 'KM',              tipo: 'km',     largura: 80 },
      { campo: 'sentido',      nome: 'Sentido',         tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'lado',         nome: 'Lado',            tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'codigoPlaca',  nome: 'Código da Placa', tipo: 'texto',  largura: 80, descricao: 'Ex.: R-19, A-33a' },
      { campo: 'nomePlaca',    nome: 'Nome',            tipo: 'texto',  largura: 160 },
      { campo: 'categoria',    nome: 'Categoria',       tipo: 'lista',  opcoes: ['Regulamentação', 'Advertência', 'Indicação', 'Educativa', 'Serviços auxiliares'], largura: 120 },
      { campo: 'dimensao',     nome: 'Dimensão (m)',    tipo: 'texto',  largura: 80, descricao: 'Ex.: ø0,50 / 0,60x0,90' },
      { campo: 'suporte',      nome: 'Suporte',         tipo: 'lista',  opcoes: ['Poste simples', 'Poste duplo', 'Braço projetado', 'Pórtico', 'Semi-pórtico', 'Bandeira'], largura: 110 },
      { campo: 'alturaInstal', nome: 'Altura Instal. (m)', tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'peliculaRetro',nome: 'Película',        tipo: 'lista',  opcoes: ['Tipo I (EG)', 'Tipo II (HI)', 'Tipo III (DG)', 'Tipo X (DG Fluorescente)'], largura: 120 },
      { campo: 'conservacao',  nome: 'Estado',           tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'retroRef',     nome: 'Retrorref. (cd/lx/m²)', tipo: 'numero', decimais: 0, largura: 90 },
      { campo: 'foto',         nome: 'Foto',            tipo: 'foto',   largura: 60 },
      { campo: 'observacoes',  nome: 'Observações',     tipo: 'texto',  largura: 200 },
    ],
  },
  cadastroSV2: {
    id: 4.2,
    titulo: 'Cadastro SV — Suportes e Estruturas',
    arquivo: '4.2_Cadastro da Sinalizacao Vertical SV2',
    colunas: [
      { campo: 'rodovia',      nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',           nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',           nome: 'KM',              tipo: 'km',     largura: 80 },
      { campo: 'sentido',      nome: 'Sentido',         tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'lado',         nome: 'Lado',            tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'tipoSuporte',  nome: 'Tipo do Suporte', tipo: 'lista',  opcoes: ['Poste simples', 'Poste duplo', 'Braço projetado', 'Pórtico', 'Semi-pórtico', 'Bandeira'], largura: 120 },
      { campo: 'material',     nome: 'Material',        tipo: 'lista',  opcoes: ['Aço galvanizado', 'Aço pintado', 'Madeira', 'Concreto', 'Alumínio'], largura: 100 },
      { campo: 'altura',       nome: 'Altura (m)',       tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'qtdPlacas',    nome: 'Qtd. de Placas',  tipo: 'numero', min: 1, largura: 70 },
      { campo: 'conservacao',  nome: 'Estado',           tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'foto',         nome: 'Foto',            tipo: 'foto',   largura: 60 },
      { campo: 'observacoes',  nome: 'Observações',     tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 5 — Cadastro dos Dispositivos de Segurança
   * --------------------------------------------------------------- */
  cadastroDispositivos: {
    id: 5,
    titulo: 'Cadastro dos Dispositivos de Segurança',
    arquivo: '5_Cadastro dos Dispositivos de Seguranca',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',             tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',                  tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',           tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',              tipo: 'km',     largura: 80 },
      { campo: 'lado',        nome: 'Lado',                tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'dispositivo', nome: 'Dispositivo',         tipo: 'texto',  largura: 160 },
      { campo: 'codigoCat',   nome: 'Código Catálogo',     tipo: 'texto',  largura: 100 },
      { campo: 'extensao',    nome: 'Extensão (m)',         tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'quantidade',  nome: 'Quantidade',          tipo: 'numero', largura: 80 },
      { campo: 'material',    nome: 'Material',            tipo: 'texto',  largura: 120 },
      { campo: 'conservacao', nome: 'Estado',               tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'foto',        nome: 'Foto',                tipo: 'foto',   largura: 60 },
      { campo: 'observacoes', nome: 'Observações',         tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 6 — Cadastro da Faixa de Domínio
   * --------------------------------------------------------------- */
  cadastroFaixaDominio: {
    id: 6,
    titulo: 'Cadastro da Faixa de Domínio',
    arquivo: '6_Cadastro da Faixa de Dominio',
    colunas: [
      { campo: 'rodovia',       nome: 'Rodovia',              tipo: 'texto',  largura: 100 },
      { campo: 'uf',            nome: 'UF',                   tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',      nome: 'KM Início',            tipo: 'km',     largura: 80 },
      { campo: 'kmFim',         nome: 'KM Fim',               tipo: 'km',     largura: 80 },
      { campo: 'lado',          nome: 'Lado',                 tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'larguraFaixa',  nome: 'Largura (m)',           tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'ocupacao',      nome: 'Tipo de Ocupação',     tipo: 'lista',  opcoes: ['Livre', 'Cerca', 'Muro', 'Construção', 'Vegetação', 'Acesso irregular'], largura: 120 },
      { campo: 'vegetacao',     nome: 'Vegetação',            tipo: 'lista',  opcoes: ['Rasteira', 'Arbustiva', 'Arbórea', 'Sem vegetação'], largura: 100 },
      { campo: 'conservacao',   nome: 'Estado',                tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'foto',          nome: 'Foto',                 tipo: 'foto',   largura: 60 },
      { campo: 'observacoes',   nome: 'Observações',          tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 7 — Cadastro de OAEs e OACs
   * --------------------------------------------------------------- */
  cadastroOAE: {
    id: 7,
    titulo: 'Cadastro de OAEs e OACs',
    arquivo: '7_Cadastro de OAEs e OACs',
    colunas: [
      { campo: 'rodovia',       nome: 'Rodovia',            tipo: 'texto',  largura: 100 },
      { campo: 'uf',            nome: 'UF',                 tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',            nome: 'KM',                 tipo: 'km',     largura: 80 },
      { campo: 'tipoOAE',       nome: 'Tipo',               tipo: 'lista',  opcoes: ['Ponte', 'Viaduto', 'Passarela', 'Túnel', 'Bueiro', 'Galeria', 'Passagem inferior', 'Passagem superior'], largura: 120 },
      { campo: 'nome',          nome: 'Nome / Identificação', tipo: 'texto', largura: 160 },
      { campo: 'extensao',      nome: 'Extensão (m)',         tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'largura',       nome: 'Largura (m)',          tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'pistasSobre',   nome: 'Pistas sobre OAE',   tipo: 'numero', largura: 70 },
      { campo: 'cargaMax',      nome: 'Carga Máx. (t)',      tipo: 'numero', decimais: 1, largura: 80 },
      { campo: 'alturaLivre',   nome: 'Altura Livre (m)',     tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'conservacao',   nome: 'Estado',               tipo: 'lista',  opcoes: CONSERVACAO, largura: 80 },
      { campo: 'sinalizacao',   nome: 'Sinalização OK',      tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'foto',          nome: 'Foto',               tipo: 'foto',   largura: 60 },
      { campo: 'observacoes',   nome: 'Observações',        tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 8 — Cadastro de Curvas
   * --------------------------------------------------------------- */
  cadastroCurvas: {
    id: 8,
    titulo: 'Cadastro de Curvas',
    arquivo: '8_Cadastro de Curvas',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',           tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',                tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',         tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',            tipo: 'km',     largura: 80 },
      { campo: 'sentidoCurva',nome: 'Sentido da Curva',  tipo: 'lista',  opcoes: ['Esquerda', 'Direita'], largura: 90 },
      { campo: 'raio',        nome: 'Raio (m)',           tipo: 'numero', decimais: 1, largura: 80 },
      { campo: 'superelevacao',nome: 'Superelevação (%)', tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'velMax',      nome: 'Vel. Máx. (km/h)',  tipo: 'numero', largura: 80 },
      { campo: 'sinalizHoriz',nome: 'SH existente',      tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'sinalizVert', nome: 'SV existente',      tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'dispositivos',nome: 'Disp. Segurança',   tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'classificacao',nome:'Classificação',     tipo: 'lista',  opcoes: ['Curva simples', 'Curva acentuada', 'Curva em S', 'Curva em S acentuada'], largura: 120 },
      { campo: 'observacoes', nome: 'Observações',       tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 9 — Cadastro de Interseções
   * --------------------------------------------------------------- */
  cadastroIntersecoes: {
    id: 9,
    titulo: 'Cadastro de Interseções',
    arquivo: '9_Cadastro de Intersecoes',
    colunas: [
      { campo: 'rodovia',        nome: 'Rodovia',              tipo: 'texto',  largura: 100 },
      { campo: 'uf',             nome: 'UF',                   tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',             nome: 'KM',                   tipo: 'km',     largura: 80 },
      { campo: 'tipoIntersecao', nome: 'Tipo',                 tipo: 'lista',  opcoes: ['Cruzamento', 'T', 'Y', 'Rotatória', 'Trevo', 'Diamante', 'Trombeta', 'Outro'], largura: 100 },
      { campo: 'viaCruzada',     nome: 'Via Cruzada',          tipo: 'texto',  largura: 140 },
      { campo: 'semaforo',       nome: 'Semáforo',             tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'sinalizHoriz',   nome: 'SH existente',        tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'sinalizVert',    nome: 'SV existente',        tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'iluminacao',     nome: 'Iluminação',          tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'latitude',       nome: 'Latitude',            tipo: 'coordenada', largura: 100 },
      { campo: 'longitude',      nome: 'Longitude',           tipo: 'coordenada', largura: 100 },
      { campo: 'foto',           nome: 'Foto',                tipo: 'foto',   largura: 60 },
      { campo: 'observacoes',    nome: 'Observações',         tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 10 — Trechos com Neblina
   * --------------------------------------------------------------- */
  trechosNeblina: {
    id: 10,
    titulo: 'Trechos com Neblina',
    arquivo: '10_Trechos com Neblina',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',              tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',                   tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',            tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',               tipo: 'km',     largura: 80 },
      { campo: 'extensao',    nome: 'Extensão (km)',          tipo: 'numero', decimais: 3, largura: 90 },
      { campo: 'frequencia',  nome: 'Frequência',           tipo: 'lista',  opcoes: ['Rara', 'Eventual', 'Frequente', 'Muito frequente'], largura: 110 },
      { campo: 'periodo',     nome: 'Período',              tipo: 'lista',  opcoes: ['Manhã', 'Tarde', 'Noite', 'Madrugada', 'Variável'], largura: 90 },
      { campo: 'sinalizacao', nome: 'Sinalização específica', tipo: 'lista', opcoes: SIM_NAO, largura: 80 },
      { campo: 'observacoes', nome: 'Observações',          tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 11 — Intervenções Programadas
   * --------------------------------------------------------------- */
  intervencoesProgramadas: {
    id: 11,
    titulo: 'Intervenções Programadas',
    arquivo: '11_Intervencoes Programadas',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',              tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',                   tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',            tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',               tipo: 'km',     largura: 80 },
      { campo: 'tipo',        nome: 'Tipo de Intervenção',  tipo: 'lista',  opcoes: ['Restauração', 'Duplicação', 'Implantação', 'Manutenção', 'Pavimentação', 'Obra de arte', 'Outro'], largura: 130 },
      { campo: 'descricao',   nome: 'Descrição',            tipo: 'texto',  largura: 200 },
      { campo: 'responsavel', nome: 'Responsável',          tipo: 'texto',  largura: 120 },
      { campo: 'previsao',    nome: 'Previsão',             tipo: 'data',   largura: 90 },
      { campo: 'situacao',    nome: 'Situação',             tipo: 'lista',  opcoes: ['Planejada', 'Em execução', 'Concluída', 'Suspensa'], largura: 100 },
      { campo: 'impactoSinal',nome: 'Impacto na Sinalização', tipo: 'lista', opcoes: SIM_NAO, largura: 80 },
      { campo: 'observacoes', nome: 'Observações',          tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 12 — Retrorrefletâncias
   * --------------------------------------------------------------- */
  retrorrefletancias: {
    id: 12,
    titulo: 'Retrorrefletâncias',
    arquivo: '12_Retrorrefletancias',
    colunas: [
      { campo: 'rodovia',      nome: 'Rodovia',              tipo: 'texto',  largura: 100 },
      { campo: 'uf',           nome: 'UF',                   tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',           nome: 'KM',                   tipo: 'km',     largura: 80 },
      { campo: 'tipoSinal',   nome: 'Tipo de Sinalização',  tipo: 'lista',  opcoes: ['Horizontal', 'Vertical'], largura: 100 },
      { campo: 'elemento',    nome: 'Elemento Avaliado',    tipo: 'texto',  largura: 150 },
      { campo: 'cor',          nome: 'Cor',                  tipo: 'lista',  opcoes: ['Branca', 'Amarela', 'Vermelha', 'Verde', 'Azul'], largura: 80 },
      { campo: 'valorMedido',  nome: 'Valor Medido',         tipo: 'numero', decimais: 0, largura: 80 },
      { campo: 'unidade',      nome: 'Unidade',              tipo: 'lista',  opcoes: ['mcd/lx/m²', 'cd/lx/m²'], largura: 80 },
      { campo: 'valorMinimo',  nome: 'Valor Mínimo',         tipo: 'numero', decimais: 0, largura: 80, descricao: 'Conforme norma' },
      { campo: 'conforme',     nome: 'Conforme',             tipo: 'lista',  opcoes: SIM_NAO, largura: 70 },
      { campo: 'dataMedicao',  nome: 'Data da Medição',      tipo: 'data',   largura: 90 },
      { campo: 'equipamento',  nome: 'Equipamento',          tipo: 'texto',  largura: 120 },
      { campo: 'observacoes',  nome: 'Observações',          tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 13.1 a 13.4 — Necessidades de Sinalização Horizontal
   * --------------------------------------------------------------- */
  necessidadesSH1: {
    id: 13.1,
    titulo: 'Necessidades SH — Linhas Longitudinais',
    arquivo: '13.1_Necessidades de Sinalizacao Horizontal SH1',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',           tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',                tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',         tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',            tipo: 'km',     largura: 80 },
      { campo: 'sentido',     nome: 'Sentido',           tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'lado',        nome: 'Lado',              tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'codigoSH',    nome: 'Código SH',         tipo: 'texto',  largura: 80 },
      { campo: 'acao',        nome: 'Ação',              tipo: 'lista',  opcoes: ['Implantar', 'Repintar', 'Substituir', 'Remover', 'Manter'], largura: 90 },
      { campo: 'cor',         nome: 'Cor',               tipo: 'lista',  opcoes: ['Amarela', 'Branca'], largura: 70 },
      { campo: 'tipo',        nome: 'Tipo',              tipo: 'lista',  opcoes: ['Contínua', 'Seccionada', 'Dupla contínua', 'Contínua/seccionada'], largura: 120 },
      { campo: 'largura',     nome: 'Largura (m)',        tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'extensao',    nome: 'Extensão (m)',       tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'material',    nome: 'Material',          tipo: 'lista',  opcoes: ['Tinta', 'Termoplástico a quente', 'Termoplástico spray', 'Plástico a frio'], largura: 120 },
      { campo: 'justificativa',nome:'Justificativa',     tipo: 'texto',  largura: 200 },
    ],
  },
  necessidadesSH2: {
    id: 13.2,
    titulo: 'Necessidades SH — Linhas Transversais',
    arquivo: '13.2_Necessidades de Sinalizacao Horizontal SH2',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',          nome: 'KM',              tipo: 'km',     largura: 80 },
      { campo: 'sentido',     nome: 'Sentido',         tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'codigoSH',    nome: 'Código SH',       tipo: 'texto',  largura: 80 },
      { campo: 'acao',        nome: 'Ação',            tipo: 'lista',  opcoes: ['Implantar', 'Repintar', 'Substituir', 'Remover', 'Manter'], largura: 90 },
      { campo: 'tipoFaixa',   nome: 'Tipo',            tipo: 'lista',  opcoes: ['LRE', 'LDA', 'FTP-1', 'FTP-2', 'MFR'], largura: 80 },
      { campo: 'largura',     nome: 'Largura (m)',      tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'comprimento', nome: 'Comprimento (m)',  tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'material',    nome: 'Material',        tipo: 'lista',  opcoes: ['Tinta', 'Termoplástico a quente', 'Termoplástico spray', 'Plástico a frio'], largura: 120 },
      { campo: 'justificativa',nome:'Justificativa',   tipo: 'texto',  largura: 200 },
    ],
  },
  necessidadesSH3: {
    id: 13.3,
    titulo: 'Necessidades SH — Marcações e Símbolos',
    arquivo: '13.3_Necessidades de Sinalizacao Horizontal SH3',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',          nome: 'KM',              tipo: 'km',     largura: 80 },
      { campo: 'sentido',     nome: 'Sentido',         tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'faixa',       nome: 'Faixa',           tipo: 'numero', min: 1, max: 8, largura: 60 },
      { campo: 'codigoSH',    nome: 'Código SH',       tipo: 'texto',  largura: 80 },
      { campo: 'acao',        nome: 'Ação',            tipo: 'lista',  opcoes: ['Implantar', 'Repintar', 'Substituir', 'Remover', 'Manter'], largura: 90 },
      { campo: 'tipo',        nome: 'Tipo',            tipo: 'lista',  opcoes: ['Seta', 'Legenda', 'Símbolo', 'Marcação de área'], largura: 100 },
      { campo: 'descricao',   nome: 'Descrição',       tipo: 'texto',  largura: 150 },
      { campo: 'material',    nome: 'Material',        tipo: 'lista',  opcoes: ['Tinta', 'Termoplástico a quente', 'Termoplástico spray', 'Plástico a frio'], largura: 120 },
      { campo: 'justificativa',nome:'Justificativa',   tipo: 'texto',  largura: 200 },
    ],
  },
  necessidadesSH4: {
    id: 13.4,
    titulo: 'Necessidades SH — Dispositivos Auxiliares (tachas, tachões)',
    arquivo: '13.4_Necessidades de Sinalizacao Horizontal SH4',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',       tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',          tipo: 'km',     largura: 80 },
      { campo: 'lado',        nome: 'Lado',            tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'acao',        nome: 'Ação',            tipo: 'lista',  opcoes: ['Implantar', 'Substituir', 'Remover', 'Manter'], largura: 90 },
      { campo: 'dispositivo', nome: 'Dispositivo',     tipo: 'lista',  opcoes: ['Tacha mono amarela', 'Tacha mono branca', 'Tacha bidi amarela', 'Tacha bidi branca', 'Tacha vermelha', 'Tachão'], largura: 140 },
      { campo: 'quantidade',  nome: 'Quantidade',      tipo: 'numero', min: 0, largura: 80 },
      { campo: 'espacamento', nome: 'Espaçamento (m)', tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'justificativa',nome:'Justificativa',   tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 14.1–14.2 — Necessidades de Sinalização Vertical
   * --------------------------------------------------------------- */
  necessidadesSV1: {
    id: 14.1,
    titulo: 'Necessidades SV — Placas',
    arquivo: '14.1_Necessidades de Sinalizacao Vertical SV1',
    colunas: [
      { campo: 'rodovia',      nome: 'Rodovia',         tipo: 'texto',  largura: 100 },
      { campo: 'uf',           nome: 'UF',              tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',           nome: 'KM',              tipo: 'km',     largura: 80 },
      { campo: 'sentido',      nome: 'Sentido',         tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'lado',         nome: 'Lado',            tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'acao',         nome: 'Ação',            tipo: 'lista',  opcoes: ['Implantar', 'Substituir', 'Remover', 'Reposicionar', 'Manter'], largura: 90 },
      { campo: 'codigoPlaca',  nome: 'Código da Placa', tipo: 'texto',  largura: 80 },
      { campo: 'nomePlaca',    nome: 'Nome',            tipo: 'texto',  largura: 160 },
      { campo: 'categoria',    nome: 'Categoria',       tipo: 'lista',  opcoes: ['Regulamentação', 'Advertência', 'Indicação', 'Educativa', 'Serviços auxiliares'], largura: 120 },
      { campo: 'dimensao',     nome: 'Dimensão (m)',    tipo: 'texto',  largura: 80 },
      { campo: 'suporte',      nome: 'Suporte',         tipo: 'lista',  opcoes: ['Poste simples', 'Poste duplo', 'Braço projetado', 'Pórtico', 'Semi-pórtico', 'Bandeira'], largura: 110 },
      { campo: 'peliculaRetro',nome: 'Película',        tipo: 'lista',  opcoes: ['Tipo I (EG)', 'Tipo II (HI)', 'Tipo III (DG)', 'Tipo X (DG Fluorescente)'], largura: 120 },
      { campo: 'justificativa',nome: 'Justificativa',   tipo: 'texto',  largura: 200 },
    ],
  },
  necessidadesSV2: {
    id: 14.2,
    titulo: 'Necessidades SV — Suportes e Estruturas',
    arquivo: '14.2_Necessidades de Sinalizacao Vertical SV2',
    colunas: [
      { campo: 'rodovia',      nome: 'Rodovia',          tipo: 'texto',  largura: 100 },
      { campo: 'uf',           nome: 'UF',               tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'km',           nome: 'KM',               tipo: 'km',     largura: 80 },
      { campo: 'sentido',      nome: 'Sentido',          tipo: 'lista',  opcoes: SENTIDOS, largura: 80 },
      { campo: 'lado',         nome: 'Lado',             tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'acao',         nome: 'Ação',             tipo: 'lista',  opcoes: ['Implantar', 'Substituir', 'Remover', 'Manter'], largura: 90 },
      { campo: 'tipoSuporte',  nome: 'Tipo do Suporte',  tipo: 'lista',  opcoes: ['Poste simples', 'Poste duplo', 'Braço projetado', 'Pórtico', 'Semi-pórtico', 'Bandeira'], largura: 120 },
      { campo: 'material',     nome: 'Material',         tipo: 'lista',  opcoes: ['Aço galvanizado', 'Aço pintado', 'Alumínio'], largura: 100 },
      { campo: 'altura',       nome: 'Altura (m)',        tipo: 'numero', decimais: 2, largura: 80 },
      { campo: 'qtdPlacas',    nome: 'Qtd. de Placas',   tipo: 'numero', min: 1, largura: 70 },
      { campo: 'justificativa',nome: 'Justificativa',    tipo: 'texto',  largura: 200 },
    ],
  },

  /* ---------------------------------------------------------------
   * 15 — Necessidades de Dispositivos de Segurança
   * --------------------------------------------------------------- */
  necessidadesDispositivos: {
    id: 15,
    titulo: 'Necessidades de Dispositivos de Segurança',
    arquivo: '15_Necessidades de Dispositivo de Seguranca',
    colunas: [
      { campo: 'rodovia',     nome: 'Rodovia',             tipo: 'texto',  largura: 100 },
      { campo: 'uf',          nome: 'UF',                  tipo: 'lista',  opcoes: UFS, largura: 50 },
      { campo: 'kmInicio',    nome: 'KM Início',           tipo: 'km',     largura: 80 },
      { campo: 'kmFim',       nome: 'KM Fim',              tipo: 'km',     largura: 80 },
      { campo: 'lado',        nome: 'Lado',                tipo: 'lista',  opcoes: LADOS, largura: 80 },
      { campo: 'acao',        nome: 'Ação',                tipo: 'lista',  opcoes: ['Implantar', 'Substituir', 'Remover', 'Reparar', 'Manter'], largura: 90 },
      { campo: 'dispositivo', nome: 'Dispositivo',         tipo: 'texto',  largura: 160 },
      { campo: 'codigoCat',   nome: 'Código Catálogo',     tipo: 'texto',  largura: 100 },
      { campo: 'extensao',    nome: 'Extensão (m)',         tipo: 'numero', decimais: 2, largura: 90 },
      { campo: 'quantidade',  nome: 'Quantidade',          tipo: 'numero', largura: 80 },
      { campo: 'material',    nome: 'Material',            tipo: 'texto',  largura: 120 },
      { campo: 'justificativa',nome:'Justificativa',       tipo: 'texto',  largura: 200 },
    ],
  },
};

/* ===== Funções utilitárias ===== */

/**
 * Retorna um registro vazio (com valores default) para o esquema dado.
 */
function criarRegistroVazio(chaveEsquema) {
  const esquema = MODELO_DADOS[chaveEsquema];
  if (!esquema) return null;
  const reg = {};
  for (const col of esquema.colunas) {
    switch (col.tipo) {
      case 'numero': case 'km': case 'coordenada':
        reg[col.campo] = null;
        break;
      case 'booleano':
        reg[col.campo] = false;
        break;
      default:
        reg[col.campo] = '';
    }
  }
  return reg;
}

/**
 * Lista todas as chaves de esquema na ordem do Volume II.
 */
function listarEsquemas() {
  return Object.keys(MODELO_DADOS).map(k => ({
    chave: k,
    id: MODELO_DADOS[k].id,
    titulo: MODELO_DADOS[k].titulo,
  }));
}

/* Exporta */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MODELO_DADOS, criarRegistroVazio, listarEsquemas };
}
