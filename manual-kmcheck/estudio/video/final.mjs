/* Vídeo final de divulgação: apresentação do app no tema claro (ordem: tela inicial, cadastro, legenda, câmera, Modo Carro,
 * encerramento), abrindo com a cena do conceito C (caderneta "Que KM era mesmo?", split antes/depois, flash que vira a
 * chave) e com os efeitos do conceito B (hit em cada corte, mergulho na tela, giro 3D do iPhone, silêncio antes do fim).
 * Uso: node final.mjs [stills]  → km-check-final.mp4 */
import path from 'node:path';
import { montar, fone, encerramento, caixasLegenda, IMG, T, AQUI } from './motor.mjs';
import { gerarAudio } from './audio.mjs';

const DUR = T(66);                                   // ≈ 38 s
const css = `
body{background:#cfcfcf}
.claroFundo{position:absolute;inset:0;background:url(${IMG.fundo}) center/cover,#eef0f1;opacity:0}
.claroFundo::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(238,240,241,.97) 0%,rgba(238,240,241,.9) 30%,rgba(238,240,241,.6) 62%,rgba(238,240,241,.9) 100%)}
#brilho{position:absolute;left:50%;top:900px;width:1400px;height:1400px;margin-left:-700px;background:radial-gradient(50% 50% at 50% 50%,rgba(196,226,74,.28),transparent 70%);opacity:0}
#fio{position:absolute;inset:0;opacity:0}
/* abertura (conceito C) */
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
/* apresentação do app (v1) */
.palco{position:absolute;inset:0;perspective:2200px}
.txt{position:absolute;left:80px;right:80px;top:150px;z-index:6}
.txt .logo{height:112px;margin-bottom:34px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.18))}
h1{font:900 82px/1.04 Inter;letter-spacing:-.04em;color:#14161a}
h1 em{font-style:normal;color:#6f9a0e}
.sub{margin-top:20px;font:500 36px/1.35 Inter;color:#3b4559}
.fone{left:260px;top:600px;transform-origin:50% 50%}
.foto{position:absolute;left:50px;top:620px;width:980px;height:551px;border-radius:30px;overflow:hidden;box-shadow:0 50px 90px -30px rgba(20,22,26,.5),0 0 0 2px rgba(20,22,26,.12)}
.foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 60%}
.chip{position:absolute;display:inline-flex;align-items:center;gap:14px;padding:18px 30px;border-radius:999px;background:#b7d92d;color:#111;font:800 34px Inter;box-shadow:0 20px 40px -16px rgba(140,170,20,.7);opacity:0}
.itens{position:absolute;left:80px;right:80px;top:1400px;display:flex;flex-wrap:wrap;gap:16px}
.item{padding:16px 26px;border-radius:999px;border:2px solid rgba(20,22,26,.16);font:700 30px Inter;color:#14161a;background:rgba(255,255,255,.7);opacity:0}
`;

const corpo = `
<div class="claroFundo" id="claroFundo"></div><div id="brilho"></div>
<svg id="fio" viewBox="0 0 1080 1920" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#9cc21a" stop-opacity="0"/><stop offset=".5" stop-color="#9cc21a" stop-opacity=".8"/><stop offset="1" stop-color="#b7d92d" stop-opacity="0"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="8"/></filter></defs>
<path id="fioA" d="M-50,1500 C300,1560 600,1250 1130,1050" fill="none" stroke="url(#g)" stroke-width="14" opacity=".4" filter="url(#b)"/><path id="fioB" d="M-50,1500 C300,1560 600,1250 1130,1050" fill="none" stroke="url(#g)" stroke-width="3"/></svg>

<div class="cena antes" id="c1"><div class="tit" id="t1">Que KM<br>era mesmo?</div>
  <div class="bloco" id="bloco"></div><img class="fsem" src="${IMG.foto}"><div class="carimbo" id="carimbo">SEM KM</div></div>
<div class="cena" id="c2">
  <div class="lado ladoA" id="ladoA"><div class="tit2">Anotar depois…</div>
    <table class="planilha"><tr><td class="c">Foto</td><td class="c">KM</td><td class="c">Est.</td></tr><tr><td>IMG_0412</td><td>325,9</td><td>?</td></tr><tr><td>IMG_0413</td><td class="e" id="cel">326?</td><td></td></tr><tr><td>IMG_0414</td><td></td><td></td></tr><tr><td>IMG_0415</td><td></td><td></td></tr></table>
    <img class="fsem" src="${IMG.rod}" style="left:40px;top:1120px;width:460px;height:300px"></div>
  <div class="lado ladoB" id="ladoB"><div class="tit2">…ou fotografar <em>certo</em>.</div>${fone('fc2', IMG.cam)}<div class="ok" id="ok2">✓ KM 326,040 · Est. 16302+0</div></div>
  <div class="div" id="div2" style="left:50%"></div></div>

<div class="cena" id="s1"><div class="txt"><img class="logo" id="logo1" src="${IMG.logo}">
  <h1 id="h1a"><span class="pal">O</span> <span class="pal">KM</span> <span class="pal">certo,</span><br><span class="pal">em</span> <span class="pal">cada</span> <span class="pal">foto.</span></h1>
  <div class="sub" id="sub1">Registro fotográfico de rodovias, com o KM pelo GPS e a base oficial do SNV.</div></div><div class="palco">${fone('f1', IMG.inicio)}</div></div>

<div class="cena" id="s2"><div class="txt"><h1>Cadastre a rodovia<br><em>uma vez</em>.</h1><div class="sub">UF, BR e versão do SNV. Depois funciona sem internet, no meio do campo.</div></div><div class="palco">${fone('f2', IMG.eixo, IMG.imp)}</div></div>

<div class="cena" id="s3"><div class="txt"><h1>A legenda vai <em>gravada</em><br>na foto.</h1><div class="sub">Rodovia, KM, estaca, lado, coordenadas e data, na própria imagem.</div></div>
  <div class="foto"><img id="foto3" src="${IMG.foto}">${caixasLegenda('cx')}</div>
  <div class="chip" id="chip3" style="left:50%;top:1250px;transform:translateX(-50%)">✓&nbsp; Gravado na imagem, sem edição depois</div>
  <div class="itens" id="itens3"><span class="item">Rodovia</span><span class="item">KM</span><span class="item">Estaca</span><span class="item">Lado</span><span class="item">Coordenadas</span><span class="item">Data e hora</span><span class="item">Serviço e contrato</span></div></div>

<div class="cena" id="s4"><div class="txt"><h1>Fotografou,<br>tá <em>documentado</em>.</h1><div class="sub">Salva na galeria com a legenda, organizada por rodovia e KM.</div></div><div class="palco">${fone('f4', IMG.cam, IMG.gal)}</div></div>

<div class="cena" id="s5"><div class="txt"><h1>O KM acompanha<br>o <em>carro</em>.</h1><div class="sub">Pelo GPS, com a base oficial do SNV/DNIT. Modo Carro para ver de longe.</div></div><div class="palco">${fone('f5', IMG.carro)}</div></div>

${encerramento('s6', 'claro')}`;

const script = `
const BLOCO = 'BR-226 · km 326?\\nou 327…\\nfoto 14 (qual?)\\nest. ______';
// cenas do app, em batidas (a abertura do C ocupa 0–14)
const A = { s1: [14, 22], s2: [22, 30], s3: [30, 38], s4: [38, 45], s5: [45, 53], s6: [53, 66] };
// iPhone no estilo do B: entra subindo com giro 3D e assenta; "mergulho" opcional (escala para um ponto da tela)
function fone3d(f, u, { giro = 14, mergulho = null } = {}) {
  const p = ez(fase(u, 0.1, 0.85)); let s = 1, ty = (1 - p) * 220, ry = giro * (1 - p), rx = 0, oy = '50%';
  if (mergulho) { const [a, b, esc, foco, dy] = mergulho; const m = ezi(fase(u, a, b)); s = 1 + (esc - 1) * m; oy = foco; ty += dy * m; }
  f.style.transformOrigin = '50% ' + oy; f.style.opacity = ez(fase(u, 0.1, 0.7));
  f.style.transform = 'translateY(' + ty + 'px) rotateY(' + ry + 'deg) rotateX(' + rx + 'deg) scale(' + s + ')';
}
window.render = function (t) {
  let u;
  const claro = t >= T(14); $('#claroFundo').style.opacity = claro ? 1 : 0; $('#brilho').style.opacity = claro ? 1 : 0; $('#fio').style.opacity = claro ? 1 : 0; fio(t, ${DUR});
  // C1 — caderneta: texto à mão, título tremendo, carimbo na batida 3
  if ((u = corte($('#c1'), t, 0, T(6))) !== null) {
    const tt = $('#t1'); tt.style.opacity = cl(u * 4); tt.style.transform = 'translate(' + (3 * Math.sin(u * 37)) + 'px,' + (3 * Math.cos(u * 29)) + 'px) rotate(' + (0.6 * Math.sin(u * 23) - 1) + 'deg)';
    const n = Math.floor(fase(u, T(0.5), T(4)) * BLOCO.length); $('#bloco').innerHTML = BLOCO.slice(0, n).replace('?', '<i>?</i>').replace('(qual?)', '<i>(qual?)</i>');
    pula($('#carimbo'), fase(u, T(3), T(3) + 0.25)); $('#carimbo').style.transform += ' rotate(-8deg)';
    $('#c1').style.opacity = 1 - fase(u, T(5.7), T(6));
  }
  // C2 — split planilha × app; a divisória fecha na virada (batida 14)
  if ((u = corte($('#c2'), t, T(6), T(14.5))) !== null) {
    const fecha = ezi(fase(u, T(7.4), T(8.6)));
    $('#div2').style.left = (50 - 50 * fecha) + '%'; $('#ladoA').style.width = (50 - 50 * fecha) + '%'; $('#ladoB').style.width = (50 + 50 * fecha) + '%';
    const cel = $('#cel'); const k = Math.floor(fase(u, T(1), T(3)) * 4); cel.textContent = '326?'.slice(0, k) + (k < 4 && u > T(1) ? '|' : '');
    const f = $('#fc2'); f.style.transform = 'translateX(' + (fecha * (220 - 540 * (1 - fecha))) + 'px) scale(' + (1 + fecha * 0.18) + ')';
    flash(f, u, T(8)); pula($('#ok2'), fase(u, T(2.5), T(2.5) + 0.4));
  }
  $('#flashTela').style.opacity = t >= T(14) && t < T(14.8) ? (1 - ez(fase(t, T(14.06), T(14.8)))) : 0;
  // 1 — tela inicial: logo, frase palavra a palavra, iPhone sobe com giro
  if ((u = corte($('#s1'), t, ...A.s1.map(T))) !== null) {
    const l = $('#logo1'); const p = ez(fase(u, 0, 0.7)); l.style.opacity = p; l.style.transform = 'translateY(' + ((1 - p) * 30) + 'px)';
    $$('#h1a .pal').forEach((w, i) => sobe(w, fase(u, 0.4 + i * 0.12, 0.85 + i * 0.12), 50)); sobe($('#sub1'), fase(u, T(2.5), T(2.5) + 0.5), 30);
    fone3d($('#f1'), u, { giro: 16 }); $('#s1').style.opacity = 1 - fase(u, T(7.7), T(8));
  }
  // 2 — cadastro: Gestão de Eixo → Baixar rodovia; mergulho no botão (B) com o anel pulsando
  if ((u = corte($('#s2'), t, ...A.s2.map(T))) !== null) {
    sobe($('#s2 .txt'), fase(u, 0, 0.6)); const f = $('#f2'); fone3d(f, u, { giro: -14, mergulho: [T(3.5), T(5), 1.45, '42%', 120] }); cruza(f, u, T(2.5), T(2.5) + 0.4);
    pulso(f, u, T(4), 10.5, 37.2, 79, 6.2); $('#s2').style.opacity = 1 - fase(u, T(7.7), T(8));
  }
  // 3 — legenda escrita linha a linha, etiquetas acendendo
  if ((u = corte($('#s3'), t, ...A.s3.map(T))) !== null) {
    sobe($('#s3 .txt'), fase(u, 0, 0.6)); $('#foto3').style.transform = 'scale(' + (1 + 0.07 * (u / T(8))) + ')';
    $('#s3 .foto').style.transform = 'translateY(' + ((1 - ez(fase(u, 0.1, 0.9))) * 120) + 'px)';
    escreve('cx', u, T(1.2), T(1.5), 0.8);
    const ch = $('#chip3'); const pc = ez(fase(u, T(6.2), T(6.2) + 0.5)); ch.style.opacity = pc; ch.style.transform = 'translateX(-50%) scale(' + (0.7 + 0.3 * pc) + ')';
    $$('#itens3 .item').forEach((it, i) => sobe(it, fase(u, T(1) + i * 0.5, T(1) + 0.45 + i * 0.5), 24)); $('#s3').style.opacity = 1 - fase(u, T(7.7), T(8));
  }
  // 4 — câmera: obturador na batida 3 (flash + bump), galeria com a foto selecionada
  if ((u = corte($('#s4'), t, ...A.s4.map(T))) !== null) {
    sobe($('#s4 .txt'), fase(u, 0, 0.6)); const f = $('#f4'); fone3d(f, u, { giro: 12 }); flash(f, u, T(3)); cruza(f, u, T(4), T(4) + 0.4);
    const s = garante(f, 'sel', 'left:2.6%;top:29.6%;width:31%;height:10.9%'); s.style.opacity = ez(fase(u, T(4.5), T(4.5) + 0.4)) * (1 - fase(u, T(6.6), T(7)));
    $('#s4').style.opacity = 1 - fase(u, T(6.7), T(7));
  }
  // 5 — Modo Carro: o iPhone deita como no painel (B) e o KM sobe
  if ((u = corte($('#s5'), t, ...A.s5.map(T))) !== null) {
    sobe($('#s5 .txt'), fase(u, 0, 0.6)); const f = $('#f5'); const p = ez(fase(u, 0.1, 0.85)), q = ezi(fase(u, T(1), T(2.5)));
    f.style.transformOrigin = '50% 50%'; f.style.opacity = ez(fase(u, 0.1, 0.7));
    f.style.transform = 'translateY(' + ((1 - p) * 220 + 60 * q) + 'px) rotateX(' + (18 * q) + 'deg) scale(' + (1 - 0.05 * q) + ')';
    contador(f, 82360 + Math.round(ezi(fase(u, T(1.5), T(7))) * 56) * 10); $('#s5').style.opacity = 1 - fase(u, T(7.7), T(8));
  }
  // 6 — encerramento
  if ((u = corte($('#s6'), t, ...A.s6.map(T))) !== null) encerra('s6', u);
};`;

const cues = [{ t: 0.05, tipo: 'estatica' }, { t: T(3), tipo: 'hit', g: 0.9 }, { t: T(6), tipo: 'whoosh', g: 0.6 }, { t: T(14), tipo: 'riser' }, { t: T(14), tipo: 'obturador', g: 1.2 }, { t: T(14.05), tipo: 'hit' }, { t: T(14.2), tipo: 'whoosh' }];
for (let i = 0; i < 4; i++) cues.push({ t: T(7 + i * 0.5), tipo: 'tick', g: 1.2 });                        // digitação da planilha
for (const b of [22, 30, 38, 45]) { cues.push({ t: T(b), tipo: 'hit' }); cues.push({ t: T(b + 0.3), tipo: 'whoosh', g: 0.7 }); }
cues.push({ t: T(14.3), tipo: 'whoosh', g: 0.7 }, { t: T(26), tipo: 'ding' });                             // celular sobe · anel no botão
for (let i = 0; i < 4; i++) { const a = T(30) + T(1.2) + i * T(1.5); for (let k = 0; k < 40; k += 2) cues.push({ t: a + (k / 40) * 0.8, tipo: 'tick', g: 0.7 }); }   // legenda
cues.push({ t: T(41), tipo: 'obturador' }, { t: T(42.5), tipo: 'tick', g: 1.4 }, { t: T(53), tipo: 'hit', g: 1.1 }, { t: T(54), tipo: 'whoosh', g: 0.7 }, { t: T(56), tipo: 'whoosh', g: 0.6 });
const secoes = [
  { de: 0, ate: T(14), pad: 0.7, baixo: 0.5, bat: 'suja', lofi: 1, nivel: 0.9 },
  { de: T(14), ate: T(53), pad: 1, baixo: 1, arp: 1, bat: 'cheia' },
  { de: T(53), ate: DUR, pad: 1, baixo: 1, arp: 0.8, bat: 'cheia' },
];
const audio = path.join(AQUI, 'final.wav');
if (process.argv[2] !== 'stills') gerarAudio({ saida: audio, dur: DUR, secoes, cues, pausas: [[T(53) - 0.5, T(53)]] });
await montar({ nome: 'km-check-final', dur: DUR, css, corpo, script, audio, stills: [T(3.5), T(10), T(17), T(27), T(34), T(42.5), T(50), T(60)] });
