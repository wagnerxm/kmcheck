import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'manual-kmcheck', 'screens');
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
await page.goto('file:///' + join(__dirname, 'index.html').replace(/\\/g, '/'), {
  waitUntil: 'networkidle0'
});
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 1000));

async function snap(name) {
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: join(outDir, `${name}.jpg`),
    type: 'jpeg',
    quality: 92
  });
  console.log(`✓ ${name}`);
}

// 1. Tela Inicial
await snap('01-tela-inicial');

// 2. Gestão de Eixo
await page.evaluate(() => {
  document.querySelector('[data-goto="scr-bases"]').click();
});
await snap('02-gestao-eixo');

// 3. Voltar → Configurações → Câmera
await page.evaluate(() => document.getElementById('header-back').click());
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('[data-goto="scr-settings"]').click());
await snap('03-config-camera');

// 4. Aba Logo
await page.evaluate(() => {
  const tabs = document.querySelectorAll('.settab');
  for (const t of tabs) { if (t.textContent.trim().includes('Logo')) { t.click(); break; } }
});
await snap('04-config-logo');

// 5. Aba Legenda
await page.evaluate(() => {
  const tabs = document.querySelectorAll('.settab');
  for (const t of tabs) { if (t.textContent.trim().includes('Legenda')) { t.click(); break; } }
});
await snap('05-config-legenda');

// 6. Scroll down to show Conteúdo section (checkboxes)
await page.evaluate(() => {
  const el = document.querySelector('#scr-settings');
  if (el) el.scrollTop = 999;
  window.scrollTo(0, 999);
  // Find the "Conteúdo" heading and scroll to it
  const secs = document.querySelectorAll('.sec');
  for (const s of secs) {
    if (s.textContent.includes('Conte')) { s.scrollIntoView({block:'start'}); break; }
  }
});
await snap('06-config-conteudo');

console.log('\nAll screens captured in:', outDir);
await browser.close();
