import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, 'install-guide-ios.html');
const outPath = join(__dirname, 'manual-kmcheck', 'guia-instalacao-ios.jpg');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 540, height: 100, deviceScaleFactor: 2 });
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

// Wait for fonts
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 1500));

// Full page screenshot as JPEG
await page.screenshot({
  path: outPath,
  type: 'jpeg',
  quality: 92,
  fullPage: true
});

console.log('Saved to:', outPath);
await browser.close();
