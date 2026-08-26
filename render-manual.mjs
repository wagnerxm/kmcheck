import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, 'manual-premium.html');
const outPath = join(__dirname, 'manual-kmcheck', 'Manual KM Check - Passo a Passo.pdf');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 2 });
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 2000));

await page.evaluate(() => { document.title = 'Manual KM Check - Passo a Passo'; });

// PDF with fixed page size matching .pg dimensions
const widthIn = 540 / 96;
const heightIn = 960 / 96;

await page.pdf({
  path: outPath,
  width: `${widthIn}in`,
  height: `${heightIn}in`,
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  displayHeaderFooter: false,
});

console.log(`PDF saved: ${outPath}`);
await browser.close();
