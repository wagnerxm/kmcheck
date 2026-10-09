/* Copia o app (o mesmo do site) para mobile/www, que é o que vai dentro do APK/AAB.
 * As rodovias (data/rodovias, ~137 MB) NÃO entram: o app baixa do servidor (kmcheck.com.br / API). */
import fs from 'node:fs';
import path from 'node:path';
const RAIZ = path.resolve('..'), WWW = path.resolve('www');
fs.rmSync(WWW, { recursive: true, force: true }); fs.mkdirSync(WWW, { recursive: true });
const ARQS = ['index.html', 'sw.js', 'fflate.js', 'manifest.v143.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-header.png'];
for (const a of ARQS) fs.copyFileSync(path.join(RAIZ, a), path.join(WWW, a));
fs.cpSync(path.join(RAIZ, 'manual'), path.join(WWW, 'manual'), { recursive: true });
const tam = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? tam(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log('www pronto:', (tam(WWW) / 1048576).toFixed(1), 'MB');
