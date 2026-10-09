/* Material da página do KM Check na Google Play, no visual da capa do manual:
 *   icone-512.png        ícone da loja (512×512)
 *   destaque-1024x500.png imagem de destaque (a arte da capa, sem cortar a logo)
 *   tela-1..6.png        capturas 1080×1920 (9:16): frase + celular com a tela real do app
 * Uso: node mobile/loja/gerar-loja.mjs (a partir da raiz do projeto) */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve('.'), SAIDA = path.resolve('mobile/loja');
const b64 = (f, t = 'png') => `data:image/${t};base64,` + fs.readFileSync(f).toString('base64');
const FUNDO = b64('manual-kmcheck/estudio/fundo-manual.webp', 'webp');
const CAPA = b64('manual-kmcheck/estudio/capa-manual.webp', 'webp');
const PR = n => b64(`manual-kmcheck/prints/${n}.png`);
const FONTES = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap">';

const TELAS = [
  { img: '01-inicio', olho: 'Na rodovia', tit: 'O KM certo,<br>em cada foto.', sub: 'Rodovia, KM e estaca pelo GPS, na hora.' },
  { img: '10-camera', olho: 'Câmera', tit: 'A legenda vai<br>gravada na foto.', sub: 'Rodovia, KM, lado, estaca, contrato e data.' },
  { img: '20-carro-dia', olho: 'Modo Carro', tit: 'Acompanhe o KM<br>dirigindo.', sub: 'Painel grande, que escurece à noite.' },
  { img: '33-importar-configurar', olho: 'Qualquer rodovia', tit: 'Federal, estadual<br>ou municipal.', sub: 'Baixe do SNV ou importe KMZ, Shapefile e planilha.' },
  { img: '13-galeria', olho: 'Galeria', tit: 'Suas fotos,<br>organizadas.', sub: 'Nome do arquivo com rodovia, KM e data.' },
  { img: '40-consulta', olho: 'Consulta', tit: 'Coordenada em KM<br>e KM em coordenada.', sub: 'Cole a lista do Excel e copie o resultado.' },
];
const ESCURAS = new Set(['10-camera', '13-galeria', '33-importar-configurar']);

const CSS = `*{box-sizing:border-box}html,body{margin:0}
body{font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#1c2333}
.tela{position:relative;width:1080px;height:1920px;overflow:hidden;background:url(${FUNDO}) 70% 0/auto 100% no-repeat,#eef0f1}
.tela::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(244,245,244,.92) 0%,rgba(244,245,244,.75) 30%,rgba(244,245,244,0) 55%)}
.txt{position:absolute;left:84px;right:84px;top:120px;z-index:2}
.olho{font:800 30px Inter;letter-spacing:.24em;text-transform:uppercase;color:#6f8a0e}
h1{font:900 92px/1 Inter;letter-spacing:-.045em;margin:22px 0 0}
p{font:500 38px/1.35 Inter;color:#3b4559;margin:26px 0 0;max-width:20em}
.cel{position:absolute;left:50%;top:640px;width:600px;transform:translateX(-50%);padding:20px;border-radius:96px;z-index:2;
  background:linear-gradient(140deg,#4d525a 0%,#141517 18%,#0b0c0d 60%,#2d3136 100%);box-shadow:inset 0 0 0 2px rgba(255,255,255,.16),0 0 0 2px #000,0 90px 140px -50px rgba(20,26,36,.75),0 30px 60px -30px rgba(20,26,36,.5)}
.scr{position:relative;border-radius:78px;overflow:hidden;aspect-ratio:390/844;background:#0b0c0d}
.scr img{display:block;width:100%;height:100%;object-fit:cover}
.scr::after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.12) 0%,rgba(255,255,255,.03) 26%,transparent 40%)}
.sb{position:absolute;left:0;right:0;top:0;height:5.6%;display:flex;align-items:center;justify-content:space-between;padding:0 10% 0 11%;font:700 26px -apple-system,Inter;color:#121315;z-index:2}
.sb.esc{color:#fff}
.ilha{position:absolute;left:50%;top:24%;width:30%;height:56%;transform:translateX(-50%);background:#000;border-radius:999px}
.bat{width:46px;height:22px;border-radius:7px;border:3px solid currentColor;opacity:.85;position:relative}
.bat::after{content:'';position:absolute;inset:3px 7px 3px 3px;background:currentColor;border-radius:2px}`;

const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
async function render(html, w, h, arq) {
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTES}<style>${CSS}</style></head><body>${html}</body></html>`, { waitUntil: 'load' });
  await p.evaluateHandle('document.fonts.ready'); await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: path.join(SAIDA, arq), clip: { x: 0, y: 0, width: w, height: h } });
}
for (const [i, t] of TELAS.entries()) {
  await render(`<section class="tela"><div class="txt"><div class="olho">${t.olho}</div><h1>${t.tit}</h1><p>${t.sub}</p></div>
    <div class="cel"><div class="scr"><img src="${PR(t.img)}"><div class="sb${ESCURAS.has(t.img) ? ' esc' : ''}"><span>9:41</span><span class="ilha"></span><span class="bat"></span></div></div></div></section>`, 1080, 1920, `tela-${i + 1}.png`);
}
/* destaque 1024×500: a arte da capa preenchendo a largura, presa no topo (a logo fica inteira) */
await render(`<div style="width:1024px;height:500px;background:url(${CAPA}) 50% 0/1024px auto no-repeat"></div>`, 1024, 500, 'destaque-1024x500.png');
fs.copyFileSync(path.join(RAIZ, 'icon-512.png'), path.join(SAIDA, 'icone-512.png'));
await b.close();
console.log('material da loja em mobile/loja/');
