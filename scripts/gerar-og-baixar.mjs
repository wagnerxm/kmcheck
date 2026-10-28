/* Imagem do cartão de link (WhatsApp, redes) da página kmcheck.com.br/baixar: baixar/og.jpg, 1200x630 (JPEG: o WhatsApp às vezes ignora imagem acima de ~300 KB).
 * Fundo claro do manual, logo + placa de marco + "O KM certo, em cada foto.", selos das duas lojas e dois celulares (tela inicial na frente, câmera atrás).
 * Os selos são só desenho: no WhatsApp o cartão inteiro é um link só, e a página /baixar manda cada celular para a sua loja.
 * Uso: node scripts/gerar-og-baixar.mjs   (precisa do puppeteer e do Chrome instalado, como o estúdio do manual) */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const d = (f, t) => `data:${t};base64,` + fs.readFileSync(path.resolve(f)).toString('base64');
const LOGO = d('logo-kmcheck.png', 'image/png');
const CAM = d('manual-kmcheck/prints/10-camera.png', 'image/png');
const INI = d('manual-kmcheck/prints/01-inicio.png', 'image/png');
const FUNDO = d('manual-kmcheck/estudio/fundo-manual.webp', 'image/webp');
const placa = `<svg width="128" height="152" viewBox="0 0 150 178" style="filter:drop-shadow(0 18px 28px rgba(0,0,0,.45))"><rect x="2" y="2" width="146" height="174" rx="14" fill="#fff"/><rect x="10" y="10" width="130" height="158" rx="9" fill="#13305c"/><rect x="10" y="10" width="130" height="70" rx="9" fill="#fff" fill-opacity=".05"/><text x="75" y="52" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="31" fill="#fff">BR-226</text><line x1="24" y1="68" x2="126" y2="68" stroke="#fff" stroke-width="3"/><text x="75" y="110" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="34" fill="#fff">KM</text><text x="75" y="156" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="42" fill="#fff">082</text></svg>`;
const APPLE = 'M16.37 12.7c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.83-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52zM14.2 6.24c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.68.97.08 1.96-.49 2.56-1.23z';
const PLAY = 'M4.2 2.5 13.6 12l-9.4 9.5c-.34-.2-.6-.6-.6-1.1V3.6c0-.5.26-.9.6-1.1zm10.6 10.7 2.3 2.3-10.7 6.1 8.4-8.4zm3.6-3.4 2.6 1.5c.7.4.7 1.4 0 1.8l-2.6 1.5-2.5-2.6 2.5-2.2zM6.4 2.4l10.7 6.1-2.3 2.3-8.4-8.4z';

const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
// 'load' + fonts.ready: com data URIs grandes o networkidle0 estoura o tempo
await p.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;800;900&display=swap"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden;position:relative;font-family:Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased;background:url(${FUNDO}) center/cover,#eef0f1}
  /* véu claro: esconde a logo que vem na arte de fundo (topo) e deixa o texto da esquerda legível */
  .veu{position:absolute;inset:0;background:linear-gradient(180deg,rgba(238,240,241,1) 0,rgba(238,240,241,1) 10%,rgba(238,240,241,0) 22%),linear-gradient(90deg,rgba(238,240,241,.96) 0%,rgba(238,240,241,.88) 46%,rgba(238,240,241,.2) 78%)}
  .brilho{position:absolute;right:0;top:-40px;width:560px;height:720px;background:radial-gradient(50% 50% at 50% 50%,rgba(196,226,74,.32),transparent 70%)}
  .txt{position:absolute;left:64px;top:56px;width:600px}
  .txt img{height:74px}
  .lin{display:flex;align-items:center;gap:26px;margin-top:30px}
  h1{font:900 54px/1.04 Inter;letter-spacing:-.04em;color:#14161a}
  /* o "KM" no verde-lima do app (--gold do tema escuro); a sombra leve segura a leitura no fundo claro */
  h1 em{font-style:normal;color:#b7d92d;text-shadow:0 1px 0 rgba(60,80,0,.35),0 4px 14px rgba(120,160,20,.25)}
  p{margin-top:16px;font:500 21px/1.45 Inter;color:#3b4559;max-width:520px}
  .lojas{position:absolute;left:64px;bottom:52px;display:flex;align-items:center;gap:14px}
  .loja{display:flex;align-items:center;gap:11px;padding:10px 20px 10px 15px;border-radius:14px;background:linear-gradient(168deg,#30333a,#111214);color:#fff;border:1px solid rgba(183,217,45,.4);box-shadow:0 14px 26px -14px rgba(0,0,0,.6)}
  .loja svg{width:30px;height:30px;fill:#fff}
  .loja small{display:block;font:500 12px Inter;color:#c9ced6}
  .loja b{display:block;font:800 20px/1.1 Inter;letter-spacing:-.01em}
  .gratis{font:800 16px Inter;color:#3b4559;margin-left:6px;display:flex;align-items:center;gap:8px}
  .gratis i{width:9px;height:9px;border-radius:50%;background:#b7d92d;box-shadow:0 0 10px rgba(183,217,45,.9)}
  .fone{position:absolute;border-radius:46px;background:#050607;padding:11px;box-shadow:0 40px 70px -20px rgba(0,0,0,.7),0 0 0 1.5px rgba(255,255,255,.14),inset 0 0 0 1px rgba(255,255,255,.06)}
  .fone img{display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:36px}
  .fone::after{content:'';position:absolute;top:22px;left:50%;width:92px;height:26px;margin-left:-46px;border-radius:14px;background:#000}
  .f1{width:262px;height:566px;right:60px;top:34px;z-index:2}
  .f2{width:240px;height:519px;right:282px;top:70px;transform:rotate(-7deg);z-index:1}
  .f2::before{content:'';position:absolute;inset:0;border-radius:46px;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.28));z-index:3}
</style></head><body><div class="veu"></div><div class="brilho"></div>
  <div class="txt"><img src="${LOGO}"><div class="lin">${placa}<h1>O <em>KM</em> certo,<br>em cada<br>foto.</h1></div><p>Rodovia, KM e estaca pelo GPS, com a base oficial do SNV. Até sem internet.</p></div>
  <div class="lojas">
    <div class="loja"><svg viewBox="0 0 24 24"><path d="${APPLE}"/></svg><span><small>Baixe na</small><b>App Store</b></span></div>
    <div class="loja"><svg viewBox="0 0 24 24"><path d="${PLAY}"/></svg><span><small>Disponível no</small><b>Google Play</b></span></div>
    <div class="gratis"><i></i>Grátis</div>
  </div>
  <div class="fone f2"><img src="${CAM}"></div><div class="fone f1"><img src="${INI}"></div>
</body></html>`, { waitUntil: 'load', timeout: 90000 });
await p.evaluateHandle('document.fonts.ready');
await new Promise(r => setTimeout(r, 600));
await p.screenshot({ path: path.resolve('baixar/og.jpg'), type: 'jpeg', quality: 86 });
await b.close();
console.log('baixar/og.jpg', fs.statSync('baixar/og.jpg').size, 'bytes');
