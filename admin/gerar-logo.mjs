/* Gera as imagens da logo do PAINEL (só do painel; o app de campo tem a logo dele) a partir de img/fonte-logo.png.
 * Uso (na pasta admin): node gerar-logo.mjs */
import puppeteer from 'puppeteer'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const aqui = path.dirname(fileURLToPath(import.meta.url)), img = f => path.join(aqui, 'img', f);
const FONTE = 'data:image/png;base64,' + fs.readFileSync(img('fonte-logo.png')).toString('base64');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
/* recorte [x, y, largura, altura] da arte original (1254×1254) desenhado num quadrado preto de "lado" px */
async function gera(nome, lado, recorte, margem = 0) {
  const url = await p.evaluate(async (FONTE, lado, recorte, margem) => {
    const i = await new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.src = FONTE });
    const [x, y, w, h] = recorte || [0, 0, i.width, i.height];
    const c = document.createElement('canvas'); c.width = c.height = lado; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, lado, lado); g.imageSmoothingQuality = 'high';
    const util = lado * (1 - 2 * margem), s = util / Math.max(w, h);
    g.drawImage(i, x, y, w, h, (lado - w * s) / 2, (lado - h * s) / 2, w * s, h * s);
    return c.toDataURL('image/png');
  }, FONTE, lado, recorte, margem);
  fs.writeFileSync(img(nome), Buffer.from(url.split(',')[1], 'base64'));
}
const CABECA = [250, 135, 755, 560];          // só a cabeça do robô (barra do topo e favicon)
await gera('painel-icone-512.png', 512);       // tela de início (Android) e logo da entrada
await gera('painel-icone-192.png', 192);
await gera('painel-apple-touch.png', 180);     // tela de início (iPhone)
await gera('painel-cabeca-128.png', 128, CABECA, .04);
await gera('painel-favicon-64.png', 64, CABECA, .02);
await b.close(); console.log('ok');
