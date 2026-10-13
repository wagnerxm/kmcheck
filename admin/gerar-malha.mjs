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
