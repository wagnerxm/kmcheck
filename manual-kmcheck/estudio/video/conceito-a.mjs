/* Conceito A — "Um dia de campo": narrativo e cinematográfico. Começa escuro (madrugada, Modo Carro noturno) e clareia
 * até o tema claro do manual. Transições-assinatura: fio de luz contínuo, match cut do KM (o número sai do painel e vira
 * legenda, depois entra na galeria) e a passagem de luz que troca o tema. Cortes e efeitos caem na batida (104 BPM).
 * Uso: node conceito-a.mjs [stills] */
import path from 'node:path';
import { montar, fone, encerramento, caixasLegenda, IMG, T, AQUI } from './motor.mjs';
import { gerarAudio } from './audio.mjs';

const DUR = T(78);                                   // 19,5 compassos ≈ 45 s
const css = `
body{background:#07080a}
.claroFundo{position:absolute;inset:0;background:url(${IMG.fundo}) center/cover,#eef0f1;opacity:0}
.claroFundo::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(238,240,241,.97),rgba(238,240,241,.8) 55%,rgba(238,240,241,.95))}
#fio{position:absolute;inset:0;z-index:3}
.barra{position:absolute;left:0;right:0;height:150px;background:#000;z-index:4}.barra.b{height:330px;background:linear-gradient(transparent,#000 40%)}
.cheia{position:absolute;left:0;top:-60px;width:1080px;height:2337px;transform-origin:50% 45%}
.cheia img{width:100%;height:100%;display:block;filter:brightness(.92)}
.cheia .contador{font-size:256px}
.vinheta{position:absolute;inset:0;background:radial-gradient(70% 60% at 50% 45%,transparent 30%,rgba(0,0,0,.85) 100%);z-index:2}
.leg{position:absolute;left:80px;right:80px;bottom:120px;color:#fff;font:500 46px/1.3 Inter;text-shadow:0 4px 20px rgba(0,0,0,.8);z-index:6;opacity:0}
.leg b{display:block;font:300 30px Inter;letter-spacing:.35em;text-transform:uppercase;color:#b7d92d;margin-bottom:14px}
.palco{position:absolute;inset:0;perspective:1800px}
.foto{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:35% 50%;transform-origin:50% 60%}
.esc{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.5),transparent 35%,transparent 60%,rgba(0,0,0,.85))}
.legFoto{position:absolute;left:60px;right:60px;bottom:420px;padding:26px 30px;background:rgba(0,0,0,.62);color:#fff;font:700 38px/1.45 Arial;border-left:8px solid #b7d92d;white-space:pre-wrap;min-height:270px}
.legFoto i{font-style:normal;color:#b7d92d}
.kmcard{position:absolute;left:50%;top:50%;width:720px;margin:-170px 0 0 -360px;padding:40px 0;border-radius:40px;background:rgba(10,12,14,.5);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.28);color:#fff;text-align:center;box-shadow:0 60px 100px -30px rgba(0,0,0,.9);opacity:0;z-index:8}
.kmcard small{display:block;font:800 26px Inter;letter-spacing:.3em;color:#b7d92d}.kmcard b{display:block;font:900 190px/1 Inter;letter-spacing:-.05em;margin-top:8px}
.card{position:absolute;width:420px;height:300px;border-radius:26px;overflow:hidden;box-shadow:0 40px 70px -30px rgba(0,0,0,.7);border:3px solid #fff;opacity:0}
.card img{width:100%;height:100%;object-fit:cover}.card b{position:absolute;left:14px;bottom:12px;padding:6px 14px;border-radius:999px;background:#b7d92d;color:#111;font:800 22px Inter}
h1{position:absolute;left:80px;right:80px;top:170px;font:900 84px/1.04 Inter;letter-spacing:-.04em;color:#fff;z-index:6;opacity:0}
h1 em{font-style:normal;color:#c4e24a}
.claroTxt h1{color:#14161a}.claroTxt h1 em{color:#6f9a0e}
.chip{position:absolute;left:80px;top:1600px;padding:22px 34px;border-radius:999px;background:#14161a;color:#fff;font:800 36px Inter;box-shadow:0 20px 40px -18px rgba(0,0,0,.6);opacity:0;z-index:7}
.chip i{font-style:normal;color:#c4e24a}
.cinza{filter:saturate(.35) contrast(1.05)}
.luz{position:absolute;left:-40%;top:0;width:60%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.85) 50%,transparent);z-index:9;opacity:0;pointer-events:none}
`;

const corpo = `
<div class="claroFundo" id="claroFundo"></div>
<svg id="fio" viewBox="0 0 1080 1920" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#c4e24a" stop-opacity="0"/><stop offset=".5" stop-color="#c4e24a" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="9"/></filter></defs>
<path id="fioA" d="M-50,1420 C300,1480 700,1120 1130,900" fill="none" stroke="url(#g)" stroke-width="16" opacity=".45" filter="url(#b)"/><path id="fioB" d="M-50,1420 C300,1480 700,1120 1130,900" fill="none" stroke="url(#g)" stroke-width="3"/></svg>

<div class="cena" id="s1"><div class="cheia" id="cheia1"><img src="${IMG.noite}"><div class="extra" style="left:0;top:0;width:100%;height:100%;border-radius:0"></div></div><div class="vinheta"></div>
  <div class="barra" style="top:0"></div><div class="barra b" style="bottom:0"></div>
  <div class="leg" id="l1"><b>5h40 · BR-226/RN</b>O KM corre junto com o carro.</div><div class="leg" id="l2"><b>Km 82,9</b>Chegou no trecho.</div></div>

<div class="cena" id="s3"><div class="vinheta"></div><div class="barra" style="top:0"></div><div class="barra b" style="bottom:0"></div>
  <div class="palco">${fone('f3', IMG.cam, null, ' style="left:260px;top:430px"')}</div>
  <div class="leg" id="l3"><b>Registrar evidência</b>Um toque. O KM já está na legenda.</div></div>

<div class="cena" id="s4"><img class="foto" id="foto4" src="${IMG.foto}"><div class="esc"></div>
  <div class="legFoto" id="legFoto"></div>
  <div class="leg" id="l4"><b>Gravado na imagem</b>Fotografou. A legenda já está lá.</div></div>

<div class="cena" id="s5"><div class="vinheta"></div>
  <div class="palco">${fone('f5', IMG.gal, null, ' style="left:260px;top:600px"')}
    <div class="card" id="c1" style="left:640px;top:640px"><img src="${IMG.rod}"><b>KM 325,870</b></div>
    <div class="card" id="c2" style="left:620px;top:980px"><img src="${IMG.buraco}"><b>KM 326,410</b></div>
    <div class="card" id="c3" style="left:40px;top:1200px"><img src="${IMG.foto}"><b>KM 326,040</b></div></div>
  <h1 id="h5">Cada foto no <em>lugar certo</em>.</h1></div>
<div class="kmcard" id="kmcard"><small>KM GRAVADO</small><b>326,040</b></div>

<div class="cena" id="s6"><div class="vinheta"></div><div class="palco cinza">${fone('f6', IMG.eixo, IMG.imp, ' style="left:260px;top:600px"')}</div>
  <h1 id="h6">Rodovia baixada<br><em>na véspera</em>.</h1><div class="leg" id="l6"><b>Gestão de Eixo</b>Funciona sem sinal, no meio do campo.</div></div>

<div class="cena claroTxt" id="s7"><div class="palco">${fone('f7', IMG.gal, null, ' style="left:260px;top:540px"')}
    <div class="card" id="d1" style="left:620px;top:900px"><img src="${IMG.rod}"><b>KM 325,870</b></div>
    <div class="card" id="d2" style="left:660px;top:1260px"><img src="${IMG.buraco}"><b>KM 326,410</b></div></div>
  <h1 id="h7">Relatório pronto<br><em>antes do almoço</em>.</h1><div class="chip" id="chip7"><i>47 fotos</i> · 3 contratos · 0 anotações</div></div>

${encerramento('s8', 'claro')}
<div class="luz" id="luz"></div>`;

const script = `
window.render = function (t) {
  fio(t, ${DUR});
  let u;
  // 1 — madrugada: KM corre (0–7), desacelera e trava (7–10,5)
  if ((u = corte($('#s1'), t, 0, T(12))) !== null) {
    const ch = $('#cheia1'); ch.style.transform = 'scale(' + (1.04 + 0.05 * (u / T(12))) + ')';
    const sub = u < T(7) ? fase(u, 0, T(7)) : 1; const des = 1 - Math.pow(1 - fase(u, T(7), T(10.5)), 2);
    contador(ch, 82360 + Math.round((sub * 46 + des * 10)) * 10);
    sobe($('#l1'), fase(u, T(1), T(1) + 0.6) * (1 - fase(u, T(7.5), T(8))), 30);
    sobe($('#l2'), fase(u, T(8), T(8) + 0.5), 30);
    $('#s1').style.opacity = 1 - fase(u, T(11.5), T(12));
  }
  // 3 — câmera sobe em perspectiva; obturador na batida 16 (flash cobre a tela e vira a foto)
  if ((u = corte($('#s3'), t, T(12), T(16.5))) !== null) {
    const f = $('#f3'); const p = ez(fase(u, 0, 0.9)); f.style.opacity = p;
    f.style.transform = 'translateY(' + ((1 - p) * 500) + 'px) rotateX(' + (18 - 12 * p) + 'deg) rotateY(' + (-10 * p) + 'deg) scale(' + (0.92 + 0.08 * p) + ')';
    sobe($('#l3'), fase(u, T(1), T(1) + 0.5), 30); flash(f, u, T(4));
  }
  $('#flashTela').style.opacity = (t >= T(16) && t < T(17)) ? (1 - ez(fase(t, T(16.3), T(17)))) * (t < T(16.3) ? fase(t, T(16), T(16.08)) : 1)
                                : (t >= T(48) - 0.2 && t < T(49)) ? 0 : 0;
  // 4 — a foto em tela cheia, legenda escrita linha a linha (uma a cada 2 batidas)
  if ((u = corte($('#s4'), t, T(16.5), T(29.5))) !== null) {
    $('#foto4').style.transform = 'scale(' + (1.02 + 0.08 * (u / T(11.5))) + ')';
    const lin = LEG.map((txt, i) => { const a = T(1) + i * T(2), p = fase(u, a, a + 0.9); if (u < a) return null; return txt.slice(0, Math.floor(p * txt.length)) + (p < 1 ? '|' : ''); }).filter(x => x !== null);
    $('#legFoto').innerHTML = lin.map(l => l.replace('326,040', '<i>326,040</i>')).join('<br>');
    sobe($('#l4'), fase(u, T(7.5), T(7.5) + 0.5), 30);
    $('#s4').style.opacity = 1 - fase(u, T(11.8), T(13));   // a foto escurece enquanto o KM cresce no centro
  }
  // match cut: o KM sai da legenda (batida 28), cresce no centro e mergulha na galeria (30–31,5)
  { const k = $('#kmcard'); const vis = t >= T(27.6) && t < T(31.6); k.style.display = vis ? 'block' : 'none';
    if (vis) { const a = ezb(fase(t, T(27.6), T(29))), b = ezi(fase(t, T(30), T(31.5)));
      const sx = (1 - a) * 0.22 + a * 1, s = sx * (1 - b) + b * 0.18; const x = (1 - a) * -200 + b * -220, y = (1 - a) * 260 + b * -150 * 0 + b * 300;
      k.style.opacity = Math.min(1, fase(t, T(27.6), T(27.9))) * (1 - fase(t, T(31.3), T(31.6)));
      k.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; } }
  // 5 — galeria: celular sobe (30), três fotos entram em batidas seguidas (32, 33, 34)
  if ((u = cena($('#s5'), t, T(28), T(38), 0.3, 0.3)) !== null) {
    const f = $('#f5'); foneEntra(f, u, T(2), 0.8);
    [['#c1', 4, 6], ['#c2', 5, -4], ['#c3', 6, 3]].forEach(([id, b, rot]) => { const c = $(id); const p = ezb(fase(u, T(b), T(b) + 0.5));
      c.style.opacity = cl(p * 3); c.style.transform = 'translateX(' + ((1 - p) * 500) + 'px) rotate(' + rot + 'deg) scale(' + (0.8 + 0.2 * p) + ')'; });
    sobe($('#h5'), fase(u, T(3), T(3) + 0.5), 40);
  }
  // 6 — flashback do cadastro (dessaturado): Gestão de Eixo → Baixar rodovia
  if ((u = cena($('#s6'), t, T(38), T(48), 0.3, 0.3)) !== null) {
    const f = $('#f6'); foneEntra(f, u, 0, 0.7); cruza(f, u, T(3), T(3) + 0.4); pulso(f, u, T(4), 10.5, 37.2, 79, 6.2);
    sobe($('#h6'), fase(u, T(0.5), T(0.5) + 0.5), 40); sobe($('#l6'), fase(u, T(5), T(5) + 0.5), 30);
  }
  // passagem de luz (batida 48): a luz atravessa e o fundo vira o tema claro
  { const p = fase(t, T(47.3), T(48.6)); const luz = $('#luz'); luz.style.opacity = p > 0 && p < 1 ? 1 : 0; luz.style.transform = 'translateX(' + (p * 1800) + 'px) skewX(-12deg)';
    $('#claroFundo').style.opacity = ez(fase(t, T(47.8), T(48.4))); }
  // 7 — tema claro: galeria em 3D, fotos saltando da tela, resumo do dia
  if ((u = corte($('#s7'), t, T(48), T(60))) !== null) {
    const f = $('#f7'); const p = ez(fase(u, 0, 0.9)); f.style.opacity = p;
    f.style.transform = 'translateY(' + ((1 - p) * 200) + 'px) rotateY(' + (-22 * p) + 'deg) rotateX(' + (6 * p) + 'deg)';
    [['#d1', 2, 6, 160], ['#d2', 3, -4, 220]].forEach(([id, b, rot, z]) => { const c = $(id); const q = ezb(fase(u, T(b), T(b) + 0.5));
      c.style.opacity = cl(q * 3); c.style.transform = 'rotateY(-22deg) rotateX(6deg) translateZ(' + (z * q) + 'px) rotate(' + rot + 'deg) scale(' + (0.7 + 0.3 * q) + ')'; });
    sobe($('#h7'), fase(u, T(1), T(1) + 0.5), 40); pula($('#chip7'), fase(u, T(6), T(6) + 0.45));
    $('#s7').style.opacity = 1 - fase(u, T(11.6), T(12));
  }
  // 8 — encerramento
  if ((u = corte($('#s8'), t, T(60), ${DUR})) !== null) encerra('s8', u);
};`;

const cues = [
  { t: 0, tipo: 'hit' }, { t: T(10.5), tipo: 'clack' }, { t: T(12), tipo: 'whoosh' }, { t: T(16), tipo: 'obturador' }, { t: T(16.1), tipo: 'hit', g: 0.8 },
  { t: T(25.5), tipo: 'ding' }, { t: T(28), tipo: 'hit' }, { t: T(30), tipo: 'whoosh' }, { t: T(32), tipo: 'whoosh', g: 0.8 }, { t: T(33), tipo: 'whoosh', g: 0.8 }, { t: T(34), tipo: 'whoosh', g: 0.8 },
  { t: T(38), tipo: 'hit' }, { t: T(41), tipo: 'whoosh', g: 0.7 }, { t: T(48), tipo: 'riser' }, { t: T(48), tipo: 'hit' }, { t: T(50), tipo: 'whoosh', g: 0.8 }, { t: T(51), tipo: 'whoosh', g: 0.8 },
  { t: T(54), tipo: 'ding' }, { t: T(60), tipo: 'hit' }, { t: T(61), tipo: 'whoosh', g: 0.7 }, { t: T(63), tipo: 'whoosh', g: 0.6 },
];
// ticks da legenda sendo escrita (cena 4): a cada 2 letras
for (let i = 0; i < 4; i++) { const a = T(16.5) + T(1) + i * T(2), n = 40; for (let k = 0; k < n; k += 2) cues.push({ t: a + (k / n) * 0.9, tipo: 'tick', g: 0.7 }); }
const secoes = [
  { de: 0, ate: T(12), pad: 0.9, baixo: 0.6, arp: 0.25 },
  { de: T(12), ate: T(16.5), pad: 1, baixo: 0.8, arp: 0.6, bat: 'leve' },
  { de: T(16.5), ate: T(48), pad: 1, baixo: 1, arp: 1, bat: 'cheia' },
  { de: T(48), ate: T(60), pad: 1, baixo: 1, arp: 1, bat: 'cheia', nivel: 1.05 },
  { de: T(60), ate: DUR, pad: 1, baixo: 1, arp: 0.8, bat: 'cheia' },
];
const audio = path.join(AQUI, 'conceito-a.wav');
if (process.argv[2] !== 'stills') gerarAudio({ saida: audio, dur: DUR, secoes, cues, pausas: [[T(60) - 0.5, T(60)]] });
await montar({ nome: 'conceito-a', dur: DUR, css, corpo, script, audio, stills: [T(4), T(9), T(14.5), T(23), T(29), T(34.5), T(43), T(53), T(66)] });
