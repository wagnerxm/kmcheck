/* Estúdio de prints do manual: abre o KM Check (servidor local da pasta do projeto), monta um
 * cenário com dados de exemplo e tira prints de cada tela em resolução de iPhone (390×844 @3x).
 * Uso:  node manual-kmcheck/estudio/capturar.mjs [nome-da-cena ...]   (sem nomes = todas)
 * Pré-requisito: preview "kmcheck" rodando em http://localhost:3456 (npx serve na porta 3456).
 * Fundo da câmera: manual-kmcheck/estudio/foto-rodovia.mjpeg (opcional; vira o vídeo da câmera). */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3456/';
const DIR = path.resolve('manual-kmcheck/prints');
const FOTO = path.resolve('manual-kmcheck/estudio/foto-rodovia.mjpeg');
fs.mkdirSync(DIR, { recursive: true });
const so = process.argv.slice(2);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const espera = ms => new Promise(r => setTimeout(r, ms));

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
if (fs.existsSync(FOTO)) args.push('--use-file-for-fake-video-capture=' + FOTO);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args,
});
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['geolocation', 'camera']);

async function novaPagina({ largura = 390, altura = 844, noite = false } = {}) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  /* app "instalado" (sem convite de instalação) e preferências do cenário antes de o app ler */
  await page.evaluateOnNewDocument(noite => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    try {
      localStorage.setItem('kc-contracts', JSON.stringify(['14 00515/2024', '14 00546/2025']));
      localStorage.setItem('kc-contract', '14 00515/2024');
      localStorage.setItem('kc-side', 'LD');
      localStorage.setItem('kc-services', JSON.stringify(['Roçada manual', 'Limpeza de drenagem', 'Tapa-buraco']));
      localStorage.setItem('kc-carnight', noite ? 'night' : 'day');
      localStorage.setItem('kc-install-shown', '1');
    } catch (e) {}
  }, noite);
  page.on('pageerror', e => console.log('  ⚠ erro na página:', e.message));
  /* bordas do iPhone (barra de status e barrinha de baixo): o app usa env(safe-area-inset-*) */
  try{ const cdp = await page.createCDPSession(); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: largura > altura ? { left: 47, right: 47, bottom: 21 } : { top: 47, bottom: 34 } }) }catch(e){ console.log('  ⚠ sem área segura:', e.message) }
  return page;
}
/* instala as rodovias de exemplo a partir dos dados do próprio projeto (data/rodovias) */
async function prepararBases(page) {
  await page.evaluate(async () => {
    for (const [br, uf] of [['226', 'RN'], ['110', 'RN']]) {
      if (S.bases.some(b => b.id === 'BR-' + br + '/' + uf)) continue;
      const b = await downloadRoadWfs(br, uf, null);
      await dbPut(b); S.bases.push(b);
    }
    renderBases();
  });
}
/* GPS de exemplo: um ponto exato do eixo (km informado), com pequena precisão */
async function posicionar(page, br, km, acc = 5) {
  const c = await page.evaluate((id, km) => { const b = S.bases.find(x => x.id === id); const c = kmToCoord(b, km); return c }, br, km);
  await page.setGeolocation({ latitude: c.lat, longitude: c.lon, accuracy: acc });
  await page.evaluate((c, acc) => {
    S.pos = { lat: c.lat, lon: c.lon, acc, alt: 12, spd: 0, head: 0, t: Date.now() };
    S.fix = findKm(c.lat, c.lon); autoContract(); paintGps();
  }, c, acc);
}
async function abrir(opts) {
  const page = await novaPagina(opts);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await espera(1200);
  await page.evaluate(() => { document.querySelectorAll('.install-overlay').forEach(o => o.classList.remove('on')) });
  await prepararBases(page);
  return page;
}
async function print(page, nome, { espera: ms = 600, cheio = false } = {}) {
  await espera(ms);
  await page.screenshot({ path: path.join(DIR, nome + '.png'), fullPage: cheio });
  console.log('  ✓', nome);
}

/* ── cenas ── */
const cenas = {
  async inicio() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => goToScreen('scr-cam')); await print(p, '01-inicio'); await p.close();
  },
  async carro() {
    let p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { openCar(); S.fix = { ...S.fix, km: S.fix.km + .01 }; paintGps() }); await print(p, '20-carro-dia', { espera: 900 }); await p.close();
    p = await abrir({ noite: true }); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { openCar(); S.fix = { ...S.fix, km: S.fix.km + .01 }; paintGps() }); await print(p, '21-carro-noite', { espera: 900 }); await p.close();
    p = await abrir({ largura: 844, altura: 390 }); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { openCar(); S.fix = { ...S.fix, km: S.fix.km + .01 }; paintGps() }); await print(p, '22-carro-deitado', { espera: 900 }); await p.close();
  },
  async eixo() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => goToScreen('scr-bases')); await print(p, '30-gestao-eixo');
    await p.evaluate(() => document.querySelector('.impsect').scrollIntoView({ block: 'end' })); await print(p, '31-importar');
    await p.evaluate(() => { document.querySelector('.bdet').click() }); await print(p, '32-detalhes-rodovia');
    await p.close();
  },
  async consulta() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => {
      goToScreen('scr-query');
      const b = S.bases.find(x => x.id === 'BR-226/RN'), pts = [300.2, 309.55, 315.08].map(k => kmToCoord(b, k));
      const qc = document.getElementById('q-coords'); qc.value = pts.map(c => fc(c.lat) + '\t' + fc(c.lon)).join('\n');
      qc.dispatchEvent(new Event('input')); document.getElementById('q-run').click();
      document.getElementById('k-km').value = '310,000'; document.getElementById('k-run').click();
    });
    await print(p, '40-consulta', { cheio: true }); await p.close();
  },
  async config() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => goToScreen('scr-settings')); await print(p, '50-config-camera', { cheio: true });
    await p.evaluate(() => document.querySelector('.settab[data-tab="tab-logo"]').click()); await print(p, '51-config-logo', { cheio: true });
    await p.evaluate(() => document.querySelector('.settab[data-tab="tab-leg"]').click()); await print(p, '52-config-legenda', { cheio: true });
    await p.close();
  },
};

const lista = so.length ? so : Object.keys(cenas);
for (const n of lista) { console.log('cena', n); try { await cenas[n]() } catch (e) { console.log('  ✗', n, e.message) } }
await browser.close();
