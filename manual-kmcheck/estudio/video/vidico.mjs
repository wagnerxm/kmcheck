/* Vídeo de divulgação no estilo "motion graphics de app" (referência: explainer da Vidico): um iPhone só, inclinado em 3D,
 * que nunca sai de cena; as telas trocam DENTRO dele deslizando; uma frase gigante por cena com a palavra-chave em verde;
 * elementos da interface "saltam" para fora do celular e flutuam; blocos de cor (lima, grafite) varrem a tela em círculo
 * para trocar o clima; ritmo calmo. Fundo: manual-kmcheck/estudio/fundo-video.webp (a rodovia com os arcos verdes).
 * Uso: node vidico.mjs [stills]  → km-check-vidico.mp4 */
import fs from 'node:fs';
import path from 'node:path';
import { montar, encerramento, IMG, T, AQUI, RAIZ } from './motor.mjs';
import { gerarAudio } from './audio.mjs';

const FUNDO = 'data:image/webp;base64,' + fs.readFileSync(path.join(RAIZ, 'manual-kmcheck/estudio/fundo-video.webp')).toString('base64');
const DUR = T(66);                                   // ≈ 38 s
// cenas em batidas: [início, fim]
const C = { s1: [0, 8], s2: [8, 16], s3: [16, 24], s4: [24, 31], s5: [31, 40], s6: [40, 48], s7: [48, 66] };
const TELAS = ['inicio', 'cam', 'imp', 'imp', 'carro', 'gal'];          // tela do iPhone em cada cena (1..6)

const css = `
body{background:#eef0f1}
#fundo{position:absolute;left:-3%;top:-3%;width:106%;height:106%;background:url(${FUNDO}) center/cover;transform-origin:50% 40%}
.veu{position:absolute;left:540px;top:1150px;width:3200px;height:3200px;margin:-1600px 0 0 -1600px;border-radius:50%;transform:scale(0);z-index:1}
#veuLima{background:#b7d92d}#veuGraf{background:linear-gradient(160deg,#2a2d33,#111214)}#veuClaro{background:url(${FUNDO}) center/cover;background-size:1150px 2040px;background-position:center}
.palco{position:absolute;inset:0;perspective:2200px;z-index:3}
.fone{position:absolute;left:260px;top:620px;width:560px;height:1232px;border-radius:84px;background:#0b0c0e;padding:14px;transform-style:preserve-3d;transform-origin:50% 50%;
  box-shadow:0 80px 120px -40px rgba(10,12,14,.55),0 0 0 2px #2a2c30,inset 0 0 0 2px rgba(255,255,255,.08)}
.fone .bt{position:absolute;width:6px;background:#2a2c30;border-radius:3px}
.fone .mudo{left:-6px;top:230px;height:48px}.fone .vol1{left:-6px;top:320px;height:92px}.fone .vol2{left:-6px;top:432px;height:92px}.fone .lado{right:-6px;top:360px;height:140px}
.fone .ilha{position:absolute;top:34px;left:50%;width:128px;height:38px;margin-left:-64px;border-radius:22px;background:#000;z-index:5}
.janela{position:absolute;left:14px;top:14px;width:532px;height:1204px;border-radius:70px;overflow:hidden;background:#000}
.janela img{position:absolute;left:0;top:0;width:532px;height:1204px;object-fit:cover;object-position:top}
.brilho{position:absolute;inset:0;border-radius:70px;background:linear-gradient(110deg,rgba(255,255,255,.12),rgba(255,255,255,0) 40%);pointer-events:none}
.frase{position:absolute;left:70px;right:70px;top:150px;font:900 88px/1.04 Inter;letter-spacing:-.045em;color:#14161a;z-index:6;text-wrap:balance}
.frase em{font-style:normal;color:#6f9a0e}.frase.clara{color:#fff}.frase.clara em{color:#c4e24a}.frase.lima em{color:#14161a}
.frase{opacity:0}
.frase .pal{display:inline-block;opacity:0}
.sub{position:absolute;left:70px;right:70px;top:400px;font:500 36px/1.35 Inter;color:#3b4559;z-index:6;opacity:0}.sub.clara{color:#d6dae0}
.flu{position:absolute;z-index:7;opacity:0;will-change:transform}
#leg2{left:40px;top:1480px;max-width:1000px}
.chip{display:inline-flex;align-items:center;gap:12px;padding:16px 26px;border-radius:999px;background:#fff;color:#14161a;font:800 30px Inter;box-shadow:0 20px 40px -18px rgba(20,22,26,.45),0 0 0 1px rgba(20,22,26,.08)}
.chip.escuro{background:#15171b;color:#fff;border:1px solid rgba(183,217,45,.4)}.chip.lima{background:#b7d92d;color:#111}
.chip i{width:12px;height:12px;border-radius:50%;background:#b7d92d;box-shadow:0 0 10px rgba(183,217,45,.9)}
.legenda{padding:22px 28px;border-radius:18px;background:rgba(0,0,0,.72);color:#fff;font:700 30px/1.4 Arial;border-left:8px solid #b7d92d;white-space:pre;box-shadow:0 30px 60px -20px rgba(0,0,0,.6)}
.legenda b{color:#c4e24a}
.placa{filter:drop-shadow(0 30px 40px rgba(0,0,0,.5))}
.kmg{font:900 120px/1 Inter;letter-spacing:-.05em;color:#fff;text-shadow:0 20px 50px rgba(0,0,0,.5)}
.kmg small{display:block;font:800 26px Inter;letter-spacing:.3em;color:#c4e24a;margin-bottom:8px}
.card{width:380px;height:270px;border-radius:24px;overflow:hidden;box-shadow:0 40px 70px -30px rgba(0,0,0,.6);border:4px solid #fff;position:relative}
.card img{width:100%;height:100%;object-fit:cover}.card b{position:absolute;left:14px;bottom:12px;padding:6px 14px;border-radius:999px;background:#b7d92d;color:#111;font:800 22px Inter}
.sinal{display:flex;align-items:center;gap:16px;padding:18px 28px;border-radius:999px;background:#fff;color:#14161a;font:800 30px Inter;box-shadow:0 20px 40px -18px rgba(20,22,26,.5)}
.sinal svg{width:44px;height:44px}
.fim .logo{margin-top:280px}
`;

const placaSvg = `<svg class="placa" width="300" height="356" viewBox="0 0 150 178"><rect x="2" y="2" width="146" height="174" rx="14" fill="#fff"/><rect x="10" y="10" width="130" height="158" rx="9" fill="#13305c"/><text x="75" y="52" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="31" fill="#fff">BR-226</text><line x1="24" y1="68" x2="126" y2="68" stroke="#fff" stroke-width="3"/><text x="75" y="110" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="34" fill="#fff">KM</text><text x="75" y="156" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="42" fill="#fff">082</text></svg>`;
const wifiOff = `<svg viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a14 14 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1.2" fill="#c0392b"/><path d="M3 3l18 18" stroke-width="2.6"/></svg>`;
const frase = (id, cls, html) => `<div class="frase ${cls}" id="${id}">${html.split(' ').map(w => `<span class="pal">${w}</span>`).join(' ')}</div>`;

const corpo = `
<div id="fundo"></div><div class="veu" id="veuLima"></div><div class="veu" id="veuGraf"></div><div class="veu" id="veuClaro"></div>
<div class="palco"><div class="fone" id="fone"><b class="bt mudo"></b><b class="bt vol1"></b><b class="bt vol2"></b><b class="bt lado"></b>
  <div class="janela">${TELAS.map((k, i) => `<img id="t${i}" src="${IMG[k]}">`).join('')}<div class="brilho"></div></div><i class="ilha"></i></div></div>
<img class="flu" id="logo1" src="${IMG.logo}" style="left:290px;top:190px;width:500px;filter:drop-shadow(0 10px 24px rgba(0,0,0,.2))">
<div class="sub" id="sub1" style="top:470px;text-align:center">Registro fotográfico de rodovias, com o KM pelo GPS.</div>
${frase('f2', '', 'O KM certo, em cada <em>foto</em>.')}
<div class="flu" id="leg2" style="left:60px;top:1500px"><div class="legenda">BR-226/RN - KM <b>326,040</b>  LD · Est. <b>16302+0</b>
14 00515/2024 - Aplicação de CBUQ
-6,077504, -37,537466 · 22/10/2026</div></div>
${frase('f3', 'lima', 'Cadastre a rodovia <em>uma vez</em>.')}
${[['BR-226', 60, 560], ['BR-101', 760, 520], ['BR-304', 40, 1700], ['RN', 850, 1760], ['BR-110', 700, 1480], ['SNV Out/26', 80, 760], ['CE · PB', 820, 700]]
  .map(([t, x, y], i) => `<div class="flu" id="ch${i}" style="left:${x}px;top:${y}px"><div class="chip"><i></i>${t}</div></div>`).join('')}
${frase('f4', 'clara', 'Funciona <em>sem internet</em>.')}
<div class="flu" id="sinal" style="left:560px;top:560px"><div class="sinal">${wifiOff} Sem sinal</div></div>
<div class="flu" id="ok4" style="left:120px;top:1700px"><div class="chip lima">✓&nbsp; O KM continua certo</div></div>
${frase('f5', 'clara', 'O KM acompanha o <em>carro</em>.')}
<div class="flu" id="placa5" style="left:60px;top:1420px">${placaSvg}</div>
<div class="flu" id="km5" style="left:560px;top:1560px"><div class="kmg"><small>QUILÔMETRO</small><span id="kmv">82,360</span></div></div>
${frase('f6', '', 'Fotografou, tá <em>documentado</em>.')}
${[[IMG.rod, 'KM 325,870', 640, 560, 6], [IMG.buraco, 'KM 326,410', 40, 1380, -5], [IMG.foto, 'KM 326,040', 660, 1560, 4]]
  .map(([src, km, x, y, r], i) => `<div class="flu" id="cd${i}" style="left:${x}px;top:${y}px"><div class="card" style="transform:rotate(${r}deg)"><img src="${src}"><b>${km}</b></div></div>`).join('')}
${encerramento('s7', 'claro').replace('class="cena claro"', 'class="cena claro" style="z-index:9"')}`;

const script = `
const F = $('#fone'); const N = ${TELAS.length}; const CN = ${JSON.stringify(C)};
const flu = (id, u, a, bob = 1, dist = 80) => { const e = $('#' + id); const p = ezb(fase(u, a, a + 0.55)); const vis = u >= a; e.style.opacity = vis ? cl((u - a) * 4) : 0;
  e.style.transform = 'translateY(' + ((1 - p) * dist + Math.sin(u * 2.1 + dist) * 6 * bob) + 'px) scale(' + (0.7 + 0.3 * p) + ')'; };
const texto = (id, u, a, b) => { $('#' + id).style.opacity = (u >= 0 && u < b) ? 1 : 0; $$('#' + id + ' .pal').forEach((w, i) => { const p = ez(fase(u, a + i * 0.09, a + 0.45 + i * 0.09)), q = fase(u, b - 0.35, b);
  w.style.opacity = p * (1 - q); w.style.transform = 'translateY(' + ((1 - p) * 50 - q * 40) + 'px)'; }); };
const circulo = (id, u, a, dur = 0.75) => { $('#' + id).style.transform = 'scale(' + ez(fase(u, a, a + dur)) + ')'; };
window.render = function (t) {
  $('#fundo').style.transform = 'scale(' + (1 + 0.04 * (t / ${DUR})) + ')';
  // véus de cor: lima entra na cena 3, grafite na 4, o fundo claro volta na 6
  circulo('veuLima', t, T(CN.s3[0]) - 0.2); circulo('veuGraf', t, T(CN.s4[0]) - 0.2); circulo('veuClaro', t, T(CN.s6[0]) - 0.2);
  // o iPhone: entra uma vez, depois só balança e gira levemente a cada cena; sai no encerramento
  const sobeP = ez(fase(t, 0, 1.0)); const cena = Object.values(CN).findIndex(([a, b]) => t >= T(a) && t < T(b));
  // o iPhone fica centralizado e reto; só gira (ida e volta) durante a troca de tela, e inclina na entrada
  const ini = cena > 0 ? T(Object.values(CN)[cena][0]) : 0; const m = fase(t, ini, ini + 0.9);
  const giro = cena > 0 ? Math.sin(m * Math.PI) * (cena % 2 ? -14 : 14) : (1 - sobeP) * 18;
  const sai = ezi(fase(t, T(CN.s7[0]), T(CN.s7[0]) + 0.8));
  F.style.opacity = sobeP * (1 - sai);
  F.style.transform = 'translateY(' + ((1 - sobeP) * 500 + sai * 600) + 'px) rotateY(' + giro + 'deg) scale(' + (1 - 0.3 * sai) + ')';
  // telas deslizam dentro do celular na troca de cena
  for (let i = 0; i < N; i++) { const [a] = Object.values(CN)[i]; const p = i === 0 ? 1 : ezi(fase(t, T(a), T(a) + 0.55)); const prox = i + 1 < N ? ezi(fase(t, T(Object.values(CN)[i + 1][0]), T(Object.values(CN)[i + 1][0]) + 0.55)) : 0;
    const x = (1 - p) * 560 - prox * 560; const e = $('#t' + i); e.style.transform = 'translateX(' + x + 'px)'; e.style.visibility = Math.abs(x) >= 560 ? 'hidden' : 'visible'; }
  let u;
  // 1 — logo + tela inicial
  { u = t - T(CN.s1[0]); const l = $('#logo1'); const p = ezb(fase(u, 0.5, 1.1)); l.style.opacity = cl((u - 0.5) * 3) * (1 - fase(u, T(7.4), T(8))); l.style.transform = 'translateY(' + ((1 - p) * 60) + 'px) scale(' + (0.8 + 0.2 * p) + ')';
    const s = $('#sub1'); s.style.opacity = ez(fase(u, 1.4, 1.9)) * (1 - fase(u, T(7.4), T(8))); }
  // 2 — a legenda salta da tela da câmera
  u = t - T(CN.s2[0]); texto('f2', u, 0.2, T(8)); flu('leg2', u, T(2), 1, 120); $('#leg2').style.opacity *= (1 - fase(u, T(7.5), T(8)));
  // 3 — chips das rodovias flutuando (fundo lima)
  u = t - T(CN.s3[0]); texto('f3', u, 0.3, T(8)); for (let i = 0; i < 7; i++) { flu('ch' + i, u, T(1.5) + i * 0.3, 1 + (i % 3) * 0.4, 90); $('#ch' + i).style.opacity *= (1 - fase(u, T(7.5), T(8))); }
  // 4 — sem internet (fundo grafite)
  u = t - T(CN.s4[0]); texto('f4', u, 0.3, T(7)); flu('sinal', u, T(1.5), 0.6, 60); flu('ok4', u, T(4), 1, 80); $('#sinal').style.opacity *= (1 - fase(u, T(6.5), T(7))); $('#ok4').style.opacity *= (1 - fase(u, T(6.5), T(7)));
  // 5 — Modo Carro: placa e KM saltam para fora
  u = t - T(CN.s5[0]); texto('f5', u, 0.3, T(9)); flu('placa5', u, T(1.5), 0.8, 120); flu('km5', u, T(2.2), 0.8, 120);
  if (u >= 0 && u < T(9)) $('#kmv').textContent = kmTxt(82360 + Math.round(ezi(fase(u, T(2.5), T(8))) * 56) * 10);
  $('#placa5').style.opacity *= (1 - fase(u, T(8.5), T(9))); $('#km5').style.opacity *= (1 - fase(u, T(8.5), T(9)));
  // 6 — galeria: fotos saltam e flutuam
  u = t - T(CN.s6[0]); texto('f6', u, 0.3, T(8)); for (let i = 0; i < 3; i++) { flu('cd' + i, u, T(1.5) + i * T(1), 1 + i * 0.3, 140); $('#cd' + i).style.opacity *= (1 - fase(u, T(7.5), T(8))); }
  // 7 — encerramento
  if ((u = corte($('#s7'), t, T(CN.s7[0]), ${DUR})) !== null) encerra('s7', u);
};`;

const cues = [{ t: 0.05, tipo: 'whoosh', g: 0.7 }, { t: T(0.5), tipo: 'hit', g: 0.8 }];
for (const k of ['s2', 's3', 's4', 's5', 's6']) cues.push({ t: T(C[k][0]), tipo: 'hit', g: 0.75 }, { t: T(C[k][0]) + 0.05, tipo: 'whoosh', g: 0.5 });
cues.push({ t: T(10), tipo: 'ding', g: 0.8 });                                                   // legenda salta
for (let i = 0; i < 7; i++) cues.push({ t: T(17.5) + i * 0.3, tipo: 'tick', g: 1.3 });            // chips
cues.push({ t: T(25.5), tipo: 'clack', g: 0.6 }, { t: T(28), tipo: 'ding', g: 0.9 });               // sem sinal → ok
cues.push({ t: T(32.5), tipo: 'whoosh', g: 0.6 }, { t: T(33.2), tipo: 'whoosh', g: 0.6 });         // placa e KM
for (let i = 0; i < 3; i++) cues.push({ t: T(41.5 + i), tipo: 'whoosh', g: 0.55 });               // fotos
cues.push({ t: T(48), tipo: 'hit', g: 1.0 }, { t: T(49), tipo: 'whoosh', g: 0.6 }, { t: T(51), tipo: 'whoosh', g: 0.5 });
const secoes = [
  { de: 0, ate: T(8), piano: 0.8, baixo: 0.5, pad: 0.3 },
  { de: T(8), ate: T(48), piano: 1, baixo: 0.8, pad: 0.4, bat: 'leve' },
  { de: T(48), ate: DUR, piano: 1, baixo: 0.8, pad: 0.5, arp: 0.4, bat: 'leve' },
];
const audio = path.join(AQUI, 'vidico.wav');
if (process.argv[2] !== 'stills') gerarAudio({ saida: audio, dur: DUR, secoes, cues, pausas: [[T(48) - 0.5, T(48)]] });
await montar({ nome: 'km-check-vidico', dur: DUR, css, corpo, script, audio, stills: [T(3), T(12), T(20), T(28), T(36), T(44.5), T(56)] });
