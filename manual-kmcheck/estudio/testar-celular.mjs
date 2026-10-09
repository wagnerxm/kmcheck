/* Testa o manual web como no iPhone dentro do app do Claude: tela estreita e área segura no topo.
 * Gera capturas em manual-kmcheck/opcoes/web/ip-*.jpg. Uso: node manual-kmcheck/estudio/testar-celular.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const corpo = fs.readFileSync('manual-kmcheck/manual-km-check.html', 'utf8');
/* o publicador da página soma a área segura no :root; aqui fazemos igual para o teste ser fiel */
const doc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style></head><body>' + corpo + '</body></html>';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); const erros = []; p.on('pageerror', e => erros.push(e.message));
await p.setViewport({ width: 390, height: 760, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
const cdp = await p.createCDPSession(); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 60, bottom: 30 } });
await p.setContent(doc, { waitUntil: 'load' }); const w = ms => new Promise(r => setTimeout(r, ms));
await w(1200); const D = 'manual-kmcheck/opcoes/web/';
const vai = async (sel, extra) => { await p.evaluate((s, e) => scrollTo({ top: document.querySelector(s).getBoundingClientRect().top + scrollY + e, behavior: 'instant' }), sel, extra); await w(1100); };
let i = 0; const foto = async n => p.screenshot({ path: D + 'ip-' + (i++) + '-' + n + '.jpg', type: 'jpeg', quality: 70 });
/* sobreposição: o aparelho da rolagem guiada não pode ficar sob o painel fixo, e o passo ativo não pode ficar sob o aparelho */
const confere = () => p.evaluate(() => {
  const hud = document.querySelector('.hud-bar').getBoundingClientRect(), r = [];
  document.querySelectorAll('.story').forEach(st => {
    const f = st.querySelector('.story-fig'), fr = f.getBoundingClientRect(); if (fr.bottom < 0 || fr.top > innerHeight) return;
    const fone = (f.querySelector('.fone') || f.querySelector('.quadro')).getBoundingClientRect();
    const at = st.querySelector('.leg-passo'); const ar = at && at.getBoundingClientRect();
    r.push({ cap: st.closest('.cap').id, foneTopo: Math.round(fone.top), hudBase: Math.round(hud.bottom), foneBase: Math.round(fone.bottom), textoTopo: ar && Math.round(ar.top), textoBase: ar && Math.round(ar.bottom), tela: innerHeight });
  });
  return { hudCap: document.querySelector('.hud-txt b').textContent, r };
});
for (const [sel, extras] of [['#inicio', [700, 1400, 2600]], ['#camera', [900, 3000]], ['#legenda', [900, 2200]], ['#carro', [3000, 5600]]]) {
  for (const e of extras) { await vai(sel, e); console.log(sel, e, JSON.stringify(await confere())); await foto(sel.slice(1) + e); }
}
await vai('#problemas', 300); await p.evaluate(() => document.querySelector('.faq-c').click()); await w(900);
console.log('erros até aqui', erros); console.log('janela', await p.evaluate(() => { const j = document.querySelector('.janela').getBoundingClientRect(); return { esq: Math.round(j.left), dir: Math.round(innerWidth - j.right), topo: Math.round(j.top), base: Math.round(innerHeight - j.bottom) }; }));
await foto('janela');
console.log('mais largos', await p.evaluate(() => { const r = []; document.querySelectorAll('body *').forEach(e => { const b = e.getBoundingClientRect(); if (b.right > 391 && !e.closest('.trilha')) r.push(String(e.className) + ':' + Math.round(b.right)); }); return r.slice(0, 8); }));
console.log('largura', await p.evaluate(() => document.documentElement.scrollWidth), 'erros', erros.length ? erros : 'nenhum');
await b.close();
