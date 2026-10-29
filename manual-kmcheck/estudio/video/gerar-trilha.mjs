/* Trilha de fundo do vídeo de divulgação: sintetizada aqui mesmo (sem arquivo de terceiros, sem direitos autorais).
 * Eletrônica leve: pad de acordes, baixo, bumbo suave, chimbal e um arpejo de 16avos. 104 BPM, 52 s, com entrada
 * (só pad + arpejo até 4 s), pausa dos tambores na cena do cartão (36–44 s) e fade-out no fim.
 * Uso: node manual-kmcheck/estudio/video/gerar-trilha.mjs   → manual-kmcheck/estudio/video/trilha.wav (44,1 kHz, estéreo) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100, DUR = 52, BPM = 104, BEAT = 60 / BPM, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const nota = n => 440 * 2 ** ((n - 69) / 12);                      // MIDI → Hz
// progressão: Am · F · C · G (um compasso cada, 4 tempos) — tons MIDI das tríades (3ª oitava) e do baixo (2ª)
const ACORDES = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const BAIXO = [45, 41, 36, 43];
const compasso = t => Math.floor(t / (BEAT * 4));
const acorde = t => ACORDES[compasso(t) % 4], baixo = t => BAIXO[compasso(t) % 4];

// seções: tambores entram em 4 s, saem em 36–44 s (cena do cartão), voltam até o fim
const tambores = t => (t >= 4 && t < 36) || t >= 44;
const sidechain = t => { const f = (t % BEAT) / BEAT; return tambores(t) ? 0.55 + 0.45 * Math.min(1, f * 2.2) : 1; };

// osciladores suaves: soma de harmônicas com amplitude 1/n² (perto de um triângulo) e leve desafinação (largura)
const tri = (f, t, det = 0) => { let s = 0; for (let n = 1; n <= 6; n += 2) s += Math.sin(2 * Math.PI * f * (1 + det) * n * t) / (n * n); return s; };
const env = (t, a, d) => t < a ? t / a : Math.exp(-(t - a) / d);  // ataque linear + decaimento exponencial

for (let i = 0; i < N; i++) {
  const t = i / SR, b = (t % BEAT), bi = Math.floor(t / BEAT);
  const ac = acorde(t), bx = baixo(t);
  const faseComp = (t % (BEAT * 4)) / (BEAT * 4);
  let l = 0, r = 0;

  // pad: as 3 notas do acorde, oitava acima, ataque lento a cada compasso, bem largo no estéreo
  const envPad = Math.min(1, faseComp * 3) * (1 - 0.15 * faseComp);
  for (let k = 0; k < 3; k++) {
    const f = nota(ac[k] + 12);
    l += 0.055 * envPad * tri(f, t, -0.003 * (k + 1));
    r += 0.055 * envPad * tri(f, t, 0.003 * (k + 1));
  }
  // baixo: senoide na fundamental, pulsando a cada tempo
  const eb = env(b, 0.01, 0.35);
  const sb = 0.22 * eb * Math.sin(2 * Math.PI * nota(bx) * t) + 0.06 * eb * Math.sin(2 * Math.PI * nota(bx + 12) * t);
  l += sb; r += sb;
  // arpejo de 16avos: percorre as notas do acorde (sobe e desce), nota curta, alterna lado a lado
  const s16 = BEAT / 4, idx = Math.floor(t / s16), t16 = t % s16;
  const seq = [0, 1, 2, 1, 0, 1, 2, 2]; const n16 = ac[seq[idx % 8] % 3] + 24;
  const ea = env(t16, 0.004, 0.09) * (t < 4 ? 0.6 : 1);
  const sa = 0.11 * ea * Math.sin(2 * Math.PI * nota(n16) * t) * (1 + 0.3 * Math.sin(2 * Math.PI * nota(n16) * 2 * t));
  const pan = 0.5 + 0.35 * Math.sin(idx * 1.7);
  l += sa * (1 - pan); r += sa * pan;

  if (tambores(t)) {
    // bumbo suave: senoide descendo de 130 → 45 Hz
    const fk = 45 + 85 * Math.exp(-b * 18), ek = Math.exp(-b * 14) * (b < 0.25 ? 1 : 0);
    const kick = 0.5 * ek * Math.sin(2 * Math.PI * fk * b);
    // chimbal: ruído curto nos contratempos (8avos), mais aberto no 2º e 4º tempo
    const t8 = t % (BEAT / 2), off = Math.floor(t / (BEAT / 2)) % 2 === 1;
    const eh = Math.exp(-t8 * (off ? 60 : 110)) * (t8 < 0.08 ? 1 : 0);
    const hat = 0.05 * eh * (Math.random() * 2 - 1);
    // caixa leve (ruído filtrado) nos tempos 2 e 4
    const sn = (bi % 2 === 1) ? 0.16 * Math.exp(-b * 28) * (b < 0.15 ? 1 : 0) * (Math.random() * 2 - 1) : 0;
    l += kick + hat * 0.9 + sn; r += kick + hat * 1.1 + sn;
  }
  const g = sidechain(t);
  l *= g; r *= g;
  // entrada e saída suaves
  const fade = Math.min(1, t / 1.5, (DUR - t) / 3);
  L[i] = l * fade; R[i] = r * fade;
}

// chimbal/caixa são ruído branco cru: um filtro passa-baixa simples tira o chiado agudo
for (const C of [L, R]) { let y = 0; for (let i = 0; i < N; i++) { y += 0.35 * (C[i] - y); C[i] = y; } }
// master: compressão suave (tanh) e normalização a −1 dBFS
let pico = 0; for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.6); R[i] = Math.tanh(R[i] * 1.6); pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])); }
const ganho = 0.89 / pico;

const wav = Buffer.alloc(44 + N * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { wav.writeInt16LE(Math.round(L[i] * ganho * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(R[i] * ganho * 32767), 46 + i * 4); }
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'trilha.wav');
fs.writeFileSync(out, wav);
console.log('trilha.wav', (wav.length / 1048576).toFixed(1), 'MB,', DUR, 's');
