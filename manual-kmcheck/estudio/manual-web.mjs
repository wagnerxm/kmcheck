/* Manual web do KM Check: uma página única, contínua, no idioma visual do app.
 * Capa → guia rápido em cartões que empilham →
 * 11 capítulos ao longo de um eixo de rodovia que se desenha com a rolagem → fim do trecho.
 * Estilo em web.css e comportamento em web-cliente.js (ficam embutidos no HTML final).
 * Gera manual-kmcheck/manual-km-check.html. Uso: node manual-kmcheck/estudio/manual-web.mjs [--capturas] */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RAIZ, PR, marcas, esc, conversor } from './comum.mjs';
import { VERSAO, DATA, passosRapidos, capitulos } from './conteudo.mjs';

const EST = path.join(RAIZ, 'estudio');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const conv = await browser.newPage(), webp = conversor(conv);
const SCR = {};
for (const f of fs.readdirSync(PR).filter(f => /^\d.*\.png$/.test(f))) SCR[f.replace('.png', '')] = await webp(path.join(PR, f), f.includes('deitad') ? 1100 : 600);
/* foto da legenda: a rodovia com a legenda desenhada pelo próprio app (capturar.mjs fotolegenda) */
const FOTO_ARQ = path.join(EST, 'foto-campo-nova-legenda.webp');
const FOTO_CHEIA = await webp(FOTO_ARQ, 1400);
const LEG = JSON.parse(fs.readFileSync(path.join(EST, 'legenda.json'), 'utf8'));
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
/* fundo e capa: as artes aprovadas (mesmo enquadramento 1672×941), embutidas como estão, sem recomprimir */
const b64 = a => 'data:image/webp;base64,' + fs.readFileSync(path.join(EST, a)).toString('base64');
const FUNDO_IMG = b64('fundo-manual.webp'), CAPA_IMG = b64('capa-manual.webp');
const FUNDO = 'var(--fundo-img) var(--fundo-pos,center)/cover no-repeat,#eef0f1';

/* ---------- painel fixo ---------- */
const sumario = [{ id: 'rapido', km: '00', titulo: 'Guia rápido' }, ...capitulos];
const reel = `<span class="reel">${[...'0123456789'].map(d => `<span>${d}</span>`).join('')}</span>`;
const hud = `<nav class="hud" aria-label="Capítulos">
  <button class="hud-bar cdk" aria-expanded="false">${onda('tile')}<span class="hud-placa">KM<i></i><span class="odo" aria-hidden="true">${reel}${reel}</span></span>
    <span class="hud-txt"><span class="cl">KM 00</span><b>Guia rápido</b><span class="trilho"><i></i></span></span><span class="hud-seta"><svg viewBox="0 0 12 12"><path d="M3 4.5 6 7.5 9 4.5"/></svg></span></button>
  <div class="hud-menu cdk" hidden>${onda('main')}${sumario.map(c => `<a href="#${c.id}"><span>KM ${c.km}</span>${esc(c.titulo)}</a>`).join('')}</div>
</nav>`;

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
  return `<div class="story"><div class="story-fig" aria-hidden="true">${fone}${foneD}<div class="leg-passo"></div></div>
    <ol class="passos">${ps.map(p => `<li class="passo" data-tela="${p.tela}"${p.box ? ` data-box="${p.box}"` : ''}${p.or ? ' data-or="deitado"' : ''}><div class="passo-in"><span class="n">${p.num || '·'}</span><div><h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></div></div></li>`).join('')}</ol></div>`;
}
const dica = d => d ? `<div class="dica cdk" data-sobe>${onda('tile')}<b>Dica</b><p>${esc(d)}</p></div>` : '';

const TELA_PASSO = ['30-gestao-eixo', '01-inicio', '11-camera-servico-contrato', '10-camera', '13-galeria'];
const rapido = `<section class="cap" id="rapido" data-km="00" data-titulo="Guia rápido">${cabeca({ km: '00', titulo: 'Guia rápido', intro: 'Do primeiro uso à primeira foto, em cinco passos.' }, 'Para começar')}
  <ol class="pilha-passos">${passosRapidos.map((p, i) => `<li class="cartao-passo cdk" style="--i:${i}">${onda('main')}<div class="cp-txt"><span class="cp-num">0${i + 1}</span><h3>${esc(p.t)}</h3><p>${esc(p.d)}</p></div><div class="cp-tela"><img src="${SCR[TELA_PASSO[i]]}" alt="" loading="lazy" decoding="async"></div></li>`).join('')}</ol></section>`;

const EXPL = [
  'Rodovia e UF, KM com metros, lado da pista e estaca. Longe do eixo, aparece ⚠ no fim.',
  'Contrato e serviço. Sobre uma ponte ou viaduto, mostra também o nome da OAE.',
  'Coordenadas no formato escolhido, com a precisão do GPS se você quiser.',
  'Data da foto e a versão do SNV usada no cálculo do KM. A hora também pode aparecer.',
];
const LEGENDA_PASSOS = [
  { titulo: 'A foto registrada', texto: 'A legenda vai gravada na própria imagem, no canto que você escolher.' },
  ...LEG.caixas.map((c, i) => ({ titulo: c.texto, texto: EXPL[i] || '', box: c.box.join(','), num: i + 1 })),
  { titulo: 'Nome do arquivo', texto: LEG.nome + '. Rodovia, KM, lado, data e hora no nome, e a localização também nos dados da foto. Este é um modelo de exemplo: você escolhe o que aparece, a posição, a cor e o fundo.' },
];
function blocoLegenda() {
  return `<div class="story"><div class="story-fig foto" aria-hidden="true"><div class="quadro"><div class="quadro-in"><img src="${FOTO_CHEIA}" alt=""><span class="foco livre"></span></div></div><div class="leg-passo"></div></div>
    <ol class="passos">${LEGENDA_PASSOS.map(p => `<li class="passo" data-tela=""${p.box ? ` data-box="${p.box}"` : ''}><div class="passo-in"><span class="n">${p.num || '·'}</span><div><h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></div></div></li>`).join('')}</ol></div>`;
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
  if (c.legenda) miolo = blocoLegenda();
  else if (c.ajustes) miolo = blocoConfig(c);
  else if (c.faq) miolo = blocoFaq(c);
  else if (c.telas) miolo = story(passosDe(c.telas), { revela: c.id === 'carro' ? ['21-carro-noite'] : [] });
  return `<section class="cap" id="${c.id}" data-km="${c.km}" data-titulo="${esc(c.titulo)}">${cabeca(c)}${miolo}${dica(c.dica)}</section>`;
}).join('\n');

const fim = `<footer class="fim"><div class="fim-c cdk" data-sobe>${onda('main')}${placaSvg('FIM', 'KM', capitulos[capitulos.length - 1].km, 'placa-g')}<div><span class="olho" style="color:#b7d92d">Fim do trecho</span><h2 class="prata">Boas fotos e boa viagem.</h2><p>O KM Check se atualiza sozinho quando há internet. Este manual acompanha a versão ${VERSAO}.</p><div class="trilho"><i style="--p:1"></i></div></div></div>
  <div class="creditos"><span>Desenvolvido por <b>Wagner Machado</b></span><span>KM Check · versão ${VERSAO}</span></div></footer>`;

const CSS = fs.readFileSync(path.join(EST, 'web.css'), 'utf8').replaceAll('/*FUNDO*/', FUNDO);
const JS = fs.readFileSync(path.join(EST, 'web-cliente.js'), 'utf8');
const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap">';
const capa = `<img class="capa-img" src="${CAPA_IMG}" alt="" aria-hidden="true">
<section class="capa-web" aria-label="Capa"><div class="capa-txt">
  <span class="olho">KM Check</span>
  <h1 data-rev>Manual do<br>usuário</h1>
  <p>Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na própria foto. Direto do campo, sem depender de internet.</p>
  <div class="capa-chips"><span>Versão ${VERSAO}</span></div>
</div>
<div class="capa-pe"><span>Desenvolvido por <b>Wagner Machado</b></span><a class="rolar" href="#rapido">Role para começar<i aria-hidden="true"></i></a></div></section>`;
const corpo = `<title>Manual do KM Check</title>
${FONTES}
<style>:root{--fundo-img:url("${FUNDO_IMG}")}${CSS}</style>
${DEFS}
${hud}
<main>${capa}
<div class="viagem"><span class="eixo" aria-hidden="true"><i></i></span>
${rapido}
${corpoCaps}
</div>
${fim}</main>
<script>${JS}</script>`;
const SAIDA = path.join(RAIZ, 'manual-km-check.html');
fs.writeFileSync(SAIDA, corpo);
console.log('manual-km-check.html', (Buffer.byteLength(corpo) / 1048576).toFixed(2) + ' MB');

/* versão que mora dentro do app (kmcheck/manual/): as imagens viram arquivos com nome pelo conteúdo
   (o HTML fica leve, o celular baixa as imagens conforme a rolagem e o cache do app guarda cada uma) */
const APP = path.resolve('manual'), IMGD = path.join(APP, 'img');
fs.mkdirSync(IMGD, { recursive: true });
const usados = new Set();
let app = corpo.replace(/data:image\/(webp|png);base64,([A-Za-z0-9+/=]+)/g, (m, ext, dados) => {
  const buf = Buffer.from(dados, 'base64'), nome = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) + '.' + ext;
  if (!usados.has(nome)) { fs.writeFileSync(path.join(IMGD, nome), buf); usados.add(nome); }
  return 'img/' + nome;
}).replace(/<img (?![^>]*loading=)/g, '<img loading="lazy" ');
for (const x of fs.readdirSync(IMGD)) if (!usados.has(x)) fs.unlinkSync(path.join(IMGD, x));
fs.copyFileSync(path.join(EST, 'capa-manual.webp'), path.join(APP, 'capa.webp')); // arte da mensagem de boas-vindas do app
/* manual de bolso (cartão de boas-vindas do app): telas e artes com nome fixo em manual/tour/ */
const TOUR = path.join(APP, 'tour'); fs.mkdirSync(TOUR, { recursive: true });
const grava = (nome, url) => fs.writeFileSync(path.join(TOUR, nome + '.webp'), Buffer.from(url.split(',')[1], 'base64'));
for (const n of ['01-inicio', '10-camera', '20-carro-dia', '30-gestao-eixo', '31-importar']) grava(n, SCR[n]);
grava('foto', FOTO_CHEIA);
fs.copyFileSync(path.join(EST, 'fundo-manual.webp'), path.join(TOUR, 'fundo.webp'));
fs.writeFileSync(path.join(APP, 'index.html'), '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"></head><body>' + app + '</body></html>');
console.log('manual/index.html', (Buffer.byteLength(app) / 1024).toFixed(0) + ' KB +', usados.size, 'imagens');

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
    const alvos = ['.capa-web', '.capa-img', '#rapido', '#inicio', '#camera', '#legenda', '#carro', '#config', '#problemas', '.fim'];
    for (const [i, a] of alvos.entries()) {
      const extra = { '.capa-img': h * .4, '#manifesto': h * .7, '#rapido': h * 1.6, '#inicio': h * 1.8, '#camera': h * 1.2, '#legenda': h * 1.5, '#carro': h * 5.5, '#config': h * 1.2 }[a] || 0;
      await p.evaluate((a, extra) => { const el = document.querySelector(a); scrollTo({ top: (a === '.capa-img' ? 0 : el.getBoundingClientRect().top + scrollY) + extra, behavior: 'instant' }); }, a, extra);
      await espera(1300);
      await p.screenshot({ path: path.join(DIR, `${tag}-${String(i).padStart(2, '0')}-${a.replace(/[#.]/g, '')}.jpg`), type: 'jpeg', quality: 72 });
    }
    console.log(tag, 'largura', await p.evaluate(() => document.documentElement.scrollWidth), 'altura', await p.evaluate(() => document.documentElement.scrollHeight));
  }
  console.log('erros', erros.length ? erros : 'nenhum');
}
await browser.close();
