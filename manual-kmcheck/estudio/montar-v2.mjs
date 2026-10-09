/* Manual do KM Check, versão 2: A4 deitado, fundo de asfalto à noite, chamadas em linha de cota.
 * Prévia: capa e a folha da Tela inicial. Gera manual-kmcheck/previa-v2.pdf e previa-v2-N.png.
 * Uso: node manual-kmcheck/estudio/montar-v2.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve('manual-kmcheck'), PR = path.join(RAIZ, 'prints');
const marcas = JSON.parse(fs.readFileSync(path.join(PR, 'marcas.json'), 'utf8'));
const ICONES = fs.readFileSync(path.join(RAIZ, 'estudio/montar.mjs'), 'utf8').match(/const ICONES = `([^`]*)`/)[1];
const VERSAO = '292', TOTAL = 8;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

/* imagens em WebP leve, com recorte opcional [x, y, largura, altura] em fração da imagem */
const conv = await browser.newPage();
async function webp(arquivo, larg, recorte) {
  const b64 = 'data:image/' + (arquivo.endsWith('.webp') ? 'webp' : 'png') + ';base64,' + fs.readFileSync(arquivo).toString('base64');
  return conv.evaluate(async (src, larg, rc) => {
    const img = new Image(); img.src = src; await img.decode();
    const [sx, sy, sw, sh] = rc ? [rc[0] * img.width, rc[1] * img.height, rc[2] * img.width, rc[3] * img.height] : [0, 0, img.width, img.height];
    const c = document.createElement('canvas'); c.width = larg; c.height = Math.round(larg * sh / sw);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', .86);
  }, b64, larg, recorte || null);
}
const IMG = {};
for (const n of ['01-inicio', '10-camera', '20-carro-dia']) IMG[n] = await webp(path.join(PR, n + '.png'), 780);
const FOTO = await webp(path.join(RAIZ, 'estudio/foto-campo-rodovia.webp'), 1800, [0, 0, 1, .78]); // sem a legenda gravada
const FOTO_LEG = await webp(path.join(RAIZ, 'estudio/foto-campo-rodovia.webp'), 1100, [0, .80, .56, .20]);
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('logo-header.png')).toString('base64');
await conv.close();

const ESCURAS = new Set(['10-camera']);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* chamadas em linha de cota: número fora do celular, linha até um anel no item */
function espalha(arr, k, gap, min, max) {
  arr.sort((a, b) => a[k] - b[k]);
  arr.forEach((p, i) => { p[k] = Math.max(i ? arr[i - 1][k] + gap : min, p[k]) });
  for (let i = arr.length - 1; i >= 0; i--) { const lim = i === arr.length - 1 ? max : arr[i + 1][k] - gap; if (arr[i][k] > lim) arr[i][k] = lim }
}
function chamadas(lista) {
  const cont = { esq: 0, dir: 0 }; let alt = 0;
  const pts = [...lista].sort((a, b) => (a.t + a.h / 2) - (b.t + b.h / 2)).map(m => {
    const cx = m.l + m.w / 2, cy = m.t + m.h / 2, botao = m.w < 35 && m.h < 11;
    let lado;
    if (cy < 12 && botao) lado = 'topo';
    else if (cy > 86 && botao) lado = 'base';
    else if (Math.abs(cx - 50) < 4) lado = cont.esq < cont.dir ? 'esq' : cont.dir < cont.esq ? 'dir' : (alt++ % 2 ? 'dir' : 'esq');
    else lado = cx < 50 ? 'esq' : 'dir';
    if (cont[lado] != null) cont[lado]++;
    const largo = m.w > 24;
    const ax = lado === 'esq' && largo ? m.l + .6 : lado === 'dir' && largo ? m.l + m.w - .6 : cx;
    const ay = lado === 'topo' && m.h > 3 ? m.t + 1 : lado === 'base' && m.h > 3 ? m.t + m.h - 1 : cy;
    return { n: m.n, lado, ax, ay, mx: lado === 'esq' ? -15 : lado === 'dir' ? 115 : cx, my: lado === 'topo' ? -7 : lado === 'base' ? 107 : cy };
  });
  for (const l of ['esq', 'dir']) espalha(pts.filter(p => p.lado === l), 'my', 5.2, 3, 97);
  for (const l of ['topo', 'base']) espalha(pts.filter(p => p.lado === l), 'mx', 11.5, 4, 96);
  const f = v => +v.toFixed(2);
  const linhas = pts.map(p => {
    const dobra = p.lado === 'esq' ? [-5, p.my] : p.lado === 'dir' ? [105, p.my] : p.lado === 'topo' ? [p.mx, -3] : [p.mx, 103];
    return `${f(p.ax)},${f(p.ay)} ${f(dobra[0])},${f(dobra[1])} ${f(p.mx)},${f(p.my)}`;
  });
  return `<div class="camada"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${linhas.map(l => `<polyline class="ln-h" points="${l}"/><polyline class="ln" points="${l}"/>`).join('')}</svg>`
    + pts.map(p => `<span class="pt" style="left:${f(p.ax)}%;top:${f(p.ay)}%"></span><span class="mk" style="left:${f(p.mx)}%;top:${f(p.my)}%">${p.n}</span>`).join('') + '</div>';
}
function celular(nome, { numeros = true, w = 220, cls = '', estilo = '' } = {}) {
  const escura = ESCURAS.has(nome);
  const mk = numeros && marcas[nome] ? chamadas(marcas[nome]) : '';
  return `<figure class="cel ${cls}" style="--w:${w}px;${estilo}"><div class="tb"><div class="tela"><img src="${IMG[nome]}" alt=""><div class="sb${escura ? ' sb-esc' : ''}"><span>9:41</span><span class="ilha"></span>${ICONES}</div><span class="home${escura ? ' home-esc' : ''}"></span></div>${mk}</div></figure>`;
}
const placa = (cima, baixo, cls = '') => `<span class="placa ${cls}"><span class="placa-in"><b>${cima}</b><i></i><em>${baixo}</em></span></span>`;
/* pé de toda folha: faixa da pista + carimbo técnico */
const pe = (cap, folha) => `<div class="faixa"></div>
  <footer class="pe"><span>KM Check <i>·</i> Manual do usuário</span><span class="assin">Desenvolvido por <b>Wagner Machado</b></span></footer>
  <div class="carimbo"><div><small>Capítulo</small><b>${cap}</b></div><div><small>Folha</small><b>${String(folha).padStart(2, '0')} de ${String(TOTAL).padStart(2, '0')}</b></div><div><small>Versão</small><b>${VERSAO}</b></div></div>`;

const GRAO = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .16 0 0 0 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;

const CSS = `
/* Asfalto à noite: grafite em camadas como os cartões do app, grão fino de asfalto, faixa tracejada
   verde-limão no pé (a sinalização da pista) e chamadas em linha de cota, como num desenho técnico. */
:root{
  --asf:#141619; --asf2:#1d2024; --asf3:#262a2f; --linha:#353a40; --txt:#f1f3f4; --txt2:#b6bcc3; --txt3:#7e858d;
  --lima:#b9dc2c; --lima-esc:#243003; --placa:#13305c;
  --f-tit:'Overpass','Arial Narrow',Arial,sans-serif; --f-txt:'Source Sans 3','Segoe UI',Arial,sans-serif; --f-dado:'Overpass Mono',ui-monospace,Consolas,monospace;
  color-scheme:dark;
}
@page{size:297mm 210mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#0c0d0f}
body{font-family:var(--f-txt);color:var(--txt);-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3{font-family:var(--f-tit);margin:0;text-wrap:balance}
p{margin:0}
.folha{position:relative;width:1123px;height:794px;overflow:hidden;break-after:page;
  background:${GRAO},radial-gradient(900px 620px at 72% 38%,#22262b 0%,#181a1e 55%,#101113 100%);}
.folha:last-child{break-after:auto}
@media screen{body{display:grid;gap:28px;justify-content:center;padding-block:28px}.folha{box-shadow:0 20px 60px rgba(0,0,0,.6)}}
/* pé */
.faixa{position:absolute;left:0;right:0;bottom:50px;height:4px;background:repeating-linear-gradient(90deg,var(--lima) 0 54px,transparent 54px 86px);opacity:.92}
.faixa::after{content:'';position:absolute;left:0;right:0;top:20px;height:1px;background:rgba(255,255,255,.14)}
.pe{position:absolute;left:44px;right:44px;bottom:18px;display:flex;gap:28px;font-family:var(--f-dado);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--txt3)}
.pe i{font-style:normal;color:var(--lima);margin:0 4px}
.pe b{color:var(--txt2);font-weight:600}
.carimbo{position:absolute;right:44px;bottom:72px;display:grid;grid-template-columns:auto auto auto;border:1px solid var(--linha);background:rgba(16,17,19,.72)}
.carimbo div{padding:6px 14px 7px;border-left:1px solid var(--linha);min-width:74px}
.carimbo div:first-child{border-left:none}
.carimbo small{display:block;font-family:var(--f-dado);font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:var(--txt3)}
.carimbo b{font-family:var(--f-tit);font-size:14px;font-weight:700;color:var(--txt);font-variant-numeric:tabular-nums}
/* placa de km */
.placa{display:inline-block;width:62px;aspect-ratio:150/178;background:#f4f5f6;border-radius:8px;padding:3.5px;box-shadow:0 8px 18px rgba(0,0,0,.45);flex:0 0 auto}
.placa-in{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:var(--placa);border-radius:5px;color:#fff;font-family:var(--f-tit);font-weight:800;line-height:1}
.placa b{font-size:14px;letter-spacing:.05em}
.placa i{width:72%;height:2px;background:#fff;margin:5px 0}
.placa em{font-style:normal;font-size:25px}
/* celular: moldura com aro metálico, reflexo do vidro e sombra de chão */
.cel{position:relative;margin:0;width:var(--w);padding:calc(var(--w)*.034);border-radius:calc(var(--w)*.165);
  background:linear-gradient(140deg,#4a4f56 0%,#121315 18%,#0b0c0d 60%,#2b2f34 100%);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 0 0 1px #000,0 46px 80px -28px rgba(0,0,0,.9),0 16px 30px -14px rgba(0,0,0,.7)}
.cel::before,.cel::after{content:'';position:absolute;width:3px;border-radius:2px;background:#2c3035}
.cel::before{left:-3px;top:20%;height:10%;box-shadow:0 calc(var(--w)*.2) 0 #2c3035}
.cel::after{right:-3px;top:26%;height:14%}
.tb{position:relative;container-type:inline-size}
.tela{position:relative;border-radius:calc(var(--w)*.135);overflow:hidden;aspect-ratio:390/844;background:#0b0c0d}
.tela img{display:block;width:100%;height:100%;object-fit:cover}
.tela::after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,.04) 26%,transparent 40%);pointer-events:none}
.sb{position:absolute;left:0;right:0;top:0;height:5.6%;display:flex;align-items:center;justify-content:space-between;padding:0 7.5% 0 9.5%;color:#121315;font:600 4.4cqw -apple-system,'SF Pro Text',var(--f-txt)}
.sb-esc{color:#fff}
.sb-ic{display:flex;gap:1.5cqw;align-items:center}
.sb-ic svg{height:3.2cqw;width:auto;fill:currentColor}
.sb-ic svg:last-child{height:3.6cqw}
.ilha{position:absolute;left:50%;top:22%;width:30%;height:60%;transform:translateX(-50%);background:#000;border-radius:999px}
.home{position:absolute;left:50%;bottom:1.1%;width:36%;height:1.6cqw;transform:translateX(-50%);background:#16181b;border-radius:999px;opacity:.85}
.home-esc{background:#fff}
.camada{position:absolute;inset:0;pointer-events:none;z-index:3}
.camada svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.ln,.ln-h{fill:none;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.ln-h{stroke:rgba(8,9,10,.7);stroke-width:3.2px}
.ln{stroke:var(--lima);stroke-width:1.2px}
.pt{position:absolute;width:3.6cqw;height:3.6cqw;margin:-1.8cqw 0 0 -1.8cqw;border-radius:50%;border:.9cqw solid var(--lima);background:rgba(8,9,10,.55)}
.mk{position:absolute;width:9.4cqw;height:9.4cqw;margin:-4.7cqw 0 0 -4.7cqw;border-radius:50%;background:var(--lima);color:var(--lima-esc);font:700 4.6cqw/9.4cqw var(--f-dado);text-align:center;box-shadow:0 0 0 .9cqw var(--asf),0 3px 8px rgba(0,0,0,.5)}
/* capa */
.capa-foto{position:absolute;top:0;right:0;width:68%;height:100%;object-fit:cover;object-position:60% 50%;filter:brightness(.62) saturate(.85) contrast(1.05);
  -webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 38%);mask-image:linear-gradient(90deg,transparent 0%,#000 38%)}
.capa-veu{position:absolute;inset:0;background:linear-gradient(0deg,rgba(14,15,17,.95) 0%,rgba(14,15,17,0) 34%),linear-gradient(180deg,rgba(14,15,17,.55) 0%,rgba(14,15,17,0) 22%)}
.capa-txt{position:absolute;left:64px;top:84px;width:470px}
.capa-logo{height:74px;display:block;margin-bottom:54px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))}
.olho{display:block;font-family:var(--f-dado);font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--lima);margin-bottom:14px}
.capa h1{font-size:112px;line-height:.86;font-weight:800;letter-spacing:-.035em}
.capa .sub{font-size:19px;line-height:1.5;color:var(--txt2);margin-top:26px;max-width:25em}
.chips{display:flex;gap:10px;margin-top:30px;flex-wrap:wrap}
.chips span{font-family:var(--f-dado);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--txt);border:1px solid var(--linha);background:rgba(20,22,25,.6);padding:7px 12px 6px;border-radius:999px}
.chips b{color:var(--lima);font-weight:700}
.capa-cels .cel{position:absolute}
/* folha de conteúdo */
.cab{position:absolute;left:44px;top:38px;right:44px;display:flex;gap:20px;align-items:center}
.cab .olho{margin-bottom:6px;font-size:11px}
.cab h2{font-size:42px;line-height:1;font-weight:800;letter-spacing:-.02em}
.cab p{font-size:15.5px;color:var(--txt2);margin-top:8px}
.esq{position:absolute;left:44px;top:150px;width:620px;display:grid;grid-template-columns:282px minmax(0,1fr);gap:8px}
.esq .cel{margin:36px auto 0;align-self:start}
.itens{list-style:none;margin:0;padding:6px 0 0;display:grid;gap:0}
.itens li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;align-items:start;padding:7px 0 8px;border-top:1px solid rgba(255,255,255,.07)}
.itens li:first-child{border-top:none}
.itens .n{width:24px;height:24px;border-radius:50%;background:var(--lima);color:var(--lima-esc);font:700 11px/24px var(--f-dado);text-align:center}
.itens b{display:block;font-family:var(--f-tit);font-size:14.5px;font-weight:700;line-height:1.2}
.itens p{font-size:13px;color:var(--txt2);line-height:1.35;margin-top:1px}
.dir{position:absolute;left:700px;top:150px;width:379px}
.dir h3{font-size:22px;font-weight:800;display:flex;align-items:baseline;gap:10px}
.dir h3 small{font-family:var(--f-dado);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--txt3);font-weight:500}
.foto-pilha{position:relative;margin-top:14px;height:268px}
.foto-pilha .f1{position:absolute;left:0;top:0;width:100%;height:196px;object-fit:cover;object-position:50% 62%;border-radius:12px;box-shadow:0 20px 40px -18px rgba(0,0,0,.9)}
.foto-pilha .f2w{position:absolute;left:16px;right:-10px;bottom:0;border-radius:10px;overflow:visible}
.foto-pilha .f2{display:block;width:100%;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 22px 40px -14px rgba(0,0,0,.95)}
.foto-pilha .mk2{position:absolute;left:-12px;width:22px;height:22px;margin-top:-11px;border-radius:50%;background:var(--lima);color:var(--lima-esc);font:700 11px/22px var(--f-dado);text-align:center;box-shadow:0 0 0 3px var(--asf)}
.leg{list-style:none;margin:16px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px 18px}
.leg li{display:grid;grid-template-columns:26px minmax(0,1fr);gap:8px}
.leg .n{width:22px;height:22px;border-radius:50%;background:var(--lima);color:var(--lima-esc);font:700 11px/22px var(--f-dado);text-align:center}
.leg b{display:block;font-family:var(--f-tit);font-size:14px;font-weight:700}
.leg p{font-size:12.5px;color:var(--txt2);line-height:1.35}
.arq{margin-top:14px;padding-top:12px;border-top:1px dashed var(--linha);font-family:var(--f-dado);font-size:10.5px;color:var(--txt2);letter-spacing:.02em}
.arq small{display:block;font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--txt3);margin-bottom:4px}
.arq code{font-family:inherit;color:var(--txt)}
`;
const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Overpass:wght@600;700;800&family=Overpass+Mono:wght@500;600;700&family=Source+Sans+3:wght@400;600&display=swap">';

const capa = `<section class="folha capa">
  <img class="capa-foto" src="${FOTO}" alt="">
  <div class="capa-veu"></div>
  <div class="capa-txt">
    <img class="capa-logo" src="${LOGO}" alt="KM Check">
    <span class="olho">Manual do usuário</span>
    <h1>KM Check</h1>
    <p class="sub">Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na própria foto. Direto do campo, sem depender de internet.</p>
    <div class="chips"><span>Versão <b>${VERSAO}</b></span><span>Outubro de 2026</span><span>iPhone e Android</span></div>
  </div>
  <div class="capa-cels">
    ${celular('01-inicio', { numeros: false, w: 230, estilo: 'left:846px;top:100px;transform:rotate(6deg)' })}
    ${celular('10-camera', { numeros: false, w: 262, estilo: 'left:640px;top:62px;transform:rotate(-4deg);z-index:2' })}
  </div>
  ${pe('Capa', 1)}
</section>`;

const ITENS_INICIO = [
  ['Placa do KM', 'BR e quilômetro inteiro, como na placa da pista.'],
  ['Rodovia e UF', 'A rodovia onde você está agora.'],
  ['KM exato', 'Com metros, em vermelho se longe do eixo.'],
  ['Estaca', 'Contada a cada 20 m desde o km 0.'],
  ['Coordenadas', 'Latitude e longitude lidas do GPS.'],
  ['Modo Carro', 'Painel grande para acompanhar dirigindo.'],
  ['Consulta', 'Coordenada em KM e KM em coordenada.'],
  ['Configurações', 'Câmera, logo, legenda e contratos.'],
  ['Gestão de Eixo', 'Baixar e importar as rodovias.'],
  ['Registrar evidência', 'Abre a câmera para a foto.'],
];
/* linhas da legenda na faixa ampliada (em % da altura da faixa) */
const LEG_Y = [17, 39, 61, 83];
const inicio = `<section class="folha">
  <header class="cab">${placa('KM', '02')}<div><span class="olho">Capítulo 02</span><h2>Tela inicial e a legenda</h2><p>O painel de campo: com o GPS, o app acha a rodovia mais próxima e mostra o KM exato.</p></div></header>
  <div class="esq">
    ${celular('01-inicio', { w: 196 })}
    <ol class="itens">${ITENS_INICIO.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol>
  </div>
  <div class="dir">
    <h3>A legenda da foto <small>gravada na imagem</small></h3>
    <div class="foto-pilha">
      <img class="f1" src="${FOTO}" alt="Foto tirada com o KM Check na BR-226/RN">
      <div class="f2w"><img class="f2" src="${FOTO_LEG}" alt="Legenda ampliada">${LEG_Y.map((y, i) => `<span class="mk2" style="top:${y}%">${i + 1}</span>`).join('')}</div>
    </div>
    <ol class="leg">
      <li><span class="n">1</span><div><b>Rodovia e KM</b><p>Com lado da pista e estaca.</p></div></li>
      <li><span class="n">2</span><div><b>Contrato e serviço</b><p>Ou o nome da ponte ou viaduto.</p></div></li>
      <li><span class="n">3</span><div><b>Coordenadas</b><p>Com a precisão do GPS, se quiser.</p></div></li>
      <li><span class="n">4</span><div><b>Data e SNV</b><p>Data, hora e versão da base.</p></div></li>
    </ol>
    <p class="arq"><small>Nome do arquivo</small><code>BR-226-RN_KM326+040_LD_2026-09-15_11-27-05.jpg</code></p>
  </div>
  ${pe('02', 3)}
</section>`;

const html = `<title>Manual KM Check</title>${FONTES}<style>${CSS}</style>${capa}${inicio}`;
const doc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + html + '</body></html>';
fs.writeFileSync(path.join(RAIZ, 'previa-v2.html'), doc);
const p = await browser.newPage();
await p.setViewport({ width: 1123, height: 794, deviceScaleFactor: 2 });
await p.setContent(doc, { waitUntil: 'networkidle0', timeout: 120000 });
await p.evaluateHandle('document.fonts.ready');
await p.pdf({ path: path.join(RAIZ, 'previa-v2.pdf'), width: '297mm', height: '210mm', printBackground: true, preferCSSPageSize: true });
await p.emulateMediaType('print');
const folhas = await p.$$('.folha');
for (let i = 0; i < folhas.length; i++) await folhas[i].screenshot({ path: path.join(RAIZ, `previa-v2-${i + 1}.png`) });
console.log('ok', folhas.length, 'folhas');
await browser.close();
