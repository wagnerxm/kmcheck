/* Manual web do KM Check: uma página única, contínua, no idioma visual do app.
 * Topo interativo (pontos sobre o celular) → manifesto → guia rápido em cartões que empilham →
 * 11 capítulos ao longo de um eixo de rodovia que se desenha com a rolagem → fim do trecho.
 * Estilo em web.css e comportamento em web-cliente.js (ficam embutidos no HTML final).
 * Gera manual-kmcheck/manual-km-check.html. Uso: node manual-kmcheck/estudio/manual-web.mjs [--capturas] */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, PR, marcas, esc, conversor } from './comum.mjs';
import { VERSAO, DATA, passosRapidos, capitulos } from './conteudo.mjs';

const EST = path.join(RAIZ, 'estudio');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const conv = await browser.newPage(), webp = conversor(conv);
const SCR = {};
for (const f of fs.readdirSync(PR).filter(f => /^\d.*\.png$/.test(f))) SCR[f.replace('.png', '')] = await webp(path.join(PR, f), f.includes('deitad') ? 1100 : 600);
const FOTO_ARQ = path.join(EST, 'foto-campo-rodovia.webp');
const FOTO_PALCO = await webp(FOTO_ARQ, 1600, [0, 0, 1, .78]);
const FOTO_CHEIA = await webp(FOTO_ARQ, 1100);
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.resolve('logo-header.png')).toString('base64');
await conv.close();

const ESCURAS = new Set(['10-camera', '11-camera-servico-contrato', '12-camera-deitada', '13-galeria', '21-carro-noite', '33-importar-configurar', '60-vincular-contrato', '61-vincular-trecho', '62-detalhes-rodovia', '63-estaca', '64-gps-desligado']);
const idx = fs.readFileSync(path.resolve('index.html'), 'utf8');
const ini = idx.indexOf('<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>');
const DEFS = idx.slice(ini, idx.indexOf('</defs></svg>', ini) + 13);
const onda = (s = 'main') => `<svg class="cwv" aria-hidden="true"><use href="#car-a${s}"/></svg>`;
const placaSvg = (a, b, c, cls = '') => `<svg class="placa ${cls}" viewBox="0 0 150 178" aria-hidden="true"><rect x="2" y="2" width="146" height="174" rx="14" fill="#fff"/><rect x="10" y="10" width="130" height="158" rx="9" fill="#13305c"/><rect x="10" y="10" width="130" height="70" rx="9" fill="#fff" fill-opacity=".05"/><text x="75" y="52" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="${a.length >= 6 ? 22 : 31}" fill="#fff">${a}</text><line x1="24" y1="68" x2="126" y2="68" stroke="#fff" stroke-width="3"/><text x="75" y="110" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="34" fill="#fff">${b}</text><text x="75" y="156" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="42" fill="#fff">${c}</text></svg>`;
const sb = '<div class="h-sb"><span>9:41</span><span class="h-ilha"></span><span class="h-bat"></span></div>';
const tl = (n, on, extra = '') => `<img class="tl${on ? ' on' : ''}" data-t="${n}" data-esc="${ESCURAS.has(n) ? 1 : 0}" src="${SCR[n]}" alt="" decoding="async"${extra}>`;

/* fundo claro abstrato (cetim claro do app + um fio verde-limão), fixo atrás de toda a página */
const CETIM = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 1000' preserveAspectRatio='none'><defs><filter id='b' x='-10%' y='-50%' width='120%' height='200%'><feGaussianBlur stdDeviation='28'/></filter><linearGradient id='h' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.95'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient><linearGradient id='s' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='#9aa6b2' stop-opacity='.38'/><stop offset='1' stop-color='#9aa6b2' stop-opacity='0'/></linearGradient><linearGradient id='l' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#b7d92d' stop-opacity='0'/><stop offset='.3' stop-color='#b7d92d' stop-opacity='.75'/><stop offset='.55' stop-color='#b7d92d' stop-opacity='.15'/><stop offset='.85' stop-color='#c9e463' stop-opacity='.85'/><stop offset='1' stop-color='#b7d92d' stop-opacity='0'/></linearGradient></defs><path d='M0,330 C260,250 520,280 800,350 C1080,420 1340,400 1600,300 L1600,210 C1340,300 1080,320 800,250 C520,180 260,150 0,240 Z' fill='url(#s)' filter='url(#b)'/><path d='M0,330 C260,250 520,280 800,350 C1080,420 1340,400 1600,300 L1600,440 C1340,540 1080,560 800,490 C520,420 260,390 0,470 Z' fill='url(#h)' filter='url(#b)'/><path d='M0,640 C300,560 640,620 940,660 C1200,694 1420,650 1600,600 L1600,520 C1420,570 1200,614 940,580 C640,540 300,480 0,560 Z' fill='url(#s)' filter='url(#b)'/><path d='M0,640 C300,560 640,620 940,660 C1200,694 1420,650 1600,600 L1600,740 C1420,790 1200,834 940,800 C640,760 300,700 0,780 Z' fill='url(#h)' filter='url(#b)' opacity='.85'/><path d='M0,900 C380,840 820,900 1600,860 L1600,1000 L0,1000 Z' fill='url(#s)' filter='url(#b)' opacity='.7'/><path d='M0,332 C260,252 520,282 800,352 C1080,422 1340,402 1600,302' fill='none' stroke='url(#l)' stroke-width='1.6'/><path d='M0,642 C300,562 640,622 940,662 C1200,696 1420,652 1600,602' fill='none' stroke='#fff' stroke-opacity='.9' stroke-width='1.2'/></svg>`)}")`;
const GRAO = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .1 0 0 0 0 .12 0 0 0 0 .16 .05 0 0 0 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;
const FUNDO = `${GRAO},${CETIM} center/100% 100% no-repeat,radial-gradient(1200px 800px at 18% 0%,#ffffff 0%,#f1f2f1 45%,#e4e7ea 100%)`;

/* ---------- topo interativo ---------- */
const DET = {
  camera: { tela: '10-camera', km: '03', titulo: 'Registrar evidência', texto: 'A câmera mostra a legenda ao vivo, exatamente como ela vai gravada na foto.', pontos: [
    [37.2, 70.6, 'Legenda ao vivo', 'Rodovia, KM, lado, estaca, contrato e coordenadas, do jeito que saem na foto.'],
    [7.9, 89.6, 'Lado da pista', 'LD ou LE. Toque de novo no mesmo botão para tirar o lado da legenda.'],
    [50, 89.6, 'Obturador', 'Tira a foto. Sem um GPS confiável, o app avisa e não deixa registrar.']] },
  carro: { tela: '20-carro-dia', km: '06', titulo: 'Modo Carro', texto: 'Um painel grande para acompanhar a rodovia dirigindo, com o celular no suporte.', pontos: [
    [50, 41.4, 'KM ao vivo', 'Quilômetro exato, atualizado pelo GPS enquanto você dirige.'],
    [50, 51.1, 'Próximo km', 'A barra e os metros que faltam para o próximo quilômetro.'],
    [73.2, 75.4, 'Lado', 'Crescente ou Decrescente, pelo sentido em que o KM está mudando.']] },
};
const PONTOS = [
  { id: 'camera', x: 50, y: 88.9, rot: 'Registrar evidência' },
  { id: 'carro', x: 86.7, y: 20, rot: 'Modo Carro' },
  { id: 'noite', x: 50, y: 42.9, rot: 'Dia e noite' },
  { id: 'girar', x: 50, y: 60.5, rot: 'Em pé ou deitado' },
];
const MENUS = { noite: { titulo: 'Modo Carro', ops: [['dia', 'Dia'], ['noite', 'Noite']] }, girar: { titulo: 'Celular', ops: [['pe', 'Em pé'], ['deitado', 'Deitado']] } };
const seta = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>';
const hero = `
<section class="hero" id="topo" aria-label="Conheça o KM Check">
  <header class="h-top"><img class="h-logo" src="${LOGO}" alt="KM Check"><span class="h-meio">Manual do usuário</span><span>Versão ${VERSAO} · ${DATA[0].toUpperCase() + DATA.slice(1)}</span></header>
  <div class="h-tit"><h1 data-rev>O KM certo,<br>em cada foto.</h1><p>Explore o app por dentro.<br>Toque num ponto para começar.</p></div>
  <div class="cena" data-modo="geral">
    <div class="palco">
      <img class="palco-foto" src="${FOTO_PALCO}" alt="">
      <div class="h-cel"><div class="h-moldura"><div class="h-tela">${tl('01-inicio', true)}${tl('10-camera')}${tl('20-carro-dia')}${tl('21-carro-noite')}${sb}</div></div>
        ${PONTOS.map(p => `<button class="ponto" data-p="${p.id}" style="left:${p.x}%;top:${p.y}%" aria-label="${p.rot}"><span class="disco" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8"/></svg></span><span class="rotulo">${p.rot}</span></button>`).join('')}
      </div>
      <div class="h-deitado" aria-hidden="true"><div class="h-moldura"><div class="h-tela">${tl('22-carro-deitado', true)}</div></div></div>
    </div>
    ${Object.entries(DET).map(([id, d]) => `<div class="det" data-det="${id}" hidden>
      <div class="det-cel"><div class="h-moldura"><div class="h-tela">${tl(d.tela, true)}</div></div>
        ${d.pontos.map((p, i) => `<button class="dp" data-i="${i}" style="left:${p[0]}%;top:${p[1]}%" aria-label="${p[2]}">${i + 1}</button>`).join('')}</div>
      <div class="det-txt cdk">${onda('main')}<div>
        <button class="voltar" type="button">${seta}Voltar</button>
        <span class="olho2">KM ${d.km}</span><h2 class="prata">${d.titulo}</h2><p class="det-p">${d.texto}</p>
        <ol class="det-lista">${d.pontos.map((p, i) => `<li><button class="dl" data-i="${i}" aria-expanded="false"><span class="n">${i + 1}</span><b>${p[2]}</b></button><p>${p[3]}</p></li>`).join('')}</ol>
        <a class="ir" href="#${id}">Ler o capítulo <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4"/></svg></a>
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
  <a class="rolar" href="#manifesto">Comece a viagem<i aria-hidden="true"></i></a>
</section>`;

/* ---------- painel fixo ---------- */
const sumario = [{ id: 'rapido', km: '00', titulo: 'Guia rápido' }, ...capitulos];
const reel = `<span class="reel">${[...'0123456789'].map(d => `<span>${d}</span>`).join('')}</span>`;
const hud = `<nav class="hud" aria-label="Capítulos">
  <button class="hud-bar cdk" aria-expanded="false">${onda('tile')}<span class="hud-placa">KM<i></i><span class="odo" aria-hidden="true">${reel}${reel}</span></span>
    <span class="hud-txt"><span class="cl">KM 00</span><b>Guia rápido</b><span class="trilho"><i></i></span></span><span class="hud-seta"><svg viewBox="0 0 12 12"><path d="M3 4.5 6 7.5 9 4.5"/></svg></span></button>
  <div class="hud-menu cdk" hidden>${onda('main')}${sumario.map(c => `<a href="#${c.id}"><span>KM ${c.km}</span>${esc(c.titulo)}</a>`).join('')}</div>
</nav>`;

/* ---------- manifesto ---------- */
const MANIF = 'Cada foto sai com a rodovia, o KM, a estaca e as coordenadas gravadas na imagem. Sem anotar nada. Sem depender de internet. Direto do campo.';
const DESTAQUE = new Set(['rodovia,', 'KM,', 'estaca', 'coordenadas']);
const manifesto = `<section class="manifesto" id="manifesto" aria-label="O que o KM Check faz"><div class="manifesto-in"><p>${MANIF.split(' ').map(w => `<span class="w${DESTAQUE.has(w) ? ' lima' : ''}">${w}</span>`).join(' ')}</p></div></section>`;

/* ---------- blocos dos capítulos ---------- */
const marco = km => `<span class="marco" aria-hidden="true"><span>KM<i></i><b>${km}</b></span></span>`;
const cabeca = (c, olho) => `${marco(c.km)}<header class="cap-h"><span class="olho">${olho || 'KM ' + c.km}</span><h2 data-rev>${esc(c.titulo)}</h2>${c.intro ? `<p class="intro" data-sobe>${esc(c.intro)}</p>` : ''}</header>`;
const caixa = (img, n) => {
  const m = (marcas[img] || []).find(b => b.n === n); if (!m) return '';
  const l = Math.max(0, m.l - 1.5), t = Math.max(0, m.t - .8);
  return [l, t, Math.min(100 - l, m.w + 3), Math.min(100 - t, m.h + 1.6)].map(v => +v.toFixed(2)).join(',');
};
/* passos da rolagem guiada a partir das telas do conteúdo */
function passosDe(telas) {
  const ps = [];
  for (const t of telas) {
    const or = t.img.includes('deitad') ? 'deitado' : '';
    if (t.itens) {
      if (t.texto) ps.push({ tela: t.img, titulo: t.titulo || 'Nesta tela', texto: t.texto, or });
      t.itens.forEach((it, i) => ps.push({ tela: t.img, titulo: it[0], texto: it[1], box: caixa(t.img, i + 1), or, num: i + 1 }));
    } else ps.push({ tela: t.img, titulo: t.titulo, texto: t.texto, or });
  }
  return ps;
}
function story(ps, { revela = [] } = {}) {
  const retrato = [...new Set(ps.filter(p => !p.or).map(p => p.tela))], deitado = [...new Set(ps.filter(p => p.or).map(p => p.tela))];
  const fone = retrato.length ? `<div class="fone"><div class="h-moldura"><div class="h-tela">${retrato.map((t, i) => tl(t, i === 0, revela.includes(t) ? ' data-revela' : '')).join('')}${sb}<span class="foco livre"></span></div></div></div>` : '';
  const foneD = deitado.length ? `<div class="fone-d"><div class="h-moldura"><div class="h-tela">${deitado.map((t, i) => tl(t, i === 0)).join('')}</div></div></div>` : '';
  let k = 0;
  return `<div class="story"><div class="story-fig" aria-hidden="true">${fone}${foneD}</div>
    <ol class="passos">${ps.map(p => `<li class="passo" data-tela="${p.tela}"${p.box ? ` data-box="${p.box}"` : ''}${p.or ? ' data-or="deitado"' : ''}><div class="passo-in"><span class="n">${p.num || '·'}</span><div><h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></div></div></li>`).join('')}</ol></div>`;
}
const dica = d => d ? `<div class="dica cdk" data-sobe>${onda('tile')}<b>Dica</b><p>${esc(d)}</p></div>` : '';

const TELA_PASSO = ['30-gestao-eixo', '01-inicio', '11-camera-servico-contrato', '10-camera', '13-galeria'];
const rapido = `<section class="cap" id="rapido" data-km="00" data-titulo="Guia rápido">${cabeca({ km: '00', titulo: 'Guia rápido', intro: 'Do primeiro uso à primeira foto, em cinco passos.' }, 'Para começar')}
  <ol class="pilha-passos">${passosRapidos.map((p, i) => `<li class="cartao-passo cdk" style="--i:${i}">${onda('main')}<div class="cp-txt"><span class="cp-num">0${i + 1}</span><h3>${esc(p.t)}</h3><p>${esc(p.d)}</p></div><div class="cp-tela"><img src="${SCR[TELA_PASSO[i]]}" alt="" loading="lazy" decoding="async"></div></li>`).join('')}</ol></section>`;

const LEGENDA_PASSOS = [
  { titulo: 'A foto registrada', texto: 'BR-226/RN, setembro de 2026. A legenda vai gravada na própria imagem, no canto que você escolher.' },
  { titulo: 'BR-226/RN - KM 326,040  LD · Est. 16302+0', texto: 'Rodovia e UF, KM com metros, lado da pista e estaca. Longe do eixo, aparece ⚠ no fim.', box: '0.5,81.4,55,4.4', num: 1 },
  { titulo: '515/2024 - Aplicação de CBUQ', texto: 'Contrato e serviço. Sobre uma ponte ou viaduto, mostra também o nome da OAE.', box: '0.5,85.8,55,4.4', num: 2 },
  { titulo: '-6,077494, -37,537469', texto: 'Coordenadas no formato escolhido, com a precisão do GPS se você quiser.', box: '0.5,90.2,55,4.4', num: 3 },
  { titulo: '15/09/2026, 11:27 · SNV Jul/26', texto: 'Data e hora da foto e a versão do SNV usada no cálculo do KM.', box: '0.5,94.6,55,4.6', num: 4 },
  { titulo: 'Nome do arquivo', texto: 'BR-226-RN_KM326+040_LD_2026-09-15_11-27-05.jpg. Rodovia, KM, lado, data e hora no nome, e a localização também nos dados da foto. Este é um modelo de exemplo: você escolhe o que aparece, a posição, a cor e o fundo.' },
];
function blocoLegenda() {
  return `<div class="story"><div class="story-fig foto" aria-hidden="true"><div class="quadro"><div class="quadro-in"><img src="${FOTO_CHEIA}" alt=""><span class="foco livre"></span></div></div></div>
    <ol class="passos">${LEGENDA_PASSOS.map(p => `<li class="passo" data-tela=""${p.box ? ` data-box="${p.box}"` : ''}><div class="passo-in"><span class="n">${p.num || '·'}</span><div><h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></div></div></li>`).join('')}</ol></div>`;
}
function blocoInstalacao() {
  return `<div class="inst">
    <div class="cdk" data-sobe>${onda('main')}<div><h3 class="prata">iPhone</h3><ol>
      <li><span class="n">1</span><span>Abra <b>wagnerxm.github.io/kmcheck</b> no <b>Safari</b>.</span></li>
      <li><span class="n">2</span><span>Toque no botão <b>Compartilhar</b> na barra do Safari.</span></li>
      <li><span class="n">3</span><span>Role e toque em <b>Adicionar à Tela de Início</b>.</span></li>
      <li><span class="n">4</span><span>Toque em <b>Adicionar</b>. O ícone do KM Check aparece na tela inicial.</span></li></ol></div></div>
    <div class="cdk" data-sobe style="--d:120ms">${onda('main')}<div><h3 class="prata">Android</h3><ol>
      <li><span class="n">1</span><span>Abra <b>wagnerxm.github.io/kmcheck</b> no <b>Chrome</b>.</span></li>
      <li><span class="n">2</span><span>Toque em <b>Instalar</b> quando o app oferecer, ou no menu ⋮ do Chrome.</span></li>
      <li><span class="n">3</span><span>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</span></li>
      <li><span class="n">4</span><span>Confirme. O KM Check abre em tela cheia, como os outros apps.</span></li></ol></div></div>
  </div><p class="nota" data-sobe>Na primeira abertura, permita a localização e a câmera. Sem elas o app não consegue gravar o KM nem tirar a foto.</p>`;
}
function blocoConfig(c) {
  return `<div class="galeria"><div class="galeria-in"><div class="trilha">${c.ajustes.map(a => `<article class="aj cdk">${onda('main')}<div class="aj-tela"><img src="${SCR[a.img]}" alt="" loading="lazy" decoding="async"></div><div><h3 class="prata">${esc(a.titulo)}</h3><dl>${a.linhas.map(l => `<dt>${esc(l[0])}</dt><dd>${esc(l[1])}</dd>`).join('')}</dl></div></article>`).join('')}</div></div></div>`;
}
function blocoFaq(c) {
  const img = c.telas && c.telas[0] ? SCR[c.telas[0].img] : '';
  return `<div class="faq">${c.faq.map((f, i) => `<button class="faq-c cdk" data-t="${esc(f[0])}" data-r="${esc(f[1])}"${/Localização/.test(f[0]) && img ? ` data-img="${img}"` : ''} data-sobe style="--d:${(i % 3) * 80}ms">${onda('tile')}<b>${esc(f[0])}</b><span class="cl">Ver solução<span class="mais"><svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8"/></svg></span></span></button>`).join('')}</div>`;
}

const corpoCaps = capitulos.map(c => {
  let miolo = '';
  if (c.instalacao) miolo = blocoInstalacao();
  else if (c.legenda) miolo = blocoLegenda();
  else if (c.ajustes) miolo = blocoConfig(c);
  else if (c.faq) miolo = blocoFaq(c);
  else if (c.telas) miolo = story(passosDe(c.telas), { revela: c.id === 'carro' ? ['21-carro-noite'] : [] });
  return `<section class="cap" id="${c.id}" data-km="${c.km}" data-titulo="${esc(c.titulo)}">${cabeca(c)}${miolo}${dica(c.dica)}</section>`;
}).join('\n');

const fim = `<footer class="fim"><div class="fim-c cdk" data-sobe>${onda('main')}${placaSvg('FIM', 'KM', '11', 'placa-g')}<div><span class="olho" style="color:#b7d92d">Fim do trecho</span><h2 class="prata">Boas fotos e boa viagem.</h2><p>O KM Check se atualiza sozinho quando há internet. Este manual acompanha a versão ${VERSAO}.</p><div class="trilho"><i style="--p:1"></i></div></div></div>
  <div class="creditos"><span>Desenvolvido por <b>Wagner Machado</b></span><span>KM Check · versão ${VERSAO} · ${DATA}</span></div></footer>`;

const CSS = fs.readFileSync(path.join(EST, 'web.css'), 'utf8').replaceAll('/*FUNDO*/', FUNDO);
const JS = fs.readFileSync(path.join(EST, 'web-cliente.js'), 'utf8');
const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap">';
const corpo = `<title>Manual do KM Check</title>
${FONTES}
<style>${CSS}</style>
${DEFS}
${hud}
<main>${hero}
${manifesto}
<div class="viagem"><span class="eixo" aria-hidden="true"><i></i></span>
${rapido}
${corpoCaps}
</div>
${fim}</main>
<script>${JS}</script>`;
const SAIDA = path.join(RAIZ, 'manual-km-check.html');
fs.writeFileSync(SAIDA, corpo);
console.log('manual-km-check.html', (Buffer.byteLength(corpo) / 1048576).toFixed(2) + ' MB');

/* conferência automática: sem erros, sem rolagem lateral, e capturas de alguns pontos da viagem */
if (process.argv.includes('--capturas')) {
  const doc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + corpo + '</body></html>';
  const DIR = path.join(RAIZ, 'opcoes', 'web'); fs.mkdirSync(DIR, { recursive: true });
  const p = await browser.newPage(); const erros = [];
  /* este Windows está com "efeitos de animação" desligados e o Chrome repassa isso como reduzir movimento */
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  p.on('pageerror', e => erros.push(e.message)); p.on('console', m => m.type() === 'error' && erros.push(m.text()));
  const espera = ms => new Promise(r => setTimeout(r, ms));
  for (const [w, h, tag] of [[1440, 900, 'pc'], [390, 844, 'cel']]) {
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await p.setContent(doc, { waitUntil: 'load', timeout: 120000 }); await espera(1500);
    const alvos = ['#topo', '#manifesto', '#rapido', '#inicio', '#camera', '#legenda', '#carro', '#config', '#problemas', '.fim'];
    for (const [i, a] of alvos.entries()) {
      const extra = { '#manifesto': h * .7, '#rapido': h * 1.6, '#inicio': h * 1.8, '#camera': h * 1.2, '#legenda': h * 1.5, '#carro': h * 5.5, '#config': h * 1.2 }[a] || 0;
      await p.evaluate((a, extra) => { const el = document.querySelector(a); scrollTo({ top: el.getBoundingClientRect().top + scrollY + extra, behavior: 'instant' }); }, a, extra);
      await espera(1300);
      await p.screenshot({ path: path.join(DIR, `${tag}-${String(i).padStart(2, '0')}-${a.replace(/[#.]/g, '')}.jpg`), type: 'jpeg', quality: 72 });
    }
    console.log(tag, 'largura', await p.evaluate(() => document.documentElement.scrollWidth), 'altura', await p.evaluate(() => document.documentElement.scrollHeight));
  }
  console.log('erros', erros.length ? erros : 'nenhum');
}
await browser.close();
