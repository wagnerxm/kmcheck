/* Vídeo curto de divulgação do KM Check (vertical 1080x1920, 30 fps, 44 s), montado com as MESMAS telas do manual
 * (manual-kmcheck/prints) e a foto de campo com legenda, no tema claro do manual. As cenas são HTML: a função
 * render(t) da página deixa tudo na posição do instante t (nada depende do relógio), o puppeteer fotografa quadro a
 * quadro e o ffmpeg junta os quadros com a trilha (gerar-trilha.mjs → trilha.wav).
 * Uso:  node manual-kmcheck/estudio/video/gerar-video.mjs            → km-check-divulgacao.mp4 (nesta pasta)
 *       node manual-kmcheck/estudio/video/gerar-video.mjs stills     → só quadros de conferência em _previa/video-*.jpg
 * Precisa do Chrome, do puppeteer (como o estúdio) e do ffmpeg (winget Gyan.FFmpeg). */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');
const FPS = 30, DUR = 44, W = 1080, H = 1920;
const d = (f, t) => `data:${t};base64,` + fs.readFileSync(path.join(RAIZ, f)).toString('base64');
const print = n => d(`manual-kmcheck/prints/${n}.png`, 'image/png');
const IMG = {
  logo: d('logo-kmcheck.png', 'image/png'),
  fundo: d('manual-kmcheck/estudio/fundo-manual.webp', 'image/webp'),
  foto: d('manual-kmcheck/estudio/foto-campo-nova.webp', 'image/webp'),
  inicio: print('01-inicio'), carro: print('20-carro-dia'), eixo: print('30-gestao-eixo'), importar: print('31-importar'),
  camera: print('10-camera'), galeria: print('13-galeria'),
  qr: d('baixar/qr.svg', 'image/svg+xml'),
};
const LEGENDA = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manual-kmcheck/estudio/legenda.json'), 'utf8')).caixas;
const APPLE = 'M16.37 12.7c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.83-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52zM14.2 6.24c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.68.97.08 1.96-.49 2.56-1.23z';
const PLAY = 'M4.2 2.5 13.6 12l-9.4 9.5c-.34-.2-.6-.6-.6-1.1V3.6c0-.5.26-.9.6-1.1zm10.6 10.7 2.3 2.3-10.7 6.1 8.4-8.4zm3.6-3.4 2.6 1.5c.7.4.7 1.4 0 1.8l-2.6 1.5-2.5-2.6 2.5-2.2zM6.4 2.4l10.7 6.1-2.3 2.3-8.4-8.4z';

// mockup de iPhone inteiro na tela: moldura preta, Ilha Dinâmica, botões laterais (silencioso, volume, lateral)
const fone = (id, a, b) => `<div class="fone" id="${id}"><b class="bt mudo"></b><b class="bt vol1"></b><b class="bt vol2"></b><b class="bt lado"></b>
  <img class="tela ta" src="${a}">${b ? `<img class="tela tb" src="${b}">` : ''}<div class="extra"></div><i class="ilha"></i></div>`;
const loja = (p, s, n) => `<div class="loja"><svg viewBox="0 0 24 24"><path d="${p}"/></svg><span><small>${s}</small><b>${n}</b></span></div>`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#14161a;
  background:url(${IMG.fundo}) center/cover,#eef0f1}
/* véu claro do manual: deixa a estrada do fundo sutil e o texto legível */
#veu{position:absolute;inset:0;background:linear-gradient(180deg,rgba(238,240,241,.97) 0%,rgba(238,240,241,.9) 30%,rgba(238,240,241,.6) 62%,rgba(238,240,241,.9) 100%)}
#brilho{position:absolute;left:50%;top:900px;width:1400px;height:1400px;margin-left:-700px;background:radial-gradient(50% 50% at 50% 50%,rgba(196,226,74,.28),transparent 70%)}
#fio{position:absolute;inset:0}
.cena{position:absolute;inset:0;display:none}
.txt{position:absolute;left:80px;right:80px;top:150px}
.txt .logo{height:112px;margin-bottom:34px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.18))}
h1{font:900 82px/1.04 Inter;letter-spacing:-.04em;color:#14161a}
h1 em{font-style:normal;color:#6f9a0e}
.sub{margin-top:20px;font:500 36px/1.35 Inter;color:#3b4559}
.pal{display:inline-block;will-change:transform}
/* iPhone: 560 px de largura, inteiro na tela (fica entre o texto e a borda de baixo) */
.fone{position:absolute;left:50%;top:600px;width:560px;height:1232px;margin-left:-280px;border-radius:84px;background:#0b0c0e;padding:14px;
  box-shadow:0 70px 120px -40px rgba(20,22,26,.55),0 0 0 2px #2a2c30,inset 0 0 0 2px rgba(255,255,255,.08)}
.fone .bt{position:absolute;width:6px;background:#2a2c30;border-radius:3px}
.fone .mudo{left:-6px;top:230px;height:48px}.fone .vol1{left:-6px;top:320px;height:92px}.fone .vol2{left:-6px;top:432px;height:92px}.fone .lado{right:-6px;top:360px;height:140px}
.fone .ilha{position:absolute;top:34px;left:50%;width:128px;height:38px;margin-left:-64px;border-radius:22px;background:#000;z-index:5}
.tela{position:absolute;left:14px;top:14px;width:532px;height:1204px;object-fit:cover;object-position:top;border-radius:70px}
.extra{position:absolute;left:14px;top:14px;width:532px;height:1204px;border-radius:70px;overflow:hidden;pointer-events:none}
.flash{position:absolute;inset:0;background:#fff;opacity:0}
.pulso{position:absolute;border:4px solid #b7d92d;border-radius:999px;box-shadow:0 0 30px rgba(183,217,45,.8)}
.contador{position:absolute;left:12%;right:12%;top:37.6%;height:9.2%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#1f2226,#17191c);font:800 126px/1 Inter;letter-spacing:-.035em;color:#fff;text-shadow:0 4px 14px rgba(0,0,0,.4)}
.foto{position:absolute;left:50px;top:620px;width:980px;height:551px;border-radius:30px;overflow:hidden;box-shadow:0 50px 90px -30px rgba(20,22,26,.5),0 0 0 2px rgba(20,22,26,.12)}
.foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 60%}
.caixa{position:absolute;background:rgba(0,0,0,.58);color:#fff;font:700 24px/1 Arial,Helvetica,sans-serif;display:flex;align-items:center;padding-left:8px;white-space:pre;overflow:hidden}
.cursor{display:inline-block;width:3px;height:22px;background:#fff;margin-left:2px}
.chip{position:absolute;display:inline-flex;align-items:center;gap:14px;padding:18px 30px;border-radius:999px;background:#b7d92d;color:#111;font:800 34px Inter;box-shadow:0 20px 40px -16px rgba(140,170,20,.7)}
.itens{position:absolute;left:80px;right:80px;top:1400px;display:flex;flex-wrap:wrap;gap:16px}
.item{padding:16px 26px;border-radius:999px;border:2px solid rgba(20,22,26,.16);font:700 30px Inter;color:#14161a;background:rgba(255,255,255,.7)}
.sel{position:absolute;border:5px solid #b7d92d;border-radius:28px;box-shadow:0 0 0 6px rgba(183,217,45,.25),0 0 40px rgba(183,217,45,.6)}
/* encerramento */
.fim{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;text-align:center}
.fim img.logo{width:560px;margin-top:300px;filter:drop-shadow(0 10px 24px rgba(0,0,0,.18))}
.fim h2{margin-top:60px;font:900 78px/1.05 Inter;letter-spacing:-.04em;color:#14161a}
.fim .gratis{margin-top:40px;display:inline-flex;align-items:center;gap:16px;padding:20px 36px;border-radius:999px;background:linear-gradient(168deg,#30333a,#15171b);border:2px solid rgba(183,217,45,.45);font:800 40px Inter;color:#fff}
.fim .gratis i{width:18px;height:18px;border-radius:50%;background:#c4e24a;box-shadow:0 0 18px rgba(196,226,74,.9)}
.lojas{margin-top:60px;display:flex;gap:24px}
.loja{display:flex;align-items:center;gap:16px;padding:18px 34px 18px 26px;border-radius:24px;background:linear-gradient(168deg,#30333a,#111214);border:2px solid rgba(183,217,45,.4);box-shadow:0 20px 40px -18px rgba(0,0,0,.6);color:#fff}
.loja svg{width:52px;height:52px;fill:#fff}.loja small{display:block;font:500 22px Inter;color:#c9ced6}.loja b{display:block;font:800 36px/1.1 Inter;letter-spacing:-.01em}
.link{margin-top:70px;font:900 64px Inter;letter-spacing:-.03em;color:#14161a}
.link small{display:block;font:500 32px Inter;color:#3b4559;margin-bottom:12px;letter-spacing:0}
.qr{margin-top:46px;width:220px;height:220px;background:#fff;border-radius:24px;padding:16px;box-shadow:0 20px 40px -24px rgba(20,22,26,.5),0 0 0 1px rgba(20,22,26,.1)}.qr img{width:100%;height:100%}
</style></head><body><div id="veu"></div><div id="brilho"></div>
<svg id="fio" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#9cc21a" stop-opacity="0"/><stop offset=".5" stop-color="#9cc21a" stop-opacity=".8"/><stop offset="1" stop-color="#b7d92d" stop-opacity="0"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="8"/></filter></defs>
<path id="fioA" d="M-50,1500 C300,1560 600,1250 1130,1050" fill="none" stroke="url(#g)" stroke-width="14" opacity=".4" filter="url(#b)"/><path id="fioB" d="M-50,1500 C300,1560 600,1250 1130,1050" fill="none" stroke="url(#g)" stroke-width="3"/></svg>

<div class="cena" id="s1"><div class="txt"><img class="logo" id="logo1" src="${IMG.logo}">
  <h1 id="h1a"><span class="pal">O</span> <span class="pal">KM</span> <span class="pal">certo,</span><br><span class="pal">em</span> <span class="pal">cada</span> <span class="pal">foto.</span></h1>
  <div class="sub" id="sub1">Registro fotográfico de rodovias, com o KM pelo GPS e a base oficial do SNV.</div></div>${fone('f1', IMG.inicio)}</div>

<div class="cena" id="s2"><div class="txt"><h1>Cadastre a rodovia<br><em>uma vez</em>.</h1><div class="sub">UF, BR e versão do SNV. Depois funciona sem internet, no meio do campo.</div></div>${fone('f2', IMG.eixo, IMG.importar)}</div>

<div class="cena" id="s3"><div class="txt"><h1>A legenda vai <em>gravada</em><br>na foto.</h1><div class="sub">Rodovia, KM, estaca, lado, coordenadas e data, na própria imagem.</div></div>
  <div class="foto"><img id="foto3" src="${IMG.foto}">${LEGENDA.map((c, i) => `<div class="caixa" id="cx${i}" style="left:${c.box[0]}%;top:${c.box[1]}%;width:${c.box[2]}%;height:${c.box[3]}%"></div>`).join('')}</div>
  <div class="chip" id="chip3" style="left:50%;top:1250px;transform:translateX(-50%)">✓&nbsp; Gravado na imagem, sem edição depois</div>
  <div class="itens" id="itens3"><span class="item">Rodovia</span><span class="item">KM</span><span class="item">Estaca</span><span class="item">Lado</span><span class="item">Coordenadas</span><span class="item">Data e hora</span><span class="item">Serviço e contrato</span></div></div>

<div class="cena" id="s4"><div class="txt"><h1>O KM acompanha<br>o <em>carro</em>.</h1><div class="sub">Pelo GPS, com a base oficial do SNV/DNIT. Modo Carro para ver de longe.</div></div>${fone('f4', IMG.carro)}</div>

<div class="cena" id="s5"><div class="txt"><h1>Fotografou,<br>tá <em>documentado</em>.</h1><div class="sub">Salva na galeria com a legenda, organizada por rodovia e KM.</div></div>${fone('f5', IMG.camera, IMG.galeria)}</div>

<div class="cena" id="s6"><div class="fim"><img class="logo" id="logo6" src="${IMG.logo}"><h2 id="h6">Chega de anotar o KM.<br><span style="color:#6f9a0e">Fotografe!</span></h2>
  <div class="gratis" id="g6"><i></i>Grátis · iPhone e Android</div>
  <div class="lojas" id="l6">${loja(APPLE, 'Baixe na', 'App Store')}${loja(PLAY, 'Disponível no', 'Google Play')}</div>
  <div class="link" id="k6"><small>Baixe agora em</small>kmcheck.com.br/baixar</div>
  <div class="qr" id="q6"><img src="${IMG.qr}"></div></div></div>

<script>
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const cl = x => Math.max(0, Math.min(1, x));
const ez = x => 1 - Math.pow(1 - cl(x), 3);                 // ease-out cúbico
const ezi = x => { x = cl(x); return x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2; };
const fase = (t, a, b) => cl((t - a) / (b - a));
const CENAS = [[0,7],[7,15],[15,23],[23,30],[30,38],[38,44]];
const LEG = ${JSON.stringify(LEGENDA.map(c => c.texto))};
const kmTxt = m => Math.floor(m/1000) + ',' + String(Math.round(m) % 1000).padStart(3,'0');

// entrada padrão de uma cena: aparece em 0,6 s; sai esmaecendo nos últimos 0,4 s
function cena(el, t, a, b) {
  const vis = t >= a - 0.05 && t < b;
  el.style.display = vis ? 'block' : 'none';
  if (!vis) return null;
  const entra = ez(fase(t, a, a + 0.6)), sai = 1 - fase(t, b - 0.4, b);
  el.style.opacity = Math.min(entra, sai);
  return t - a;
}
function sobe(el, p, dist = 90) { el.style.transform = 'translateY(' + ((1 - ez(p)) * dist) + 'px)'; el.style.opacity = ez(p); }
function foneEntra(f, u, ini = 0.15) { f.style.transform = 'translateY(' + ((1 - ez(fase(u, ini, ini + 0.8))) * 160) + 'px)'; f.style.opacity = ez(fase(u, ini, ini + 0.65)); }
function cruza(f, u, a, b) { f.querySelector('.tb').style.opacity = ez(fase(u, a, b)); }
function pulso(f, u, ini, l, t_, w, h) {            // anel de destaque pulsando em volta de um botão (em % da tela do celular)
  const ex = f.querySelector('.extra'); let p = ex.querySelector('.pulso');
  if (!p) { p = document.createElement('div'); p.className = 'pulso'; ex.appendChild(p); }
  if (u < ini) { p.style.opacity = 0; return; }
  const c = ((u - ini) % 1.1) / 1.1;
  p.style.left = l + '%'; p.style.top = t_ + '%'; p.style.width = w + '%'; p.style.height = h + '%';
  p.style.transform = 'scale(' + (1 + 0.12 * c) + ')'; p.style.opacity = 1 - c;
}

window.render = function (t) {
  for (const id of ['fioA', 'fioB']) { const p = $('#' + id); const L = p.getTotalLength(); p.style.strokeDasharray = (L * 0.55) + ' ' + L; p.style.strokeDashoffset = L * 1.2 - (t / 44) * L * 2.2; }

  let u;
  // 1 — abertura: logo, frase e a tela inicial do app
  if ((u = cena($('#s1'), t, ...CENAS[0])) !== null) {
    const l = $('#logo1'); const p = ez(fase(u, 0, 0.8)); l.style.opacity = p; l.style.transform = 'translateY(' + ((1 - p) * 30) + 'px)';
    $$('#h1a .pal').forEach((w, i) => sobe(w, fase(u, 0.6 + i * 0.14, 1.1 + i * 0.14), 50));
    sobe($('#sub1'), fase(u, 1.8, 2.4), 30);
    foneEntra($('#f1'), u, 1.2);
  }
  // 2 — cadastro da rodovia: Gestão de Eixo → Baixar rodovia
  if ((u = cena($('#s2'), t, ...CENAS[1])) !== null) {
    sobe($('#s2 .txt'), fase(u, 0, 0.7)); const f = $('#f2'); foneEntra(f, u); cruza(f, u, 3.2, 3.8);
    pulso(f, u, 4.4, 10.5, 37.2, 79, 6.2);
  }
  // 3 — foto com a legenda sendo escrita
  if ((u = cena($('#s3'), t, ...CENAS[2])) !== null) {
    sobe($('#s3 .txt'), fase(u, 0, 0.7));
    $('#foto3').style.transform = 'scale(' + (1 + 0.07 * (u / 8)) + ')';
    $('#s3 .foto').style.transform = 'translateY(' + ((1 - ez(fase(u, 0.1, 0.9))) * 120) + 'px)';
    LEG.forEach((txt, i) => {
      const a = 1.2 + i * 1.25, p = fase(u, a, a + 0.9), n = Math.floor(p * txt.length);
      const c = $('#cx' + i); c.style.opacity = u >= a ? 1 : 0;
      c.innerHTML = txt.slice(0, n) + (u >= a && p < 1 ? '<span class="cursor"></span>' : '');
    });
    const ch = $('#chip3'); const pc = ez(fase(u, 6.3, 6.9)); ch.style.opacity = pc; ch.style.transform = 'translateX(-50%) scale(' + (0.7 + 0.3 * pc) + ')';
    $$('#itens3 .item').forEach((it, i) => sobe(it, fase(u, 1.0 + i * 0.6, 1.5 + i * 0.6), 24));   // acompanham a legenda sendo escrita
  }
  // 5 — Modo Carro com o KM subindo
  if ((u = cena($('#s4'), t, ...CENAS[4])) !== null) {
    sobe($('#s4 .txt'), fase(u, 0, 0.7)); const f = $('#f4'); foneEntra(f, u);
    const ex = f.querySelector('.extra'); let c = ex.querySelector('.contador');
    if (!c) { c = document.createElement('div'); c.className = 'contador'; ex.appendChild(c); }
    c.textContent = kmTxt(82360 + Math.round(ezi(fase(u, 1.0, 7.6)) * 56) * 10);   // 82,360 → 82,920 em passos de 10 m
  }
  // 4 — câmera: clique, flash e a foto na galeria
  if ((u = cena($('#s5'), t, ...CENAS[3])) !== null) {
    sobe($('#s5 .txt'), fase(u, 0, 0.7)); const f = $('#f5'); foneEntra(f, u);
    const ex = f.querySelector('.extra'); let fl = ex.querySelector('.flash');
    if (!fl) { fl = document.createElement('div'); fl.className = 'flash'; ex.appendChild(fl); }
    fl.style.opacity = u >= 2.6 ? 1 - ez(fase(u, 2.6, 2.95)) : 0;
    f.querySelector('.ta').style.transform = 'scale(' + (u >= 2.6 && u < 3.0 ? 1 - 0.03 * Math.sin(fase(u, 2.6, 3.0) * Math.PI) : 1) + ')';
    cruza(f, u, 3.8, 4.4);
    let s = ex.querySelector('.sel'); if (!s) { s = document.createElement('div'); s.className = 'sel'; s.style.cssText = 'left:2.6%;top:29.6%;width:31%;height:10.9%'; ex.appendChild(s); }
    s.style.opacity = ez(fase(u, 4.8, 5.3)) * (1 - fase(u, 6.6, 7));
  }
  // 6 — encerramento
  if ((u = cena($('#s6'), t, ...CENAS[5])) !== null) {
    const l = $('#logo6'); const p = ez(fase(u, 0, 0.8)); l.style.opacity = p; l.style.transform = 'scale(' + (0.85 + 0.15 * p) + ')';
    sobe($('#h6'), fase(u, 0.5, 1.1), 40); sobe($('#g6'), fase(u, 1.0, 1.5), 30); sobe($('#l6'), fase(u, 1.4, 1.9), 30);
    sobe($('#k6'), fase(u, 1.9, 2.4), 30); sobe($('#q6'), fase(u, 2.3, 2.8), 30);
  }
};
</script></body></html>`;

const soStills = process.argv[2] === 'stills';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--hide-scrollbars'] });
const p = await b.newPage();
await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await p.setContent(HTML, { waitUntil: 'load', timeout: 120000 });
// as cenas começam escondidas (display:none), então fonts.ready não garante os pesos da Inter: força o carregamento
await p.evaluate(() => Promise.all(['500 38px Inter', '700 30px Inter', '800 40px Inter', '900 96px Inter'].map(f => document.fonts.load(f))));
await p.evaluateHandle('document.fonts.ready');
await p.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));

if (soStills) {
  const dir = path.join(RAIZ, '_previa'); fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('video-')) fs.unlinkSync(path.join(dir, f));
  for (const t of [4, 12.5, 20.5, 26.5, 34, 42]) {
    await p.evaluate(t => render(t), t);
    await p.screenshot({ path: path.join(dir, `video-${String(t).replace('.', '_')}.jpg`), type: 'jpeg', quality: 90 });
  }
  await b.close(); console.log('stills em _previa/'); process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcheck-video-'));
const total = FPS * DUR; const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await p.evaluate(t => render(t), i / FPS);
  await p.screenshot({ path: path.join(tmp, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  if (i % 150 === 0) console.log(`quadro ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
await b.close();

const ffmpeg = process.env.FFMPEG || [...fs.readdirSync(path.join(os.homedir(), 'AppData/Local/Microsoft/WinGet/Packages'))]
  .filter(n => n.startsWith('Gyan.FFmpeg')).map(n => path.join(os.homedir(), 'AppData/Local/Microsoft/WinGet/Packages', n))
  .flatMap(dir => fs.readdirSync(dir).map(s => path.join(dir, s, 'bin/ffmpeg.exe'))).find(f => fs.existsSync(f));
const out = path.join(AQUI, 'km-check-divulgacao.mp4');
execFileSync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', path.join(tmp, 'f%05d.jpg'), '-i', path.join(AQUI, 'trilha.wav'),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: ['ignore', 'inherit', 'inherit'] });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out, (fs.statSync(out).size / 1048576).toFixed(1), 'MB');
