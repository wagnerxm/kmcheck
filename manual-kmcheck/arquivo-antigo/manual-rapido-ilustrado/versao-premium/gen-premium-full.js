const puppeteer = require('C:\\Users\\wagne\\Claude\\kmcheck\\node_modules\\puppeteer-core');
const path = require('path');
const fs = require('fs');

const OUT = 'C:\\Users\\wagne\\Claude\\kmcheck\\manual-kmcheck\\manual-rapido-ilustrado\\versao-premium';
const HTML_PATH = path.join(OUT, 'guia-visual-kmcheck.html');
const PDF_PATH = path.join(OUT, 'guia-visual-kmcheck.pdf');
const PNG_DIR = path.join(OUT, 'paginas-png');

const TOTAL_PAGES = 12;
const PAGE_W = 794; // A4 width in px at 96dpi
const PAGE_H = 1123; // A4 height in px at 96dpi
const GAP = 24; // gap between pages in the HTML (from CSS gap:20px + some padding)

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  const fileUrl = 'file:///' + HTML_PATH.split(path.sep).join('/');

  // ═══ PDF ═══
  console.log('Generating PDF...');
  await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.pdf({
    path: PDF_PATH,
    format: 'A4',
    printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    displayHeaderFooter: false
  });
  console.log('PDF:', (fs.statSync(PDF_PATH).size / 1024 / 1024).toFixed(1), 'MB');

  // ═══ PNGs ═══
  console.log('Generating PNGs...');
  const totalH = TOTAL_PAGES * PAGE_H + (TOTAL_PAGES - 1) * GAP + 80; // +padding
  await page.setViewport({ width: PAGE_W, height: totalH, deviceScaleFactor: 3 });
  await page.goto(fileUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Measure actual page positions
  const positions = await page.evaluate(() => {
    const pages = document.querySelectorAll('.pg');
    return Array.from(pages).map(p => {
      const r = p.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
  });

  const names = [
    '00-capa', '01-visao-geral', '02-tela-inicial',
    '03-camera-captura', '04-camera-legenda', '05-camera-horizontal',
    '06-config-camera', '07-config-legenda', '08-gestao-eixo',
    '09-consulta', '10-tema-aparencia', '11-dicas-essenciais'
  ];

  for (let i = 0; i < positions.length; i++) {
    const pngPath = path.join(PNG_DIR, `${names[i]}.png`);
    await page.screenshot({
      path: pngPath,
      clip: {
        x: 0,
        y: Math.round(positions[i].top),
        width: PAGE_W,
        height: Math.round(positions[i].height)
      }
    });
    const sz = (fs.statSync(pngPath).size / 1024).toFixed(0);
    console.log(`  ${names[i]}.png: ${sz} KB`);
  }

  await browser.close();
  console.log('Concluido!');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
