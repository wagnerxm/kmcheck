/* Manual do KM Check, direção "Painel de bordo" em fundo claro abstrato.
 * Prévia: topo interativo da página web (pontos sobre o celular, tela que muda ao passar o dedo,
 * detalhe com zoom, menus Dia e noite / Em pé ou deitado) + capa e uma folha em A4 deitado.
 * Gera manual-kmcheck/previa-v4.html e capturas em manual-kmcheck/opcoes/v4-*.png.
 * Uso: node manual-kmcheck/estudio/montar-v4.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, PR, esc, conversor, fabricaCelular, CSS_CEL, ITENS_INICIO, ITENS_LEG, NOTA_LEG, LEG_Y } from './comum.mjs';

const SAIDA = path.join(RAIZ, 'opcoes'); fs.mkdirSync(SAIDA, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const conv = await browser.newPage(), webp = conversor(conv);
const IMG = {};
for (const n of ['01-inicio', '10-camera', '20-carro-dia', '21-carro-noite']) IMG[n] = await webp(path.join(PR, n + '.png'), 720);
IMG['22-carro-deitado'] = await webp(path.join(PR, '22-carro-deitado.png'), 1300);
const FOTO_ARQ = path.join(RAIZ, 'estudio/foto-campo-rodovia.webp');
const FOTO = await webp(FOTO_ARQ, 1200, [0, 0, 1, .78]);
const FOTO_PALCO = await webp(FOTO_ARQ, 1600, [0, 0, 1, .78]);
const FOTO_LEG = await webp(FOTO_ARQ, 1000, [0, .80, .56, .20]);
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('logo-header.png')).toString('base64');
await conv.close();
const cel = fabricaCelular(IMG);
const VERSAO = '292';

const idx = fs.readFileSync(path.resolve('index.html'), 'utf8');
const ini = idx.indexOf('<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>');
const DEFS = idx.slice(ini, idx.indexOf('</defs></svg>', ini) + 13);
const onda = (s = 'main') => `<svg class="cwv" aria-hidden="true"><use href="#car-a${s}"/></svg>`;
const placaSvg = (a, b, c, w) => `<svg class="placa" viewBox="0 0 150 178" style="width:${w}px" aria-hidden="true"><rect x="2" y="2" width="146" height="174" rx="14" fill="#fff"/><rect x="10" y="10" width="130" height="158" rx="9" fill="#13305c"/><rect x="10" y="10" width="130" height="70" rx="9" fill="#fff" fill-opacity=".05"/><text x="75" y="52" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="${a.length >= 6 ? 22 : 31}" fill="#fff">${a}</text><line x1="24" y1="68" x2="126" y2="68" stroke="#fff" stroke-width="3"/><text x="75" y="110" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="34" fill="#fff">${b}</text><text x="75" y="156" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="42" fill="#fff">${c}</text></svg>`;

/* fundo claro abstrato: o mesmo "cetim" das dobras dos cartões do app, só que em tons claros,
   com um único fio verde-limão atravessando. Vira imagem SVG de fundo, escala sem perder nitidez. */
const CETIM = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 1000' preserveAspectRatio='none'>
<defs><filter id='b' x='-10%' y='-50%' width='120%' height='200%'><feGaussianBlur stdDeviation='28'/></filter>
<linearGradient id='h' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.95'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>
<linearGradient id='s' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='#9aa6b2' stop-opacity='.38'/><stop offset='1' stop-color='#9aa6b2' stop-opacity='0'/></linearGradient>
<linearGradient id='l' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#b7d92d' stop-opacity='0'/><stop offset='.3' stop-color='#b7d92d' stop-opacity='.75'/><stop offset='.55' stop-color='#b7d92d' stop-opacity='.15'/><stop offset='.85' stop-color='#c9e463' stop-opacity='.85'/><stop offset='1' stop-color='#b7d92d' stop-opacity='0'/></linearGradient></defs>
<path d='M0,330 C260,250 520,280 800,350 C1080,420 1340,400 1600,300 L1600,210 C1340,300 1080,320 800,250 C520,180 260,150 0,240 Z' fill='url(#s)' filter='url(#b)'/>
<path d='M0,330 C260,250 520,280 800,350 C1080,420 1340,400 1600,300 L1600,440 C1340,540 1080,560 800,490 C520,420 260,390 0,470 Z' fill='url(#h)' filter='url(#b)'/>
<path d='M0,640 C300,560 640,620 940,660 C1200,694 1420,650 1600,600 L1600,520 C1420,570 1200,614 940,580 C640,540 300,480 0,560 Z' fill='url(#s)' filter='url(#b)'/>
<path d='M0,640 C300,560 640,620 940,660 C1200,694 1420,650 1600,600 L1600,740 C1420,790 1200,834 940,800 C640,760 300,700 0,780 Z' fill='url(#h)' filter='url(#b)' opacity='.85'/>
<path d='M0,900 C380,840 820,900 1600,860 L1600,1000 L0,1000 Z' fill='url(#s)' filter='url(#b)' opacity='.7'/>
<path d='M0,332 C260,252 520,282 800,352 C1080,422 1340,402 1600,302' fill='none' stroke='url(#l)' stroke-width='1.6'/>
<path d='M0,642 C300,562 640,622 940,662 C1200,696 1420,652 1600,602' fill='none' stroke='#fff' stroke-opacity='.9' stroke-width='1.2'/>
</svg>`)}")`;
const GRAO = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .1 0 0 0 0 .12 0 0 0 0 .16 .05 0 0 0 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;
const FUNDO = `${GRAO},${CETIM} center/100% 100% no-repeat,radial-gradient(1200px 800px at 18% 0%,#ffffff 0%,#f1f2f1 45%,#e4e7ea 100%)`;

const CSS_APP = `
.cdk{position:relative;overflow:hidden;border:1px solid transparent;border-radius:26px;color:#fff;
  background:radial-gradient(120% 60% at 12% -8%,rgba(255,255,255,.10),rgba(255,255,255,0) 55%) padding-box,radial-gradient(90% 70% at 105% 110%,rgba(0,0,0,.55),rgba(0,0,0,0) 60%) padding-box,linear-gradient(168deg,#2a2c30 0%,#1d1f22 30%,#141517 62%,#0b0c0d 100%) padding-box,linear-gradient(180deg,rgba(255,255,255,.26),rgba(255,255,255,.06) 30%,rgba(255,255,255,.03) 70%,rgba(255,255,255,.10)) border-box;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 1px rgba(0,0,0,.10),0 10px 18px -6px rgba(15,20,30,.22),0 34px 54px -22px rgba(15,20,30,.55)}
.cdk .cwv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.cdk>*:not(.cwv){position:relative}
.cl{text-transform:uppercase;color:#cfd2d7;font-weight:500;font-size:10px;letter-spacing:.26em}
.prata{background:linear-gradient(180deg,#fff 0%,#fff 55%,#dfe3e8 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 4px 14px rgba(0,0,0,.55))}
.lima{color:#b7d92d;text-shadow:0 0 18px rgba(196,226,74,.18)}
.trilho{position:relative;height:8px;border-radius:999px;background:linear-gradient(180deg,#0a0b0c,#18191b);box-shadow:inset 0 1px 2px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.06)}
.trilho i{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,#8eb31f,#c6e64c);box-shadow:0 0 12px rgba(183,217,45,.35)}
.trilho b{position:absolute;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:radial-gradient(circle at 40% 30%,#fff,#e4e7ea 70%);box-shadow:0 0 0 3px rgba(196,226,74,.22),0 3px 8px rgba(0,0,0,.6)}
.n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#b7d92d;color:#1d2606;font:800 10.5px/1 Inter,sans-serif;flex:0 0 auto}
.pilha{position:relative}
.pilha .f1{display:block;width:100%;object-fit:cover;object-position:50% 64%;border-radius:14px}
.pilha .f2w{position:relative;margin:-34px -6px 0 28px}
.pilha .f2{display:block;width:100%;border-radius:8px;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 16px 30px -12px rgba(0,0,0,.8)}
.mk2{position:absolute;left:-24px;margin-top:-11px;box-shadow:0 0 0 3px #15171a}
`;

/* ======================= TOPO INTERATIVO (página web) ======================= */
/* pontos do detalhe: posição na tela do celular (%), título e explicação */
const DET = {
  camera: { tela: '10-camera', olho: 'Capítulo 03', titulo: 'Registrar evidência', texto: 'A câmera mostra a legenda ao vivo, exatamente como ela vai gravada na foto.', pontos: [
    [37.2, 70.6, 'Legenda ao vivo', 'Rodovia, KM, lado, estaca, contrato e coordenadas, do jeito que saem na foto.'],
    [7.9, 89.6, 'Lado da pista', 'LD ou LE. Toque de novo no mesmo botão para tirar o lado da legenda.'],
    [50, 89.6, 'Obturador', 'Tira a foto. Sem um GPS confiável, o app avisa e não deixa registrar.']] },
  carro: { tela: '20-carro-dia', olho: 'Capítulo 05', titulo: 'Modo Carro', texto: 'Um painel grande para acompanhar a rodovia dirigindo, com o celular no suporte.', pontos: [
    [50, 41.4, 'KM ao vivo', 'Quilômetro exato, atualizado pelo GPS enquanto você dirige.'],
    [50, 51.1, 'Próximo km', 'A barra e os metros que faltam para o próximo quilômetro.'],
    [73.2, 75.4, 'Lado', 'Crescente ou Decrescente, pelo sentido em que o KM está mudando.']] },
};
const PONTOS = [
  { id: 'camera', x: 50, y: 88.9, rot: 'Registrar evidência', tipo: 'det' },
  { id: 'carro', x: 86.7, y: 20, rot: 'Modo Carro', tipo: 'det' },
  { id: 'noite', x: 50, y: 42.9, rot: 'Dia e noite', tipo: 'apa' },
  { id: 'girar', x: 50, y: 60.5, rot: 'Em pé ou deitado', tipo: 'apa' },
];
const MENUS = {
  noite: { titulo: 'Modo Carro', ops: [['dia', 'Dia'], ['noite', 'Noite']] },
  girar: { titulo: 'Celular', ops: [['pe', 'Em pé'], ['deitado', 'Deitado']] },
};
const telaImg = (n, cls = '') => `<img class="tl ${cls}" data-t="${n}" src="${IMG[n]}" alt="">`;
const hero = `
<section class="hero" id="topo" aria-label="Conheça o KM Check">
  <header class="h-top"><img class="h-logo" src="${LOGO}" alt="KM Check"><span class="h-meio">Manual do usuário</span><span>Versão ${VERSAO} · Outubro de 2026</span></header>
  <div class="h-tit"><h1>O KM certo,<br>em cada foto.</h1><p>Explore o app por dentro.<br>Toque num ponto para começar.</p></div>
  <div class="cena" data-modo="geral">
    <div class="palco">
      <img class="palco-foto" src="${FOTO_PALCO}" alt="">
      <div class="h-cel"><div class="h-moldura"><div class="h-tela">
        ${telaImg('01-inicio', 'on')}${telaImg('10-camera')}${telaImg('20-carro-dia')}${telaImg('21-carro-noite')}
        <div class="h-sb"><span>9:41</span><span class="h-ilha"></span><span class="h-bat"></span></div>
      </div></div>
        ${PONTOS.map(p => `<button class="ponto" data-p="${p.id}" style="left:${p.x}%;top:${p.y}%" aria-label="${p.rot}"><span class="disco" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8"/></svg></span><span class="rotulo">${p.rot}</span></button>`).join('')}
      </div>
      <div class="h-deitado" aria-hidden="true"><div class="h-moldura"><div class="h-tela">${telaImg('22-carro-deitado', 'on')}</div></div></div>
    </div>
    ${Object.entries(DET).map(([id, d]) => `<div class="det" data-det="${id}" hidden>
      <div class="det-cel"><div class="h-moldura"><div class="h-tela">${telaImg(d.tela, 'on')}</div></div>
        ${d.pontos.map((p, i) => `<button class="dp" data-i="${i}" style="left:${p[0]}%;top:${p[1]}%" aria-label="${p[2]}">${i + 1}</button>`).join('')}</div>
      <div class="det-txt cdk">${onda('main')}<div>
        <button class="voltar" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>Voltar</button>
        <span class="olho">${d.olho}</span><h2 class="prata">${d.titulo}</h2><p class="det-p">${d.texto}</p>
        <ol class="det-lista">${d.pontos.map((p, i) => `<li><button class="dl" data-i="${i}" aria-expanded="false"><span class="n">${i + 1}</span><b>${p[2]}</b></button><p>${p[3]}</p></li>`).join('')}</ol>
      </div></div>
    </div>`).join('')}
    <div class="moldura-branca" aria-hidden="true"></div>
  </div>
  <div class="dock-area">
    ${Object.entries(MENUS).map(([id, m]) => `<div class="dock cdk" data-menu="${id}" role="group" aria-label="${m.titulo}" hidden>${onda('tile')}<span class="cl">${m.titulo}</span><div class="ops">${m.ops.map(([v, r], i) => `<button class="op${i === 0 ? ' sel' : ''}" data-v="${v}" aria-pressed="${i === 0}">${r}</button>`).join('')}</div><button class="fechar" aria-label="Fechar"><svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3 3 9"/></svg></button></div>`).join('')}
    <div class="h-notas">
      <div><b>Registrar evidência</b><p>Veja a câmera por dentro. A legenda aparece ao vivo, como vai na foto.</p></div>
      <div><b>Modo Carro</b><p>O KM grande, para acompanhar a rodovia dirigindo.</p></div>
      <div><b>Dia e noite</b><p>O painel escurece sozinho 1 hora após o pôr do sol.</p></div>
      <div><b>Em pé ou deitado</b><p>Gire o celular e a tela se reorganiza.</p></div>
    </div>
  </div>
  <div class="h-base"><span>KM Check · Manual do usuário</span><span class="h-status" role="status">Toque num ponto para começar.</span></div>
</section>`;

const CSS_HERO = `
/* Topo interativo: a cena é um "palco" com a foto real da rodovia e o celular do app no meio.
   Pontos verde-limão: passar por cima mostra a tela daquele recurso; clicar entra no detalhe com
   zoom; os de aparência abrem um menu abaixo da moldura (nunca por cima do celular). */
.hero{max-width:1180px;margin:0 auto;padding:22px 24px 30px;color:#1c2333}
.h-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding-bottom:16px;border-bottom:1px solid rgba(28,35,51,.12);font-size:13px;color:#3b4559}
.h-top>span:last-child{text-align:right}
.h-logo{height:34px;width:auto}
.h-tit{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin:26px 0 18px}
.h-tit h1{font:800 clamp(34px,5.2vw,64px)/.98 Inter,sans-serif;letter-spacing:-.045em;margin:0}
.h-tit p{text-align:right;font-size:14px;line-height:1.55;color:#3b4559;margin:0}
.cena{position:relative;aspect-ratio:16/9;border-radius:16px;overflow:hidden;background:#cfd8de;isolation:isolate}
.moldura-branca{position:absolute;inset:0;border:3px solid #fff;border-radius:16px;pointer-events:none;z-index:9;box-shadow:0 30px 60px -36px rgba(28,35,51,.55)}
.palco{position:absolute;inset:0;transition:transform .62s cubic-bezier(.6,0,.25,1),opacity .5s ease;transform-origin:50% 55%}
.palco-foto{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 60%;filter:saturate(.9) brightness(1.02)}
.palco::after{content:'';position:absolute;inset:0;background:radial-gradient(60% 70% at 50% 50%,rgba(255,255,255,0) 30%,rgba(232,236,239,.45) 100%);pointer-events:none}
/* celular do palco */
.h-cel,.h-deitado{position:absolute;z-index:2}
.h-cel{left:50%;top:50%;height:84%;aspect-ratio:390/844;transform:translate(-50%,-50%);transition:transform .7s cubic-bezier(.5,0,.2,1),opacity .45s ease}
.h-moldura{position:relative;width:100%;height:100%;padding:3.4%;border-radius:16.5%/7.6%;background:linear-gradient(140deg,#4d525a 0%,#141517 18%,#0b0c0d 60%,#2d3136 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 0 0 1px #000,0 46px 70px -26px rgba(20,26,36,.75),0 14px 26px -12px rgba(20,26,36,.55)}
.h-tela{position:relative;width:100%;height:100%;border-radius:13.5%/6.2%;overflow:hidden;background:#0b0c0d}
.h-tela::after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.12) 0%,rgba(255,255,255,.04) 26%,transparent 40%);pointer-events:none}
.tl{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .42s ease}
.tl.on{opacity:1}
.h-sb{position:absolute;left:0;right:0;top:0;height:5.6%;display:flex;align-items:center;justify-content:space-between;padding:0 8% 0 10%;font:600 11px -apple-system,Inter,sans-serif;color:#121315;z-index:2;transition:color .4s}
.cena[data-tela="10-camera"] .h-cel .h-sb,.cena[data-tela="21-carro-noite"] .h-cel .h-sb{color:#fff}
.h-ilha{position:absolute;left:50%;top:22%;width:30%;height:60%;transform:translateX(-50%);background:#000;border-radius:999px}
.h-bat{width:20px;height:9px;border-radius:3px;border:1.3px solid currentColor;opacity:.8;position:relative}
.h-bat::after{content:'';position:absolute;inset:1.4px 3px 1.4px 1.4px;background:currentColor;border-radius:1px}
.h-deitado{left:50%;top:50%;width:76%;aspect-ratio:844/390;transform:translate(-50%,-50%) rotate(90deg) scale(.55);opacity:0;pointer-events:none;transition:transform .7s cubic-bezier(.5,0,.2,1),opacity .45s ease}
.h-deitado .h-moldura{border-radius:7.6%/16.5%;padding:1.6%}
.h-deitado .h-tela{border-radius:6.2%/13.5%}
.cena[data-girado] .h-cel{transform:translate(-50%,-50%) rotate(-90deg) scale(.9);opacity:0}
.cena[data-girado] .h-deitado{transform:translate(-50%,-50%) rotate(0) scale(1);opacity:1}
/* pontos: alvo de 48 px, disco verde-limão pequeno com "+" fino e rótulo discreto */
.ponto{position:absolute;width:48px;height:48px;margin:-24px 0 0 -24px;border:0;padding:0;background:none;cursor:pointer;z-index:4;display:grid;place-items:center;border-radius:50%}
.disco{width:26px;height:26px;border-radius:50%;background:#c9e463;display:grid;place-items:center;box-shadow:0 0 0 4px rgba(201,228,99,.28),0 6px 14px rgba(20,26,36,.35);transition:transform .25s ease,box-shadow .25s}
.disco svg{width:12px;height:12px;stroke:#1d2606;stroke-width:1.4;fill:none}
.ponto:hover .disco,.ponto:focus-visible .disco,.ponto.ativo .disco{transform:scale(1.14);box-shadow:0 0 0 7px rgba(201,228,99,.32),0 8px 18px rgba(20,26,36,.4)}
.ponto::before{content:'';position:absolute;inset:11px;border-radius:50%;border:1.5px solid rgba(201,228,99,.7);animation:pulso 2.6s ease-out infinite}
@keyframes pulso{0%{transform:scale(.8);opacity:.9}70%,100%{transform:scale(1.9);opacity:0}}
.ponto:focus-visible{outline:2px solid #fff;outline-offset:2px}
.rotulo{position:absolute;left:50%;bottom:calc(100% - 4px);transform:translate(-50%,6px);white-space:nowrap;font:600 12px Inter,sans-serif;color:#fff;background:rgba(20,23,25,.88);padding:6px 10px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.ponto:hover .rotulo,.ponto:focus-visible .rotulo{opacity:1;transform:translate(-50%,0)}
.ponto:disabled{opacity:0;pointer-events:none}
.ponto:disabled::before{animation:none;opacity:0}
.cena[data-girado] .ponto,.cena[data-menu] .ponto{opacity:0;pointer-events:none}
/* detalhe: o palco "avança" em zoom e some; o detalhe entra por cima */
.cena[data-modo="entrando"] .palco,.cena[data-modo="detalhe"] .palco{transform:scale(1.32);opacity:0}
.det{position:absolute;inset:0;z-index:5;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:4%;padding:3% 5%;opacity:0;transform:scale(1.05);transition:opacity .5s ease .12s,transform .62s cubic-bezier(.3,0,.2,1) .05s;
  background:${FUNDO}}
.det[hidden]{display:none}
.det.on{opacity:1;transform:scale(1)}
.det-cel{position:relative;height:88%;aspect-ratio:390/844;justify-self:center}
.dp{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:0;background:#c9e463;color:#1d2606;font:800 13px Inter,sans-serif;cursor:pointer;box-shadow:0 0 0 4px rgba(255,255,255,.65),0 6px 14px rgba(20,26,36,.4);transition:transform .2s}
.dp:hover,.dp.on{transform:scale(1.18)}
.dp.on{background:#fff}
.det-txt{padding:28px 28px 24px;border-radius:24px;max-height:100%;overflow:auto}
.voltar{display:inline-flex;align-items:center;gap:6px;font:600 12.5px Inter,sans-serif;color:#e8ebee;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:7px 14px 7px 10px;cursor:pointer;margin-bottom:18px}
.voltar svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.8;fill:none}
.voltar:hover{background:rgba(255,255,255,.14)}
.det-txt .olho{display:block;font:800 13px Inter,sans-serif;color:#b7d92d}
.det-txt h2{font:900 clamp(26px,3vw,38px)/1 Inter,sans-serif;letter-spacing:-.04em;margin:6px 0 10px}
.det-p{font-size:14.5px;line-height:1.5;color:#c4c9d0;margin:0}
.det-lista{list-style:none;margin:16px 0 0;padding:0}
.det-lista li{border-top:1px solid rgba(255,255,255,.09)}
.dl{display:flex;align-items:center;gap:12px;width:100%;background:none;border:0;padding:11px 0;color:#fff;cursor:pointer;text-align:left;font:700 15px Inter,sans-serif}
.dl[aria-expanded="true"] .n{background:#fff}
.det-lista p{display:none;margin:0 0 12px 34px;font-size:13.5px;line-height:1.5;color:#c4c9d0}
.dl[aria-expanded="true"]+p{display:block}
/* menus de aparência: abaixo da moldura, no lugar das notas */
.dock-area{position:relative;margin-top:16px;min-height:96px}
.dock{display:flex;align-items:center;gap:18px;padding:14px 16px 14px 22px;border-radius:18px;animation:sobe .3s ease}
.dock[hidden]{display:none}
@keyframes sobe{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.ops{display:flex;gap:8px;flex:1}
.op{font:600 13.5px Inter,sans-serif;color:#e8ebee;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:10px 18px;cursor:pointer}
.op.sel{background:#c9e463;color:#1d2606;border-color:#c9e463}
.fechar{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);display:grid;place-items:center;cursor:pointer}
.fechar svg{width:12px;height:12px;stroke:#fff;stroke-width:1.6}
.h-notas{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;transition:opacity .25s}
.h-notas b{display:block;font:700 15px Inter,sans-serif;color:#1c2333}
.h-notas p{font-size:13.5px;line-height:1.5;color:#3b4559;margin:6px 0 0}
.dock-area.menu .h-notas{opacity:0;visibility:hidden;position:absolute;inset:0}
.h-base{display:flex;justify-content:space-between;gap:16px;margin-top:18px;padding-top:14px;border-top:1px solid rgba(28,35,51,.12);font-size:12.5px;color:#3b4559}
@media (max-width:900px){
  .hero{padding:18px 20px 26px}
  .h-meio{display:none}
  .h-top{grid-template-columns:1fr auto}
  .h-tit{flex-direction:column;align-items:flex-start;gap:10px}
  .h-tit p{text-align:left}
  .cena{aspect-ratio:4/5}
  .h-cel{height:80%}
  .h-deitado{width:94%}
  .det{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);padding:16px;gap:14px;align-items:start;overflow:auto}
  .det-cel{height:auto;width:44%;justify-self:center}
  .h-notas{grid-template-columns:1fr 1fr;gap:16px 20px}
  .dock{flex-wrap:wrap}
}
@media (prefers-reduced-motion:reduce){
  .palco,.h-cel,.h-deitado,.tl,.det,.disco{transition:none!important}
  .ponto::before{animation:none}
}`;

/* comportamento: estados geral → entrando → detalhe → voltando → geral, e menus de aparência.
   Guardas: nada dispara durante uma transição; com menu aberto, os outros pontos ficam desligados. */
const JS_HERO = `
(() => {
  const cena = document.querySelector('.cena'), status = document.querySelector('.h-status'), area = document.querySelector('.dock-area');
  const pontos = [...cena.querySelectorAll('.ponto')];
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches, T = reduz ? 0 : 620;
  const HOVER = { camera: '10-camera', carro: '20-carro-dia' };
  const FRASES = { geral: 'Toque num ponto para começar.', camera: 'Câmera aberta. Toque nos números.', carro: 'Modo Carro aberto. Toque nos números.', noite: 'Escolha dia ou noite.', girar: 'Escolha em pé ou deitado.' };
  let modo = 'geral', menu = null, quer = null;
  const tela = n => { cena.dataset.tela = n; cena.querySelectorAll('.h-cel .tl').forEach(i => i.classList.toggle('on', i.dataset.t === n)); };
  const diz = t => { status.textContent = t; };
  /* passar o dedo/foco: mostra a tela do recurso; sair volta para a inicial */
  const mira = id => { if (modo !== 'geral' || menu) return; quer = id; tela(HOVER[id] || '01-inicio'); };
  const solta = id => { if (quer !== id || modo !== 'geral' || menu) return; quer = null; tela('01-inicio'); };
  function entra(id) {
    if (modo !== 'geral' || menu) return;
    const det = cena.querySelector('[data-det="' + id + '"]');
    modo = 'entrando'; cena.dataset.modo = 'entrando'; tela(HOVER[id]);
    det.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => det.classList.add('on')));
    pontos.forEach(p => p.disabled = true);
    setTimeout(() => { modo = 'detalhe'; cena.dataset.modo = 'detalhe'; det.querySelector('.voltar').focus({ preventScroll: true }); diz(FRASES[id]); }, T);
  }
  function volta() {
    if (modo !== 'detalhe') return;
    const det = cena.querySelector('.det:not([hidden])'), id = det.dataset.det;
    modo = 'voltando'; det.classList.remove('on'); cena.dataset.modo = 'geral'; tela('01-inicio');
    setTimeout(() => { det.hidden = true; det.querySelectorAll('[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false')); det.querySelectorAll('.dp.on').forEach(b => b.classList.remove('on'));
      modo = 'geral'; pontos.forEach(p => p.disabled = false); cena.querySelector('[data-p="' + id + '"]').focus({ preventScroll: true }); diz(FRASES.geral); }, T);
  }
  /* menus: só um por vez; mostram a escolha só depois de a tela voltar ao neutro */
  function abreMenu(id) {
    if (modo !== 'geral') return;
    if (menu === id) return fechaMenu();
    if (menu) fechaMenu(true);
    menu = id; quer = null; cena.dataset.menu = id;
    const d = area.querySelector('[data-menu="' + id + '"]');
    d.hidden = false; area.classList.add('menu');
    pontos.forEach(p => { p.disabled = p.dataset.p !== id; p.classList.toggle('ativo', p.dataset.p === id); });
    aplica(id, d.querySelector('.op.sel').dataset.v); d.querySelector('.op.sel').focus({ preventScroll: true }); diz(FRASES[id]);
  }
  function aplica(id, v) {
    if (id === 'noite') tela(v === 'noite' ? '21-carro-noite' : '20-carro-dia');
    if (id === 'girar') { if (v === 'deitado') cena.dataset.girado = ''; else delete cena.dataset.girado; }
  }
  function fechaMenu(silencio) {
    if (!menu) return;
    const id = menu, d = area.querySelector('[data-menu="' + id + '"]');
    d.hidden = true; area.classList.remove('menu'); menu = null; delete cena.dataset.menu;
    delete cena.dataset.girado; tela('01-inicio');
    pontos.forEach(p => { p.disabled = false; p.classList.remove('ativo'); });
    if (!silencio) { cena.querySelector('[data-p="' + id + '"]').focus({ preventScroll: true }); diz(FRASES.geral); }
  }
  pontos.forEach(p => {
    const id = p.dataset.p, det = ${JSON.stringify(Object.keys(DET))}.includes(id);
    p.addEventListener('pointerenter', () => det && mira(id));
    p.addEventListener('pointerleave', () => det && solta(id));
    p.addEventListener('focus', () => det && mira(id));
    p.addEventListener('blur', () => det && solta(id));
    p.addEventListener('click', () => det ? entra(id) : abreMenu(id));
  });
  area.querySelectorAll('.dock').forEach(d => {
    d.querySelectorAll('.op').forEach(o => o.addEventListener('click', () => {
      d.querySelectorAll('.op').forEach(x => { x.classList.toggle('sel', x === o); x.setAttribute('aria-pressed', x === o); });
      aplica(d.dataset.menu, o.dataset.v);
    }));
    d.querySelector('.fechar').addEventListener('click', () => fechaMenu());
  });
  cena.querySelectorAll('.det').forEach(det => {
    det.querySelector('.voltar').addEventListener('click', volta);
    const liga = i => {
      const b = det.querySelectorAll('.dl')[i], abre = b.getAttribute('aria-expanded') !== 'true';
      det.querySelectorAll('.dl').forEach((x, j) => x.setAttribute('aria-expanded', abre && j === i));
      det.querySelectorAll('.dp').forEach((x, j) => x.classList.toggle('on', abre && j === i));
    };
    det.querySelectorAll('.dl').forEach((b, i) => b.addEventListener('click', () => liga(i)));
    det.querySelectorAll('.dp').forEach((b, i) => b.addEventListener('click', () => liga(i)));
  });
  addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (modo === 'detalhe') volta(); else if (menu) fechaMenu(); });
  window.__hero = { entra, volta, abreMenu, fechaMenu, mira, solta, aplica };
})();`;

/* ======================= FOLHAS A4 (capa + Tela inicial) em fundo claro ======================= */
const CSS_FOLHA = `
.folha{position:relative;width:1123px;height:794px;overflow:hidden;background:${FUNDO};color:#1c2333;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:0 30px 60px -30px rgba(28,35,51,.45)}
.folha>*{position:absolute}.folha>.cel,.folha>.cdk{position:absolute}
.folha{--ln:#b7d92d;--ln-h:rgba(8,9,10,.7);--mk-bg:#b7d92d;--mk-fg:#1d2606;--mk-anel:#17191c;--f-dado:Inter,sans-serif;--cel-sombra:0 40px 60px -28px rgba(28,35,51,.6),0 14px 24px -12px rgba(28,35,51,.4)}
.cdk-main{left:44px;top:44px;width:648px;height:476px;padding:44px 48px}
.topo{display:flex;gap:28px;align-items:center}
.topo .lima{font:800 30px/1 Inter,sans-serif;letter-spacing:-.01em}
.topo .km{font:900 112px/.92 Inter,sans-serif;letter-spacing:-.045em;margin-top:6px}
.rot{display:block;text-align:center;font:500 13px Inter,sans-serif;letter-spacing:.42em;padding-left:.42em;text-transform:uppercase;color:#cfd2d7;margin-top:38px}
.cdk-main .trilho{width:78%;margin:26px auto 0}
.prox{text-align:center;margin-top:22px;font:400 19px Inter,sans-serif;color:#e2e4e8}
.prox b{color:#b7d92d;font-weight:800}
.tiles{left:44px;top:536px;width:648px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.tile{padding:18px 24px;border-radius:22px;height:98px}
.tile .cv{font:800 24px/1.1 Inter,sans-serif;margin-top:8px}
.tile.larga{grid-column:1/-1}
.capa-logo{left:742px;top:50px;height:44px}
.barra{left:44px;right:44px;top:28px;display:grid;grid-template-columns:auto 1fr auto;gap:26px;align-items:center}
.barra .cl{font-size:9.5px;color:#3b4559}
.barra .trilho{height:6px;background:linear-gradient(180deg,#c9ced4,#dde1e5);box-shadow:inset 0 1px 2px rgba(28,35,51,.25)}
.barra .trilho b{width:16px;height:16px;margin:-8px 0 0 -8px;box-shadow:0 0 0 3px rgba(196,226,74,.35),0 3px 8px rgba(28,35,51,.35)}
.ca{left:44px;top:74px;width:352px;height:676px;padding:30px 28px}
.ca .topo{gap:16px}
.ca .lima{font:800 15px/1 Inter,sans-serif;letter-spacing:.02em}
.ca h2{font:900 36px/1 Inter,sans-serif;letter-spacing:-.035em;margin-top:6px}
.ca .lead{font-size:13.5px;line-height:1.5;color:#c4c9d0;margin-top:16px}
.ca .cel{margin:40px auto 0}
.grade{left:412px;top:74px;width:330px;height:676px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(5,1fr);gap:12px}
.it{border-radius:20px;padding:15px 16px 14px;display:flex;flex-direction:column;gap:8px}
.it .cab{display:flex;align-items:center;gap:8px}
.it .cl{font-size:9px;letter-spacing:.2em;line-height:1.25}
.it p{font:600 13px/1.35 Inter,sans-serif;color:#f1f3f5}
.cleg{left:758px;top:74px;width:321px;height:676px;padding:26px 24px}
.cleg h3{font:900 24px/1.05 Inter,sans-serif;letter-spacing:-.03em;margin:8px 0 16px}
.ileg{list-style:none;margin:16px 0 0;padding:0}
.ileg li{display:flex;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.08)}
.ileg li:first-child{border-top:none}
.ileg b{display:block;font:700 13.5px Inter,sans-serif}
.ileg p{font-size:12px;color:#aeb5be;margin-top:2px}
.nota{font-size:11.5px;color:#8791a3;line-height:1.45;margin-top:10px}`;
const capa = `<section class="folha">
    <div class="cdk cdk-main">${onda('main')}
      <div class="topo">${placaSvg('MANUAL', 'KM', VERSAO, 132)}<div><div class="lima">Manual do usuário</div><div class="km prata">KM Check</div></div></div>
      <span class="rot">Guia completo</span>
      <div class="trilho"><i style="width:12.5%"></i><b style="left:12.5%"></b></div>
      <p class="prox"><b>8 folhas</b> do primeiro uso à foto no campo</p></div>
    <div class="tiles">
      <div class="cdk tile">${onda('tile')}<div class="cl">Versão</div><div class="cv">${VERSAO}</div></div>
      <div class="cdk tile">${onda('tilel')}<div class="cl">Aparelhos</div><div class="cv">iPhone e Android</div></div>
      <div class="cdk tile larga">${onda('tile')}<div class="cl">Desenvolvido por</div><div class="cv">Wagner Machado</div></div></div>
    <img class="capa-logo" src="${LOGO}" alt="KM Check">
    ${cel('10-camera', { numeros: false, w: 232, estilo: 'left:868px;top:126px;transform:rotate(6deg)' })}
    ${cel('20-carro-dia', { numeros: false, w: 262, estilo: 'left:728px;top:112px;transform:rotate(-3deg)' })}
  </section>`;
const folha = `<section class="folha">
    <div class="barra"><span class="cl">KM Check · Manual do usuário</span><div class="trilho"><i style="width:37.5%"></i><b style="left:37.5%"></b></div><span class="cl">Folha 03 de 08 · v${VERSAO}</span></div>
    <div class="cdk ca">${onda('main')}<div class="topo">${placaSvg('BR-KMC', 'KM', '02', 64)}<div><div class="lima">Capítulo 02</div><h2 class="prata">Tela inicial</h2></div></div>
      <p class="lead">O painel de campo: com o GPS, o app acha a rodovia mais próxima e mostra o KM exato.</p>${cel('01-inicio', { w: 184 })}</div>
    <div class="grade">${ITENS_INICIO.map((it, i) => `<div class="cdk it">${onda(i % 3 === 1 ? 'tilel' : 'tile')}<div class="cab"><span class="n">${i + 1}</span><span class="cl">${esc(it[0])}</span></div><p>${esc(it[1])}</p></div>`).join('')}</div>
    <div class="cdk cleg">${onda('main')}<span class="cl">Na foto</span><h3 class="prata">A legenda gravada</h3><div class="pilha"><img class="f1" src="${FOTO}" alt="" style="height:138px"><div class="f2w"><img class="f2" src="${FOTO_LEG}" alt="">${LEG_Y.map((y, i) => `<span class="n mk2" style="top:${y}%">${i + 1}</span>`).join('')}</div></div>
      <ol class="ileg">${ITENS_LEG.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol><p class="nota">${NOTA_LEG}</p></div>
  </section>`;

const CSS_PAGINA = `
:root{color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0}
body{font-family:Inter,-apple-system,'SF Pro Text',Helvetica,Arial,sans-serif;background:${FUNDO};color:#1c2333}
h1,h2,h3,p{margin:0}
.folhas{max-width:1180px;margin:0 auto;padding:10px 24px 60px;display:grid;gap:28px}
.folhas h2.sec{font:800 13px Inter,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#5c7690}
.escala{width:100%;container-type:inline-size}
.escala>.folha{transform-origin:0 0}`;
const JS_ESCALA = `(() => { const ajusta = () => document.querySelectorAll('.escala').forEach(e => { const f = e.firstElementChild, k = Math.min(1, e.clientWidth / 1123); f.style.transform = 'scale(' + k + ')'; e.style.height = (794 * k) + 'px'; }); addEventListener('resize', ajusta); ajusta(); })();`;
const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap">';
const corpo = `<title>Manual KM Check</title>${FONTES}<style>${CSS_PAGINA}${CSS_APP}${CSS_CEL}${CSS_HERO}${CSS_FOLHA}</style>
${DEFS}
<main>${hero}
<section class="folhas" aria-label="Folhas do manual"><h2 class="sec">Folhas do manual</h2><div class="escala">${capa}</div><div class="escala">${folha}</div></section></main>
<script>${JS_HERO}${JS_ESCALA}</script>`;
fs.writeFileSync(path.join(RAIZ, 'previa-v4.html'), corpo);
const doc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + corpo + '</body></html>';
fs.writeFileSync(path.join(SAIDA, 'previa-v4-doc.html'), doc);

/* capturas dos estados do topo + as folhas, no computador e no celular */
const p = await browser.newPage();
const erros = []; p.on('pageerror', e => erros.push(e.message)); p.on('console', m => m.type() === 'error' && erros.push(m.text()));
async function abre(w, h) { await p.setViewport({ width: w, height: h, deviceScaleFactor: 1.5 }); await p.setContent(doc, { waitUntil: 'load', timeout: 120000 }); await new Promise(r => setTimeout(r, 1200)); await p.evaluateHandle('document.fonts.ready'); }
const foto = async nome => { const el = await p.$('.hero'); await el.screenshot({ path: path.join(SAIDA, `v4-${nome}.png`) }); };
const espera = ms => new Promise(r => setTimeout(r, ms));
await abre(1440, 900);
await foto('1-geral');
await p.hover('[data-p="camera"]'); await espera(700); await foto('2-hover-camera');
await p.click('[data-p="camera"]'); await espera(900); await p.click('.det[data-det="camera"] .dl[data-i="0"]'); await espera(300); await foto('3-detalhe-camera');
await p.keyboard.press('Escape'); await espera(900);
await p.mouse.move(5, 5); await p.click('[data-p="noite"]'); await espera(300); await p.click('[data-menu="noite"] .op[data-v="noite"]'); await espera(700); await foto('4-menu-noite');
await p.keyboard.press('Escape'); await espera(500);
await p.click('[data-p="girar"]'); await espera(300); await p.click('[data-menu="girar"] .op[data-v="deitado"]'); await espera(1000); await foto('5-menu-deitado');
await p.keyboard.press('Escape'); await espera(800);
const est = await p.evaluate(() => ({ modo: document.querySelector('.cena').dataset.modo, desligados: [...document.querySelectorAll('.ponto')].filter(b => b.disabled).length, larg: document.documentElement.scrollWidth }));
console.log('estado final', JSON.stringify(est));
const folhas = await p.$$('.folha'); for (let i = 0; i < folhas.length; i++) await folhas[i].screenshot({ path: path.join(SAIDA, `v4-folha-${i + 1}.png`) });
await abre(390, 844);
await foto('6-celular');
console.log('largura no celular', await p.evaluate(() => document.documentElement.scrollWidth));
console.log('erros', erros.length ? erros : 'nenhum');
await browser.close();
