/* Capa do PDF (A4 deitado): a arte aprovada da capa, sem alterações, com o título na área clara da
 * esquerda. Gera manual-kmcheck/opcoes/capa-a4.png e capa-a4.pdf. Uso: node manual-kmcheck/estudio/capa-a4.mjs */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { VERSAO, DATA } from './conteudo.mjs';
const RAIZ = path.resolve('manual-kmcheck'), SAIDA = path.join(RAIZ, 'opcoes');
const CAPA = 'data:image/webp;base64,' + fs.readFileSync(path.join(RAIZ, 'estudio/capa-manual.webp')).toString('base64');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap">
<style>@page{size:297mm 210mm;margin:0}*{box-sizing:border-box}html,body{margin:0}
.folha{position:relative;width:1123px;height:794px;overflow:hidden;font-family:Inter,sans-serif;color:#1c2333;-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* a arte é 16:9 e a folha é A4: o corte sai só da esquerda (área vazia), a logo e os celulares ficam inteiros */
.folha img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:100% 0%}
.txt{position:absolute;left:64px;top:200px;width:520px}
.olho{font:700 11px Inter;letter-spacing:.3em;text-transform:uppercase;color:#6f8a0e}
h1{font:900 92px/.9 Inter;letter-spacing:-.055em;margin:18px 0 0}
p{font-size:16.5px;line-height:1.55;color:#3b4559;margin:22px 0 0;max-width:400px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:26px}
.chips span{font:600 10.5px Inter;letter-spacing:.14em;text-transform:uppercase;background:rgba(255,255,255,.7);border:1px solid rgba(28,35,51,.12);padding:8px 12px;border-radius:999px}
.pe{position:absolute;left:64px;bottom:34px;font-size:12px;color:#3b4559}</style></head><body>
<section class="folha"><img src="${CAPA}" alt=""><div class="txt"><div class="olho">KM Check</div><h1>Manual do<br>usuário</h1>
<p>Registro fotográfico de rodovias com KM, estaca e coordenadas gravados na própria foto. Direto do campo, sem depender de internet.</p>
<div class="chips"><span>Versão ${VERSAO}</span></div></div>
<div class="pe">Desenvolvido por <b>Wagner Machado</b></div></section></body></html>`;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); await p.setViewport({ width: 1123, height: 794, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: 'load' }); await p.evaluateHandle('document.fonts.ready'); await new Promise(r => setTimeout(r, 800));
await (await p.$('.folha')).screenshot({ path: path.join(SAIDA, 'capa-a4.png') });
await p.pdf({ path: path.join(SAIDA, 'capa-a4.pdf'), width: '297mm', height: '210mm', printBackground: true, preferCSSPageSize: true });
await b.close(); console.log('ok');
