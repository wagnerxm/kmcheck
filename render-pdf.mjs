import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function renderPdf(htmlFile, outFile, title) {
  const htmlPath = join(__dirname, htmlFile);
  const outPath = join(__dirname, 'manual-kmcheck', outFile);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 540, height: 100, deviceScaleFactor: 2 });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

  // Wait for fonts
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1500));

  // Inject PDF title via document.title
  await page.evaluate((t) => { document.title = t; }, title);

  // Get content height for single-page PDF
  const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
  const widthPx = 540;
  // Convert px to inches (96 dpi)
  const widthIn = widthPx / 96;
  const heightIn = (bodyHeight / 96) + 0.5; // small margin

  await page.pdf({
    path: outPath,
    width: `${widthIn}in`,
    height: `${heightIn}in`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    displayHeaderFooter: false,
  });

  console.log(`Saved: ${outPath} (${title})`);
  await browser.close();
}

// Android
await renderPdf(
  'install-guide.html',
  'Como adicionar o KM Check à Tela de Início do Android.pdf',
  'Como adicionar o KM Check à Tela de Início do Android'
);

// iOS
const browser2 = await (async () => {
  const htmlPath = join(__dirname, 'install-guide-ios.html');
  const outPath = join(__dirname, 'manual-kmcheck', 'Como adicionar o KM Check à Tela de Início do iPhone.pdf');
  const title = 'Como adicionar o KM Check à Tela de Início do iPhone';

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 540, height: 100, deviceScaleFactor: 2 });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate((t) => { document.title = t; }, title);

  const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
  const widthIn = 540 / 96;
  const heightIn = (bodyHeight / 96) + 0.5;

  await page.pdf({
    path: outPath,
    width: `${widthIn}in`,
    height: `${heightIn}in`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    displayHeaderFooter: false,
  });

  console.log(`Saved: ${outPath} (${title})`);
  await browser.close();
})();
