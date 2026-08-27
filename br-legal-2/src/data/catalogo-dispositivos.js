/**
 * catalogo-dispositivos.js — Catálogo de dispositivos de segurança do DNIT.
 *
 * Referência: Manual de Sinalização Rodoviária — Volume V (Dispositivos
 * Auxiliares e de Segurança), DNIT/IPR.
 *
 * Cada item contém:
 *   codigo     — código de referência
 *   nome       — nome do dispositivo
 *   tipo       — 'barreira' | 'delineador' | 'refletivo' | 'canalizacao' |
 *                'marcador' | 'absorvedor'
 *   subtipo    — variação (quando aplicável)
 *   material   — material predominante
 *   cor        — cor(es) do dispositivo
 *   dimensoes  — dimensões-chave (varia por tipo)
 *   retroRef   — usa elemento retrorrefletivo (boolean)
 *   descricao  — explicação do uso
 *   norma      — referência normativa principal
 */

'use strict';

const CATALOGO_DISPOSITIVOS = [

  /* ================================================================
   *  DEFENSAS (barreiras de contenção)
   * ================================================================ */

  {
    codigo: 'DEF-MS',
    nome: 'Defensa metálica simples',
    tipo: 'barreira',
    subtipo: 'simples',
    material: 'aço galvanizado',
    cor: 'galvanizado (prata)',
    dimensoes: {
      perfilW: { altura: 0.312, espessura: 0.0028 },
      poste: { comprimento: 1.80, secao: 'C 150x75' },
      espacamento: 4.00,
    },
    retroRef: true,
    descricao: 'Defensa metálica de perfil W simples, instalada em aterros, curvas e trechos com risco de saída de pista. Contém e redireciona veículos desgovernados.',
    norma: 'ABNT NBR 6971 / DNIT 109/2009-ES',
  },
  {
    codigo: 'DEF-MD',
    nome: 'Defensa metálica dupla',
    tipo: 'barreira',
    subtipo: 'dupla',
    material: 'aço galvanizado',
    cor: 'galvanizado (prata)',
    dimensoes: {
      perfilW: { altura: 0.312, espessura: 0.0028 },
      poste: { comprimento: 2.00, secao: 'C 150x75' },
      espacamento: 2.00,
    },
    retroRef: true,
    descricao: 'Defensa metálica de perfil W dupla (dois módulos sobrepostos). Para trechos com alto risco ou trânsito de veículos pesados.',
    norma: 'ABNT NBR 6971 / DNIT 109/2009-ES',
  },
  {
    codigo: 'DEF-CONCRETO',
    nome: 'Barreira de concreto — New Jersey',
    tipo: 'barreira',
    subtipo: 'new jersey',
    material: 'concreto armado',
    cor: 'concreto aparente (cinza)',
    dimensoes: {
      altura: 0.81,
      base: 0.46,
      topo: 0.15,
    },
    retroRef: true,
    descricao: 'Barreira rígida de concreto perfil New Jersey. Usada em canteiros centrais, viadutos e pontes. Contém e redireciona veículos sem deformação.',
    norma: 'DNIT 109/2009-ES',
  },

  /* ================================================================
   *  TERMINAIS E ABSORVEDORES
   * ================================================================ */

  {
    codigo: 'TAI',
    nome: 'Terminal absorvedor de impacto',
    tipo: 'absorvedor',
    subtipo: null,
    material: 'aço / polietileno',
    cor: 'amarelo/preto',
    dimensoes: {
      comprimento: { min: 4.57, max: 7.62 },
      largura: 0.61,
    },
    retroRef: true,
    descricao: 'Dispositivo instalado no início de barreiras rígidas ou defensas para absorver a energia de impacto frontal de veículos desgovernados.',
    norma: 'NCHRP 350 / MASH',
  },
  {
    codigo: 'TERM-ABATIDO',
    nome: 'Terminal abatido de defensa',
    tipo: 'absorvedor',
    subtipo: 'abatido',
    material: 'aço galvanizado',
    cor: 'galvanizado (prata)',
    dimensoes: {
      comprimento: 3.81,
    },
    retroRef: true,
    descricao: 'Terminal com lâmina de defensa abatida e ancorada ao solo. Solução econômica, mas com restrição de desempenho em impactos diretos.',
    norma: 'DNIT 109/2009-ES',
  },

  /* ================================================================
   *  DELINEADORES
   * ================================================================ */

  {
    codigo: 'DELIN-FLEX',
    nome: 'Delineador flexível',
    tipo: 'delineador',
    subtipo: 'flexível',
    material: 'polietileno / poliuretano',
    cor: 'amarelo ou branco',
    dimensoes: {
      altura: 0.90,
      diametro: 0.08,
    },
    retroRef: true,
    descricao: 'Elemento vertical flexível com película retrorrefletiva. Usado para canalização de tráfego em obras, canteiros e ilhas de refúgio.',
    norma: 'DNIT 100/2009-ES',
  },
  {
    codigo: 'BALIZADOR',
    nome: 'Balizador',
    tipo: 'delineador',
    subtipo: 'fixo',
    material: 'concreto / plástico',
    cor: 'preto e branco ou amarelo',
    dimensoes: {
      altura: { min: 0.70, max: 1.20 },
      secao: 'cilíndrica ou prismática',
    },
    retroRef: true,
    descricao: 'Elemento vertical fixo, refletivo, instalado nos bordos da pista para orientação do condutor, especialmente à noite e em curvas.',
    norma: 'DNIT 100/2009-ES',
  },

  /* ================================================================
   *  TACHAS E TACHÕES REFLETIVOS
   * ================================================================ */

  {
    codigo: 'TACHA-MONO-AM',
    nome: 'Tacha refletiva monodirecional amarela',
    tipo: 'refletivo',
    subtipo: 'monodirecional',
    material: 'resina / cerâmica / plástico',
    cor: 'amarela',
    dimensoes: {
      comprimento: 0.105,
      largura: 0.105,
      altura: 0.018,
    },
    retroRef: true,
    descricao: 'Elemento retrorrefletivo de piso monodirecional (uma face), cor amarela. Usado para divisão de fluxos opostos.',
    norma: 'ABNT NBR 14636',
  },
  {
    codigo: 'TACHA-MONO-BR',
    nome: 'Tacha refletiva monodirecional branca',
    tipo: 'refletivo',
    subtipo: 'monodirecional',
    material: 'resina / cerâmica / plástico',
    cor: 'branca',
    dimensoes: {
      comprimento: 0.105,
      largura: 0.105,
      altura: 0.018,
    },
    retroRef: true,
    descricao: 'Elemento retrorrefletivo de piso monodirecional (uma face), cor branca. Usado para divisão de faixas de mesmo sentido e bordo.',
    norma: 'ABNT NBR 14636',
  },
  {
    codigo: 'TACHA-BIDI-AM',
    nome: 'Tacha refletiva bidirecional amarela',
    tipo: 'refletivo',
    subtipo: 'bidirecional',
    material: 'resina / cerâmica / plástico',
    cor: 'amarela',
    dimensoes: {
      comprimento: 0.105,
      largura: 0.105,
      altura: 0.018,
    },
    retroRef: true,
    descricao: 'Elemento retrorrefletivo de piso bidirecional (duas faces), cor amarela. Usado em vias de mão dupla sem canteiro.',
    norma: 'ABNT NBR 14636',
  },
  {
    codigo: 'TACHA-BIDI-BR',
    nome: 'Tacha refletiva bidirecional branca',
    tipo: 'refletivo',
    subtipo: 'bidirecional',
    material: 'resina / cerâmica / plástico',
    cor: 'branca',
    dimensoes: {
      comprimento: 0.105,
      largura: 0.105,
      altura: 0.018,
    },
    retroRef: true,
    descricao: 'Elemento retrorrefletivo de piso bidirecional (duas faces), cor branca.',
    norma: 'ABNT NBR 14636',
  },
  {
    codigo: 'TACHA-VM',
    nome: 'Tacha refletiva vermelha',
    tipo: 'refletivo',
    subtipo: 'monodirecional',
    material: 'resina / cerâmica / plástico',
    cor: 'vermelha',
    dimensoes: {
      comprimento: 0.105,
      largura: 0.105,
      altura: 0.018,
    },
    retroRef: true,
    descricao: 'Elemento retrorrefletivo de piso cor vermelha. Indica sentido contrário (contramão) — visível ao condutor que transitar na direção oposta.',
    norma: 'ABNT NBR 14636',
  },
  {
    codigo: 'TACHAO',
    nome: 'Tachão',
    tipo: 'refletivo',
    subtipo: 'bidirecional',
    material: 'resina / concreto / plástico',
    cor: 'amarelo ou branco',
    dimensoes: {
      comprimento: 0.25,
      largura: 0.25,
      altura: 0.05,
    },
    retroRef: true,
    descricao: 'Elemento refletivo elevado de piso. Usado para reforço de canalização, ilhas e linhas contínuas. Mais robusto que a tacha.',
    norma: 'ABNT NBR 14636',
  },

  /* ================================================================
   *  DISPOSITIVOS DE CANALIZAÇÃO
   * ================================================================ */

  {
    codigo: 'GRADIL',
    nome: 'Gradil de canalização',
    tipo: 'canalizacao',
    subtipo: null,
    material: 'plástico / metal',
    cor: 'laranja ou amarelo',
    dimensoes: {
      altura: 1.00,
      largura: { min: 0.60, max: 2.00 },
    },
    retroRef: true,
    descricao: 'Dispositivo portátil para canalização e desvio de tráfego em obras e emergências.',
    norma: 'DNIT 100/2009-ES',
  },

  /* ================================================================
   *  MARCADORES
   * ================================================================ */

  {
    codigo: 'MO',
    nome: 'Marcador de obstáculo',
    tipo: 'marcador',
    subtipo: 'obstáculo',
    material: 'chapa de aço / alumínio',
    cor: 'amarelo e preto (listras diagonais)',
    dimensoes: {
      largura: 0.60,
      altura: 0.90,
    },
    retroRef: true,
    descricao: 'Indica obstáculo fixo na pista ou junto a ela (pilar de viaduto, defensa, ilha). Listras diagonais amarelas/pretas indicam o lado de passagem.',
    norma: 'DNIT 100/2009-ES',
  },
  {
    codigo: 'MP',
    nome: 'Marcador de perigo',
    tipo: 'marcador',
    subtipo: 'perigo',
    material: 'chapa de aço / alumínio',
    cor: 'amarelo e preto (listras)',
    dimensoes: {
      largura: 0.60,
      altura: 0.90,
    },
    retroRef: true,
    descricao: 'Sinaliza perigo ou obstrução na via. Listras amarelas/pretas inclinadas a 45°.',
    norma: 'DNIT 100/2009-ES',
  },
  {
    codigo: 'MA',
    nome: 'Marcador de alinhamento',
    tipo: 'marcador',
    subtipo: 'alinhamento',
    material: 'chapa de aço / alumínio',
    cor: 'branco e vermelho (chevron)',
    dimensoes: {
      largura: 0.60,
      altura: 0.90,
    },
    retroRef: true,
    descricao: 'Indica mudança de alinhamento da via (curvas). Setas em chevron (>>>) brancas sobre fundo vermelho, apontando para o sentido da curva.',
    norma: 'DNIT 100/2009-ES',
  },
];

/* Exporta para uso no app (módulo CommonJS ou script tag) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CATALOGO_DISPOSITIVOS };
}
