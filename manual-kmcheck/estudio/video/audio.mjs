/* Áudio dos vídeos de divulgação, tudo sintetizado aqui (sem arquivo de terceiros, sem direitos autorais):
 *  - trilha a 104 BPM com seções (pad, baixo, arpejo, bateria, "piano", lo-fi) definidas por cada conceito;
 *  - efeitos sincronizados com as cenas (cues em segundos): obturador, whoosh, hit, tick, clack, riser, ding;
 *  - pausas (silêncio curto antes de um hit, truque clássico de dar peso ao final).
 * gerarAudio({ saida, dur, secoes, cues, pausas }) → WAV 44,1 kHz estéreo. */
import fs from 'node:fs';

const SR = 44100, BPM = 104, BEAT = 60 / BPM;
const nota = n => 440 * 2 ** ((n - 69) / 12);
const ACORDES = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], BAIXO = [45, 41, 36, 43];   // Am · F · C · G
const tri = (f, t, det = 0) => { let s = 0; for (let n = 1; n <= 6; n += 2) s += Math.sin(2 * Math.PI * f * (1 + det) * n * t) / (n * n); return s; };
const env = (t, a, d) => t < a ? t / a : Math.exp(-(t - a) / d);
/* filtro de 2 polos (Chamberlin): devolve {low, band, high} por amostra */
function svf() { let low = 0, band = 0; return (x, fc, q = 1) => { const f = Math.min(0.9, 2 * Math.sin(Math.PI * fc / SR)); low += f * band; const high = x - low - q * band; band += f * high; return { low, band, high }; }; }

/* ---------- efeitos ---------- */
function sfx(tipo) {
  const mk = (dur, fn) => { const n = Math.round(SR * dur), L = new Float32Array(n), R = new Float32Array(n); fn(L, R, n); return { L, R }; };
  const ruido = () => Math.random() * 2 - 1;
  switch (tipo) {
    case 'hit': return mk(0.9, (L, R, n) => { for (let i = 0; i < n; i++) { const t = i / SR; const f = 48 + 110 * Math.exp(-t * 22);
      const s = 0.95 * Math.exp(-t * 5) * Math.sin(2 * Math.PI * f * t) + 0.35 * Math.exp(-t * 90) * ruido(); L[i] = s; R[i] = s; } });
    case 'whoosh': return mk(0.55, (L, R, n) => { const fl = svf(), fr = svf(); for (let i = 0; i < n; i++) { const t = i / SR, p = t / 0.55; const fc = 250 * Math.pow(14, p);
      const e = Math.pow(Math.sin(Math.PI * Math.min(1, p / 0.85)), 1.6) * (p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15); const x = ruido();
      L[i] = 0.55 * e * fl(x, fc, 0.6).band * (1 - 0.7 * p); R[i] = 0.55 * e * fr(x, fc, 0.6).band * (0.3 + 0.7 * p); } });
    case 'obturador': return mk(0.2, (L, R, n) => { for (let i = 0; i < n; i++) { const t = i / SR; let s = 0;
      if (t < 0.03) s += 0.8 * Math.exp(-t * 300) * ruido() + 0.5 * Math.exp(-t * 180) * Math.sin(2 * Math.PI * 2600 * t);
      const t2 = t - 0.07; if (t2 >= 0 && t2 < 0.05) s += 0.9 * Math.exp(-t2 * 220) * ruido() + 0.5 * Math.exp(-t2 * 120) * Math.sin(2 * Math.PI * 1300 * t2);
      L[i] = s; R[i] = s; } });
    case 'tick': return mk(0.03, (L, R, n) => { for (let i = 0; i < n; i++) { const t = i / SR; const s = 0.28 * Math.exp(-t * 500) * ruido() + 0.15 * Math.exp(-t * 400) * Math.sin(2 * Math.PI * 1800 * t); L[i] = s; R[i] = s; } });
    case 'clack': return mk(0.12, (L, R, n) => { for (let i = 0; i < n; i++) { const t = i / SR; const s = 0.6 * Math.exp(-t * 120) * ruido() * (t < 0.02 ? 1 : 0.3) + 0.5 * Math.exp(-t * 40) * Math.sin(2 * Math.PI * (420 - 200 * t / 0.12) * t); L[i] = s; R[i] = s; } });
    case 'riser': return mk(1.8, (L, R, n) => { const f = svf(); for (let i = 0; i < n; i++) { const t = i / SR, p = t / 1.8; const s = 0.5 * p * p * f(ruido(), 200 + 7000 * p * p, 0.8).low; L[i] = s; R[i] = s; } });
    case 'ding': return mk(0.6, (L, R, n) => { for (let i = 0; i < n; i++) { const t = i / SR; const s = 0.22 * Math.exp(-t * 6) * (Math.sin(2 * Math.PI * 1318.5 * t) + 0.5 * Math.sin(2 * Math.PI * 1760 * t) + 0.25 * Math.sin(2 * Math.PI * 2637 * t)); L[i] = s; R[i] = s; } });
    case 'estatica': return mk(1.2, (L, R, n) => { const f = svf(); for (let i = 0; i < n; i++) { const t = i / SR; const e = Math.min(1, t * 10) * Math.min(1, (1.2 - t) * 10); const s = 0.25 * e * f(ruido(), 1800, 0.7).band * (Math.random() < 0.002 ? 6 : 1); L[i] = s * 0.9; R[i] = s * 1.1; } });
  }
  throw new Error('efeito desconhecido: ' + tipo);
}

/* ---------- trilha + mixagem ----------
 * secoes: [{de, ate, pad, baixo, arp, bat:'cheia'|'leve'|'suja'|0, piano, lofi, nivel}] (tempos em s; campos ausentes = 0)
 * cues:   [{t, tipo, g}]   t em s; 'riser' termina em t (começa antes)
 * pausas: [[t0, t1]]       silêncio na trilha (os efeitos continuam) */
export function gerarAudio({ saida, dur, secoes, cues = [], pausas = [] }) {
  const N = Math.round(SR * dur), L = new Float32Array(N), R = new Float32Array(N);
  const sec = t => secoes.find(s => t >= s.de && t < s.ate) || {};
  const compasso = t => Math.floor(t / (BEAT * 4)), acorde = t => ACORDES[compasso(t) % 4], baixo = t => BAIXO[compasso(t) % 4];
  const lpL = svf(), lpR = svf();
  for (let i = 0; i < N; i++) {
    const t = i / SR, s = sec(t), b = t % BEAT, bi = Math.floor(t / BEAT), ac = acorde(t), bx = baixo(t);
    const faseComp = (t % (BEAT * 4)) / (BEAT * 4);
    let l = 0, r = 0;
    if (s.pad) { const e = Math.min(1, faseComp * 3) * (1 - 0.15 * faseComp) * s.pad;
      for (let k = 0; k < 3; k++) { const f = nota(ac[k] + 12); l += 0.055 * e * tri(f, t, -0.003 * (k + 1)); r += 0.055 * e * tri(f, t, 0.003 * (k + 1)); } }
    if (s.piano) {                                                    // acorde "tocado" a cada tempo, decaindo (estilo keynote)
      const e = Math.exp(-b * 2.2) * s.piano;
      for (let k = 0; k < 3; k++) { const f = nota(ac[k] + 12 * (k === 0 ? 0 : 1)); const v = e * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t) + 0.12 * Math.sin(2 * Math.PI * f * 3 * t));
        l += 0.07 * v * (k === 0 ? 0.6 : 1); r += 0.07 * v * (k === 2 ? 0.6 : 1); } }
    if (s.baixo) { const eb = env(b, 0.01, 0.35) * s.baixo; const sb = 0.22 * eb * Math.sin(2 * Math.PI * nota(bx) * t) + 0.06 * eb * Math.sin(2 * Math.PI * nota(bx + 12) * t); l += sb; r += sb; }
    if (s.arp) { const s16 = BEAT / 4, idx = Math.floor(t / s16), t16 = t % s16; const seq = [0, 1, 2, 1, 0, 1, 2, 2]; const n16 = ac[seq[idx % 8] % 3] + 24;
      const ea = env(t16, 0.004, 0.09) * s.arp; const sa = 0.11 * ea * Math.sin(2 * Math.PI * nota(n16) * t) * (1 + 0.3 * Math.sin(2 * Math.PI * nota(n16) * 2 * t)); const pan = 0.5 + 0.35 * Math.sin(idx * 1.7);
      l += sa * (1 - pan); r += sa * pan; }
    if (s.bat) {
      const suja = s.bat === 'suja', leve = s.bat === 'leve';
      const temKick = suja ? (bi % 4 === 0 || bi % 4 === 2) && !(bi % 8 === 6) : true;
      if (temKick) { const fk = 45 + 85 * Math.exp(-b * 18), ek = Math.exp(-b * 14) * (b < 0.25 ? 1 : 0); const kick = (leve ? 0.32 : 0.5) * ek * Math.sin(2 * Math.PI * fk * b); l += kick; r += kick; }
      if (!leve) { const t8 = t % (BEAT / 2), off = Math.floor(t / (BEAT / 2)) % 2 === 1; const eh = Math.exp(-t8 * (off ? 60 : 110)) * (t8 < 0.08 ? 1 : 0); const hat = (suja ? 0.03 : 0.05) * eh * (Math.random() * 2 - 1);
        const sn = (bi % 2 === 1 && !suja) ? 0.16 * Math.exp(-b * 28) * (b < 0.15 ? 1 : 0) * (Math.random() * 2 - 1) : 0; l += hat * 0.9 + sn; r += hat * 1.1 + sn; }
    }
    if (s.lofi) { const cr = Math.random() < 0.0015 ? (Math.random() * 2 - 1) * 0.5 : 0; const ch = 0.015 * (Math.random() * 2 - 1); l += cr + ch; r += cr * 0.7 + ch; }
    const duck = s.bat && s.bat !== 'leve' ? 0.55 + 0.45 * Math.min(1, (b / BEAT) * 2.2) : 1;        // sidechain
    l *= duck * (s.nivel ?? 1); r *= duck * (s.nivel ?? 1);
    // lo-fi: passa-baixa fechado (rádio) · normal: só tira o chiado agudo do ruído branco
    const fc = s.lofi ? 1100 : 9000; l = lpL(l, fc, 1.1).low; r = lpR(r, fc, 1.1).low;
    let g = Math.min(1, t / 1.0, (dur - t) / 2.5);                                                   // entrada/saída
    for (const [a, c] of pausas) if (t >= a && t < c) g *= 1 - Math.min(1, (t - a) / 0.012, (c - t) / 0.012);
    L[i] = l * g; R[i] = r * g;
  }
  for (const c of cues) {
    const e = sfx(c.tipo), g = c.g ?? 1, ini = Math.round(SR * (c.tipo === 'riser' ? c.t - 1.8 : c.t));
    for (let i = 0; i < e.L.length; i++) { const k = ini + i; if (k >= 0 && k < N) { L[k] += e.L[i] * g; R[k] += e.R[i] * g; } }
  }
  let pico = 0; for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.5); R[i] = Math.tanh(R[i] * 1.5); pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])); }
  const ganho = 0.89 / pico;
  const wav = Buffer.alloc(44 + N * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { wav.writeInt16LE(Math.round(L[i] * ganho * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(R[i] * ganho * 32767), 46 + i * 4); }
  fs.writeFileSync(saida, wav);
  return saida;
}
