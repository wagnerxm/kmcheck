/* Peças comuns aos layouts do manual: imagens leves, moldura do celular e chamadas numeradas.
 * As cores das chamadas e do celular vêm de variáveis CSS, para cada tema pintar do seu jeito. */
import fs from 'node:fs';
import path from 'node:path';

export const RAIZ = path.resolve('manual-kmcheck'), PR = path.join(RAIZ, 'prints');
export const marcas = JSON.parse(fs.readFileSync(path.join(PR, 'marcas.json'), 'utf8'));
export const ICONES = fs.readFileSync(path.join(RAIZ, 'estudio/montar.mjs'), 'utf8').match(/const ICONES = `([^`]*)`/)[1];
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ESCURAS = new Set(['10-camera', '11-camera-servico-contrato', '12-camera-deitada', '13-galeria', '21-carro-noite', '33-importar-configurar', '60-vincular-contrato', '61-vincular-trecho', '62-detalhes-rodovia', '63-estaca', '64-gps-desligado']);

/* converte para WebP no próprio Chrome (sem dependência de imagem); recorte = [x, y, larg, alt] em fração */
export function conversor(page) {
  return async (arquivo, larg, recorte) => {
    const b64 = 'data:image/' + (arquivo.endsWith('.webp') ? 'webp' : 'png') + ';base64,' + fs.readFileSync(arquivo).toString('base64');
    return page.evaluate(async (src, larg, rc) => {
      const img = new Image(); img.src = src; await img.decode();
      const [sx, sy, sw, sh] = rc ? [rc[0] * img.width, rc[1] * img.height, rc[2] * img.width, rc[3] * img.height] : [0, 0, img.width, img.height];
      const c = document.createElement('canvas'); c.width = larg; c.height = Math.round(larg * sh / sw);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', .86);
    }, b64, larg, recorte || null);
  };
}

function espalha(arr, k, gap, min, max) {
  arr.sort((a, b) => a[k] - b[k]);
  arr.forEach((p, i) => { p[k] = Math.max(i ? arr[i - 1][k] + gap : min, p[k]) });
  for (let i = arr.length - 1; i >= 0; i--) { const lim = i === arr.length - 1 ? max : arr[i + 1][k] - gap; if (arr[i][k] > lim) arr[i][k] = lim }
}
/* número fora do celular (laterais, ou acima/abaixo para botões das barras) e linha até um anel no item.
   Coordenadas em % da tela; o SVG usa viewBox 0 0 100 100 esticado sobre ela. */
export function chamadas(lista) {
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
export function fabricaCelular(IMG) {
  return (nome, { numeros = true, w = 220, cls = '', estilo = '' } = {}) => {
    const escura = ESCURAS.has(nome), deitado = nome.includes('deitad');
    const mk = numeros && marcas[nome] ? chamadas(marcas[nome]) : '';
    const barra = deitado ? '' : `<div class="sb${escura ? ' sb-esc' : ''}"><span>9:41</span><span class="ilha"></span>${ICONES}</div>`;
    return `<figure class="cel${deitado ? ' cel-deitado' : ''} ${cls}" style="--w:${w}px;${estilo}"><div class="tb"><div class="tela"><img src="${IMG[nome]}" alt="">${barra}<span class="home${escura ? ' home-esc' : ''}"></span></div>${mk}</div></figure>`;
  };
}
export const placa = (cima, baixo, cls = '') => `<span class="placa ${cls}"><span class="placa-in"><b>${cima}</b><i></i><em>${baixo}</em></span></span>`;

/* moldura do celular: aro metálico, reflexo do vidro, botões laterais. Cores do tema via --cel-sombra */
export const CSS_CEL = `
.cel{position:relative;margin:0;width:var(--w);padding:calc(var(--w)*.034);border-radius:calc(var(--w)*.165);
  background:linear-gradient(140deg,#4d525a 0%,#141517 18%,#0b0c0d 60%,#2d3136 100%);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 0 0 1px #000,var(--cel-sombra,0 46px 80px -28px rgba(0,0,0,.9),0 16px 30px -14px rgba(0,0,0,.7))}
.cel::before,.cel::after{content:'';position:absolute;width:3px;border-radius:2px;background:#2c3035}
.cel::before{left:-3px;top:20%;height:10%;box-shadow:0 calc(var(--w)*.2) 0 #2c3035}
.cel::after{right:-3px;top:26%;height:14%}
.cel-deitado{border-radius:calc(var(--w)*.075);padding:calc(var(--w)*.016)}
.cel-deitado::before,.cel-deitado::after{display:none}
.tb{position:relative;container-type:inline-size}
.tela{position:relative;border-radius:calc(var(--w)*.135);overflow:hidden;aspect-ratio:390/844;background:#0b0c0d}
.cel-deitado .tela{aspect-ratio:844/390;border-radius:calc(var(--w)*.062)}
.tela img{display:block;width:100%;height:100%;object-fit:cover}
.tela::after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,.04) 26%,transparent 40%);pointer-events:none}
.sb{position:absolute;left:0;right:0;top:0;height:5.6%;display:flex;align-items:center;justify-content:space-between;padding:0 7.5% 0 9.5%;color:#121315;font:600 4.4cqw -apple-system,'SF Pro Text',system-ui,sans-serif}
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
.ln-h{stroke:var(--ln-h);stroke-width:3.2px}
.ln{stroke:var(--ln);stroke-width:1.2px}
.pt{position:absolute;width:3.6cqw;height:3.6cqw;margin:-1.8cqw 0 0 -1.8cqw;border-radius:50%;border:.9cqw solid var(--ln);background:rgba(8,9,10,.45)}
.mk{position:absolute;width:9.4cqw;height:9.4cqw;margin:-4.7cqw 0 0 -4.7cqw;border-radius:50%;background:var(--mk-bg);color:var(--mk-fg);font:700 4.6cqw/9.4cqw var(--f-dado);text-align:center;box-shadow:0 0 0 .9cqw var(--mk-anel),0 3px 8px rgba(0,0,0,.35)}
`;

/* curvas de nível: famílias de anéis irregulares em volta de "morros", a cada 5ª linha mais forte */
export function curvasDeNivel(w, h, morros) {
  let d1 = '', d2 = '';
  for (const [cx, cy, n, passo, fase] of morros) {
    for (let k = 1; k <= n; k++) {
      const r = k * passo, pts = [];
      for (let i = 0; i <= 140; i++) {
        const a = i / 140 * Math.PI * 2;
        const rr = r * (1 + .16 * Math.sin(3 * a + fase + k * .07) + .08 * Math.sin(5 * a + fase * 2 - k * .05) + .05 * Math.sin(9 * a + k * .11));
        pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a) * .78).toFixed(1)}`);
      }
      const d = 'M' + pts.join('L') + 'Z';
      if (k % 5 === 0) d2 += d; else d1 += d;
    }
  }
  return `<svg class="topo" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d1}" fill="none" stroke="var(--curva)" stroke-width=".7"/><path d="${d2}" fill="none" stroke="var(--curva-mestra)" stroke-width="1.1"/></svg>`;
}
/* eixo da rodovia: curva cúbica com marcas de estaca a cada "passo" px e rótulo a cada 5 marcas */
export function eixo(w, h, p, passo = 26, inicioKm = 0) {
  const B = t => { const u = 1 - t; return [0, 1].map(i => u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i]) };
  let tick = '', rot = '', s = 0, prox = 0, ant = B(0), n = 0;
  for (let i = 1; i <= 2000; i++) {
    const q = B(i / 2000); s += Math.hypot(q[0] - ant[0], q[1] - ant[1]);
    if (s >= prox) {
      const dx = q[0] - ant[0], dy = q[1] - ant[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, t = n % 5 === 0 ? 9 : 4.5;
      tick += `M${(q[0] - nx * t).toFixed(1)},${(q[1] - ny * t).toFixed(1)}L${(q[0] + nx * t).toFixed(1)},${(q[1] + ny * t).toFixed(1)}`;
      if (n % 5 === 0 && n) { const km = inicioKm + n * 20 / 1000; rot += `<text x="${(q[0] + nx * 16).toFixed(1)}" y="${(q[1] + ny * 16 + 3).toFixed(1)}" text-anchor="middle">${Math.floor(km)}+${String(Math.round((km % 1) * 1000)).padStart(3, '0')}</text>` }
      n++; prox += passo;
    }
    ant = q;
  }
  const d = `M${p[0]}C${p[1]} ${p[2]} ${p[3]}`;
  return `<svg class="eixo" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" class="eixo-h"/><path d="${d}" class="eixo-l"/><path d="${tick}" class="eixo-t"/>${rot}</svg>`;
}

/* conteúdo de exemplo das folhas (o mesmo nas três opções, para comparar só o visual) */
export const ITENS_INICIO = [
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
export const ITENS_LEG = [
  ['Rodovia e KM', 'Com lado da pista e estaca.'],
  ['Contrato e serviço', 'Ou o nome da ponte ou viaduto.'],
  ['Coordenadas', 'No formato que você escolher.'],
  ['Data e SNV', 'Data, hora e versão da base.'],
];
export const NOTA_LEG = 'Modelo de exemplo. Você escolhe o que aparece, a posição, a cor e o fundo.';
export const ARQUIVO = 'BR-226-RN_KM326+040_LD_2026-09-15_11-27-05.jpg';
export const LEG_Y = [17, 39, 61, 83];
