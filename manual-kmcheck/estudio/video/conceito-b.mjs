/* Conceito B — "Filme de produto" (keynote): um iPhone só, no centro, e a câmera que se move ao redor dele. Cada recurso é
 * um "beat" de 2 compassos: uma frase gigante, um movimento de câmera (mergulho na tela / recuo com giro), um hit na batida.
 * Fundo branco-gelo, tipografia enorme, nada de listas. Meio segundo de silêncio antes do encerramento.
 * Uso: node conceito-b.mjs [stills] */
import path from 'node:path';
import { montar, fone, encerramento, IMG, T, AQUI } from './motor.mjs';
import { gerarAudio } from './audio.mjs';

const DUR = T(68);                                   // 17 compassos ≈ 39 s
const css = `
body{background:radial-gradient(70% 50% at 50% 30%,#ffffff,#eef0f2 70%,#e6e8eb)}
.palco{position:absolute;inset:0;perspective:2200px;z-index:2}
.fone{left:260px;top:560px;transform-origin:50% 50%}
.fone .tela{transition:none}
.chao{position:absolute;left:150px;right:150px;top:1810px;height:120px;background:radial-gradient(50% 50% at 50% 50%,rgba(0,0,0,.28),transparent 70%);z-index:1}
.frase{position:absolute;left:40px;right:40px;top:200px;text-align:center;font:900 128px/1 Inter;letter-spacing:-.05em;color:#111;z-index:5;opacity:0;text-wrap:balance}
.frase small{display:block;font:500 34px Inter;letter-spacing:.3em;text-transform:uppercase;color:#6f9a0e;margin-top:26px}
.logoB{position:absolute;left:50%;top:150px;width:520px;margin-left:-260px;z-index:5;opacity:0;filter:drop-shadow(0 10px 24px rgba(0,0,0,.18))}
.brilhoKm{position:absolute;left:3.5%;top:15.5%;width:93%;height:40.5%;border-radius:40px;box-shadow:0 0 0 4px rgba(183,217,45,.0),0 0 60px rgba(183,217,45,0);opacity:0}
.linha{position:absolute;left:0.5%;width:71%;height:2.1%;background:rgba(183,217,45,.45);transform-origin:0 50%;transform:scaleX(0)}
.tampa{position:absolute;width:31%;height:10.8%;background:#0a0a0a;border-radius:14px}
.varre{position:absolute;left:-60%;top:-10%;width:50%;height:120%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55) 50%,transparent);opacity:0}
`;

const telas = ['inicio', 'cam', 'imp', 'carro', 'gal'];
const corpo = `
<div class="chao"></div>
<div class="palco"><div class="fone" id="fone"><b class="bt mudo"></b><b class="bt vol1"></b><b class="bt vol2"></b><b class="bt lado"></b>
  ${telas.map((k, i) => `<img class="tela" id="t${i}" src="${IMG[k]}" style="opacity:${i ? 0 : 1}">`).join('')}
  <div class="extra" id="extra"><div class="brilhoKm" id="brilhoKm"></div>
    ${[66.6, 68.8, 70.9, 73.0].map((y, i) => `<div class="linha" id="ln${i}" style="top:${y}%"></div>`).join('')}
    ${[30, 46, 61.8].flatMap(y => [3.2, 35, 66.8].map(x => `<div class="tampa" style="left:${x}%;top:${y}%"></div>`)).join('')}
    <div class="varre" id="varre"></div></div><i class="ilha"></i></div></div>
<img class="logoB" id="logoB" src="${IMG.logo}">
${[['f1', 'O KM certo.', ''], ['f2', 'Em cada foto.', ''], ['f3', 'Gravado na imagem.', ''], ['f4', 'Sem internet.', 'baixe a rodovia uma vez'], ['f5', 'No carro.', 'modo carro, pelo gps'], ['f6', 'Tudo organizado.', 'por rodovia, km e contrato']]
  .map(([id, tx, sm]) => `<div class="frase" id="${id}">${tx}${sm ? `<small>${sm}</small>` : ''}</div>`).join('')}
${encerramento('s8', 'claro')}`;

const script = `
const F = $('#fone'); const TELAS = ${telas.length};
function tela(i, op) { $('#t' + i).style.opacity = op; }
function soTela(i) { for (let k = 0; k < TELAS; k++) tela(k, k === i ? 1 : 0); }
function frase(id, u, a, b) {           // frase entra de baixo na batida a, sai para cima pouco antes de b
  const el = $('#' + id); const p = ez(fase(u, a, a + 0.45)), q = fase(u, b - 0.3, b);
  el.style.opacity = p * (1 - q); el.style.transform = 'translateY(' + ((1 - p) * 70 - q * 60) + 'px)';
}
// câmera: posição do celular ao longo do tempo (translate, giro, escala) — cada beat é um movimento
function camera(t) {
  let tx = 0, ty = 0, ry = 14, rx = 2, s = 1, op = 1, ox = '50%', oy = '50%';
  if (t < T(8)) { const p = ez(fase(t, T(0.5), T(3))); ty = (1 - p) * 900; op = p; ry = 14; }
  else if (t < T(16)) { const p = ezi(fase(t, T(9), T(13))); s = 1 + 1.0 * p; ry = 14 * (1 - p); oy = '36%'; ty = 300 * p; }                 // mergulho no KM
  else if (t < T(24)) { const p = ezi(fase(t, T(16), T(18))); s = 2.0 - 1.0 * p; ry = -14 * p; oy = '36%'; ty = 300 * (1 - p); }             // recua e gira
  else if (t < T(32)) { const p = ezi(fase(t, T(24), T(26))); s = 1 + 1.4 * p; ry = -14 * (1 - p); oy = '71%'; ty = 60 * p; }              // mergulho na legenda
  else if (t < T(40)) { const p = ezi(fase(t, T(32), T(34))); s = 2.4 - 1.4 * p; ry = -16 * p; rx = 4 * p; oy = '71%'; ty = 60 * (1 - p); }
  else if (t < T(48)) { const p = ezi(fase(t, T(40), T(42))); ry = -16 * (1 - p); rx = 4 + 16 * p; s = 1 - 0.06 * p; ty = 60 * p; }         // deita como no painel
  else if (t < T(56)) { const p = ezi(fase(t, T(48), T(50))); rx = 20 * (1 - p); ry = 10 * p; s = 0.94 + 0.06 * p; ty = 60 * (1 - p); }
  else { const p = ezi(fase(t, T(56), T(58))); ry = 10; s = 1 - 0.5 * p; ty = 700 * p; op = 1 - p; }
  F.style.transformOrigin = ox + ' ' + oy;
  F.style.transform = 'translate(' + tx + 'px,' + ty + 'px) rotateY(' + ry + 'deg) rotateX(' + rx + 'deg) scale(' + s + ')';
  F.style.opacity = op;
}
window.render = function (t) {
  camera(t); const ex = $('#extra');
  // telas: troca escondida no meio do movimento de recuo (quando o celular está girando)
  if (t < T(17)) soTela(0); else if (t < T(33)) soTela(1); else if (t < T(41)) soTela(2); else if (t < T(49)) soTela(3); else soTela(4);
  // beat 1 — logo e passagem de luz pela moldura
  { const l = $('#logoB'); pula(l, fase(t, T(1), T(1) + 0.5)); l.style.opacity = cl(fase(t, T(1), T(1.3))) * (1 - fase(t, T(7.5), T(8)));
    const v = $('#varre'); const p = fase(t, T(3), T(5)); v.style.opacity = p > 0 && p < 1 ? 1 : 0; v.style.transform = 'translateX(' + (p * 1300) + 'px) skewX(-10deg)'; }
  // beat 2 — "O KM certo." + brilho pulsando no cartão do KM
  frase('f1', t, T(8), T(16)); { const b = $('#brilhoKm'); const on = t >= T(10) && t < T(16); const c = ((t - T(10)) % T(1)) / T(1);
    b.style.opacity = on ? 1 : 0; b.style.boxShadow = '0 0 0 ' + (3 + 6 * (1 - c)) + 'px rgba(183,217,45,' + (0.9 * (1 - c)) + '),0 0 ' + (60 * (1 - c)) + 'px rgba(183,217,45,' + (0.8 * (1 - c)) + ')'; }
  // beat 3 — "Em cada foto." + obturador na batida 21
  frase('f2', t, T(16.5), T(24)); flash(F, t - T(16.5), T(4.5)); $('#flashTela').style.opacity = t >= T(21) && t < T(21.6) ? 0.9 * (1 - ez(fase(t, T(21.05), T(21.6)))) : 0;
  // beat 4 — "Gravado na imagem." + as 4 linhas da legenda acendem em batidas
  frase('f3', t, T(24.5), T(32)); [0, 1, 2, 3].forEach(i => { $('#ln' + i).style.transform = 'scaleX(' + ez(fase(t, T(26.5 + i), T(26.5 + i) + 0.35)) + ')'; $('#ln' + i).style.opacity = t < T(32.5) ? 1 : 0; });
  // beat 5 — "Sem internet." + ripple no botão
  frase('f4', t, T(32.5), T(40)); if (t >= T(33) && t < T(40.5)) pulso(F, t - T(33), T(1), 10.5, 37.2, 79, 6.2); else { const p = ex.querySelector('.pulso'); if (p) p.style.opacity = 0; }
  // beat 6 — "No carro." + KM subindo
  frase('f5', t, T(40.5), T(48)); if (t >= T(41) && t < T(49)) { contador(F, 82360 + Math.round(ezi(fase(t, T(42), T(47.5))) * 56) * 10); ex.querySelector('.contador').style.opacity = 1; } else { const c = ex.querySelector('.contador'); if (c) c.style.opacity = 0; }
  // beat 7 — "Tudo organizado." + 9 fotos em cascata (colcheias)
  frase('f6', t, T(48.5), T(56)); $$('.tampa').forEach((tp, i) => { tp.style.opacity = t < T(49) ? 0 : t < T(56) ? 1 - ez(fase(t, T(49.5 + i * 0.5), T(49.5 + i * 0.5) + 0.25)) : 0; });
  // beat 8 — encerramento
  let u; if ((u = corte($('#s8'), t, T(56), ${DUR})) !== null) encerra('s8', u);
};`;

const cues = [{ t: 0, tipo: 'hit' }, { t: T(0.5), tipo: 'whoosh' }, { t: T(3.2), tipo: 'whoosh', g: 0.5 }];
for (const b of [8, 16, 24, 32, 40, 48]) { cues.push({ t: T(b), tipo: 'hit' }); cues.push({ t: T(b + 0.5), tipo: 'whoosh', g: 0.7 }); }
cues.push({ t: T(21), tipo: 'obturador' }); for (let i = 0; i < 4; i++) cues.push({ t: T(26.5 + i), tipo: 'tick', g: 1.4 });
cues.push({ t: T(34), tipo: 'ding' }); for (let i = 0; i < 9; i++) cues.push({ t: T(49.5 + i * 0.5), tipo: 'tick', g: 1.2 });
cues.push({ t: T(56), tipo: 'hit', g: 1.1 }, { t: T(57), tipo: 'whoosh', g: 0.7 }, { t: T(59), tipo: 'whoosh', g: 0.6 });
const secoes = [
  { de: 0, ate: T(8), piano: 0.8, baixo: 0.5 },
  { de: T(8), ate: T(56), piano: 1, baixo: 0.8, pad: 0.35, bat: 'leve' },
  { de: T(56), ate: DUR, piano: 1, baixo: 0.8, pad: 0.5, arp: 0.4, bat: 'leve' },
];
const audio = path.join(AQUI, 'conceito-b.wav');
if (process.argv[2] !== 'stills') gerarAudio({ saida: audio, dur: DUR, secoes, cues, pausas: [[T(56) - 0.5, T(56)]] });
await montar({ nome: 'conceito-b', dur: DUR, css, corpo, script, audio, stills: [T(4), T(13), T(20), T(30), T(36), T(45), T(53), T(62)] });
