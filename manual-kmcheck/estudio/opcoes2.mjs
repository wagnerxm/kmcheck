/* Mais três direções para o manual, agora com as cores e os cartões do próprio KM Check
 * (grafite em cetim com fio verde-limão, placa azul de km, tema claro #f4f4f2) e a rodovia como tema.
 *   4. Painel de bordo   o manual inteiro no idioma do Modo Carro
 *   5. Vista aérea       a rodovia vista de cima atravessa a folha clara; a folha é pintada no asfalto
 *   6. Ponto de fuga     a pista em perspectiva à noite; os capítulos são marcos de km na beira da estrada
 * Gera manual-kmcheck/opcoes/opcao-4..6.png. Uso: node manual-kmcheck/estudio/opcoes2.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, PR, esc, conversor, fabricaCelular, CSS_CEL, ITENS_INICIO, ITENS_LEG, NOTA_LEG, LEG_Y } from './comum.mjs';

const SAIDA = path.join(RAIZ, 'opcoes'); fs.mkdirSync(SAIDA, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const conv = await browser.newPage(), webp = conversor(conv);
const IMG = {};
for (const n of ['01-inicio', '10-camera', '20-carro-dia', '21-carro-noite']) IMG[n] = await webp(path.join(PR, n + '.png'), 780);
const FOTO_ARQ = path.join(RAIZ, 'estudio/foto-campo-rodovia.webp');
const FOTO = await webp(FOTO_ARQ, 1200, [0, 0, 1, .78]);
const FOTO_LEG = await webp(FOTO_ARQ, 1000, [0, .80, .56, .20]);
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('logo-header.png')).toString('base64');
await conv.close();
const cel = fabricaCelular(IMG);
const VERSAO = '292';

/* o cetim grafite dos cartões do Modo Carro vem direto do app (mesmos símbolos SVG) */
const idx = fs.readFileSync(path.resolve('index.html'), 'utf8');
const ini = idx.indexOf('<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>');
const DEFS = idx.slice(ini, idx.indexOf('</defs></svg>', ini) + 13);
const onda = (s = 'main') => `<svg class="cwv" aria-hidden="true"><use href="#car-a${s}"/></svg>`;
const CSS_APP = `
.cdk{position:relative;overflow:hidden;border:1px solid transparent;border-radius:26px;
  background:radial-gradient(120% 60% at 12% -8%,rgba(255,255,255,.10),rgba(255,255,255,0) 55%) padding-box,radial-gradient(90% 70% at 105% 110%,rgba(0,0,0,.55),rgba(0,0,0,0) 60%) padding-box,linear-gradient(168deg,#2a2c30 0%,#1d1f22 30%,#141517 62%,#0b0c0d 100%) padding-box,linear-gradient(180deg,rgba(255,255,255,.26),rgba(255,255,255,.06) 30%,rgba(255,255,255,.03) 70%,rgba(255,255,255,.10)) border-box;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 1px rgba(0,0,0,.10),0 10px 18px -6px rgba(15,20,30,.22),0 34px 54px -22px rgba(15,20,30,.55);color:#fff}
.cdk .cwv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.cdk>*:not(.cwv){position:relative}
.cl{text-transform:uppercase;color:#cfd2d7;font-weight:500;font-size:10px;letter-spacing:.26em}
.prata{background:linear-gradient(180deg,#fff 0%,#fff 55%,#dfe3e8 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 4px 14px rgba(0,0,0,.55))}
.lima{color:#b7d92d;text-shadow:0 0 18px rgba(196,226,74,.18)}
.trilho{position:relative;height:8px;border-radius:999px;background:linear-gradient(180deg,#0a0b0c,#18191b);box-shadow:inset 0 1px 2px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.06)}
.trilho i{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,#8eb31f,#c6e64c);box-shadow:0 0 12px rgba(183,217,45,.35)}
.trilho b{position:absolute;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:radial-gradient(circle at 40% 30%,#fff,#e4e7ea 70%);box-shadow:0 0 0 3px rgba(196,226,74,.22),0 3px 8px rgba(0,0,0,.6)}
.n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#b7d92d;color:#1d2606;font:800 10.5px/1 var(--f);flex:0 0 auto}
`;
const placaSvg = (a, b, c, w) => `<svg class="placa" viewBox="0 0 150 178" style="width:${w}px" aria-hidden="true"><rect x="2" y="2" width="146" height="174" rx="14" fill="#fff"/><rect x="10" y="10" width="130" height="158" rx="9" fill="#13305c"/><rect x="10" y="10" width="130" height="70" rx="9" fill="#fff" fill-opacity=".05"/><text x="75" y="52" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="${a.length >= 6 ? 22 : 31}" fill="#fff">${a}</text><line x1="24" y1="68" x2="126" y2="68" stroke="#fff" stroke-width="3"/><text x="75" y="110" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="34" fill="#fff">${b}</text><text x="75" y="156" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="42" fill="#fff">${c}</text></svg>`;
const pilha = (h1 = 150) => `<div class="pilha"><img class="f1" src="${FOTO}" alt="" style="height:${h1}px"><div class="f2w"><img class="f2" src="${FOTO_LEG}" alt="">${LEG_Y.map((y, i) => `<span class="n mk2" style="top:${y}%">${i + 1}</span>`).join('')}</div></div>`;
const CSS_PILHA = `.pilha{position:relative}
.pilha .f1{display:block;width:100%;object-fit:cover;object-position:50% 64%;border-radius:14px}
.pilha .f2w{position:relative;margin:-34px -6px 0 28px}
.pilha .f2{display:block;width:100%;border-radius:8px;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 16px 30px -12px rgba(0,0,0,.8)}
.mk2{position:absolute;left:-24px;margin-top:-11px;box-shadow:0 0 0 3px #15171a}`;
const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap">';
const BASE = `*{box-sizing:border-box}html,body{margin:0}h1,h2,h3,p{margin:0}
body{display:grid;gap:28px;padding:28px;background:#3a3c40;width:max-content;font-family:Inter,-apple-system,'SF Pro Text',Helvetica,Arial,sans-serif}
.t{--f:Inter,-apple-system,Helvetica,Arial,sans-serif}
.folha{position:relative;width:1123px;height:794px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.folha>*{position:absolute}.folha>.cel,.folha>.cdk{position:absolute}`;
const grao = (alfa, f = .9) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${f}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${alfa} 0 0 0 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;
const DESC = 'Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na própria foto. Direto do campo, sem depender de internet.';

/* ===================== 4. PAINEL DE BORDO ===================== */
const op4 = (() => {
  const css = `
/* O manual fala a língua do Modo Carro: o cartão grande com placa, nome em verde-limão, número
   prateado e a barra "para o próximo km" vira a barra de progresso do manual. */
.t{background:${grao(.06)},radial-gradient(1200px 760px at 30% -10%,#1d2024 0%,#0f1113 55%,#08090a 100%);color:#eef1f6}
.cdk-main{left:44px;top:44px;width:648px;height:476px;padding:44px 48px}
.topo{display:flex;gap:28px;align-items:center}
.topo .lima{font:800 30px/1 var(--f);letter-spacing:-.01em}
.topo .km{font:900 112px/.92 var(--f);letter-spacing:-.045em;margin-top:6px}
.rot{display:block;text-align:center;font:500 13px var(--f);letter-spacing:.42em;padding-left:.42em;text-transform:uppercase;color:#cfd2d7;margin-top:38px}
.cdk-main .trilho{width:78%;margin:26px auto 0}
.prox{text-align:center;margin-top:22px;font:400 19px var(--f);color:#e2e4e8}
.prox b{color:#b7d92d;font-weight:800}
.tiles{left:44px;top:536px;width:648px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.tile{padding:18px 24px;border-radius:22px;height:98px}
.tile .cv{font:800 24px/1.1 var(--f);margin-top:8px;font-variant-numeric:tabular-nums}
.tile.larga{grid-column:1/-1}
.capa-logo{left:742px;top:50px;height:44px}
/* folha */
.barra{left:44px;right:44px;top:28px;display:grid;grid-template-columns:auto 1fr auto;gap:26px;align-items:center}
.barra .cl{font-size:9.5px}
.barra .trilho{height:6px}
.barra .trilho b{width:16px;height:16px;margin:-8px 0 0 -8px}
.ca{left:44px;top:74px;width:352px;height:676px;padding:30px 28px}
.ca .topo{gap:16px}
.ca .lima{font:800 15px/1 var(--f);letter-spacing:.02em}
.ca h2{font:900 36px/1 var(--f);letter-spacing:-.035em;margin-top:6px}
.ca .lead{font-size:13.5px;line-height:1.5;color:#c4c9d0;margin-top:16px}
.ca .cel{margin:40px auto 0}
.grade{left:412px;top:74px;width:330px;height:676px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(5,1fr);gap:12px}
.it{border-radius:20px;padding:15px 16px 14px;display:flex;flex-direction:column;gap:8px}
.it .cab{display:flex;align-items:center;gap:8px}
.it .cl{font-size:9px;letter-spacing:.2em;line-height:1.25}
.it p{font:600 13px/1.35 var(--f);color:#f1f3f5}
.cleg{left:758px;top:74px;width:321px;height:676px;padding:26px 24px}
.cleg h3{font:900 24px/1.05 var(--f);letter-spacing:-.03em;margin:8px 0 16px}
.ileg{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:0}
.ileg li{display:flex;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.08)}
.ileg li:first-child{border-top:none}
.ileg b{display:block;font:700 13.5px var(--f)}
.ileg p{font-size:12px;color:#aeb5be;margin-top:2px}
.nota{font-size:11.5px;color:#8791a3;line-height:1.45;margin-top:10px}
.t{--ln:#b7d92d;--ln-h:rgba(8,9,10,.7);--mk-bg:#b7d92d;--mk-fg:#1d2606;--mk-anel:#17191c;--f-dado:Inter,sans-serif}
${CSS_PILHA}`;
  const capa = `<section class="folha t">
    <div class="cdk cdk-main">${onda('main')}
      <div class="topo">${placaSvg('MANUAL', 'KM', VERSAO, 132)}<div><div class="lima">Manual do usuário</div><div class="km prata">KM Check</div></div></div>
      <span class="rot">Guia completo</span>
      <div class="trilho"><i style="width:12.5%"></i><b style="left:12.5%"></b></div>
      <p class="prox"><b>8 folhas</b> do primeiro uso à foto no campo</p>
    </div>
    <div class="tiles">
      <div class="cdk tile">${onda('tile')}<div class="cl">Versão</div><div class="cv">${VERSAO}</div></div>
      <div class="cdk tile">${onda('tilel')}<div class="cl">Aparelhos</div><div class="cv">iPhone e Android</div></div>
      <div class="cdk tile larga">${onda('tile')}<div class="cl">Desenvolvido por</div><div class="cv">Wagner Machado</div></div>
    </div>
    <img class="capa-logo" src="${LOGO}" alt="KM Check">
    ${cel('10-camera', { numeros: false, w: 232, estilo: 'left:868px;top:126px;transform:rotate(6deg)' })}
    ${cel('20-carro-dia', { numeros: false, w: 262, estilo: 'left:728px;top:112px;transform:rotate(-3deg)' })}
  </section>`;
  const folha = `<section class="folha t">
    <div class="barra"><span class="cl">KM Check · Manual do usuário</span><div class="trilho"><i style="width:37.5%"></i><b style="left:37.5%"></b></div><span class="cl">Folha 03 de 08 · v${VERSAO}</span></div>
    <div class="cdk ca">${onda('main')}<div class="topo">${placaSvg('BR-KMC', 'KM', '02', 64)}<div><div class="lima">Capítulo 02</div><h2 class="prata">Tela inicial</h2></div></div>
      <p class="lead">O painel de campo: com o GPS, o app acha a rodovia mais próxima e mostra o KM exato.</p>${cel('01-inicio', { w: 184 })}</div>
    <div class="grade">${ITENS_INICIO.map((it, i) => `<div class="cdk it">${onda(i % 3 === 1 ? 'tilel' : 'tile')}<div class="cab"><span class="n">${i + 1}</span><span class="cl">${esc(it[0])}</span></div><p>${esc(it[1])}</p></div>`).join('')}</div>
    <div class="cdk cleg">${onda('main')}<span class="cl">Na foto</span><h3 class="prata">A legenda gravada</h3>${pilha(138)}
      <ol class="ileg">${ITENS_LEG.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol><p class="nota">${NOTA_LEG}</p></div>
  </section>`;
  return { css, html: capa + folha };
})();

/* ===================== 5. VISTA AÉREA ===================== */
/* faixa de rodovia vista de cima: asfalto com grão, bordas brancas e eixo tracejado verde-limão */
function estrada(w, h, d, larg, extra = '') {
  return `<svg class="estrada" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs><filter id="asf" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch" result="n"/><feColorMatrix in="n" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .10 0 0 0 0" result="g"/><feComposite in="g" in2="SourceGraphic" operator="in" result="gg"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="gg"/></feMerge></filter>
    <filter id="somb" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${w + 200}" height="${h + 200}"><feGaussianBlur stdDeviation="14"/></filter></defs>
    <path d="${d}" fill="none" stroke="rgba(20,24,30,.35)" stroke-width="${larg + 30}" filter="url(#somb)"/>
    <path d="${d}" fill="none" stroke="#c9cdc4" stroke-width="${larg + 26}"/>
    <path d="${d}" fill="none" stroke="#1b1f22" stroke-width="${larg}" filter="url(#asf)"/>
    <path d="${d}" fill="none" stroke="#eef1f6" stroke-width="${larg - 14}" opacity=".9"/>
    <path d="${d}" fill="none" stroke="#1b1f22" stroke-width="${larg - 22}" filter="url(#asf)"/>
    <path d="${d}" fill="none" stroke="#b7d92d" stroke-width="5" stroke-dasharray="34 26"/>${extra}</svg>`;
}
const op5 = (() => {
  const css = `
/* A folha é o acostamento claro (o tema claro do app) e a rodovia passa por ela vista de cima.
   Os cartões grafite são os do app no tema claro. O número da folha vem pintado no asfalto. */
.t{background:${grao(.05, .75)},radial-gradient(1000px 700px at 30% 20%,#fbfbf9 0%,#f4f4f2 55%,#e9e9e5 100%);color:#1c2333;
  --ln:#1c2333;--ln-h:rgba(255,255,255,.85);--mk-bg:#1b1f22;--mk-fg:#c9e463;--mk-anel:#f4f4f2;--f-dado:Inter,sans-serif;
  --cel-sombra:0 40px 60px -30px rgba(28,35,51,.55),0 12px 22px -10px rgba(28,35,51,.35)}
.estrada{inset:0;width:100%;height:100%}
.pintura{font:900 64px/1 var(--f);fill:#eef1f6;opacity:.9;letter-spacing:.02em}
.marco{display:flex;flex-direction:column;align-items:center}
.marco .poste{width:10px;height:70px;background:linear-gradient(90deg,#d9dde2,#fff 45%,#c3c8ce);border-radius:2px;margin-top:-4px;box-shadow:0 18px 20px -10px rgba(28,35,51,.4)}
.marco .placa{filter:drop-shadow(0 14px 18px rgba(28,35,51,.35))}
.olho{font:700 11px var(--f);letter-spacing:.3em;text-transform:uppercase;color:#5c7690}
.capa h1{left:64px;top:206px;font:900 128px/.86 var(--f);letter-spacing:-.055em;color:#1c2333}
.capa h1 span{position:relative;display:inline-block}
.capa h1 span::after{content:'';position:absolute;left:4px;right:6px;bottom:6px;height:16px;background:#b7d92d;z-index:-1;transform:skewX(-12deg)}
.capa .olho{left:68px;top:176px}
.capa .sub{left:68px;top:428px;width:330px;font-size:17px;line-height:1.55;color:#3b4559}
.capa .logo{left:64px;top:56px;height:46px}
.capa .assin{right:48px;top:66px;font:600 10.5px var(--f);letter-spacing:.24em;text-transform:uppercase;color:#66748a}
.cab{left:178px;top:52px;width:520px}
.cab h2{font:900 46px/1 var(--f);letter-spacing:-.045em;margin-top:8px}
.cab p{font-size:15px;color:#3b4559;margin-top:10px}
.cdk.lista{left:410px;top:176px;width:350px;padding:18px 22px}
.lista ol{list-style:none;margin:10px 0 0;padding:0}
.lista li{display:flex;gap:11px;padding:5.5px 0;border-top:1px solid rgba(255,255,255,.07)}
.lista li:first-child{border-top:none}
.lista b{display:block;font:700 13.5px/1.2 var(--f)}
.lista p{font-size:12px;color:#aeb5be;margin-top:2px;line-height:1.3}
.cdk.cleg{left:782px;top:52px;width:297px;padding:22px 20px}
.cleg h3{font:900 21px/1.05 var(--f);letter-spacing:-.03em;margin:8px 0 14px}
.ileg{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
.ileg li{display:flex;gap:8px}
.ileg b{display:block;font:700 12.5px var(--f)}
.ileg p{font-size:11.5px;color:#aeb5be;margin-top:2px;line-height:1.3}
.nota{font-size:11px;color:#8791a3;line-height:1.4;margin-top:12px}
.pe{right:44px;top:24px;font:600 9.5px var(--f);letter-spacing:.24em;text-transform:uppercase;color:#66748a}
${CSS_PILHA}`;
  const capaD = 'M-80,700 C260,690 420,560 620,470 S980,300 1220,250';
  const capa = `<section class="folha t capa">
    ${estrada(1123, 794, capaD, 150, `<text class="pintura" transform="translate(905,322) rotate(-20)" text-anchor="middle">KM 0</text>`)}
    <img class="logo" src="${LOGO}" alt="KM Check">
    <span class="olho">Manual do usuário · Versão ${VERSAO}</span>
    <h1>KM<br><span>Check</span></h1>
    <p class="sub">${DESC}</p>
    <div class="marco" style="left:1010px;top:442px">${placaSvg('MANUAL', 'KM', VERSAO, 74)}<span class="poste"></span></div>
    ${cel('20-carro-dia', { numeros: false, w: 150, estilo: 'left:532px;top:328px;transform:rotate(-114deg)' })}
    ${cel('10-camera', { numeros: false, w: 150, estilo: 'left:735px;top:180px;transform:rotate(-108deg)' })}
    <span class="assin">Desenvolvido por Wagner Machado</span>
  </section>`;
  const folhaD = 'M-80,778 C300,754 700,750 1220,768';
  const folha = `<section class="folha t">
    ${estrada(1123, 794, folhaD, 96, `<text class="pintura" style="font-size:30px" transform="translate(900,751) rotate(1)" text-anchor="middle">FOLHA 03 / 08</text>`)}
    <div class="marco" style="left:64px;top:44px">${placaSvg('BR-KMC', 'KM', '02', 82)}<span class="poste" style="height:40px"></span></div>
    <header class="cab"><span class="olho">Capítulo 02</span><h2>Tela inicial</h2><p>O painel de campo: com o GPS, o app acha a rodovia mais próxima e mostra o KM exato.</p></header>
    ${cel('01-inicio', { w: 180, estilo: 'left:150px;top:220px' })}
    <div class="cdk lista">${onda('main')}<span class="cl">Na tela</span><ol>${ITENS_INICIO.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol></div>
    <div class="cdk cleg">${onda('main')}<span class="cl">Na foto</span><h3 class="prata">A legenda gravada</h3>${pilha(128)}
      <ol class="ileg">${ITENS_LEG.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol><p class="nota">${NOTA_LEG}</p></div>
    <span class="pe">KM Check · Manual do usuário · Desenvolvido por Wagner Machado</span>
  </section>`;
  return { css, html: capa + folha };
})();

/* ===================== 6. PONTO DE FUGA ===================== */
/* pista em perspectiva: horizonte em H, fuga em VX; o tracejado verde diminui até sumir */
function pista(w, h, H, VX, base, marcos = '') {
  const B = h, s2y = s => H + (B - H) * s;
  let tr = '';
  for (let i = 0; i < 18; i++) {
    const s1 = 1 / (1 + .42 * i), s0 = s1 * .74; if (s1 < .04) break;
    const y0 = s2y(s0), y1 = s2y(s1), w0 = 5 * s0, w1 = 5 * s1;
    tr += `<polygon points="${VX - w0},${y0} ${VX + w0},${y0} ${VX + w1},${Math.min(y1, B + 40)} ${VX - w1},${Math.min(y1, B + 40)}" fill="#b7d92d" opacity="${(.35 + .65 * s1).toFixed(2)}"/>`;
  }
  const bx = s => base * s;
  return `<svg class="pista" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs>
    <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08090a"/><stop offset="1" stop-color="#15181b"/></linearGradient>
    <radialGradient id="brilho" cx="${VX / w}" cy="${H / h}" r=".5"><stop offset="0" stop-color="#b7d92d" stop-opacity=".22"/><stop offset=".35" stop-color="#b7d92d" stop-opacity=".05"/><stop offset="1" stop-color="#b7d92d" stop-opacity="0"/></radialGradient>
    <linearGradient id="asf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0f11"/><stop offset="1" stop-color="#202428"/></linearGradient>
    <filter id="gr" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .07 0 0 0 0"/></filter></defs>
    <rect width="${w}" height="${H}" fill="url(#ceu)"/><rect y="${H}" width="${w}" height="${h - H}" fill="#07080a"/>
    <polygon points="${VX},${H} ${VX + bx(1)},${B} ${VX - bx(1)},${B}" fill="url(#asf)"/>
    <polygon points="${VX},${H} ${VX + bx(1)},${B} ${VX + bx(1) - 16},${B} ${VX},${H}" fill="#e9ecef" opacity=".85"/>
    <polygon points="${VX},${H} ${VX - bx(1)},${B} ${VX - bx(1) + 16},${B} ${VX},${H}" fill="#e9ecef" opacity=".85"/>
    ${tr}<rect width="${w}" height="${h}" fill="url(#brilho)"/><rect width="${w}" height="${h}" filter="url(#gr)"/>
    <line x1="0" y1="${H}" x2="${w}" y2="${H}" stroke="#b7d92d" stroke-opacity=".25"/>${marcos}</svg>`;
}
const op6 = (() => {
  /* marcos de km na beira da pista: cada capítulo é um marco, menor quanto mais longe */
  const H = 330, VX = 560, BASE = 900;
  const marcos = [1, 2, 3, 4, 5, 6, 7, 8].map(k => {
    const s = .6 / (1 + .5 * (k - 1)), y = H + (794 - H) * s, x = VX + BASE * s * .9 + 16, w = 110 * s;
    return `<g transform="translate(${x.toFixed(1)},${(y - w * 1.9).toFixed(1)})" opacity="${(.5 + .5 * s).toFixed(2)}"><rect x="${(w / 2 - w * .06).toFixed(1)}" y="${(w * 1.1).toFixed(1)}" width="${(w * .12).toFixed(1)}" height="${(w * .8).toFixed(1)}" fill="#cfd4da"/><rect width="${w.toFixed(1)}" height="${(w * 1.19).toFixed(1)}" rx="${(w * .09).toFixed(1)}" fill="#fff"/><rect x="${(w * .05).toFixed(1)}" y="${(w * .05).toFixed(1)}" width="${(w * .9).toFixed(1)}" height="${(w * 1.09).toFixed(1)}" rx="${(w * .06).toFixed(1)}" fill="#13305c"/><text x="${(w / 2).toFixed(1)}" y="${(w * .48).toFixed(1)}" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="${(w * .26).toFixed(1)}" fill="#fff">KM</text><text x="${(w / 2).toFixed(1)}" y="${(w * .95).toFixed(1)}" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="${(w * .38).toFixed(1)}" fill="#fff">0${k}</text></g>`;
  }).join('');
  const css = `
/* A pista em perspectiva à noite, com o eixo verde-limão sumindo no horizonte. Na capa os 8 capítulos
   são marcos de km na beira da estrada; nas folhas, a pista vira o chão onde o celular fica de pé. */
.t{background:#08090a;color:#eef1f6;--ln:#b7d92d;--ln-h:rgba(8,9,10,.7);--mk-bg:#b7d92d;--mk-fg:#1d2606;--mk-anel:#121417;--f-dado:Inter,sans-serif}
.pista{inset:0;width:100%;height:100%}
.capa .logo{left:50%;top:40px;height:40px;transform:translateX(-50%)}
.capa .olho{left:0;right:0;top:106px;text-align:center;font:700 11px var(--f);letter-spacing:.42em;padding-left:.42em;text-transform:uppercase;color:#b7d92d}
.capa h1{left:0;right:0;top:126px;text-align:center;font:900 132px/1 var(--f);letter-spacing:-.055em}
.capa .sub{left:50%;top:276px;width:560px;transform:translateX(-50%);text-align:center;font-size:15.5px;line-height:1.5;color:#aeb5be}
.reflexo{-webkit-box-reflect:below 4px linear-gradient(transparent 72%,rgba(255,255,255,.16))}
.capa .assin{left:44px;bottom:30px;font:600 10px var(--f);letter-spacing:.26em;text-transform:uppercase;color:#8791a3}
.capa .ver{right:44px;bottom:30px;font:600 10px var(--f);letter-spacing:.26em;text-transform:uppercase;color:#8791a3}
.capa .ver b{color:#b7d92d}
.cab{left:44px;top:40px;display:flex;gap:20px;align-items:center}
.cab .lima{font:800 14px var(--f);letter-spacing:.04em}
.cab h2{font:900 46px/1 var(--f);letter-spacing:-.045em;margin-top:6px}
.cab p{font-size:14.5px;color:#aeb5be;margin-top:8px}
.cdk.lista{left:44px;top:168px;width:334px;padding:20px 22px}
.lista ol{list-style:none;margin:10px 0 0;padding:0}
.lista li{display:flex;gap:11px;padding:6.5px 0;border-top:1px solid rgba(255,255,255,.07)}
.lista li:first-child{border-top:none}
.lista b{display:block;font:700 13.5px/1.2 var(--f)}
.lista p{font-size:12px;color:#aeb5be;margin-top:2px;line-height:1.3}
.cdk.cleg{left:768px;top:40px;width:311px;padding:22px 20px}
.cleg h3{font:900 22px/1.05 var(--f);letter-spacing:-.03em;margin:8px 0 14px}
.ileg{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
.ileg li{display:flex;gap:8px}
.ileg b{display:block;font:700 12.5px var(--f)}
.ileg p{font-size:11.5px;color:#aeb5be;margin-top:2px;line-height:1.3}
.nota{font-size:11px;color:#8791a3;line-height:1.4;margin-top:12px}
.pe{right:44px;bottom:24px;display:flex;gap:18px;font:600 9.5px var(--f);letter-spacing:.24em;text-transform:uppercase;color:#8791a3}
.pe b{color:#b7d92d}
.pe-e{right:auto;left:44px}
${CSS_PILHA}`;
  const capa = `<section class="folha t capa">${pista(1123, 794, H, VX, BASE, marcos)}
    <img class="logo" src="${LOGO}" alt="KM Check">
    <span class="olho">Manual do usuário</span><h1 class="prata">KM Check</h1>
    <p class="sub">${DESC}</p>
    ${cel('10-camera', { numeros: false, w: 214, cls: 'reflexo', estilo: 'left:453px;top:372px' })}
    <span class="assin">Desenvolvido por Wagner Machado</span><span class="ver">Versão <b>${VERSAO}</b> · Outubro de 2026</span>
  </section>`;
  const folha = `<section class="folha t">${pista(1123, 794, 620, 572, 640)}
    <header class="cab">${placaSvg('BR-KMC', 'KM', '02', 60)}<div><div class="lima">Capítulo 02</div><h2 class="prata">Tela inicial</h2></div></header>
    <div class="cdk lista">${onda('main')}<span class="cl">Na tela</span><ol>${ITENS_INICIO.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol></div>
    ${cel('01-inicio', { w: 196, cls: 'reflexo', estilo: 'left:474px;top:214px' })}
    <div class="cdk cleg">${onda('main')}<span class="cl">Na foto</span><h3 class="prata">A legenda gravada</h3>${pilha(132)}
      <ol class="ileg">${ITENS_LEG.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol><p class="nota">${NOTA_LEG}</p></div>
    <span class="pe pe-e">KM Check · Manual do usuário</span><span class="pe">Folha <b>03</b> de 08 · Desenvolvido por Wagner Machado</span>
  </section>`;
  return { css, html: capa + folha };
})();

const p = await browser.newPage();
await p.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1.6 });
for (const [i, op] of [op4, op5, op6].entries()) {
  const n = i + 4;
  const doc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual KM Check · opção ${n}</title>${FONTES}<style>${BASE}${CSS_APP}${CSS_CEL}${op.css}</style></head><body>${DEFS}${op.html}</body></html>`;
  fs.writeFileSync(path.join(SAIDA, `opcao-${n}.html`), doc);
  await p.setContent(doc, { waitUntil: 'load', timeout: 120000 }); await new Promise(r => setTimeout(r, 1500));
  await p.evaluateHandle('document.fonts.ready');
  await (await p.$('body')).screenshot({ path: path.join(SAIDA, `opcao-${n}.png`) });
  console.log('opção', n, 'ok');
}
await browser.close();
