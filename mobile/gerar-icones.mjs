/* Gera os ícones e a tela de abertura do app Android a partir das artes do site.
 * ícone: icon-512.png (fundo grafite com o logotipo no centro, já dentro da área segura do Android)
 * abertura: fundo #0a0c0e com o logotipo (logo-kmcheck.png) no centro
 * Uso: node gerar-icones.mjs (a partir de mobile/) */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const RES = path.resolve('android/app/src/main/res');
const ICONE = 'data:image/png;base64,' + fs.readFileSync(path.resolve('../icon-512.png')).toString('base64');
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('../logo-kmcheck.png')).toString('base64');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
async function desenha(arquivo, larg, alt, modo) {
  const url = await p.evaluate(async (ICONE, LOGO, larg, alt, modo) => {
    const carrega = s => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = s; });
    const c = document.createElement('canvas'); c.width = larg; c.height = alt; const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (modo === 'camada') {            // camada do ícone adaptável (108dp): a arte inteira
      g.drawImage(await carrega(ICONE), 0, 0, larg, alt);
    } else if (modo === 'quadrado') {   // ícone antigo (Android 7): cantos arredondados
      const r = larg * .18; g.beginPath(); g.roundRect(0, 0, larg, alt, r); g.clip(); g.drawImage(await carrega(ICONE), 0, 0, larg, alt);
    } else if (modo === 'redondo') {
      g.beginPath(); g.arc(larg / 2, alt / 2, larg / 2, 0, Math.PI * 2); g.clip(); g.drawImage(await carrega(ICONE), 0, 0, larg, alt);
    } else if (modo === 'abertura') {   // tela de abertura (Android 11 ou anterior)
      g.fillStyle = '#0a0c0e'; g.fillRect(0, 0, larg, alt);
      const lg = await carrega(LOGO), w = Math.min(larg, alt) * .42, h = w * lg.height / lg.width;
      g.drawImage(lg, (larg - w) / 2, (alt - h) / 2, w, h);
    }
    return c.toDataURL('image/png');
  }, ICONE, LOGO, larg, alt, modo);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, Buffer.from(url.split(',')[1], 'base64'));
}
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  await desenha(path.join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'), Math.round(108 * k), Math.round(108 * k), 'camada');
  await desenha(path.join(RES, `mipmap-${d}`, 'ic_launcher.png'), Math.round(48 * k), Math.round(48 * k), 'quadrado');
  await desenha(path.join(RES, `mipmap-${d}`, 'ic_launcher_round.png'), Math.round(48 * k), Math.round(48 * k), 'redondo');
  await desenha(path.join(RES, `drawable-port-${d}`, 'splash.png'), Math.round(320 * k), Math.round(480 * k), 'abertura');
  await desenha(path.join(RES, `drawable-land-${d}`, 'splash.png'), Math.round(480 * k), Math.round(320 * k), 'abertura');
}
await desenha(path.join(RES, 'drawable', 'splash.png'), 480, 800, 'abertura');
await b.close();
console.log('ícones e abertura gerados');
