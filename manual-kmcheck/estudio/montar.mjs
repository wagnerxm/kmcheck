/* Monta o manual do KM Check a partir dos prints (prints/*.png), dos marcadores (prints/marcas.json)
 * e dos textos (conteudo.mjs). Gera, na pasta manual-kmcheck:
 *   manual-km-check.html        página web (imagens embutidas, publicada como Artifact)
 *   Manual KM Check.pdf         o mesmo conteúdo em A4
 *   guia-rapido.html / Guia rápido KM Check.pdf   resumo de 2 páginas
 * Uso: node manual-kmcheck/estudio/montar.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { VERSAO, DATA, passosRapidos, capitulos } from './conteudo.mjs';

const RAIZ = path.resolve('manual-kmcheck'), PR = path.join(RAIZ, 'prints');
const marcas = JSON.parse(fs.readFileSync(path.join(PR, 'marcas.json'), 'utf8'));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

/* prints em WebP leve (o PNG @3x passa de 2 MB; o manual precisa caber em poucos MB) */
const conv = await browser.newPage();
async function webp(arquivo, larg, recorte) {
  const b64 = 'data:image/' + (arquivo.endsWith('.webp') ? 'webp' : 'png') + ';base64,' + fs.readFileSync(arquivo).toString('base64');
  return conv.evaluate(async (src, larg, rc) => {
    const img = new Image(); img.src = src; await img.decode();
    const [sx, sy, sw, sh] = rc ? [rc[0] * img.width, rc[1] * img.height, rc[2] * img.width, rc[3] * img.height] : [0, 0, img.width, img.height];
    const c = document.createElement('canvas'); c.width = larg; c.height = Math.round(larg * sh / sw);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', .84);
  }, b64, larg, recorte || null);
}
const IMG = {};
for (const f of fs.readdirSync(PR).filter(f => /^\d.*\.png$/.test(f))) {
  const deitado = f.includes('deitad');
  IMG[f.replace('.png', '')] = await webp(path.join(PR, f), deitado ? 1500 : 720);
}
const FOTO = await webp(path.join(RAIZ, 'estudio/foto-campo-rodovia.webp'), 1400);
const FOTO_LEG = await webp(path.join(RAIZ, 'estudio/foto-campo-rodovia.webp'), 1100, [0, .80, .56, .20]);
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('logo-header.png')).toString('base64');
await conv.close();

/* telas com o topo escuro: a barra de status do iPhone fica em branco */
const ESCURAS = new Set(['10-camera', '11-camera-servico-contrato', '12-camera-deitada', '13-galeria', '21-carro-noite', '33-importar-configurar', '60-vincular-contrato', '61-vincular-trecho', '62-detalhes-rodovia', '63-estaca', '64-gps-desligado']);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const ICONES = `<span class="sb-ic"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 16 12"><path d="M8 11.5 5.6 8.9a3.4 3.4 0 0 1 4.8 0z"/><path d="M8 4.6c2 0 3.8.8 5.1 2.1l-1.6 1.7A4.9 4.9 0 0 0 8 6.9a4.9 4.9 0 0 0-3.5 1.5L2.9 6.7A7.2 7.2 0 0 1 8 4.6z"/><path d="M8 .5c3.2 0 6.1 1.3 8.2 3.4l-1.6 1.7A9 9 0 0 0 8 2.8a9 9 0 0 0-6.6 2.8L-.2 3.9A11.3 11.3 0 0 1 8 .5z"/></svg><svg viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="2.5" y="2.5" width="19" height="8" rx="2"/><rect x="24.6" y="4.2" width="1.8" height="4.6" rx=".9" opacity=".45"/></svg></span>`;
/* Chamadas: o número fica FORA do celular (colunas laterais, ou acima/abaixo para os botões das
   barras) e uma linha leva até o item. Assim nenhum número cobre o que ele explica.
   Coordenadas em % da tela: x em % da largura, y em % da altura (o SVG usa viewBox 0 0 100 100). */
const GAP_LADO = 4.9, GAP_TOPO = 10.5;
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
    return { n: m.n, lado, ax, ay, mx: lado === 'esq' ? -12.5 : lado === 'dir' ? 112.5 : cx, my: lado === 'topo' ? -6.2 : lado === 'base' ? 106.2 : cy };
  });
  for (const l of ['esq', 'dir']) espalha(pts.filter(p => p.lado === l), 'my', GAP_LADO, 3, 97);
  for (const l of ['topo', 'base']) espalha(pts.filter(p => p.lado === l), 'mx', GAP_TOPO, 4, 96);
  const f = v => +v.toFixed(2);
  const linhas = pts.map(p => {
    const dobra = p.lado === 'esq' ? [-4, p.my] : p.lado === 'dir' ? [104, p.my] : p.lado === 'topo' ? [p.mx, -2.6] : [p.mx, 102.6];
    return `${f(p.ax)},${f(p.ay)} ${f(dobra[0])},${f(dobra[1])} ${f(p.mx)},${f(p.my)}`;
  });
  return `<div class="camada"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${linhas.map(l => `<polyline class="ln-h" points="${l}"/><polyline class="ln" points="${l}"/>`).join('')}</svg>`
    + pts.map(p => `<span class="pt" style="left:${f(p.ax)}%;top:${f(p.ay)}%"></span><span class="mk" style="left:${f(p.mx)}%;top:${f(p.my)}%">${p.n}</span>`).join('') + '</div>';
}
function celular(nome, { numeros = true } = {}) {
  const deitado = nome.includes('deitad'), escura = ESCURAS.has(nome);
  const mk = numeros && marcas[nome] ? chamadas(marcas[nome]) : '';
  const barra = deitado ? '' : `<div class="sb${escura ? ' sb-esc' : ''}"><span class="sb-hora">9:41</span><span class="ilha"></span>${ICONES}</div>`;
  return `<figure class="cel${deitado ? ' cel-deitado' : ''}${mk ? ' cel-mk' : ''}"><div class="tb"><div class="tela"><img src="${IMG[nome]}" alt="">${barra}<span class="home${escura ? ' home-esc' : ''}"></span></div>${mk}</div></figure>`;
}
const placa = (cima, baixo, cls = '') => `<span class="placa ${cls}"><span class="placa-in"><b>${cima}</b><i></i><em>${baixo}</em></span></span>`;

/* telas sem lista numerada, em sequência, ficam lado a lado com o texto embaixo */
function telas(ts) {
  const simples = t => !t.itens && !t.img.includes('deitad');
  let html = '', grupo = [];
  const fecha = () => {
    if (grupo.length > 1) html += `<div class="par">${grupo.map(t => `<div class="pi">${celular(t.img)}<h3>${esc(t.titulo)}</h3><p>${esc(t.texto)}</p></div>`).join('')}</div>`;
    else if (grupo.length) html += tela(grupo[0]);
    grupo = [];
  };
  for (const t of ts) { if (simples(t)) grupo.push(t); else { fecha(); html += tela(t) } }
  fecha(); return html;
}
function tela(t) {
  const lista = t.itens ? `<ol class="itens">${t.itens.map((it, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(it[0])}</b><p>${esc(it[1])}</p></div></li>`).join('')}</ol>` : '';
  return `<div class="fig${t.img.includes('deitad') ? ' fig-larga' : ''}">${celular(t.img)}<div class="fig-txt">${t.titulo ? `<h3>${esc(t.titulo)}</h3>` : ''}${t.texto ? `<p class="fig-p">${esc(t.texto)}</p>` : ''}${lista}</div></div>`;
}
function capitulo(c) {
  let corpo = '';
  if (c.instalacao) corpo += `<div class="inst">
    <div class="inst-col"><h3>iPhone</h3><ol class="passos">
      <li>Abra <b>wagnerxm.github.io/kmcheck</b> no <b>Safari</b>.</li>
      <li>Toque no botão <b>Compartilhar</b> <span class="ico"><svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg></span> na barra do Safari.</li>
      <li>Role e toque em <b>Adicionar à Tela de Início</b> <span class="ico"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M12 8v8M8 12h8"/></svg></span>.</li>
      <li>Toque em <b>Adicionar</b>. O ícone do KM Check aparece na tela inicial.</li></ol></div>
    <div class="inst-col"><h3>Android</h3><ol class="passos">
      <li>Abra <b>wagnerxm.github.io/kmcheck</b> no <b>Chrome</b>.</li>
      <li>Toque em <b>Instalar</b> quando o app oferecer, ou no menu <span class="ico ico-txt">⋮</span> do Chrome.</li>
      <li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li>
      <li>Confirme. O KM Check abre em tela cheia, como os outros apps.</li></ol></div>
    <p class="nota">Na primeira abertura, permita a <b>localização</b> e a <b>câmera</b>. Sem elas o app não consegue gravar o KM nem tirar a foto.</p></div>`;
  if (c.legenda) corpo += `<div class="leg"><div class="leg-col">
    <figure class="leg-foto"><img src="${FOTO}" alt="Foto registrada com o KM Check na BR-226/RN"></figure>
    <div class="arq"><span class="lbl">Nome do arquivo</span><code>BR-226-RN_KM326+040_LD_2026-09-15_11-27-05.jpg</code><p>Rodovia, KM, lado, data e hora no nome. As fotos ficam em ordem e fáceis de achar. A localização também vai gravada nos dados da foto (EXIF), lida pelo Google Fotos e pelo app Fotos do iPhone.</p></div></div>
    <div class="leg-col"><figure class="leg-zoom"><img src="${FOTO_LEG}" alt="Legenda ampliada"></figure>
    <ol class="itens itens-leg">
      <li><span class="n">1</span><div><b>BR-226/RN - KM 326,040 &nbsp;LD · Est. 16302+0</b><p>Rodovia e UF, KM com metros, lado da pista e estaca. Se você estiver longe do eixo, aparece ⚠ no fim.</p></div></li>
      <li><span class="n">2</span><div><b>515/2024 - Aplicação de CBUQ</b><p>Contrato e serviço. Também mostra o nome da ponte ou do viaduto quando a foto é tirada sobre um.</p></div></li>
      <li><span class="n">3</span><div><b>-6,077494, -37,537469</b><p>Coordenadas no formato escolhido. Pode incluir a precisão do GPS em metros.</p></div></li>
      <li><span class="n">4</span><div><b>15/09/2026, 11:27 &nbsp;·&nbsp; SNV Jul/26</b><p>Data e hora da foto e a versão do SNV usada no cálculo do KM.</p></div></li>
    </ol></div></div>`;
  if (c.telas) corpo += telas(c.telas);
  if (c.ajustes) corpo += `<div class="ajustes">${c.ajustes.map(a => `<div class="aj">${celular(a.img, { numeros: false })}<div class="aj-txt"><h3>${esc(a.titulo)}</h3><dl>${a.linhas.map(l => `<dt>${esc(l[0])}</dt><dd>${esc(l[1])}</dd>`).join('')}</dl></div></div>`).join('')}</div>`;
  if (c.faq) corpo = `<dl class="faq">${c.faq.map(f => `<div><dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd></div>`).join('')}</dl>` + corpo;
  return `<section class="cap" id="${c.id}"><header class="cap-h">${placa('KM', c.km)}<div><span class="eyebrow">Capítulo ${Number(c.km)}</span><h2>${esc(c.titulo)}</h2></div></header><p class="lead">${esc(c.intro)}</p>${corpo}${c.dica ? `<p class="dica"><b>Dica</b>${esc(c.dica)}</p>` : ''}</section>`;
}

const CSS = `
/* Manual de campo: página clara como papel, blocos grafite como o app, verde-limão de acento e a
   placa azul de quilometragem marcando cada capítulo (os capítulos são marcos de km). */
:root{
  --papel:#f2f3ef; --tinta:#16181b; --tinta2:#4b5159; --tinta3:#7a8089; --linha:#d9dcd4;
  --grafite:#191b1e; --grafite2:#25282c; --lima:#b7d92d; --lima-esc:#2b3505; --placa:#13305c;
  --f-tit:'Overpass','Arial Narrow',Arial,sans-serif; --f-txt:'Source Sans 3','Segoe UI',Arial,sans-serif; --f-dado:'Overpass Mono',ui-monospace,Consolas,monospace;
  color-scheme:light;
}
*{box-sizing:border-box}
body{margin:0;background:var(--papel);color:var(--tinta);font-family:var(--f-txt);font-size:16.5px;line-height:1.55}
.pag{max-width:1080px;margin:0 auto;padding-inline:20px;padding-block:28px 64px}
h1,h2,h3{font-family:var(--f-tit);text-wrap:balance;margin:0}
p{margin:0}
/* capa */
.capa{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:28px;align-items:center;padding-block:28px 40px;border-bottom:1px solid var(--linha)}
.capa-logo{height:46px;width:auto;display:block;margin-bottom:28px}
.capa h1{font-size:clamp(40px,6vw,66px);line-height:.98;font-weight:800;letter-spacing:-.02em}
.capa h1 span{display:block;color:var(--tinta3);font-weight:600;font-size:.42em;letter-spacing:.02em;margin-bottom:10px}
.capa .sub{font-size:19px;color:var(--tinta2);margin-top:18px;max-width:30em}
.capa .meta{display:flex;gap:18px;flex-wrap:wrap;margin-top:26px;font-family:var(--f-dado);font-size:12.5px;color:var(--tinta3);text-transform:uppercase;letter-spacing:.08em}
.capa .meta b{color:var(--tinta);font-weight:600}
.capa-cels{position:relative;height:520px}
.capa-cels .cel{position:absolute;width:220px}
.capa-cels .cel:nth-child(1){left:0;top:56px;transform:rotate(-7deg)}
.capa-cels .cel:nth-child(2){left:30%;top:0;z-index:2}
.capa-cels .cel:nth-child(3){right:0;top:56px;transform:rotate(7deg)}
/* sumário */
.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px 26px;padding-block:30px;border-bottom:1px solid var(--linha)}
.sum h2{grid-column:1/-1;font-size:13px;text-transform:uppercase;letter-spacing:.16em;color:var(--tinta3);font-weight:700;margin-bottom:6px}
.sum a{display:flex;align-items:center;gap:12px;color:var(--tinta);text-decoration:none;font-family:var(--f-tit);font-weight:700;font-size:17px;padding:6px 0}
.sum a:hover b{text-decoration:underline;text-decoration-color:var(--lima);text-decoration-thickness:3px;text-underline-offset:4px}
.sum .placa{width:34px}
/* placa de km */
.placa{display:inline-block;width:54px;aspect-ratio:150/178;background:#fff;border-radius:7px;padding:3px;box-shadow:0 2px 6px rgba(0,0,0,.18);flex:0 0 auto}
.placa-in{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:var(--placa);border-radius:4px;color:#fff;font-family:var(--f-tit);font-weight:800;line-height:1}
.placa-in b{font-size:.3em;font-size:calc(var(--pw,54px)*.22)}
.placa b{font-size:13px;letter-spacing:.04em}
.placa i{width:72%;height:2px;background:#fff;margin:4px 0}
.placa em{font-style:normal;font-size:21px}
.sum .placa b{font-size:8px}.sum .placa i{margin:2px 0;height:1.5px}.sum .placa em{font-size:13px}
/* guia rápido */
.rapido{padding-block:40px;border-bottom:1px solid var(--linha)}
.rapido h2{font-size:30px;font-weight:800;margin-bottom:6px}
.rapido .lead{margin-bottom:22px}
.passos-r{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;counter-reset:p;list-style:none;padding:0;margin:0}
.passos-r li{background:var(--grafite);color:#eef0f2;border-radius:18px;padding:16px 16px 18px;position:relative;min-width:0}
.passos-r li::before{counter-increment:p;content:counter(p);font-family:var(--f-dado);font-size:13px;font-weight:700;color:var(--lima-esc);background:var(--lima);border-radius:999px;width:26px;height:26px;display:grid;place-items:center;margin-bottom:12px}
.passos-r b{font-family:var(--f-tit);font-size:17px;display:block;margin-bottom:4px}
.passos-r p{font-size:14.5px;color:#c9cdd3;line-height:1.45}
/* capítulos */
.cap{padding-block:52px 18px;border-bottom:1px solid var(--linha)}
.cap-h{display:flex;align-items:center;gap:18px;margin-bottom:14px}
.eyebrow{display:block;font-family:var(--f-dado);font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--tinta3);margin-bottom:2px}
.cap h2{font-size:clamp(30px,4vw,40px);font-weight:800;letter-spacing:-.01em}
.lead{font-size:18.5px;color:var(--tinta2);max-width:40em}
.fig{display:grid;grid-template-columns:350px minmax(0,1fr);gap:36px;align-items:start;margin-top:38px;break-inside:avoid}
.fig-larga{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)}
.fig > .cel:not(.cel-mk){margin-inline:auto}
.fig-txt{min-width:0;padding-top:48px}
.fig-larga .fig-txt{padding-top:8px}
.par{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:40px 36px;margin-top:40px}
.pi{min-width:0;break-inside:avoid}
.pi .cel{max-width:250px;margin-bottom:20px}
.pi h3{font-size:20px;font-weight:800;margin-bottom:6px}
.pi p{color:var(--tinta2);font-size:15.5px}
.fig-txt h3{font-size:22px;font-weight:800;margin-bottom:8px}
.fig-p{color:var(--tinta2);margin-bottom:14px;max-width:34em}
.itens{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.itens li{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--linha)}
.itens li:first-child{border-top:none}
.itens .n{flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:var(--lima);color:var(--lima-esc);font-family:var(--f-dado);font-weight:700;font-size:12.5px;display:grid;place-items:center;margin-top:1px}
.itens b{font-family:var(--f-tit);font-size:16.5px;display:block}
.itens p{color:var(--tinta2);font-size:15px;line-height:1.45}
.dica{margin-top:34px;background:var(--grafite);color:#e8ebee;border-radius:18px;padding:16px 20px;display:flex;gap:14px;align-items:baseline;max-width:52em}
.dica b{font-family:var(--f-dado);font-size:11.5px;text-transform:uppercase;letter-spacing:.14em;color:var(--lima);flex:0 0 auto}
/* celular */
.cel{margin:0;width:100%;max-width:270px;position:relative;background:#0d0e10;border-radius:46px;padding:9px;box-shadow:0 0 0 1.5px #3a3d42,0 24px 48px -18px rgba(20,24,30,.45),0 6px 14px rgba(20,24,30,.12)}
.cel-deitado{max-width:none;border-radius:42px}
/* celular com chamadas: espaço em volta para os números (a .fig dá 350 px para 270 de celular) */
.cel-mk{margin:40px auto 44px;max-width:min(270px,calc(100% - 92px))}
.tb{position:relative;container-type:inline-size}
.tela{position:relative;border-radius:37px;overflow:hidden;background:#f1f2f3;aspect-ratio:390/844}
.cel-deitado .tela{aspect-ratio:844/390;border-radius:33px}
.tela img{display:block;width:100%;height:100%;object-fit:cover}
.sb{position:absolute;left:0;right:0;top:0;height:5.6%;display:flex;align-items:center;justify-content:space-between;padding:0 7.5% 0 9.5%;color:#121315;font-family:-apple-system,'SF Pro Text',var(--f-txt);font-weight:600;font-size:4.4cqw}
.sb-esc{color:#fff}
.sb-ic{display:flex;gap:1.5cqw;align-items:center}
.sb-ic svg{height:3.2cqw;width:auto;fill:currentColor}
.sb-ic svg:last-child{height:3.6cqw}
.ilha{position:absolute;left:50%;top:22%;width:30%;height:60%;transform:translateX(-50%);background:#000;border-radius:999px}
.home{position:absolute;left:50%;bottom:1.1%;width:36%;height:1.6cqw;transform:translateX(-50%);background:#16181b;border-radius:999px;opacity:.85}
.home-esc{background:#fff}
.camada{position:absolute;inset:0;pointer-events:none;z-index:3}
.camada svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.ln,.ln-h{fill:none;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.ln-h{stroke:rgba(10,12,14,.55);stroke-width:3.4px}
.ln{stroke:var(--lima);stroke-width:1.5px}
.pt{position:absolute;width:3cqw;height:3cqw;margin:-1.5cqw 0 0 -1.5cqw;border-radius:50%;background:var(--lima);box-shadow:0 0 0 .7cqw rgba(10,12,14,.7)}
.mk{position:absolute;width:8.4cqw;height:8.4cqw;margin:-4.2cqw 0 0 -4.2cqw;border-radius:50%;background:var(--lima);color:var(--lima-esc);font:700 4.2cqw/8.4cqw var(--f-dado);text-align:center;box-shadow:0 0 0 .8cqw var(--papel),0 2px 6px rgba(0,0,0,.25)}
/* instalação */
.inst{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:30px}
.inst-col{background:#fff;border:1px solid var(--linha);border-radius:20px;padding:20px 22px}
.inst-col h3{font-size:22px;font-weight:800;margin-bottom:10px}
.passos{margin:0;padding-left:22px;display:grid;gap:9px;color:var(--tinta2)}
.passos b{color:var(--tinta)}
.ico{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--papel);border:1px solid var(--linha);vertical-align:-6px}
.ico svg{width:15px;height:15px;fill:none;stroke:#1f6fe0;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ico-txt{font-weight:800;color:var(--tinta)}
.nota{grid-column:1/-1;color:var(--tinta2)}
/* legenda */
.leg{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:22px 36px;margin-top:30px;align-items:start}
.leg-col{display:grid;gap:22px;min-width:0}
.leg figure{margin:0}
.leg-foto img{width:100%;border-radius:18px;display:block;box-shadow:0 18px 36px -18px rgba(20,24,30,.5)}
.leg-zoom img{width:100%;border-radius:14px;display:block;box-shadow:0 10px 22px -12px rgba(20,24,30,.5)}
.itens-leg b{font-family:var(--f-dado);font-size:13.5px;font-weight:600;overflow-wrap:anywhere}
.arq{background:var(--grafite);color:#e8ebee;border-radius:18px;padding:18px 20px}
.arq .lbl{display:block;font-family:var(--f-dado);font-size:11.5px;text-transform:uppercase;letter-spacing:.14em;color:var(--lima);margin-bottom:8px}
.arq code{display:block;font-family:var(--f-dado);font-size:14px;color:#fff;overflow-wrap:anywhere;margin-bottom:10px}
.arq p{color:#c9cdd3;font-size:15px}
/* ajustes */
.ajustes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:34px 40px;margin-top:34px}
.aj{display:grid;grid-template-columns:170px minmax(0,1fr);gap:22px;align-items:start;break-inside:avoid}
.aj .cel{border-radius:32px;padding:6px}
.aj .tela{border-radius:27px}
.aj h3{font-size:19px;font-weight:800;margin-bottom:8px}
.aj dl{margin:0}
.aj dt{font-family:var(--f-tit);font-weight:700;font-size:15.5px;margin-top:8px}
.aj dd{margin:0;color:var(--tinta2);font-size:14.5px;line-height:1.45}
/* problemas */
.faq{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:28px 0 0}
.faq div{background:#fff;border:1px solid var(--linha);border-radius:16px;padding:14px 18px;break-inside:avoid}
.faq dt{font-family:var(--f-tit);font-weight:800;font-size:17px;margin-bottom:4px}
.faq dd{margin:0;color:var(--tinta2);font-size:15px}
.rodape{padding-top:36px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-family:var(--f-dado);font-size:12.5px;color:var(--tinta3);text-transform:uppercase;letter-spacing:.08em}
.rodape b{color:var(--tinta)}
a:focus-visible{outline:3px solid var(--lima);outline-offset:3px;border-radius:6px}
@media (max-width:820px){
  .capa{grid-template-columns:1fr}
  .capa-cels{height:400px;max-width:420px;margin:0 auto;width:100%}
  .capa-cels .cel{width:170px}
  .passos-r{grid-template-columns:1fr 1fr}
  .fig,.fig-larga{grid-template-columns:1fr;gap:22px}
  .fig .cel{margin-inline:auto}
  .fig-txt{padding-top:0}
  .par{grid-template-columns:repeat(2,minmax(0,1fr))}
  .inst,.leg,.ajustes,.faq{grid-template-columns:1fr}
}
@media (max-width:460px){
  .passos-r{grid-template-columns:1fr}
  .aj{grid-template-columns:120px minmax(0,1fr);gap:14px}
  .capa-cels{height:330px}.capa-cels .cel{width:138px}
  .par{grid-template-columns:1fr}
}
/* PDF: o Chrome imprime com escala 0,72 (ver pdf()), então a folha A4 "enxerga" ~980 px de largura
   e usa o mesmo layout de computador da página web. Medidas aqui em px de tela. */
@media print{
  @page{size:A4;margin:12mm 12mm 14mm}
  body{background:#fff}
  .pag{max-width:none;padding:0}
  .capa{min-height:880px;border:none;align-content:center}
  .sum{break-after:page}
  #instalacao,#contratos{break-before:auto;padding-top:64px}
  .cap,.rapido{break-before:page;border:none;padding-top:0}
  .sum{border:none}
  .fig,.pi,.aj,.faq div,.dica,.inst,.leg-col,.passos-r,.arq,.itens li,.cap-h{break-inside:avoid}
  .cap-h,.lead{break-after:avoid}
  /* sombra fora da caixa vaza como um risco no pé da página anterior; no PDF vira borda */
  .cel,.placa,.leg-foto img,.leg-zoom img{box-shadow:none}
  .cel{border:1.5px solid #3a3d42}
  .placa{outline:1px solid var(--linha)}
  .leg-foto img,.leg-zoom img{box-shadow:none}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
`;
const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Overpass:wght@600;700;800&family=Overpass+Mono:wght@500;600;700&family=Source+Sans+3:wght@400;600&display=swap">';

const html = `<title>Manual do KM Check</title>
${FONTES}
<style>${CSS}</style>
<main class="pag">
  <header class="capa">
    <div>
      <img class="capa-logo" src="${LOGO}" alt="KM Check">
      <h1><span>Manual do usuário</span>KM Check</h1>
      <p class="sub">Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na foto, direto do campo e sem depender de internet.</p>
      <div class="meta"><span>Versão <b>${VERSAO}</b></span><span>${DATA}</span><span>iPhone e Android</span></div>
    </div>
    <div class="capa-cels">${celular('01-inicio', { numeros: false })}${celular('10-camera', { numeros: false })}${celular('20-carro-dia', { numeros: false })}</div>
  </header>
  <nav class="sum" aria-label="Sumário"><h2>Sumário</h2>${[{ id: 'rapido', km: '00', titulo: 'Guia rápido' }, ...capitulos].map(c => `<a href="#${c.id}">${placa('KM', c.km)}<b>${esc(c.titulo)}</b></a>`).join('')}</nav>
  <section class="rapido" id="rapido"><div class="cap-h">${placa('KM', '00')}<div><span class="eyebrow">Para começar</span><h2>Guia rápido</h2></div></div>
    <p class="lead">Do primeiro uso à primeira foto, em cinco passos.</p>
    <ol class="passos-r">${passosRapidos.map(p => `<li><b>${esc(p.t)}</b><p>${esc(p.d)}</p></li>`).join('')}</ol>
  </section>
  ${capitulos.map(capitulo).join('\n')}
  <footer class="rodape"><span>Desenvolvido por <b>Wagner Machado</b></span><span>KM Check · versão ${VERSAO} · ${DATA}</span></footer>
</main>`;
fs.writeFileSync(path.join(RAIZ, 'manual-km-check.html'), html);
console.log('manual-km-check.html', (Buffer.byteLength(html) / 1048576).toFixed(1) + ' MB');

/* guia rápido: 2 páginas A4 */
const guia = `<title>Guia rápido do KM Check</title>${FONTES}<style>${CSS}
.g1{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:8mm;margin-top:8mm}
.g1 .cel{max-width:none}
.g-cap{font-family:var(--f-dado);font-size:9pt;text-transform:uppercase;letter-spacing:.12em;color:var(--tinta3);margin-top:3mm;text-align:center}
.pg{break-after:page}
.pg .cap{break-before:auto;padding-top:0;border:none}
.g1{break-inside:avoid}
.pg:last-child{break-after:auto}
@media screen{.pg{max-width:800px;margin:0 auto 40px;padding:24px}}
</style>
<main class="pag">
<section class="pg"><img class="capa-logo" src="${LOGO}" alt="KM Check" style="height:38px;margin-bottom:6mm"><h1 style="font-size:34pt;font-weight:800;letter-spacing:-.02em">Guia rápido</h1>
<p class="lead" style="margin-top:3mm">Do primeiro uso à primeira foto, em cinco passos.</p>
<ol class="passos-r" style="margin-top:7mm">${passosRapidos.map(p => `<li><b>${esc(p.t)}</b><p>${esc(p.d)}</p></li>`).join('')}</ol>
<div class="g1"><div>${celular('01-inicio', { numeros: false })}<p class="g-cap">Tela inicial</p></div><div>${celular('10-camera', { numeros: false })}<p class="g-cap">Câmera</p></div><div>${celular('20-carro-dia', { numeros: false })}<p class="g-cap">Modo Carro</p></div></div></section>
<section class="pg"><h2 style="font-size:24pt;font-weight:800">A legenda da foto</h2>${capitulo(capitulos.find(c => c.id === 'legenda')).replace(/<header[\s\S]*?<\/header>/, '')}
<h2 style="font-size:18pt;font-weight:800;margin-top:9mm">Se algo der errado</h2><dl class="faq">${capitulos.find(c => c.id === 'problemas').faq.slice(0, 6).map(f => `<div><dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd></div>`).join('')}</dl>
<footer class="rodape"><span>Desenvolvido por <b>Wagner Machado</b></span><span>KM Check · versão ${VERSAO}</span></footer></section>
</main>`;
fs.writeFileSync(path.join(RAIZ, 'guia-rapido.html'), guia);

async function pdf(fonte, destino) {
  const p = await browser.newPage();
  await p.setContent('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fonte + '</body></html>', { waitUntil: 'networkidle0', timeout: 120000 });
  await p.evaluateHandle('document.fonts.ready');
  await p.pdf({ path: path.join(RAIZ, destino), format: 'A4', printBackground: true, preferCSSPageSize: true, scale: .72 });
  await p.close(); console.log(destino, (fs.statSync(path.join(RAIZ, destino)).size / 1048576).toFixed(1) + ' MB');
}
await pdf(html, 'Manual KM Check.pdf');
await pdf(guia, 'Guia rápido KM Check.pdf');
await browser.close();
