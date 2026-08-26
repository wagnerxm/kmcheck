import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, 'manual-premium.html');
const outDir = join(__dirname, 'manual-kmcheck', 'screens');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
// Use tall viewport to fit all pages stacked
await page.setViewport({ width: 540, height: 960 * 9, deviceScaleFactor: 2 });
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 2000));

const pageCount = await page.evaluate(() => document.querySelectorAll('.pg').length);
console.log(`${pageCount} pages`);

for (let i = 0; i < pageCount; i++) {
  const rect = await page.evaluate((idx) => {
    const pg = document.querySelectorAll('.pg')[idx];
    const r = pg.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, i);

  await page.screenshot({
    path: join(outDir, `pg${i + 1}.jpg`),
    type: 'jpeg',
    quality: 90,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  });
  console.log(`✓ pg${i + 1} (y=${rect.y})`);
}

await browser.close();
