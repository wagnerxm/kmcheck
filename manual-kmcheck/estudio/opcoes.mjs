/* Três direções visuais para o manual (capa + uma folha de conteúdo cada), para escolher.
 * Gera manual-kmcheck/opcoes/opcao-N.png (as duas folhas empilhadas) e opcao-N.html.
 * Uso: node manual-kmcheck/estudio/opcoes.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, PR, esc, conversor, fabricaCelular, placa, CSS_CEL, curvasDeNivel, eixo, ITENS_INICIO, ITENS_LEG, NOTA_LEG, ARQUIVO, LEG_Y } from './comum.mjs';

const SAIDA = path.join(RAIZ, 'opcoes'); fs.mkdirSync(SAIDA, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const conv = await browser.newPage(), webp = conversor(conv);
const IMG = {};
for (const n of ['01-inicio', '10-camera', '20-carro-dia']) IMG[n] = await webp(path.join(PR, n + '.png'), 780);
const FOTO_ARQ = path.join(RAIZ, 'estudio/foto-campo-rodovia.webp');
const FOTO = await webp(FOTO_ARQ, 1600, [0, 0, 1, .78]);          // sem a legenda gravada
const FOTO_LEG = await webp(FOTO_ARQ, 1100, [0, .80, .56, .20]);  // a legenda ampliada
const FOTO_FUNDO = await webp(FOTO_ARQ, 700, [0, 0, 1, .78]);     // vai borrada, pode ser pequena
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('logo-header.png')).toString('base64');
await conv.close();
const cel = fabricaCelular(IMG);
const VERSAO = '292';
const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,500..800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600;700&family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">';
const BASE = `*{box-sizing:border-box}html,body{margin:0}h1,h2,h3,p{margin:0}
.folha{position:relative;width:1123px;height:794px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{display:grid;gap:28px;padding:28px;background:#3a3c40;width:max-content}
.folha>*{position:absolute}
.folha>.cel{position:absolute}`;
const grao = (cor, alfa, f = .9) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${f}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${cor} 0 0 0 0 ${cor} 0 0 0 0 ${cor} ${alfa} 0 0 0 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;
const listaItens = (itens, cls = 'itens') => `<ol class="${cls}">${itens.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol>`;
const pilhaLegenda = () => `<div class="pilha"><img class="f1" src="${FOTO}" alt=""><div class="f2w"><img class="f2" src="${FOTO_LEG}" alt="">${LEG_Y.map((y, i) => `<span class="mk2" style="top:${y}%">${i + 1}</span>`).join('')}</div></div>`;

/* ============ 1. CARTA TOPOGRÁFICA: azul da placa, curvas de nível, eixo com estacas ============ */
const op1 = (() => {
  const marcasGrade = (() => { let d = ''; for (let x = 140; x < 1123; x += 140) for (let y = 132; y < 794; y += 132) d += `M${x - 5},${y}H${x + 5}M${x},${y - 5}V${y + 5}`; return `<svg class="grade" viewBox="0 0 1123 794"><path d="${d}"/></svg>` })();
  const moldura = (cap, folha) => `<div class="moldura"></div>
    <span class="coord c1">06°04'39" S</span><span class="coord c2">37°32'15" W</span><span class="coord c3">KM Check · Manual do usuário</span><span class="coord c4">Desenvolvido por Wagner Machado</span>
    <div class="carimbo"><div><small>Capítulo</small><b>${cap}</b></div><div><small>Folha</small><b>${folha} / 08</b></div><div><small>Versão</small><b>${VERSAO}</b></div></div>`;
  const css = `
/* Carta topográfica: o fundo é o azul da placa de km, com curvas de nível e a grade de uma carta.
   O eixo da rodovia (com as estacas) atravessa as folhas e amarra tudo. Tipografia larga, de placa. */
.t{--ink:#0a1930;--txt:#eef3f8;--txt2:#a7b5c7;--txt3:#6d7f97;--acc:#c8e53c;--acc-esc:#203008;--f-tit:'Archivo',Arial,sans-serif;--f-txt:'IBM Plex Sans',Arial,sans-serif;--f-dado:'IBM Plex Mono',monospace;
  --curva:rgba(160,195,235,.075);--curva-mestra:rgba(160,195,235,.14);--ln:var(--acc);--ln-h:rgba(5,12,24,.75);--mk-bg:var(--acc);--mk-fg:var(--acc-esc);--mk-anel:#0c1d36;
  background:${grao(1, .1)},radial-gradient(1100px 760px at 64% 30%,#173257 0%,#0e2341 46%,#081428 100%);color:var(--txt);font-family:var(--f-txt)}
.topo,.grade,.eixo{inset:0;width:100%;height:100%}
.grade path{stroke:rgba(190,215,245,.22);stroke-width:1;fill:none}
.eixo-h{fill:none;stroke:rgba(4,10,20,.6);stroke-width:7}
.eixo-l{fill:none;stroke:var(--acc);stroke-width:2.2}
.eixo-t{fill:none;stroke:var(--acc);stroke-width:1.2;opacity:.85}
.eixo text{font:500 9px var(--f-dado);fill:var(--acc);letter-spacing:.06em}
.moldura{inset:22px;border:1px solid rgba(190,215,245,.22)}
.moldura::after{content:'';position:absolute;inset:5px;border:1px solid rgba(190,215,245,.08)}
.coord{font:500 9px var(--f-dado);letter-spacing:.18em;text-transform:uppercase;color:var(--txt3);background:#0b1b33;padding:0 8px}
.c1{left:52px;top:16px}.c2{right:52px;top:16px}.c3{left:52px;bottom:16px}.c4{right:52px;bottom:16px}
.c4,.c3{color:var(--txt2)}
.carimbo{right:40px;bottom:44px;display:grid;grid-template-columns:repeat(3,auto);border:1px solid rgba(190,215,245,.3);background:rgba(8,20,40,.88)}
.carimbo div{padding:6px 14px 7px;border-left:1px solid rgba(190,215,245,.2);min-width:78px}
.carimbo div:first-child{border-left:none}
.carimbo small{display:block;font:500 8px var(--f-dado);letter-spacing:.18em;text-transform:uppercase;color:var(--txt3)}
.carimbo b{font:700 14px var(--f-tit);font-stretch:112%;font-variant-numeric:tabular-nums}
.placa{display:inline-block;width:62px;aspect-ratio:150/178;background:#f4f6f8;border-radius:8px;padding:3.5px;box-shadow:0 10px 22px rgba(0,0,0,.45);flex:0 0 auto}
.placa-in{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#13305c;border-radius:5px;color:#fff;font:800 14px/1 var(--f-tit);font-stretch:110%}
.placa i{width:72%;height:2px;background:#fff;margin:5px 0}.placa em{font-style:normal;font-size:25px}
.olho{display:block;font:500 11px var(--f-dado);letter-spacing:.24em;text-transform:uppercase;color:var(--acc)}
/* capa */
.logo{left:64px;top:64px;height:52px}
.capa-txt{left:64px;top:214px;width:520px}
.capa h1{font:800 124px/.84 var(--f-tit);font-stretch:125%;letter-spacing:-.02em;margin-top:18px}
.capa h1 span{display:block;color:var(--acc)}
.capa .sub{font-size:17.5px;line-height:1.55;color:var(--txt2);margin-top:28px;max-width:27em}
.dados{display:flex;gap:0;margin-top:30px;border:1px solid rgba(190,215,245,.22);width:max-content}
.dados span{padding:9px 16px;border-left:1px solid rgba(190,215,245,.22);font:500 10.5px var(--f-dado);letter-spacing:.14em;text-transform:uppercase;color:var(--txt2)}
.dados span:first-child{border-left:none}.dados b{color:var(--txt);font-weight:600}
/* folha */
.cab{left:64px;top:62px;right:64px;display:flex;gap:22px;align-items:center}
.cab h2{font:800 40px/1 var(--f-tit);font-stretch:118%;letter-spacing:-.01em;margin-top:8px}
.cab p{font-size:15px;color:var(--txt2);margin-top:9px}
.legbox{left:356px;top:184px;width:368px;border:1px solid rgba(190,215,245,.24);background:rgba(8,20,40,.72)}
.legbox header,.detalhe header{display:flex;justify-content:space-between;font:600 9.5px var(--f-dado);letter-spacing:.2em;text-transform:uppercase;color:var(--txt3);padding:9px 14px;border-bottom:1px solid rgba(190,215,245,.18)}
.legbox header b,.detalhe header b{color:var(--acc);font-weight:600}
.itens{list-style:none;margin:0;padding:4px 14px 8px}
.itens li{display:grid;grid-template-columns:30px minmax(0,1fr);gap:8px;padding:7px 0 7px;border-top:1px dashed rgba(190,215,245,.13)}
.itens li:first-child{border-top:none}
.n{width:22px;height:22px;border-radius:50%;background:var(--acc);color:var(--acc-esc);font:600 10.5px/22px var(--f-dado);text-align:center}
.itens b{display:block;font:700 13.5px/1.2 var(--f-tit);font-stretch:108%}
.itens p{font-size:12.5px;color:var(--txt2);line-height:1.3;margin-top:2px}
.detalhe{left:752px;top:184px;width:331px;border:1px solid rgba(190,215,245,.24);background:rgba(8,20,40,.72)}
.detalhe .corpo{padding:14px}
.pilha{position:relative;height:214px}
.pilha .f1{position:absolute;inset:0 0 auto;width:100%;height:158px;object-fit:cover;object-position:50% 64%}
.pilha .f2w{position:absolute;left:12px;right:-6px;bottom:0}
.pilha .f2{display:block;width:100%;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 18px 34px -12px rgba(0,0,0,.9)}
.mk2{position:absolute;left:-11px;width:20px;height:20px;margin-top:-10px;border-radius:50%;background:var(--acc);color:var(--acc-esc);font:600 10px/20px var(--f-dado);text-align:center;box-shadow:0 0 0 3px #0c1d36}
.itens-leg{padding:10px 0 0;display:grid;grid-template-columns:1fr 1fr;column-gap:14px}
.itens-leg li:nth-child(2){border-top:none}
.nota{font-size:11.5px;color:var(--txt3);margin-top:8px;line-height:1.4}
.arq{margin-top:10px;padding-top:9px;border-top:1px dashed rgba(190,215,245,.18);font:500 9.5px var(--f-dado);color:var(--txt2)}
${CSS_CEL}`;
  const capa = `<section class="folha t capa">${curvasDeNivel(1123, 794, [[860, 270, 24, 22, .4], [140, 700, 14, 26, 2.1], [1080, 790, 8, 30, 4]])}${marcasGrade}
    ${eixo(1123, 794, [[-30, 742], [380, 716], [700, 640], [1160, 586]], 24)}
    <img class="logo" src="${LOGO}" alt="KM Check">
    <div class="capa-txt"><span class="olho">Manual do usuário</span><h1>KM<span>Check</span></h1>
      <p class="sub">Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na própria foto. Direto do campo, sem depender de internet.</p>
      <div class="dados"><span>Versão <b>${VERSAO}</b></span><span>Outubro de 2026</span><span>iPhone e Android</span></div></div>
    ${cel('01-inicio', { numeros: false, w: 222, estilo: 'left:880px;top:96px;transform:rotate(5deg)' })}
    ${cel('10-camera', { numeros: false, w: 256, estilo: 'left:660px;top:66px;transform:rotate(-3deg)' })}
    ${moldura('Capa', '01')}</section>`;
  const folha = `<section class="folha t">${curvasDeNivel(1123, 794, [[980, 120, 18, 24, 1.3], [260, 860, 16, 26, 3.2]])}${marcasGrade}
    ${eixo(1123, 794, [[-30, 742], [300, 700], [700, 760], [1160, 700]], 24, 2)}
    <header class="cab">${placa('KM', '02')}<div><span class="olho">Capítulo 02</span><h2>Tela inicial e a legenda</h2><p>O painel de campo: com o GPS, o app acha a rodovia mais próxima e mostra o KM exato.</p></div></header>
    ${cel('01-inicio', { w: 190, estilo: 'left:110px;top:214px' })}
    <section class="legbox"><header><span>Legenda</span><b>Tela inicial</b></header>${listaItens(ITENS_INICIO)}</section>
    <section class="detalhe"><header><span>Detalhe A</span><b>Legenda da foto</b></header><div class="corpo">${pilhaLegenda()}${listaItens(ITENS_LEG, 'itens itens-leg')}<p class="nota">${NOTA_LEG}</p><p class="arq">${ARQUIVO}</p></div></section>
    ${moldura('02', '03')}</section>`;
  return { css, html: capa + folha };
})();

/* ============ 2. EDITORIAL CLARO: papel, faixa dupla amarela, serifa itálica, grade suíça ============ */
const op2 = (() => {
  const pe = (cap, folha) => `<footer class="pe"><span>KM Check <i>·</i> Manual do usuário</span><span>Desenvolvido por Wagner Machado</span><span>Capítulo ${cap} <i>·</i> Folha ${folha} / 08 <i>·</i> v${VERSAO}</span></footer>`;
  const css = `
/* Editorial claro: papel quente, a faixa dupla amarela contínua da pista na lateral, títulos em
   serifa itálica com texto em sans de precisão. Muito respiro, fios finos, celulares com sombra de estúdio. */
.t{--papel:#f3f0e9;--tinta:#131313;--tinta2:#57534b;--tinta3:#918b80;--fio:#d8d2c6;--amarelo:#f0b91f;--f-tit:'Instrument Serif',Georgia,serif;--f-txt:'Instrument Sans',Arial,sans-serif;--f-dado:'JetBrains Mono',monospace;
  --ln:#131313;--ln-h:rgba(255,255,255,.85);--mk-bg:#131313;--mk-fg:#fff;--mk-anel:var(--papel);--cel-sombra:0 50px 70px -36px rgba(40,32,20,.55),0 14px 24px -12px rgba(40,32,20,.35);
  background:${grao(0, .07, .75)},radial-gradient(900px 700px at 70% 30%,#f8f6f1 0%,#f1eee6 60%,#e9e5db 100%);color:var(--tinta);font-family:var(--f-txt)}
.faixa{left:40px;top:0;bottom:0;width:22px;background:linear-gradient(90deg,var(--amarelo) 0 8px,transparent 8px 14px,var(--amarelo) 14px 22px)}
.olho{display:block;font:500 10.5px var(--f-dado);letter-spacing:.22em;text-transform:uppercase;color:var(--tinta3)}
.pe{left:96px;right:44px;bottom:26px;display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid var(--fio);font:500 9.5px var(--f-dado);letter-spacing:.16em;text-transform:uppercase;color:var(--tinta3)}
.pe i{font-style:normal;color:var(--amarelo);margin:0 3px}
/* capa */
.capa .olho{left:96px;top:66px}
.capa h1{left:92px;top:160px;font:400 140px/.84 var(--f-tit);letter-spacing:-.02em}
.capa h1 em{display:block;font-style:italic;margin-left:64px}
.capa .sub{left:98px;top:470px;width:360px;font-size:17px;line-height:1.55;color:var(--tinta2)}
.capa .logo{left:98px;top:640px;height:40px}
.quadro{left:560px;top:60px;width:480px;height:600px;padding:12px;background:#fff;box-shadow:0 40px 70px -40px rgba(40,32,20,.55),0 2px 6px rgba(40,32,20,.12)}
.quadro img{width:100%;height:100%;object-fit:cover;object-position:52% 60%;display:block}
.legenda-q{left:780px;top:676px;width:260px;display:flex;justify-content:space-between;font:500 9.5px var(--f-dado);letter-spacing:.14em;text-transform:uppercase;color:var(--tinta3)}
/* folha */
.num{left:84px;top:-46px;font:400 300px/1 var(--f-tit);color:transparent;-webkit-text-stroke:1.4px #d6cfc0;letter-spacing:-.04em}
.cab{left:330px;top:58px;width:700px}
.cab h2{font:400 60px/.95 var(--f-tit);font-style:italic;letter-spacing:-.01em;margin-top:10px}
.cab h2 span{font-style:normal}
.cab p{font-size:15.5px;color:var(--tinta2);margin-top:12px;max-width:34em}
.itens{left:380px;top:254px;width:372px;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;column-gap:26px}
.itens li{display:grid;grid-template-columns:26px minmax(0,1fr);gap:6px;padding:10px 0 11px;border-top:1px solid var(--fio)}
.n{font:500 11px/1.6 var(--f-dado);color:var(--tinta3)}
.itens b{display:block;font:600 14px/1.25 var(--f-txt);letter-spacing:-.005em}
.itens p{font-size:12.5px;color:var(--tinta2);line-height:1.35;margin-top:3px}
.fig{left:786px;top:254px;width:294px}
.pilha{position:relative;height:200px}
.pilha .f1{position:absolute;inset:0 0 auto;width:100%;height:150px;object-fit:cover;object-position:50% 64%}
.pilha .f2w{position:absolute;left:10px;right:-8px;bottom:0}
.pilha .f2{display:block;width:100%;box-shadow:0 20px 30px -16px rgba(40,32,20,.6)}
.mk2{position:absolute;left:-10px;width:19px;height:19px;margin-top:-9.5px;border-radius:50%;background:#131313;color:#fff;font:600 9.5px/19px var(--f-dado);text-align:center;box-shadow:0 0 0 2.5px var(--papel)}
.cap-fig{font:500 9.5px var(--f-dado);letter-spacing:.14em;text-transform:uppercase;color:var(--tinta3);margin-top:14px}
.cap-fig b{color:var(--tinta);font-weight:600}
.itens-leg{position:static;width:auto;grid-template-columns:1fr 1fr;column-gap:16px;margin-top:8px}
.itens-leg li{padding:7px 0 8px}
.nota{font-family:var(--f-tit);font-style:italic;font-size:15px;line-height:1.35;color:var(--tinta2);margin-top:10px}
.arq{font:500 9px var(--f-dado);color:var(--tinta3);margin-top:8px;letter-spacing:.02em}
${CSS_CEL}`;
  const capa = `<section class="folha t capa"><div class="faixa"></div>
    <span class="olho">Manual do usuário <i style="font-style:normal;color:var(--amarelo)">·</i> Edição ${VERSAO}</span>
    <h1>KM<em>Check</em></h1>
    <p class="sub">Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na própria foto. Direto do campo, sem depender de internet.</p>
    <img class="logo" src="${LOGO}" alt="KM Check">
    <div class="quadro"><img src="${FOTO}" alt=""></div>
    <div class="legenda-q" style="justify-content:flex-end"><span>BR-226/RN · Foto registrada com o KM Check</span></div>
    ${cel('10-camera', { numeros: false, w: 218, estilo: 'left:520px;top:262px;transform:rotate(-2deg)' })}
    ${pe('00', '01')}</section>`;
  const folha = `<section class="folha t"><div class="faixa"></div><span class="num">02</span>
    <header class="cab"><span class="olho">Capítulo 02</span><h2>Tela inicial <span>e a legenda</span></h2><p>O painel de campo: com o GPS, o app acha a rodovia mais próxima e mostra o KM exato.</p></header>
    ${cel('01-inicio', { w: 184, estilo: 'left:132px;top:262px' })}
    ${listaItens(ITENS_INICIO)}
    <figure class="fig" style="margin:0">${pilhaLegenda()}<p class="cap-fig"><b>Fig. 2</b> · A legenda gravada na foto</p>${listaItens(ITENS_LEG, 'itens itens-leg')}<p class="nota">${NOTA_LEG}</p><p class="arq">${ARQUIVO}</p></figure>
    ${pe('02', '03')}</section>`;
  return { css, html: capa + folha };
})();

/* ============ 3. VIDRO E LUZ DO DIA: a própria foto da rodovia vira um campo de cor, painéis de vidro ============ */
const op3 = (() => {
  const fundo = `<img class="fundo" src="${FOTO_FUNDO}" alt=""><div class="veu"></div>`;
  const pe = (cap, folha) => `<div class="pilula"><span>KM Check</span><span>Capítulo <b>${cap}</b></span><span>Folha <b>${folha} / 08</b></span><span>v<b>${VERSAO}</b></span></div><span class="assin">Desenvolvido por Wagner Machado</span>`;
  const css = `
/* Vidro e luz do dia: a foto real da rodovia, desfocada, vira um campo de céu azul e capim dourado.
   Os textos ficam em painéis de vidro fosco e os celulares flutuam nítidos por cima. Clima de apresentação. */
.t{--txt:#fff;--txt2:rgba(255,255,255,.78);--txt3:rgba(255,255,255,.56);--acc:#d6f04a;--f-tit:'Inter Tight',Arial,sans-serif;--f-txt:'Inter Tight',Arial,sans-serif;--f-dado:'JetBrains Mono',monospace;
  --ln:#fff;--ln-h:rgba(10,14,20,.55);--mk-bg:#fff;--mk-fg:#10151c;--mk-anel:rgba(255,255,255,.28);--cel-sombra:0 60px 90px -30px rgba(8,14,24,.75),0 20px 34px -16px rgba(8,14,24,.5);
  background:#5b7a96;color:var(--txt);font-family:var(--f-txt)}
.fundo{inset:-80px;width:calc(100% + 160px);height:calc(100% + 160px);object-fit:cover;filter:blur(46px) saturate(1.35) brightness(.95)}
.veu{inset:0;background:linear-gradient(180deg,rgba(14,22,34,.30) 0%,rgba(14,22,34,.12) 40%,rgba(14,18,24,.55) 100%)}
.vidro{background:linear-gradient(160deg,rgba(255,255,255,.20),rgba(255,255,255,.07));border:1px solid rgba(255,255,255,.30);border-radius:30px;box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 40px 80px -40px rgba(8,14,24,.65);backdrop-filter:blur(18px) saturate(1.3)}
.olho{display:block;font:500 10.5px var(--f-dado);letter-spacing:.24em;text-transform:uppercase;color:var(--acc)}
.pilula{right:36px;bottom:30px;display:flex;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28)}
.pilula span{padding:8px 14px;font:500 10px var(--f-dado);letter-spacing:.12em;text-transform:uppercase;color:var(--txt2);border-left:1px solid rgba(255,255,255,.18)}
.pilula span:first-child{border-left:none;color:var(--txt)}
.pilula b{color:var(--txt);font-weight:600}
.assin{left:40px;bottom:38px;font:500 10px var(--f-dado);letter-spacing:.16em;text-transform:uppercase;color:var(--txt2)}
/* capa */
.capa .pilula{top:30px;bottom:auto}.capa .assin{top:42px;bottom:auto}
.capa .logo{left:50%;top:44px;height:48px;transform:translateX(-50%);filter:drop-shadow(0 6px 16px rgba(0,0,0,.35))}
.capa .olho{left:0;right:0;top:118px;text-align:center}
.capa h1{left:0;right:0;top:136px;text-align:center;font:800 118px/1 var(--f-tit);letter-spacing:-.05em;text-shadow:0 10px 40px rgba(10,20,40,.25)}
.capa .sub{left:50%;top:268px;width:560px;transform:translateX(-50%);text-align:center;font-size:17px;line-height:1.5;color:var(--txt2)}
.chips{left:50%;top:338px;transform:translateX(-50%);display:flex;gap:8px}
.chips span{padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);font:500 10px var(--f-dado);letter-spacing:.14em;text-transform:uppercase}
/* folha */
.painel{left:36px;top:36px;width:478px;padding:34px 34px 26px}
.painel .topo-p{display:flex;gap:18px;align-items:center}
.placa{display:inline-block;width:58px;aspect-ratio:150/178;background:#f4f6f8;border-radius:8px;padding:3.5px;box-shadow:0 10px 22px rgba(0,0,0,.25);flex:0 0 auto}
.placa-in{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#13305c;border-radius:5px;color:#fff;font:800 13px/1 var(--f-tit)}
.placa i{width:72%;height:2px;background:#fff;margin:5px 0}.placa em{font-style:normal;font-size:23px}
.painel h2{font:800 36px/1 var(--f-tit);letter-spacing:-.035em;margin-top:8px}
.painel .lead{font-size:15px;line-height:1.5;color:var(--txt2);margin-top:18px}
.itens{list-style:none;margin:22px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:4px 20px}
.itens li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:6px;padding:9px 0;border-top:1px solid rgba(255,255,255,.16)}
.n{width:22px;height:22px;border-radius:50%;background:#fff;color:#10151c;font:600 10.5px/22px var(--f-dado);text-align:center}
.itens b{display:block;font:700 14px/1.2 var(--f-tit);letter-spacing:-.01em}
.itens p{font-size:12.5px;color:var(--txt2);line-height:1.35;margin-top:3px}
.cartao{left:836px;top:36px;width:251px;padding:20px 20px 18px}
.cartao h3{font:800 19px/1.1 var(--f-tit);letter-spacing:-.02em;margin:6px 0 14px}
.pilha{position:relative;height:166px}
.pilha .f1{position:absolute;inset:0 0 auto;width:100%;height:124px;object-fit:cover;object-position:50% 64%;border-radius:14px}
.pilha .f2w{position:absolute;left:14px;right:-6px;bottom:0}
.pilha .f2{display:block;width:100%;border-radius:8px;box-shadow:0 0 0 1px rgba(255,255,255,.25),0 16px 30px -12px rgba(0,0,0,.6)}
.mk2{position:absolute;left:-9px;width:18px;height:18px;margin-top:-9px;border-radius:50%;background:#fff;color:#10151c;font:600 9px/18px var(--f-dado);text-align:center}
.itens-leg{grid-template-columns:1fr;margin-top:10px;gap:0}
.itens-leg li{padding:7px 0}
.nota{font-size:11.5px;color:var(--txt3);margin-top:8px;line-height:1.4}
.arq{margin-top:8px;font:500 8.5px var(--f-dado);color:var(--txt2);word-break:break-all}
${CSS_CEL}`;
  const capa = `<section class="folha t capa">${fundo}
    <img class="logo" src="${LOGO}" alt="KM Check"><span class="olho">Manual do usuário</span><h1>KM Check</h1>
    <p class="sub">Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na própria foto. Direto do campo, sem depender de internet.</p>
    <div class="chips"><span>Versão ${VERSAO}</span><span>Outubro de 2026</span><span>iPhone e Android</span></div>
    ${cel('20-carro-dia', { numeros: false, w: 206, estilo: 'left:238px;top:418px;transform:rotate(-9deg)' })}
    ${cel('01-inicio', { numeros: false, w: 206, estilo: 'left:680px;top:418px;transform:rotate(9deg)' })}
    ${cel('10-camera', { numeros: false, w: 240, estilo: 'left:442px;top:392px;z-index:2' })}
    ${pe('00', '01')}</section>`;
  const folha = `<section class="folha t">${fundo}
    <section class="painel vidro"><div class="topo-p">${placa('KM', '02')}<div><span class="olho">Capítulo 02</span><h2>Tela inicial<br>e a legenda</h2></div></div>
      <p class="lead">O painel de campo: com o GPS, o app acha a rodovia mais próxima e mostra o KM exato.</p>${listaItens(ITENS_INICIO)}</section>
    ${cel('01-inicio', { w: 200, estilo: 'left:588px;top:150px' })}
    <section class="cartao vidro"><span class="olho">Na foto</span><h3>A legenda gravada</h3>${pilhaLegenda()}${listaItens(ITENS_LEG, 'itens itens-leg')}<p class="nota">${NOTA_LEG}</p></section>
    ${pe('02', '03')}</section>`;
  return { css, html: capa + folha };
})();

const p = await browser.newPage();
await p.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1.6 });
for (const [i, op] of [op1, op2, op3].entries()) {
  const doc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual KM Check · opção ${i + 1}</title>${FONTES}<style>${BASE}${op.css}</style></head><body>${op.html}</body></html>`;
  fs.writeFileSync(path.join(SAIDA, `opcao-${i + 1}.html`), doc);
  await p.setContent(doc, { waitUntil: 'load', timeout: 120000 }); await new Promise(r => setTimeout(r, 1500));
  await p.evaluateHandle('document.fonts.ready');
  await (await p.$('body')).screenshot({ path: path.join(SAIDA, `opcao-${i + 1}.png`) });
  console.log('opção', i + 1, 'ok');
}
await browser.close();
