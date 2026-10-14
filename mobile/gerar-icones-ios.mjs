/* Gera o ícone (1024 px, sem transparência — a Apple recusa ícone com canal alfa) e a tela de abertura do app
 * de iPhone. O icon-512.png do site é pequeno demais para 1024: o fundo é redesenhado aqui (grafite com as ondas
 * suaves do original) e o logotipo vem do logo-kmcheck.png, nítido.
 * Uso: node gerar-icones-ios.mjs (a partir de mobile/) */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* PNG tipo 2 (RGB, 8 bits) a partir de RGBA cru */
function pngRGB(rgba, w, h) {
  const cru = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { cru[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, d = y * (w * 3 + 1) + 1 + x * 3; cru[d] = rgba[o]; cru[d + 1] = rgba[o + 1]; cru[d + 2] = rgba[o + 2]; } }
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo), tam = Buffer.alloc(4), c = Buffer.alloc(4); tam.writeUInt32BE(dados.length); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([tam, t, dados, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(cru, { level: 9 })), bloco('IEND', Buffer.alloc(0))]);
}
const ASSETS = path.resolve('ios/App/App/Assets.xcassets');
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('../logo-kmcheck.png')).toString('base64');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
async function desenha(arquivo, larg, alt, modo) {
  const url = await p.evaluate(async (LOGO, larg, alt, modo) => {
    const carrega = s => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = s; });
    const c = document.createElement('canvas'); c.width = larg; c.height = alt; const g = c.getContext('2d', { alpha: false });
    g.imageSmoothingQuality = 'high';
    const lg = await carrega(LOGO);
    if (modo === 'icone') {
      const fundo = g.createLinearGradient(0, 0, larg, alt);
      fundo.addColorStop(0, '#1b1e23'); fundo.addColorStop(.55, '#0d0f12'); fundo.addColorStop(1, '#060708');
      g.fillStyle = fundo; g.fillRect(0, 0, larg, alt);
      /* as duas ondas claras e bem sutis do ícone original */
      const onda = (y0, y1, a) => { g.beginPath(); g.moveTo(0, alt * y0);
        g.bezierCurveTo(larg * .35, alt * (y0 - .18), larg * .62, alt * (y1 + .2), larg, alt * y1);
        g.lineTo(larg, alt); g.lineTo(0, alt); g.closePath(); g.fillStyle = `rgba(255,255,255,${a})`; g.fill(); };
      onda(.78, .5, .035); onda(.92, .7, .03);
      const brilho = g.createRadialGradient(larg * .2, alt * .1, 0, larg * .2, alt * .1, larg * .7);
      brilho.addColorStop(0, 'rgba(255,255,255,.06)'); brilho.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = brilho; g.fillRect(0, 0, larg, alt);
      const w = larg * .54, h = w * lg.height / lg.width;
      g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = larg * .03; g.shadowOffsetY = larg * .012;
      g.drawImage(lg, (larg - w) / 2, (alt - h) / 2, w, h);
    } else {   // abertura: fundo do app com o logotipo no centro (a imagem é cortada nas bordas, o centro sempre aparece)
      g.fillStyle = '#0a0c0e'; g.fillRect(0, 0, larg, alt);
      const w = larg * .2, h = w * lg.height / lg.width;
      g.drawImage(lg, (larg - w) / 2, (alt - h) / 2, w, h);
    }
    /* pixels crus (RGBA) para o node gravar um PNG só RGB, sem canal alfa */
    const d = g.getImageData(0, 0, larg, alt).data; let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
    return btoa(s);
  }, LOGO, larg, alt, modo);
  fs.writeFileSync(arquivo, pngRGB(Buffer.from(url, 'base64'), larg, alt));
}
await desenha(path.join(ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), 1024, 1024, 'icone');
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  await desenha(path.join(ASSETS, 'Splash.imageset', f), 2732, 2732, 'abertura');
await b.close();
console.log('ícone e abertura do iPhone prontos');
