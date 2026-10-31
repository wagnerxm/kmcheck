/* Vídeo de divulgação no estilo "motion graphics de app" (referência: explainer da Vidico): um iPhone só, centralizado
 * na tela (vertical e horizontal), que entra uma vez e fica; as telas trocam DENTRO dele deslizando; uma frase por cena com
 * a palavra-chave em verde; elementos da interface "saltam" para fora e flutuam; blocos de cor (lima, grafite) crescem em
 * círculo para trocar o clima. Fundo: manual-kmcheck/estudio/fundo-video.webp (a rodovia com os arcos verdes).
 * Ordem: 0 slogan com o ícone · 1 tela inicial · 2 gestão de eixo · 3 câmera (foto) · 4 galeria · 5 Modo Carro · 6 lojas.
 * Uso: node vidico.mjs [stills]  → km-check-vidico.mp4 */
import fs from 'node:fs';
import path from 'node:path';
import { montar, encerramento, IMG, T, AQUI, RAIZ } from './motor.mjs';
import { gerarAudio } from './audio.mjs';

const FUNDO = 'data:image/webp;base64,' + fs.readFileSync(path.join(RAIZ, 'manual-kmcheck/estudio/fundo-video.webp')).toString('base64');
const ICONE = 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, 'icon-512.png')).toString('base64');
const DUR = T(62);                                   // ≈ 36 s
// cenas em batidas [início, fim]; s0 e s7 não têm celular
const C = { sm: [0, 6], s1: [6, 13], s2: [13, 21], s3: [21, 30], s4: [30, 38], s5: [38, 47], s7: [47, 62] };
const ESTILO = process.env.ESTILO || 'base';   // base | flip | zoom | slide
const TELAS = ['inicio', 'eixo', 'cam', 'gal', 'carro'];                 // tela do iPhone nas cenas 1..5

const css = `
body{background:#eef0f1}
#grafite{position:absolute;inset:0;background:radial-gradient(90% 70% at 20% 0%,#2e3137 0%,#17191d 45%,#0a0b0d 100%);z-index:2}
#grao{position:absolute;inset:0;opacity:.06;z-index:2;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")}
.linhaV{position:absolute;left:539px;width:2px;background:linear-gradient(transparent,#c4e24a 30%,#c4e24a 70%,transparent);box-shadow:0 0 18px rgba(196,226,74,.9);z-index:8}
#lTopo{top:0;height:0}#lBase{bottom:0;height:0}
#luzv{position:absolute;left:50%;top:50%;width:1400px;height:1400px;margin:-700px 0 0 -700px;background:radial-gradient(50% 50% at 50% 50%,rgba(196,226,74,.16),transparent 65%);opacity:0;z-index:2}
#logoM{position:absolute;left:220px;top:770px;width:640px;overflow:hidden;clip-path:inset(0 50% 0 50%);z-index:8}
#logoM img{display:block;width:640px;filter:drop-shadow(0 30px 60px rgba(0,0,0,.7))}
.brilhoL{position:absolute;left:0;top:0;width:640px;height:100%;-webkit-mask:url(${IMG.logo}) center/640px auto no-repeat;mask:url(${IMG.logo}) center/640px auto no-repeat;overflow:hidden;pointer-events:none}
.brilhoL i{position:absolute;top:-20%;left:-60%;width:40%;height:140%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.95) 50%,transparent);opacity:0;mix-blend-mode:screen}
#fioA3{position:absolute;inset:0;z-index:2;opacity:0}
.abstrato{position:absolute;inset:0;background:radial-gradient(60% 40% at 15% 10%,rgba(183,217,45,.22),transparent 70%),radial-gradient(50% 35% at 90% 85%,rgba(183,217,45,.2),transparent 70%),radial-gradient(45% 30% at 85% 15%,rgba(20,22,26,.06),transparent 70%);z-index:1;opacity:0}
#arcos{position:absolute;inset:0;z-index:1;opacity:0}
#fundo{position:absolute;left:-3%;top:-3%;width:106%;height:106%;background:url(${FUNDO}) center/cover;transform-origin:50% 40%}
.veu{position:absolute;left:540px;top:960px;width:3200px;height:3200px;margin:-1600px 0 0 -1600px;border-radius:50%;transform:scale(0);z-index:1}
#veuLima{background:#b7d92d}#veuGraf{background:linear-gradient(160deg,#2a2d33,#111214)}
#veuClaro{background:url(${FUNDO}) center/cover;background-size:1150px 2040px;background-position:center}
#veuBranco{background:linear-gradient(rgba(255,255,255,.9),rgba(255,255,255,.9)),url(${FUNDO});background-size:auto,1150px 2040px;background-position:center,center}
.palco{position:absolute;inset:0;perspective:2200px;z-index:3}
/* iPhone centralizado: (1080-560)/2 = 260 · (1920-1232)/2 = 344 */
.fone{position:absolute;left:260px;top:344px;width:560px;height:1232px;border-radius:84px;background:#0b0c0e;padding:14px;transform-style:preserve-3d;transform-origin:50% 50%;
  box-shadow:0 80px 120px -40px rgba(10,12,14,.55),0 0 0 2px #2a2c30,inset 0 0 0 2px rgba(255,255,255,.08)}
.fone .bt{position:absolute;width:6px;background:#2a2c30;border-radius:3px}
.fone .mudo{left:-6px;top:230px;height:48px}.fone .vol1{left:-6px;top:320px;height:92px}.fone .vol2{left:-6px;top:432px;height:92px}.fone .lado{right:-6px;top:360px;height:140px}
.fone .ilha{position:absolute;top:34px;left:50%;width:128px;height:38px;margin-left:-64px;border-radius:22px;background:#000;z-index:5}
.janela{position:absolute;left:14px;top:14px;width:532px;height:1204px;border-radius:70px;overflow:hidden;background:#000}
.janela img{position:absolute;left:0;top:0;width:532px;height:1204px;object-fit:cover;object-position:top}
.brilho{position:absolute;inset:0;border-radius:70px;background:linear-gradient(110deg,rgba(255,255,255,.12),rgba(255,255,255,0) 40%);pointer-events:none}
.flashF{position:absolute;left:14px;top:14px;width:532px;height:1204px;border-radius:70px;background:#fff;opacity:0;z-index:6;pointer-events:none}
.frase{position:absolute;left:60px;right:60px;top:110px;font:900 72px/1.04 Inter;letter-spacing:-.045em;color:#14161a;z-index:6;text-wrap:balance;opacity:0}
.frase em{font-style:normal;color:#6f9a0e}.frase.clara{color:#fff}.frase.clara em{color:#c4e24a}.frase.lima em{color:#14161a}
.frase .pal{display:inline-block;opacity:0}
.sub{position:absolute;left:70px;right:70px;font:500 36px/1.35 Inter;color:#3b4559;z-index:6;opacity:0}
.flu{position:absolute;z-index:7;opacity:0;will-change:transform}
.chip{display:inline-flex;align-items:center;gap:12px;padding:16px 26px;border-radius:999px;background:#fff;color:#14161a;font:800 30px Inter;box-shadow:0 20px 40px -18px rgba(20,22,26,.45),0 0 0 1px rgba(20,22,26,.08)}
.chip i{width:12px;height:12px;border-radius:50%;background:#b7d92d;box-shadow:0 0 10px rgba(183,217,45,.9)}
.legenda{padding:22px 28px;border-radius:18px;background:rgba(0,0,0,.72);color:#fff;font:700 30px/1.4 Arial;border-left:8px solid #b7d92d;white-space:pre;box-shadow:0 30px 60px -20px rgba(0,0,0,.6)}
.legenda b{color:#c4e24a}
.placa{filter:drop-shadow(0 30px 40px rgba(0,0,0,.5))}
.kmg{font:900 96px/1 Inter;letter-spacing:-.05em;color:#fff;text-shadow:0 20px 50px rgba(0,0,0,.5)}
.kmg small{display:block;font:800 24px Inter;letter-spacing:.3em;color:#c4e24a;margin-bottom:8px}
.card{width:380px;height:270px;border-radius:24px;overflow:hidden;box-shadow:0 40px 70px -30px rgba(0,0,0,.6);border:4px solid #fff;position:relative}
.card img{width:100%;height:100%;object-fit:cover}.card b{position:absolute;left:14px;bottom:12px;padding:6px 14px;border-radius:999px;background:#b7d92d;color:#111;font:800 22px Inter}
/* contador do Modo Carro: cobre o número real da tela (mesma posição do print 20-carro-dia) dentro da janela do celular */
.contCarro{position:absolute;left:12%;right:12%;top:37.6%;height:9.2%;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#1f2226,#17191c);font:800 126px/1 Inter;letter-spacing:-.035em;color:#fff;opacity:0;z-index:4}
#s7{z-index:9}#s7 .fim img.logo{margin-top:170px;width:280px;border-radius:68px;box-shadow:0 50px 90px -30px rgba(0,0,0,.8),0 0 0 2px rgba(255,255,255,.12)}#s7 h2{font-size:72px}#s7 .fim{display:flex}#s7 .gratis{order:9;margin-top:30px}#s7 .lojas{order:8;margin-top:30px}
#s7 .link{display:block;order:7;margin-top:30px;font:800 40px Inter;color:#fff;letter-spacing:0}#s7 .link small{display:none}#s7 .qr{order:6;margin-top:36px;width:520px;height:520px;padding:22px}
`;

const placaSvg = `<svg class="placa" width="220" height="261" viewBox="0 0 150 178"><rect x="2" y="2" width="146" height="174" rx="14" fill="#fff"/><rect x="10" y="10" width="130" height="158" rx="9" fill="#13305c"/><text x="75" y="52" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="31" fill="#fff">BR-226</text><line x1="24" y1="68" x2="126" y2="68" stroke="#fff" stroke-width="3"/><text x="75" y="110" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="34" fill="#fff">KM</text><text x="75" y="156" text-anchor="middle" font-family="Inter,Arial" font-weight="800" font-size="42" fill="#fff">082</text></svg>`;
const frase = (id, cls, html, extra = '') => `<div class="frase ${cls}" id="${id}"${extra}>${html.split(' ').map(w => `<span class="pal">${w}</span>`).join(' ')}</div>`;

const corpo = `
<div id="fundo"></div><div class="veu" id="veuLima"></div><div class="veu" id="veuClaro"></div><div class="veu" id="veuGraf"></div><div class="veu" id="veuBranco"></div>
<div class="abstrato" id="abstrato"></div>
<svg id="arcos" viewBox="0 0 1080 1920" preserveAspectRatio="none"><defs><linearGradient id="ga" x1="0" x2="1"><stop offset="0" stop-color="#b7d92d" stop-opacity="0"/><stop offset=".5" stop-color="#b7d92d" stop-opacity=".55"/><stop offset="1" stop-color="#b7d92d" stop-opacity="0"/></linearGradient></defs>
<path d="M-100,300 C300,120 700,420 1180,200" fill="none" stroke="url(#ga)" stroke-width="40" opacity=".35"/><path d="M-100,1700 C400,1500 700,1850 1180,1600" fill="none" stroke="url(#ga)" stroke-width="56" opacity=".3"/>
<path d="M-100,360 C300,180 700,480 1180,260" fill="none" stroke="#b7d92d" stroke-width="2" opacity=".35"/><path d="M-100,1640 C400,1440 700,1790 1180,1540" fill="none" stroke="#b7d92d" stroke-width="2" opacity=".35"/>
<g fill="#b7d92d" opacity=".5"><circle cx="120" cy="520" r="6"/><circle cx="980" cy="700" r="5"/><circle cx="160" cy="1320" r="5"/><circle cx="940" cy="1180" r="7"/><circle cx="80" cy="1000" r="4"/><circle cx="1010" cy="430" r="4"/></g>
<g stroke="#9cb52a" stroke-width="1.5" opacity=".35"><line x1="120" y1="520" x2="80" y2="1000"/><line x1="980" y1="700" x2="940" y2="1180"/><line x1="80" y1="1000" x2="160" y2="1320"/></g></svg>
<div id="grafite"></div><div id="grao"></div><div id="luzv"></div>
<svg id="fioA3" viewBox="0 0 1080 1920" preserveAspectRatio="none"><defs><linearGradient id="gf" x1="0" x2="1"><stop offset="0" stop-color="#c4e24a" stop-opacity="0"/><stop offset=".5" stop-color="#c4e24a" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><filter id="bf"><feGaussianBlur stdDeviation="9"/></filter></defs>
<path d="M-50,1300 C300,1360 700,1000 1130,800" fill="none" stroke="url(#gf)" stroke-width="16" opacity=".45" filter="url(#bf)"/><path d="M-50,1300 C300,1360 700,1000 1130,800" fill="none" stroke="url(#gf)" stroke-width="3"/></svg>
<div class="linhaV" id="lTopo"></div><div class="linhaV" id="lBase"></div>
<div id="logoM"><img src="${IMG.logo}"><div class="brilhoL"><i id="brilhoM"></i></div></div>
<div class="palco"><div class="fone" id="fone"><b class="bt mudo"></b><b class="bt vol1"></b><b class="bt vol2"></b><b class="bt lado"></b>
  <div class="janela">${TELAS.map((k, i) => `<img id="t${i}" src="${IMG[k]}">`).join('')}<div class="contCarro" id="kmv"></div><div class="brilho"></div></div><div class="flashF" id="flashF"></div><i class="ilha"></i></div></div>


${frase('f1', '', 'Tudo que o campo precisa, <em>numa tela</em>.')}
${frase('f2', 'lima', 'Cadastre a rodovia <em>uma vez</em>.')}
${[['BR-226', 60, 420], ['BR-101', 760, 380], ['BR-304', 40, 1620], ['RN', 850, 1680], ['BR-110', 700, 1420], ['SNV Out/26', 80, 640], ['CE · PB', 820, 560]]
  .map(([t, x, y], i) => `<div class="flu" id="ch${i}" style="left:${x}px;top:${y}px"><div class="chip"><i></i>${t}</div></div>`).join('')}
${frase('f3', '', 'Fotografou, <em>legenda gravada</em>.')}
<div class="flu" id="leg3" style="left:40px;top:1660px"><div class="legenda">BR-226/RN - KM <b>326,040</b>  LD · Est. <b>16302+0</b>
14 00515/2024 - Aplicação de CBUQ
-6,077504, -37,537466 · 22/10/2026</div></div>
${frase('f4', '', 'Tudo <em>organizado</em>.')}
${[[IMG.rod, 'KM 325,870', 660, 300, 6], [IMG.buraco, 'KM 326,410', 30, 1540, -5], [IMG.foto, 'KM 326,040', 670, 1600, 4]]
  .map(([src, km, x, y, r], i) => `<div class="flu" id="cd${i}" style="left:${x}px;top:${y}px"><div class="card" style="transform:rotate(${r}deg)"><img src="${src}"><b>${km}</b></div></div>`).join('')}
${frase('f5', 'clara', 'O KM acompanha o <em>carro</em>.')}
${encerramento('s7', 'escuro').replace('<small>Baixe agora em</small>kmcheck.com.br/baixar', 'Aponte a câmera e baixe').replace('<img class="logo" id="s7-logo" src="' + IMG.logo + '">', '<img class="logo" id="s7-logo" src="' + ICONE + '">')}`;

const script = `
const F = $('#fone'); const N = ${TELAS.length}; const CN = ${JSON.stringify(C)}; const CEL = ['s1','s2','s3','s4','s5'].map(k => CN[k]);
const flu = (id, u, a, bob = 1, dist = 80) => { const e = $('#' + id); const p = ezb(fase(u, a, a + 0.55)); e.style.opacity = u >= a ? cl((u - a) * 4) : 0;
  e.style.transform = 'translateY(' + ((1 - p) * dist + Math.sin(u * 2.1 + dist) * 6 * bob) + 'px) scale(' + (0.7 + 0.3 * p) + ')'; };
const texto = (id, u, a, b) => { $('#' + id).style.opacity = (u >= 0 && u < b) ? 1 : 0; $$('#' + id + ' .pal').forEach((w, i) => { const p = ez(fase(u, a + i * 0.09, a + 0.45 + i * 0.09)), q = fase(u, b - 0.35, b);
  w.style.opacity = p * (1 - q); w.style.transform = 'translateY(' + ((1 - p) * 50 - q * 40) + 'px)'; }); };
const ESTILO = '${ESTILO}';
const circulo = (id, u, a, dur = 0.75) => { const e = $('#' + id); const p = ez(fase(u, a, a + dur));
  if (ESTILO === 'flip') { e.style.borderRadius = '0'; e.style.transform = 'translateX(' + ((1 - p) * -3200) + 'px) skewX(-18deg)'; }
  else if (ESTILO === 'slide') { e.style.borderRadius = '0'; e.style.transform = 'translateY(' + ((p - 1) * 3200) + 'px)'; }
  else if (ESTILO === 'zoom') { const pulso = u >= a && u < a + 1.2 ? 1 + 0.08 * Math.sin((u - a) * 14) * (1 - fase(u, a, a + 1.2)) : 1; e.style.transform = 'scale(' + (p * pulso) + ')'; }
  else e.style.transform = 'scale(' + p + ')'; };
window.render = function (t) {
  $('#fundo').style.transform = 'scale(' + (1 + 0.04 * (t / ${DUR})) + ')';
  // M3 (0–6): linha risca, abre e revela a logo; o grafite fica até o fim da A3 e esmaece na entrada da tela inicial
  { const r = ez(fase(t, 0, 0.9)), fimM = 1 - fase(t, T(5.4), T(6)); $('#lTopo').style.height = (r * 700) + 'px'; $('#lBase').style.height = (r * 700) + 'px';
    const a = ez(fase(t, 0.9, 1.7)); const l = $('#logoM'); l.style.clipPath = 'inset(0 ' + (50 - 50 * a) + '% 0 ' + (50 - 50 * a) + '%)'; l.style.opacity = fimM;
    $('#lTopo').style.opacity = (1 - fase(t, 1.2, 1.8)) * fimM; $('#lBase').style.opacity = (1 - fase(t, 1.2, 1.8)) * fimM;
    $('#luzv').style.opacity = 0; const b = $('#brilhoM'); const q = fase(t, 1.8, 2.5); b.style.opacity = q > 0 && q < 1 ? 1 : 0; b.style.transform = 'translateX(' + (q * 400) + '%) skewX(-15deg)';
    const gf = Math.max(1 - ez(fase(t, T(CN.s1[0]) - 0.3, T(CN.s1[0]) + 0.5)), ez(fase(t, T(CN.s7[0]) - 0.2, T(CN.s7[0]) + 0.5))); $('#grafite').style.opacity = gf; $('#grao').style.opacity = 0.06 * gf; $('#fioA3').style.opacity = 0;
    $('#abstrato').style.opacity = 0; $('#arcos').style.opacity = 0; }
  circulo('veuLima', t, T(CN.s2[0]) - 0.2); circulo('veuClaro', t, T(CN.s3[0]) - 0.2); circulo('veuGraf', t, T(CN.s5[0]) - 0.2); 
  // o iPhone: entra na cena 1 e fica centralizado e reto; só gira (ida e volta) na troca de tela; sai no encerramento
  const sobeP = ez(fase(t, T(CN.s1[0]), T(CN.s1[0]) + 1.0)); const cena = CEL.findIndex(([a, b]) => t >= T(a) && t < T(b));
  const ini = cena > 0 ? T(CEL[cena][0]) : T(CN.s1[0]); const m = fase(t, ini, ini + 0.9);
  const sai = ezi(fase(t, T(CN.s7[0]), T(CN.s7[0]) + 0.8)); let giro = 0, tx = 0, esc = 1, ty = (1 - sobeP) * 500 + sai * 600;
  if (ESTILO === 'flip') {            // vira 180° na batida: a tela nova aparece "do outro lado" (troca no meio do giro)
    giro = cena > 0 ? ezi(m) * 180 : (1 - sobeP) * 18;
  } else if (ESTILO === 'zoom') {     // soco de câmera: punch-in rápido e volta, como corte na batida
    const k = cena > 0 ? Math.sin(Math.min(1, m * 1.6) * Math.PI) : 0; esc = 1 + 0.12 * k; giro = cena > 0 ? 0 : (1 - sobeP) * 18;
  } else if (ESTILO === 'slide') {    // sai por um lado e volta pelo outro com overshoot
    const dir = cena % 2 ? 1 : -1; const q = ezb(m); tx = cena > 0 ? (m < 0.5 ? ezi(m * 2) * 1400 * dir : (1 - q) * -1400 * dir) : 0; giro = cena > 0 ? 0 : (1 - sobeP) * 18;
  } else giro = cena > 0 ? Math.sin(m * Math.PI) * (cena % 2 ? -14 : 14) : (1 - sobeP) * 18;
  F.style.opacity = sobeP * (1 - sai);
  F.style.transform = 'translate(' + tx + 'px,' + ty + 'px) rotateY(' + giro + 'deg) scale(' + (esc * (1 - 0.3 * sai)) + ')';
  for (let i = 0; i < N; i++) { const [a] = CEL[i]; const p = i === 0 ? 1 : ezi(fase(t, T(a), T(a) + 0.55)); const prox = i + 1 < N ? ezi(fase(t, T(CEL[i + 1][0]), T(CEL[i + 1][0]) + 0.55)) : 0;
    const e = $('#t' + i);
    if (ESTILO === 'flip') {          // corte seco no meio do giro (quando o celular está de perfil)
      const on = cena === i || (cena < 0 && i === 0); e.style.transform = 'scaleX(' + (giro > 90 ? -1 : 1) + ')'; e.style.visibility = on ? 'visible' : 'hidden'; e.style.opacity = 1;
    } else if (ESTILO === 'zoom') {   // crossfade rápido com zoom de saída
      const vis = p > 0 && prox < 1; e.style.visibility = vis ? 'visible' : 'hidden'; e.style.opacity = p * (1 - prox); e.style.transform = 'scale(' + (1 + 0.08 * (1 - p) + 0.08 * prox) + ')';
    } else if (ESTILO === 'slide') {  // a tela desce de cima e empurra a anterior para baixo
      const y = (p - 1) * 1204 + prox * 1204; e.style.transform = 'translateY(' + y + 'px)'; e.style.visibility = Math.abs(y) >= 1204 ? 'hidden' : 'visible';
    } else { const x = (1 - p) * 560 - prox * 560; e.style.transform = 'translateX(' + x + 'px)'; e.style.visibility = Math.abs(x) >= 560 ? 'hidden' : 'visible'; } }
  let u;
  // 1 — tela inicial
  u = t - T(CN.s1[0]); texto('f1', u, 0.3, T(7));
  // 2 — gestão de eixo (fundo lima): chips das rodovias flutuando
  u = t - T(CN.s2[0]); texto('f2', u, 0.3, T(8)); for (let i = 0; i < 7; i++) { flu('ch' + i, u, T(1.5) + i * 0.3, 1 + (i % 3) * 0.4, 90); $('#ch' + i).style.opacity *= (1 - fase(u, T(7.5), T(8))); }
  // 3 — câmera: obturador (flash dentro da tela) na batida 2,5 e a legenda salta para fora
  u = t - T(CN.s3[0]); texto('f3', u, 0.3, T(9)); $('#flashF').style.opacity = u >= T(2.5) && u < T(9) ? 1 - ez(fase(u, T(2.5), T(2.5) + 0.35)) : 0;
  flu('leg3', u, T(3.2), 1, 120); $('#leg3').style.opacity *= (1 - fase(u, T(8.5), T(9)));
  // 4 — galeria: fotos saltam e flutuam
  u = t - T(CN.s4[0]); texto('f4', u, 0.3, T(8)); for (let i = 0; i < 3; i++) { flu('cd' + i, u, T(1.5) + i * T(1), 1 + i * 0.3, 140); $('#cd' + i).style.opacity *= (1 - fase(u, T(7.5), T(8))); }
  // 5 — Modo Carro (fundo grafite): placa e KM saltam para fora
  u = t - T(CN.s5[0]); texto('f5', u, 0.3, T(9)); { const k = $('#kmv'); const on = u >= 0.6 && u < T(9); k.style.opacity = on ? 1 : 0;   // só depois que a tela do Modo Carro assentou
    if (on) k.textContent = kmTxt(82360 + Math.round(ezi(fase(u, T(1.5), T(8))) * 56) * 10); }
  // 7 — encerramento (lojas), fundo mais branco
  if ((u = corte($('#s7'), t, T(CN.s7[0]), ${DUR})) !== null) encerra('s7', u);
};`;

const cues = [{ t: 0.05, tipo: 'whoosh', g: 0.5 }, { t: 0.9, tipo: 'clack', g: 0.6 }, { t: 1.0, tipo: 'hit', g: 0.9 }, { t: 1.1, tipo: 'whoosh', g: 0.6 }, { t: 2.5, tipo: 'ding', g: 0.5 },
  ];
for (const k of ['s1', 's2', 's3', 's4', 's5']) cues.push({ t: T(C[k][0]), tipo: 'hit', g: 0.75 }, { t: T(C[k][0]) + 0.05, tipo: 'whoosh', g: 0.5 });
for (let i = 0; i < 7; i++) cues.push({ t: T(14.5) + i * 0.3, tipo: 'tick', g: 1.3 });            // chips das rodovias
cues.push({ t: T(23.5), tipo: 'obturador' }, { t: T(24.2), tipo: 'ding', g: 0.8 });               // foto → legenda salta
for (let i = 0; i < 3; i++) cues.push({ t: T(31.5 + i), tipo: 'whoosh', g: 0.55 });               // fotos da galeria
for (let i = 0; i < 6; i++) cues.push({ t: T(39.5 + i), tipo: 'tick', g: 0.9 });                 // KM subindo
cues.push({ t: T(47), tipo: 'hit', g: 1.0 }, { t: T(48), tipo: 'whoosh', g: 0.6 }, { t: T(50), tipo: 'whoosh', g: 0.5 });
const secoes = [
  { de: 0, ate: T(6), pad: 0.6 },
  { de: T(6), ate: T(47), piano: 1, baixo: 0.8, pad: 0.4, bat: ESTILO === 'base' ? 'leve' : 'cheia', arp: ESTILO === 'base' ? 0 : 0.5 },
  { de: T(47), ate: DUR, piano: 1, baixo: 0.8, pad: 0.5, arp: 0.4, bat: ESTILO === 'base' ? 'leve' : 'cheia' },
];
const audio = path.join(AQUI, 'vidico.wav');
if (process.argv[2] !== 'stills') gerarAudio({ saida: audio, dur: DUR, secoes, cues, pausas: [[T(47) - 0.5, T(47)]] });
if (ESTILO !== 'base') for (const k of ['s2', 's3', 's4', 's5']) cues.push({ t: T(C[k][0]) + 0.45, tipo: ESTILO === 'flip' ? 'whoosh' : 'clack', g: 0.6 });
await montar({ nome: ESTILO === 'base' ? 'km-check-vidico' : 'km-check-' + ESTILO, dur: DUR, css, corpo, script, audio, stills: [2.6, T(10), T(17), T(25), T(34), T(43), T(55)] });
