/* Conceito C — "Antes e depois": a dor de anotar KM na caderneta (cinza, torto, som sujo) e a virada no obturador do app
 * (flash limpa a tela, trilha fica limpa). Depois, 8 cortes de 1 batida (uma função por corte, uma palavra estampada),
 * Modo Carro, galeria e contadores grandes. Tudo no ritmo (104 BPM).
 * Uso: node conceito-c.mjs [stills] */
import path from 'node:path';
import { montar, fone, encerramento, caixasLegenda, IMG, T, AQUI } from './motor.mjs';
import { gerarAudio } from './audio.mjs';

const DUR = T(64);                                   // 16 compassos ≈ 37 s
const css = `
body{background:#cfcfcf}
.claroFundo{position:absolute;inset:0;background:url(${IMG.fundo}) center/cover,#eef0f1;opacity:0}
.claroFundo::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(238,240,241,.96),rgba(238,240,241,.82) 55%,rgba(238,240,241,.95))}
.antes{filter:grayscale(1) contrast(.9)}
.tit{position:absolute;left:60px;right:60px;top:170px;font:900 84px/1.04 Inter;letter-spacing:-.04em;color:#444;opacity:0}
.bloco{position:absolute;left:120px;top:520px;width:560px;height:620px;background:#f4f1e6;border-radius:8px;box-shadow:0 30px 50px -20px rgba(0,0,0,.5);transform:rotate(-4deg);padding:60px 40px;font:400 54px/1.55 Caveat,cursive;color:#333;white-space:pre-wrap}
.bloco i{color:#b33;font-style:normal}
.fsem{position:absolute;left:380px;top:1080px;width:600px;height:400px;object-fit:cover;border-radius:16px;transform:rotate(3deg);filter:grayscale(1) brightness(.85);box-shadow:0 30px 50px -20px rgba(0,0,0,.5)}
.carimbo{position:absolute;left:470px;top:1370px;padding:14px 28px;border:6px solid #b33;color:#b33;font:900 56px Inter;transform:rotate(-8deg);border-radius:12px;opacity:0;background:rgba(244,241,230,.6)}
.lado{position:absolute;top:0;bottom:0;overflow:hidden}
.ladoA{left:0;width:50%;background:#cfcfcf;filter:grayscale(1) contrast(.9)}
.ladoB{right:0;width:50%;background:url(${IMG.fundo}) center/cover}.ladoB::before{content:'';position:absolute;inset:0;background:rgba(238,240,241,.8)}
.div{position:absolute;top:0;bottom:0;width:10px;margin-left:-5px;background:linear-gradient(#b7d92d,#fff,#b7d92d);box-shadow:0 0 40px rgba(183,217,45,.9);z-index:5}
.tit2{position:absolute;left:40px;right:40px;top:150px;text-align:center;font:900 62px/1.05 Inter;letter-spacing:-.04em}
.ladoA .tit2{color:#555}.ladoB .tit2{color:#14161a}.ladoB .tit2 em{font-style:normal;color:#6f9a0e}
.planilha{position:absolute;left:50px;top:460px;width:460px;border-collapse:collapse;font:600 26px Inter;color:#333;background:#fff;box-shadow:0 30px 50px -20px rgba(0,0,0,.5);transform:rotate(-2deg)}
.planilha td{border:1px solid #bbb;padding:14px 12px;height:56px}.planilha td.c{background:#e8e8e8;color:#777;font-weight:800}.planilha td.e{color:#b33}
.ladoB .fone{left:40px;top:460px;width:460px;height:1012px;border-radius:70px;padding:12px}.ladoB .fone .tela,.ladoB .fone .extra{left:12px;top:12px;width:436px;height:988px;border-radius:58px}.ladoB .fone .ilha{width:100px;height:30px;margin-left:-50px;top:26px}
.ladoB .fone .bt{display:none}
.ok{position:absolute;left:60px;top:1520px;padding:16px 28px;border-radius:999px;background:#b7d92d;color:#111;font:900 38px Inter;opacity:0}
.fone.meio{left:260px;top:560px}
.palavra{position:absolute;left:0;right:0;top:1180px;text-align:center;font:900 200px/1 Inter;letter-spacing:-.05em;z-index:6}
.palavra span{display:inline-block;padding:0 34px;background:#b7d92d;color:#111;transform:rotate(-3deg);box-shadow:0 30px 60px -20px rgba(0,0,0,.4)}
.beat{position:absolute;left:80px;right:80px;bottom:120px;height:14px;border-radius:7px;background:rgba(20,22,26,.15);z-index:6}
.beat i{position:absolute;top:-10px;width:6px;height:34px;background:#14161a;border-radius:3px}.beat b{position:absolute;left:0;top:0;height:14px;border-radius:7px;background:#b7d92d}
h1{position:absolute;left:80px;right:80px;top:170px;font:900 84px/1.04 Inter;letter-spacing:-.04em;color:#14161a;opacity:0}h1 em{font-style:normal;color:#6f9a0e}
.cnt{position:absolute;left:80px;right:80px;padding:34px 0;border-bottom:2px solid rgba(20,22,26,.12);opacity:0}
.cnt b{display:block;font:900 200px/1 Inter;letter-spacing:-.06em;color:#14161a}.cnt b em{font-style:normal;color:#6f9a0e}
.cnt span{display:block;font:600 44px Inter;color:#3b4559;margin-top:6px}
.fecho{position:absolute;left:80px;top:1560px;font:900 64px/1.1 Inter;letter-spacing:-.04em;color:#14161a;opacity:0}.fecho em{font-style:normal;color:#6f9a0e}
.fundoGal{position:absolute;left:640px;top:1180px;opacity:.14;transform:rotate(-10deg)}
`;

const CORTES = [['inicio', 'RODOVIA'], ['eixo', 'KM'], ['cam', 'ESTACA'], ['gal', 'COORDENADAS'], ['carro', 'DATA'], ['consulta', 'CONTRATO'], ['galSel', 'LADO'], ['cam', 'FOTO']];
const corpo = `
<div class="claroFundo" id="claroFundo"></div>
<div class="cena antes" id="s1"><div class="tit" id="t1">Que KM<br>era mesmo?</div>
  <div class="bloco" id="bloco"></div><img class="fsem" src="${IMG.foto}"><div class="carimbo" id="carimbo">SEM KM</div></div>

<div class="cena" id="s2">
  <div class="lado ladoA" id="ladoA"><div class="tit2">Anotar depois…</div>
    <table class="planilha"><tr><td class="c">Foto</td><td class="c">KM</td><td class="c">Est.</td></tr><tr><td>IMG_0412</td><td>325,9</td><td>?</td></tr><tr><td>IMG_0413</td><td class="e" id="cel">326?</td><td></td></tr><tr><td>IMG_0414</td><td></td><td></td></tr><tr><td>IMG_0415</td><td></td><td></td></tr></table>
    <img class="fsem" src="${IMG.rod}" style="left:40px;top:1120px;width:460px;height:300px"></div>
  <div class="lado ladoB" id="ladoB"><div class="tit2">…ou fotografar <em>certo</em>.</div>
    ${fone('f2', IMG.cam)}<div class="ok" id="ok2">✓ KM 326,040 · Est. 16302+0</div></div>
  <div class="div" id="div2" style="left:50%"></div></div>

<div class="cena" id="s4">${CORTES.map(([k, w], i) => `<div class="sub" id="k${i}" style="position:absolute;inset:0;display:none">${fone('g' + i, IMG[k], null, ' style="left:260px;top:560px"')}<div class="palavra"><span>${w}</span></div></div>`).join('')}
  <div class="beat"><b id="beatB"></b>${[0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map(x => `<i style="left:${x}%"></i>`).join('')}</div></div>

<div class="cena" id="s5">${fone('f5', IMG.carro, IMG.galSel, ' style="left:260px;top:560px"')}<h1 id="h5">Tudo no lugar.<br><em>Sem internet</em>.</h1></div>

<div class="cena" id="s6">${fone('f6', IMG.gal, null, ' style="left:640px;top:1180px;opacity:.14;transform:rotate(-10deg)"')}
  <div class="cnt" id="n1" style="top:200px"><b>1<em> toque</em></b><span>para registrar a evidência</span></div>
  <div class="cnt" id="n2" style="top:620px"><b>0</b><span>anotações para fazer depois</span></div>
  <div class="cnt" id="n3" style="top:1040px"><b><i id="pct" style="font-style:normal">0</i><em>%</em></b><span>das fotos com KM, estaca e coordenadas</span></div>
  <div class="fecho" id="fecho">Chega de anotar o KM.<br><em>Fotografe!</em></div></div>

${encerramento('s8', 'claro')}`;

const script = `
const BLOCO = 'BR-226 · km 326?\\nou 327…\\nfoto 14 (qual?)\\nest. ______';
window.render = function (t) {
  let u;
  $('#claroFundo').style.opacity = t >= T(14) ? 1 : 0;
  // 1 — caderneta: texto à mão aparecendo, título tremendo, carimbo "SEM KM" na batida 3
  if ((u = corte($('#s1'), t, 0, T(6))) !== null) {
    const tt = $('#t1'); tt.style.opacity = cl(u * 4); tt.style.transform = 'translate(' + (3 * Math.sin(u * 37)) + 'px,' + (3 * Math.cos(u * 29)) + 'px) rotate(' + (0.6 * Math.sin(u * 23) - 1) + 'deg)';
    const n = Math.floor(fase(u, T(0.5), T(4)) * BLOCO.length); $('#bloco').innerHTML = BLOCO.slice(0, n).replace('?', '<i>?</i>').replace('(qual?)', '<i>(qual?)</i>');
    pula($('#carimbo'), fase(u, T(3), T(3) + 0.25)); $('#carimbo').style.transform += ' rotate(-8deg)';
    $('#s1').style.opacity = 1 - fase(u, T(5.7), T(6));
  }
  // 2 — split: planilha à esquerda (cinza) e o app escrevendo a legenda à direita; a divisória fecha na virada (14)
  if ((u = corte($('#s2'), t, T(6), T(16))) !== null) {
    const fecha = ezi(fase(u, T(8), T(9.5))); const x = 50 + 50 * 0 - fecha * 50;            // a linha vai para a esquerda: o lado do app toma a tela
    $('#div2').style.left = (50 - 50 * fecha) + '%'; $('#ladoA').style.width = (50 - 50 * fecha) + '%'; $('#ladoB').style.width = (50 + 50 * fecha) + '%';
    const cel = $('#cel'); const k = Math.floor(fase(u, T(1), T(3)) * 4); cel.textContent = '326?'.slice(0, k) + (k < 4 && u > T(1) ? '|' : '');
    const f = $('#f2'); f.style.transform = 'translateX(' + (fecha * (220 - 540 * (1 - fecha))) + 'px) scale(' + (1 + fecha * 0.18) + ')';   // vai para o centro enquanto o lado do app toma a tela
    flash(f, u, T(8)); pula($('#ok2'), fase(u, T(2.5), T(2.5) + 0.4));
    $('#s2').style.opacity = 1 - fase(u, T(9.7), T(10));
  }
  $('#flashTela').style.opacity = t >= T(14) && t < T(14.7) ? (1 - ez(fase(t, T(14.06), T(14.7)))) : 0;
  // 4 — 8 cortes secos, um por batida, uma palavra estampada; régua da batida embaixo
  if ((u = corte($('#s4'), t, T(16), T(24))) !== null) {
    const i = Math.min(7, Math.floor(u / T(1))); $$('#s4 .sub').forEach((s, k) => s.style.display = k === i ? 'block' : 'none');
    const sp = $('#k' + i + ' .palavra span'); const q = (u - T(i)) / T(1); sp.style.transform = 'rotate(-3deg) scale(' + (1.25 - 0.25 * ez(q * 4)) + ')';
    $('#g' + i).style.transform = 'scale(' + (1.03 - 0.03 * ez(q * 3)) + ')'; $('#beatB').style.width = (u / T(8) * 100) + '%';
  }
  // 5 — Modo Carro com o KM subindo (24–30) → galeria com seleção (30–36)
  if ((u = cena($('#s5'), t, T(24), T(36), 0.25, 0.3)) !== null) {
    const f = $('#f5'); foneEntra(f, u, 0, 0.6); contador(f, 82360 + Math.round(ezi(fase(u, T(0.5), T(5.5))) * 56) * 10);
    f.querySelector('.contador').style.opacity = 1 - fase(u, T(6), T(6.4)); cruza(f, u, T(6), T(6.4)); sobe($('#h5'), fase(u, T(0.5), T(0.5) + 0.5), 40);
  }
  // 6 — contadores, um por compasso, com o 100% subindo
  if ((u = cena($('#s6'), t, T(36), T(48), 0.25, 0.3)) !== null) {
    pula($('#n1'), fase(u, 0, 0.45)); pula($('#n2'), fase(u, T(4), T(4) + 0.45)); pula($('#n3'), fase(u, T(8), T(8) + 0.45));
    $('#pct').textContent = Math.round(100 * ez(fase(u, T(8), T(9.5)))); sobe($('#fecho'), fase(u, T(10), T(10) + 0.5), 30);
  }
  // 8 — encerramento
  if ((u = corte($('#s8'), t, T(48), ${DUR})) !== null) encerra('s8', u);
};`;

const cues = [{ t: 0.05, tipo: 'estatica' }, { t: T(3), tipo: 'hit', g: 0.9 }, { t: T(6), tipo: 'whoosh', g: 0.6 }, { t: T(14), tipo: 'riser' }, { t: T(14), tipo: 'obturador', g: 1.2 }, { t: T(14.05), tipo: 'hit' }, { t: T(14.2), tipo: 'whoosh' }];
for (let i = 0; i < 8; i++) cues.push({ t: T(16 + i), tipo: i % 2 ? 'whoosh' : 'hit', g: 0.65 });
cues.push({ t: T(24), tipo: 'hit' }, { t: T(30), tipo: 'whoosh' }, { t: T(36), tipo: 'hit' }, { t: T(40), tipo: 'hit' }, { t: T(44), tipo: 'hit' }, { t: T(45.5), tipo: 'ding' }, { t: T(48), tipo: 'hit', g: 1.1 }, { t: T(49), tipo: 'whoosh', g: 0.7 }, { t: T(51), tipo: 'whoosh', g: 0.6 });
for (let i = 0; i < 4; i++) cues.push({ t: T(6 + 1 + i * 0.5), tipo: 'tick', g: 1.2 });          // digitação da planilha
const secoes = [
  { de: 0, ate: T(14), pad: 0.7, baixo: 0.5, bat: 'suja', lofi: 1, nivel: 0.9 },
  { de: T(14), ate: T(48), pad: 1, baixo: 1, arp: 1, bat: 'cheia' },
  { de: T(48), ate: DUR, pad: 1, baixo: 1, arp: 0.8, bat: 'cheia' },
];
const audio = path.join(AQUI, 'conceito-c.wav');
if (process.argv[2] !== 'stills') gerarAudio({ saida: audio, dur: DUR, secoes, cues, pausas: [[T(48) - 0.5, T(48)]] });
await montar({ nome: 'conceito-c', dur: DUR, css, corpo, script, audio, stills: [T(3.5), T(7.5), T(14.8), T(18.5), T(27), T(33), T(45), T(54)] });
