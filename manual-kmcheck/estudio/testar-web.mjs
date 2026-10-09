/* Teste de interação do manual web (computador): sumário do painel fixo, odômetro do capítulo,
 * janela das dicas e largura da página. Uso: node manual-kmcheck/estudio/testar-web.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const corpo = fs.readFileSync('manual-kmcheck/manual-km-check.html', 'utf8');
const doc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + corpo + '</body></html>';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 }); await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
const erros = []; p.on('pageerror', e => erros.push(e.message));
await p.setContent(doc, { waitUntil: 'load' }); const w = ms => new Promise(r => setTimeout(r, ms));
await p.evaluate(() => scrollTo(0, innerHeight * 1.5)); await w(800);
console.log('painel visível', await p.evaluate(() => document.querySelector('.hud').classList.contains('on')));
for (const [id, km] of [['legenda', '06'], ['carro', '09'], ['problemas', '10']]) {
  await p.click('.hud-bar'); await w(300);
  await p.click(`.hud-menu a[href="#${id}"]`); await w(1800);
  console.log(id, 'topo', await p.evaluate(i => Math.round(document.querySelector('#' + i).getBoundingClientRect().top), id), 'painel', await p.evaluate(() => document.querySelector('.hud-txt .cl').textContent), '(esperado KM ' + km + ')');
}
await p.click('.faq-c'); await w(700); console.log('janela aberta', await p.evaluate(() => !!document.querySelector('.janela.on')));
await p.keyboard.press('Escape'); await w(600); console.log('janela fechada', await p.evaluate(() => !document.querySelector('.janela')));
console.log('largura', await p.evaluate(() => document.documentElement.scrollWidth), 'erros', erros.length ? erros : 'nenhum');
await b.close();
