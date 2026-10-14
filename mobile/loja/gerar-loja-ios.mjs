/* Capturas da App Store (iPhone 6,9": 1290×2796), no mesmo visual das da Google Play, mas com iPhone
 * (Dynamic Island, barra de status do iOS, barrinha de início). A Apple recusa capturas com aparelho Android.
 * As telas vêm de manual-kmcheck/prints-ios (KC_IOS=1 node manual-kmcheck/estudio/capturar.mjs camera galeria
 * inicio carro consulta importar), já em 430×932 @3x.
 * Uso: node mobile/loja/gerar-loja-ios.mjs (a partir da raiz do projeto) → mobile/loja/ios/tela-1..6.png */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const SAIDA = path.resolve('mobile/loja/ios'); fs.mkdirSync(SAIDA, { recursive: true });
const b64 = (f, t = 'png') => `data:image/${t};base64,` + fs.readFileSync(f).toString('base64');
const FUNDO = b64('manual-kmcheck/estudio/fundo-manual.webp', 'webp');
const PR = n => b64(`manual-kmcheck/prints-ios/${n}.png`);
const FONTES = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap">';

const TELAS = [
  { img: '01-inicio', olho: 'Na rodovia', tit: 'O KM certo,<br>em cada foto.', sub: 'Rodovia, KM e estaca pelo GPS, na hora.' },
  { img: '10-camera', olho: 'Câmera', tit: 'A legenda vai<br>gravada na foto.', sub: 'Rodovia, KM, lado, estaca, contrato e data.' },
  { img: '20-carro-dia', olho: 'Modo Carro', tit: 'Acompanhe o KM<br>dirigindo.', sub: 'Painel grande, que escurece à noite.' },
  { img: '33-importar-configurar', olho: 'Qualquer rodovia', tit: 'Federal, estadual<br>ou municipal.', sub: 'Baixe do SNV ou importe KMZ, Shapefile e planilha.' },
  { img: '13-galeria', olho: 'Galeria', tit: 'Suas fotos,<br>organizadas.', sub: 'Nome do arquivo com rodovia, KM e data.' },
  { img: '40-consulta', olho: 'Consulta', menor: true, tit: 'Coordenada em KM<br>e KM em coordenada.', sub: 'Cole a lista do Excel e copie o resultado.' },
];
const ESCURAS = new Set(['10-camera', '13-galeria']);

/* barra de status do iPhone: hora à esquerda; sinal, Wi-Fi e bateria à direita; Dynamic Island no meio */
const ICONES = `<svg viewBox="0 0 78 18" width="78" height="18" fill="currentColor">
  <path d="M1 16h3.4v-4H1zM6.4 16h3.4V9.5H6.4zM11.8 16h3.4V7h-3.4zM17.2 16h3.4V4h-3.4z"/>
  <path d="M35 15.6l-2.4-2.8a3.6 3.6 0 0 1 4.8 0zM29.6 10.4l1.6 1.9a6 6 0 0 1 7.6 0l1.6-1.9a8.5 8.5 0 0 0-10.8 0zM26.6 6.9l1.6 1.9a10.4 10.4 0 0 1 13.6 0l1.6-1.9a13 13 0 0 0-16.8 0z"/>
  <rect x="50" y="3.5" width="24" height="11" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".45"/><rect x="52" y="5.5" width="17" height="7" rx="2"/><rect x="75" y="7" width="2" height="4" rx="1" opacity=".45"/></svg>`;
const barra = esc => `<div class="sb${esc ? ' esc' : ''}"><span>9:41</span><span class="ilha"></span>${ICONES}</div>`;
const celular = (img, esc) => `<div class="cel"><div class="scr"><img src="${img}">${barra(esc)}<i class="inicio${esc ? ' esc' : ''}"></i></div></div>`;

const CSS = `*{box-sizing:border-box}html,body{margin:0}
body{font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#1c2333}
.tela{position:relative;width:1290px;height:2796px;overflow:hidden;background:url(${FUNDO}) 70% 0/auto 100% no-repeat,#eef0f1}
.tela::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(244,245,244,.93) 0%,rgba(244,245,244,.78) 28%,rgba(244,245,244,0) 52%)}
.txt{position:absolute;left:100px;right:100px;top:190px;z-index:2}
.olho{font:800 38px Inter;letter-spacing:.24em;text-transform:uppercase;color:#6f8a0e}
h1{font:900 116px/1 Inter;letter-spacing:-.045em;margin:28px 0 0}
h1.menor{font-size:98px}
p{font:500 46px/1.35 Inter;color:#3b4559;margin:32px 0 0;max-width:24em}
/* iPhone: moldura de titânio, cantos bem arredondados */
.cel{position:absolute;left:50%;top:880px;width:820px;transform:translateX(-50%);padding:22px;border-radius:132px;z-index:2;
  background:linear-gradient(150deg,#8d9096 0%,#3b3e43 10%,#16171a 30%,#0b0c0d 70%,#4a4d52 100%);
  box-shadow:inset 0 0 0 3px rgba(255,255,255,.18),0 0 0 3px #1b1c1e,0 120px 180px -60px rgba(20,26,36,.75),0 40px 80px -40px rgba(20,26,36,.5)}
.cel::before{content:'';position:absolute;right:-8px;top:420px;width:8px;height:190px;border-radius:0 6px 6px 0;background:#2a2c30}
.cel::after{content:'';position:absolute;left:-8px;top:330px;width:8px;height:120px;border-radius:6px 0 0 6px;background:#2a2c30;box-shadow:0 160px 0 #2a2c30}
.scr{position:relative;border-radius:112px;overflow:hidden;aspect-ratio:430/932;background:#0b0c0d}
.scr img{display:block;width:100%;height:100%;object-fit:cover}
.sb{position:absolute;left:0;right:0;top:0;height:6.4%;display:flex;align-items:center;justify-content:space-between;padding:0 9% 0 11%;
  font:600 34px -apple-system,Inter,sans-serif;letter-spacing:-.01em;color:#111;z-index:2}
.sb svg{width:116px;height:27px}
.sb.esc{color:#fff}
.ilha{position:absolute;left:50%;top:26%;width:240px;height:70px;transform:translateX(-50%);border-radius:40px;background:#000}
.inicio{position:absolute;left:50%;bottom:16px;width:270px;height:10px;transform:translateX(-50%);border-radius:10px;background:rgba(20,22,24,.7);z-index:2}
.inicio.esc{background:rgba(255,255,255,.85)}`;

const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1290, height: 2796, deviceScaleFactor: 1 });
for (const [i, t] of TELAS.entries()) {
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTES}<style>${CSS}</style></head><body>
    <section class="tela"><div class="txt"><div class="olho">${t.olho}</div><h1${t.menor ? ' class="menor"' : ''}>${t.tit}</h1><p>${t.sub}</p></div>
    ${celular(PR(t.img), ESCURAS.has(t.img))}</section></body></html>`, { waitUntil: 'load' });
  await p.evaluateHandle('document.fonts.ready'); await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: path.join(SAIDA, `tela-${i + 1}.png`), clip: { x: 0, y: 0, width: 1290, height: 2796 } });
}
await b.close();
console.log('capturas da App Store em mobile/loja/ios/');
