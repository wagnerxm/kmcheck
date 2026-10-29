/* Motor dos vídeos de divulgação: monta a página (1080x1920), fotografa quadro a quadro com o puppeteer e junta com o
 * áudio no ffmpeg. Cada conceito (conceito-a/b/c.mjs) traz o CSS, o HTML das cenas e a função render(t); aqui ficam o
 * mockup de iPhone, a tela de encerramento, os ajudantes de animação e a captura.
 * Tudo é determinístico: render(t) põe cada elemento na posição do instante t, nada depende do relógio. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '../../..');
export const W = 1080, H = 1920, FPS = 30;
export const BPM = 104, BEAT = 60 / BPM, T = b => b * BEAT;   // tempos em batidas → segundos (cortes caem na batida)

const d = (f, t) => `data:${t};base64,` + fs.readFileSync(path.join(RAIZ, f)).toString('base64');
const print = n => d(`manual-kmcheck/prints/${n}.png`, 'image/png');
export const IMG = {
  logo: d('logo-kmcheck.png', 'image/png'), fundo: d('manual-kmcheck/estudio/fundo-manual.webp', 'image/webp'),
  foto: d('manual-kmcheck/estudio/foto-campo-nova.webp', 'image/webp'), buraco: d('manual-kmcheck/estudio/foto-campo-tapaburaco.webp', 'image/webp'),
  rod: d('manual-kmcheck/estudio/foto-campo-rodovia.webp', 'image/webp'), qr: d('baixar/qr.svg', 'image/svg+xml'),
  inicio: print('01-inicio'), cam: print('10-camera'), gal: print('13-galeria'), galSel: print('14-galeria-selecao'), carro: print('20-carro-dia'),
  noite: print('21-carro-noite'), eixo: print('30-gestao-eixo'), imp: print('31-importar'), consulta: print('40-consulta'),
};
export const LEGENDA = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manual-kmcheck/estudio/legenda.json'), 'utf8')).caixas;
const APPLE = 'M16.37 12.7c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.83-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52zM14.2 6.24c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.68.97.08 1.96-.49 2.56-1.23z';
const PLAY = 'M4.2 2.5 13.6 12l-9.4 9.5c-.34-.2-.6-.6-.6-1.1V3.6c0-.5.26-.9.6-1.1zm10.6 10.7 2.3 2.3-10.7 6.1 8.4-8.4zm3.6-3.4 2.6 1.5c.7.4.7 1.4 0 1.8l-2.6 1.5-2.5-2.6 2.5-2.2zM6.4 2.4l10.7 6.1-2.3 2.3-8.4-8.4z';

/* mockup de iPhone: moldura, Ilha Dinâmica, botões laterais; .ta/.tb são duas telas para cruzar (crossfade) */
export const fone = (id, a, b, extra = '') => `<div class="fone" id="${id}"${extra}><b class="bt mudo"></b><b class="bt vol1"></b><b class="bt vol2"></b><b class="bt lado"></b>
  <img class="tela ta" src="${a}">${b ? `<img class="tela tb" src="${b}">` : ''}<div class="extra"></div><i class="ilha"></i></div>`;
export const loja = (p, s, n) => `<div class="loja"><svg viewBox="0 0 24 24"><path d="${p}"/></svg><span><small>${s}</small><b>${n}</b></span></div>`;
export const lojas = () => loja(APPLE, 'Baixe na', 'App Store') + loja(PLAY, 'Disponível no', 'Google Play');
/* legenda da foto: as 4 caixas na posição real (legenda.json), escritas letra a letra por escreve() */
export const caixasLegenda = pref => LEGENDA.map((c, i) => `<div class="caixa" id="${pref}${i}" style="left:${c.box[0]}%;top:${c.box[1]}%;width:${c.box[2]}%;height:${c.box[3]}%"></div>`).join('');
/* encerramento padrão (tema 'claro' ou 'escuro'): logo, frase, selo, lojas, link e QR */
export const encerramento = (id, tema) => `<div class="cena ${tema}" id="${id}"><div class="fim"><img class="logo" id="${id}-logo" src="${IMG.logo}">
  <h2 id="${id}-h2">Chega de anotar o KM.<br><em>Fotografe!</em></h2><div class="gratis" id="${id}-g"><i></i>Grátis · iPhone e Android</div>
  <div class="lojas" id="${id}-l">${lojas()}</div><div class="link" id="${id}-k"><small>Baixe agora em</small>kmcheck.com.br/baixar</div>
  <div class="qr" id="${id}-q"><img src="${IMG.qr}"></div></div></div>`;

export const CSS_BASE = `
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.cena{position:absolute;inset:0;display:none}
.pal{display:inline-block;will-change:transform}
.fone{position:absolute;width:560px;height:1232px;border-radius:84px;background:#0b0c0e;padding:14px;transform-style:preserve-3d;
  box-shadow:0 70px 120px -40px rgba(10,12,14,.6),0 0 0 2px #2a2c30,inset 0 0 0 2px rgba(255,255,255,.08)}
.fone .bt{position:absolute;width:6px;background:#2a2c30;border-radius:3px}
.fone .mudo{left:-6px;top:230px;height:48px}.fone .vol1{left:-6px;top:320px;height:92px}.fone .vol2{left:-6px;top:432px;height:92px}.fone .lado{right:-6px;top:360px;height:140px}
.fone .ilha{position:absolute;top:34px;left:50%;width:128px;height:38px;margin-left:-64px;border-radius:22px;background:#000;z-index:5}
.tela{position:absolute;left:14px;top:14px;width:532px;height:1204px;object-fit:cover;object-position:top;border-radius:70px}
.tb{opacity:0}
.extra{position:absolute;left:14px;top:14px;width:532px;height:1204px;border-radius:70px;overflow:hidden;pointer-events:none}
.flash{position:absolute;inset:0;background:#fff;opacity:0}
.flashTela{position:absolute;inset:0;background:#fff;opacity:0;z-index:50;pointer-events:none}
.pulso{position:absolute;border:4px solid #b7d92d;border-radius:999px;box-shadow:0 0 30px rgba(183,217,45,.8);opacity:0}
.sel{position:absolute;border:5px solid #b7d92d;border-radius:28px;box-shadow:0 0 0 6px rgba(183,217,45,.25),0 0 40px rgba(183,217,45,.6);opacity:0}
.contador{position:absolute;left:12%;right:12%;top:37.6%;height:9.2%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#1f2226,#17191c);font:800 126px/1 Inter;letter-spacing:-.035em;color:#fff;text-shadow:0 4px 14px rgba(0,0,0,.4)}
.caixa{position:absolute;background:rgba(0,0,0,.58);color:#fff;font:700 24px/1 Arial,Helvetica,sans-serif;display:flex;align-items:center;padding-left:8px;white-space:pre;overflow:hidden;opacity:0}
.cursor{display:inline-block;width:3px;height:22px;background:#fff;margin-left:2px}
.loja{display:flex;align-items:center;gap:16px;padding:18px 34px 18px 26px;border-radius:24px;background:linear-gradient(168deg,#30333a,#111214);border:2px solid rgba(183,217,45,.4);box-shadow:0 20px 40px -18px rgba(0,0,0,.6);color:#fff}
.loja svg{width:52px;height:52px;fill:#fff}.loja small{display:block;font:500 22px Inter;color:#c9ced6}.loja b{display:block;font:800 36px/1.1 Inter;letter-spacing:-.01em}
/* encerramento */
.fim{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;text-align:center}
.fim img.logo{width:560px;margin-top:300px;filter:drop-shadow(0 10px 24px rgba(0,0,0,.2))}
.fim h2{margin-top:60px;font:900 78px/1.05 Inter;letter-spacing:-.04em}
.fim h2 em{font-style:normal}
.fim .gratis{margin-top:40px;display:inline-flex;align-items:center;gap:16px;padding:20px 36px;border-radius:999px;font:800 40px Inter}
.fim .gratis i{width:18px;height:18px;border-radius:50%;background:#c4e24a;box-shadow:0 0 18px rgba(196,226,74,.9)}
.fim .lojas{margin-top:60px;display:flex;gap:24px}
.fim .link{margin-top:70px;font:900 64px Inter;letter-spacing:-.03em}
.fim .link small{display:block;font:500 32px Inter;margin-bottom:12px;letter-spacing:0}
.fim .qr{margin-top:46px;width:220px;height:220px;background:#fff;border-radius:24px;padding:16px;box-shadow:0 20px 40px -24px rgba(20,22,26,.5),0 0 0 1px rgba(20,22,26,.1)}.fim .qr img{width:100%;height:100%}
.claro .fim h2{color:#14161a}.claro .fim h2 em{color:#6f9a0e}.claro .gratis{background:linear-gradient(168deg,#30333a,#15171b);border:2px solid rgba(183,217,45,.45);color:#fff}
.claro .link{color:#14161a}.claro .link small{color:#3b4559}
.escuro .fim h2{color:#fff}.escuro .fim h2 em{color:#c4e24a}.escuro .gratis{border:2px solid rgba(196,226,74,.5);background:rgba(196,226,74,.1);color:#e8f5b8}
.escuro .link{color:#c4e24a}.escuro .link small{color:#c3c8cf}
`;

/* ajudantes de animação disponíveis dentro da página (render(t) dos conceitos usa estes nomes) */
export const JS_BASE = `
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const BEAT = ${BEAT}, T = b => b * BEAT;
const cl = x => Math.max(0, Math.min(1, x));
const ez = x => 1 - Math.pow(1 - cl(x), 3);                                   // ease-out cúbico
const ezi = x => { x = cl(x); return x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2; };
const ezb = x => { x = cl(x); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }; // com "overshoot"
const fase = (t, a, b) => cl((t - a) / (b - a));
const LEG = ${JSON.stringify(LEGENDA.map(c => c.texto))};
const kmTxt = m => Math.floor(m/1000) + ',' + String(Math.round(m) % 1000).padStart(3,'0');
function cena(el, t, a, b, entra = 0.5, sai = 0.35) {       // liga a cena em [a,b): esmaece na entrada e na saída
  const vis = t >= a - 0.05 && t < b; el.style.display = vis ? 'block' : 'none'; if (!vis) return null;
  el.style.opacity = Math.min(ez(fase(t, a, a + entra)), 1 - fase(t, b - sai, b)); return t - a;
}
function corte(el, t, a, b) {                                 // liga a cena sem esmaecer (corte seco, para cair na batida)
  const vis = t >= a && t < b; el.style.display = vis ? 'block' : 'none'; if (!vis) return null; el.style.opacity = 1; return t - a;
}
function sobe(el, p, dist = 90) { el.style.transform = 'translateY(' + ((1 - ez(p)) * dist) + 'px)'; el.style.opacity = ez(p); }
function pula(el, p) { el.style.transform = 'scale(' + (0.6 + 0.4 * ezb(p)) + ')'; el.style.opacity = cl(p * 3); }   // entra com overshoot (na batida)
function foneEntra(f, u, ini = 0.15, dur = 0.8) { f.style.transform = 'translateY(' + ((1 - ez(fase(u, ini, ini + dur))) * 160) + 'px)'; f.style.opacity = ez(fase(u, ini, ini + dur * 0.8)); }
function cruza(f, u, a, b) { f.querySelector('.tb').style.opacity = ez(fase(u, a, b)); }
function garante(f, cls, css) { const ex = f.querySelector('.extra'); let e = ex.querySelector('.' + cls); if (!e) { e = document.createElement('div'); e.className = cls; if (css) e.style.cssText = css; ex.appendChild(e); } return e; }
function pulso(f, u, ini, l, t_, w, h) {                     // anel pulsando em volta de um botão (% da tela do celular)
  const p = garante(f, 'pulso'); if (u < ini) { p.style.opacity = 0; return; }
  const c = ((u - ini) % 1.1) / 1.1; p.style.cssText = 'left:' + l + '%;top:' + t_ + '%;width:' + w + '%;height:' + h + '%;transform:scale(' + (1 + 0.12 * c) + ');opacity:' + (1 - c);
}
function flash(f, u, t0) { const fl = garante(f, 'flash'); fl.style.opacity = u >= t0 ? 1 - ez(fase(u, t0, t0 + 0.35)) : 0;
  const s = 'scale(' + (u >= t0 && u < t0 + 0.4 ? 1 - 0.03 * Math.sin(fase(u, t0, t0 + 0.4) * Math.PI) : 1) + ')'; f.querySelectorAll('.tela').forEach(im => im.style.transform = s); }
function contador(f, m) { garante(f, 'contador').textContent = kmTxt(m); }
function escreve(pref, u, ini, passo = 1.25, dur = 0.9) {     // legenda letra a letra, uma linha por vez; devolve o nº de letras escritas até agora
  let n = 0; LEG.forEach((txt, i) => { const a = ini + i * passo, p = fase(u, a, a + dur), k = Math.floor(p * txt.length); n += k;
    const c = $('#' + pref + i); c.style.opacity = u >= a ? 1 : 0; c.innerHTML = txt.slice(0, k) + (u >= a && p < 1 ? '<span class="cursor"></span>' : ''); }); return n;
}
function encerra(id, u) {                                     // animação padrão do encerramento, em batidas
  const l = $('#' + id + '-logo'); const p = ez(fase(u, 0, 0.7)); l.style.opacity = p; l.style.transform = 'scale(' + (0.85 + 0.15 * p) + ')';
  sobe($('#' + id + '-h2'), fase(u, T(1), T(1) + 0.5), 40); pula($('#' + id + '-g'), fase(u, T(2), T(2) + 0.45));
  sobe($('#' + id + '-l'), fase(u, T(3), T(3) + 0.5), 30); sobe($('#' + id + '-k'), fase(u, T(4), T(4) + 0.5), 30); sobe($('#' + id + '-q'), fase(u, T(5), T(5) + 0.5), 30);
}
function fio(t, dur) { for (const id of ['fioA', 'fioB']) { const p = $('#' + id); if (!p) return; const L = p.getTotalLength(); p.style.strokeDasharray = (L * 0.55) + ' ' + L; p.style.strokeDashoffset = L * 1.2 - (t / dur) * L * 2.2; } }
`;

export async function montar({ nome, dur, css, corpo, script, stills = [], audio }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;500;600;700;800;900&family=Caveat:wght@400;700&display=swap">
<style>${CSS_BASE}${css}</style></head><body>${corpo}<div class="flashTela" id="flashTela"></div><script>${JS_BASE}${script}</script></body></html>`;
  const soStills = process.argv[2] === 'stills';
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--hide-scrollbars'] });
  const p = await b.newPage();
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load', timeout: 120000 });
  await p.evaluate(() => Promise.all(['300 30px Inter', '500 38px Inter', '700 30px Inter', '800 40px Inter', '900 150px Inter', '400 46px Caveat', '700 46px Caveat'].map(f => document.fonts.load(f))));
  await p.evaluateHandle('document.fonts.ready');
  await p.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));

  if (soStills) {
    const dir = path.join(RAIZ, '_previa'); fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith(nome + '-')) fs.unlinkSync(path.join(dir, f));
    for (const t of stills) { await p.evaluate(t => render(t), t); await p.screenshot({ path: path.join(dir, `${nome}-${t.toFixed(1).replace('.', '_')}.jpg`), type: 'jpeg', quality: 90 }); }
    await b.close(); console.log(nome, 'stills em _previa/'); return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcheck-video-'));
  const total = Math.round(FPS * dur), t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await p.evaluate(t => render(t), i / FPS);
    await p.screenshot({ path: path.join(tmp, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (i % 300 === 0) console.log(`${nome}: quadro ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  await b.close();
  const ffmpeg = process.env.FFMPEG || [...fs.readdirSync(path.join(os.homedir(), 'AppData/Local/Microsoft/WinGet/Packages'))]
    .filter(n => n.startsWith('Gyan.FFmpeg')).map(n => path.join(os.homedir(), 'AppData/Local/Microsoft/WinGet/Packages', n))
    .flatMap(dir => fs.readdirSync(dir).map(s => path.join(dir, s, 'bin/ffmpeg.exe'))).find(f => fs.existsSync(f));
  const out = path.join(AQUI, `${nome}.mp4`);
  execFileSync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', path.join(tmp, 'f%05d.jpg'), '-i', audio,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: ['ignore', 'inherit', 'inherit'] });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(out, (fs.statSync(out).size / 1048576).toFixed(1), 'MB');
}
