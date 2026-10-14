/* Material da página do KM Check na Google Play, no visual da capa do manual:
 *   icone-512.png         ícone da loja (512×512)
 *   destaque-1024x500.png imagem de destaque (logo + frase + celular com a câmera do app)
 *   tela-1..6.png         capturas 1080×1920 (9:16): frase + celular com a tela real do app
 * O celular é um Android (moldura fina, câmera em furo no topo, barra de status do Android): a Google
 * pede que as imagens mostrem a experiência no Android, e a versão antiga usava moldura de iPhone.
 * As telas vêm de manual-kmcheck/prints-android (KC_ANDROID=1 node manual-kmcheck/estudio/capturar.mjs …).
 * Uso: node mobile/loja/gerar-loja.mjs (a partir da raiz do projeto) */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve('.'), SAIDA = path.resolve('mobile/loja');
const b64 = (f, t = 'png') => `data:image/${t};base64,` + fs.readFileSync(f).toString('base64');
const FUNDO = b64('manual-kmcheck/estudio/fundo-manual.webp', 'webp');
const LOGO = b64('logo-kmcheck.png');
const PR = n => b64(`manual-kmcheck/prints-android/${n}.png`);
const FONTES = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap">';

const TELAS = [
  { img: '01-inicio', olho: 'Na rodovia', tit: 'O KM certo,<br>em cada foto.', sub: 'Rodovia, KM e estaca pelo GPS, na hora.' },
  { img: '10-camera', olho: 'Câmera', tit: 'A legenda vai<br>gravada na foto.', sub: 'Rodovia, KM, lado, estaca, contrato e data.' },
  { img: '20-carro-dia', olho: 'Modo Carro', tit: 'Acompanhe o KM<br>dirigindo.', sub: 'Painel grande, que escurece à noite.' },
  { img: '33-importar-configurar', olho: 'Qualquer rodovia', tit: 'Federal, estadual<br>ou municipal.', sub: 'Baixe do SNV ou importe KMZ, Shapefile e planilha.' },
  { img: '13-galeria', olho: 'Galeria', tit: 'Suas fotos,<br>organizadas.', sub: 'Nome do arquivo com rodovia, KM e data.' },
  { img: '40-consulta', olho: 'Consulta', menor: true, tit: 'Coordenada em KM<br>e KM em coordenada.', sub: 'Cole a lista do Excel e copie o resultado.' },
];
/* telas de fundo escuro: barra de status com ícones claros */
const ESCURAS = new Set(['10-camera', '13-galeria']);

/* barra de status do Android: hora à esquerda; sinal, Wi-Fi e bateria à direita */
const ICONES = `<svg viewBox="0 0 70 18" width="70" height="18" fill="currentColor">
  <path d="M2 16h3V11H2zM7 16h3V8H7zM12 16h3V5h-3zM17 16h3V2h-3z"/>
  <path d="M34 15.5l-2.2-2.6a3.4 3.4 0 0 1 4.4 0zM29 10.6l1.5 1.8a5.6 5.6 0 0 1 7 0l1.5-1.8a8 8 0 0 0-10 0zM26.2 7.3l1.5 1.8a9.8 9.8 0 0 1 12.6 0l1.5-1.8a12.2 12.2 0 0 0-15.6 0z"/>
  <rect x="50" y="4" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="52" y="6" width="10" height="6" rx="1"/><rect x="66.5" y="7" width="2" height="4" rx="1"/></svg>`;
const barra = esc => `<div class="sb${esc ? ' esc' : ''}"><span>12:30</span><span class="furo"></span>${ICONES}</div>`;
const celular = (img, esc, cls = '') => `<div class="cel ${cls}"><div class="scr"><img src="${img}">${barra(esc)}<i class="gestos${esc ? ' esc' : ''}"></i></div></div>`;

const CSS = `*{box-sizing:border-box}html,body{margin:0}
body{font-family:Inter,Roboto,Helvetica,Arial,sans-serif;color:#1c2333}
.tela{position:relative;width:1080px;height:1920px;overflow:hidden;background:url(${FUNDO}) 70% 0/auto 100% no-repeat,#eef0f1}
.tela::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(244,245,244,.92) 0%,rgba(244,245,244,.75) 30%,rgba(244,245,244,0) 55%)}
.txt{position:absolute;left:84px;right:84px;top:120px;z-index:2}
.olho{font:800 30px Inter;letter-spacing:.24em;text-transform:uppercase;color:#6f8a0e}
h1{font:900 92px/1 Inter;letter-spacing:-.045em;margin:22px 0 0}
h1.menor{font-size:78px}   /* título longo: cabe em 2 linhas como os outros */
p{font:500 38px/1.35 Inter;color:#3b4559;margin:26px 0 0;max-width:20em}
/* celular Android: moldura fina e uniforme, cantos menos arredondados que os do iPhone */
.cel{position:absolute;left:50%;top:640px;width:600px;transform:translateX(-50%);padding:14px;border-radius:64px;z-index:2;
  background:linear-gradient(150deg,#3a3e44 0%,#121315 22%,#0a0b0c 70%,#26292d 100%);
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.12),0 0 0 2px #000,0 90px 140px -50px rgba(20,26,36,.75),0 30px 60px -30px rgba(20,26,36,.5)}
.cel::before{content:'';position:absolute;right:-6px;top:240px;width:6px;height:120px;border-radius:0 4px 4px 0;background:#1d1f22}
.scr{position:relative;border-radius:52px;overflow:hidden;aspect-ratio:412/915;background:#0b0c0d}
.scr img{display:block;width:100%;height:100%;object-fit:cover}
.sb{position:absolute;left:0;right:0;top:0;height:2.62%;display:flex;align-items:center;justify-content:space-between;padding:0 7%;
  font:600 22px Roboto,Inter,sans-serif;color:#1c1d1f;z-index:2}
.sb.esc{color:#fff}
.furo{position:absolute;left:50%;top:50%;width:26px;height:26px;transform:translate(-50%,-50%);border-radius:50%;background:#050505;box-shadow:0 0 0 2px #1a1b1d}
.gestos{position:absolute;left:50%;bottom:9px;width:150px;height:6px;transform:translateX(-50%);border-radius:6px;background:rgba(20,22,24,.55);z-index:2}
.gestos.esc{background:rgba(255,255,255,.75)}
/* destaque 1024×500 */
.dest{position:relative;width:1024px;height:500px;overflow:hidden;background:url(${FUNDO}) 0 100%/1024px auto no-repeat,#eef0f1}
.dest::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(244,245,244,.96) 0%,rgba(244,245,244,.86) 46%,rgba(244,245,244,.15) 72%,rgba(244,245,244,0) 100%)}
.dtxt{position:absolute;left:70px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center;z-index:2}
.dtxt img{width:190px;height:auto;margin-bottom:26px}
.dtxt h2{font:900 54px/1.02 Inter;letter-spacing:-.045em;margin:0}
.dtxt p{font:500 21px/1.4 Inter;color:#3b4559;margin:16px 0 0;max-width:24em}
.dest .cel{left:auto;right:90px;top:-150px;width:300px;transform:rotate(6deg);padding:8px;border-radius:34px}
.dest .cel::before{display:none}
.dest .scr{border-radius:27px}
.dest .sb{font-size:11px;padding:0 7%}.dest .sb svg{width:36px;height:9px}
.dest .furo{width:13px;height:13px}
.dest .gestos{width:76px;height:3px;bottom:5px}`;

const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
async function render(html, w, h, arq) {
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTES}<style>${CSS}</style></head><body>${html}</body></html>`, { waitUntil: 'load' });
  await p.evaluateHandle('document.fonts.ready'); await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: path.join(SAIDA, arq), clip: { x: 0, y: 0, width: w, height: h } });
}
for (const [i, t] of TELAS.entries()) {
  await render(`<section class="tela"><div class="txt"><div class="olho">${t.olho}</div><h1${t.menor ? ' class="menor"' : ''}>${t.tit}</h1><p>${t.sub}</p></div>
    ${celular(PR(t.img), ESCURAS.has(t.img))}</section>`, 1080, 1920, `tela-${i + 1}.png`);
}
/* destaque: logo + frase à esquerda (o miolo, que a Play nunca corta) e o celular com a câmera à direita */
await render(`<div class="dest"><div class="dtxt"><img src="${LOGO}" alt=""><h2>O KM certo,<br>em cada foto.</h2>
  <p>Rodovia, KM, estaca e coordenadas gravados na foto. Direto do campo, até sem internet.</p></div>
  ${celular(PR('10-camera'), true)}</div>`, 1024, 500, 'destaque-1024x500.png');
fs.copyFileSync(path.join(RAIZ, 'icon-512.png'), path.join(SAIDA, 'icone-512.png'));
await b.close();
console.log('material da loja em mobile/loja/');
