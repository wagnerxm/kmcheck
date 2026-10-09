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

async function novaPagina({ largura = 390, altura = 844, noite = false, instalado = true } = {}) {
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
      localStorage.setItem('kc-carnight', noite === 'auto' ? 'auto' : noite ? 'night' : 'day');
      localStorage.setItem('kc-install-shown', '1');
      localStorage.setItem('kc-uso', 'nao');          // sem o aviso de dados de uso por cima das telas
      localStorage.setItem('kc-manual-visto', '1');   // nem as boas-vindas
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
  if (opts?.instalado !== false) await page.evaluate(() => { document.querySelectorAll('.install-overlay').forEach(o => o.classList.remove('on')) });
  await prepararBases(page);
  return page;
}
/* marcadores do manual: posição (em % da tela) do centro de cada elemento, salva em prints/marcas.json */
const MARCAS = path.join(DIR, 'marcas.json');
async function print(page, nome, { espera: ms = 600, cheio = false, marcas = null } = {}) {
  await espera(ms);
  if (marcas) {
    const m = await page.evaluate(lst => lst.map(([n, sel]) => { const e = document.querySelector(sel); if (!e) return { n, sel, erro: 1 };
      const r = e.getBoundingClientRect(), P = (v, t) => +(v / t * 100).toFixed(2); return { n, l: P(r.left, innerWidth), t: P(r.top, innerHeight), w: P(r.width, innerWidth), h: P(r.height, innerHeight) } }), marcas);
    m.filter(q => q.erro).forEach(q => console.log('  ⚠ marca sem elemento:', q.sel));
    const all = fs.existsSync(MARCAS) ? JSON.parse(fs.readFileSync(MARCAS, 'utf8')) : {};
    all[nome] = m.filter(q => !q.erro); fs.writeFileSync(MARCAS, JSON.stringify(all, null, 1));
  }
  await page.screenshot({ path: path.join(DIR, nome + '.png'), fullPage: cheio });
  console.log('  ✓', nome);
}

/* rola a tela até a seção (pelo texto do título) e tira o print */
async function printSecao(page, nome, titulo) {
  await page.evaluate(t => {
    const h = [...document.querySelectorAll('.screen.on h2.sec')].find(e => e.textContent.trim().toLowerCase() === t.toLowerCase());
    const main = document.querySelector('main'), top = document.querySelector('header.top').getBoundingClientRect().bottom;
    if (h) main.scrollTop += h.getBoundingClientRect().top - top - 18;
  }, titulo);
  await print(page, nome);
}
/* ── cenas ── */
const cenas = {
  /* a foto da rodovia (sem legenda) vira o vídeo da câmera; o app desenha a legenda ao vivo por cima */
  async preparar() {
    const page = await browser.newPage();
    const b64 = n => 'data:image/webp;base64,' + fs.readFileSync(path.resolve('manual-kmcheck/estudio/' + n)).toString('base64');
    const out = await page.evaluate(async (rod) => {
      const img = new Image(); img.src = rod; await img.decode();
      const c = document.createElement('canvas'); c.width = 1280; c.height = 960;
      const sh = img.height, sw = sh * 4 / 3, sx = (img.width - sw) / 2;
      c.getContext('2d').drawImage(img, sx, 0, sw, sh, 0, 0, 1280, 960);
      return c.toDataURL('image/jpeg', .9);
    }, b64('foto-campo-nova.webp'));
    fs.writeFileSync(FOTO, Buffer.from(out.split(',')[1], 'base64'));
    console.log('  ✓ foto da câmera'); await page.close();
  },
  /* a mesma foto com a legenda queimada pelo PRÓPRIO app (burnLegend), como sai de verdade, e a posição
     de cada linha da legenda (para o holofote do manual): estudio/foto-campo-nova-legenda.webp + legenda.json */
  async fotolegenda() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 326.04);
    const src = 'data:image/webp;base64,' + fs.readFileSync(path.resolve('manual-kmcheck/estudio/foto-campo-nova.webp')).toString('base64');
    const r = await p.evaluate(async src => {
      localStorage.setItem('kc-svcsel', 'Aplicação de CBUQ');
      const img = new Image(); img.src = src; await img.decode();
      const W = 2400, H = Math.round(W * img.height / img.width);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const info = buildInfo(); burnLegend(ctx, W, H, info, 0);
      /* caixas das linhas, com a mesma geometria do burnLegend (canto inferior esquerdo) */
      const { L, snvTag } = legendLines(info);
      const u = Math.max(W, H) / 1000, pad = 20 * u, size = 17 * u * CFG.legsz, lh = size * 1.22;
      ctx.font = `${CFG.legbold ? 700 : 400} ${size}px Arial, Helvetica, sans-serif`;
      const larg = L.map((l, i) => ctx.measureText(l).width + (i === L.length - 1 && snvTag ? size * 1.5 + ctx.measureText(snvTag).width : 0));
      const maxW = Math.max(...larg), P = (v, t) => +(v / t * 100).toFixed(2);
      const caixas = L.map((l, i) => { const y = H - pad - (L.length - 1 - i) * lh;
        return { texto: l + (i === L.length - 1 && snvTag ? ' · ' + snvTag : ''), box: [P(pad - size * .4, W), P(y - size * 1.02, H), P(maxW + size * .8, W), P(lh, H)] }; });
      return { url: c.toDataURL('image/webp', .9), caixas, nome: photoName(info) };
    }, src);
    fs.writeFileSync(path.resolve('manual-kmcheck/estudio/foto-campo-nova-legenda.webp'), Buffer.from(r.url.split(',')[1], 'base64'));
    fs.writeFileSync(path.resolve('manual-kmcheck/estudio/legenda.json'), JSON.stringify({ caixas: r.caixas, nome: r.nome }, null, 1));
    console.log('  ✓ foto com legenda', r.caixas.length, 'linhas'); await p.close();
  },
  async camera() {
    let p = await abrir(); await posicionar(p, 'BR-226/RN', 326.04);
    await p.evaluate(() => { localStorage.setItem('kc-svcsel', 'Aplicação de CBUQ'); openCam() });
    await print(p, '10-camera', { marcas: [[1,"#camback"],[2,"#camgpsdot"],[3,"#camflip"],[4,"#liveplate"],[5,"#camfmts"],[6,"#cam-logo"],[7,"#cam-ld"],[8,"#cam-svc"],[9,"#shutter"],[10,"#cam-settings"],[11,"#cam-flash"],[12,"#cam-gallery"]], espera: 3500 });
    await p.evaluate(() => document.getElementById('cam-svc').click()); await print(p, '11-camera-servico-contrato', { espera: 900 });
    await p.close();
    p = await abrir({ largura: 844, altura: 390 }); await posicionar(p, 'BR-226/RN', 326.04);
    await p.evaluate(() => { localStorage.setItem('kc-svcsel', 'Aplicação de CBUQ'); openCam() });
    await print(p, '12-camera-deitada', { espera: 3500 }); await p.close();
  },
  async galeria() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 326.04);
    const fotos = ['foto-campo-tapaburaco.webp', 'foto-campo-rodovia.webp'].map(n => 'data:image/webp;base64,' + fs.readFileSync(path.resolve('manual-kmcheck/estudio/' + n)).toString('base64'));
    await p.evaluate(async (fotos) => {
      const nomes = ['BR-405-RN_KM138+799_LD_2026-10-07_10-48-12.jpg', 'BR-226-RN_KM326+040_LD_2026-09-15_11-27-05.jpg'];
      for (let i = 0; i < fotos.length; i++) {
        const bin = atob(fotos[i].split(',')[1]), u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); const blob = new Blob([u8], { type: 'image/webp' });
        const img = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
        const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', .92));
        const id = await savePhotoToGallery(jpg, nomes[i]); await markPhotoSaved(id);
      }
      await openGallery();
    }, fotos);
    await print(p, '13-galeria', { marcas: [[1,"#gal-close"],[2,"#gal-clean"],[3,"#gal-share"],[4,"#gal-count"],[5,"#gal-del"],[6,"#gal-caption"]], espera: 1500 }); await p.close();
  },

  async inicio() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => goToScreen('scr-cam')); await print(p, '01-inicio', { marcas: [[1,"#kmsign"],[2,"#herobr"],[3,"#kmbig"],[4,"#heroestaca"],[5,".herostats"],[6,"#car-open"],[7,"#search-toggle"],[8,"[data-goto=\"scr-settings\"]"],[9,"[data-goto=\"scr-bases\"]"],[10,"#nav-cam"]] }); await p.close();
  },
  async carro() {
    let p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { openCar(); S.fix = { ...S.fix, km: S.fix.km + .01 }; paintGps() }); await print(p, '20-carro-dia', { marcas: [[1,"#car-x"],[2,"#car-plate"],[3,"#car-km"],[4,"#car-track"],[5,"#car-est"],[6,"#car-acc"],[7,"#car-ct"],[8,"#car-dir"],[9,"#car-coord"]], espera: 900 }); await p.close();
    p = await abrir({ noite: true }); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { openCar(); S.fix = { ...S.fix, km: S.fix.km + .01 }; paintGps() }); await print(p, '21-carro-noite', { espera: 900 }); await p.close();
    p = await abrir({ largura: 844, altura: 390 }); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { openCar(); S.fix = { ...S.fix, km: S.fix.km + .01 }; paintGps() }); await print(p, '22-carro-deitado', { espera: 900 }); await p.close();
  },
  async eixo() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => goToScreen('scr-bases')); await print(p, '30-gestao-eixo', { marcas: [[1,"#baselist .base-item .binfo"],[2,"#baselist .bdet"],[3,"#baselist .del"]] });
    await p.evaluate(() => document.querySelector('.impsect').scrollIntoView({ block: 'end' })); await print(p, '31-importar', { marcas: [[1,"#btn-import"],[2,".impfmt .improw:nth-child(1)"],[3,".impfmt .improw:nth-child(2)"],[4,".impfmt .improw:nth-child(3)"]] });
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
    await print(p, '40-consulta', { marcas: [[1,"#q-coords"],[2,"#q-run"],[3,"#q-gps"],[4,"#q-out"],[5,"#q-copy"]], cheio: true }); await p.close();
  },
  async config() {
    const p = await abrir({ noite: 'auto' }); await posicionar(p, 'BR-226/RN', 82.35);
    const aba = t => p.evaluate(t => document.querySelector('.settab[data-tab="' + t + '"]').click(), t);
    await p.evaluate(() => goToScreen('scr-settings'));
    await printSecao(p, '50-config-qualidade', 'Qualidade');
    await printSecao(p, '51-config-aparencia', 'Comportamento após o disparo');
    await aba('tab-logo'); await printSecao(p, '52-config-logo', 'Logo da empresa');
    await aba('tab-leg'); await printSecao(p, '53-config-legenda', 'Legenda');
    await printSecao(p, '54-config-fundo', 'Fundo da legenda');
    await printSecao(p, '55-config-conteudo', 'Conteúdo');
    await printSecao(p, '56-config-servicos', 'Descrição de serviços');
    await printSecao(p, '57-config-contratos', 'Contratos');
    await p.close();
  },
  async janelas() {
    let p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { goToScreen('scr-settings'); document.querySelector('.settab[data-tab="tab-leg"]').click(); openCtLink('14 00515/2024', false) });
    await print(p, '60-vincular-contrato', { espera: 800 });
    await p.evaluate(() => { document.getElementById('dlg-ctlink').close(); _ctLinkFor = '14 00515/2024'; openCtKm('BR-226/RN') });
    await print(p, '61-vincular-trecho', { espera: 800 });
    await p.evaluate(() => { document.getElementById('dlg-ctkm').close(); goToScreen('scr-bases'); openBaseDetails('BR-226/RN') });
    await print(p, '62-detalhes-rodovia', { espera: 800 });
    await p.evaluate(() => document.getElementById('base-est').click());
    await print(p, '63-estaca', { espera: 900 });
    await p.close();
    p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(() => { _isIOS = true; showGpsDeniedDialog() }).catch(() => p.evaluate(() => showGpsDeniedDialog()));
    await print(p, '64-gps-desligado', { espera: 800 }); await p.close();
    p = await novaPagina({ instalado: false }); await p.goto(BASE, { waitUntil: 'networkidle2' });
    await print(p, '65-instalar', { espera: 3000 }); await p.close();
  },
  async importar() {
    const p = await abrir(); await posicionar(p, 'BR-226/RN', 82.35);
    await p.evaluate(async () => {
      goToScreen('scr-bases');
      const line = []; for (let i = 0; i <= 40; i++) line.push([-35.27 + i * .0021 + Math.sin(i / 5) * .0012, -5.86 - i * .0011]);
      const kml = '<kml><Document><Placemark><name>Estrada do Sal</name><LineString><coordinates>' + line.map(q => q.join(',')).join(' ') + '</coordinates></LineString></Placemark></Document></kml>';
      openImportDialog(await readImportFiles([new File([kml], 'estrada-do-sal.kml')]));
      const card = document.querySelector('#imp-list .impcard');
      card.querySelector('.imp-uf').value = 'RN'; card.querySelector('.imp-uf').dispatchEvent(new Event('change'));
    });
    await print(p, '33-importar-configurar', { marcas: [[1,"#imp-list .imp-name"],[2,"#imp-list .impinfo"],[3,"#imp-list .imp-k0"],[4,"#imp-list .imp-ponta"],[5,"#imp-list .imp-draw"],[6,"#imp-list .impmore"]], espera: 800 });
    await p.close();
  },

};

const lista = so.length ? so : Object.keys(cenas);
for (const n of lista) { console.log('cena', n); try { await cenas[n]() } catch (e) { console.log('  ✗', n, e.message) } }
await browser.close();
