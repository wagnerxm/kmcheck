/* Gera malha.js: o desenho simplificado das rodovias federais para o mapa do painel (um ponto a cada ~5 km).
 * Uso (na pasta admin): node gerar-malha.mjs   — lê ../data/rodovias e grava malha.js */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || path.join(aqui, '../data/rodovias'), out = process.argv[3] || path.join(aqui, 'malha.js');
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const W = 1000, lon0 = -74.2, lon1 = -34.6, lat0 = 5.4, lat1 = -33.9, kx = Math.cos(14 * Math.PI / 180);
const sx = W / ((lon1 - lon0) * kx), H = Math.round((lat0 - lat1) * sx);
const P = (lo, la) => [((lo - lon0) * kx * sx).toFixed(1), ((lat0 - la) * sx).toFixed(1)];
const vias = [];
for (const r of idx.roads) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, r.file), 'utf8'));
  let s = '';
  for (const g of d.segments) {
    let ult = null, n = 0;
    for (let i = 0; i < g.c.length; i++) {
      const [lo, la] = g.c[i], fim = i === g.c.length - 1;
      if (ult && !fim && Math.hypot(lo - ult[0], la - ult[1]) < 0.045) continue;
      const [x, y] = P(lo, la); s += (n ? 'L' : 'M') + x + ' ' + y; ult = [lo, la]; n++;
    }
  }
  vias.push({ id: 'BR-' + d.br + '/' + d.uf, d: s });
}
fs.writeFileSync(out, 'window.MALHA=' + JSON.stringify({ W, H, lon0, lat0, kx, sx, vias }) + ';');
console.log(vias.length, 'vias', (fs.statSync(out).size / 1024).toFixed(0) + ' KB', 'H=' + H);

/* ── snv-leve.json: a geometria das rodovias com KM, enxuta (um ponto a cada ~300 m; o KM continua certo porque é interpolado entre pontos que guardam o KM exato), para o painel
   descobrir a rodovia e o KM de cada aparelho. Antes o painel baixava os 363 arquivos completos
   (~137 MB), o que travava o Safari do iPhone. Mesma montagem do app: segmentos em ordem de KM e o KM
   interpolado pela distância dentro de cada segmento. */
{
  const D2R = Math.PI / 180, leve = [];
  for (const r of idx.roads) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, r.file), 'utf8'));
    const la = [], lo = [], km = [];
    for (const seg of (d.segments || []).sort((a, b) => a.ki - b.ki)) {
      const cc = seg.c; if (!cc || cc.length < 2) continue;
      let total = 0; const cum = [0];
      for (let j = 1; j < cc.length; j++) {
        const cos = Math.cos((cc[j - 1][1] + cc[j][1]) / 2 * D2R);
        total += Math.hypot((cc[j][0] - cc[j - 1][0]) * cos, cc[j][1] - cc[j - 1][1]); cum.push(total);
      }
      let ult = null;
      for (let j = 0; j < cc.length; j++) {
        const fim = j === 0 || j === cc.length - 1;
        if (!fim && ult && Math.hypot(cc[j][0] - ult[0], cc[j][1] - ult[1]) < 0.003) continue;
        la.push(+cc[j][1].toFixed(5)); lo.push(+cc[j][0].toFixed(5)); km.push(+(seg.ki + (total > 0 ? cum[j] / total : 0) * (seg.kf - seg.ki)).toFixed(3)); ult = cc[j];
      }
    }
    if (la.length) leve.push({ br: 'BR-' + d.br, uf: d.uf, la, lo, km });
  }
  const f = path.join(path.dirname(out), 'snv-leve.json');
  fs.writeFileSync(f, JSON.stringify({ snv: idx.snv, rodovias: leve }));
  console.log('snv-leve.json', leve.length, 'rodovias', leve.reduce((a, r) => a + r.la.length, 0), 'pontos', (fs.statSync(f).size / 1048576).toFixed(1) + ' MB');
}
