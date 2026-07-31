const fs = require('fs');
const path = require('path');

const SHOTS = 'C:\\Users\\wagne\\Claude\\kmcheck\\manual-kmcheck\\screenshots-originais';
const OUT = 'C:\\Users\\wagne\\Claude\\kmcheck\\manual-kmcheck\\manual-rapido-ilustrado\\versao-premium';
const OUT_HTML = path.join(OUT, 'guia-visual-kmcheck.html');

function img(name) {
  const p = path.join(SHOTS, name);
  if (!fs.existsSync(p)) return '';
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}

const IMGS = {
  home:     img('IMG-001-tela-inicial-sem-dados.png'),
  homeDark: img('IMG-003-tela-inicial-tema-escuro.png'),
  cfgCam1:  img('IMG-050-config-camera-parte1.png'),
  cfgCam2:  img('IMG-051-config-camera-parte2.png'),
  cfgLeg1:  img('IMG-054-config-legenda-parte1.png'),
  cfgLeg2:  img('IMG-055-config-legenda-parte2.png'),
  gestao:   img('IMG-060-gestao-sem-rodovias.png'),
  gestaoImp:img('IMG-060b-gestao-importar.png'),
  consulta: img('IMG-070-consulta-vazia.png'),
};

// ═══ DESIGN SYSTEM (exact match to approved pilot) ═══
const PW = 700, PH = 990;
const C = {
  navy:'#0B1D3A', blue:'#1B4F8A', accent:'#C8D830', white:'#FFFFFF',
  snow:'#F5F6F8', border:'#DDE1E8', graphite:'#2A3040', gray:'#6B7385'
};
const MW = 270, MR = 34, BP = 4, NOTCH_W = 84, NOTCH_H = 20;
const MH = Math.round(MW * 812 / 375);
const MX = (PW - MW) / 2, MY = 110;
const SX = MX + BP, SY = MY + BP, SW = MW - 2*BP, SH = MH - 2*BP;
const BOX_W = 148, BOX_H = 44;
const LBX = MX - BOX_W - 14;
const RBX = MX + MW + 14;

function defs(id) {
  return `<defs>
    <marker id="ah${id}" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="7" markerHeight="5" orient="auto-start-reverse">
      <path d="M0,0 L8,3 L0,6 Z" fill="${C.blue}" opacity="0.72"/></marker>
    <marker id="ahG${id}" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="7" markerHeight="5" orient="auto-start-reverse">
      <path d="M0,0 L8,3 L0,6 Z" fill="${C.accent}" opacity="0.85"/></marker>
    <filter id="bs${id}" x="-4%" y="-8%" width="108%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.5"/><feOffset dy="1.5"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="ms${id}" x="-6%" y="-3%" width="112%" height="110%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/><feOffset dy="6"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.10"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="sc${id}"><rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="${MR-BP}"/></clipPath>
  </defs>`;
}

function box(x, y, title, text, accent, id) {
  const bg = accent ? '#FAFBF2' : C.snow;
  const bc = accent ? C.accent : C.border;
  const bw = accent ? 1.4 : 0.8;
  return `<g filter="url(#bs${id})">
    <rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="8" fill="${bg}" stroke="${bc}" stroke-width="${bw}"/>
    <text x="${x+11}" y="${y+17}" font-size="11.5" font-weight="700" fill="${C.graphite}" font-family="'Segoe UI',system-ui,sans-serif">${title}</text>
    <text x="${x+11}" y="${y+32}" font-size="10" fill="${C.gray}" font-family="'Segoe UI',system-ui,sans-serif">${text}</text>
  </g>`;
}

function arrow(bx, by, bw, bh, ex, ey, side, accent, id) {
  const marker = accent ? `url(#ahG${id})` : `url(#ah${id})`;
  const color = accent ? C.accent : C.blue;
  const op = accent ? 0.8 : 0.65;
  const sw = accent ? 1.6 : 1.3;
  const beX = side==='L' ? bx+bw : bx;
  const beY = by + bh/2;
  const dy = Math.abs(beY - ey);
  let d;
  if (dy < 15) {
    d = `M${beX},${beY} L${ex},${ey}`;
  } else {
    const midX = side==='L' ? MX-5 : MX+MW+5;
    d = `M${beX},${beY} L${midX},${beY} L${midX},${ey} L${ex},${ey}`;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" opacity="${op}" marker-end="${marker}" stroke-linejoin="round"/>`;
}

function phoneFrame(id) {
  const SR = MR - BP;
  return `<g filter="url(#ms${id})">
    <rect x="${MX}" y="${MY}" width="${MW}" height="${MH}" rx="${MR}" fill="${C.graphite}"/>
    <rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="${SR}" fill="#0e0e0e"/>
    <path d="M${MX+(MW-NOTCH_W)/2},${MY} h${NOTCH_W} v${NOTCH_H-10} q0,10 -10,10 h-${NOTCH_W-20} q-10,0 -10,-10 Z" fill="#000"/>
  </g>`;
}

function phoneWithImage(id, imgSrc) {
  const SR = MR - BP;
  return `<g filter="url(#ms${id})">
    <rect x="${MX}" y="${MY}" width="${MW}" height="${MH}" rx="${MR}" fill="${C.graphite}"/>
    <g clip-path="url(#sc${id})">
      <image href="${imgSrc}" x="${SX}" y="${SY}" width="${SW}" height="${SH}" preserveAspectRatio="xMidYMin slice"/>
    </g>
    <path d="M${MX+(MW-NOTCH_W)/2},${MY} h${NOTCH_W} v${NOTCH_H-10} q0,10 -10,10 h-${NOTCH_W-20} q-10,0 -10,-10 Z" fill="#000"/>
  </g>`;
}

function header(title, subtitle, pageNum, total) {
  return `
    <text x="58" y="66" font-size="22" font-weight="700" fill="${C.navy}" font-family="'Segoe UI',system-ui,sans-serif">${title}</text>
    <text x="58" y="84" font-size="11.5" fill="${C.gray}" font-family="'Segoe UI',system-ui,sans-serif">${subtitle}</text>
    <text x="${PW-58}" y="66" font-size="9" fill="${C.gray}" text-anchor="end" font-family="'Segoe UI',system-ui,sans-serif" opacity="0.5">pagina ${pageNum} de ${total}</text>`;
}

function footer(pn) {
  return `
    <line x1="58" y1="${PH-42}" x2="${PW-58}" y2="${PH-42}" stroke="${C.border}" stroke-width="0.6"/>
    <text x="58" y="${PH-28}" font-size="8" fill="${C.gray}" font-family="'Segoe UI',system-ui,sans-serif" opacity="0.7">KM Check · Guia Visual do Usuario</text>
    <text x="${PW-58}" y="${PH-28}" font-size="8.5" fill="${C.gray}" text-anchor="end" font-family="'Segoe UI',system-ui,sans-serif" font-weight="600">${pn}</text>`;
}

function svgOpen(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">
  ${defs(id)}
  <rect width="${PW}" height="${PH}" fill="${C.white}"/>`;
}

const TOTAL = 12;

// ═══════════════════════════════════════════════
// PAGE 0: CAPA
// ═══════════════════════════════════════════════
const LOGO_SVG = `<rect x="4" y="8" width="28" height="36" rx="3" fill="${C.blue}" stroke="${C.navy}" stroke-width="2"/>
  <line x1="10" y1="16" x2="26" y2="16" stroke="#fff" stroke-width="2"/>
  <line x1="10" y1="22" x2="26" y2="22" stroke="#fff" stroke-width="1.5"/>
  <text x="14" y="36" font-family="Arial" font-weight="bold" font-size="11" fill="#fff">KM</text>
  <line x1="10" y1="40" x2="26" y2="40" stroke="#fff" stroke-width="1.5"/>
  <path d="M30 12 L42 6 L42 18 Z" fill="${C.accent}"/>`;

function pageCover() {
  const smW = 150, smH = Math.round(smW*812/375);
  const smX = 460, smY = 240;
  const TXT_X = 80;
  const TXT_CY = PH/2 + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">
  <defs>
    <linearGradient id="coverGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1D3A"/>
      <stop offset="45%" stop-color="#0F2847"/>
      <stop offset="100%" stop-color="#1B4F8A"/>
    </linearGradient>
    <clipPath id="smClip"><rect x="${smX}" y="${smY}" width="${smW}" height="${smH}" rx="18"/></clipPath>
    <filter id="smSh" x="-10%" y="-5%" width="120%" height="115%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="12"/><feOffset dy="6"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="${PW}" height="${PH}" fill="url(#coverGrad)"/>

  <!-- Logo -->
  <g transform="translate(${TXT_X}, ${TXT_CY-180}) scale(2)">
    <rect width="48" height="48" rx="12" fill="white"/>
    <g transform="translate(3,3)">${LOGO_SVG}</g>
  </g>

  <!-- Title -->
  <text x="${TXT_X}" y="${TXT_CY-60}" font-size="42" font-weight="700" fill="white" font-family="'Segoe UI',system-ui,sans-serif" letter-spacing="-0.5">KM Check</text>

  <!-- Subtitle -->
  <text x="${TXT_X}" y="${TXT_CY-28}" font-size="14" fill="white" opacity="0.75" font-family="'Segoe UI',system-ui,sans-serif" letter-spacing="3">GUIA VISUAL DO USUARIO</text>

  <!-- Accent line -->
  <rect x="${TXT_X}" y="${TXT_CY-10}" width="55" height="3" rx="1.5" fill="${C.accent}"/>

  <!-- Tagline -->
  <text font-size="11.5" fill="white" opacity="0.5" font-family="'Segoe UI',system-ui,sans-serif">
    <tspan x="${TXT_X}" y="${TXT_CY+18}">Referencia visual rapida para registro</tspan>
    <tspan x="${TXT_X}" dy="17">fotografico de infraestrutura rodoviaria.</tspan>
    <tspan x="${TXT_X}" dy="17">Uma pagina por tela. Direto ao ponto.</tspan>
  </text>

  <!-- Mockup -->
  <g filter="url(#smSh)" transform="rotate(-5, ${smX+smW/2}, ${smY+smH/2})">
    <rect x="${smX-3}" y="${smY-3}" width="${smW+6}" height="${smH+6}" rx="20" fill="${C.graphite}"/>
    <g clip-path="url(#smClip)">
      <image href="${IMGS.home}" x="${smX}" y="${smY}" width="${smW}" height="${smH}" preserveAspectRatio="xMidYMin slice"/>
    </g>
    <path d="M${smX+(smW-60)/2},${smY} h60 v12 q0,6 -6,6 h-48 q-6,0 -6,-6 Z" fill="#000"/>
  </g>

  <!-- Version -->
  <text x="${PW/2}" y="${PH-50}" text-anchor="middle" font-size="10" fill="white" opacity="0.3" font-family="'Segoe UI',system-ui,sans-serif" letter-spacing="1">VERSAO 1.0.0 · 2026</text>
</svg>`;
}

// ═══════════════════════════════════════════════
// PAGE 1: VISAO GERAL
// ═══════════════════════════════════════════════
function pageOverview() {
  const id = 'ov';
  // 4 small mockups in 2x2 with flow arrows between them
  const smW = 110, smH = Math.round(smW*812/375);
  const gap = 30;
  const gridX = PW/2 - smW - gap/2;
  const gridY = 160;
  const positions = [
    { x: gridX, y: gridY, label: 'Tela Inicial', img: IMGS.home },
    { x: gridX + smW + gap, y: gridY, label: 'Camera', img: '' },
    { x: gridX, y: gridY + smH + 50, label: 'Configuracoes', img: IMGS.cfgCam1 },
    { x: gridX + smW + gap, y: gridY + smH + 50, label: 'Gestao de Eixo', img: IMGS.gestao },
  ];

  let mockups = '';
  positions.forEach((p, i) => {
    const clipId = `ovClip${i}`;
    mockups += `
    <defs><clipPath id="${clipId}"><rect x="${p.x}" y="${p.y}" width="${smW}" height="${smH}" rx="14"/></clipPath></defs>
    <g>
      <rect x="${p.x-2}" y="${p.y-2}" width="${smW+4}" height="${smH+4}" rx="16" fill="${C.graphite}"
            filter="url(#bs${id})"/>
      ${p.img ? `<g clip-path="url(#${clipId})"><image href="${p.img}" x="${p.x}" y="${p.y}" width="${smW}" height="${smH}" preserveAspectRatio="xMidYMin slice"/></g>` : `<rect x="${p.x}" y="${p.y}" width="${smW}" height="${smH}" rx="14" fill="#141414"/>
      <text x="${p.x+smW/2}" y="${p.y+smH/2}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.3)" font-family="sans-serif">Camera</text>`}
      <text x="${p.x+smW/2}" y="${p.y+smH+18}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${C.navy}" font-family="'Segoe UI',system-ui,sans-serif" letter-spacing="0.5">${p.label}</text>
    </g>`;
  });

  // Flow arrows between mockups
  const arrowColor = C.blue;
  const flowArrows = `
    <!-- Home → Camera -->
    <line x1="${gridX+smW+4}" y1="${gridY+smH/2}" x2="${gridX+smW+gap-4}" y2="${gridY+smH/2}"
          stroke="${arrowColor}" stroke-width="1.3" opacity="0.5" marker-end="url(#ah${id})"/>
    <!-- Home → Config -->
    <line x1="${gridX+smW/2}" y1="${gridY+smH+4}" x2="${gridX+smW/2}" y2="${gridY+smH+46}"
          stroke="${arrowColor}" stroke-width="1.3" opacity="0.5" marker-end="url(#ah${id})"/>
    <!-- Home → Gestao -->
    <line x1="${gridX+smW+gap+smW/2}" y1="${gridY+smH+4}" x2="${gridX+smW+gap+smW/2}" y2="${gridY+smH+46}"
          stroke="${arrowColor}" stroke-width="1.3" opacity="0.5" marker-end="url(#ah${id})"/>
  `;

  // Navigation labels
  const labels = `
    <text x="${gridX+smW+gap/2}" y="${gridY+smH/2-8}" text-anchor="middle" font-size="7.5" fill="${C.gray}" font-family="'Segoe UI',sans-serif">botao camera</text>
    <text x="${gridX+smW/2-2}" y="${gridY+smH+30}" text-anchor="end" font-size="7.5" fill="${C.gray}" font-family="'Segoe UI',sans-serif">cartao</text>
    <text x="${gridX+smW+gap+smW/2+2}" y="${gridY+smH+30}" text-anchor="start" font-size="7.5" fill="${C.gray}" font-family="'Segoe UI',sans-serif">cartao</text>
  `;

  // Bottom info boxes
  const infoY = gridY + 2*(smH+50) + 30;
  const infos = `
    <rect x="80" y="${infoY}" width="160" height="48" rx="8" fill="${C.snow}" stroke="${C.border}" stroke-width="0.8" filter="url(#bs${id})"/>
    <text x="92" y="${infoY+18}" font-size="11" font-weight="700" fill="${C.graphite}" font-family="'Segoe UI',sans-serif">Funciona offline</text>
    <text x="92" y="${infoY+33}" font-size="9.5" fill="${C.gray}" font-family="'Segoe UI',sans-serif">Apos baixar as rodovias.</text>

    <rect x="260" y="${infoY}" width="160" height="48" rx="8" fill="${C.snow}" stroke="${C.border}" stroke-width="0.8" filter="url(#bs${id})"/>
    <text x="272" y="${infoY+18}" font-size="11" font-weight="700" fill="${C.graphite}" font-family="'Segoe UI',sans-serif">PWA progressivo</text>
    <text x="272" y="${infoY+33}" font-size="9.5" fill="${C.gray}" font-family="'Segoe UI',sans-serif">Instale direto do navegador.</text>

    <rect x="440" y="${infoY}" width="180" height="48" rx="8" fill="${C.snow}" stroke="${C.border}" stroke-width="0.8" filter="url(#bs${id})"/>
    <text x="452" y="${infoY+18}" font-size="11" font-weight="700" fill="${C.graphite}" font-family="'Segoe UI',sans-serif">Legenda automatica</text>
    <text x="452" y="${infoY+33}" font-size="9.5" fill="${C.gray}" font-family="'Segoe UI',sans-serif">KM, coordenadas e rodovia na foto.</text>
  `;

  return `${svgOpen(id)}
    ${header('Visao Geral do Aplicativo','As principais telas e como navegar entre elas',1,TOTAL)}
    ${mockups}
    ${flowArrows}
    ${labels}
    ${infos}
    ${footer(1)}
  </svg>`;
}

// ═══════════════════════════════════════════════
// HELPER: annotated screenshot page
// ═══════════════════════════════════════════════
// annotations = [{side:'L'|'R', yPct:0-1, title, text, accent?, targetYPct, targetSide:'L'|'R'}]
function annotatedPage(id, title, subtitle, imgSrc, annotations, pageNum) {
  let boxes = '';
  let arrows = '';

  annotations.forEach((a, i) => {
    const by = MY + a.yPct * MH;
    const bx = a.side === 'L' ? LBX : RBX;

    // Target point on phone edge
    const ty = MY + a.targetYPct * MH;
    let tx;
    const tSide = a.targetSide || a.side;
    if (tSide === 'L') {
      tx = MX;
    } else {
      tx = MX + MW;
    }

    boxes += box(bx, by, a.title, a.text, a.accent || false, id);
    arrows += arrow(bx, by, BOX_W, BOX_H, tx, ty, a.side, a.accent || false, id);
  });

  return `${svgOpen(id)}
    ${header(title, subtitle, pageNum, TOTAL)}
    ${phoneWithImage(id, imgSrc)}
    ${arrows}
    ${boxes}
    ${footer(pageNum)}
  </svg>`;
}

// ═══════════════════════════════════════════════
// PAGE 2: TELA INICIAL
// ═══════════════════════════════════════════════
function pageHome() {
  return annotatedPage('hm', 'Tela Inicial', 'Painel principal com posicao e atalhos', IMGS.home, [
    { side:'R', yPct:0.02, title:'Busca', text:'Abre a consulta de KM.', targetYPct:0.04, targetSide:'R' },
    { side:'L', yPct:0.15, title:'Placa KM', text:'KM atual via GPS e rodovia.', targetYPct:0.22, targetSide:'L' },
    { side:'R', yPct:0.22, title:'Rodovia Ativa', text:'BR selecionada para registro.', targetYPct:0.25, targetSide:'R' },
    { side:'L', yPct:0.50, title:'Configuracoes', text:'Camera, legenda e aparencia.', targetYPct:0.55, targetSide:'L' },
    { side:'R', yPct:0.50, title:'Gestao de Eixo', text:'Baixar e gerenciar rodovias.', targetYPct:0.55, targetSide:'R' },
    { side:'R', yPct:0.78, title:'Registrar Evidencia', text:'Abre a camera com legenda.', accent:true, targetYPct:0.82, targetSide:'R' },
  ], 2);
}

// ═══════════════════════════════════════════════
// PAGES 3-4: CAMERA (reuse pilot design)
// ═══════════════════════════════════════════════
// Camera wireframe elements
const TOPBAR_H=44, RATIOBAR_H=30, BOTTOMBAR_H=76;
const RATIOBAR_Y=SY+SH-BOTTOMBAR_H-RATIOBAR_H;
const BOTTOMBAR_Y=SY+SH-BOTTOMBAR_H;

const EL={
  back:{x:SX+24,y:SY+TOPBAR_H/2},
  flip:{x:SX+SW-24,y:SY+TOPBAR_H/2},
  ratio43:{x:SX+SW/2,y:RATIOBAR_Y+RATIOBAR_H/2},
  ratio169:{x:SX+SW/2+42,y:RATIOBAR_Y+RATIOBAR_H/2},
  ld:{x:SX+32,y:BOTTOMBAR_Y+BOTTOMBAR_H/2-4},
  le:{x:SX+72,y:BOTTOMBAR_Y+BOTTOMBAR_H/2-4},
  svc:{x:SX+112,y:BOTTOMBAR_Y+BOTTOMBAR_H/2-4},
  shutter:{x:SX+SW/2,y:BOTTOMBAR_Y+BOTTOMBAR_H/2-2},
  settings:{x:SX+SW-100,y:BOTTOMBAR_Y+BOTTOMBAR_H/2-4},
  flash:{x:SX+SW-60,y:BOTTOMBAR_Y+BOTTOMBAR_H/2-4},
  gallery:{x:SX+SW-24,y:BOTTOMBAR_Y+BOTTOMBAR_H/2-4},
  legend:{x:SX+14,y:RATIOBAR_Y-55},
};

function cameraUI(cid) {
  return `<g clip-path="url(#sc${cid || 'CM'})">
    <rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" fill="#0e0e0e"/>
    <rect x="${SX}" y="${SY}" width="${SW}" height="${TOPBAR_H}" fill="rgba(0,0,0,0.85)"/>
    <circle cx="${EL.back.x}" cy="${EL.back.y}" r="18" fill="rgba(255,255,255,0.06)"/>
    <polyline points="${EL.back.x+4},${EL.back.y-7} ${EL.back.x-3},${EL.back.y} ${EL.back.x+4},${EL.back.y+7}" stroke="rgba(255,255,255,0.75)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${EL.flip.x}" cy="${EL.flip.y}" r="18" fill="rgba(255,255,255,0.06)"/>
    <path d="M${EL.flip.x-6},${EL.flip.y-2} a8,8 0 0,1 12,0" stroke="rgba(255,255,255,0.65)" stroke-width="1.5" fill="none"/>
    <path d="M${EL.flip.x+6},${EL.flip.y+2} a8,8 0 0,1 -12,0" stroke="rgba(255,255,255,0.65)" stroke-width="1.5" fill="none"/>
    <polygon points="${EL.flip.x+7},${EL.flip.y-5} ${EL.flip.x+4},${EL.flip.y-1} ${EL.flip.x+10},${EL.flip.y-1}" fill="rgba(255,255,255,0.55)"/>
    <rect x="${SX+4}" y="${SY+TOPBAR_H+2}" width="${SW-8}" height="${SH-TOPBAR_H-RATIOBAR_H-BOTTOMBAR_H-4}" fill="#111" rx="2"/>
    <g opacity="0.08"><line x1="${SX+SW/2-18}" y1="${SY+(SH-BOTTOMBAR_H-RATIOBAR_H)/2+TOPBAR_H/2}" x2="${SX+SW/2+18}" y2="${SY+(SH-BOTTOMBAR_H-RATIOBAR_H)/2+TOPBAR_H/2}" stroke="white" stroke-width="0.6"/>
    <line x1="${SX+SW/2}" y1="${SY+(SH-BOTTOMBAR_H-RATIOBAR_H)/2+TOPBAR_H/2-18}" x2="${SX+SW/2}" y2="${SY+(SH-BOTTOMBAR_H-RATIOBAR_H)/2+TOPBAR_H/2+18}" stroke="white" stroke-width="0.6"/></g>
    <rect x="${EL.legend.x}" y="${EL.legend.y}" width="115" height="44" rx="5" fill="rgba(0,0,0,0.55)"/>
    <text font-size="7.5" fill="rgba(255,255,255,0.8)" font-family="Arial,sans-serif" font-weight="700">
      <tspan x="${EL.legend.x+7}" y="${EL.legend.y+13}">BR-101/RN  KM 87,400</tspan>
      <tspan x="${EL.legend.x+7}" y="${EL.legend.y+24}">LD · EST 4.370</tspan>
      <tspan x="${EL.legend.x+7}" y="${EL.legend.y+35}">-6.077710  -37.891500</tspan></text>
    <rect x="${SX}" y="${RATIOBAR_Y}" width="${SW}" height="${RATIOBAR_H}" fill="rgba(14,14,14,0.9)"/>
    <text x="${EL.ratio43.x-42}" y="${EL.ratio43.y+4}" text-anchor="middle" font-size="10" font-weight="700" fill="rgba(255,255,255,0.4)" font-family="sans-serif">1:1</text>
    <rect x="${EL.ratio43.x-18}" y="${EL.ratio43.y-11}" width="36" height="22" rx="11" fill="rgba(200,216,48,0.18)"/>
    <text x="${EL.ratio43.x}" y="${EL.ratio43.y+4}" text-anchor="middle" font-size="10" font-weight="700" fill="${C.accent}" font-family="sans-serif">4:3</text>
    <text x="${EL.ratio169.x}" y="${EL.ratio169.y+4}" text-anchor="middle" font-size="10" font-weight="700" fill="rgba(255,255,255,0.4)" font-family="sans-serif">16:9</text>
    <rect x="${SX}" y="${BOTTOMBAR_Y}" width="${SW}" height="${BOTTOMBAR_H}" fill="#141414"/>
    <line x1="${SX}" y1="${BOTTOMBAR_Y}" x2="${SX+SW}" y2="${BOTTOMBAR_Y}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <circle cx="${EL.ld.x}" cy="${EL.ld.y}" r="16" fill="rgba(200,216,48,0.12)" stroke="${C.accent}" stroke-width="1.2"/>
    <text x="${EL.ld.x}" y="${EL.ld.y+4}" text-anchor="middle" font-size="10" font-weight="800" fill="${C.accent}" font-family="sans-serif">LD</text>
    <circle cx="${EL.le.x}" cy="${EL.le.y}" r="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" stroke-width="0.8"/>
    <text x="${EL.le.x}" y="${EL.le.y+4}" text-anchor="middle" font-size="10" font-weight="700" fill="rgba(255,255,255,0.4)" font-family="sans-serif">LE</text>
    <circle cx="${EL.svc.x}" cy="${EL.svc.y}" r="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" stroke-width="0.8"/>
    <text x="${EL.svc.x}" y="${EL.svc.y+5}" text-anchor="middle" font-size="13" font-style="italic" fill="rgba(255,255,255,0.4)" font-family="sans-serif">i</text>
    <circle cx="${EL.shutter.x}" cy="${EL.shutter.y}" r="32" fill="rgba(20,20,20,0.9)" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <circle cx="${EL.shutter.x}" cy="${EL.shutter.y}" r="24" fill="#e8e8e8"/>
    <circle cx="${EL.settings.x}" cy="${EL.settings.y}" r="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" stroke-width="0.8"/>
    <circle cx="${EL.settings.x}" cy="${EL.settings.y}" r="5" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
    <circle cx="${EL.flash.x}" cy="${EL.flash.y}" r="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" stroke-width="0.8"/>
    <path d="M${EL.flash.x},${EL.flash.y-7} l-3,7 h5 l-3,7" stroke="rgba(255,255,255,0.45)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${EL.gallery.x}" cy="${EL.gallery.y}" r="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" stroke-width="0.8"/>
    <rect x="${EL.gallery.x-7}" y="${EL.gallery.y-6}" width="14" height="11" rx="2" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>
  </g>`;
}

function pageCamera1() {
  const id='CM';
  const backBY=EL.back.y-BOX_H/2, flipBY=EL.flip.y-BOX_H/2;
  const ratioBY=EL.ratio43.y-BOX_H/2;
  const flashBY=EL.flash.y-BOX_H/2;
  const shutterBY=EL.shutter.y-BOX_H/2;
  return `${svgOpen(id)}
    <defs><radialGradient id="shutterGrad" cx="35%" cy="30%"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#bbb"/></radialGradient></defs>
    ${header('Camera e Captura','Enquadramento e controles de captura',3,TOTAL)}
    ${phoneFrame(id)}
    ${cameraUI(id)}
    ${box(LBX, backBY, 'Voltar', 'Retorna a tela anterior.', false, id)}
    ${arrow(LBX, backBY, BOX_W, BOX_H, EL.back.x-18, EL.back.y, 'L', false, id)}
    ${box(RBX, flipBY, 'Alternar camera', 'Troca traseira e frontal.', false, id)}
    ${arrow(RBX, flipBY, BOX_W, BOX_H, EL.flip.x+18, EL.flip.y, 'R', false, id)}
    ${box(RBX, ratioBY, 'Formato', 'Proporcao da foto capturada.', false, id)}
    ${arrow(RBX, ratioBY, BOX_W, BOX_H, EL.ratio169.x+22, EL.ratio43.y, 'R', false, id)}
    ${box(RBX, flashBY, 'Flash', 'Ativa ou desativa o flash.', false, id)}
    ${arrow(RBX, flashBY, BOX_W, BOX_H, EL.flash.x+16, EL.flash.y, 'R', false, id)}
    ${box(RBX, shutterBY+52, 'Capturar', 'Registra a foto com legenda.', true, id)}
    ${arrow(RBX, shutterBY+52, BOX_W, BOX_H, EL.shutter.x+32, EL.shutter.y, 'R', true, id)}
    ${footer(3)}
  </svg>`;
}

function pageCamera2() {
  const id='C2';
  const legBY=EL.legend.y+22-BOX_H/2-42;
  const ldBY=EL.ld.y-BOX_H/2-10;
  const svcBY=ldBY+BOX_H+14;
  const setBY=EL.settings.y-BOX_H/2-60;
  const galBY=setBY+BOX_H+14;
  return `${svgOpen(id)}
    <defs><radialGradient id="shutterGrad" cx="35%" cy="30%"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#bbb"/></radialGradient></defs>
    ${header('Camera e Captura','Legenda, lado da via e servico',4,TOTAL)}
    ${phoneFrame(id)}
    ${cameraUI(id)}
    ${box(LBX, ldBY, 'Lado da Via', 'LD (direito) ou LE (esquerdo).', false, id)}
    ${arrow(LBX, ldBY, BOX_W, BOX_H, EL.ld.x-16, EL.ld.y, 'L', false, id)}
    ${box(LBX, svcBY, 'Servico', 'Seleciona servico e contrato.', false, id)}
    ${arrow(LBX, svcBY, BOX_W, BOX_H, EL.svc.x-16, EL.svc.y, 'L', false, id)}
    ${box(LBX, legBY, 'Legenda', 'Dados do registro sobre a foto.', false, id)}
    ${arrow(LBX, legBY, BOX_W, BOX_H, EL.legend.x, EL.legend.y+22, 'L', false, id)}
    ${box(RBX, galBY, 'Galeria', 'Abre as imagens capturadas.', false, id)}
    ${arrow(RBX, galBY, BOX_W, BOX_H, EL.gallery.x+16, EL.gallery.y, 'R', false, id)}
    ${box(RBX, setBY, 'Configuracoes', 'Ajustes sem sair da camera.', false, id)}
    ${arrow(RBX, setBY, BOX_W, BOX_H, EL.settings.x+16, EL.settings.y, 'R', false, id)}
    ${footer(4)}
  </svg>`;
}

// ═══════════════════════════════════════════════
// PAGE 5: CAMERA HORIZONTAL (info page)
// ═══════════════════════════════════════════════
function pageCameraHoriz() {
  const id='CH';
  const hMW = MH * 0.72;
  const hMH = MW * 0.72;
  const hMX = (PW - hMW) / 2;
  const hMY = 230;

  // Vertical phone (before) small
  const vW=80, vH=Math.round(vW*812/375);
  const vX=110, vY=160;

  return `${svgOpen(id)}
    ${header('Camera na Horizontal','O app se adapta automaticamente ao girar o celular',5,TOTAL)}

    <!-- Small vertical phone "before" -->
    <g opacity="0.35">
      <rect x="${vX}" y="${vY}" width="${vW}" height="${vH}" rx="12" fill="${C.graphite}"/>
      <rect x="${vX+2}" y="${vY+2}" width="${vW-4}" height="${vH-4}" rx="2" fill="#111"/>
      <text x="${vX+vW/2}" y="${vY+vH/2}" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.3)" font-family="sans-serif">Vertical</text>
    </g>

    <!-- Curved arrow from vertical to horizontal -->
    <path d="M${vX+vW+8},${vY+vH/2} C${vX+vW+50},${vY+vH/2-40} ${hMX-50},${hMY-20} ${hMX+30},${hMY-8}" fill="none" stroke="${C.blue}" stroke-width="1.3" opacity="0.45" marker-end="url(#ah${id})" stroke-dasharray="4,3"/>
    <text x="${vX+vW+55}" y="${vY+vH/2-30}" font-size="9" fill="${C.gray}" font-family="'Segoe UI',sans-serif">gire o celular</text>

    <!-- Horizontal phone frame -->
    <g filter="url(#ms${id})">
      <rect x="${hMX}" y="${hMY}" width="${hMW}" height="${hMH}" rx="26" fill="${C.graphite}"/>
      <rect x="${hMX+4}" y="${hMY+4}" width="${hMW-8}" height="${hMH-8}" rx="3" fill="#111"/>
      <rect x="${hMX}" y="${hMY + (hMH-50)/2}" width="16" height="50" rx="8" fill="#000"/>
    </g>

    <!-- Camera crosshair -->
    <g opacity="0.08">
      <line x1="${hMX+hMW/2-30}" y1="${hMY+hMH/2}" x2="${hMX+hMW/2+30}" y2="${hMY+hMH/2}" stroke="white" stroke-width="0.6"/>
      <line x1="${hMX+hMW/2}" y1="${hMY+hMH/2-20}" x2="${hMX+hMW/2}" y2="${hMY+hMH/2+20}" stroke="white" stroke-width="0.6"/>
    </g>

    <!-- Legend in corner -->
    <rect x="${hMX + hMW - 140}" y="${hMY + hMH - 52}" width="120" height="38" rx="4" fill="rgba(0,0,0,0.55)"/>
    <text font-size="7" fill="rgba(255,255,255,0.8)" font-family="Arial,sans-serif" font-weight="700">
      <tspan x="${hMX + hMW - 132}" y="${hMY + hMH - 38}">BR-101/RN  KM 87,400</tspan>
      <tspan x="${hMX + hMW - 132}" dy="12">LD · EST 4.370</tspan>
    </text>

    <!-- Info boxes below -->
    <g>
      ${box(80, hMY + hMH + 50, 'Rotacao automatica', 'Gire o celular e a tela adapta.', false, id)}
      ${box(280, hMY + hMH + 50, 'Fotos panoramicas', 'Ideal para visao ampla da via.', false, id)}
      ${box(480, hMY + hMH + 50, 'Legenda reposiciona', 'Os dados acompanham a rotacao.', false, id)}

      ${box(80, hMY + hMH + 110, 'Controles adaptados', 'Botoes reposicionam na tela.', false, id)}
      ${box(280, hMY + hMH + 110, 'Mesma qualidade', 'Resolucao e formato mantidos.', false, id)}
      ${box(480, hMY + hMH + 110, 'Lado da via', 'LD/LE permanece selecionado.', false, id)}
    </g>

    <!-- Accent box -->
    <rect x="80" y="${hMY + hMH + 185}" width="${PW-160}" height="48" rx="10" fill="${C.navy}"/>
    <text x="${PW/2}" y="${hMY + hMH + 212}" text-anchor="middle" font-size="11.5" font-weight="600" fill="white" font-family="'Segoe UI',system-ui,sans-serif">Dica: ative a rotacao automatica nas configuracoes do seu celular</text>
    <text x="${PW/2}" y="${hMY + hMH + 228}" text-anchor="middle" font-size="9.5" fill="white" opacity="0.5" font-family="'Segoe UI',system-ui,sans-serif">Configuracoes do Android/iOS > Tela > Rotacao automatica</text>

    ${footer(5)}
  </svg>`;
}

// ═══════════════════════════════════════════════
// PAGE 6: CONFIG CAMERA
// ═══════════════════════════════════════════════
function pageCfgCam() {
  // Screenshot positions (375x812, elements at approximate %)
  // Tabs row: ~14%
  // Resolucao: ~25%
  // Qualidade: ~34%
  // Formato: ~42%
  // Alerta sonoro: ~50%
  // Aceitacao auto: ~62%
  // Envio galeria: ~72%
  // Tema: ~84%
  return annotatedPage('cc', 'Configuracoes da Camera', 'Qualidade, formato e comportamento da captura', IMGS.cfgCam1, [
    { side:'L', yPct:0.12, title:'Abas', text:'Camera, Logo e Legenda.', targetYPct:0.15 },
    { side:'R', yPct:0.22, title:'Resolucao', text:'0.3 a 12 MP. Detalhe da foto.', targetYPct:0.26, targetSide:'R' },
    { side:'R', yPct:0.35, title:'Qualidade', text:'Compressao: minima a maxima.', targetYPct:0.36, targetSide:'R' },
    { side:'R', yPct:0.46, title:'Formato', text:'Proporcao: 1:1, 4:3 ou 16:9.', targetYPct:0.44, targetSide:'R' },
    { side:'L', yPct:0.58, title:'Aceitacao automatica', text:'Pula o preview da foto.', targetYPct:0.63 },
    { side:'L', yPct:0.74, title:'Tema', text:'Alterna claro e escuro.', targetYPct:0.83 },
  ], 6);
}

// ═══════════════════════════════════════════════
// PAGE 7: CONFIG LEGENDA
// ═══════════════════════════════════════════════
function pageCfgLeg() {
  return annotatedPage('cl', 'Configuracoes da Legenda', 'Aparencia e conteudo do texto sobre a foto', IMGS.cfgLeg1, [
    { side:'L', yPct:0.16, title:'Posicao', text:'Canto onde a legenda aparece.', targetYPct:0.26 },
    { side:'R', yPct:0.26, title:'Tamanho', text:'Pequeno, medio ou grande.', targetYPct:0.35, targetSide:'R' },
    { side:'L', yPct:0.38, title:'Cor e Negrito', text:'Cor do texto sobre a foto.', targetYPct:0.47 },
    { side:'R', yPct:0.54, title:'Opacidade', text:'Transparencia de 0% a 100%.', targetYPct:0.60, targetSide:'R' },
    { side:'L', yPct:0.70, title:'Conteudo', text:'Estaca, OAE, coordenadas, data.', targetYPct:0.75 },
  ], 7);
}

// ═══════════════════════════════════════════════
// PAGE 8: GESTAO DE EIXO
// ═══════════════════════════════════════════════
function pageGestao() {
  return annotatedPage('ge', 'Gestao de Eixo', 'Baixar rodovias do SNV/DNIT para uso offline', IMGS.gestao, [
    { side:'L', yPct:0.08, title:'Rodovias baixadas', text:'Lista das rodovias instaladas.', targetYPct:0.18 },
    { side:'R', yPct:0.30, title:'UF e BR', text:'Selecione estado e rodovia.', targetYPct:0.37, targetSide:'R' },
    { side:'L', yPct:0.38, title:'KM inicial e final', text:'Filtra o trecho desejado.', targetYPct:0.43 },
    { side:'R', yPct:0.48, title:'Baixar', text:'Importa dados do SNV/DNIT.', accent:true, targetYPct:0.52, targetSide:'R' },
    { side:'R', yPct:0.68, title:'Importar arquivo', text:'Shapefile, ZIP, KMZ ou CSV.', targetYPct:0.73, targetSide:'R' },
  ], 8);
}

// ═══════════════════════════════════════════════
// PAGE 9: CONSULTA
// ═══════════════════════════════════════════════
function pageConsulta() {
  return annotatedPage('cq', 'Consulta de Coordenadas', 'Converter coordenadas em KM e vice-versa', IMGS.consulta, [
    { side:'L', yPct:0.10, title:'Coordenada para KM', text:'Cole coordenadas, uma por linha.', targetYPct:0.18 },
    { side:'R', yPct:0.30, title:'Calcular KM', text:'Retorna o KM mais proximo.', accent:true, targetYPct:0.38, targetSide:'R' },
    { side:'R', yPct:0.14, title:'Usar GPS', text:'Preenche com a posicao atual.', targetYPct:0.38, targetSide:'R' },
    { side:'L', yPct:0.55, title:'KM para Coordenada', text:'Informe KM, obtenha lat/long.', targetYPct:0.62 },
    { side:'R', yPct:0.68, title:'Localizar coordenada', text:'Retorna posicao do KM.', accent:true, targetYPct:0.78, targetSide:'R' },
  ], 9);
}

// ═══════════════════════════════════════════════
// PAGE 10: TEMAS
// ═══════════════════════════════════════════════
function pageTemas() {
  const id='tm';
  const smW=180, smH=Math.round(smW*812/375);
  const gap=40;
  const x1=(PW-2*smW-gap)/2, x2=x1+smW+gap;
  const y1=160;

  let imgs='';
  [{x:x1,img:IMGS.home,label:'Tema Claro',desc:'Fundo claro com cartoes escuros.'},{x:x2,img:IMGS.homeDark,label:'Tema Escuro',desc:'Reduz fadiga visual em campo.'}].forEach((p,i) => {
    const cid=`tmC${i}`;
    imgs += `
    <defs><clipPath id="${cid}"><rect x="${p.x}" y="${y1}" width="${smW}" height="${smH}" rx="20"/></clipPath></defs>
    <g filter="url(#bs${id})">
      <rect x="${p.x-2}" y="${y1-2}" width="${smW+4}" height="${smH+4}" rx="22" fill="${C.graphite}"/>
      <g clip-path="url(#${cid})"><image href="${p.img}" x="${p.x}" y="${y1}" width="${smW}" height="${smH}" preserveAspectRatio="xMidYMin slice"/></g>
      <path d="M${p.x+(smW-60)/2},${y1} h60 v${NOTCH_H-8} q0,8 -8,8 h-44 q-8,0 -8,-8 Z" fill="#000"/>
    </g>
    <text x="${p.x+smW/2}" y="${y1+smH+22}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.navy}" font-family="'Segoe UI',system-ui,sans-serif">${p.label}</text>
    <text x="${p.x+smW/2}" y="${y1+smH+38}" text-anchor="middle" font-size="10" fill="${C.gray}" font-family="'Segoe UI',system-ui,sans-serif">${p.desc}</text>`;
  });

  // Arrow between them
  const arrowSvg = `
    <path d="M${x1+smW+8},${y1+smH/2} C${x1+smW+20},${y1+smH/2-20} ${x2-20},${y1+smH/2-20} ${x2-8},${y1+smH/2}"
          fill="none" stroke="${C.blue}" stroke-width="1.2" opacity="0.4"
          marker-end="url(#ah${id})" marker-start="url(#ah${id})"/>
    <text x="${PW/2}" y="${y1+smH/2-22}" text-anchor="middle" font-size="7.5" fill="${C.gray}" font-family="'Segoe UI',sans-serif">Configuracoes > Aparencia</text>`;

  return `${svgOpen(id)}
    ${header('Tema e Aparencia','O app se adapta a sua preferencia visual',10,TOTAL)}
    ${imgs}
    ${arrowSvg}

    <!-- Info boxes -->
    ${box(PW/2-BOX_W-10, y1+smH+70, 'Como alternar', 'Config > Camera > Aparencia.', false, id)}
    ${box(PW/2+10, y1+smH+70, 'Nao afeta a foto', 'Apenas visual do aplicativo.', false, id)}

    ${footer(10)}
  </svg>`;
}

// ═══════════════════════════════════════════════
// PAGE 11: DICAS ESSENCIAIS
// ═══════════════════════════════════════════════
function pageDicas() {
  const id='dk';
  const tips = [
    { icon:'1°', title:'Primeiro Uso', text:'Permita camera, GPS e movimento. Baixe uma rodovia.' },
    { icon:'↓', title:'Internet', text:'So para baixar rodovias. Depois, tudo offline.' },
    { icon:'◎', title:'GPS', text:'Mantenha ativo para KM e coordenadas.' },
    { icon:'↻', title:'Gire o Celular', text:'A camera adapta ao modo paisagem.' },
    { icon:'LD', title:'Lado da Via', text:'Selecione LD ou LE antes de fotografar.' },
    { icon:'!', title:'Alerta de Distancia', text:'Aviso visual quando > 300m da rodovia.' },
  ];

  const cols=2, rows=3;
  const cardW=255, cardH=72, gapX=24, gapY=20;
  const gridW = cols*cardW + (cols-1)*gapX;
  const startX = (PW-gridW)/2;
  const startY = 170;

  let cards = '';
  tips.forEach((t, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = startX + col*(cardW+gapX);
    const cy = startY + row*(cardH+gapY);

    const isFirst = i === 0;
    const bg = isFirst ? C.navy : C.snow;
    const bc = isFirst ? C.navy : C.border;
    const titleColor = isFirst ? '#fff' : C.graphite;
    const textColor = isFirst ? 'rgba(255,255,255,0.7)' : C.gray;
    const iconBg = isFirst ? 'rgba(200,216,48,0.25)' : C.navy;
    const iconColor = isFirst ? C.accent : '#fff';

    cards += `
    <g filter="url(#bs${id})">
      <rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" rx="10" fill="${bg}" stroke="${bc}" stroke-width="0.8"/>
      <!-- Icon badge -->
      <rect x="${cx+12}" y="${cy+18}" width="34" height="34" rx="9" fill="${iconBg}"/>
      <text x="${cx+29}" y="${cy+40}" text-anchor="middle" font-size="12" font-weight="700" fill="${iconColor}" font-family="sans-serif">${t.icon}</text>
      <!-- Text -->
      <text x="${cx+58}" y="${cy+30}" font-size="12" font-weight="700" fill="${titleColor}" font-family="'Segoe UI',system-ui,sans-serif">${t.title}</text>
      <text x="${cx+58}" y="${cy+48}" font-size="10" fill="${textColor}" font-family="'Segoe UI',system-ui,sans-serif">${t.text}</text>
    </g>`;
  });

  // CTA at bottom
  const ctaY = startY + rows*(cardH+gapY) + 40;
  const cta = `
    <rect x="${startX}" y="${ctaY}" width="${gridW}" height="52" rx="12" fill="${C.navy}"/>
    <text x="${PW/2}" y="${ctaY+22}" text-anchor="middle" font-size="13" font-weight="700" fill="white" font-family="'Segoe UI',system-ui,sans-serif">Pronto para comecar?</text>
    <text x="${PW/2}" y="${ctaY+40}" text-anchor="middle" font-size="10" fill="white" opacity="0.6" font-family="'Segoe UI',system-ui,sans-serif">Baixe uma rodovia · Ative o GPS · Abra a camera · Registre</text>`;

  return `${svgOpen(id)}
    ${header('Dicas Essenciais','Tudo para usar o KM Check com eficiencia',11,TOTAL)}
    ${cards}
    ${cta}
    ${footer(11)}
  </svg>`;
}

// ═══════════════════════════════════════════════
// ASSEMBLE
// ═══════════════════════════════════════════════
const pages = [
  pageCover(),
  pageOverview(),
  pageHome(),
  pageCamera1(),
  pageCamera2(),
  pageCameraHoriz(),
  pageCfgCam(),
  pageCfgLeg(),
  pageGestao(),
  pageConsulta(),
  pageTemas(),
  pageDicas(),
];

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KM Check — Guia Visual do Usuario</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: #e8e8e8; display: flex; flex-direction: column;
    align-items: center; gap: 20px; padding: 20px 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pg { background: white; box-shadow: 0 2px 16px rgba(0,0,0,0.08); page-break-after: always; }
  .pg:last-child { page-break-after: avoid; }
  .pg svg { display: block; width: 210mm; height: 297mm; }
  @media print { body { background: white; padding: 0; gap: 0; } .pg { box-shadow: none; } }
</style>
</head>
<body>
${pages.map(p => `<div class="pg">${p}</div>`).join('\n')}
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, 'utf-8');
console.log('HTML:', (fs.statSync(OUT_HTML).size / 1024).toFixed(0), 'KB');
console.log('Pages:', pages.length);
